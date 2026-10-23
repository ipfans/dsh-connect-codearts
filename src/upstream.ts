import type { Account, Accounts } from './accounts.ts'
import { object, positive, text } from './json.ts'
import { LoginRequiredError, OAuthClient } from './oauth.ts'
import { signRequest } from './signing.ts'
import { FALLBACK_REASONING, REASONING_EFFORTS, type ClaimResult, type CodeArtsModel, type CreditAmount, type Subscription } from './types.ts'

export const SNAP_BASE = 'https://snap-access.cn-north-4.myhuaweicloud.com'
export const CHAT_URL = `${SNAP_BASE}/api/v2/chat/completions`

export class CodeArtsError extends Error {
  constructor(message: string, readonly status = 502, readonly code = 'upstream_error') {
    super(message)
    this.name = 'CodeArtsError'
  }
}

export type FailureObserver = (error: CodeArtsError, retryAfter?: string | null) => void

export function redact(message: string, account?: Pick<Account, 'ak' | 'sk' | 'oauth'>): string {
  let result = message
  for (const value of [account?.ak, account?.sk, account?.oauth?.securityToken, account?.oauth?.refreshToken, account?.oauth?.verifier, account?.oauth?.privateKey.d]) if (value) result = result.replaceAll(value, '[redacted]')
  return result.slice(0, 500)
}

export function businessError(value: unknown): { message: string; code: string } | undefined {
  const data = object(value)
  if (!data) return undefined
  const wrapped = object(data['error'])
  const code = data['error_code']
  const failure = code !== undefined && code !== null && !['0', '0000'].includes(String(code))
  if (data['error'] || failure || (code == null && text(data['error_msg']))) {
    return {
      message: text(wrapped?.['message']) ?? text(data['error_msg']) ?? text(data['error']) ?? 'CodeArts rejected this request',
      code: String(wrapped?.['code'] ?? code ?? 'upstream_error'),
    }
  }
  return undefined
}

export function businessStatus(message: string): number {
  if (/quota|insufficient.*token|token.*exhaust|余额|额度/iu.test(message)) return 402
  if (/rate.limit|tpm.limit|concurren|限流|并发/iu.test(message)) return 429
  if (/signature|unauthorized|authentication|access.?key|签名|认证/iu.test(message)) return 401
  if (/permission|forbidden|权限/iu.test(message)) return 403
  return 502
}

export interface DiscoveredModels {
  models: CodeArtsModel[]
  issues: string[]
}

export function parseModels(rows: unknown[]): DiscoveredModels {
  const models: CodeArtsModel[] = []
  const issues: string[] = []
  for (const value of rows) {
    const row = object(value)
    const id = text(row?.['model_id']) ?? text(row?.['model_alias'])
    if (!row || !id || !/^[\x21-\x7e]{1,256}$/u.test(id)) {
      issues.push('A model was skipped because its ID is missing or invalid')
      continue
    }
    const params = object(row['model_parameters']) ?? row
    const contextWindow = params?.['context_window']
    const maxTokens = params?.['max_tokens']
    if (!positive(contextWindow) || !positive(maxTokens)) {
      issues.push(`${id}: context_window or max_tokens is missing or invalid`)
      continue
    }
    if (models.some(m => m.upstreamId === id)) continue
    const rawCredit = row['credit'] ?? params['credit']
    const credit = Array.isArray(rawCredit) ? rawCredit : [rawCredit]
    const rates = [...new Set(credit.map(item => {
      const value = object(item)?.['ratio_display']
      return typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?x?$/u.test(value.trim()) ? Number(value.trim().replace(/x$/u, '')) : NaN
    }).filter(value => Number.isFinite(value) && value >= 0))]
    models.push({
      id: `agent/${id}`, upstreamId: id,
      name: text(row['model_alias']) ?? text(row['model_name']) ?? id,
      contextWindow, maxTokens: Math.min(maxTokens, contextWindow),
      supportsImages: params?.['supports_images'] === true,
      ...(rates.length ? { creditRates: rates } : {}),
    })
  }
  return { models, issues }
}

export class CodeArtsClient {
  private readonly controller = new AbortController()
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch, private readonly accounts?: Accounts, readonly oauth = new OAuthClient(fetcher)) {}

  async authorize(account: Account): Promise<Account> {
    try {
      if (!account.oauth || account.oauth.needsLogin) throw new LoginRequiredError()
      if (this.accounts) return await this.accounts.authorize(account, credentials => this.oauth.refresh(credentials, this.controller.signal))
      if (account.oauth.expiresAt <= Date.now()) throw new LoginRequiredError()
      return account
    } catch (error) {
      throw new CodeArtsError(redact(error instanceof Error ? error.message : 'CodeArts authorization failed', account), error instanceof LoginRequiredError ? 401 : 503, 'authorization_error')
    }
  }

  close(): void { this.controller.abort() }

  async request(account: Account, method: string, target: string, body = new Uint8Array(), extra: Record<string, string> = {}, signal?: AbortSignal, timeoutMs = 30_000): Promise<Response> {
    const url = new URL(target)
    if (url.origin !== SNAP_BASE || url.username || url.password) throw new CodeArtsError('CodeArts request destination is not allowed', 400)
    signal?.throwIfAborted()
    const current = await this.authorize(account)
    signal?.throwIfAborted()
    const headers = signRequest(current, method, url, body, { ...extra, 'x-security-token': current.oauth!.securityToken })
    const deadline = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      return await this.fetcher(url, {
        method, headers, redirect: 'error',
        ...(method === 'GET' ? {} : { body: Buffer.from(body) }),
        signal: requestSignal,
      })
    } catch {
      if (signal?.aborted) throw signal.reason
      if (deadline.aborted) throw new CodeArtsError('CodeArts request timed out', 504, 'timeout')
      throw new CodeArtsError('CodeArts network request failed; check connectivity and proxy settings')
    }
  }

  private async json(account: Account, method: string, target: string, extra: Record<string, string> = {}, signal?: AbortSignal, body?: unknown): Promise<Record<string, unknown>> {
    const current = await this.authorize(account)
    const response = await this.request(current, method, target, body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)), extra, signal)
    const data: unknown = await response.json().catch(() => undefined)
    const error = businessError(data)
    if (!response.ok || error) {
      const message = redact(error?.message ?? `CodeArts HTTP ${response.status}`, current)
      throw new CodeArtsError(message, response.ok ? businessStatus(message) : response.status, error?.code)
    }
    const result = object(data)
    if (!result) throw new CodeArtsError('CodeArts returned an invalid JSON document')
    if (target.startsWith(`${SNAP_BASE}/v1/ops/`) && result['code'] !== 0) throw new CodeArtsError(redact(text(result['message']) ?? 'CodeArts credit activity failed or returned an invalid business code', current), 502)
    return result
  }

  async models(account: Account, signal?: AbortSignal): Promise<DiscoveredModels> {
    const headers = { 'agent-type': 'AgentCenter', 'x-language': 'zh-cn', accept: 'application/json' }
    const data = await this.json(account, 'GET', `${SNAP_BASE}/v1/agent-center/agents/useragents?offset=0&limit=100`, headers, signal)
    if (!Array.isArray(data['agents'])) throw new CodeArtsError('CodeArts AgentCenter list is missing')
    const agents = data['agents'].map(object).filter(a => a !== undefined)
      .sort((a, b) => Number(b['is_primary_agent'] === true) - Number(a['is_primary_agent'] === true) || Number(a['agent_order'] ?? 999999) - Number(b['agent_order'] ?? 999999))
    const issues: string[] = []
    let lastError: unknown
    for (const agent of agents) {
      const id = text(agent['agent_id'])
      if (!id) continue
      try {
        const detail = await this.json(account, 'GET', `${SNAP_BASE}/v1/agent-center/agents/detail?agent_id=${encodeURIComponent(id)}`, headers, signal)
        const rows = object(detail['gpts'])?.['models']
        if (!Array.isArray(rows)) continue
        let builtin: Record<string, unknown>[] = []
        try {
          const data = await this.json(account, 'GET', `${SNAP_BASE}/v1/model/builtin`, { ...headers, 'agent-type': 'PromptCenter' }, signal)
          if (Array.isArray(data['builtinModels'])) builtin = data['builtinModels'].map(object).filter(row => row !== undefined)
        } catch (error) {
          if (signal?.aborted) throw error
          issues.push('Model credit metadata could not be refreshed')
        }
        const parsed = parseModels(rows.map(value => {
          const row = object(value)
          const supplement = builtin.find(item => item['model_id'] === row?.['model_id'])
          return { ...supplement, ...row, model_parameters: { ...supplement, ...object(row?.['model_parameters']) }, credit: row?.['credit'] ?? object(row?.['model_parameters'])?.['credit'] ?? supplement?.['credit'] }
        }))
        issues.push(...parsed.issues)
        if (parsed.models.length) {
          let variants: Record<string, unknown> = {}
          try {
            const data = await this.json(account, 'POST', `${SNAP_BASE}/v1/model/thinking-variants`, { ...headers, 'agent-type': 'PromptCenter' }, signal, { model_names: parsed.models.map(model => model.upstreamId) })
            const rows = object(data['variants'])
            if (!rows) throw new CodeArtsError('CodeArts thinking variants are missing')
            variants = Object.fromEntries(Object.entries(rows).map(([id, value]) => [id.toLowerCase(), value]))
          } catch (error) {
            if (signal?.aborted) throw error
            issues.push('Thinking effort metadata could not be refreshed; using fallback levels')
          }
          for (const model of parsed.models) {
            const variant = object(variants[model.upstreamId.toLowerCase()])
            const declared = variant?.['strengths']
            if (!Array.isArray(declared)) { model.reasoning = FALLBACK_REASONING; continue }
            const strengths = REASONING_EFFORTS.filter(effort => declared.includes(effort))
            const defaultStrength = text(variant?.['default_strength'])
            // An explicit empty list disables the selector; only missing definitions use fallback levels.
            model.reasoning = { strengths, ...(defaultStrength && strengths.some(effort => effort === defaultStrength) ? { default_strength: defaultStrength } : {}) }
          }
          return { models: parsed.models, issues }
        }
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    if (lastError) throw lastError
    return { models: [], issues }
  }

  async subscription(account: Account, signal?: AbortSignal): Promise<Subscription> {
    return parseSubscription(await this.json(account, 'GET', `${SNAP_BASE}/snap-manager/v1/statistics/plugin`, { 'agent-type': 'PromptCenter', 'x-language': 'zh-cn' }, signal))
  }

  private async credit(account: Account, method: string, path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
    const data = await this.json(account, method, `${SNAP_BASE}/v1/ops/${path}`, { 'agent-type': 'PromptCenter', 'x-language': 'zh-cn' }, signal, body)
    return data['data']
  }

  async claim(account: Account, signal?: AbortSignal, now = Date.now()): Promise<ClaimResult[]> {
    const data = object(await this.credit(account, 'GET', 'delivery?channel=IDE', signal))
    if (!Array.isArray(data?.['items'])) throw new CodeArtsError('CodeArts credit activity list is missing')
    const results: ClaimResult[] = []
    for (const value of data['items']) {
      const item = object(value)
      const id = item?.['campaignId']
      if (!item || (id !== 1 && id !== 4) || (item['benefitUnit'] !== undefined && item['benefitUnit'] !== 'CREDIT')) continue
      const status = text(item['status'])?.trim() ?? ''
      const result: ClaimResult = { campaignId: id, title: text(item['title']) ?? (id === 1 ? 'Daily check-in' : 'New user reward'), status, ok: true, message: '' }
      results.push(result)
      const extra = object(item['extra'])
      const start = Date.parse(String(extra?.['startTime'] ?? '')), end = Date.parse(String(extra?.['endTime'] ?? ''))
      if (Number.isFinite(end) && now >= end) { result.message = 'Campaign ended'; continue }
      if (Number.isFinite(start) && now < start) { result.message = 'Campaign has not started'; continue }
      if (status === 'CONFIRMED' || status === 'CONSUMED') { result.message = 'Already claimed'; continue }
      if (!status) { result.message = 'Not eligible'; continue }
      try {
        if (status === 'ELIGIBLE' && item['claimable'] === true) {
          await this.credit(account, 'POST', 'claim', signal, { campaignId: id, channel: 'IDE', idempotentKey: `claim_${id}_${now}` })
          result.status = 'CLAIMED'
          const amount = number(item['pendingTotalAmount']) ?? number(item['benefitAmount'])
          if (amount !== undefined) result.credits = amount
        } else if (status !== 'CLAIMED') {
          result.ok = false; result.message = 'Not claimable yet; retry later'; continue
        }
        await this.credit(account, 'POST', 'confirm', signal, { campaignId: id })
        result.status = 'CONFIRMED'
        result.message = status === 'CLAIMED' ? 'Confirmation completed' : 'Claim completed'
      } catch (error) {
        if (signal?.aborted) throw error
        result.ok = false
        result.message = redact(error instanceof Error ? error.message : 'Credit activity failed', account)
      }
    }
    return results
  }
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function creditAmount(row: Record<string, unknown>): CreditAmount {
  const result: CreditAmount = {}
  for (const [field, key] of [['total', 'package_credit_amount'], ['used', 'package_credit_used'], ['remaining', 'package_credit_remain'], ['expiring', 'package_credit_expiring_amount']] as const) {
    const value = number(row[key])
    if (value !== undefined) result[field] = value
  }
  return result
}

export function parseSubscription(data: Record<string, unknown>): Subscription {
  const metrics = Array.isArray(data['metrics']) ? data['metrics'].map(object).filter(row => row !== undefined) : []
  const total = metrics.find(row => row['name'] === 'usageTotalPackageCredit')
  const plan = object(data['package'])
  if (!plan && !total) throw new CodeArtsError('CodeArts subscription data is missing')
  if (plan?.['is_credit_package'] === true && (!total || Object.keys(creditAmount(total)).length === 0)) throw new CodeArtsError('CodeArts credit balance is missing')
  const result: Subscription = { ...(total ? creditAmount(total) : {}), packages: [] }
  for (const [field, value] of [['name', plan?.['package_name_cn']], ['nameEn', plan?.['package_name_en']], ['status', plan?.['status']], ['periodEnd', data['end_date']]] as const) {
    const content = text(value)
    if (content) result[field] = content
  }
  if (typeof plan?.['is_credit_package'] === 'boolean') result.isCreditPackage = plan['is_credit_package']
  for (const [kind, key] of [['basic', 'usageBasicPackageCredit'], ['ondemand', 'usageOnDemandPackageCredit'], ['bonus', 'usageBonusPackageCredit']] as const) {
    const row = metrics.find(row => row['name'] === key)
    if (row) result.packages.push({ kind, ...creditAmount(row) })
  }
  return result
}
