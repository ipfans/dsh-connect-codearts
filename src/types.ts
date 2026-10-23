export const PROVIDER_ID = 'codearts'
export const ENTRY_ID = 'llm-codearts'
export const STATUS_PATH = '/api/codearts/status'
export const ACTION_PATH = '/api/codearts/action'

export type Channel = 'agent' | 'benefit'

export interface CodeArtsModel {
  id: string
  upstreamId: string
  channel: Channel
  name: string
  contextWindow: number
  maxTokens: number
  supportsImages: boolean
}

export interface CatalogState {
  models: CodeArtsModel[]
  issues: string[]
  error?: string
  fetchedAt?: number
}

export interface BenefitState {
  total?: number
  balance?: number
  used?: number
  claimedAt?: number
  error?: string
}

export interface PublicAccount {
  id: string
  label: string
  akHint: string
}

export interface CodeArtsStatus {
  accounts: PublicAccount[]
  activeId: string | null
  catalog: Record<Channel, CatalogState>
  benefit: BenefitState
  actionToken: string
}

export type AccountAction =
  | { action: 'save'; id?: string; label: string; ak?: string; sk?: string }
  | { action: 'select' | 'remove'; id: string }
  | { action: 'refresh' | 'claim'; accountId: string }
