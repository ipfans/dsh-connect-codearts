export const PROVIDER_ID = 'codearts'
export const ENTRY_ID = 'llm-codearts'
export const STATUS_PATH = '/api/codearts/status'
export const ACTION_PATH = '/api/codearts/action'

export interface CodeArtsModel {
  id: string
  upstreamId: string
  name: string
  contextWindow: number
  maxTokens: number
  supportsImages: boolean
  creditRates?: number[]
}

export interface CatalogState {
  models: CodeArtsModel[]
  issues: string[]
  error?: string
  fetchedAt?: number
}

export interface PublicAccount {
  id: string
  label: string
  authState: 'ready' | 'legacy' | 'login-required'
  userName?: string
  expiresAt?: number
  benefits: BenefitsState
}

export interface CreditAmount {
  total?: number
  used?: number
  remaining?: number
  expiring?: number
}

export interface Subscription extends CreditAmount {
  name?: string
  nameEn?: string
  status?: string
  periodEnd?: string
  isCreditPackage?: boolean
  packages: (CreditAmount & { kind: 'basic' | 'ondemand' | 'bonus' })[]
}

export interface ClaimResult {
  campaignId: number
  title: string
  status: string
  ok: boolean
  credits?: number
  message: string
}

export interface BenefitsState {
  subscription?: Subscription
  fetchedAt?: number
  error?: string
  claims?: ClaimResult[]
  checkedAt?: number
  claimError?: string
}

export interface LoginState {
  state: 'idle' | 'pending' | 'complete' | 'error'
  accountId?: string
  authUrl?: string
  expiresAt?: number
  error?: string
}

export interface CodeArtsStatus {
  accounts: PublicAccount[]
  activeId: string | null
  catalog: CatalogState
  actionToken: string
  autoClaim: boolean
  login: LoginState
}

export type AccountAction =
  | { action: 'rename'; id: string; label: string }
  | { action: 'select' | 'remove'; id: string }
  | { action: 'refresh' | 'claim'; accountId: string }
  | { action: 'login'; accountId?: string }
  | { action: 'cancel-login' }
  | { action: 'auto-claim'; enabled: boolean }
