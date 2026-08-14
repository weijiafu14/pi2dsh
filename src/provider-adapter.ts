// Pi provider → DSH llm route. A Pi package that registers a provider
// CARRYING ITS OWN TRANSPORT (pi-ai createProvider's stream) becomes a real
// DSH adapter through the public `llm.registerAdapter` seam: the loop, child
// agents (reviewer sessions, model division of labor), and hand-built calls
// all route to it natively. Credentials resolve per request through Pi's own
// chain; the key rides the provider's stream options and never enters logs.

import { dshRequestToPiContext, piEventsToDshChunks } from './model-bridge.js'

type UnknownRecord = Record<string, unknown>

interface PiTransportProvider {
  stream(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord>
  getModels?(): UnknownRecord[]
  name?: unknown
  [key: string]: unknown
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

/**
 * Wrap one Pi provider object as a DSH LlmAdapter-shaped route handler.
 * Structural typing carries it through `llm.registerAdapter`.
 */
export function piProviderDshAdapter(providerId: string, provider: PiTransportProvider, host: ProviderAdapterHost): UnknownRecord {
  return {
    providerInfo: (id: string) => ({ id, name: typeof provider.name === 'string' ? provider.name : id }),
    providerRetryPolicy: () => undefined,
    listModels: async (id: string) => providerModels(provider).map(model => ({
      provider: id,
      id: String(model.id ?? ''),
      name: String(model.name ?? model.id ?? ''),
      ...(Array.isArray(model.input) ? { inputModalities: (model.input as string[]).filter(m => m === 'text' || m === 'image') } : {}),
    })),
    resolveModel: async (id: string, modelId: string) => {
      const known = providerModels(provider).find(model => model.id === modelId)
      return {
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
 * Register the provider as a live DSH route when it carries a transport and
 * an llm service is mounted. A route conflict (an adapter already owns the
 * name — e.g. a deployment-configured `deepseek`) keeps the existing route
 * and reports the skip; the package's registry entry still stands.
 * @returns the route disposer, or undefined when nothing was registered.
 */
export function registerPiProviderRoute(options: RegisterPiProviderRouteOptions): (() => void) | undefined {
  const { llm, providerId, provider, host } = options
  if (llm === undefined || !providerCarriesTransport(provider)) return undefined
  try {
    return llm.registerAdapter([providerId], piProviderDshAdapter(providerId, provider, host))
  } catch (error) {
    host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} was not added as a DSH llm route (${error instanceof Error ? error.message : String(error)}); the existing route keeps the name`)
    return undefined
  }
}
