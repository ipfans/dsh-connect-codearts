import { describe, expect, it, vi } from 'vitest'
import { SNAP_BASE, CodeArtsClient, parseModels } from '../src/upstream.ts'
import { accountA } from './helpers.ts'

const row = { model_id: 'same-model', model_name: 'Same', context_window: 32768, max_tokens: 4096 }

describe('CodeArts upstream discovery', () => {
  it('returns no models for an empty AgentCenter account', async () => {
    const client = new CodeArtsClient(async () => Response.json({ agents: [] }))
    expect(await client.models(accountA)).toEqual({ models: [], issues: [] })
  })

  it('uses primary AgentCenter metadata and sends signed routing headers', async () => {
    const client = new CodeArtsClient(async (input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('x-security-token')).toBe(accountA.oauth.securityToken)
      if (String(input).includes('/v1/model/builtin')) {
        expect(headers.get('agent-type')).toBe('PromptCenter')
        return Response.json({ builtinModels: [] })
      }
      expect(headers.get('agent-type')).toBe('AgentCenter')
      expect(headers.get('authorization')).toContain('SignedHeaders=accept;agent-type;content-type;host;x-language;x-sdk-date;x-security-token')
      if (String(input).includes('useragents')) return Response.json({ agents: [{ agent_id: 'secondary' }, { agent_id: 'primary', is_primary_agent: true }] })
      expect(String(input)).toContain('agent_id=primary')
      return Response.json({ gpts: { models: [{ model_id: 'vision', model_alias: 'Vision', model_parameters: { context_window: 64000, max_tokens: 8000, supports_images: true } }] } })
    })
    expect((await client.models(accountA)).models[0]).toMatchObject({ id: 'agent/vision', supportsImages: true })
  })

  it('preserves subscription IDs, deduplicates models and reports missing capacity metadata', () => {
    const entry = { ...row, model_parameters: row }
    const parsed = parseModels([entry, entry, { model_id: 'missing' }])
    expect(parsed.models).toHaveLength(1)
    expect(parsed.models[0]?.id).toBe('agent/same-model')
    expect(parsed.issues[0]).toContain('missing')
  })

  it('never redirects signed credentials to another destination', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => { expect(init?.redirect).toBe('error'); return Response.json({ result: {} }) })
    const client = new CodeArtsClient(fetcher)
    await expect(client.request(accountA, 'GET', 'https://attacker.example/')).rejects.toThrow('not allowed')
    await expect(client.request(accountA, 'GET', 'https://opengw.developer.huaweicloud.com/api/v1/gateway/config')).rejects.toThrow('not allowed')
    expect(fetcher).not.toHaveBeenCalled()
    await client.request(accountA, 'GET', `${SNAP_BASE}/v1/agent-center/agents/useragents`)
  })

  it('detects HTTP-200 business failures without leaking credentials', async () => {
    const client = new CodeArtsClient(async () => Response.json({ error_code: 'denied', error_msg: `Permission denied for ${accountA.ak} ${accountA.sk}` }))
    await expect(client.models(accountA)).rejects.toMatchObject({ status: 403, message: 'Permission denied for [redacted] [redacted]' })
  })
})
