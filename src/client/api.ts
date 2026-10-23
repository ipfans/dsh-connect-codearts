import { object } from '../json.ts'
import { ACTION_PATH, STATUS_PATH, type AccountAction, type CodeArtsStatus } from '../types.ts'

export function isStatus(value: unknown): value is CodeArtsStatus {
  const row = object(value)
  const catalog = object(row?.['catalog'])
  return !!row && typeof row['actionToken'] === 'string'
    && (row['activeId'] === null || typeof row['activeId'] === 'string')
    && Array.isArray(row['accounts']) && row['accounts'].every(a => {
      const account = object(a)
      return account && typeof account['id'] === 'string' && typeof account['label'] === 'string' && typeof account['akHint'] === 'string'
    })
    && !!object(row['benefit']) && ['agent', 'benefit'].every(channel => {
      const state = object(catalog?.[channel])
      return state && Array.isArray(state['models']) && Array.isArray(state['issues'])
    })
}

async function result(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(typeof object(body)?.['error'] === 'string' ? String(object(body)?.['error']) : `HTTP ${response.status}`)
  return body
}

export async function readStatus(signal?: AbortSignal): Promise<CodeArtsStatus> {
  const body = await result(await fetch(STATUS_PATH, { credentials: 'same-origin', cache: 'no-store', ...(signal ? { signal } : {}) }))
  if (!isStatus(body)) throw new Error('CodeArts status response is invalid')
  return body
}

export async function sendAction(action: AccountAction, token: string, signal?: AbortSignal): Promise<void> {
  await result(await fetch(ACTION_PATH, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-codearts-action-token': token },
    body: JSON.stringify(action), ...(signal ? { signal } : {}),
  }))
}
