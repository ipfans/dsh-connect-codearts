import { describe, expect, it, vi } from 'vitest'
import { BENEFIT_BASE, CodeArtsClient, parseModels } from '../src/upstream.ts'
import { accountA } from './helpers.ts'

const row = { model_id: 'same-model', model_name: 'Same', context_window: 32768, max_tokens: 4096 }

describe('CodeArts upstream discovery', () => {
  it('finds benefit models independently from an empty AgentCenter account', async () => {
    const calls: string[] = []
    const client = new CodeArtsClient(async input => {
      const url = String(input); calls.push(url)
      if (url.includes('useragents')) return Response.json({ agents: [] })
      return Response.json({ error_code: '0000', result: { models: [row] } })
    })
    const [agent, benefit] = await Promise.all([client.models(accountA, 'agent'), client.models(accountA, 'benefit')])
    expect(agent.models).toEqual([])
    expect(benefit.models[0]?.id).toBe('benefit/same-model')
    expect(calls.some(url => url.startsWith(BENEFIT_BASE))).toBe(true)
  })

  it('uses primary AgentCenter metadata and sends signed routing headers', async () => {
    const client = new CodeArtsClient(async (input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('agent-type')).toBe('AgentCenter')
      expect(headers.get('authorization')).toContain('SignedHeaders=accept;agent-type;content-type;host;x-language;x-sdk-date')
      if (String(input).includes('useragents')) return Response.json({ agents: [{ agent_id: 'secondary' }, { agent_id: 'primary', is_primary_agent: true }] })
      expect(String(input)).toContain('agent_id=primary')
      return Response.json({ gpts: { models: [{ model_id: 'vision', model_alias: 'Vision', model_parameters: { context_window: 64000, max_tokens: 8000, supports_images: true } }] } })
    })
    expect((await client.models(accountA, 'agent')).models[0]).toMatchObject({ id: 'agent/vision', supportsImages: true })
  })

  it('keeps channel identities distinct and reports missing capacity metadata', () => {
    const agent = parseModels([{ ...row, model_parameters: row }, { model_id: 'missing' }], 'agent')
    const benefit = parseModels([row, row], 'benefit')
    expect(agent.models[0]?.id).not.toBe(benefit.models[0]?.id)
    expect(agent.issues[0]).toContain('missing')
    expect(benefit.models).toHaveLength(1)
  })

  it('never redirects signed credentials to another destination', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => { expect(init?.redirect).toBe('error'); return Response.json({ result: {} }) })
    const client = new CodeArtsClient(fetcher)
    await expect(client.request(accountA, 'GET', 'https://attacker.example/')).rejects.toThrow('not allowed')
    expect(fetcher).not.toHaveBeenCalled()
    await client.request(accountA, 'GET', `${BENEFIT_BASE}/api/v1/benefit/claim`)
  })

  it('parses zero balance, performs empty-body claims and detects HTTP-200 business failures', async () => {
    let fail = false
    const client = new CodeArtsClient(async (input, init) => {
      if (fail) return Response.json({ error_code: 'denied', error_msg: `Permission denied for ${accountA.ak} ${accountA.sk}` })
      if (init?.method === 'POST') { expect(init.body).toEqual(Buffer.alloc(0)); return Response.json({ error_code: '0000', result: {} }) }
      return String(input).includes('/balance') ? Response.json({ result: { total_quota: 100, total_balance: 0, used_amount: 100 } }) : Response.json({ result: { create_time: 1700000000000 } })
    })
    expect(await client.benefit(accountA)).toMatchObject({ balance: 0, total: 100, used: 100, claimedAt: 1700000000000 })
    await client.claim(accountA)
    fail = true
    const benefit = await client.benefit(accountA)
    expect(benefit.error).toContain('[redacted]')
    expect(benefit.error).not.toContain(accountA.sk)
    await expect(client.claim(accountA)).rejects.toMatchObject({ status: 403 })
  })
})
