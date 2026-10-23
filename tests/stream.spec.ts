import { describe, expect, it } from 'vitest'
import { createChatFetch, normalizeResponse } from '../src/stream.ts'
import { CHAT_URL, CodeArtsClient } from '../src/upstream.ts'
import { accountA, accountB, model, sse } from './helpers.ts'

async function chunks(response: Response) {
  const content = await response.text()
  return content.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)))
}

describe('CodeArts response normalization', () => {
  it('decodes arbitrary UTF-8, CRLF and multiline SSE boundaries without losing reasoning or tool fragments', async () => {
    const wire = ': heartbeat\r\n\r\ndata: {"id":"one","choices":\r\ndata: [{"index":0,"delta":{"content":null,"reasoning_content":"思考"}}]}\r\n\r\n'
      + 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\\\"x\\\":"}}]}}]}\r\n\r\n'
      + 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}],"usage":{"total_tokens":9}}\r\n\r\n'
      + 'data: [DONE]\r\n\r\n'
    const bytes = new TextEncoder().encode(wire)
    let offset = 0
    const response = new Response(new ReadableStream({ pull(controller) { if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.slice(offset, ++offset)) } }), { headers: { 'content-type': 'text/event-stream' } })
    const events = await chunks(await normalizeResponse(response, model, accountA))
    expect(events[0].choices[0].delta.reasoning_content).toBe('思考')
    expect(events[1].choices[0].delta.tool_calls[0].function.arguments).toBe('{"x":')
    expect(events[2].usage.total_tokens).toBe(9)
    expect(events.at(-1).choices[0].finish_reason).toBe('tool_calls')
    expect(events.every(event => event.model === model.id)).toBe(true)
  })

  it('maps other and missing terminal reasons according to actual tool calls', async () => {
    const tools = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'x', arguments: '{}' } }] }, finish_reason: 'other' }] }
    expect((await chunks(await normalizeResponse(sse([tools]), model, accountA)))[0].choices[0].finish_reason).toBe('tool_calls')
    const plain = { choices: [{ delta: { content: 'ok' }, finish_reason: 'other' }] }
    expect((await chunks(await normalizeResponse(sse([plain], false), model, accountA)))[0].choices[0].finish_reason).toBe('stop')
  })

  it('converts JSON completions into delta chunks including indexed tool calls and usage', async () => {
    const response = Response.json({ id: 'json', choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'think', tool_calls: [{ id: 'call', type: 'function', function: { name: 'x', arguments: '{}' } }] }, finish_reason: 'other' }], usage: { total_tokens: 3 } })
    const [event] = await chunks(await normalizeResponse(response, model, accountA))
    expect(event.object).toBe('chat.completion.chunk')
    expect(event.choices[0].message).toBeUndefined()
    expect(event.choices[0].delta.tool_calls[0].index).toBe(0)
    expect(event.choices[0].finish_reason).toBe('tool_calls')
    expect(event.usage.total_tokens).toBe(3)
  })

  it('reports malformed, empty, truncated and business-error streams as failures', async () => {
    const partial = await normalizeResponse(sse([{ choices: [{ delta: { content: 'partial' } }] }], false), model, accountA)
    await expect(partial.text()).rejects.toThrow('incomplete')
    const empty = await normalizeResponse(sse([]), model, accountA)
    await expect(empty.text()).rejects.toThrow('empty stream')
    const malformed = await normalizeResponse(new Response('data: nope\n\n', { headers: { 'content-type': 'text/event-stream' } }), model, accountA)
    await expect(malformed.text()).rejects.toThrow('invalid SSE JSON')
    const error = await normalizeResponse(sse([{ error_code: 'quota', error_msg: `Insufficient quota ${accountA.sk}` }]), model, accountA)
    await expect(error.text()).rejects.toMatchObject({ status: 402, message: 'Insufficient quota [redacted]' })
  })

  it('normalizes JSON business errors and preserves HTTP status and retry delay without leaking secrets', async () => {
    const response = await normalizeResponse(Response.json({ error_code: 'busy', error_msg: `Rate limit ${accountA.ak}` }, { status: 429, headers: { 'retry-after': '5' } }), model, accountA)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('5')
    expect(await response.text()).not.toContain(accountA.ak)
    const denied = await normalizeResponse(Response.json({ error_code: 'signature', error_msg: 'Signature invalid' }), model, accountA)
    expect(denied.status).toBe(401)
  })

  it('cancels a pending upstream read when the consumer cancels', async () => {
    let cancelled = false
    const upstream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const response = await normalizeResponse(new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }), model, accountA)
    const reader = response.body!.getReader()
    const pending = reader.read()
    await reader.cancel()
    await pending
    expect(cancelled).toBe(true)
  })
})

describe('provider-scoped signed fetch', () => {
  it('sends raw model IDs with signed final bytes and Harness attribution', async () => {
    const entry = model
    const client = new CodeArtsClient(async (input, init) => {
      expect(String(input)).toBe(CHAT_URL)
      const headers = new Headers(init?.headers)
      const payload = JSON.parse(Buffer.from(init!.body as Buffer).toString())
      expect(payload.model).toBe('fixture')
      expect(payload.stream).toBe(true)
      expect(payload.messages[0].content).toBe('You are an AI agent powered by DeepSeek Harness.')
      expect(headers.get('authorization')).toContain(accountA.ak)
      expect(headers.get('authorization')).not.toContain('sdk-placeholder')
      expect(headers.get('user-agent')).toContain('deepseek-harness/')
      expect(headers.get('maas_type')).toBeNull()
      return sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    })
    const fetcher = createChatFetch(client, accountA, [entry])
    await (await fetcher(CHAT_URL, { method: 'POST', headers: { authorization: 'Bearer sdk-placeholder' }, body: JSON.stringify({ model: entry.id, messages: [{ role: 'system', content: 'You are an AI agent powered by DeepSeek Harness.' }] }) })).text()
    await expect(fetcher('https://example.com/chat/completions', { method: 'POST', body: '{}' })).rejects.toThrow('Unsupported')
  })

  it('reuses the upstream account session across requests and prepared calls', async () => {
    const sent: Headers[] = []
    const client = new CodeArtsClient(async (_input, init) => {
      sent.push(new Headers(init?.headers))
      return sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    })
    const request = { method: 'POST', body: JSON.stringify({ model: model.id }) }
    await (await createChatFetch(client, accountA, [model])(CHAT_URL, request)).text()
    await (await createChatFetch(client, { ...accountA }, [model])(CHAT_URL, request)).text()
    await (await createChatFetch(client, accountB, [model])(CHAT_URL, request)).text()
    for (const headers of sent) {
      const session = headers.get('x-ot-session-id')
      expect(session).not.toBeNull()
      expect(session).toMatch(/^ses_[a-f0-9]{32}$/u)
      expect(headers.get('user-session-id')).toBe(session)
      expect(headers.get('authorization')).toContain('user-session-id;x-ot-session-id')
    }
    expect(sent[0]!.get('x-ot-session-id')).toBe(sent[1]!.get('x-ot-session-id'))
    expect(sent[0]!.get('x-ot-session-id')).not.toBe(sent[2]!.get('x-ot-session-id'))
  })

  it('propagates abort signals to the upstream request', async () => {
    const controller = new AbortController()
    const client = new CodeArtsClient(async (_input, init) => {
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }))
    })
    const pending = createChatFetch(client, accountA, [model])(CHAT_URL, { method: 'POST', body: JSON.stringify({ model: model.id }), signal: controller.signal })
    controller.abort(new Error('user cancelled'))
    await expect(pending).rejects.toThrow('user cancelled')
  })
})
