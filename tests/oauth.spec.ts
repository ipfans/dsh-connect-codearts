import { createHash, createPublicKey, verify } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dpopProof, LoginRequiredError, OAuthClient, OAuthLogin, TOKEN_URL, validPrivateKey } from '../src/oauth.ts'
import { accountA, deferred } from './helpers.ts'

function tokenResponse() {
  return { user_id: accountA.oauth.userId, user_name: accountA.oauth.userName, domain_id: accountA.oauth.domainId, refresh_token: 'new-refresh-token', credentials: { access_key_id: 'new-access-key', secret_access_key: 'new-secret-key', security_token: 'new-security-token', expiration: '2099-01-01T00:00:00Z' } }
}

describe('OAuth token protocol', () => {
  it('creates verifiable ES256 proofs without exposing the private key', () => {
    const proof = dpopProof(accountA.oauth.privateKey, 1_700_000_000_000)
    const [header, payload, signature] = proof.split('.')
    const parsed = JSON.parse(Buffer.from(header!, 'base64url').toString())
    expect(parsed).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256' } })
    expect(parsed.jwk.d).toBeUndefined()
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({ htm: 'POST', htu: TOKEN_URL, iat: 1_700_000_000 })
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), { key: createPublicKey({ key: parsed.jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))).toBe(true)
    expect(proof).not.toBe(dpopProof(accountA.oauth.privateKey, 1_700_000_000_000))
    expect(validPrivateKey({ ...accountA.oauth.privateKey, d: 'A'.repeat(43) })).toBe(false)
  })

  it('uses the authorization code and preserves the DPoP/client binding on rotation', async () => {
    const bodies: URLSearchParams[] = []
    const proofs: Record<string, unknown>[] = []
    const client = new OAuthClient(async (url, init) => {
      expect(url).toBe(TOKEN_URL)
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded')
      bodies.push(new URLSearchParams(String(init?.body)))
      proofs.push(JSON.parse(Buffer.from(new Headers(init?.headers).get('dpop')!.split('.')[0]!, 'base64url').toString()))
      return Response.json(tokenResponse())
    })
    const initial = await client.exchange('authorization-code', 'pkce-verifier', 12345, accountA.oauth.privateKey)
    expect(bodies[0]?.get('redirect_uri')).toBe('http://127.0.0.1:12345/oauth/callback')
    expect(bodies[0]?.get('code_verifier')).toBe('pkce-verifier')
    expect(initial.oauth.privateKey).toEqual(accountA.oauth.privateKey)
    const rotated = await client.refresh({ ...initial, oauth: { ...initial.oauth, clientId: 'original-client-id' } })
    expect(bodies[1]?.get('client_id')).toBe('original-client-id')
    expect(bodies[1]?.get('refresh_token')).toBe('new-refresh-token')
    expect(proofs[0]?.['jwk']).toEqual(proofs[1]?.['jwk'])
    expect(rotated.oauth.loginId).toBe(initial.oauth.loginId)
  })

  it('rejects missing renewable credentials and handles business errors without leaking tokens', async () => {
    const client = new OAuthClient(async () => Response.json({ ...tokenResponse(), refresh_token: '' }))
    await expect(client.exchange('code', 'verifier', 1, accountA.oauth.privateKey)).rejects.toThrow('incomplete')
    const rejected = new OAuthClient(async () => Response.json({ error: 'invalid_grant', error_msg: accountA.oauth.refreshToken }))
    await expect(rejected.refresh(accountA)).rejects.toBeInstanceOf(LoginRequiredError)
    const temporary = new OAuthClient(async () => Response.json({ error_msg: accountA.sk }, { status: 503 }))
    await expect(temporary.refresh(accountA)).rejects.toThrow('HTTP 503')
    await expect(temporary.refresh(accountA)).rejects.not.toThrow(accountA.sk)
  })

  it('looks up missing token identity using signed STS credentials', async () => {
    const calls: string[] = []
    const client = new OAuthClient(async (input, init) => {
      const url = String(input); calls.push(url)
      if (url === TOKEN_URL) {
        const { user_id: _user, user_name: _name, domain_id: _domain, ...tokens } = tokenResponse()
        return Response.json(tokens)
      }
      expect(url).toBe('https://sts.cn-north-4.myhuaweicloud.com/v5/caller-identity')
      expect(new Headers(init?.headers).get('x-security-token')).toBe('new-security-token')
      expect(new Headers(init?.headers).get('authorization')).toContain('SDK-HMAC-SHA256')
      return Response.json({ principal_id: 'user-id', account_id: 'domain-id', principal_urn: 'iam::domain-id:user:Alice' })
    })
    const credentials = await client.exchange('code', 'verifier', 1234, accountA.oauth.privateKey)
    expect(credentials.oauth).toMatchObject({ userId: 'user-id', domainId: 'domain-id', userName: 'Alice' })
    expect(calls).toHaveLength(2)
  })
})

describe('local OAuth callback', () => {
  let login: OAuthLogin | undefined
  afterEach(() => { login?.cancel(); login = undefined })

  function callback() {
    const authorization = new URL(login!.status().authUrl!)
    return { authorization, url: `http://127.0.0.1:${authorization.searchParams.get('port')}/oauth/callback` }
  }

  it('completes both portal stages, validates the ticket, and binds the PKCE verifier', async () => {
    const client = new OAuthClient()
    const exchange = vi.spyOn(client, 'exchange').mockResolvedValue(accountA)
    const save = vi.fn(async () => {})
    login = new OAuthLogin(client, save)
    await login.start('target-account')
    await expect(login.start()).rejects.toThrow('cancel')
    const { authorization, url } = callback()
    const next = new URL('https://codearts.huaweicloud.com/portal/continue')
    next.searchParams.set('ticket_id', authorization.searchParams.get('ticket_id')!)
    const first = await fetch(`${url}?${new URLSearchParams({ secret: 'portal-secret', redirect: next.href })}`, { redirect: 'manual' })
    expect(first.status).toBe(307)
    expect(first.headers.get('location')).toBe(next.href)
    const final = await fetch(`${url}?code=valid-code`)
    expect(final.status).toBe(200)
    expect(await final.text()).toContain('login completed')
    await vi.waitFor(() => expect(login!.status()).toEqual({ state: 'complete' }))
    const [, verifier, port, key] = exchange.mock.calls[0]!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'))
    expect(authorization.searchParams.get('code_challenge_method')).toBe('SHA-256')
    expect(port).toBe(Number(authorization.searchParams.get('port')))
    expect(validPrivateKey(key)).toBe(true)
    expect(save).toHaveBeenCalledWith(accountA, 'target-account', expect.any(AbortSignal))
  })

  it('rejects foreign redirects, wrong tickets and origins without saving credentials', async () => {
    const save = vi.fn(async () => {})
    login = new OAuthLogin(new OAuthClient(), save)
    await login.start()
    const { url } = callback()
    expect((await fetch(`${url}?secret=foo&redirect=${encodeURIComponent('https://evil.example/?ticket_id=foo')}`, { redirect: 'manual' })).status).toBe(403)
    expect((await fetch(`${url}?code=code&ticket_id=wrong`)).status).toBe(403)
    expect((await fetch(`${url}?code=code`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect(save).not.toHaveBeenCalled()
  })

  it('supports a code-only callback and ignores an exchange that completes after cancellation', async () => {
    const client = new OAuthClient()
    const pending = deferred<typeof accountA>()
    const exchange = vi.spyOn(client, 'exchange').mockImplementation(() => pending.promise)
    const save = vi.fn(async () => {})
    login = new OAuthLogin(client, save)
    await login.start()
    const request = fetch(`${callback().url}?code=code`).catch(() => undefined)
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledOnce())
    login.cancel()
    pending.resolve(accountA)
    await request
    expect(save).not.toHaveBeenCalled()
    expect(login.status()).toEqual({ state: 'idle' })
  })

  it('expires sessions and never sends a pending ticket to the token endpoint', async () => {
    let now = 0
    const fetcher = vi.fn<typeof fetch>()
    login = new OAuthLogin(new OAuthClient(fetcher), vi.fn(), () => now)
    await login.start()
    const { url } = callback()
    now = 900_001
    expect((await fetch(`${url}?code=code`)).status).toBe(410)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
