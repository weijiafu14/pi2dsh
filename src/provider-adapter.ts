// Pi provider → DSH llm route. A package-registered Pi provider carrying
// its own transport (pi-ai createProvider's stream) becomes a real DSH
// adapter through the public `llm.registerAdapter` seam, so the DSH llm
// directory is the ONE model directory both worlds read: DSH routes to
// these models natively (loop, child agents, hand-built calls), and the Pi
// registry is a projection of that same directory. Credentials resolve per
// request through Pi's own chain; the key rides the provider's stream
// options and never enters logs. A provider that only declares a catalog
// (no stream of its own) is not given a bridge transport: model transports
// belong to the host — configure the gateway in the host's llm settings
// (the official llm-pi-ai adapter) instead.

import { dshRequestToPiContext, piEventsToDshChunks, type DshLlmLike } from './model-bridge.js'

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

// ---- image-admission companion route ---------------------------------------

const IMAGE_OMITTED_TEXT = '[image attachment omitted: the selected model reads text only]'

const imageNoticeText = (path: string | undefined): string => path === undefined
  ? IMAGE_OMITTED_TEXT
  : `[image attached at ${path} — the selected model reads text only; use an image-capable tool to view it]`

// Replace image blocks with an explicit text notice, recursing into
// tool-result content the way DSH's contentHasImage does. The original
// route's adapter rejects image content loudly (llm-deepseek throws
// UNSUPPORTED_CONTENT), so the companion must hand it text-only — and a
// visible notice, never a silent drop, keeps the model aware something was
// there. When the attachment can be materialized to a file, the notice
// carries its path (Pi's own image vocabulary is inline-or-path, and a path
// lets the model reach the image through any path-taking tool); in the
// vision-bridge composition the image's ANALYSIS additionally arrives
// through the turn's entering messages.
async function textOnlyBlocks(
  blocks: UnknownRecord[],
  materialize: (attachment: UnknownRecord) => Promise<string | undefined>,
): Promise<UnknownRecord[]> {
  const out: UnknownRecord[] = []
  for (const block of blocks) {
    if (block.type === 'image') {
      const attachment = block.attachment
      const path = typeof attachment === 'object' && attachment !== null
        ? await materialize(attachment as UnknownRecord)
        : undefined
      out.push({ type: 'text', text: imageNoticeText(path) })
    } else if (block.type === 'tool-result' && Array.isArray(block.content)) {
      out.push({ ...block, content: await textOnlyBlocks(block.content as UnknownRecord[], materialize) })
    } else {
      out.push(block)
    }
  }
  return out
}

async function textOnlyMessages(
  messages: UnknownRecord[],
  materialize: (attachment: UnknownRecord) => Promise<string | undefined>,
): Promise<UnknownRecord[]> {
  return Promise.all(messages.map(async message => Array.isArray(message.content)
    ? { ...message, content: await textOnlyBlocks(message.content as UnknownRecord[], materialize) }
    : message))
}

export interface CompanionRouteOptions {
  /** The existing DSH route this companion forwards to. */
  originalId: string
  /** Model ids the host configuration declared image admission for. */
  imageModels: Set<string>
  llm: DshLlmLike
  /**
   * Give a stored image attachment a filesystem path (cached per attachment).
   * Absent or failing, the text notice simply omits the path.
   */
  materializeImage?: (attachment: UnknownRecord) => Promise<string | undefined>
}

/**
 * A DSH route that admits images on behalf of a text-only route — the
 * single-directory answer to host configuration declaring
 * `input: ["text", "image"]` for models of a route this bridge does not own.
 * The companion honestly declares image input (so the host's admission and
 * model-switch checks pass), replaces image blocks with an explicit notice,
 * and forwards every call to the original route. It never carries a wire
 * transport of its own; the images themselves are served by whatever vision
 * extension handles the turn's entering messages.
 */
export function imageAdmissionCompanionAdapter(options: CompanionRouteOptions): UnknownRecord {
  const { originalId, imageModels, llm } = options
  const materialize = options.materializeImage ?? (async () => undefined)
  const admitImage = (info: UnknownRecord, id: string): UnknownRecord => {
    const modalities = Array.isArray(info.inputModalities) ? (info.inputModalities as string[]).slice() : ['text']
    if (!modalities.includes('image')) modalities.push('image')
    return { ...info, provider: id, inputModalities: modalities }
  }
  return {
    providerInfo: (id: string) => {
      const origin = llm.listProviders().find(provider => provider.id === originalId)
      return { id, name: `${origin?.name ?? originalId} + Vision Bridge` }
    },
    providerRetryPolicy: () => undefined,
    // The directory face mirrors the original route's own entries — the
    // service layer has already normalized them, so this is a DSH→DSH
    // carriage, not a cross-vocabulary one. Only the models the user
    // declared image input for are listed; others stay on the original.
    listModels: async (id: string) => (await llm.listModels(originalId))
      .filter(model => imageModels.has(String(model.id)))
      .map(model => admitImage(model, id)),
    resolveModel: async (id: string, modelId: string) => {
      const info = await llm.resolveModelInfo(originalId, modelId)
      return imageModels.has(modelId) ? admitImage(info, id) : { ...info, provider: id }
    },
    async *stream(streamOptions: UnknownRecord): AsyncIterable<UnknownRecord> {
      yield* llm.stream({
        ...streamOptions,
        provider: originalId,
        ...(Array.isArray(streamOptions.messages)
          ? { messages: await textOnlyMessages(streamOptions.messages as UnknownRecord[], materialize) }
          : {}),
      })
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
  if (!providerCarriesTransport(provider)) {
    // Model transports belong to the host. A catalog-only registration gets
    // no bridge-synthesized wire client; the same gateway is host
    // configuration (the official llm-pi-ai adapter's settings).
    host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} declares a model catalog but no transport; it was not added as a DSH llm route — configure the gateway in the host's llm settings instead`)
    return undefined
  }
  try {
    return llm.registerAdapter([providerId], piProviderDshAdapter(providerId, provider, host))
  } catch (error) {
    host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} was not added as a DSH llm route (${error instanceof Error ? error.message : String(error)}); the existing route keeps the name`)
    return undefined
  }
}
