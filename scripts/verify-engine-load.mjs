import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import * as plugin from '../lib/index.js'

class Credentials extends CredentialProvider {
  async readRecord() { return undefined }
  async modifyRecord() { throw new Error('Engine check must not write credentials') }
}
const paths = new Set()
class WebServer extends Service {
  constructor(ctx) { super(ctx, 'webServer') }
  register(route) { paths.add(route.path); return () => paths.delete(route.path) }
}
const ctx = new Context()
try {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Credentials)
  await ctx.plugin(WebServer)
  await ctx.plugin(plugin, {})
  assert.ok(ctx.llm.listProviders().some(p => p.id === 'codearts'))
  assert.ok(ctx.llm.listConfigurableProviders().some(p => p.settingsNs === 'llm-codearts'))
  assert.deepEqual(await ctx.llm.listModels('codearts'), [])
  assert.ok(paths.has('/api/codearts/status') && paths.has('/api/codearts/action'))
  const require = createRequire(import.meta.url)
  let moduleId
  let client
  const sandbox = { window: { __ModuleLoader__: { load({ id, factory }) { moduleId = id; client = factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { Button() {}, Input() {} } : require(name)) } } } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  assert.equal(moduleId, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).name)
  assert.equal(client.name, 'dsh-connect-codearts-client')
  assert.equal(typeof client.apply, 'function')
  console.log('Engine load passed: provider, directory, routes and browser module identity.')
} finally { await ctx.fiber.dispose() }
assert.equal(paths.size, 0)
