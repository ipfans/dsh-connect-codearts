import { randomUUID } from 'node:crypto'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { object, text } from './json.ts'
import { LoginRequiredError, OAuthError, validPrivateKey, type OAuthCredentials, type OAuthGrant } from './oauth.ts'
import type { PublicAccount } from './types.ts'

export const ACCOUNTS_KEY = credentialKey('dsh-connect-codearts', 'accounts')

export interface Account {
  id: string
  label: string
  ak: string
  sk: string
  oauth?: OAuthGrant
}

export interface AccountState {
  version: 2
  accounts: Account[]
  activeId: string | null
  autoClaim: boolean
}

export type AccountCredentials = Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>
export const emptyAccounts = (): AccountState => ({ version: 2, accounts: [], activeId: null, autoClaim: true })
export const accountIdentity = (account: Account): string => `${account.id}:${account.oauth?.loginId ?? 'legacy'}`

class AccountDataError extends Error {}

function parseState(record: unknown): AccountState {
  if (record === undefined) return emptyAccounts()
  const wrapped = object(record)
  const payload = object(wrapped?.['payload'])
  if (wrapped?.['kind'] !== 'grant' || ![1, 2].includes(Number(payload?.['version'])) || !Array.isArray(payload?.['accounts'])) {
    throw new AccountDataError('CodeArts credential record is invalid; existing data was preserved')
  }
  const accounts: Account[] = []
  for (const value of payload['accounts']) {
    const row = object(value)
    if (!row || !['id', 'label', 'ak', 'sk'].every(key => text(row[key]))) throw new AccountDataError('CodeArts credential record contains an invalid account')
    let oauth: OAuthGrant | undefined
    if (payload['version'] === 2 && row['oauth'] !== undefined) {
      const grant = object(row['oauth'])
      if (!grant || !['loginId', 'userId', 'domainId', 'userName', 'securityToken', 'refreshToken', 'clientId', 'verifier'].every(key => text(grant[key]))
        || typeof grant['expiresAt'] !== 'number' || !Number.isFinite(grant['expiresAt']) || grant['expiresAt'] <= 0
        || !validPrivateKey(grant['privateKey']) || (grant['needsLogin'] !== undefined && typeof grant['needsLogin'] !== 'boolean')) throw new AccountDataError('CodeArts credential record contains invalid OAuth credentials')
      oauth = {
        loginId: String(grant['loginId']), userId: String(grant['userId']), domainId: String(grant['domainId']), userName: String(grant['userName']),
        securityToken: String(grant['securityToken']), refreshToken: String(grant['refreshToken']), clientId: String(grant['clientId']), verifier: String(grant['verifier']),
        expiresAt: grant['expiresAt'], privateKey: grant['privateKey'], ...(grant['needsLogin'] === true ? { needsLogin: true } : {}),
      }
    }
    accounts.push({ id: String(row['id']), label: String(row['label']), ak: String(row['ak']), sk: String(row['sk']), ...(oauth ? { oauth } : {}) })
  }
  if (new Set(accounts.map(a => a.id)).size !== accounts.length) throw new AccountDataError('CodeArts credential record contains duplicate accounts')
  const activeId = payload['activeId']
  if (activeId !== null && (typeof activeId !== 'string' || !accounts.some(a => a.id === activeId))) throw new AccountDataError('CodeArts credential record has an invalid selected account')
  if (payload['version'] === 2 && typeof payload['autoClaim'] !== 'boolean') throw new AccountDataError('CodeArts credential record contains invalid preferences')
  return { version: 2, accounts, activeId, autoClaim: payload['version'] === 1 ? true : payload['autoClaim'] === true }
}

export function publicAccounts(state: AccountState): PublicAccount[] {
  return state.accounts.map(({ id, label, oauth }) => ({
    id, label, authState: !oauth ? 'legacy' : oauth.needsLogin ? 'login-required' : 'ready', benefits: {},
    ...(oauth ? { userName: oauth.userName, expiresAt: oauth.expiresAt } : {}),
  }))
}

export class Accounts {
  private readonly refreshing = new Map<string, Promise<Account>>()
  private readonly unsaved = new Map<string, OAuthCredentials>()

  constructor(private readonly credentials: AccountCredentials, private readonly now = Date.now) {}

  async read(): Promise<AccountState> {
    try { return parseState(await this.credentials.readRecord(ACCOUNTS_KEY)) }
    catch (error) {
      if (error instanceof AccountDataError) throw error
      throw new Error('CodeArts credential storage could not be read')
    }
  }

  private async change(mutate: (state: AccountState) => void | boolean | Promise<void | boolean>): Promise<void> {
    try {
      await this.credentials.modifyRecord(ACCOUNTS_KEY, async current => {
        const state = parseState(current)
        if (await mutate(state) === false) return undefined
        return { kind: 'grant', payload: JSON.parse(JSON.stringify(state)) }
      })
    } catch (error) {
      if (error instanceof AccountDataError || error instanceof OAuthError) throw error
      throw new Error('CodeArts credential storage could not be updated')
    }
  }

  async login(credentials: OAuthCredentials, id?: string, signal?: AbortSignal): Promise<void> {
    await this.change(state => {
      if (signal?.aborted) throw new OAuthError('CodeArts login was cancelled')
      const sameUser = state.accounts.find(a => a.oauth?.userId === credentials.oauth.userId && a.oauth.domainId === credentials.oauth.domainId)
      const previous = id === undefined ? sameUser : state.accounts.find(a => a.id === id)
      if (id !== undefined && !previous) throw new AccountDataError('Account no longer exists')
      if (sameUser && previous && sameUser.id !== previous.id) throw new AccountDataError('This Huawei account is already saved; sign in from its existing entry')
      if (previous?.oauth && (previous.oauth.userId !== credentials.oauth.userId || previous.oauth.domainId !== credentials.oauth.domainId)) throw new AccountDataError('Sign in with the same Huawei account, or add a new account')
      const account: Account = { ...credentials, id: previous?.id ?? randomUUID(), label: previous?.label ?? credentials.oauth.userName }
      if (previous) state.accounts[state.accounts.indexOf(previous)] = account
      else state.accounts.push(account)
      if (!state.accounts.find(a => a.id === state.activeId)?.oauth) state.activeId = account.id
    })
  }

  async rename(id: string, value: string): Promise<void> {
    const label = value.trim()
    if (!label || label.length > 100) throw new AccountDataError('Account name must contain 1–100 characters')
    await this.change(state => { this.find(state, id).label = label })
  }

  async select(id: string): Promise<void> {
    await this.change(state => {
      const account = this.find(state, id)
      if (!account.oauth || account.oauth.needsLogin) throw new LoginRequiredError()
      state.activeId = id
    })
  }

  async remove(id: string): Promise<void> {
    await this.change(state => {
      this.find(state, id)
      state.accounts = state.accounts.filter(a => a.id !== id)
      if (state.activeId === id) state.activeId = null
    })
    for (const key of this.unsaved.keys()) if (key.startsWith(`${id}:`)) this.unsaved.delete(key)
  }

  async setAutoClaim(enabled: boolean): Promise<void> { await this.change(state => { state.autoClaim = enabled }) }

  private find(state: AccountState, id: string): Account {
    const account = state.accounts.find(a => a.id === id)
    if (!account) throw new AccountDataError('Account no longer exists')
    return account
  }

  async authorize(expected: Account, refresh: (credentials: OAuthCredentials) => Promise<OAuthCredentials>): Promise<Account> {
    const key = accountIdentity(expected)
    const check = (state: AccountState): Account & OAuthCredentials => {
      const current = this.find(state, expected.id)
      if (accountIdentity(current) !== key) throw new AccountDataError('Account authorization changed; retry the request')
      if (!current.oauth || current.oauth.needsLogin) throw new LoginRequiredError()
      return current as Account & OAuthCredentials
    }
    const current = check(await this.read())
    if (!this.unsaved.has(key) && current.oauth.expiresAt - this.now() > 600_000) return current
    const running = this.refreshing.get(key)
    if (running) return running
    const run = (async () => {
      let result: Account | undefined
      let failure: LoginRequiredError | undefined
      // The provider's write lock spans the exchange: refresh tokens are single-use across processes.
      await this.change(async state => {
        const account = check(state)
        const pending = this.unsaved.get(key)
        if (!pending && account.oauth.expiresAt - this.now() > 600_000) { result = account; return false }
        let renewed: OAuthCredentials
        try { renewed = pending ?? await refresh(account) }
        catch (error) {
          if (!(error instanceof LoginRequiredError)) throw error
          account.oauth.needsLogin = true; failure = error; return
        }
        this.unsaved.set(key, renewed)
        result = { ...account, ...renewed }
        state.accounts[state.accounts.indexOf(account)] = result
      })
      this.unsaved.delete(key)
      if (failure) throw failure
      return result!
    })().finally(() => { this.refreshing.delete(key) })
    this.refreshing.set(key, run)
    return run
  }
}
