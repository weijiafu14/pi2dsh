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

import { LlmError } from '@deepseek-ai/dsh-llm'
import { blocksContainImage, dshRequestToPiContext, piEventsToDshChunks, type DshAttachmentsLike, type DshLlmLike } from './model-bridge.js'
import { getSupportedThinkingLevels } from './compat/pi-ai.js'

type UnknownRecord = Record<string, unknown>

interface PiTransportProvider {
  // `streamSimple` is the portable half of Pi's Provider contract — required
  // by the interface, and the only entry point that translates a reasoning
  // level into each API's own dialect. `stream` takes per-API concrete options
  // instead, so it is the fallback for a package that hand-rolls a provider
  // object rather than building one through Pi's factory.
  streamSimple?(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord>
  stream?(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord>
  getModels?(): UnknownRecord[]
  name?: unknown
  [key: string]: unknown
}

export interface ProviderAdapterHost {
  /** Pi's full credential chain for this provider (stored OAuth → stored key → ambient env). */
  resolveAuth(): Promise<{ auth?: UnknownRecord } | undefined>
  warn(message: string): void
  /** The durable attachment store, when the composition mounts one. */
  resolveAttachments?(): DshAttachmentsLike | undefined
}

export function providerCarriesTransport(value: UnknownRecord | undefined): value is PiTransportProvider & UnknownRecord {
  return typeof value?.streamSimple === 'function' || typeof value?.stream === 'function'
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

/**
 * Model capabilities DSH asks about by its own names. Shared by the catalog
 * listing and the exact-route resolve deliberately: a capability present in
 * one and absent from the other is how a model silently loses an ability —
 * the host consults the resolve before a request, so a modality declared only
 * in the listing reads as "text only" at the moment it matters.
 * @param model - the Pi model descriptor as its package declared it.
 */
function capabilityProjection(model: UnknownRecord): UnknownRecord {
  if (!Array.isArray(model.input)) return {}
  const modalities = (model.input as unknown[])
    .filter((entry): entry is string => entry === 'text' || entry === 'image')
  return modalities.length === 0 ? {} : { inputModalities: modalities }
}

/**
 * Pi's reasoning capability, in DSH's shape.
 *
 * The two sides say the same thing differently: Pi carries a `reasoning`
 * boolean plus a `thinkingLevelMap` whose `null` entries mark unsupported
 * levels, while DSH asks an adapter for the selectable efforts directly.
 * Translating is this layer's job — carrying Pi's boolean through under the
 * name `reasoning` would collide with DSH's `{efforts}` object, and carrying
 * nothing (what this bridge did before) leaves every package-registered route
 * with no selectable effort at all, so any reasoning request is rejected.
 *
 * The mapping is DSH's own: its native pi-ai adapter derives efforts from
 * `getSupportedThinkingLevels` and names them the same way, so a route a Pi
 * package registers offers exactly the efforts it would through the host's
 * own adapter. It belongs to the exact-route resolve, not the catalog listing
 * — `reasoning` is a resolved-model field in DSH's contract.
 * @param model - the Pi model descriptor as its package declared it.
 */
function reasoningProjection(model: UnknownRecord): UnknownRecord {
  if (model.reasoning !== true) return {}
  const levels = getSupportedThinkingLevels(model as never)
  if (levels.length === 0) return {}
  return {
    reasoning: {
      efforts: levels.map(level => ({
        id: level,
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
    },
  }
}

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
  let warnedStop = false
  const warnStopUnsupported = (): void => {
    if (warnedStop) return
    warnedStop = true
    host.warn(
      `[pi2dsh] a request to Pi provider ${JSON.stringify(providerId)} carries stop sequences, which Pi models at`
      + ' no layer — they cannot be forwarded, so the model will not halt on them',
    )
  }
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
      ...capabilityProjection(model),
      provider: id,
      id: String(model.id ?? ''),
      name: String(model.name ?? model.id ?? ''),
    })),
    resolveModel: async (id: string, modelId: string) => {
      const known = providerModels(provider).find(model => model.id === modelId)
      return {
        ...(known === undefined ? {} : piCarriedFields(known)),
        ...(known === undefined ? {} : capabilityProjection(known)),
        ...(known === undefined ? {} : reasoningProjection(known)),
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
      // Images are read through the attachment service, exactly as DSH's own
      // pi-ai adapter reads them — and refused under DSH's own code when they
      // cannot be. Dropping them silently (what this bridge did) sends the
      // model a request about an image it was never given, and the answer
      // reads as a model failure rather than a missing capability.
      const messages = Array.isArray(options.messages) ? options.messages as UnknownRecord[] : []
      const carriesImage = messages.some(message => blocksContainImage(message.content))
      if (carriesImage) {
        const declared = Array.isArray(model.input) ? model.input as unknown[] : []
        if (!declared.includes('image')) {
          throw new LlmError(`pi2dsh: model "${modelId}" does not declare image input`, 'UNSUPPORTED_CONTENT')
        }
      }
      const attachments = carriesImage ? host.resolveAttachments?.() : undefined
      if (carriesImage && attachments === undefined) {
        throw new LlmError('pi2dsh: image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const piContext = await dshRequestToPiContext(options, attachments)
      const effort = typeof options.reasoningEffort === 'string' ? options.reasoningEffort : undefined
      const piOptions: UnknownRecord = {
        ...(auth?.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
        ...(auth?.baseUrl === undefined ? {} : { baseUrl: auth.baseUrl }),
        ...(auth?.headers === undefined ? {} : { headers: auth.headers }),
        ...(options.signal instanceof AbortSignal ? { signal: options.signal } : {}),
        ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
        ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
        // DSH stamps the session so an adapter can map it to model-hidden
        // transport metadata; Pi spells the same field the same way, and its
        // providers use it for prompt-cache affinity and request routing.
        ...(typeof options.sessionId === 'string' ? { sessionId: options.sessionId } : {}),
        // The effort the user picked, under the name Pi's PORTABLE entry point
        // reads. Two reasons it is not the per-API `reasoningEffort`:
        //
        //  - `reasoningEffort` exists only on the two OpenAI-family APIs, so
        //    on an anthropic or google route the chosen effort would be an
        //    unrecognized option — selected, yet silently inert.
        //  - `off` is a level Pi lists for every reasoning model, so it is a
        //    level the user can pick. It has to be sent as ABSENCE: the string
        //    reads as truthy on the OpenAI-compatible path, which would turn
        //    thinking on for the one choice that means turn it off. Omitting
        //    the field is exactly what Pi's own streamSimple does with it.
        ...(effort === undefined || effort === 'off' ? {} : { reasoning: effort }),
      }
      // The capacity travels with the stream because two of the three
      // context-overflow signals are usage-based: the providers that accept an
      // oversized request and answer normally, or truncate it and stop on
      // `length`, say nothing an error string could be matched against.
      const contextWindow = typeof model.contextWindow === 'number' ? model.contextWindow : undefined
      // Pi models no stop sequences at any layer, so a request carrying them
      // cannot be served faithfully — and dropping them silently changes what
      // the model returns. Said once per route, not once per request.
      if (Array.isArray(options.stop) && options.stop.length > 0) warnStopUnsupported()
      if (typeof provider.streamSimple === 'function') {
        yield* piEventsToDshChunks(provider.streamSimple(model, piContext, piOptions), contextWindow)
        return
      }
      // A hand-rolled provider object carrying only `stream`: that entry point
      // takes per-API options, so the level is spelled the way the
      // OpenAI-family APIs read it. `off` stays absent for the same reason.
      const { reasoning, ...rest } = piOptions
      yield* piEventsToDshChunks(
        provider.stream!(model, piContext, reasoning === undefined ? rest : { ...rest, reasoningEffort: reasoning }),
        contextWindow,
      )
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
  /** Model ids to admit images for; absent = every model of the route. */
  imageModels?: Set<string>
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
  const { originalId, llm } = options
  const admits = (modelId: string): boolean => options.imageModels === undefined || options.imageModels.has(modelId)
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
      .filter(model => admits(String(model.id)))
      .map(model => admitImage(model, id)),
    resolveModel: async (id: string, modelId: string) => {
      const info = await llm.resolveModelInfo(originalId, modelId)
      return admits(modelId) ? admitImage(info, id) : { ...info, provider: id }
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
  /** The bridge's own context, used to mount DSH's official adapter for a catalog-only route. */
  ctx?: { plugin(plugin: unknown, config?: unknown): unknown }
}

/**
 * Serve a catalog-only Pi provider through DSH's OWN llm adapter.
 *
 * A Pi package may declare a gateway without shipping any code to call it —
 * on Pi that is complete, because pi-ai supplies the transport for the wire
 * protocol the models name. The bridge used to refuse those and tell the user
 * to configure the gateway by hand in DSH settings, which is the translation
 * this package exists to do for them.
 *
 * The translation is configuration, not transport: the declaration becomes an
 * `llm-pi-ai` provider profile — the official adapter's own shape, which
 * carries `api`, `baseURL` and per-model `compat` — and that official plugin
 * is mounted with it. Nothing here speaks HTTP.
 * @returns a disposer for the mounted route, or undefined when it cannot be built.
 */
function registerCatalogOnlyRoute(options: RegisterPiProviderRouteOptions): (() => void) | undefined {
  const { ctx, providerId, provider, host } = options
  const models = providerModels(provider as PiTransportProvider)
  if (ctx === undefined) return undefined
  // An empty list at mount is normal, not a defect: a package may discover its
  // models from the gateway later, or rely on pi-ai's installed catalog for a
  // known provider name. The official profile's `models` is optional and
  // omitting it serves that installed catalog, so a route is still built —
  // refusing here would drop a provider that works the moment it is used.
  const first = (models[0] ?? provider) as UnknownRecord
  const profile: UnknownRecord = {
    displayName: typeof provider.name === 'string' ? provider.name : providerId,
    ...(typeof first.api === 'string' ? { api: first.api } : {}),
    ...(typeof first.baseUrl === 'string' ? { baseURL: first.baseUrl } : {}),
    ...(models.length === 0 ? {} : { models: models.map(model => ({
      id: String(model.id ?? ''),
      ...(typeof model.name === 'string' ? { name: model.name } : {}),
      ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
      ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
      ...(Array.isArray(model.input) ? { input: model.input } : {}),
      // The gateway's dialect, which is the whole reason these packages exist.
      ...(model.compat === undefined ? {} : { compat: model.compat }),
    })) }),
  }
  let mounted: { dispose?: () => void } | undefined
  let disposed = false
  void (async () => {
    try {
      const official = await import('@deepseek-ai/dsh-llm-pi-ai')
      const fiber = await ctx.plugin(
        (official as UnknownRecord).default ?? official,
        { providers: { [providerId]: profile } },
      ) as { dispose?: () => void }
      if (disposed) fiber?.dispose?.()
      else mounted = fiber
      host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} declares a catalog only; it is served by DSH's official llm-pi-ai adapter as a native route`)
    } catch (error) {
      host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} could not be served by the official adapter (${error instanceof Error ? error.message : String(error)}); configure the gateway in the host's llm settings instead`)
    }
  })()
  return () => {
    disposed = true
    mounted?.dispose?.()
  }
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
  // A catalog-only declaration is complete on Pi (pi-ai supplies the transport
  // for the declared protocol), so it must be complete here too — served by
  // DSH's own adapter rather than refused back to the user as configuration
  // homework.
  if (!providerCarriesTransport(provider)) return registerCatalogOnlyRoute(options)
  try {
    return llm.registerAdapter([providerId], piProviderDshAdapter(providerId, provider, host))
  } catch (error) {
    host.warn(`[pi2dsh] Pi provider ${JSON.stringify(providerId)} was not added as a DSH llm route (${error instanceof Error ? error.message : String(error)}); the existing route keeps the name`)
    return undefined
  }
}
