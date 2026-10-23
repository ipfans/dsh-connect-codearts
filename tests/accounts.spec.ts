import { describe, expect, it, vi } from 'vitest'
import { Accounts, publicAccounts } from '../src/accounts.ts'
import { LoginRequiredError, OAuthError } from '../src/oauth.ts'
import { accountA, accountB, credentialStore, deferred } from './helpers.ts'

describe('OAuth account storage', () => {
  it('adds, selects, renames and removes accounts without exposing credentials', async () => {
    const { store } = credentialStore()
    const accounts = new Accounts(store)
    await accounts.login(accountA)
    await accounts.login(accountB)
    const [a, b] = (await accounts.read()).accounts
    expect((await accounts.read()).activeId).toBe(a!.id)
    await accounts.select(b!.id)
    await accounts.rename(b!.id, 'Renamed')
    expect((await new Accounts(store).read()).accounts[1]).toMatchObject({ label: 'Renamed', sk: accountB.sk })
    await accounts.remove(b!.id)
    const state = await accounts.read()
    expect(state.activeId).toBeNull()
    expect(state.accounts).toHaveLength(1)
    const publicState = JSON.stringify(publicAccounts(state))
    for (const secret of [accountA.ak, accountA.sk, accountA.oauth.securityToken, accountA.oauth.refreshToken, accountA.oauth.privateKey.d!]) expect(publicState).not.toContain(secret)
  })

  it('preserves legacy records until OAuth succeeds and rejects them for inference', async () => {
    const { store, replace } = credentialStore()
    const legacy = { id: accountA.id, label: 'My old account', ak: accountA.ak, sk: accountA.sk }
    const original = { kind: 'grant', payload: { version: 1, accounts: [legacy], activeId: legacy.id } } as const
    replace(original)
    const accounts = new Accounts(store)
    expect(publicAccounts(await accounts.read())[0]?.authState).toBe('legacy')
    expect(await store.readRecord()).toEqual(original)
    await expect(accounts.authorize(legacy, vi.fn())).rejects.toBeInstanceOf(LoginRequiredError)
    await expect(accounts.select(legacy.id)).rejects.toBeInstanceOf(LoginRequiredError)
    expect(await store.readRecord()).toEqual(original)
    await accounts.login(accountA, legacy.id)
    expect((await accounts.read()).accounts[0]).toMatchObject({ id: legacy.id, label: legacy.label, oauth: accountA.oauth })
    expect(await store.readRecord()).toMatchObject({ kind: 'grant', payload: { version: 2, autoClaim: true } })
  })

  it('deduplicates Huawei identities and prevents accidental account replacement', async () => {
    const { store } = credentialStore([accountA, accountB])
    const accounts = new Accounts(store)
    await accounts.login({ ...accountA, sk: 'rotated' })
    expect((await accounts.read()).accounts).toHaveLength(2)
    expect((await accounts.read()).accounts[0]?.id).toBe(accountA.id)
    await expect(accounts.login(accountB, accountA.id)).rejects.toThrow('already saved')
    await expect(accounts.login({ ...accountB, oauth: { ...accountB.oauth, userId: 'someone-else' } }, accountA.id)).rejects.toThrow('same Huawei account')
    await expect(accounts.login(accountA, 'deleted')).rejects.toThrow('no longer exists')
    await expect(accounts.rename(accountA.id, ' ')).rejects.toThrow('1–100')
    await expect(accounts.select('absent')).rejects.toThrow('no longer exists')
    await expect(accounts.remove('absent')).rejects.toThrow('no longer exists')
  })

  it('serializes concurrent writes and persists the automatic claim preference', async () => {
    const { store } = credentialStore()
    await Promise.all([new Accounts(store).login(accountA), new Accounts(store).login(accountB)])
    const accounts = new Accounts(store)
    await accounts.setAutoClaim(false)
    expect((await new Accounts(store).read()).autoClaim).toBe(false)
    expect((await accounts.read()).accounts).toHaveLength(2)
  })

  it('rotates once across concurrent callers and separate account managers', async () => {
    const expired = { ...accountA, oauth: { ...accountA.oauth, expiresAt: 1 } }
    const { store } = credentialStore([expired])
    const refresh = vi.fn(async () => ({ ...accountA, ak: 'new-ak', oauth: { ...accountA.oauth, refreshToken: 'rotated-refresh-token' } }))
    const first = new Accounts(store)
    const second = new Accounts(store)
    const values = await Promise.all([first.authorize(expired, refresh), first.authorize(expired, refresh), second.authorize(expired, refresh)])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(values.every(value => value.ak === 'new-ak')).toBe(true)
    expect((await first.read()).accounts[0]?.oauth?.refreshToken).toBe('rotated-refresh-token')
  })

  it('retries persistence without consuming the old refresh token again', async () => {
    const expired = { ...accountA, oauth: { ...accountA.oauth, expiresAt: 1 } }
    const { store } = credentialStore([expired])
    let fail = true
    const accounts = new Accounts({ ...store, async modifyRecord(key, mutate) {
      return store.modifyRecord(key, async value => {
        const next = await mutate(value)
        if (fail) { fail = false; throw new Error('disk failure') }
        return next
      })
    } })
    const refresh = vi.fn(async () => ({ ...accountA, sk: 'new-secret' }))
    await expect(accounts.authorize(expired, refresh)).rejects.toThrow('storage could not be updated')
    expect((await accounts.read()).accounts[0]?.sk).toBe(expired.sk)
    expect((await accounts.authorize(expired, refresh)).sk).toBe('new-secret')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('marks terminal grants for login but preserves grants on temporary failures', async () => {
    const expired = { ...accountA, oauth: { ...accountA.oauth, expiresAt: 1 } }
    const { store } = credentialStore([expired])
    const accounts = new Accounts(store)
    await expect(accounts.authorize(expired, async () => { throw new OAuthError('Network unavailable') })).rejects.toThrow('Network unavailable')
    expect((await accounts.read()).accounts[0]?.oauth?.needsLogin).toBeUndefined()
    await expect(accounts.authorize(expired, async () => { throw new LoginRequiredError() })).rejects.toBeInstanceOf(LoginRequiredError)
    expect(publicAccounts(await accounts.read())[0]?.authState).toBe('login-required')
    const refresh = vi.fn()
    await expect(accounts.authorize(expired, refresh)).rejects.toBeInstanceOf(LoginRequiredError)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not resurrect an account deleted during renewal or accept stale login snapshots', async () => {
    const expired = { ...accountA, oauth: { ...accountA.oauth, expiresAt: 1 } }
    const { store } = credentialStore([expired])
    const accounts = new Accounts(store)
    const pending = deferred<typeof accountA>()
    const refresh = vi.fn(() => pending.promise)
    const renewal = accounts.authorize(expired, refresh)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    const deletion = accounts.remove(expired.id)
    pending.resolve(accountA)
    await Promise.all([renewal, deletion])
    expect((await accounts.read()).accounts).toEqual([])
    await accounts.login(accountA)
    const saved = (await accounts.read()).accounts[0]!
    await accounts.login({ ...accountA, oauth: { ...accountA.oauth, loginId: 'new-login' } }, saved.id)
    await expect(accounts.authorize(saved, refresh)).rejects.toThrow('authorization changed')
  })

  it('preserves malformed records and hides storage backend details', async () => {
    const { store, replace } = credentialStore()
    const corrupted = { kind: 'grant', payload: { version: 99, accounts: [] } } as const
    replace(corrupted)
    await expect(new Accounts(store).login(accountA)).rejects.toThrow('invalid')
    expect(await store.readRecord()).toEqual(corrupted)
    const accounts = new Accounts({
      async readRecord() { throw new Error(accountA.sk) },
      async modifyRecord() { throw new Error(accountA.sk) },
    })
    await expect(accounts.read()).rejects.toThrow('storage could not be read')
    await expect(accounts.login(accountA)).rejects.toThrow('storage could not be updated')
  })
})
