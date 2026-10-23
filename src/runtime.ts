import { createHash } from 'node:crypto'
import { Accounts, publicAccounts, type Account, type AccountState } from './accounts.ts'
import type { AccountAction, CatalogState, CodeArtsModel, CodeArtsStatus } from './types.ts'
import { CodeArtsClient, redact } from './upstream.ts'

export interface ModelSnapshot {
  account: Account | undefined
  models: readonly CodeArtsModel[]
}

const emptyCatalog = (): CatalogState => ({ models: [], issues: [] })
const identity = (account: Account): string => createHash('sha256').update(JSON.stringify([account.id, account.ak, account.sk])).digest('hex')

export class CodeArtsRuntime {
  private state: AccountState = { version: 1, accounts: [], activeId: null }
  private currentIdentity: string | undefined
  private currentCatalog = emptyCatalog()
  private currentSnapshot: ModelSnapshot = { account: undefined, models: [] }
  private readonly catalogs = new Map<string, CatalogState>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private readonly controller = new AbortController()
  private syncGeneration = 0
  private closed = false

  constructor(readonly accounts: Accounts, readonly client: CodeArtsClient, private readonly now = Date.now) {}

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
        this.state = { version: 1, accounts: [], activeId: null }
        this.currentIdentity = undefined
        this.currentSnapshot = { account: undefined, models: [] }
        this.currentCatalog = emptyCatalog()
        this.publish()
      }
      throw error
    }
    if (this.closed || generation !== this.syncGeneration) return
    this.state = state
    const account = state.accounts.find(a => a.id === state.activeId)
    const key = account === undefined ? undefined : identity(account)
    if (key === this.currentIdentity) return
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
    await this.join(key, async () => {
      const previous = this.catalogs.get(key)
      if (!force && previous?.fetchedAt !== undefined && this.now() - previous.fetchedAt < 300_000) return
      let value: CatalogState
      try {
        const result = await this.client.models(account, this.controller.signal)
        value = { ...result, fetchedAt: this.now() }
      } catch (error) {
        value = { models: previous?.models ?? [], issues: previous?.issues ?? [], ...(previous?.fetchedAt === undefined ? {} : { fetchedAt: previous.fetchedAt }), error: redact(error instanceof Error ? error.message : 'Model discovery failed', account) }
      }
      if (this.closed) return
      this.catalogs.set(key, value)
      if (key === this.currentIdentity) { this.currentCatalog = value; this.publish() }
    })
  }

  async action(action: AccountAction): Promise<void> {
    if (this.closed) throw new Error('CodeArts plugin is stopping')
    switch (action.action) {
      case 'save': await this.accounts.save(action); break
      case 'select': await this.accounts.select(action.id); break
      case 'remove': await this.accounts.remove(action.id); break
      case 'refresh': {
        await this.sync()
        await this.refresh(true, action.accountId)
        return
      }
    }
    await this.sync()
    await this.refresh()
  }

  async status(actionToken: string): Promise<CodeArtsStatus> {
    await this.sync()
    return {
      accounts: publicAccounts(this.state), activeId: this.state.activeId,
      catalog: this.currentCatalog, actionToken,
    }
  }

  close(): void {
    this.closed = true
    this.controller.abort(new Error('CodeArts plugin stopped'))
    this.listeners.clear()
    this.catalogs.clear()
    this.state = { version: 1, accounts: [], activeId: null }
    this.currentSnapshot = { account: undefined, models: [] }
  }
}
