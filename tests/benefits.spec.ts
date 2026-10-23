import { describe, expect, it } from 'vitest'
import { CodeArtsClient, parseSubscription } from '../src/upstream.ts'
import { accountA } from './helpers.ts'

describe('subscription and credits', () => {
  it('uses the total metric without adding its component packages again', () => {
    const result = parseSubscription({
      package: { package_name_cn: '体验版', status: 'normal', is_credit_package: true }, end_date: '2026-11-02',
      metrics: [
        { name: 'usageTotalPackageCredit', package_credit_amount: 1500, package_credit_used: 1500, package_credit_remain: 0 },
        { name: 'usageBasicPackageCredit', package_credit_amount: 500, package_credit_used: 500 },
        { name: 'usageBonusPackageCredit', package_credit_amount: 1000, package_credit_used: 1000, package_credit_expiring_amount: 0 },
      ],
    })
    expect(result).toMatchObject({ total: 1500, used: 1500, remaining: 0, name: '体验版', periodEnd: '2026-11-02' })
    expect(result.packages).toHaveLength(2)
    expect(result.packages[0]?.remaining).toBeUndefined()
  })

  it('keeps unknown values distinct from zero and does not call legacy Token balances credits', () => {
    expect(parseSubscription({ package: { is_credit_package: false, package_name_en: 'Legacy' } })).toEqual({ nameEn: 'Legacy', isCreditPackage: false, packages: [] })
    expect(() => parseSubscription({ package: { is_credit_package: true }, metrics: [] })).toThrow('balance is missing')
    expect(() => parseSubscription({ metrics: 'invalid' })).toThrow('missing')
    const result = parseSubscription({ metrics: [{ name: 'usageTotalPackageCredit', package_credit_amount: 50, package_credit_remain: '50', package_credit_used: -1 }] })
    expect(result.total).toBe(50)
    expect(result.used).toBeUndefined()
    expect(result.remaining).toBeUndefined()
  })

  it('queries the snap-manager statistics path with signed temporary credentials', async () => {
    const client = new CodeArtsClient(async (url, init) => {
      expect(String(url)).toContain('/snap-manager/v1/statistics/plugin')
      expect(new Headers(init?.headers).get('x-security-token')).toBe(accountA.oauth.securityToken)
      expect(new Headers(init?.headers).get('agent-type')).toBe('PromptCenter')
      return Response.json({ metrics: [{ name: 'usageTotalPackageCredit', package_credit_remain: 12.5 }] })
    })
    expect((await client.subscription(accountA)).remaining).toBe(12.5)
  })
})

describe('claim then confirm', () => {
  const now = Date.parse('2026-10-23T08:00:00Z')
  const campaign = { campaignId: 1, title: 'Daily', status: 'ELIGIBLE', claimable: true, benefitUnit: 'CREDIT', benefitAmount: 1000 }

  it('claims only daily/new-user campaigns and confirms without leaking activity tickets', async () => {
    const requests: { path: string; body: unknown }[] = []
    const client = new CodeArtsClient(async (url, init) => {
      const path = new URL(String(url)).pathname
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path.endsWith('/delivery')) return Response.json({ code: 0, data: { items: [
        { ...campaign, access: 'secret-activity-ticket' },
        { ...campaign, campaignId: 4, status: 'CLAIMED' },
        { ...campaign, campaignId: 2 },
      ] } })
      return Response.json({ code: 0, data: {} })
    })
    const results = await client.claim(accountA, undefined, now)
    expect(requests.map(row => row.path)).toEqual(['/v1/ops/delivery', '/v1/ops/claim', '/v1/ops/confirm', '/v1/ops/confirm'])
    expect(requests[1]?.body).toEqual({ campaignId: 1, channel: 'IDE', idempotentKey: `claim_1_${now}` })
    expect(results[0]).toMatchObject({ ok: true, status: 'CONFIRMED', credits: 1000 })
    expect(results[1]?.credits).toBeUndefined()
    expect(JSON.stringify(results)).not.toContain('secret-activity-ticket')
  })

  it.each(['CONFIRMED', 'CONSUMED', ''])('does not claim campaign status %s', async status => {
    let calls = 0
    const client = new CodeArtsClient(async () => { calls++; return Response.json({ code: 0, data: { items: [{ ...campaign, status }] } }) })
    await client.claim(accountA, undefined, now)
    expect(calls).toBe(1)
  })

  it('respects activity dates and claimability', async () => {
    let calls = 0
    const client = new CodeArtsClient(async () => {
      calls++
      return Response.json({ code: 0, data: { items: [
        { ...campaign, extra: { endTime: '2026-10-23T07:00:00Z' } },
        { ...campaign, campaignId: 4, extra: { startTime: '2026-10-24T00:00:00Z' } },
        { ...campaign, claimable: false },
      ] } })
    })
    const results = await client.claim(accountA, undefined, now)
    expect(results.map(row => row.message)).toEqual(['Campaign ended', 'Campaign has not started', 'Not claimable yet; retry later'])
    expect(calls).toBe(1)
  })

  it('re-queries after an ambiguous claim failure and only confirms the next time', async () => {
    let status = 'ELIGIBLE'
    const paths: string[] = []
    const client = new CodeArtsClient(async url => {
      const path = new URL(String(url)).pathname; paths.push(path)
      if (path.endsWith('/delivery')) return Response.json({ code: 0, data: { items: [{ ...campaign, status }] } })
      if (path.endsWith('/claim')) { status = 'CLAIMED'; throw new Error('connection lost after credit was granted') }
      return Response.json({ code: 0, data: {} })
    })
    expect((await client.claim(accountA, undefined, now))[0]?.ok).toBe(false)
    expect((await client.claim(accountA, undefined, now + 1))[0]).toMatchObject({ ok: true, status: 'CONFIRMED' })
    expect(paths.filter(path => path.endsWith('/claim'))).toHaveLength(1)
  })

  it('reports HTTP-200 business errors and keeps a failed confirmation retryable', async () => {
    const client = new CodeArtsClient(async url => {
      if (String(url).includes('/delivery')) return Response.json({ code: 0, data: { items: [{ ...campaign, status: 'CLAIMED' }] } })
      return Response.json({ code: 40001, message: `not ready ${accountA.oauth.securityToken}` })
    })
    expect((await client.claim(accountA, undefined, now))[0]).toMatchObject({ ok: false, status: 'CLAIMED', message: 'not ready [redacted]' })
    const invalid = new CodeArtsClient(async () => Response.json({ data: { items: [] } }))
    await expect(invalid.claim(accountA)).rejects.toThrow('business code')
  })
})
