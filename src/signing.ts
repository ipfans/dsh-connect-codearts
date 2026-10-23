import { createHash, createHmac } from 'node:crypto'
import type { Account } from './accounts.ts'

export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function signRequest(
  account: Pick<Account, 'ak' | 'sk'>,
  method: string,
  url: URL,
  body: Uint8Array,
  extra: Record<string, string> = {},
  now = new Date(),
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(extra)) headers[key.toLowerCase()] = value.trim()
  headers['host'] = url.host
  headers['content-type'] = 'application/json'
  headers['x-sdk-date'] = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const names = Object.keys(headers).sort()
  const path = url.pathname.split('/').map(part => uriEncode(decodeURIComponent(part))).join('/')
  const canonicalUri = path.endsWith('/') ? path : `${path}/`
  const params = [...url.searchParams].map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
  const query = params.map(([k, v]) => `${k}=${v}`).join('&')
  const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
  const canonical = [method.toUpperCase(), canonicalUri, query, names.map(k => `${k}:${headers[k]}\n`).join(''), names.join(';'), hash(body)].join('\n')
  const toSign = `SDK-HMAC-SHA256\n${headers['x-sdk-date']}\n${hash(canonical)}`
  const signature = createHmac('sha256', account.sk).update(toSign).digest('hex')
  headers['authorization'] = `SDK-HMAC-SHA256 Access=${account.ak}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  return headers
}
