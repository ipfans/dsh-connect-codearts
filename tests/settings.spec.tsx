import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderCard, SettingsPage } from '../src/client/settings.tsx'
import { readStatus, sendAction } from '../src/client/api.ts'
import { en, type Translate } from '../src/client/locales.ts'
import type { CodeArtsStatus } from '../src/types.ts'

vi.mock('../src/client/api.ts', () => ({ readStatus: vi.fn(), sendAction: vi.fn() }))
const t: Translate = key => en[key]
const initial: CodeArtsStatus = {
  accounts: [{ id: 'a', label: 'First', authState: 'ready', benefits: { subscription: { name: 'Fixture plan', remaining: 0, total: 500, used: 500, packages: [] } } }, { id: 'b', label: 'Second', authState: 'ready', benefits: {} }],
  activeId: 'a', actionToken: 'fixture-token', catalog: { models: [], issues: [] },
  autoClaim: true, login: { state: 'idle' },
}
let renderer: ReactTestRenderer | undefined
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.clearAllMocks() })

async function render() {
  vi.mocked(readStatus).mockResolvedValue(structuredClone(initial))
  vi.mocked(sendAction).mockResolvedValue(undefined)
  await act(async () => { renderer = create(<SettingsPage t={t}/>) })
  return renderer!
}
async function click(label: string, index = 0) {
  const buttons = renderer!.root.findAllByType('button').filter(node => node.children.includes(label))
  await act(async () => { await buttons[index]!.props.onClick() })
}

describe('CodeArts settings page', () => {
  it('starts OAuth with the saved action token and never shows password fields', async () => {
    const view = await render()
    expect(JSON.stringify(view.toJSON())).toContain(en.models)
    await click(en.add)
    expect(sendAction).toHaveBeenCalledWith({ action: 'login' }, 'fixture-token', expect.any(AbortSignal))
    expect(view.root.findAllByType('input').filter(input => input.props.type === 'password')).toHaveLength(0)
  })

  it('lets users rename accounts and request reauthorization separately', async () => {
    const view = await render()
    await click(en.edit)
    const inputs = view.root.findAllByType('input')
    expect(inputs.filter(input => input.props.type === 'password')).toHaveLength(0)
    await act(async () => { inputs[0]!.props.onChange({ target: { value: 'Renamed' } }) })
    await act(async () => { view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(sendAction).toHaveBeenCalledWith({ action: 'rename', id: 'a', label: 'Renamed' }, 'fixture-token', expect.any(AbortSignal))
    await click(en.relogin)
    expect(sendAction).toHaveBeenCalledWith({ action: 'login', accountId: 'a' }, 'fixture-token', expect.any(AbortSignal))
  })

  it('requires the deletion confirmation and binds refresh to the displayed account', async () => {
    await render()
    await click(en.remove)
    expect(sendAction).not.toHaveBeenCalled()
    await click(en.cancel)
    await click(en.select)
    expect(sendAction).toHaveBeenCalledWith({ action: 'select', id: 'b' }, 'fixture-token', expect.any(AbortSignal))
    await click(en.refresh)
    expect(sendAction).toHaveBeenCalledWith({ action: 'refresh', accountId: 'a' }, 'fixture-token', expect.any(AbortSignal))
  })

  it('shows true zero balances, submits claims and persists the automatic toggle', async () => {
    const view = await render()
    expect(view.root.findAllByType('dd').map(node => node.children.join(''))).toEqual(['0', '500', '500'])
    await click(en.claim)
    expect(sendAction).toHaveBeenCalledWith({ action: 'claim', accountId: 'a' }, 'fixture-token', expect.any(AbortSignal))
    await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: false } }) })
    expect(sendAction).toHaveBeenCalledWith({ action: 'auto-claim', enabled: false }, 'fixture-token', expect.any(AbortSignal))
  })

  it('shares plan and balance facts with the provider card', async () => {
    await render()
    await act(async () => { renderer!.update(<ProviderCard t={t}/>) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('Fixture plan')
    expect(renderer!.root.findAllByType('p').map(node => node.children.join(''))).toContain('Fixture plan · Remaining 0')
  })

  it('provides a cancellable login link and blocks selecting legacy accounts', async () => {
    await render()
    const pending = structuredClone(initial)
    pending.login = { state: 'pending', authUrl: 'https://codearts.huaweicloud.com/portal/authorize?ticket_id=fixture' }
    pending.accounts[1]!.authState = 'legacy'
    vi.mocked(readStatus).mockResolvedValue(pending)
    await click(en.add)
    expect(renderer!.root.findByProps({ href: pending.login.authUrl }).props.rel).toBe('noopener noreferrer')
    expect(renderer!.root.findAllByType('button').filter(node => node.children.includes(en.select))).toHaveLength(0)
    await click(en.cancelLogin)
    expect(sendAction).toHaveBeenCalledWith({ action: 'cancel-login' }, 'fixture-token', expect.any(AbortSignal))
  })
})
