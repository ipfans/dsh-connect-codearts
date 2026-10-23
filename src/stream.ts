import { createHash } from 'node:crypto'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { Account } from './accounts.ts'
import { object } from './json.ts'
import type { CodeArtsModel } from './types.ts'
import { businessError, businessStatus, CHAT_URL, CodeArtsClient, CodeArtsError, redact, type FailureObserver } from './upstream.ts'

const encoder = new TextEncoder()

function frame(value: unknown): Uint8Array<ArrayBuffer> {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
}

async function* sseEvents(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<{ data: string; event: string }> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let data: string[] = []
  let event = ''
  let eventBytes = 0
  try {
    let ended = false
    while (!ended) {
      const next = await reader.read()
      ended = next.done
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true })
      if (buffer.length + eventBytes > 8 * 1024 * 1024) throw new CodeArtsError('CodeArts stream event is too large')
      let match: RegExpExecArray | null
      while ((match = /\r\n|\r|\n/u.exec(buffer)) !== null) {
        if (!ended && match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        if (line === '') {
          if (data.length) yield { data: data.join('\n'), event }
          data = []; event = ''; eventBytes = 0
        } else if (line.startsWith('data:')) {
          const value = line.slice(5).replace(/^ /u, '')
          data.push(value); eventBytes += value.length
        } else if (line.startsWith('event:')) event = line.slice(6).trim()
      }
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /u, ''))
    if (data.length) yield { data: data.join('\n'), event }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function* normalizeSse(reader: ReadableStreamDefaultReader<Uint8Array>, model: CodeArtsModel, account: Account): AsyncGenerator<Uint8Array> {
  let tools = false
  let finished = false
  let meaningful = false
  let id = 'codearts'
  const finish = (): Uint8Array => frame({ id, object: 'chat.completion.chunk', model: model.id, choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }] })
  for await (const event of sseEvents(reader)) {
    if (event.data.trim() === '[DONE]') {
      if (!finished && !meaningful) throw new CodeArtsError('CodeArts returned an empty stream')
      if (!finished) yield finish()
      yield encoder.encode('data: [DONE]\n\n')
      return
    }
    let parsed: unknown
    try { parsed = JSON.parse(event.data) } catch { throw new CodeArtsError('CodeArts returned invalid SSE JSON') }
    const chunk = object(parsed)
    const error = businessError(chunk)
    if (error || event.event === 'error') {
      const message = redact(error?.message ?? 'CodeArts stream failed', account)
      throw new CodeArtsError(message, businessStatus(message), error?.code)
    }
    if (!chunk) throw new CodeArtsError('CodeArts returned an invalid SSE event')
    if (typeof chunk['id'] === 'string') id = chunk['id']
    if (Array.isArray(chunk['choices'])) for (const raw of chunk['choices']) {
      const choice = object(raw)
      if (!choice) throw new CodeArtsError('CodeArts returned an invalid stream choice')
      const delta = object(choice['delta'])
      if (Array.isArray(delta?.['tool_calls']) && delta['tool_calls'].length > 0) tools = true
      if (tools || (typeof delta?.['content'] === 'string' && delta['content'] !== '') || (typeof delta?.['reasoning_content'] === 'string' && delta['reasoning_content'] !== '')) meaningful = true
      const reason = choice['finish_reason']
      if (reason != null) {
        if (reason === 'other' || (reason === 'stop' && tools)) choice['finish_reason'] = tools ? 'tool_calls' : 'stop'
        finished = true
      }
    }
    chunk['model'] = model.id
    yield frame(chunk)
  }
  if (!finished) throw new CodeArtsError('CodeArts stream ended before a completion signal; response may be incomplete', 502, 'stream_truncated')
  yield encoder.encode('data: [DONE]\n\n')
}

function asStream(iterator: AsyncGenerator<Uint8Array>, cancel: () => Promise<unknown>, onFailure?: FailureObserver): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) { if (error instanceof CodeArtsError) onFailure?.(error); controller.error(error) }
    },
    async cancel() { await cancel(); await iterator.return(undefined) },
  })
}

export async function normalizeResponse(response: Response, model: CodeArtsModel, account: Account, onFailure?: FailureObserver): Promise<Response> {
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => undefined)
    const error = businessError(data)
    const status = error?.code === 'TM.00001041' ? 429 : response.status
    onFailure?.(new CodeArtsError(redact(error?.message ?? `CodeArts HTTP ${response.status}`, account), status, error?.code), response.headers.get('retry-after'))
    return new Response(JSON.stringify({ error: {
      message: redact(error?.message ?? `CodeArts HTTP ${response.status}`, account),
      type: 'codearts_error', code: error?.code ?? `http_${response.status}`,
    } }), { status, headers: { 'content-type': 'application/json', ...(response.headers.has('retry-after') ? { 'retry-after': response.headers.get('retry-after')! } : {}) } })
  }
  if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
    if (!response.body) throw new CodeArtsError('CodeArts returned an empty stream')
    const reader = response.body.getReader()
    return new Response(asStream(normalizeSse(reader, model, account), () => reader.cancel(), onFailure), { headers: { 'content-type': 'text/event-stream' } })
  }
  const data: unknown = await response.json().catch(() => undefined)
  const error = businessError(data)
  if (error) {
    const message = redact(error.message, account)
    onFailure?.(new CodeArtsError(message, businessStatus(message), error.code))
    return new Response(JSON.stringify({ error: { message, code: error.code, type: 'codearts_error' } }), { status: businessStatus(message), headers: { 'content-type': 'application/json' } })
  }
  const result = object(data)
  if (!result || !Array.isArray(result['choices']) || !result['choices'].length) throw new CodeArtsError('CodeArts returned an invalid completion')
  const choices = result['choices'].map(value => {
    const choice = object(value)
    const message = object(choice?.['message'])
    if (!choice || !message) throw new CodeArtsError('CodeArts completion is missing its message')
    const delta = { ...message }
    if (Array.isArray(message['tool_calls'])) delta['tool_calls'] = message['tool_calls'].map((call, index) => ({ ...object(call), index }))
    const tools = Array.isArray(message['tool_calls']) && message['tool_calls'].length > 0
    const reason = choice['finish_reason']
    return { index: choice['index'] ?? 0, delta, finish_reason: reason == null || reason === 'other' || (reason === 'stop' && tools) ? tools ? 'tool_calls' : 'stop' : reason }
  })
  const chunk = { ...result, object: 'chat.completion.chunk', model: model.id, choices }
  return new Response(new Blob([frame(chunk), encoder.encode('data: [DONE]\n\n')]), { headers: { 'content-type': 'text/event-stream' } })
}

export function createChatFetch(client: CodeArtsClient, account: Account, models: readonly CodeArtsModel[], onFailure?: FailureObserver): typeof fetch {
  // Huawei limits active session IDs per account, including completed requests.
  const sessionId = `ses_${createHash('sha256').update(account.ak).digest('hex').slice(0, 32)}`
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.href !== CHAT_URL || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') throw new CodeArtsError('Unsupported CodeArts chat request', 400)
    const payload = object(JSON.parse(init.body))
    const model = models.find(m => m.id === payload?.['model'])
    if (!payload || !model) throw new CodeArtsError('This model is not available for the selected account', 404, 'model_not_found')
    payload['model'] = model.upstreamId
    payload['stream'] = true
    const extra = { ...attributionHeaders(), 'x-ot-session-id': sessionId, 'user-session-id': sessionId }
    try {
      const response = await client.request(account, 'POST', CHAT_URL, encoder.encode(JSON.stringify(payload)), extra, init.signal ?? undefined, 600_000)
      return await normalizeResponse(response, model, account, onFailure)
    } catch (error) {
      if (error instanceof CodeArtsError) onFailure?.(error)
      throw error
    }
  }
}
