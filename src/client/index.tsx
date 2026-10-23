import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ENTRY_ID } from '../types.ts'
import { en, zh, type CopyKey } from './locales.ts'
import { ProviderCard, SettingsPage } from './settings.tsx'

interface ProviderCardOwnerProps {
  readonly provider: {
    readonly provider: string; readonly displayName: string; readonly settingsNs: string
    readonly settingsPath: readonly string[]; readonly active: boolean; readonly declared?: boolean
  }
  readonly configured: boolean
  readonly keyConfigured: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.codearts': CopyKey }
  interface SlotMap { 'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardOwnerProps } }
}

export const name = 'dsh-connect-codearts-client'
export const inject = ['slots', 'locale']

const CSS = `
.cac-page { max-width: 800px; margin: 0 auto; padding: 24px; color: var(--dsw-alias-label-primary); }
.cac-page h2 { margin: 0 0 8px; } .cac-page h3, .cac-page h4 { margin: 0; }
.cac-section { padding: 24px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.cac-section h4 { margin: 20px 0 12px; }
.cac-heading, .cac-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.cac-heading { flex-wrap: wrap; } .cac-row { padding: 14px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.cac-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cac-muted { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.cac-error { color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.cac-form { display: grid; gap: 10px; max-width: 480px; padding: 16px 0; }
.cac-form label { font-size: 13px; } .cac-facts { display: flex; flex-wrap: wrap; gap: 32px; }
.cac-facts dt { color: var(--dsw-alias-label-secondary); font-size: 13px; } .cac-facts dd { margin: 6px 0 0; font-size: 20px; }
.cac-model-id { overflow-wrap: anywhere; } .cac-provider { padding: 12px; }
@media (max-width: 600px) { .cac-page { padding: 16px; } .cac-row { align-items: flex-start; flex-direction: column; } }
`

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.codearts', { en, zh }))
  const t = ctx.locale.bind('settings.codearts')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-connect-codearts'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-codearts', order: 41, label: () => t('title'), locale: 'settings.codearts' }, SettingsPage))
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({ name: 'settings.models.provider-card', key: ENTRY_ID, locale: 'settings.codearts' }, ProviderCard))
}
