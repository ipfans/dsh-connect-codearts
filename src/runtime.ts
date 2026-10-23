import { Accounts, accountIdentity, emptyAccounts, publicAccounts, type Account, type AccountState } from './accounts.ts'
import { OAuthLogin } from './oauth.ts'
import type { AccountAction, BenefitsState, CatalogState, CodeArtsModel, CodeArtsStatus } from './types.ts'
import { CodeArtsClient, redact } from './upstream.ts'

export interface ModelSnapshot {
  account: Account | undefined
  models: readonly CodeArtsModel[]
}

const emptyCatalog = (): CatalogState => ({ models: [], issues: [] })
const identity = accountIdentity

export class CodeArtsRuntime {
  private state: AccountState = emptyAccounts()
  private currentIdentity: string | undefined
  private currentCatalog = emptyCatalog()
  private currentSnapshot: ModelSnapshot = { account: undefined, models: [] }
  private readonly catalogs = new Map<string, CatalogState>()
  private readonly benefits = new Map<string, BenefitsState>()
  private readonly claimAttempts = new Map<string, number>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private readonly controller = new AbortController()
  private syncGeneration = 0
  private closed = false
  readonly login: OAuthLogin

  constructor(readonly accounts: Accounts, readonly client: CodeArtsClient, private readonly now = Date.now) {
    this.login = new OAuthLogin(client.oauth, async (credentials, accountId, signal) => {
      if (this.closed) throw new Error('CodeArts plugin is stopping')
      await accounts.login(credentials, accountId, signal)
      void this.maintain().catch(() => {})
    }, now)
  }

  snapshot(): ModelSnapshot { return this.currentSnapshot }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(): void {
    this.currentSnapshot = { account: this.currentSnapshot.account, models: this.currentCatalog.models }
    for (const listener of this.listeners) listener()
  }

  async sync(): Promise<void> {
    const generation = ++this.syncGeneration
    let state: AccountState
    try { state = await this.accounts.read() } catch (error) {
      if (!this.closed && generation === this.syncGeneration) {
        this.state = emptyAccounts()
        this.currentIdentity = undefined
        this.currentSnapshot = { account: undefined, models: [] }
        this.currentCatalog = emptyCatalog()
        this.publish()
      }
      throw error
    }
    if (this.closed || generation !== this.syncGeneration) return
    this.state = state
    const keys = new Set(state.accounts.map(identity))
    for (const cache of [this.catalogs, this.benefits, this.claimAttempts]) for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key)
    const account = state.accounts.find(a => a.id === state.activeId && a.oauth && !a.oauth.needsLogin)
    const key = account === undefined ? undefined : identity(account)
    if (key === this.currentIdentity) { this.currentSnapshot = { account, models: this.currentCatalog.models }; return }
    this.currentIdentity = key
    this.currentSnapshot = { account, models: [] }
    this.currentCatalog = key === undefined ? emptyCatalog() : this.catalogs.get(key) ?? emptyCatalog()
    this.publish()
  }

  private join(key: string, run: () => Promise<void>): Promise<void> {
    const existing = this.inflight.get(key)
    if (existing) return existing
    const promise = run().finally(() => { this.inflight.delete(key) })
    this.inflight.set(key, promise)
    return promise
  }

  async refresh(force = false, expectedAccount?: string): Promise<void> {
    if (this.closed) return
    const account = this.currentSnapshot.account
    if (expectedAccount !== undefined && account?.id !== expectedAccount) throw new Error('The selected account changed; refresh this page and try again')
    if (!account) return
    const key = identity(account)
    await this.join(`catalog:${key}`, async () => {
      const previous = this.catalogs.get(key)
      if (!force && previous?.fetchedAt !== undefined && this.now() - previous.fetchedAt < 300_000) return
      let value: CatalogState
      try {
        const result = await this.client.models(account, this.controller.signal)
        value = { ...result, fetchedAt: this.now() }
      } catch (error) {
        value = { models: previous?.models ?? [], issues: previous?.issues ?? [], ...(previous?.fetchedAt === undefined ? {} : { fetchedAt: previous.fetchedAt }), error: redact(error instanceof Error ? error.message : 'Model discovery failed', account) }
      }
      if (!this.current(account)) return
      this.catalogs.set(key, value)
      if (key === this.currentIdentity) { this.currentCatalog = value; this.publish() }
    })
  }

  private current(account: Account): boolean {
    return !this.closed && this.state.accounts.some(value => identity(value) === identity(account))
  }

  private async refreshBenefits(account: Account, force = false): Promise<void> {
    const key = identity(account)
    await this.join(`benefits:${key}`, async () => {
      const previous = this.benefits.get(key) ?? {}
      if (!force && previous.fetchedAt !== undefined && this.now() - previous.fetchedAt < 300_000) return
      let update: Partial<BenefitsState>
      try { update = { subscription: await this.client.subscription(account, this.controller.signal), fetchedAt: this.now() } }
      catch (error) { update = { error: redact(error instanceof Error ? error.message : 'Subscription lookup failed', account) } }
      if (!this.current(account)) return
      const next = { ...this.benefits.get(key), ...update }
      if (!update.error) delete next.error
      this.benefits.set(key, next)
    })
  }

  private async claim(account: Account): Promise<void> {
    const key = identity(account)
    await this.join(`claim:${key}`, async () => {
      this.claimAttempts.set(key, this.now())
      let update: Partial<BenefitsState>
      try { update = { claims: await this.client.claim(account, this.controller.signal, this.now()), checkedAt: this.now() } }
      catch (error) { update = { claimError: redact(error instanceof Error ? error.message : 'Credit claim failed', account) } }
      if (!this.current(account)) return
      const next = { ...this.benefits.get(key), ...update }
      if (!update.claimError) delete next.claimError
      this.benefits.set(key, next)
      await this.refreshBenefits(account, true)
    })
  }

  async maintain(): Promise<void> {
    if (this.closed) return
    await this.join('maintenance', async () => {
      await this.sync()
      for (const account of this.state.accounts) {
        if (!this.current(account) || !account.oauth || account.oauth.needsLogin) continue
        try { await this.client.authorize(account) } catch { continue }
        const attempted = this.claimAttempts.get(identity(account))
        if (this.state.autoClaim && (attempted === undefined || this.now() - attempted >= 1_800_000)) await this.claim(account)
        else await this.refreshBenefits(account)
      }
      await this.sync()
      await this.refresh()
    })
  }

  async action(action: AccountAction): Promise<void> {
    if (this.closed) throw new Error('CodeArts plugin is stopping')
    switch (action.action) {
      case 'rename': await this.accounts.rename(action.id, action.label); break
      case 'select': await this.accounts.select(action.id); break
      case 'remove': {
        if (this.login.status().accountId === action.id) this.login.cancel()
        await this.accounts.remove(action.id); break
      }
      case 'login': {
        await this.sync()
        if (action.accountId !== undefined && !this.state.accounts.some(account => account.id === action.accountId)) throw new Error('Account no longer exists')
        await this.login.start(action.accountId)
        return
      }
      case 'cancel-login': this.login.cancel(); return
      case 'auto-claim': await this.accounts.setAutoClaim(action.enabled); break
      case 'claim':
      case 'refresh': {
        await this.sync()
        const account = this.currentSnapshot.account
        if (account?.id !== action.accountId) throw new Error('The selected account changed or requires login; refresh this page and try again')
        if (action.action === 'claim') await this.claim(account)
        else await Promise.all([this.refresh(true, action.accountId), this.refreshBenefits(account, true)])
        return
      }
    }
    await this.sync()
    await this.refresh()
    if (this.currentSnapshot.account) await this.refreshBenefits(this.currentSnapshot.account)
    if (action.action === 'auto-claim' && action.enabled) void this.maintain().catch(() => {})
  }

  async status(actionToken: string): Promise<CodeArtsStatus> {
    await this.sync()
    return {
      accounts: publicAccounts(this.state).map(account => ({ ...account, benefits: this.benefits.get(identity(this.state.accounts.find(row => row.id === account.id)!)) ?? {} })), activeId: this.state.activeId,
      catalog: this.currentCatalog, actionToken,
      autoClaim: this.state.autoClaim, login: this.login.status(),
    }
  }

  close(): void {
    this.closed = true
    this.controller.abort(new Error('CodeArts plugin stopped'))
    this.login.cancel()
    this.client.close()
    this.listeners.clear()
    this.catalogs.clear()
    this.benefits.clear()
    this.claimAttempts.clear()
    this.state = emptyAccounts()
    this.currentSnapshot = { account: undefined, models: [] }
  }
}
