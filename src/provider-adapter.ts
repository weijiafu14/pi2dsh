// Pi provider → DSH llm route. Every Pi provider — package-registered or
// models.json-defined — becomes a real DSH adapter through the public
// `llm.registerAdapter` seam, so the DSH llm directory is the ONE model
// directory both worlds read: DSH routes to these models natively (loop,
// child agents, hand-built calls), and the Pi registry is a projection of
// that same directory. A provider carrying its own transport (pi-ai
// createProvider's stream) streams through it; a config-only provider gets
// the real pi-ai wire client for each model's declared `api`. Credentials
// resolve per request through Pi's own chain; the key rides the provider's
// stream options and never enters logs.

import { anthropicMessagesApi, openAICompletionsApi, openAIResponsesApi } from './compat/pi-ai.js'
import { dshRequestToPiContext, piEventsToDshChunks } from './model-bridge.js'

type UnknownRecord = Record<string, unknown>

interface PiTransportProvider {
  stream(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord>
  getModels?(): UnknownRecord[]
  name?: unknown
  [key: string]: unknown
}

// Pi's wire-protocol clients by models.json `api` value — the same registry
// Pi's own composeModelProvider streams through. Each factory is the compat
// lazy shell: it forwards to the REAL pi-ai when the host installs it and
// fails explicitly otherwise.
const PI_API_FACTORIES: Record<string, () => unknown> = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
}

interface PiApiClient {
  stream(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord>
  streamSimple?(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord>
}

function piApiClientFor(api: unknown): PiApiClient | undefined {
  const factory = typeof api === 'string' ? PI_API_FACTORIES[api] : undefined
  return factory === undefined ? undefined : factory() as PiApiClient
}

/**
 * Give a config-only Pi provider (models.json entries, packages that declare
 * models without a stream) Pi's own transport: each call dispatches on the
 * model's declared `api` to the real pi-ai client, exactly as Pi's
 * provider composer does. Undispatchable providers (no models, or an api
 * with no client) answer undefined and stay off the directory.
 */
export function withSynthesizedTransport(provider: UnknownRecord): (PiTransportProvider & UnknownRecord) | undefined {
  const models = typeof (provider as { getModels?: unknown }).getModels === 'function'
    ? (provider as { getModels(): UnknownRecord[] }).getModels()
    : Array.isArray(provider.models) ? provider.models as UnknownRecord[] : []
  if (models.length === 0) return undefined
  if (!models.some(model => piApiClientFor(model.api) !== undefined)) return undefined
  const dispatch = (simple: boolean) =>
    (model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord> => {
      const client = piApiClientFor(model.api)
      if (client === undefined) {
        throw new Error(`pi2dsh: no wire-protocol client for api ${JSON.stringify(String(model.api))} (model ${String(model.provider)}/${String(model.id)})`)
      }
      const call = simple ? client.streamSimple ?? client.stream : client.stream
      return call.call(client, model, context, options)
    }
  return {
    ...provider,
    getModels: () => models,
    stream: dispatch(false),
    streamSimple: dispatch(true),
  }
}

export interface ProviderAdapterHost {
  /** Pi's full credential chain for this provider (stored OAuth → stored key → ambient env). */
  resolveAuth(): Promise<{ auth?: UnknownRecord } | undefined>
  warn(message: string): void
}

export function providerCarriesTransport(value: UnknownRecord | undefined): value is PiTransportProvider & UnknownRecord {
  return typeof value?.stream === 'function'
}

function providerModels(provider: PiTransportProvider): UnknownRecord[] {
  try {
    const models = provider.getModels?.()
    return Array.isArray(models) ? models : []
  } catch {
    return []
  }
}

// Pi Model fields a directory entry may carry (mirrored by the projection's
// exit restore). A whitelist, never a spread: DSH assigns its own meanings to
// names like reasoning/context/description, and a Pi-shaped value under those
// names corrupts the directory contract.
const PI_CARRIED_FIELDS = [
  'api', 'baseUrl', 'cost', 'contextWindow', 'maxTokens', 'samplingParams', 'thinkingLevelMap', 'compat', 'headers',
] as const

function piCarriedFields(model: UnknownRecord): UnknownRecord {
  const carried: UnknownRecord = {}
  for (const field of PI_CARRIED_FIELDS) {
    if (model[field] !== undefined) carried[field] = model[field]
  }
  return carried
}

/**
 * Wrap one Pi provider object as a DSH LlmAdapter-shaped route handler.
 * Structural typing carries it through `llm.registerAdapter`.
 */
export function piProviderDshAdapter(providerId: string, provider: PiTransportProvider, host: ProviderAdapterHost): UnknownRecord {
  return {
    providerInfo: (id: string) => ({ id, name: typeof provider.name === 'string' ? provider.name : id }),
    providerRetryPolicy: () => undefined,
    // The directory entry carries the Pi model's OWN fields (api, baseUrl,
    // cost, sampling params, …) alongside the DSH directory fields, so the
    // Pi registry projection restores an exact Pi Model and packages never
    // see that a DSH directory sat in between. Carriage is a whitelist:
    // names DSH gives its own meaning (reasoning is Pi's boolean but DSH's
    // {efforts} object) must never ride through with the Pi shape.
    listModels: async (id: string) => providerModels(provider).map(model => ({
      ...piCarriedFields(model),
      provider: id,
      id: String(model.id ?? ''),
      name: String(model.name ?? model.id ?? ''),
      ...(Array.isArray(model.input) ? { inputModalities: (model.input as string[]).filter(m => m === 'text' || m === 'image') } : {}),
    })),
    resolveModel: async (id: string, modelId: string) => {
      const known = providerModels(provider).find(model => model.id === modelId)
      return {
        ...(known === undefined ? {} : piCarriedFields(known)),
        provider: id,
        id: modelId,
        name: String(known?.name ?? modelId),
        ...(typeof known?.contextWindow === 'number' ? { context: { contextWindow: known.contextWindow } } : {}),
        ...(typeof known?.maxTokens === 'number' ? { defaultMaxTokens: known.maxTokens } : {}),
      }
    },
    async *stream(options: UnknownRecord): AsyncIterable<UnknownRecord> {
      const resolved = await host.resolveAuth()
      const auth = resolved?.auth as UnknownRecord | undefined
      const modelId = String(options.model ?? '')
      // The provider's own model entry keeps its api/thinking metadata; an
      // unlisted id passes through as pi-ai's advisory-catalog contract allows.
      const model = providerModels(provider).find(entry => entry.id === modelId)
        ?? { id: modelId, provider: providerId }
      const piContext = dshRequestToPiContext(options)
      const piOptions: UnknownRecord = {
        ...(auth?.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
        ...(auth?.baseUrl === undefined ? {} : { baseUrl: auth.baseUrl }),
        ...(auth?.headers === undefined ? {} : { headers: auth.headers }),
        ...(options.signal instanceof AbortSignal ? { signal: options.signal } : {}),
        ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
        ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
      }
      yield* piEventsToDshChunks(provider.stream(model, piContext, piOptions))
    },
  }
}

export interface RegisterPiProviderRouteOptions {
  llm: { registerAdapter(providers: string[], adapter: unknown): () => void } | undefined
  providerId: string
  provider: UnknownRecord
  host: ProviderAdapterHost
}

/**
 * Register the provider as a live DSH route when an llm service is mounted.
 * A provider carrying its own transport streams through it; a config-only
 * provider gets Pi's synthesized per-api transport. A route conflict (an
 * adapter already owns the name — e.g. a deployment-configured `deepseek`)
 * keeps the existing route and reports the skip.
 * @returns the route disposer, or undefined when nothing was registered.
 */
export function registerPiProviderRoute(options: RegisterPiProviderRouteOptions): (() => void) | undefined {
  const { llm, providerId, provider, host } = options
  if (llm === undefined) return undefined
  const transport = providerCarriesTransport(provider) ? provider : withSynthesizedTransport(provider)
  if (transport === undefined) return undefined
  try {
    return llm.registerAdapter([providerId], piProviderDshAdapter(providerId, transport, host))
  } catch (error) {
    host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} was not added as a DSH llm route (${error instanceof Error ? error.message : String(error)}); the existing route keeps the name`)
    return undefined
  }
}
