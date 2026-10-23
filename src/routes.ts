import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { object, text } from './json.ts'
import type { CodeArtsRuntime } from './runtime.ts'
import { ACTION_PATH, STATUS_PATH, type AccountAction } from './types.ts'
import { CodeArtsError } from './upstream.ts'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function trustedRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const host = req.headers.host
  if (!host) return false
  try {
    const url = new URL(`http://${host}`)
    if (!LOOPBACK.has(url.hostname) || url.username || url.password || url.pathname !== '/' || url.host.toLowerCase() !== host.trim().toLowerCase()) return false
    const origin = req.headers.origin
    if (origin !== undefined) {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname)) return false
      if (parsed.host.toLowerCase() !== url.host.toLowerCase()) return false
    }
    return true
  } catch { return false }
}

export function parseAction(value: unknown): AccountAction {
  const row = object(value)
  if (!row) throw new CodeArtsError('Invalid action', 400)
  const action = row['action']
  if (action === 'rename') {
    const label = text(row['label'])
    if (!label || label.length > 100) throw new CodeArtsError('Account name must contain 1–100 characters', 400)
    if (!text(row['id']) || String(row['id']).length > 256) throw new CodeArtsError('Invalid account ID', 400)
    return { action, label, id: String(row['id']) }
  }
  if ((action === 'remove' || action === 'select') && text(row['id']) && String(row['id']).length <= 256) return { action, id: String(row['id']) }
  if ((action === 'refresh' || action === 'claim') && text(row['accountId']) && String(row['accountId']).length <= 256) return { action, accountId: String(row['accountId']) }
  if (action === 'login' && (row['accountId'] === undefined || (text(row['accountId']) && String(row['accountId']).length <= 256))) return { action, ...(row['accountId'] === undefined ? {} : { accountId: String(row['accountId']) }) }
  if (action === 'cancel-login') return { action }
  if (action === 'auto-claim' && typeof row['enabled'] === 'boolean') return { action, enabled: row['enabled'] }
  throw new CodeArtsError('Invalid action', 400)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024) { reject(new CodeArtsError('Request body too large', 413)); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new CodeArtsError('Invalid JSON body', 400)) }
    })
    req.on('error', () => reject(new CodeArtsError('Request body could not be read', 400)))
  })
}

export function createRoutes(runtime: CodeArtsRuntime) {
  const token = randomBytes(32).toString('base64url')
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (!trustedRequest(req)) { json(res, 403, { error: 'Request origin is not allowed' }); return }
      const path = (req.url ?? '').split('?')[0]
      if (path === STATUS_PATH && req.method === 'GET') { json(res, 200, await runtime.status(token)); return }
      if (path !== ACTION_PATH) { json(res, 404, { error: 'Unknown CodeArts route' }); return }
      if (req.method !== 'POST') { json(res, 405, { error: 'POST is required' }); return }
      if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { json(res, 415, { error: 'application/json is required' }); return }
      const provided = req.headers['x-codearts-action-token']
      if (typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) { json(res, 403, { error: 'Invalid action token; reload this page' }); return }
      await runtime.action(parseAction(await readBody(req)))
      json(res, 200, { ok: true })
    } catch (error) {
      json(res, error instanceof CodeArtsError ? error.status : 400, { error: error instanceof Error ? error.message : 'CodeArts operation failed' })
    }
  }
  return { token, handler }
}
