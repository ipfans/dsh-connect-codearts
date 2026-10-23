import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createToolResultMessage, QUOTA_EXCEEDED_CODE, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createCodeArtsAdapter } from '../src/adapter.ts'
import type { ModelSnapshot } from '../src/runtime.ts'
import { CodeArtsClient } from '../src/upstream.ts'
import { accountA, accountB, model, sse } from './helpers.ts'

const request: GenerateOptions = { provider: 'codearts', model: model.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> { const chunks: StreamChunk[] = []; for await (const chunk of source) chunks.push(chunk); return chunks }

describe('native DSH adapter', () => {
  it('exposes only the remotely declared thinking efforts and rejects unsupported choices before HTTP', async () => {
    let called = false
    const client = new CodeArtsClient(async () => { called = true; return sse([]) })
    const configured = { ...model, reasoning: { strengths: ['high', 'max'], default_strength: 'high' } }
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [configured] }), client })
    const resolved = await adapter.resolveModel('codearts', model.id)
    expect(resolved.reasoning).toEqual({ efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' })
    const prepared = await adapter.prepareCall('codearts', model.id)
    expect(prepared.model.reasoning).toEqual(resolved.reasoning)
    await expect(collect(prepared.stream({ ...request, reasoningEffort: ReasoningEffortId('low') }))).rejects.toThrow('does not support reasoning effort')
    expect(called).toBe(false)
  })

  it('hides reasoning controls for an empty list, omits the wire parameter and rejects explicit efforts', async () => {
    const payloads: Record<string, unknown>[] = []
    const client = new CodeArtsClient(async (_input, init) => {
      payloads.push(JSON.parse(Buffer.from(init!.body as Buffer).toString()))
      return sse([{ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }])
    })
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [{ ...model, reasoning: { strengths: [] } }] }), client })
    expect((await adapter.resolveModel('codearts', model.id)).reasoning).toBeUndefined()
    const prepared = await adapter.prepareCall('codearts', model.id)
    expect(prepared.model.reasoning).toBeUndefined()
    await collect(prepared.stream(request))
    expect(payloads[0]?.reasoning_effort).toBeUndefined()
    for (const effort of ['none', 'high']) await expect(collect(prepared.stream({ ...request, reasoningEffort: ReasoningEffortId(effort) }))).rejects.toThrow('does not support reasoning effort')
    expect(payloads).toHaveLength(1)
  })

  it.each([undefined, 'high', 'max'])('sends the declared effort or default (%s) without clamping', async effort => {
    const payloads: Record<string, unknown>[] = []
    const client = new CodeArtsClient(async (_input, init) => {
      payloads.push(JSON.parse(Buffer.from(init!.body as Buffer).toString()))
      return sse([{ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }])
    })
    const configured = { ...model, reasoning: { strengths: ['high', 'max'], default_strength: 'high' } }
    let snapshot: ModelSnapshot = { account: accountA, models: [configured] }
    const adapter = createCodeArtsAdapter({ snapshot: () => snapshot, client })
    const prepared = await adapter.prepareCall('codearts', model.id)
    snapshot = { account: accountB, models: [{ ...model, reasoning: { strengths: [] } }] }
    await collect(prepared.stream({ ...request, ...(effort ? { reasoningEffort: ReasoningEffortId(effort) } : {}) }))
    expect(payloads[0]?.reasoning_effort).toBe(effort ?? 'high')
  })

  it.each(['none', 'low', 'high', 'max'])('offers fallback efforts and sends %s unchanged through a prepared DSH call', async effort => {
    const payloads: Record<string, unknown>[] = []
    const client = new CodeArtsClient(async (_input, init) => {
      payloads.push(JSON.parse(Buffer.from(init!.body as Buffer).toString()))
      return sse([{ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }])
    })
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    const prepared = await adapter.prepareCall('codearts', model.id)
    expect(prepared.model.reasoning?.efforts.map(row => row.id)).toEqual(['none', 'low', 'high', 'max'])
    const chunks = await collect(prepared.stream({ ...request, reasoningEffort: ReasoningEffortId(effort) }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(payloads[0]).toMatchObject({ model: model.upstreamId, reasoning_effort: effort })
    expect(payloads[0]?.thinking).toBeUndefined()
  })

  it('treats the upstream TPM limit as a retryable rate limit', async () => {
    const client = new CodeArtsClient(async () => sse([{ error_code: 'tpm_limit', error_msg: 'The model TPM limit has been significantly exceeded. Please reduce the request rate and retry later.' }]))
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    const chunks = await collect(adapter.stream(request))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', status: 429 } } })
  })

  it('treats the Huawei HTTP-400 session limit as a retryable rate limit', async () => {
    const client = new CodeArtsClient(async () => Response.json({ error_code: 'TM.00001041', error_msg: '并发会话数已达上限(3个)，请关闭部分会话后重试。' }, { status: 400 }))
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    const chunks = await collect(adapter.stream(request))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', status: 429 } } })
  })

  it('freezes the prepared account while new requests follow a manual switch', async () => {
    let snapshot: ModelSnapshot = { account: accountA, models: [model] }
    const sent: string[] = []
    const client = new CodeArtsClient(async (_input, init) => {
      sent.push(new Headers(init?.headers).get('authorization')!)
      return sse([{ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }])
    })
    const adapter = createCodeArtsAdapter({ snapshot: () => snapshot, client })
    const oldCall = await adapter.prepareCall('codearts', model.id)
    snapshot = { account: accountB, models: [model] }
    const nextCall = await adapter.prepareCall('codearts', model.id)
    await Promise.all([collect(oldCall.stream(request)), collect(nextCall.stream(request))])
    expect(sent.some(header => header.includes(accountA.ak))).toBe(true)
    expect(sent.some(header => header.includes(accountB.ak))).toBe(true)
    snapshot = { account: undefined, models: [] }
    expect(await adapter.listModels('codearts')).toEqual([])
  })

  it('maps reasoning, fragmented tools and usage and sends the tool result in a second request', async () => {
    let calls = 0
    const client = new CodeArtsClient(async (_input, init) => {
      const payload = JSON.parse(Buffer.from(init!.body as Buffer).toString())
      ++calls
      if (calls === 2) {
        expect(payload.messages.some((m: { role: string; content: string }) => m.role === 'tool' && m.content.includes('found'))).toBe(true)
        return Response.json({ id: 'json-answer', choices: [{ message: { role: 'assistant', content: 'Done' }, finish_reason: 'other' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })
      }
      expect(payload.max_tokens).toBeGreaterThan(0)
      expect(payload.max_completion_tokens).toBeUndefined()
      return sse([
        { choices: [{ index: 0, delta: { content: null, reasoning_content: 'thinking' } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-fixture', type: 'function', function: { name: 'lookup', arguments: '{"path":' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] } }], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
      ])
    })
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    const tools = [{ name: 'lookup', description: 'Read a path', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }]
    const first = await collect(adapter.stream({ ...request, tools }))
    expect(first.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === 'thinking')).toBe(true)
    const tool = first.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(tool).toMatchObject({ block: { id: 'call-fixture', name: 'lookup', arguments: '{"path":"a"}' } })
    expect(first.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(first.find(chunk => chunk.type === 'usage')).toMatchObject({ usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 } })
    const assistant = createAssistantMessage({ source: { provider: 'codearts', model: model.id }, content: [{ type: 'tool-call', id: ToolCallId('call-fixture'), name: 'lookup', arguments: '{"path":"a"}' }] })
    const result = createToolResultMessage({ callId: ToolCallId('call-fixture'), content: [{ type: 'text', text: 'found' }], isError: false })
    const second = await collect(adapter.stream({ ...request, tools, messages: [...request.messages, assistant, result] }))
    expect(second.some(chunk => chunk.type === 'text-delta' && chunk.text === 'Done')).toBe(true)
    expect(second.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('reports truncated and HTTP-200 business-error streams as failed DSH finishes', async () => {
    let truncated = true
    const client = new CodeArtsClient(async () => truncated
      ? sse([{ choices: [{ delta: { content: 'partial' } }] }], false)
      : sse([{ error_code: 'quota', error_msg: 'Insufficient quota' }]))
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    expect((await collect(adapter.stream(request))).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } } })
    truncated = false
    expect((await collect(adapter.stream(request))).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: QUOTA_EXCEEDED_CODE } } })
  })

  it.each([[401, 'AUTH'], [403, 'PERMISSION_DENIED'], [402, QUOTA_EXCEEDED_CODE], [429, 'RATE_LIMIT'], [500, 'SERVER']] as const)('preserves HTTP %s as %s and carries the provider retry delay', async (status, code) => {
    const client = new CodeArtsClient(async () => Response.json({ error_code: 'fixture', error_msg: 'fixture refusal' }, { status, headers: { 'retry-after': '3' } }))
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    expect((await collect(adapter.stream(request))).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code, status, providerRetryAfterMs: 3000 } } })
  })

  it('uses declared image metadata and rejects unsupported images before issuing HTTP', async () => {
    let called = false
    const client = new CodeArtsClient(async () => { called = true; return sse([]) })
    const adapter = createCodeArtsAdapter({ snapshot: () => ({ account: accountA, models: [model] }), client })
    expect((await adapter.resolveModel('codearts', model.id)).inputModalities).toEqual(['text'])
    const image: GenerateOptions = { ...request, messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: AttachmentId('sha256:fixture'), mediaType: 'image/png', width: 1, height: 1, bytes: 70 } }] }] }
    await expect(collect(adapter.stream(image))).rejects.toThrow('does not support image')
    expect(called).toBe(false)
  })
})
