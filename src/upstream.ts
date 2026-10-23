import type { Account } from './accounts.ts'
import { object, positive, text } from './json.ts'
import { signRequest } from './signing.ts'
import type { CodeArtsModel } from './types.ts'

export const SNAP_BASE = 'https://snap-access.cn-north-4.myhuaweicloud.com'
export const CHAT_URL = `${SNAP_BASE}/api/v2/chat/completions`

export class CodeArtsError extends Error {
  constructor(message: string, readonly status = 502, readonly code = 'upstream_error') {
    super(message)
    this.name = 'CodeArtsError'
  }
}

export type FailureObserver = (error: CodeArtsError, retryAfter?: string | null) => void

export function redact(message: string, account?: Pick<Account, 'ak' | 'sk'>): string {
  let result = message
  for (const value of [account?.ak, account?.sk]) if (value) result = result.replaceAll(value, '[redacted]')
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
    const params = object(row['model_parameters'])
    const contextWindow = params?.['context_window']
    const maxTokens = params?.['max_tokens']
    if (!positive(contextWindow) || !positive(maxTokens)) {
      issues.push(`${id}: context_window or max_tokens is missing or invalid`)
      continue
    }
    if (models.some(m => m.upstreamId === id)) continue
    models.push({
      id: `agent/${id}`, upstreamId: id,
      name: text(row['model_alias']) ?? text(row['model_name']) ?? id,
      contextWindow, maxTokens: Math.min(maxTokens, contextWindow),
      supportsImages: params?.['supports_images'] === true,
    })
  }
  return { models, issues }
}

export class CodeArtsClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  async request(account: Account, method: string, target: string, body = new Uint8Array(), extra: Record<string, string> = {}, signal?: AbortSignal, timeoutMs = 30_000): Promise<Response> {
    const url = new URL(target)
    if (url.origin !== SNAP_BASE || url.username || url.password) throw new CodeArtsError('CodeArts request destination is not allowed', 400)
    const headers = signRequest(account, method, url, body, extra)
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

  private async json(account: Account, method: string, target: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.request(account, method, target, new Uint8Array(), extra, signal)
    const data: unknown = await response.json().catch(() => undefined)
    const error = businessError(data)
    if (!response.ok || error) {
      const message = redact(error?.message ?? `CodeArts HTTP ${response.status}`, account)
      throw new CodeArtsError(message, response.ok ? businessStatus(message) : response.status, error?.code)
    }
    const result = object(data)
    if (!result) throw new CodeArtsError('CodeArts returned an invalid JSON document')
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
        const parsed = parseModels(rows)
        issues.push(...parsed.issues)
        if (parsed.models.length) return { models: parsed.models, issues }
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    if (lastError) throw lastError
    return { models: [], issues }
  }
}
