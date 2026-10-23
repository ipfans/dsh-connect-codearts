import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { generateKeyPairSync } from 'node:crypto'
import type { Account, AccountCredentials } from '../src/accounts.ts'
import type { OAuthCredentials } from '../src/oauth.ts'
import type { CodeArtsModel } from '../src/types.ts'

const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' })
export const accountA: Account & OAuthCredentials = {
  id: 'account-a', label: 'Account A', ak: 'FAKEACCESSKEYA1234', sk: 'fake-secret-key-a-not-valid',
  oauth: { loginId: 'login-a', userId: 'user-a', domainId: 'domain-a', userName: 'User A', securityToken: 'fake-security-token-a', refreshToken: 'fake-refresh-token-a', clientId: 'codearts-agent', verifier: 'fake-verifier-a', privateKey, expiresAt: Date.parse('2099-01-01T00:00:00Z') },
}
export const accountB: Account & OAuthCredentials = { ...accountA, id: 'account-b', label: 'Account B', ak: 'FAKEACCESSKEYB5678', sk: 'fake-secret-key-b-not-valid', oauth: { ...accountA.oauth, loginId: 'login-b', userId: 'user-b', userName: 'User B', securityToken: 'fake-security-token-b', refreshToken: 'fake-refresh-token-b' } }
export const model: CodeArtsModel = { id: 'agent/fixture', upstreamId: 'fixture', name: 'Fixture', contextWindow: 32768, maxTokens: 4096, supportsImages: false }

export function credentialStore(accounts: Account[] = [], activeId: string | null = accounts[0]?.id ?? null) {
  let record: CredentialRecord | undefined = { kind: 'grant', payload: JSON.parse(JSON.stringify({ version: 2, accounts, activeId, autoClaim: true })) }
  let pending = Promise.resolve()
  const store = {
    async readRecord() { return structuredClone(record) },
    async modifyRecord(_key, mutate) {
      const run = pending.then(async () => {
        const next = await mutate(structuredClone(record))
        if (next !== undefined) record = structuredClone(next)
        return structuredClone(record)
      })
      pending = run.then(() => {}, () => {})
      return run
    },
  } satisfies AccountCredentials
  return { store, replace(value: CredentialRecord | undefined) { record = value } }
}

export function sse(events: unknown[], done = true): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } })
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
