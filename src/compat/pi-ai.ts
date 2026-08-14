// Headless @earendil-works/pi-ai compatibility surface.
//
// Provider SDKs, OAuth flows, and streaming transports stay native to DSH;
// this module carries the schema helpers, error classifiers, and thinking-
// level math that Pi extensions import for their own logic. Overflow/retry
// classifiers are vendored byte-identical (see ./vendor/PI-LICENSE) so
// pattern tables stay in sync with Pi.

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
const compatProviders = new Map<string, unknown>()

export function registerProvider(name: string, provider: unknown): void {
  compatProviders.set(name, provider)
}

// Pi's compat getProviders() returns provider NAMES (callers iterate and
// Set() them).
export function getProviders(): string[] {
  return [...compatProviders.keys()]
}

export function getProvider(name: string): unknown {
  return compatProviders.get(name)
}

export function getModel(_provider: string, _id: string): undefined {
  return undefined
}

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

import { lazyApi as lazyApiForCompat } from './vendor/pi-ai-lazy.js'

function unbridgedTransport(api: string): never {
  throw new Error(`pi2dsh: the ${api} protocol client is not bridged; model transports stay native to DSH llm/credentials`)
}

export function openAICompletionsApi(): unknown {
  return lazyApiForCompat(async () => unbridgedTransport('openai-completions'), undefined)
}

export function openAIResponsesApi(): unknown {
  return lazyApiForCompat(async () => unbridgedTransport('openai-responses'), { fetchDeferred: true, cancelDeferred: true })
}

export function anthropicMessagesApi(): unknown {
  return lazyApiForCompat(async () => unbridgedTransport('anthropic-messages'), undefined)
}

export function complete(..._args: unknown[]): never {
  throw new Error('pi2dsh: pi-ai complete() routes model calls through Pi provider SDKs; use DSH llm adapters instead')
}

export function stream(..._args: unknown[]): never {
  throw new Error('pi2dsh: pi-ai stream() routes model calls through Pi provider SDKs; use DSH llm adapters instead')
}

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
