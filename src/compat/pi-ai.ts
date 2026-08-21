// Headless @earendil-works/pi-ai compatibility surface.
//
// Provider SDKs, OAuth flows, and streaming transports stay native to DSH;
// this module carries the schema helpers, error classifiers, and thinking-
// level math that Pi extensions import for their own logic. Overflow/retry
// classifiers are vendored byte-identical (see ./vendor/PI-LICENSE) so
// pattern tables stay in sync with Pi.

import { AsyncLocalStorage } from 'node:async_hooks'

export type { Static, TSchema } from 'typebox'
export { Type } from 'typebox'
export { isContextOverflow, isRecoverableLength } from './vendor/pi-ai-overflow.js'
export { isRetryableAssistantError } from './vendor/pi-ai-retry.js'
export { uuidv7 } from './vendor/pi-uuid.js'
export type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolResultMessage,
  Usage,
  UserMessage,
} from './vendor/pi-types.js'

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ModelThinkingLevel = 'off' | ThinkingLevel
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>
export type Api = string

export interface Model<TApi extends Api = Api> {
  id: string
  name?: string
  api?: TApi
  provider?: string
  baseUrl?: string
  reasoning?: boolean
  thinkingLevelMap?: ThinkingLevelMap
  input?: readonly ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  [key: string]: unknown
}

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[] {
  return EXTENDED_THINKING_LEVELS.filter(level => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}

export function clampThinkingLevel<TApi extends Api>(
  model: Model<TApi>,
  level: ModelThinkingLevel,
): ModelThinkingLevel {
  const availableLevels = getSupportedThinkingLevels(model)
  if (availableLevels.includes(level)) return level
  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level)
  if (requestedIndex === -1) return availableLevels[0] ?? 'off'
  for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i += 1) {
    const candidate = EXTENDED_THINKING_LEVELS[i]!
    if (availableLevels.includes(candidate)) return candidate
  }
  for (let i = requestedIndex - 1; i >= 0; i -= 1) {
    const candidate = EXTENDED_THINKING_LEVELS[i]!
    if (availableLevels.includes(candidate)) return candidate
  }
  return availableLevels[0] ?? 'off'
}

export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  return a.id === b.id && a.provider === b.provider
}

interface TextishContent {
  type: string
  text?: string
  [key: string]: unknown
}

export function contentText(content: string | readonly TextishContent[], separator = '\n'): string {
  if (typeof content === 'string') return content
  return content
    .filter(block => block.type === 'text')
    .map(block => String(block.text ?? ''))
    .join(separator)
}

// Legacy pi-ai/compat global-registry API. The registry is bridge-local:
// providers registered here are visible to the same package but never route
// real model calls (DSH llm adapters own those).
interface PiAiRuntimeRegistry {
  compatProviders: Map<string, unknown>
  apiProviders: Map<string, { provider: CompatApiProvider, sourceId: string | undefined }>
}

const globalRegistry: PiAiRuntimeRegistry = {
  compatProviders: new Map(),
  apiProviders: new Map(),
}
const scopedRegistry = new AsyncLocalStorage<PiAiRuntimeRegistry>()

const registry = (): PiAiRuntimeRegistry => scopedRegistry.getStore() ?? globalRegistry

/** Create one isolated copy of Pi's process registries for an Agent runtime. */
export function __createPiAiRuntimeRegistry(): PiAiRuntimeRegistry {
  return { compatProviders: new Map(), apiProviders: new Map() }
}

export function registerProvider(name: string, provider: unknown): void {
  registry().compatProviders.set(name, provider)
}

// Pi's compat getProviders() returns provider NAMES (callers iterate and
// Set() them).
export function getProviders(): string[] {
  return [...registry().compatProviders.keys()]
}

export function getProvider(name: string): unknown {
  return registry().compatProviders.get(name)
}

export function getModel(_provider: string, _id: string): undefined {
  return undefined
}

// Pi exports both spellings of these three (`getModels` is an alias for
// `getBuiltinModels`, and the providers/all entry uses the builtin spelling).
// A package importing the name we happened not to export throws at load and
// takes its whole package down, which reads as "the plugin is broken".
export const getBuiltinModels = (provider?: string): unknown[] => getModels(provider)
export const getBuiltinModel = (provider: string, id: string): undefined => getModel(provider, id)
export const getBuiltinProviders = (): string[] => getProviders()

export function getModels(_provider?: string): unknown[] {
  return []
}

// Provider declaration factory, vendored from Pi (provider packages like
// pi-provider-litellm build their provider object with it at load time and
// hand it to pi.registerProvider). Model TRANSPORT stays native to DSH llm:
// the lazy API factories below return Pi's exact lazy-stream surface, and if
// a stream is ever actually requested the setup fails through Pi's own error
// channel (an error event on the stream) instead of pretending to call a model.
export { createProvider, ModelsError } from './vendor/pi-ai-provider.js'
export { lazyApi, lazyStream } from './vendor/pi-ai-lazy.js'
export { AssistantMessageEventStream } from './vendor/pi-ai-event-stream.js'

// A transport-owning provider package is different from a package merely
// asking Pi to call a model: it deliberately builds its own wire client and
// hands that transport to registerProvider(). pi-grok is one such package —
// its stream wrapper delegates to Pi's standard Responses implementation and
// relies on that implementation's onPayload seam. Export the REAL helper so
// the package keeps owning the request body while pi2dsh wraps the finished
// provider as a native DSH llm adapter. This dependency is bundled into the
// shim artifact; the installed package does not need its own pi-ai runtime.
export { streamSimple as streamSimpleOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'


// Pi's official OAuth flows, vendored byte-identical: OpenAI Codex
// (PKCE + localhost:1455 callback server, device-code fallback), Anthropic,
// GitHub Copilot, Kimi Coding. Each exposes pi-ai's native oauth surface
// (login(interaction)/refresh/toAuth) and runs its real protocol against the
// real endpoints — account packages like @narumitw/pi-accounts load them
// through builtinProviders()/the lazy loaders below.
export { openaiCodexOAuth } from './vendor/pi-oauth-flows/openai-codex.js'
export { anthropicOAuth } from './vendor/pi-oauth-flows/anthropic.js'
export { githubCopilotOAuth } from './vendor/pi-oauth-flows/github-copilot.js'
export { kimiCodingOAuth } from './vendor/pi-oauth-flows/kimi-coding.js'
export { generatePKCE } from './vendor/pi-oauth-flows/pkce.js'
export { pollOAuthDeviceCodeFlow } from './vendor/pi-oauth-flows/device-code.js'

import { openaiCodexOAuth as codexFlow } from './vendor/pi-oauth-flows/openai-codex.js'
import { anthropicOAuth as anthropicFlow } from './vendor/pi-oauth-flows/anthropic.js'
import { githubCopilotOAuth as copilotFlow } from './vendor/pi-oauth-flows/github-copilot.js'
import { kimiCodingOAuth as kimiFlow } from './vendor/pi-oauth-flows/kimi-coding.js'

// The provider catalog surface account packages consume: id + the real OAuth
// flow. Model catalogs stay empty — model routing is DSH-native in this host.
export function builtinProviders(): Array<{ id: string, name: string, api: string, baseUrl: string, models: never[], auth: { oauth: unknown } }> {
  const entry = (id: string, name: string, baseUrl: string, oauth: unknown) => ({
    id, name, api: 'openai-completions', baseUrl, models: [] as never[], auth: { oauth },
  })
  return [
    entry('openai-codex', 'OpenAI (ChatGPT Plus/Pro)', 'https://chatgpt.com/backend-api/codex', codexFlow),
    entry('anthropic', 'Anthropic', 'https://api.anthropic.com', anthropicFlow),
    entry('github-copilot', 'GitHub Copilot', 'https://api.githubcopilot.com', copilotFlow),
    entry('kimi-coding', 'Kimi Code', 'https://api.moonshot.ai/anthropic', kimiFlow),
  ]
}

export const loadOpenAICodexOAuth = async (): Promise<unknown> => codexFlow
export const loadAnthropicOAuth = async (): Promise<unknown> => anthropicFlow
export const loadGitHubCopilotOAuth = async (): Promise<unknown> => copilotFlow
export const loadKimiCodingOAuth = async (): Promise<unknown> => kimiFlow

// pi-ai/compat's process-wide api-provider registry, same semantics as
// upstream: one entry per api id, streams wrapped with an api-match guard,
// unregistration scoped to the owning sourceId. Packages use it as a shared
// fallback table (pi-provider-kimi-code registers stream handlers here inside
// a try/catch it designed for hosts without the module) — providing the real
// surface keeps that optional path working instead of turning a resolvable
// import with a missing export into a crash.
interface CompatApiProvider {
  api: string
  stream: (...args: unknown[]) => unknown
  streamSimple: (...args: unknown[]) => unknown
}

function guardApi(api: string, fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  return (model: unknown, ...rest: unknown[]) => {
    const modelApi = (model as { api?: unknown } | undefined)?.api
    if (modelApi !== api) throw new Error(`Mismatched api: ${String(modelApi)} expected ${api}`)
    return fn(model, ...rest)
  }
}

export function registerApiProvider(provider: CompatApiProvider, sourceId?: string): void {
  registry().apiProviders.set(provider.api, {
    provider: {
      api: provider.api,
      stream: guardApi(provider.api, provider.stream),
      streamSimple: guardApi(provider.api, provider.streamSimple),
    },
    sourceId,
  })
}

export function getApiProvider(api: string): CompatApiProvider | undefined {
  return registry().apiProviders.get(api)?.provider
}

export function getApiProviders(): CompatApiProvider[] {
  return Array.from(registry().apiProviders.values(), entry => entry.provider)
}

export function unregisterApiProviders(sourceId: string): void {
  const providers = registry().apiProviders
  for (const [api, entry] of providers.entries()) {
    if (entry.sourceId === sourceId) providers.delete(api)
  }
}

// Designated-model calls. When a pi2dsh runtime with a mounted DSH llm
// service is active, complete()/stream() run REAL model calls through
// ctx.llm.stream() (the host installs the bridge at mount). Without one, the
// explicit-failure contract stands — never a fabricated response.
type PiAiLlmBridge = (model: UnknownRecord, context: UnknownRecord, options: UnknownRecord | undefined) => {
  result(): Promise<unknown>
  [Symbol.asyncIterator](): AsyncIterator<unknown>
}

type UnknownRecord = Record<string, unknown>

let activeLlmBridge: PiAiLlmBridge | undefined
const scopedLlmBridge = new AsyncLocalStorage<PiAiLlmBridge | undefined>()

export function __setPiAiLlmBridge(bridge: PiAiLlmBridge | undefined): void {
  activeLlmBridge = bridge
}

/** Run extension-owned work with the exact Agent runtime's DSH llm bridge. */
export function __runWithPiAiLlmBridge<T>(
  bridge: PiAiLlmBridge | undefined,
  callback: () => T,
): T {
  return scopedLlmBridge.run(bridge, callback)
}

/** Bind both designated-model routing and Pi's registries to one Agent runtime. */
export function __runWithPiAiRuntime<T>(
  bridge: PiAiLlmBridge | undefined,
  runtimeRegistry: PiAiRuntimeRegistry,
  callback: () => T,
): T {
  return scopedRegistry.run(runtimeRegistry, () => scopedLlmBridge.run(bridge, callback))
}

// Internal bridge access for the pi-coding-agent shim: the vendored
// summarization/compaction functions take Pi's own streamFn injection point,
// and pi2dsh injects this bridge there so every model call runs on the ONE
// path (the DSH llm route). Undefined without a mounted llm service — the
// vendored fallback then fails loud instead of reaching a provider SDK.
export function __getPiAiLlmBridge(): PiAiLlmBridge | undefined {
  return scopedLlmBridge.getStore() ?? activeLlmBridge
}

function requireLlmBridge(api: string): PiAiLlmBridge {
  const bridge = __getPiAiLlmBridge()
  if (bridge === undefined) {
    throw new Error(`pi2dsh: pi-ai ${api}() needs a DSH llm service; this composition mounts none, so model calls cannot be routed`)
  }
  return bridge
}

export async function complete(model: UnknownRecord, context: UnknownRecord, options?: UnknownRecord): Promise<unknown> {
  const stream = requireLlmBridge('complete')(model, context, options)
  const result = await stream.result()
  if (result instanceof Error) throw result
  return result
}

export function stream(model: UnknownRecord, context: UnknownRecord, options?: UnknownRecord): unknown {
  return requireLlmBridge('stream')(model, context, options)
}

/**
 * Pi's per-protocol transport factories.
 *
 * Pi ships one factory per wire protocol (`pi-ai/compat`), and a gateway
 * package's most common shape is to take the standard one for its protocol and
 * hand it to `registerProvider`. Without these names such a package throws at
 * import — `openAICompletionsApi is not a function` — and the whole package
 * fails to mount, which reads as "the plugin is broken" rather than "the bridge
 * is missing an export".
 *
 * The provider each returns is not a wire client: its stream is the same DSH
 * llm route `complete()` and `stream()` already run on, so every model call in
 * this process keeps going through the one directory and the one path. Without
 * a mounted llm service it fails loud rather than reaching a provider SDK.
 * @param api - the protocol id this factory serves.
 * @returns a provider carrying that protocol's id and the routed stream.
 */
function routedApi(api: string): { api: string, stream: PiAiLlmBridge, streamSimple: PiAiLlmBridge } {
  const routed: PiAiLlmBridge = (model, context, options) => requireLlmBridge(api)(model, context, options)
  return { api, stream: routed, streamSimple: routed }
}

export const anthropicMessagesApi = (): ReturnType<typeof routedApi> => routedApi('anthropic-messages')
export const openAICompletionsApi = (): ReturnType<typeof routedApi> => routedApi('openai-completions')
export const openAIResponsesApi = (): ReturnType<typeof routedApi> => routedApi('openai-responses')
export const openAICodexResponsesApi = (): ReturnType<typeof routedApi> => routedApi('openai-codex-responses')
export const azureOpenAIResponsesApi = (): ReturnType<typeof routedApi> => routedApi('azure-openai-responses')
export const googleGenerativeAIApi = (): ReturnType<typeof routedApi> => routedApi('google-generative-ai')
export const googleVertexApi = (): ReturnType<typeof routedApi> => routedApi('google-vertex')
export const mistralConversationsApi = (): ReturnType<typeof routedApi> => routedApi('mistral-conversations')
export const bedrockConverseStreamApi = (): ReturnType<typeof routedApi> => routedApi('bedrock-converse-stream')
export const piMessagesApi = (): ReturnType<typeof routedApi> => routedApi('pi-messages')

export interface StringEnumOptions<T extends readonly string[]> {
  description?: string
  default?: T[number]
}

export function StringEnum<T extends readonly string[]>(
  values: T,
  options: StringEnumOptions<T> = {},
): { type: 'string'; enum: T; description?: string; default?: T[number] } {
  return {
    type: 'string',
    enum: values,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.default !== undefined ? { default: options.default } : {}),
  }
}
