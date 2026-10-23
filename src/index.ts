import type { Context } from '@deepseek-ai/cordis'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { ACCOUNTS_KEY, Accounts } from './accounts.ts'
import { createCodeArtsAdapter } from './adapter.ts'
import { createRoutes } from './routes.ts'
import { CodeArtsRuntime } from './runtime.ts'
import { ACTION_PATH, ENTRY_ID, PROVIDER_ID, STATUS_PATH } from './types.ts'
import { CodeArtsClient } from './upstream.ts'

export const name = 'dsh-connect-codearts'
export const inject = ['llm', 'credentials']
export const Config = z.object({})

export function apply(ctx: Context): void {
  const runtime = new CodeArtsRuntime(new Accounts(ctx.credentials), new CodeArtsClient())
  const adapter = createCodeArtsAdapter({
    snapshot: () => runtime.snapshot(), client: runtime.client,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => {
      const fs = ctx.get('fs')
      return fs?.processPathFromHostPath(hostPath)
    }, ref),
  })
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER_ID], adapter))
  ctx.effect(() => ctx.llm.registerConfigurableProviders([{ provider: PROVIDER_ID, displayName: 'CodeArts', settingsNs: ENTRY_ID, settingsPath: [] }]))
  ctx.effect(() => runtime.subscribe(() => ctx.emit('llm/adapters-updated')))
  const refresh = async (): Promise<void> => {
    try { await runtime.sync(); await runtime.refresh() }
    catch { ctx.logger.warn('CodeArts account state could not be loaded; check the credential store') }
  }
  ctx.on('credentials/record-updated', key => { if (key === ACCOUNTS_KEY) void refresh() })
  ctx.inject(['webServer'], web => {
    const routes = createRoutes(runtime)
    for (const path of [STATUS_PATH, ACTION_PATH]) web.effect(() => web.webServer.register({ kind: 'exact', path, handler: routes.handler }))
  })
  ctx.effect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60_000)
    timer.unref()
    return () => { clearInterval(timer); runtime.close() }
  })
}
