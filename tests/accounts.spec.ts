import { describe, expect, it } from 'vitest'
import { Accounts, publicAccounts } from '../src/accounts.ts'
import { accountA, accountB, credentialStore } from './helpers.ts'

describe('account storage', () => {
  it('saves, selects, updates and removes accounts durably without changing another credential', async () => {
    const { store } = credentialStore()
    const accounts = new Accounts(store)
    await accounts.save({ label: 'First', ak: accountA.ak, sk: accountA.sk })
    await accounts.save({ label: 'Second', ak: accountB.ak, sk: accountB.sk })
    let state = await accounts.read()
    const [a, b] = state.accounts
    expect(state.activeId).toBe(a!.id)
    await accounts.select(b!.id)
    await accounts.save({ id: b!.id, label: 'Renamed', ak: '', sk: '' })
    state = await new Accounts(store).read()
    expect(state.activeId).toBe(b!.id)
    expect(state.accounts[1]).toMatchObject({ label: 'Renamed', ak: accountB.ak, sk: accountB.sk })
    await accounts.remove(b!.id)
    state = await accounts.read()
    expect(state.activeId).toBeNull()
    expect(state.accounts).toHaveLength(1)
    const publicState = JSON.stringify(publicAccounts(state))
    expect(publicState).toContain('1234')
    expect(publicState).not.toContain(accountA.ak)
    expect(publicState).not.toContain(accountA.sk)
  })

  it('serializes concurrent edits through the credential provider', async () => {
    const { store } = credentialStore()
    await Promise.all([
      new Accounts(store).save({ label: 'A', ak: accountA.ak, sk: accountA.sk }),
      new Accounts(store).save({ label: 'B', ak: accountB.ak, sk: accountB.sk }),
    ])
    expect((await new Accounts(store).read()).accounts).toHaveLength(2)
  })

  it('rejects malformed records without replacing their contents', async () => {
    const { store, replace } = credentialStore()
    const corrupted = { kind: 'grant', payload: { version: 99, accounts: [] } } as const
    replace(corrupted)
    const accounts = new Accounts(store)
    await expect(accounts.save({ label: 'A', ak: accountA.ak, sk: accountA.sk })).rejects.toThrow('invalid')
    expect(await store.readRecord()).toEqual(corrupted)
  })

  it('validates secrets, unknown IDs and duplicate AKs', async () => {
    const { store } = credentialStore([accountA])
    const accounts = new Accounts(store)
    await expect(accounts.save({ label: 'A', ak: accountA.ak, sk: accountA.sk })).rejects.toThrow('already saved')
    await expect(accounts.save({ label: 'bad', ak: 'bad\nkey', sk: accountA.sk })).rejects.toThrow('whitespace')
    await expect(accounts.save({ label: 'bad' })).rejects.toThrow('required')
    await expect(accounts.select('absent')).rejects.toThrow('no longer exists')
    await expect(accounts.remove('absent')).rejects.toThrow('no longer exists')
    expect((await accounts.read()).accounts).toEqual([accountA])
  })

  it('does not expose credential-provider error details', async () => {
    const accounts = new Accounts({
      async readRecord() { throw new Error(`backend included ${accountA.sk}`) },
      async modifyRecord() { throw new Error(`backend included ${accountA.sk}`) },
    })
    await expect(accounts.read()).rejects.toThrow('storage could not be read')
    await expect(accounts.save({ label: 'A', ak: accountA.ak, sk: accountA.sk })).rejects.toThrow('storage could not be updated')
  })
})
