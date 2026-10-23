import { describe, expect, it, vi } from 'vitest'
import { Accounts } from '../src/accounts.ts'
import { CodeArtsRuntime } from '../src/runtime.ts'
import { CodeArtsClient, type DiscoveredModels } from '../src/upstream.ts'
import { accountA, accountB, credentialStore, deferred, model } from './helpers.ts'

function clientFixture() {
  const client = new CodeArtsClient(async () => { throw new Error('Unexpected network request') })
  vi.spyOn(client, 'models').mockImplementation(async (_account, channel) => ({ models: [{ ...model, channel, id: `${channel}/fixture` }], issues: [] }))
  vi.spyOn(client, 'benefit').mockResolvedValue({ balance: 10, total: 100, used: 90 })
  vi.spyOn(client, 'claim').mockResolvedValue(undefined)
  return client
}

describe('account-scoped runtime', () => {
  it('retains valid catalog cache on refresh failures and enforces independent channel TTLs', async () => {
    const { store } = credentialStore([accountA])
    const client = clientFixture()
    let now = 0
    const runtime = new CodeArtsRuntime(new Accounts(store), client, () => now)
    await runtime.sync(); await runtime.refresh()
    expect(client.models).toHaveBeenCalledTimes(2)
    await runtime.refresh()
    expect(client.models).toHaveBeenCalledTimes(2)
    now = 300_001
    vi.mocked(client.models).mockImplementation(async (_a, channel) => {
      if (channel === 'agent') throw new Error(`offline ${accountA.sk}`)
      return { models: [{ ...model, name: 'Updated' }], issues: [] }
    })
    await runtime.refresh()
    const status = await runtime.status('token')
    expect(status.catalog.agent.models).toHaveLength(1)
    expect(status.catalog.agent.error).toBe('offline [redacted]')
    expect(status.catalog.benefit.models[0]?.name).toBe('Updated')
    expect(JSON.stringify(status)).not.toContain(accountA.sk)
    runtime.close()
  })

  it('ignores an old account response that finishes after a manual switch', async () => {
    const { store } = credentialStore([accountA, accountB])
    const accounts = new Accounts(store)
    const client = clientFixture()
    const old = deferred<DiscoveredModels>()
    vi.mocked(client.models).mockImplementation(async (account, channel) => {
      if (account.id === accountA.id) return old.promise
      return { models: [{ ...model, channel, id: `${channel}/b-model`, upstreamId: 'b-model' }], issues: [] }
    })
    const runtime = new CodeArtsRuntime(accounts, client)
    await runtime.sync()
    const pending = runtime.refresh()
    await accounts.select(accountB.id); await runtime.sync(); await runtime.refresh()
    expect(runtime.snapshot().account?.id).toBe(accountB.id)
    old.resolve({ models: [model], issues: [] })
    await pending
    expect(runtime.snapshot().models.every(m => m.upstreamId === 'b-model')).toBe(true)
    await runtime.action({ action: 'remove', id: accountB.id })
    expect(runtime.snapshot().account).toBeUndefined()
    expect(runtime.snapshot().models).toEqual([])
    runtime.close()
  })

  it('invalidates an account cache when its keys change and refuses stale claim actions', async () => {
    const { store } = credentialStore([accountA, accountB])
    const client = clientFixture()
    const runtime = new CodeArtsRuntime(new Accounts(store), client)
    await runtime.sync(); await runtime.refresh()
    await runtime.action({ action: 'save', id: accountA.id, label: 'A', sk: 'new-fake-secret' })
    expect(client.models).toHaveBeenCalledTimes(4)
    await runtime.action({ action: 'select', id: accountB.id })
    await expect(runtime.action({ action: 'claim', accountId: accountA.id })).rejects.toThrow('changed')
    expect(client.claim).not.toHaveBeenCalled()
    runtime.close()
  })

  it('refreshes benefit data after a successful manual claim and joins duplicate actions', async () => {
    const { store } = credentialStore([accountA])
    const client = clientFixture()
    const runtime = new CodeArtsRuntime(new Accounts(store), client)
    await runtime.sync(); await runtime.refresh()
    const claim = deferred<void>()
    vi.mocked(client.claim).mockImplementation(() => claim.promise)
    vi.mocked(client.benefit).mockResolvedValue({ balance: 50 })
    const first = runtime.action({ action: 'claim', accountId: accountA.id })
    const second = runtime.action({ action: 'claim', accountId: accountA.id })
    await vi.waitFor(() => expect(client.claim).toHaveBeenCalledTimes(1))
    claim.resolve()
    await Promise.all([first, second])
    expect((await runtime.status('token')).benefit.balance).toBe(50)
    runtime.close()
  })

  it('hides models on malformed credential state and cannot publish after disposal', async () => {
    const { store, replace } = credentialStore([accountA])
    const runtime = new CodeArtsRuntime(new Accounts(store), clientFixture())
    await runtime.sync(); await runtime.refresh()
    replace({ kind: 'grant', payload: null })
    await expect(runtime.sync()).rejects.toThrow('invalid')
    expect(runtime.snapshot().models).toEqual([])
    runtime.close()
    await expect(runtime.action({ action: 'select', id: accountA.id })).rejects.toThrow('stopping')
  })
})
