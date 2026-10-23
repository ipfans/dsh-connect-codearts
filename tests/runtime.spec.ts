import { describe, expect, it, vi } from 'vitest'
import { Accounts } from '../src/accounts.ts'
import { CodeArtsRuntime } from '../src/runtime.ts'
import { CodeArtsClient, SNAP_BASE, type DiscoveredModels } from '../src/upstream.ts'
import { accountA, accountB, credentialStore, deferred, model } from './helpers.ts'

function clientFixture() {
  const client = new CodeArtsClient(async () => { throw new Error('Unexpected network request') })
  vi.spyOn(client, 'models').mockResolvedValue({ models: [model], issues: [] })
  return client
}

describe('account-scoped runtime', () => {
  it('refreshes subscription models without calling the retired gateway', async () => {
    const calls: string[] = []
    const client = new CodeArtsClient(async input => {
      const url = String(input); calls.push(url)
      if (!url.startsWith(SNAP_BASE)) return Response.json({ error_code: '4000', error_msg: 'invalid channel, group not found' })
      if (url.includes('useragents')) return Response.json({ agents: [{ agent_id: 'primary' }] })
      return Response.json({ gpts: { models: [{ model_id: model.upstreamId, model_parameters: { context_window: model.contextWindow, max_tokens: model.maxTokens } }] } })
    })
    const { store } = credentialStore([accountA])
    const runtime = new CodeArtsRuntime(new Accounts(store), client)
    await runtime.sync(); await runtime.refresh()
    const status = await runtime.status('token')
    runtime.close()
    expect(JSON.stringify(status)).not.toContain('invalid channel, group not found')
    expect(calls.every(url => url.startsWith(SNAP_BASE))).toBe(true)
    expect(status.catalog.models).toHaveLength(1)
  })

  it('retains valid catalog cache on refresh failures and enforces its TTL', async () => {
    const { store } = credentialStore([accountA])
    const client = clientFixture()
    let now = 0
    const runtime = new CodeArtsRuntime(new Accounts(store), client, () => now)
    await runtime.sync(); await runtime.refresh()
    expect(client.models).toHaveBeenCalledTimes(1)
    await runtime.refresh()
    expect(client.models).toHaveBeenCalledTimes(1)
    now = 300_001
    vi.mocked(client.models).mockRejectedValue(new Error(`offline ${accountA.sk}`))
    await runtime.refresh()
    const status = await runtime.status('token')
    expect(status.catalog.models).toHaveLength(1)
    expect(status.catalog.error).toBe('offline [redacted]')
    expect(JSON.stringify(status)).not.toContain(accountA.sk)
    runtime.close()
  })

  it('ignores an old account response that finishes after a manual switch', async () => {
    const { store } = credentialStore([accountA, accountB])
    const accounts = new Accounts(store)
    const client = clientFixture()
    const old = deferred<DiscoveredModels>()
    vi.mocked(client.models).mockImplementation(async account => {
      if (account.id === accountA.id) return old.promise
      return { models: [{ ...model, id: 'agent/b-model', upstreamId: 'b-model' }], issues: [] }
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

  it('invalidates an account cache when its keys change and refuses stale refresh actions', async () => {
    const { store } = credentialStore([accountA, accountB])
    const client = clientFixture()
    const runtime = new CodeArtsRuntime(new Accounts(store), client)
    await runtime.sync(); await runtime.refresh()
    await runtime.action({ action: 'save', id: accountA.id, label: 'A', sk: 'new-fake-secret' })
    expect(client.models).toHaveBeenCalledTimes(2)
    await runtime.action({ action: 'select', id: accountB.id })
    await expect(runtime.action({ action: 'refresh', accountId: accountA.id })).rejects.toThrow('changed')
    runtime.close()
  })

  it('bypasses the model cache on manual refresh and joins duplicate actions', async () => {
    const { store } = credentialStore([accountA])
    const client = clientFixture()
    const runtime = new CodeArtsRuntime(new Accounts(store), client)
    await runtime.sync(); await runtime.refresh()
    const refresh = deferred<DiscoveredModels>()
    vi.mocked(client.models).mockImplementation(() => refresh.promise)
    const first = runtime.action({ action: 'refresh', accountId: accountA.id })
    const second = runtime.action({ action: 'refresh', accountId: accountA.id })
    await vi.waitFor(() => expect(client.models).toHaveBeenCalledTimes(2))
    refresh.resolve({ models: [{ ...model, name: 'Refreshed' }], issues: [] })
    await Promise.all([first, second])
    expect((await runtime.status('token')).catalog.models[0]?.name).toBe('Refreshed')
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
