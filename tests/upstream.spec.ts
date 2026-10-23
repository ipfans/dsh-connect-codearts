import { describe, expect, it, vi } from 'vitest'
import { SNAP_BASE, CodeArtsClient, parseModels } from '../src/upstream.ts'
import { accountA } from './helpers.ts'

const row = { model_id: 'same-model', model_name: 'Same', context_window: 32768, max_tokens: 4096, model_parameters: { context_window: 32768, max_tokens: 4096 } }

describe('CodeArts upstream discovery', () => {
  it('queries thinking variants for discovered model IDs and prefers their declared strengths', async () => {
    let variantsRequested = false
    const client = new CodeArtsClient(async (input, init) => {
      if (String(input).includes('useragents')) return Response.json({ agents: [{ agent_id: 'primary' }] })
      if (String(input).includes('/detail')) return Response.json({ gpts: { models: ['GLM-5.2', 'empty', 'missing', 'invalid'].map(model_id => ({ ...row, model_id })) } })
      if (String(input).includes('/builtin')) return Response.json({ builtinModels: [] })
      expect(String(input)).toBe(`${SNAP_BASE}/v1/model/thinking-variants`)
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('agent-type')).toBe('PromptCenter')
      expect(JSON.parse(Buffer.from(init!.body as Buffer).toString())).toEqual({ model_names: ['GLM-5.2', 'empty', 'missing', 'invalid'] })
      variantsRequested = true
      return Response.json({ variants: { 'glm-5.2': { strengths: ['high', 'max', 'high', 'unknown', 42], default_strength: 'high' }, empty: { strengths: [], default_strength: 'high' }, invalid: { strengths: ['unknown'], default_strength: 'unknown' } } })
    })
    const catalog = await client.models(accountA)
    expect(variantsRequested).toBe(true)
    expect(catalog.models[0]?.reasoning).toEqual({ strengths: ['high', 'max'], default_strength: 'high' })
    expect(catalog.models[1]?.reasoning).toEqual({ strengths: [] })
    expect(catalog.models[2]?.reasoning).toEqual({ strengths: ['none', 'low', 'high', 'max'], default_strength: 'none' })
    expect(catalog.models[3]?.reasoning).toEqual({ strengths: [] })
  })

  it('retains available models with fallback efforts when the thinking-variants lookup fails', async () => {
    const client = new CodeArtsClient(async input => {
      if (String(input).includes('useragents')) return Response.json({ agents: [{ agent_id: 'primary' }] })
      if (String(input).includes('/detail')) return Response.json({ gpts: { models: [row] } })
      if (String(input).includes('/builtin')) return Response.json({ builtinModels: [] })
      throw new Error('unavailable')
    })
    const catalog = await client.models(accountA)
    expect(catalog.models[0]?.reasoning?.strengths).toEqual(['none', 'low', 'high', 'max'])
    expect(catalog.issues).toContain('Thinking effort metadata could not be refreshed; using fallback levels')
  })

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
      if (String(input).includes('/thinking-variants')) {
        expect(headers.get('agent-type')).toBe('PromptCenter')
        return Response.json({ variants: {} })
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
