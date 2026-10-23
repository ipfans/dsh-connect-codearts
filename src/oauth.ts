import { createECDH, createHash, createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign, type JsonWebKey } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { object, text } from './json.ts'
import { signRequest } from './signing.ts'
import type { LoginState } from './types.ts'

export const TOKEN_URL = 'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens'
export const PORTAL_URL = 'https://codearts.huaweicloud.com/portal/authorize'
const CLIENT_ID = 'codearts-agent'
const LOGIN_TTL = 15 * 60_000

export interface OAuthGrant {
  loginId: string
  userId: string
  domainId: string
  userName: string
  securityToken: string
  expiresAt: number
  refreshToken: string
  clientId: string
  verifier: string
  privateKey: JsonWebKey
  needsLogin?: boolean
}

export interface OAuthCredentials { ak: string; sk: string; oauth: OAuthGrant }

export class OAuthError extends Error {}
export class LoginRequiredError extends OAuthError {
  constructor() { super('CodeArts authorization expired or was rejected; sign in again') }
}

export function validPrivateKey(value: unknown): value is JsonWebKey {
  const key = object(value)
  if (key?.['kty'] !== 'EC' || key['crv'] !== 'P-256') return false
  if (!['x', 'y', 'd'].every(field => typeof key[field] === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(key[field]))) return false
  try {
    const pair = createECDH('prime256v1')
    pair.setPrivateKey(Buffer.from(String(key['d']), 'base64url'))
    const publicKey = pair.getPublicKey()
    return publicKey.subarray(1, 33).toString('base64url') === key['x'] && publicKey.subarray(33).toString('base64url') === key['y']
  } catch { return false }
}

export function dpopProof(privateKey: JsonWebKey, now = Date.now()): string {
  if (!validPrivateKey(privateKey)) throw new OAuthError('Invalid saved OAuth proof key; sign in again')
  const { kty, crv, x, y } = privateKey
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode({ alg: 'ES256', typ: 'dpop+jwt', jwk: { kty, crv, x, y } })}.${encode({ htm: 'POST', htu: TOKEN_URL, iat: Math.floor(now / 1000), jti: randomUUID() })}`
  const signature = sign('sha256', Buffer.from(input), { key: createPrivateKey({ key: privateKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' })
  const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  const s = BigInt(`0x${signature.subarray(32).toString('hex')}`)
  if (s > order / 2n) Buffer.from((order - s).toString(16).padStart(64, '0'), 'hex').copy(signature, 32)
  return `${input}.${signature.toString('base64url')}`
}

function tokenString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_768 && /^[\x21-\x7e]+$/u.test(value)
}

export class OAuthClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch, private readonly now = Date.now) {}

  async exchange(code: string, verifier: string, port: number, privateKey: JsonWebKey, signal?: AbortSignal): Promise<OAuthCredentials> {
    return this.tokens(new URLSearchParams({ client_id: CLIENT_ID, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${port}/oauth/callback` }),
      { clientId: CLIENT_ID, verifier, privateKey, loginId: randomUUID() }, signal)
  }

  async refresh(credentials: OAuthCredentials, signal?: AbortSignal): Promise<OAuthCredentials> {
    const grant = credentials.oauth
    return this.tokens(new URLSearchParams({ client_id: grant.clientId, code_verifier: grant.verifier, grant_type: 'refresh_token', refresh_token: grant.refreshToken }), grant, signal)
  }

  private async tokens(form: URLSearchParams, binding: Pick<OAuthGrant, 'clientId' | 'verifier' | 'privateKey' | 'loginId'> & Partial<OAuthGrant>, signal?: AbortSignal): Promise<OAuthCredentials> {
    let response: Response
    try {
      response = await this.fetcher(TOKEN_URL, { method: 'POST', redirect: 'error', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', dpop: dpopProof(binding.privateKey, this.now()) }, signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) })
    } catch {
      throw new OAuthError(signal?.aborted ? 'CodeArts authorization was cancelled' : 'CodeArts token request failed; check connectivity and retry')
    }
    const data = object(await response.json().catch(() => undefined))
    const errorCode = data?.['error_code']
    if (!response.ok || data?.['error'] || (errorCode != null && !['0', '0000'].includes(String(errorCode)))) {
      const reason = [data?.['error'], errorCode, data?.['error_msg']].join(' ')
      if (form.get('grant_type') === 'refresh_token' && /invalid_grant|ExpiredRefreshToken|InvalidDPoPHeader|invalid client id|has been used|refresh.token.*expired/iu.test(reason)) throw new LoginRequiredError()
      throw new OAuthError(`CodeArts token exchange failed (HTTP ${response.status}); retry authorization`)
    }
    const credentials = object(data?.['credentials'])
    const ak = credentials?.['access_key_id'], sk = credentials?.['secret_access_key'], securityToken = credentials?.['security_token']
    const refreshToken = data?.['refresh_token']
    const expiresAt = Date.parse(String(credentials?.['expiration'] ?? ''))
    let userId = text(data?.['user_id']) ?? binding.userId
    let domainId = text(data?.['domain_id']) ?? binding.domainId
    let userName = text(data?.['user_name']) ?? binding.userName
    if (!tokenString(ak) || !tokenString(sk) || !tokenString(securityToken) || !tokenString(refreshToken) || !Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new OAuthError('CodeArts returned incomplete OAuth credentials; sign in again')
    if (!userId || !domainId) ({ userId, domainId, userName } = await this.identity(ak, sk, securityToken, signal))
    userName ??= userId
    if ((binding.userId && binding.userId !== userId) || (binding.domainId && binding.domainId !== domainId)) throw new OAuthError('CodeArts token renewal returned a different account; sign in again')
    return { ak, sk, oauth: { loginId: binding.loginId, clientId: binding.clientId, verifier: binding.verifier, privateKey: binding.privateKey, userId, domainId, userName, securityToken, refreshToken, expiresAt } }
  }

  private async identity(ak: string, sk: string, securityToken: string, signal?: AbortSignal): Promise<{ userId: string; domainId: string; userName: string }> {
    for (const target of ['https://sts.cn-north-4.myhuaweicloud.com/v5/caller-identity', 'https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/current/user']) {
      try {
        const url = new URL(target)
        const headers = signRequest({ ak, sk }, 'GET', url, new Uint8Array(), { 'x-security-token': securityToken, 'x-language': 'zh-cn' })
        const response = await this.fetcher(url, { headers, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) })
        const data = object(await response.json())
        const userId = text(data?.['principal_id']) ?? text(data?.['user_id'])
        const domainId = text(data?.['account_id']) ?? text(data?.['domain_id'])
        if (response.ok && userId && domainId) {
          const urn = text(data?.['principal_urn'])
          return { userId, domainId, userName: text(data?.['user_name']) ?? (urn?.includes(':user:') ? urn.split(':user:')[1]! : userId) }
        }
      } catch { if (signal?.aborted) break }
    }
    throw new OAuthError('CodeArts could not verify the signed-in account identity; sign in again')
  }
}

interface LoginSession {
  server: Server
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  port: number
  ticket: string
  secret?: string
  verifier: string
  privateKey: JsonWebKey
  exchanging: boolean
  accountId?: string
}

export class OAuthLogin {
  private session: LoginSession | undefined
  private state: LoginState = { state: 'idle' }
  private starting = false

  constructor(private readonly client: OAuthClient, private readonly save: (credentials: OAuthCredentials, accountId: string | undefined, signal: AbortSignal) => Promise<void>, private readonly now = Date.now) {}

  status(): LoginState { return { ...this.state } }

  async start(accountId?: string): Promise<void> {
    if (this.session || this.starting) throw new OAuthError('Finish or cancel the current login first')
    this.starting = true
    const verifier = randomBytes(64).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const session: LoginSession = {
      server: createServer((req, res) => { void this.callback(session, req, res) }),
      controller: new AbortController(), port: 0, ticket: randomBytes(16).toString('hex'), verifier,
      privateKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' }),
      exchanging: false, ...(accountId === undefined ? {} : { accountId }),
    }
    this.session = session
    try {
      await new Promise<void>((resolve, reject) => { session.server.once('error', reject); session.server.listen(0, '127.0.0.1', resolve) })
      if (this.session !== session) { session.server.close(); return }
      const address = session.server.address()
      if (!address || typeof address === 'string') throw new OAuthError('Could not start the local OAuth callback')
      session.port = address.port
      const url = new URL(PORTAL_URL)
      url.search = new URLSearchParams({ theme: '2', locale: 'zh-cn', uri_scheme: CLIENT_ID, client_id: CLIENT_ID, port: String(session.port), code_challenge: challenge, code_challenge_method: 'SHA-256', ticket_id: session.ticket, 'plugin-name': 'snap_AIIDE', 'plugin-version': '5.2.0' }).toString()
      this.state = { state: 'pending', authUrl: url.href, expiresAt: this.now() + LOGIN_TTL, ...(accountId === undefined ? {} : { accountId }) }
      session.server.unref()
      session.timer = setTimeout(() => { this.finish(session, { state: 'error', error: 'CodeArts login expired; start again' }) }, LOGIN_TTL)
      session.timer.unref()
    } catch {
      this.finish(session, { state: 'error', error: 'Could not start the local OAuth callback; retry login' })
      throw new OAuthError('Could not start the local OAuth callback; retry login')
    } finally { this.starting = false }
  }

  cancel(): void {
    if (this.session) this.finish(this.session, { state: 'idle' })
    else this.state = { state: 'idle' }
  }

  private finish(session: LoginSession, state: LoginState): void {
    if (this.session !== session) return
    this.state = state
    this.session = undefined
    clearTimeout(session.timer)
    session.controller.abort()
    session.server.close()
    session.server.closeAllConnections()
  }

  private async callback(session: LoginSession, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, message: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'", 'x-content-type-options': 'nosniff' })
      res.end(message)
    }
    try {
      if (this.session !== session || this.now() >= (this.state.expiresAt ?? 0)) { reply(410, 'Login expired.'); return }
      if (req.headers.host !== `127.0.0.1:${session.port}` || req.socket.remoteAddress !== '127.0.0.1') { reply(403, 'Invalid callback host.'); return }
      if (req.headers.origin && req.headers.origin !== new URL(PORTAL_URL).origin) { reply(403, 'Invalid callback origin.'); return }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${session.port}`)
      if (url.pathname !== '/oauth/callback') { reply(404, 'Unknown callback.'); return }
      if (req.method !== 'GET') { reply(405, 'GET is required.'); return }
      const ticket = url.searchParams.get('ticket_id')
      const secret = url.searchParams.get('secret')
      if ((ticket && ticket !== session.ticket) || (session.secret && secret && secret !== session.secret)) { reply(403, 'Callback does not match this login.'); return }
      const code = url.searchParams.get('code')
      if (!code) {
        const next = new URL(url.searchParams.get('redirect') ?? '')
        if (!secret || secret.length > 1024 || next.origin !== new URL(PORTAL_URL).origin || next.username || next.password || next.searchParams.get('ticket_id') !== session.ticket) { reply(403, 'Invalid authorization redirect.'); return }
        session.secret = secret
        res.writeHead(307, { location: next.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end()
        return
      }
      // Some portals return only code; the dedicated session port and PKCE bind it to this login.
      if (!tokenString(code) || session.exchanging) { reply(409, 'Authorization is already being processed.'); return }
      session.exchanging = true
      let credentials: OAuthCredentials
      try { credentials = await this.client.exchange(code, session.verifier, session.port, session.privateKey, session.controller.signal) }
      catch (error) {
        session.exchanging = false
        if (this.session === session) this.state = { ...this.state, error: error instanceof OAuthError ? error.message : 'CodeArts authorization failed; retry login' }
        reply(400, 'Authorization code was rejected. Return to CodeArts settings and retry login.'); return
      }
      if (this.session !== session) { reply(410, 'Login cancelled.'); return }
      await this.save(credentials, session.accountId, session.controller.signal)
      reply(200, 'CodeArts login completed. You can close this page and return to DeepSeek Harness. 登录完成，可以关闭此页面。')
      res.once('finish', () => { this.finish(session, { state: 'complete' }) })
    } catch {
      if (!res.headersSent) reply(400, 'Could not complete login. Return to CodeArts settings and retry.')
      if (session.exchanging) this.finish(session, { state: 'error', error: 'Could not save OAuth credentials; sign in again' })
    }
  }
}
