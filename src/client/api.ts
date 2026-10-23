import { object } from '../json.ts'
import { ACTION_PATH, STATUS_PATH, type AccountAction, type CodeArtsStatus } from '../types.ts'

export function isStatus(value: unknown): value is CodeArtsStatus {
  const row = object(value)
  const catalog = object(row?.['catalog'])
  const login = object(row?.['login'])
  const authUrl = login?.['authUrl']
  if (authUrl !== undefined) {
    try { const url = new URL(String(authUrl)); if (url.origin !== 'https://codearts.huaweicloud.com' || url.pathname !== '/portal/authorize' || url.username || url.password) return false } catch { return false }
  }
  return !!row && typeof row['actionToken'] === 'string'
    && typeof row['autoClaim'] === 'boolean'
    && !!login && ['idle', 'pending', 'complete', 'error'].includes(String(login['state']))
    && (row['activeId'] === null || typeof row['activeId'] === 'string')
    && Array.isArray(row['accounts']) && row['accounts'].every(a => {
      const account = object(a)
      return account && typeof account['id'] === 'string' && typeof account['label'] === 'string'
        && ['ready', 'legacy', 'login-required'].includes(String(account['authState'])) && !!object(account['benefits'])
    })
    && !!catalog && Array.isArray(catalog['models']) && Array.isArray(catalog['issues'])
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
