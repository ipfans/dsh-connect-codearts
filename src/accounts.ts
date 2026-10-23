import { randomUUID } from 'node:crypto'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { object, text } from './json.ts'
import type { PublicAccount } from './types.ts'

export const ACCOUNTS_KEY = credentialKey('dsh-connect-codearts', 'accounts')

export interface Account {
  id: string
  label: string
  ak: string
  sk: string
}

export interface AccountState {
  version: 1
  accounts: Account[]
  activeId: string | null
}

export type AccountCredentials = Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>

class AccountDataError extends Error {}

function parseState(record: unknown): AccountState {
  if (record === undefined) return { version: 1, accounts: [], activeId: null }
  const wrapped = object(record)
  const payload = object(wrapped?.['payload'])
  if (wrapped?.['kind'] !== 'grant' || payload?.['version'] !== 1 || !Array.isArray(payload['accounts'])) {
    throw new AccountDataError('CodeArts credential record is invalid; existing data was preserved')
  }
  const accounts: Account[] = []
  for (const value of payload['accounts']) {
    const row = object(value)
    if (!row || !text(row['id']) || !text(row['label']) || !text(row['ak']) || !text(row['sk'])) {
      throw new AccountDataError('CodeArts credential record contains an invalid account')
    }
    accounts.push({ id: String(row['id']), label: String(row['label']), ak: String(row['ak']), sk: String(row['sk']) })
  }
  if (new Set(accounts.map(a => a.id)).size !== accounts.length) throw new AccountDataError('CodeArts credential record contains duplicate accounts')
  const activeId = payload['activeId']
  if (activeId !== null && (typeof activeId !== 'string' || !accounts.some(a => a.id === activeId))) {
    throw new AccountDataError('CodeArts credential record has an invalid selected account')
  }
  return { version: 1, accounts, activeId }
}

function secret(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 1024 || /[^\x21-\x7e]/u.test(normalized)) throw new AccountDataError('AK/SK must be non-empty ASCII and contain no whitespace or control characters')
  return normalized
}

export function publicAccounts(state: AccountState): PublicAccount[] {
  return state.accounts.map(({ id, label, ak }) => ({ id, label, akHint: `••••${ak.slice(-4)}` }))
}

export class Accounts {
  constructor(private readonly credentials: AccountCredentials) {}

  async read(): Promise<AccountState> {
    try { return parseState(await this.credentials.readRecord(ACCOUNTS_KEY)) }
    catch (error) {
      if (error instanceof AccountDataError) throw error
      throw new Error('CodeArts credential storage could not be read')
    }
  }

  private async change(mutate: (state: AccountState) => void): Promise<void> {
    try {
      await this.credentials.modifyRecord(ACCOUNTS_KEY, async current => {
        const state = parseState(current)
        mutate(state)
        return { kind: 'grant', payload: { version: state.version, accounts: state.accounts.map(a => ({ ...a })), activeId: state.activeId } }
      })
    } catch (error) {
      if (error instanceof AccountDataError) throw error
      throw new Error('CodeArts credential storage could not be updated')
    }
  }

  async save(input: { id?: string; label: string; ak?: string; sk?: string }): Promise<void> {
    const label = input.label.trim()
    if (!label || label.length > 100) throw new AccountDataError('Account name must contain 1–100 characters')
    await this.change(state => {
      const previous = input.id === undefined ? undefined : state.accounts.find(a => a.id === input.id)
      if (input.id !== undefined && !previous) throw new AccountDataError('Account no longer exists')
      const ak = input.ak === undefined || input.ak === '' ? previous?.ak : secret(input.ak)
      const sk = input.sk === undefined || input.sk === '' ? previous?.sk : secret(input.sk)
      if (!ak || !sk) throw new AccountDataError('Both AK and SK are required for a new account')
      if (state.accounts.some(a => a.ak === ak && a.id !== previous?.id)) throw new AccountDataError('This AK is already saved; edit the existing account')
      const account = { id: previous?.id ?? randomUUID(), label, ak, sk }
      if (previous) state.accounts[state.accounts.indexOf(previous)] = account
      else {
        if (state.accounts.length === 0) state.activeId = account.id
        state.accounts.push(account)
      }
    })
  }

  async select(id: string): Promise<void> {
    await this.change(state => {
      if (!state.accounts.some(a => a.id === id)) throw new AccountDataError('Account no longer exists')
      state.activeId = id
    })
  }

  async remove(id: string): Promise<void> {
    await this.change(state => {
      if (!state.accounts.some(a => a.id === id)) throw new AccountDataError('Account no longer exists')
      state.accounts = state.accounts.filter(a => a.id !== id)
      if (state.activeId === id) state.activeId = null
    })
  }
}
