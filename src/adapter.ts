import { createProvider, type Api, type Model, type ProviderStreams } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE, ReasoningEffortId, resolveRetryPolicy, type GenerateOptions, type LlmFailure, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type PiAiAdapterOptions, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ModelSnapshot } from './runtime.ts'
import { createChatFetch } from './stream.ts'
import { FALLBACK_REASONING, PROVIDER_ID, REASONING_EFFORTS } from './types.ts'
import { CodeArtsClient, SNAP_BASE, type FailureObserver } from './upstream.ts'

interface AdapterOptions {
  snapshot: () => ModelSnapshot
  client: CodeArtsClient
  resolveAttachments?: PiAiAdapterOptions['resolveAttachments']
  resolveImageAccess?: PiAiAdapterOptions['resolveImageAccess']
}

const RETRY_POLICY = resolveRetryPolicy(undefined, 'CodeArts retry policy')

function piAdapter(snapshot: ModelSnapshot, options: AdapterOptions, onFailure: FailureObserver): PiAiAdapter {
  const base = openAICompletionsApi()
  const models: Model<Api>[] = snapshot.models.map(info => ({
    id: info.id, name: `${info.name} · CodeArts`,
    api: 'openai-completions', provider: PROVIDER_ID, baseUrl: `${SNAP_BASE}/api/v2`,
    input: info.supportsImages ? ['text', 'image'] : ['text'], reasoning: (info.reasoning ?? FALLBACK_REASONING).strengths.length > 0,
    thinkingLevelMap: Object.fromEntries(REASONING_EFFORTS.map(effort => [effort === 'none' ? 'off' : effort, (info.reasoning ?? FALLBACK_REASONING).strengths.includes(effort) ? effort : null])),
    contextWindow: info.contextWindow, maxTokens: info.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true },
  }))
  const account = snapshot.account
  const fetcher = account === undefined ? async () => { throw new Error('No CodeArts account is selected') } : createChatFetch(options.client, { ...account }, snapshot.models, onFailure)
  const api: ProviderStreams = {
    stream: (model, context, streamOptions) => base.stream(model, context, { ...streamOptions, fetch: fetcher }),
    streamSimple: (model, context, streamOptions) => base.streamSimple(model, context, { ...streamOptions, fetch: fetcher }),
  }
  const provider = createProvider({
    id: PROVIDER_ID, name: 'CodeArts', models, api,
    auth: { apiKey: { name: 'CodeArts managed credentials', async resolve({ credential }) { return credential?.key ? { auth: { apiKey: credential.key }, source: 'CodeArts' } : undefined } } },
  })
  const profile: ResolvedPiAiProviderProfile = {
    provider: PROVIDER_ID, displayName: 'CodeArts', piProvider: provider,
    streamIdleTimeoutMs: 300_000, retryPolicy: RETRY_POLICY,
    configuredMaxTokens: new Map(), modelErrors: new Map(),
    maxRequestImageBytes: 20_971_520, requestImagePixelBudget: 4_194_304, requestImageMaxBytes: 1_048_576,
  }
  const profiles = new Map([[PROVIDER_ID, profile]])
  return new PiAiAdapter({
    profiles: () => profiles,
    auth: {
      credentials: {
        async read() { return undefined }, async list() { return [] },
        async modify() { throw new Error('CodeArts credentials are managed by the CodeArts settings page') },
        async delete() {},
      },
      authContext: { async env() { return undefined }, async fileExists() { return false } },
    },
    // The HTTP transport replaces this SDK placeholder with an AK/SK signature.
    resolveApiKey: async () => 'codearts-managed',
    ...(options.resolveAttachments ? { resolveAttachments: options.resolveAttachments } : {}),
    ...(options.resolveImageAccess ? { resolveImageAccess: options.resolveImageAccess } : {}),
  })
}

function failureCode(status: number): string {
  if (status === 401) return 'AUTH'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 402) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 504) return 'TIMEOUT'
  return status >= 500 ? 'SERVER' : 'INVALID_REQUEST'
}

class CodeArtsAdapter extends LlmAdapter {
  constructor(private readonly options: AdapterOptions) { super() }
  override providerInfo() { return { id: PROVIDER_ID, name: 'CodeArts' } }
  override providerRetryPolicy() { return RETRY_POLICY }

  private call() {
    let failure: LlmFailure | undefined
    const snapshot = this.options.snapshot()
    // Each call owns its observer so simultaneous accounts cannot exchange error facts.
    const adapter = piAdapter(snapshot, this.options, (error, retryAfter) => {
      const delay = retryAfter == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()
      failure = { message: error.message, code: error.code === 'stream_truncated' ? 'TRANSPORT' : failureCode(error.status), status: error.status, ...(Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}) }
    })
    const variant = (id: string) => snapshot.models.find(model => model.id === id)?.reasoning ?? FALLBACK_REASONING
    function describe(model: LlmResolvedModelInfo): LlmResolvedModelInfo {
      if (!model.reasoning) return model
      const defaultStrength = variant(model.id).default_strength
      return { ...model, reasoning: {
        efforts: model.reasoning.efforts.map(effort => effort.id === 'off' ? { id: ReasoningEffortId('none'), name: 'None' } : effort),
        ...(defaultStrength ? { defaultEffort: ReasoningEffortId(defaultStrength) } : {}),
      } }
    }
    async function* wrap(options: GenerateOptions, stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
      const { strengths, default_strength } = variant(options.model)
      const effort = options.reasoningEffort ?? default_strength
      if (effort !== undefined && !strengths.includes(effort)) throw new LlmError(`CodeArts model "${options.model}" does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
      const normalized = effort === undefined ? options : { ...options, reasoningEffort: ReasoningEffortId(effort === 'none' ? 'off' : effort) }
      for await (const chunk of stream(normalized)) {
        if (chunk.type === 'finish' && chunk.reason.kind === 'error' && failure) {
          yield { ...chunk, reason: { kind: 'error', failure } }
        } else yield chunk
      }
    }
    return { adapter, wrap, describe }
  }

  override listModels(provider: string) { return this.call().adapter.listModels(provider) }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    const { adapter, describe } = this.call()
    return describe(await adapter.resolveModel(provider, model, signal))
  }
  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef) { return this.call().adapter.imageRequestTarget(provider, model, image) }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const { adapter, wrap, describe } = this.call()
    const prepared = await adapter.prepareCall(provider, model, signal)
    return { model: describe(prepared.model), stream: options => wrap(options, prepared.stream) }
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { adapter, wrap } = this.call()
    return wrap(options, options => adapter.stream(options))
  }
}

export function createCodeArtsAdapter(options: AdapterOptions): LlmAdapter { return new CodeArtsAdapter(options) }
