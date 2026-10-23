import { describe, expect, it } from 'vitest'
import { signRequest, uriEncode } from '../src/signing.ts'
import { accountA } from './helpers.ts'

const now = new Date('2026-10-23T08:09:10Z')

describe('Huawei SDK-HMAC-SHA256 signing', () => {
  it('matches an independently generated Python reference vector for a Unicode JSON payload', () => {
    const headers = signRequest(accountA, 'POST', new URL('https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions'), new TextEncoder().encode('{"model":"fixture","messages":[{"role":"user","content":"你好"}]}'), {}, now)
    expect(headers['x-sdk-date']).toBe('20261023T080910Z')
    expect(headers['authorization']).toBe('SDK-HMAC-SHA256 Access=FAKEACCESSKEYA1234, SignedHeaders=content-type;host;x-sdk-date, Signature=416d955c17d75bcd07b7d9d4b2d6abc870703e828c671544dd87f1d68e794687')
  })

  it('sorts and encodes query parameters and canonicalizes the trailing slash', () => {
    const first = signRequest(accountA, 'GET', new URL('https://example.com/a%20b?z=中&x=&x=a+b&a=!*'), new Uint8Array(), {}, now)
    const reordered = signRequest(accountA, 'get', new URL('https://example.com/a%20b/?a=%21%2A&x=a%20b&z=%E4%B8%AD&x='), new Uint8Array(), {}, now)
    expect(first.authorization).toBe(reordered.authorization)
    expect(uriEncode(" !'()*~")).toBe('%20%21%27%28%29%2A~')
    expect(first.authorization).toBe('SDK-HMAC-SHA256 Access=FAKEACCESSKEYA1234, SignedHeaders=content-type;host;x-sdk-date, Signature=44036d4a5287b43aef5fe9351db3266392f0558f876e6a597b06ca3d40b7e74c')
  })

  it('includes session headers in the signature and signs the actual payload', () => {
    const url = new URL('https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions')
    const body = new TextEncoder().encode('{}')
    const agent = signRequest(accountA, 'POST', url, body, {}, now)
    const session = signRequest(accountA, 'POST', url, body, { 'X-OT-Session-ID': 'ses_fixture', 'user-session-id': 'ses_fixture' }, now)
    expect(session.authorization).toContain('SignedHeaders=content-type;host;user-session-id;x-ot-session-id;x-sdk-date')
    expect(session.authorization).not.toBe(agent.authorization)
    expect(signRequest(accountA, 'POST', url, new TextEncoder().encode('{ }'), {}, now).authorization).not.toBe(agent.authorization)
  })
})
