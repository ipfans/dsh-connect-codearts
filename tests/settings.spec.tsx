import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../src/client/settings.tsx'
import { readStatus, sendAction } from '../src/client/api.ts'
import { en, type Translate } from '../src/client/locales.ts'
import type { CodeArtsStatus } from '../src/types.ts'

vi.mock('../src/client/api.ts', () => ({ readStatus: vi.fn(), sendAction: vi.fn() }))
const t: Translate = key => en[key]
const initial: CodeArtsStatus = {
  accounts: [{ id: 'a', label: 'First', akHint: '••••1234' }, { id: 'b', label: 'Second', akHint: '••••5678' }],
  activeId: 'a', actionToken: 'fixture-token', catalog: { agent: { models: [], issues: [] }, benefit: { models: [], issues: [] } },
  benefit: { balance: 0, total: 100, used: 100 },
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
  it('uses the saved action token, renders zero balance and clears password fields after a successful save', async () => {
    const view = await render()
    expect(JSON.stringify(view.toJSON())).toContain('Remaining')
    await click(en.add)
    const inputs = view.root.findAllByType('input')
    expect(inputs.filter(input => input.props.type === 'password')).toHaveLength(2)
    await act(async () => {
      inputs[0]!.props.onChange({ target: { value: 'New account' } })
    })
    await act(async () => { view.root.findAllByType('input')[1]!.props.onChange({ target: { value: 'FAKEAKNEW' } }) })
    await act(async () => { view.root.findAllByType('input')[2]!.props.onChange({ target: { value: 'fake-new-secret' } }) })
    await act(async () => { view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(sendAction).toHaveBeenCalledWith({ action: 'save', label: 'New account', ak: 'FAKEAKNEW', sk: 'fake-new-secret' }, 'fixture-token', expect.any(AbortSignal))
    expect(view.root.findAllByType('input')).toHaveLength(0)
    expect(JSON.stringify(view.toJSON())).not.toContain('fake-new-secret')
  })

  it('lets users rename an account while leaving existing AK/SK untouched', async () => {
    const view = await render()
    await click(en.edit)
    const inputs = view.root.findAllByType('input')
    expect(inputs[1]!.props.value).toBe('')
    expect(inputs[2]!.props.value).toBe('')
    expect(inputs[2]!.props.required).toBe(false)
    await act(async () => { inputs[0]!.props.onChange({ target: { value: 'Renamed' } }) })
    await act(async () => { view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(sendAction).toHaveBeenCalledWith({ action: 'save', id: 'a', label: 'Renamed', ak: '', sk: '' }, 'fixture-token', expect.any(AbortSignal))
  })

  it('requires the deletion confirmation and binds refresh/check-in to the displayed account', async () => {
    await render()
    await click(en.remove)
    expect(sendAction).not.toHaveBeenCalled()
    await click(en.cancel)
    await click(en.select)
    expect(sendAction).toHaveBeenCalledWith({ action: 'select', id: 'b' }, 'fixture-token', expect.any(AbortSignal))
    await click(en.refresh)
    expect(sendAction).toHaveBeenCalledWith({ action: 'refresh', accountId: 'a' }, 'fixture-token', expect.any(AbortSignal))
    await click(en.claim)
    expect(sendAction).toHaveBeenCalledWith({ action: 'claim', accountId: 'a' }, 'fixture-token', expect.any(AbortSignal))
  })
})
