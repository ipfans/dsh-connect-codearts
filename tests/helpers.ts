import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { Account, AccountCredentials } from '../src/accounts.ts'
import type { CodeArtsModel } from '../src/types.ts'

export const accountA: Account = { id: 'account-a', label: 'Account A', ak: 'FAKEACCESSKEYA1234', sk: 'fake-secret-key-a-not-valid' }
export const accountB: Account = { id: 'account-b', label: 'Account B', ak: 'FAKEACCESSKEYB5678', sk: 'fake-secret-key-b-not-valid' }
export const model: CodeArtsModel = { id: 'benefit/fixture', upstreamId: 'fixture', channel: 'benefit', name: 'Fixture', contextWindow: 32768, maxTokens: 4096, supportsImages: false }

export function credentialStore(accounts: Account[] = [], activeId: string | null = accounts[0]?.id ?? null) {
  let record: CredentialRecord | undefined = { kind: 'grant', payload: { version: 1, accounts: structuredClone(accounts), activeId } }
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
