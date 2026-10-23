import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Accounts } from '../src/accounts.ts'
import { createRoutes, trustedRequest } from '../src/routes.ts'
import { CodeArtsRuntime } from '../src/runtime.ts'
import { ACTION_PATH, STATUS_PATH } from '../src/types.ts'
import { CodeArtsClient } from '../src/upstream.ts'
import { accountA, accountB, credentialStore } from './helpers.ts'

describe('host control routes', () => {
  let server: Server
  let runtime: CodeArtsRuntime
  let port: number
  let token: string
  beforeEach(async () => {
    const { store } = credentialStore([accountA, accountB])
    const client = new CodeArtsClient(async () => { throw new Error('Unexpected network') })
    vi.spyOn(client, 'models').mockResolvedValue({ models: [], issues: [] })
    runtime = new CodeArtsRuntime(new Accounts(store), client)
    await runtime.sync()
    const routes = createRoutes(runtime)
    token = routes.token
    server = createServer((req, res) => { void routes.handler(req, res) })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    port = (server.address() as AddressInfo).port
  })
  afterEach(async () => { runtime.close(); await new Promise<void>(resolve => server.close(() => resolve())) })

  function call(path: string, method = 'GET', body = '', headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: Record<string, unknown>; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method, headers: { host: `localhost:${port}`, ...headers } }, response => {
        let output = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { output += chunk })
        response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(output), headers: response.headers }))
      })
      req.on('error', reject)
      req.end(body)
    })
  }

  it('returns a no-store, credential-free status document', async () => {
    const result = await call(STATUS_PATH)
    expect(result.status).toBe(200)
    expect(result.body['actionToken']).toBe(token)
    expect(result.headers['cache-control']).toBe('no-store')
    const serialized = JSON.stringify(result.body)
    expect(serialized).not.toContain(accountA.ak)
    expect(serialized).not.toContain(accountA.sk)
    expect(serialized).not.toContain(accountB.sk)
  })

  it('rejects DNS rebinding, foreign origins and cross-port origins', async () => {
    expect((await call(STATUS_PATH, 'GET', '', { host: 'evil.example' })).status).toBe(403)
    expect((await call(STATUS_PATH, 'GET', '', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await call(STATUS_PATH, 'GET', '', { origin: 'http://localhost:1' })).status).toBe(403)
    expect(trustedRequest({ headers: { host: 'localhost#evil' } })).toBe(false)
  })

  it('requires JSON, a valid action token and bounded request bodies before mutation', async () => {
    const body = JSON.stringify({ action: 'remove', id: accountA.id })
    expect((await call(ACTION_PATH, 'POST', body)).status).toBe(415)
    expect((await call(ACTION_PATH, 'POST', body, { 'content-type': 'application/json' })).status).toBe(403)
    expect((await call(ACTION_PATH, 'POST', body, { 'content-type': 'application/json', 'x-codearts-action-token': 'wrong' })).status).toBe(403)
    const headers = { 'content-type': 'application/json', 'x-codearts-action-token': token }
    expect((await call(ACTION_PATH, 'POST', 'not JSON', headers)).status).toBe(400)
    expect((await call(ACTION_PATH, 'POST', JSON.stringify({ action: 'claim', accountId: accountA.id }), headers)).status).toBe(400)
    expect((await call(ACTION_PATH, 'POST', JSON.stringify({ action: 'save', label: 'a', sk: 'x'.repeat(20_000) }), headers)).status).toBe(413)
    expect((await runtime.status(token)).accounts).toHaveLength(2)
  })

  it('selects and deletes accounts only after an authorized explicit action', async () => {
    const headers = { 'content-type': 'application/json', 'x-codearts-action-token': token, origin: `http://localhost:${port}` }
    expect((await call(ACTION_PATH, 'POST', JSON.stringify({ action: 'select', id: accountB.id }), headers)).body).toEqual({ ok: true })
    expect((await runtime.status(token)).activeId).toBe(accountB.id)
    expect((await call(ACTION_PATH, 'POST', JSON.stringify({ action: 'remove', id: accountB.id }), headers)).status).toBe(200)
    expect((await runtime.status(token)).activeId).toBeNull()
    expect((await call(ACTION_PATH)).status).toBe(405)
  })
})
