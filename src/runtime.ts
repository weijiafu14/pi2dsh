import { access, readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createJiti } from 'jiti'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {
  PostToolDecision,
  PreToolDecision,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import type { GeneratedRuntimeManifest } from './types.js'
import { PiSessionBridge } from './session-bridge.js'
import { ExtensionRunner, Theme, __setSubagentSessionFactory, getAgentDir } from './compat/pi-coding-agent.js'
import { createBridgedAgentSession } from './subagent-bridge.js'
import {
  FileCredentialStore,
  loginPiProvider,
  providerSupportsOAuth,
  resolvePiProviderAuth,
} from './oauth-bridge.js'
import { __setPiAiLlmBridge, builtinProviders, realBuiltinProvider } from './compat/pi-ai.js'
import { ModelCatalog, llmOf, streamViaDshLlm } from './model-bridge.js'
import { registerPiProviderRoute } from './provider-adapter.js'

type UnknownRecord = Record<string, unknown>
type PiHandler = (event: UnknownRecord, context: UnknownRecord) => unknown | Promise<unknown>

interface RuntimeOptions {
  rootUrl: URL
  manifest: GeneratedRuntimeManifest
  config?: UnknownRecord
}

interface PiTool {
  name: string
  label?: string
  description: string
  parameters: unknown
  executionMode?: 'parallel' | 'sequential'
  prepareArguments?: (args: unknown) => unknown
  execute(
    toolCallId: string,
    args: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((result: unknown) => void) | undefined,
    context: UnknownRecord,
  ): Promise<unknown>
}

interface PiCommand {
  name: string
  description: string
  argumentHint?: string
  handler(args: string, context: UnknownRecord): unknown | Promise<unknown>
}

interface RuntimeState {
  handlers: Map<string, PiHandler[]>
  tools: Map<string, PiTool>
  // The Pi runner facade tool-catalog packages (pi-fabric) hook by patching
  // ExtensionRunner.prototype.getAllRegisteredTools; enumeration of Pi tools
  // goes through it so a patched prototype really filters the catalog.
  runner: ExtensionRunner
  toolDisposers: Map<string, () => void>
  toolRestrictions: WeakMap<object, () => void>
  pendingActiveTools?: string[]
  commands: Map<string, PiCommand>
  flags: Map<string, boolean | string | undefined>
  notifications: string[]
  activeAgents: Set<UnknownRecord>
  disposedAgents: WeakSet<object>
  currentSystemPrompt: string
  messageSource: string
  eventBus: EventEmitter
  agentScope: AsyncLocalStorage<UnknownRecord | undefined>
  bridge: PiSessionBridge
  theme: Theme
  // Registered-but-headless surfaces: accepted so packages load and can
  // introspect their own registrations; DSH owns actual presentation.
  shortcuts: Map<string, UnknownRecord>
  messageRenderers: Map<string, unknown>
  entryRenderers: Map<string, unknown>
  markdownTransformer?: unknown
  providers: Map<string, UnknownRecord>
  // Pi-format auth.json store, created on first OAuth use; per-provider
  // serialized writes, atomic 0600 persistence (see oauth-bridge).
  oauthStore?: FileCredentialStore
  loginCommandRegistered?: boolean
  autocompleteProviders: unknown[]
  editorComponentFactory?: unknown
  editorBuffers: WeakMap<object, string>
  toolsExpanded: boolean
  // Per-agent model/thinking overrides applied through the agent/request waterfall.
  modelOverrides: WeakMap<object, { provider?: string; model?: string }>
  thinkingLevels: WeakMap<object, string>
  globalThinkingLevel: string
  // Pi tool_call handlers mutate event.input in place; mutations apply to
  // pi2dsh-owned tools through this channel (DSH core deliberately forbids
  // rewriting exec.arguments for native tools).
  argMutations: WeakMap<object, unknown>
  // Streaming accumulation for message_update projection from assistant/chunk.
  streamingTexts: Map<string, string>
  // Last model id seen in a request/header event, for model_select projection.
  lastLoggedModels: WeakMap<object, string>
  // Pi Model catalog projected from the DSH llm service (empty without one).
  modelCatalog?: ModelCatalog
  // Live DSH llm routes registered for transport-carrying Pi providers.
  providerRouteDisposers: Map<string, () => void>
}

interface PiExecOptions {
  signal?: AbortSignal
  timeout?: number
  cwd?: string
}

interface DshSubprocessHandle {
  collected: {
    stdout?: { readFrom(offset: number): { text: string; lossy: boolean } }
    stderr?: { readFrom(offset: number): { text: string; lossy: boolean } }
  }
  done: Promise<{ exitCode: number | null; signal: string | null }>
}

interface DshSubprocessService {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: UnknownRecord): DshSubprocessHandle
}

interface DshAgent extends UnknownRecord {
  steer(message: unknown): void
  followup(message: unknown): void
  inject(message: unknown): void
}

function logger(ctx: Context): { warn(message: string): void; info(message: string): void; debug(message: string): void } {
  const candidate = (ctx as unknown as { logger?: Partial<ReturnType<typeof logger>> }).logger
  return {
    warn: message => candidate?.warn?.(message) ?? console.warn(message),
    info: message => candidate?.info?.(message) ?? console.info(message),
    debug: message => candidate?.debug?.(message) ?? undefined,
  }
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return String(value)
  }
}

function textBlocks(content: unknown): Array<{ type: 'text'; text: string }> {
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }]
  return content.map((block): { type: 'text'; text: string } => {
    if (typeof block === 'object' && block !== null && (block as UnknownRecord).type === 'text') {
      return { type: 'text', text: String((block as UnknownRecord).text ?? '') }
    }
    if (typeof block === 'object' && block !== null && (block as UnknownRecord).type === 'image') {
      const mime = String((block as UnknownRecord).mimeType ?? 'image')
      return { type: 'text', text: `[Pi tool returned ${mime}; binary image output requires a native DSH attachment adapter]` }
    }
    return { type: 'text', text: String(block) }
  })
}

function normalizeToolResult(result: unknown): UnknownRecord {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { content: [{ type: 'text', text: String(result ?? '') }], details: null }
  }
  const record = result as UnknownRecord
  return {
    content: textBlocks(record.content),
    details: jsonValue(record.details),
    ...(record.isError === true ? { isError: true } : {}),
    ...(record.usage !== undefined ? { usage: jsonValue(record.usage) } : {}),
    ...(record.terminate === true ? { terminate: true } : {}),
  }
}

async function piToDshContent(ctx: Context, content: unknown): Promise<ContentBlock[]> {
  const values = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]
  const blocks: ContentBlock[] = []
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      blocks.push({ type: 'text', text: String(value) })
      continue
    }
    const block = value as UnknownRecord
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: String(block.text ?? '') })
      continue
    }
    if (block.type !== 'image') {
      blocks.push({ type: 'text', text: String(value) })
      continue
    }
    const attachments = optionalService<{
      saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<UnknownRecord>
    }>(ctx, 'attachments')
    if (attachments === undefined) {
      throw new Error('pi2dsh: Pi image content requires the DSH attachments service')
    }
    if (typeof block.data !== 'string' || typeof block.mimeType !== 'string') {
      throw new TypeError('pi2dsh: Pi image content requires base64 data and mimeType')
    }
    const attachment = await attachments.saveImage({
      data: Buffer.from(block.data, 'base64'),
      mediaType: block.mimeType,
      ...(typeof block.name === 'string' ? { name: block.name } : {}),
    })
    blocks.push({ type: 'image', attachment } as unknown as ContentBlock)
  }
  return blocks
}

async function normalizeToolResultForDsh(ctx: Context, result: unknown): Promise<UnknownRecord> {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { content: [{ type: 'text', text: String(result ?? '') }], details: null }
  }
  const record = result as UnknownRecord
  return {
    content: await piToDshContent(ctx, record.content),
    details: jsonValue(record.details),
    ...(record.isError === true ? { isError: true } : {}),
    ...(record.usage !== undefined ? { usage: jsonValue(record.usage) } : {}),
    ...(record.terminate === true ? { terminate: true } : {}),
  }
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  'type', 'oneOf', 'anyOf', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'description', 'title', 'default', 'examples',
])

function normalizeSchemaNode(value: unknown, path: string, warnings: string[]): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    warnings.push(`${path}: non-object schema replaced with unconstrained JSON`)
    return {}
  }
  const source = value as UnknownRecord
  const output: UnknownRecord = {}
  for (const key of Object.keys(source)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) warnings.push(`${path}.${key}: constraint is not enforced by DSH and was dropped`)
  }
  const type = source.type
  if (typeof type === 'string' && ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type)) {
    output.type = type
  } else if (type !== undefined) {
    warnings.push(`${path}.type: unsupported type was dropped`)
  }
  const union = Array.isArray(source.oneOf) ? source.oneOf : Array.isArray(source.anyOf) ? source.anyOf : undefined
  if (union !== undefined) {
    if (source.anyOf !== undefined) warnings.push(`${path}.anyOf: converted to DSH exact-one oneOf semantics`)
    output.oneOf = union.map((entry, index) => normalizeSchemaNode(entry, `${path}.oneOf[${index}]`, warnings))
    delete output.type
  }
  if (output.type === 'object') {
    const properties = typeof source.properties === 'object' && source.properties !== null && !Array.isArray(source.properties)
      ? source.properties as UnknownRecord
      : {}
    output.properties = Object.fromEntries(
      Object.entries(properties).map(([key, entry]) => [key, normalizeSchemaNode(entry, `${path}.properties.${key}`, warnings)]),
    )
    if (Array.isArray(source.required)) output.required = source.required.filter(item => typeof item === 'string')
    if (typeof source.additionalProperties === 'boolean') output.additionalProperties = source.additionalProperties
    else if (source.additionalProperties !== undefined) {
      output.additionalProperties = true
      warnings.push(`${path}.additionalProperties: schema-valued form widened to true`)
    }
  }
  if (output.type === 'array' && source.items !== undefined) {
    output.items = normalizeSchemaNode(source.items, `${path}.items`, warnings)
  }
  if (Array.isArray(source.enum)) output.enum = source.enum.filter(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))
  if (source.const === null || ['string', 'number', 'boolean'].includes(typeof source.const)) output.const = source.const
  for (const annotation of ['description', 'title'] as const) {
    if (typeof source[annotation] === 'string') output[annotation] = source[annotation]
  }
  for (const annotation of ['default', 'examples'] as const) {
    if (source[annotation] !== undefined) output[annotation] = jsonValue(source[annotation])
  }
  return output
}

export function normalizeToolSchema(schema: unknown): { schema: UnknownRecord; warnings: string[] } {
  const warnings: string[] = []
  const normalized = normalizeSchemaNode(schema, '$', warnings)
  if (normalized.type !== 'object') {
    throw new TypeError('Pi tool parameters must use an object-root TypeBox schema')
  }
  return { schema: normalized, warnings }
}

function cwdOf(agent: UnknownRecord | undefined): string {
  const session = agent?.session
  if (typeof session === 'object' && session !== null) {
    const header = (session as UnknownRecord).header
    if (typeof header === 'object' && header !== null && typeof (header as UnknownRecord).cwd === 'string') {
      return (header as UnknownRecord).cwd as string
    }
  }
  return process.cwd()
}

function unsupported(name: string): never {
  throw new Error(`pi2dsh: Pi API ${name} requires a native DSH port; inspect the compatibility report`)
}

function optionalService<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
}

function requireAgent(state: RuntimeState, operation: string): DshAgent {
  const agent = currentAgent(state)
  if (agent === undefined) {
    throw new Error(`pi2dsh: ${operation} requires one active DSH agent context`)
  }
  return agent as DshAgent
}

function answerText(answer: UnknownRecord | undefined): string | undefined {
  if (answer === undefined) return undefined
  if (typeof answer.custom === 'string' && answer.custom.length > 0) return answer.custom
  const selected = answer.selected
  return Array.isArray(selected) && typeof selected[0] === 'string' ? selected[0] : undefined
}

async function askOne(
  ctx: Context,
  agent: UnknownRecord | undefined,
  signal: AbortSignal | undefined,
  question: UnknownRecord,
): Promise<string | undefined> {
  const service = optionalService<{
    ask(request: UnknownRecord): Promise<{ answers: UnknownRecord[] }>
  }>(ctx, 'userQuestions')
  if (service === undefined) unsupported('ctx.ui AskUser')
  const result = await service.ask({ questions: [question], ...(agent !== undefined ? { agent } : {}), signal })
  return answerText(result.answers.find(answer => answer.id === question.id))
}

function agentSession(agent: UnknownRecord | undefined): { id: string; events: unknown } | undefined {
  const session = agent?.session
  if (typeof session !== 'object' || session === null) return undefined
  const record = session as UnknownRecord
  if (typeof record.id !== 'string') return undefined
  return record as unknown as { id: string; events: unknown }
}

// A child agent's session (subagent origin: reviewer sessions, tool workers)
// is not a Pi host session; its lifecycle and event stream must never project
// into the Pi extensions mounted on the parent.
function isSubagentOrigin(subject: UnknownRecord | undefined): boolean {
  const session = (subject?.session ?? subject) as UnknownRecord | undefined
  const header = session?.header as UnknownRecord | undefined
  // The durable header carries creation meta FLATTENED (origin sits beside
  // id/cwd/parentSession); older/mock shapes may nest it under meta.
  return header?.origin === 'subagent'
    || (header?.meta as UnknownRecord | undefined)?.origin === 'subagent'
    || (session?.meta as UnknownRecord | undefined)?.origin === 'subagent'
}

// Pi ctx.model: a setModel() override wins; otherwise the live DSH agent's
// own route (Agent.options.provider/model), enriched from the catalog.
function currentPiModel(state: RuntimeState, agent: UnknownRecord): UnknownRecord | undefined {
  const override = state.modelOverrides.get(agent)
  const options = agent.options as { provider?: unknown, model?: unknown } | undefined
  const provider = String(override?.provider ?? options?.provider ?? '')
  const id = String(override?.model ?? options?.model ?? '')
  if (id.length === 0) return override
  const known = provider.length > 0 ? state.modelCatalog?.find(provider, id) : undefined
  return known ?? { id, name: id, provider, api: 'dsh-llm', input: ['text'], reasoning: false }
}

function thinkingLevelOf(state: RuntimeState, agent: UnknownRecord | undefined): string {
  if (agent !== undefined) {
    const scoped = state.thinkingLevels.get(agent)
    if (scoped !== undefined) return scoped
  }
  return state.globalThinkingLevel
}

function contextFor(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  signal: AbortSignal | undefined,
  command = false,
): UnknownRecord {
  const notices: string[] = []
  const userQuestions = optionalService(ctx, 'userQuestions')
  const ui = {
    notify(message: unknown) {
      const text = String(message)
      notices.push(text)
      state.notifications.push(text)
      logger(ctx).info(`[pi2dsh] ${text}`)
    },
    select: (title: unknown, options: unknown[]) => askOne(ctx, agent, signal, {
      id: 'pi2dsh-select',
      question: String(title),
      options: options.map(option => ({ label: String(option) })),
    }),
    async confirm(title: unknown, message: unknown) {
      return await askOne(ctx, agent, signal, {
        id: 'pi2dsh-confirm',
        question: String(title),
        detail: String(message),
        options: [{ label: 'Yes' }, { label: 'No' }],
      }) === 'Yes'
    },
    input: (title: unknown, placeholder?: unknown) => askOne(ctx, agent, signal, {
      id: 'pi2dsh-input',
      question: String(title),
      ...(placeholder === undefined ? {} : { detail: String(placeholder) }),
    }),
    editor: (title: unknown, prefill?: unknown) => askOne(ctx, agent, signal, {
      id: 'pi2dsh-editor',
      question: String(title),
      ...(prefill === undefined ? {} : { detail: `Current text:\n${String(prefill)}` }),
    }),
    setStatus: () => undefined,
    setWidget: () => undefined,
    onTerminalInput: () => () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    // Pi's own rpc mode resolves ui.custom to undefined; mirror that exactly.
    custom: async () => undefined,
    pasteToEditor(text: unknown) {
      if (agent !== undefined) {
        state.editorBuffers.set(agent, (state.editorBuffers.get(agent) ?? '') + String(text))
      }
    },
    setEditorText(text: unknown) {
      if (agent !== undefined) state.editorBuffers.set(agent, String(text))
    },
    getEditorText: () => (agent === undefined ? '' : state.editorBuffers.get(agent) ?? ''),
    addAutocompleteProvider(factory: unknown) {
      state.autocompleteProviders.push(factory)
    },
    setEditorComponent(factory: unknown) {
      state.editorComponentFactory = factory
    },
    getEditorComponent: () => state.editorComponentFactory,
    get theme() {
      return state.theme
    },
    getAllThemes: () => [{ name: state.theme.name, path: undefined }],
    getTheme: (name: string) => (name === state.theme.name ? state.theme : undefined),
    setTheme: (target: unknown) => (
      typeof target === 'object' || target === state.theme.name
        ? { success: true }
        : { success: false, error: `pi2dsh headless mode ships a single theme (${state.theme.name})` }
    ),
    getToolsExpanded: () => state.toolsExpanded,
    setToolsExpanded(expanded: unknown) {
      state.toolsExpanded = expanded === true
    },
  }
  const session = agentSession(agent)
  // Pi's ModelRegistry surface. The catalog half projects the DSH llm
  // service's advisory directory (empty in compositions without one); the
  // provider-auth half resolves Pi's full credential chain (vendored
  // double-checked-lock refresh) against the Pi-format auth.json.
  const providerConfig = (name: string): UnknownRecord | undefined => state.providers.get(name)
  const catalog = state.modelCatalog
  // Pi-family models: entries declared by providers the PACKAGE registered
  // (pi-ai createProvider objects carry getModels()). Merged after the DSH
  // llm directory, matching Pi's registry-of-registered-providers semantics.
  const piProviderModels = (): UnknownRecord[] => {
    const out: UnknownRecord[] = []
    for (const [key, value] of state.providers) {
      let models: unknown
      try {
        models = typeof (value as { getModels?: unknown }).getModels === 'function'
          ? (value as { getModels(): unknown }).getModels()
          : (value as { models?: unknown }).models
      } catch {
        continue
      }
      if (!Array.isArray(models)) continue
      for (const model of models as UnknownRecord[]) {
        out.push({ ...model, provider: String(model.provider ?? key) })
      }
    }
    return out
  }
  const allModels = () => {
    const fromLlm = catalog?.all() ?? []
    const seen = new Set(fromLlm.map(model => `${model.provider} ${model.id}`))
    return [...fromLlm, ...piProviderModels().filter(model => !seen.has(`${String(model.provider)} ${String(model.id)}`))]
  }
  const modelRegistry = {
    getAll: () => allModels(),
    getAvailable: () => allModels(),
    find: (provider: string, modelId: string) => catalog?.find(provider, modelId)
      ?? piProviderModels().find(model => model.provider === provider && model.id === modelId),
    getError: () => undefined,
    hasConfiguredAuth: (model: unknown) => {
      // Configuration check, not key liveness (Pi's is also a config check):
      // the route resolves iff its provider is in the live llm directory or
      // registered by a package.
      const provider = String((model as UnknownRecord | undefined)?.provider ?? '')
      return provider.length > 0
        && (state.providers.has(provider) || (catalog?.all() ?? []).some(entry => entry.provider === provider))
    },
    // Pi's per-model credential read, two families with one resolver:
    // package-registered providers use their own declared chain; DSH built-in
    // routes resolve through the REAL pi-ai's builtinProviders() definition —
    // the same source DSH's own llm adapter builds its directory from — so
    // env-held keys (e.g. DEEPSEEK_API_KEY) resolve with Pi's exact
    // semantics. Neither family fabricates a key: no resolution → not ok.
    getApiKeyAndHeaders: async (model: unknown) => {
      const provider = String((model as UnknownRecord | undefined)?.provider ?? '')
      const config = providerConfig(provider) ?? await realBuiltinProvider(provider)
      if (config !== undefined) {
        const resolved = await resolvePiProviderAuth({
          providerId: provider, providerConfig: config, store: oauthStoreOf(state),
        })
        const auth = resolved?.auth as UnknownRecord | undefined
        if (auth?.apiKey === undefined) return { ok: false }
        return {
          ok: true,
          apiKey: auth.apiKey,
          ...(auth.headers === undefined ? {} : { headers: auth.headers }),
          ...(auth.baseUrl === undefined && config.baseUrl === undefined ? {} : { baseUrl: auth.baseUrl ?? config.baseUrl }),
        }
      }
      // A DSH adapter route: its credential reference lives in the public
      // configurable-provider directory (settingsNs/settingsPath), the
      // profile's apiKeyEnv, and the credentials service — three public
      // seams, no name guessing. Any missing step answers not-ok honestly.
      try {
        const llm = llmOf(ctx) as unknown as { listConfigurableProviders?(): Array<{ provider: string, settingsNs: string, settingsPath: readonly string[] }> } | undefined
        const entry = llm?.listConfigurableProviders?.()?.find(candidate => candidate.provider === provider)
        if (entry === undefined) return { ok: false }
        const settings = (ctx as unknown as { get(name: string): unknown }).get('settings') as { get(ns: string): unknown } | undefined
        const section = settings?.get(entry.settingsNs)
        const profile = entry.settingsPath.reduce<unknown>(
          (node, key) => (typeof node === 'object' && node !== null ? (node as UnknownRecord)[key] : undefined),
          section,
        ) as UnknownRecord | undefined
        const ref = profile?.apiKeyEnv
        if (typeof ref !== 'string' || ref.length === 0) return { ok: false }
        const credentials = (ctx as unknown as { get(name: string): unknown }).get('credentials') as { resolve(ref: string): Promise<{ value?: string } | undefined> } | undefined
        const resolved = await credentials?.resolve(ref)
        if (typeof resolved?.value !== 'string' || resolved.value.length === 0) return { ok: false }
        return { ok: true, apiKey: resolved.value }
      } catch {
        return { ok: false }
      }
    },
    getProviderAuthStatus: (provider: string) =>
      providerSupportsOAuth(providerConfig(provider)) ? 'oauth' : 'none',
    getProvider: (provider: string) => providerConfig(provider),
    getRegisteredProviderConfig: (provider: string) => providerConfig(provider),
    getRegisteredProviderIds: () => [...state.providers.keys()],
    getProviderDisplayName: (provider: string) => {
      const config = providerConfig(provider)
      return typeof config?.name === 'string' ? config.name : provider
    },
    getProviderAuth: async (provider: string) => {
      const config = providerConfig(provider)
      if (config === undefined) return undefined
      const resolved = await resolvePiProviderAuth({
        providerId: provider, providerConfig: config, store: oauthStoreOf(state),
      })
      if (resolved?.auth === undefined) return resolved
      // Pi fills the provider's declared baseUrl when the credential itself
      // carries none (OAuth toAuth often returns just the key).
      return resolved.auth.baseUrl === undefined && config.baseUrl !== undefined
        ? { ...resolved, auth: { ...resolved.auth, baseUrl: config.baseUrl } }
        : resolved
    },
    getApiKeyForProvider: async (provider: string) => {
      const config = providerConfig(provider)
      if (config === undefined) return undefined
      const resolved = await resolvePiProviderAuth({
        providerId: provider, providerConfig: config, store: oauthStoreOf(state),
      })
      return (resolved?.auth as UnknownRecord | undefined)?.apiKey as string | undefined
    },
    isUsingOAuth: (model: unknown) => {
      const provider = String((model as UnknownRecord | undefined)?.provider ?? '')
      return provider.length > 0 && providerSupportsOAuth(providerConfig(provider))
    },
    refresh: async () => {
      await catalog?.refresh()
      return { models: catalog?.all() ?? [], errors: [] }
    },
  }
  const base: UnknownRecord = {
    ui,
    mode: 'rpc',
    hasUI: userQuestions !== undefined,
    cwd: cwdOf(agent),
    sessionManager: session === undefined
      ? state.bridge.readonlySessionManager({ id: 'pi2dsh-detached', events: [] }, cwdOf(agent))
      : state.bridge.readonlySessionManager(session as never, cwdOf(agent)),
    modelRegistry,
    // Current effective model: a setModel() override wins; otherwise the DSH
    // agent's own provider/model route (Agent.options), enriched from the
    // catalog when the entry is known there.
    model: agent === undefined ? undefined : currentPiModel(state, agent),
    scopedModels: catalog?.all() ?? [],
    thinkingLevel: thinkingLevelOf(state, agent),
    isIdle: () => command,
    isProjectTrusted: () => false,
    signal,
    abort: () => {
      const target = agent as { cancel?(cause: unknown): void } | undefined
      if (typeof target?.cancel !== 'function') unsupported('ctx.abort without a live DSH agent')
      target.cancel({ kind: 'hook', reason: 'pi2dsh: aborted by migrated Pi extension' })
    },
    hasPendingMessages: () => false,
    shutdown: () => unsupported('ctx.shutdown'),
    getContextUsage: () => undefined,
    compact: () => unsupported('ctx.compact'),
    getSystemPrompt: () => state.currentSystemPrompt,
    __agent: agent,
    __notices: notices,
  }
  if (command) {
    Object.assign(base, {
      getSystemPromptOptions: () => ({}),
      waitForIdle: async () => {
        const wait = agent?.whenIdle
        if (typeof wait === 'function') await wait.call(agent)
      },
      newSession: () => unsupported('ctx.newSession'),
      fork: () => unsupported('ctx.fork'),
      navigateTree: () => unsupported('ctx.navigateTree'),
      switchSession: () => unsupported('ctx.switchSession'),
      reload: () => unsupported('ctx.reload'),
    })
  }
  return base
}

async function dispatch(
  state: RuntimeState,
  eventName: string,
  event: UnknownRecord,
  eventContext: UnknownRecord,
): Promise<unknown[]> {
  const results: unknown[] = []
  const agent = eventContext.__agent as UnknownRecord | undefined
  for (const handler of state.handlers.get(eventName) ?? []) {
    results.push(await state.agentScope.run(agent, () => handler(event, eventContext)))
  }
  return results
}

function dshToPiContent(content: readonly ContentBlock[]): Array<UnknownRecord> {
  return content.map(block => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'reasoning') return { type: 'thinking', thinking: block.text }
    if (block.type === 'tool-call') return { type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments }
    return { type: block.type }
  })
}

function messageFromSessionEvent(event: UnknownRecord): UnknownRecord | undefined {
  const type = event.type
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as UnknownRecord
  if (type === 'user/message') return { role: 'user', content: dshToPiContent((record.content ?? []) as ContentBlock[]) }
  if (type === 'assistant/message') {
    const message = record.message as UnknownRecord | undefined
    return { role: 'assistant', content: dshToPiContent((message?.content ?? []) as ContentBlock[]) }
  }
  if (type === 'tool/result') {
    const message = record.message as UnknownRecord | undefined
    const blocks = (message?.content ?? []) as Array<UnknownRecord>
    const tool = blocks.find(block => block.type === 'tool-result')
    return {
      role: 'toolResult',
      toolCallId: tool?.toolCallId,
      content: dshToPiContent((tool?.content ?? []) as ContentBlock[]),
      isError: tool?.isError === true,
    }
  }
  return undefined
}

function sourceReason(value: unknown): string {
  return value === 'resume' ? 'resume' : value === 'fork' ? 'fork' : 'startup'
}

function subscribeLifecycle(ctx: Context, state: RuntimeState): void {
  const cordis = ctx as unknown as {
    on(name: string, callback: (...args: any[]) => unknown, options?: unknown): () => void
    effect(callback: () => unknown, label?: string): unknown
  }
  const warn = (event: string, error: unknown) => logger(ctx).warn(`[pi2dsh] ${event} handler failed: ${String(error)}`)

  cordis.on('agent/session-start', (payload: UnknownRecord) => {
    const agent = payload.agent as UnknownRecord
    // Child agents (subagent-origin sessions — reviewer sessions, tool
    // workers) are NOT Pi host sessions: a Pi extension lives in exactly one
    // session, and leaking a child's lifecycle into it reads as "a new
    // session started" mid-turn (packages then reset their runtime state
    // while their own child is mid-flight). Track the agent for scoped
    // routing but never project the Pi lifecycle event.
    if (isSubagentOrigin(agent)) {
      state.activeAgents.add(agent)
      return
    }
    state.activeAgents.add(agent)
    const session = agentSession(agent)
    if (session !== undefined) state.bridge.load(session.id)
    if (state.pendingActiveTools !== undefined) {
      state.agentScope.run(agent, () => setActiveTools(ctx, state, state.pendingActiveTools!))
    }
    void dispatch(state, 'session_start', { type: 'session_start', reason: sourceReason(payload.source) }, contextFor(ctx, state, agent, undefined))
      .catch(error => warn('session_start', error))
  })
  cordis.on('agent/disposed', (payload: UnknownRecord) => {
    const agent = payload.agent as UnknownRecord
    state.activeAgents.delete(agent)
    if (typeof agent === 'object' && agent !== null) {
      state.toolRestrictions.get(agent)?.()
      state.toolRestrictions.delete(agent)
    }
    if (typeof agent === 'object' && agent !== null && !state.disposedAgents.has(agent)) {
      state.disposedAgents.add(agent)
      // Child-agent disposal is not the Pi host session shutting down.
      if (!isSubagentOrigin(agent)) {
        void dispatch(state, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, contextFor(ctx, state, agent, undefined))
          .catch(error => warn('session_shutdown', error))
      }
    }
  })

  cordis.on('session/event', (session: UnknownRecord, event: UnknownRecord) => {
    // Child-agent sessions never project into the parent's Pi extensions.
    if (isSubagentOrigin(session)) return
    const agent = [...state.activeAgents].find(candidate => candidate.session === session)
    const eventContext = contextFor(ctx, state, agent, undefined)
    const type = event.type
    if (type === 'turn/start') {
      const turn = Number((event.data as UnknownRecord).turn ?? 1)
      void dispatch(state, 'agent_start', { type: 'agent_start' }, eventContext).catch(error => warn('agent_start', error))
      void dispatch(state, 'turn_start', { type: 'turn_start', turnIndex: turn - 1, timestamp: event.time ?? Date.now() }, eventContext)
        .catch(error => warn('turn_start', error))
    }
    if (type === 'tool/call') {
      const data = event.data as UnknownRecord
      let args: unknown = {}
      try { args = JSON.parse(String(data.arguments ?? '{}')) } catch { args = {} }
      void dispatch(state, 'tool_execution_start', {
        type: 'tool_execution_start', toolCallId: data.callId, toolName: data.name, args,
      }, eventContext).catch(error => warn('tool_execution_start', error))
    }
    if (type === 'assistant/chunk' && (state.handlers.get('message_update')?.length ?? 0) > 0) {
      const data = event.data as UnknownRecord
      const chunk = (data.chunk ?? {}) as UnknownRecord
      const key = `${String(session.id ?? '')}:${String(data.turn ?? 0)}:${String(data.step ?? 0)}`
      const delta = typeof chunk.text === 'string'
        ? chunk.text
        : typeof chunk.delta === 'string' ? chunk.delta : ''
      const accumulated = (state.streamingTexts.get(key) ?? '') + delta
      state.streamingTexts.set(key, accumulated)
      void dispatch(state, 'message_update', {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: accumulated }] },
        assistantMessageEvent: chunk,
      }, eventContext).catch(error => warn('message_update', error))
    }
    if (type === 'assistant/message') {
      const data = event.data as UnknownRecord
      state.streamingTexts.delete(`${String(session.id ?? '')}:${String(data.turn ?? 0)}:${String(data.step ?? 0)}`)
    }
    if (type === 'session/title') {
      const data = event.data as UnknownRecord
      void dispatch(state, 'session_info_changed', {
        type: 'session_info_changed', name: typeof data.title === 'string' ? data.title : undefined,
      }, eventContext).catch(error => warn('session_info_changed', error))
    }
    // DSH compaction events are facts from the durable log: the "before"
    // projection is advisory (cancel/replace cannot reach DSH's compactor),
    // and the "after" projection carries the summary when one was recorded.
    if (type === 'compaction/start') {
      void dispatch(state, 'session_before_compact', {
        type: 'session_before_compact',
        preparation: { ...(event.data as UnknownRecord) },
        branchEntries: [],
        reason: 'threshold',
        willRetry: false,
      }, eventContext).catch(error => warn('session_before_compact', error))
    }
    if (type === 'compaction/end' || type === 'compaction/summary') {
      const data = event.data as UnknownRecord
      void dispatch(state, 'session_compact', {
        type: 'session_compact',
        compactionEntry: {
          type: 'compaction',
          id: `dsh-${String(event.seq ?? '')}`,
          summary: typeof data.summary === 'string' ? data.summary : '',
          ...(data as object),
        },
        fromExtension: false,
        reason: 'threshold',
        willRetry: false,
      }, eventContext).catch(error => warn('session_compact', error))
    }
    if (type === 'request/header') {
      const header = ((event.data as UnknownRecord).header ?? {}) as UnknownRecord
      const model = header.model ?? (header as { config?: UnknownRecord }).config?.model
      if (model !== undefined && agent !== undefined) {
        const previous = state.lastLoggedModels.get(agent)
        if (previous !== undefined && previous !== String(model)) {
          void dispatch(state, 'model_select', {
            type: 'model_select',
            model: { id: String(model) },
            previousModel: { id: previous },
            source: 'set',
          }, eventContext).catch(error => warn('model_select', error))
        }
        state.lastLoggedModels.set(agent, String(model))
      }
    }
    const message = messageFromSessionEvent(event)
    if (message !== undefined) {
      void dispatch(state, 'message_start', { type: 'message_start', message }, eventContext)
        .then(() => dispatch(state, 'message_end', { type: 'message_end', message }, eventContext))
        .catch(error => warn('message lifecycle', error))
    }
    if (type === 'turn/end') {
      const data = event.data as UnknownRecord
      const turnIndex = Number(data.turn ?? 1) - 1
      const finalMessage = { role: 'assistant', content: [] }
      void dispatch(state, 'turn_end', { type: 'turn_end', turnIndex, message: finalMessage, toolResults: [] }, eventContext)
        .then(() => dispatch(state, 'agent_end', { type: 'agent_end', messages: [] }, eventContext))
        .then(() => dispatch(state, 'agent_settled', { type: 'agent_settled' }, eventContext))
        .catch(error => warn('turn end lifecycle', error))
    }
  })

  // Per-agent model/thinking overrides recorded by setModel()/setThinkingLevel()
  // are applied at the request boundary, DSH's sanctioned seam for call-config
  // replacement.
  cordis.on('agent/request', async (payload: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const config = await next()
    const agent = payload.agent as UnknownRecord | undefined
    if (agent === undefined) return config
    const override = state.modelOverrides.get(agent)
    const thinking = state.thinkingLevels.get(agent)
    if (override === undefined && thinking === undefined) return config
    return {
      ...config,
      ...(override?.provider === undefined ? {} : { provider: override.provider }),
      ...(override?.model === undefined ? {} : { model: override.model }),
      ...(thinking === undefined || thinking === 'off' ? {} : { reasoningEffort: thinking }),
    }
  })

  cordis.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    const agent = exec.agent as unknown as UnknownRecord | undefined
    void dispatch(state, 'tool_execution_end', {
      type: 'tool_execution_end',
      toolCallId: exec.callId,
      toolName: exec.name,
      result: { content: dshToPiContent(result.content), details: result.meta ?? null },
      isError: result.isError,
    }, contextFor(ctx, state, agent, exec.signal)).catch(error => warn('tool_execution_end', error))
  })

  cordis.effect(() => async () => {
    for (const agent of state.activeAgents) {
      if (typeof agent === 'object' && agent !== null && !state.disposedAgents.has(agent)) {
        state.disposedAgents.add(agent)
        await dispatch(state, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, contextFor(ctx, state, agent, undefined))
      }
    }
    state.activeAgents.clear()
    for (const dispose of state.toolDisposers.values()) dispose()
    state.toolDisposers.clear()
    state.eventBus.removeAllListeners()
  }, 'pi2dsh session shutdown')
}

function subscribeInterceptors(ctx: Context, state: RuntimeState): void {
  const cordis = ctx as unknown as { on(name: string, callback: (...args: any[]) => unknown): () => void }
  cordis.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    const input = cloneJson(exec.arguments)
    const event: UnknownRecord = { type: 'tool_call', toolName: exec.name, toolCallId: exec.callId, input }
    const results = await dispatch(state, 'tool_call', event, contextFor(ctx, state, exec.agent as unknown as UnknownRecord, exec.signal))
    if (!jsonEqual(event.input, exec.arguments)) {
      if (state.tools.has(exec.name)) {
        // Pi semantics: tool_call handlers mutate event.input in place. For
        // pi2dsh-owned tools the mutation is applied inside our execute
        // wrapper; DSH-native tools cannot accept it because the core logs
        // arguments before policy on purpose.
        state.argMutations.set(exec as unknown as object, cloneJson(event.input))
      } else {
        return { kind: 'deny', reason: `pi2dsh: a Pi tool_call hook mutated arguments of native DSH tool ${JSON.stringify(exec.name)}; DSH logs arguments before policy, so this mutation cannot be honored` }
      }
    }
    for (const result of results) {
      if (typeof result === 'object' && result !== null && (result as UnknownRecord).block === true) {
        return { kind: 'deny', reason: String((result as UnknownRecord).reason ?? 'blocked by migrated Pi tool_call hook') }
      }
    }
    return next()
  })

  cordis.on('tools/post-execute', async (
    exec: ToolExecution,
    result: ToolExecutionResult,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const downstream = await next()
    if (downstream.kind === 'block') return downstream
    const event: UnknownRecord = {
      type: 'tool_result',
      toolName: exec.name,
      toolCallId: exec.callId,
      input: cloneJson(exec.arguments),
      content: dshToPiContent(result.content),
      details: result.meta ?? null,
      isError: result.isError,
      usage: undefined,
    }
    const results = await dispatch(state, 'tool_result', event, contextFor(ctx, state, exec.agent as unknown as UnknownRecord, exec.signal))
    for (const patch of results) {
      if (typeof patch !== 'object' || patch === null) continue
      Object.assign(event, patch)
    }
    const content = textBlocks(event.content)
    if (event.isError === true && !result.isError) return { kind: 'block', feedback: content }
    if (event.isError === false && result.isError) {
      logger(ctx).warn('[pi2dsh] a Pi tool_result hook attempted to recover a DSH error; error recovery was ignored')
    }
    if (!jsonEqual(event.content, dshToPiContent(result.content))) return { kind: 'accept', content }
    return downstream
  })

  cordis.on('system-prompt/assemble', async (assembly: UnknownRecord, assembleContext: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const downstream = await next()
    if ((state.handlers.get('before_agent_start')?.length ?? 0) === 0) return downstream
    const original = renderPrompt(downstream as never)
    state.currentSystemPrompt = original
    const event: UnknownRecord = {
      type: 'before_agent_start', prompt: '', systemPrompt: original, systemPromptOptions: {},
    }
    const results = await dispatch(state, 'before_agent_start', event, contextFor(ctx, state, assembleContext.scope as UnknownRecord, assembleContext.signal as AbortSignal | undefined))
    let replacement = original
    for (const result of results) {
      if (typeof result === 'object' && result !== null && typeof (result as UnknownRecord).systemPrompt === 'string') {
        replacement = (result as UnknownRecord).systemPrompt as string
        event.systemPrompt = replacement
      }
      if (typeof result === 'object' && result !== null && (result as UnknownRecord).message !== undefined) {
        logger(ctx).warn('[pi2dsh] before_agent_start custom-message injection is unsupported and was ignored')
      }
    }
    state.currentSystemPrompt = replacement
    return { ...downstream, sections: [{ name: 'pi2dsh:system-prompt', text: replacement }] }
  })
}

function oauthStoreOf(state: RuntimeState): FileCredentialStore {
  state.oauthStore ??= new FileCredentialStore(join(getAgentDir(), 'auth.json'))
  return state.oauthStore
}

// Pi hosts ship /login <provider> as a built-in; register it once, the first
// time an oauth-capable provider appears.
function ensureLoginCommand(ctx: Context, state: RuntimeState): void {
  if (state.loginCommandRegistered === true) return
  state.loginCommandRegistered = true
  // A host bundle mounts several packages, each with its own runtime state;
  // the first mount wins the shared /login name. Later mounts must not fail
  // over a duplicate — their OAuth providers are served by builtin preload
  // parity, and a same-name registration would abort the whole package.
  try {
    registerLoginCommand(ctx, state)
  } catch (error) {
    logger(ctx).warn(`[pi2dsh] /login is already registered by an earlier package in this host; this package's providers use that command (${error instanceof Error ? error.message : String(error)})`)
  }
}

function registerLoginCommand(ctx: Context, state: RuntimeState): void {
  registerCommand(ctx, state, {
    name: 'login',
    description: 'Log in to a Pi provider through its own OAuth flow',
    argumentHint: '<provider>',
    async handler(args: string, commandContext: UnknownRecord) {
      const oauthProviders = [...state.providers.entries()]
        .filter(([, config]) => providerSupportsOAuth(config))
        .map(([name]) => name)
      if (oauthProviders.length === 0) throw new Error('no registered Pi provider supports OAuth login')
      const ui = commandContext.ui as {
        input(title: unknown, placeholder?: unknown): Promise<string | undefined>
        select(title: unknown, options: unknown[]): Promise<string | undefined>
        notify(message: unknown): void
      }
      let providerId = args.trim().split(/\s+/u)[0] ?? ''
      if (providerId.length === 0) {
        providerId = oauthProviders.length === 1
          ? oauthProviders[0] as string
          : String(await ui.select('Log in to which provider?', oauthProviders) ?? '')
      }
      const config = state.providers.get(providerId)
      if (config === undefined || !providerSupportsOAuth(config)) {
        throw new Error(`unknown OAuth provider ${JSON.stringify(providerId)}; available: ${oauthProviders.join(', ')}`)
      }
      const oauthName = ((config.oauth as UnknownRecord | undefined)?.name as string | undefined) ?? providerId
      const commandSignal = commandContext.signal as AbortSignal | undefined
      await loginPiProvider({
        providerId,
        providerName: oauthName,
        providerConfig: config,
        store: oauthStoreOf(state),
        ui,
        ...(commandSignal !== undefined ? { signal: commandSignal } : {}),
      })
      ui.notify(`Logged in to ${oauthName}; credential stored in ${oauthStoreOf(state).path}`)
      return `Logged in to ${oauthName}`
    },
  })
}

function registerTool(ctx: Context, state: RuntimeState, tool: PiTool): void {
  // Pi's runner stores tools in a name-keyed Map (set + refreshTools):
  // re-registering a name replaces the previous definition. Mirror that —
  // catalog packages (pi-fabric) re-register wrapped variants at runtime.
  if (state.tools.has(tool.name)) unregisterTool(state, tool.name)
  const normalized = normalizeToolSchema(tool.parameters)
  for (const warning of normalized.warnings) logger(ctx).warn(`[pi2dsh] tool ${tool.name}: ${warning}`)
  state.tools.set(tool.name, tool)
  const definition: ToolDefinition = {
    name: tool.name,
    description: tool.description,
    parameters: normalized.schema,
    output: {
      schema: {},
      render: (_args, value) => (value as UnknownRecord).content as ContentBlock[],
      presentationMeta: (_args, value) => jsonValue((value as UnknownRecord).details) as never,
    },
    isConcurrencySafe: () => tool.executionMode === 'parallel',
    async execute(args, exec) {
      const mutated = state.argMutations.get(exec as unknown as object)
      if (mutated !== undefined) state.argMutations.delete(exec as unknown as object)
      const effective = mutated ?? args
      const prepared = tool.prepareArguments?.(cloneJson(effective)) ?? effective
      const agent = exec.agent as unknown as UnknownRecord | undefined
      const result = await normalizeToolResultForDsh(ctx, await state.agentScope.run(agent, () => tool.execute(
          String(exec.callId),
          prepared,
          exec.signal,
          update => {
            void dispatch(state, 'tool_execution_update', {
              type: 'tool_execution_update',
              toolCallId: String(exec.callId),
              toolName: tool.name,
              args: prepared,
              partialResult: jsonValue(update),
            }, contextFor(ctx, state, agent, exec.signal))
              .catch(error => logger(ctx).warn(`[pi2dsh] tool_execution_update handler failed: ${String(error)}`))
          },
          contextFor(ctx, state, agent, exec.signal),
        )))
      if (result.terminate === true) exec.concludeTurn()
      if (result.isError === true) {
        const message = textBlocks(result.content).map(block => block.text).filter(Boolean).join('\n')
        throw new Error(message || `Pi tool ${tool.name} failed`)
      }
      return result
    },
  }
  const dispose = (ctx as unknown as { tools: { register(toolDefinition: ToolDefinition): () => void } }).tools.register(definition)
  state.toolDisposers.set(tool.name, dispose)
}

function unregisterTool(state: RuntimeState, name: string): boolean {
  const dispose = state.toolDisposers.get(name)
  if (dispose === undefined) return false
  dispose()
  state.toolDisposers.delete(name)
  state.tools.delete(name)
  return true
}

function currentAgent(state: RuntimeState): UnknownRecord | undefined {
  const scoped = state.agentScope.getStore()
  if (scoped !== undefined) return scoped
  if (state.activeAgents.size === 1) return state.activeAgents.values().next().value as UnknownRecord | undefined
  return undefined
}

function toolRuntime(ctx: Context, agent?: UnknownRecord): {
  schemas(scope?: unknown): Array<{ name: string; description?: string; parameters?: unknown }>
  restrict?(filter: { allow: string[] }): () => void
} {
  const scoped = agent?.ctx as { tools?: ReturnType<typeof toolRuntime> } | undefined
  return scoped?.tools ?? (ctx as unknown as { tools: ReturnType<typeof toolRuntime> }).tools
}

function getActiveTools(ctx: Context, state: RuntimeState): string[] {
  const agent = currentAgent(state)
  return toolRuntime(ctx, agent).schemas(agent).map(tool => tool.name)
}

function setActiveTools(ctx: Context, state: RuntimeState, names: string[]): void {
  const unique = [...new Set(names)]
  const agent = currentAgent(state)
  state.pendingActiveTools = unique
  if (agent === undefined || typeof agent !== 'object' || agent === null) return
  const scopedTools = agent.ctx === undefined ? undefined : toolRuntime(ctx, agent)
  if (scopedTools === undefined || typeof scopedTools.restrict !== 'function') {
    // No agent-scoped tool runtime (e.g. a bare test agent): remember the
    // intent and apply it when a scoped agent starts. Restricting the global
    // registry here would mask every agent, which DSH rightly rejects.
    logger(ctx).warn('[pi2dsh] setActiveTools deferred: the current agent exposes no scoped tools.restrict()')
    return
  }
  state.toolRestrictions.get(agent)?.()
  state.toolRestrictions.set(agent, scopedTools.restrict({ allow: unique }))
}

function deliverAgentMessage(agent: DshAgent, message: unknown, mode: 'inject' | 'steer' | 'followup'): void {
  const deliver = agent[mode]
  if (typeof deliver !== 'function') throw new Error(`pi2dsh: active DSH agent has no ${mode}() delivery method`)
  deliver.call(agent, message)
}

async function sendPiMessage(
  ctx: Context,
  state: RuntimeState,
  content: unknown,
  mode: 'inject' | 'steer' | 'followup',
): Promise<void> {
  const agent = requireAgent(state, mode === 'inject' ? 'sendMessage' : 'sendUserMessage')
  const blocks = await piToDshContent(ctx, typeof content === 'string' ? [{ type: 'text', text: content }] : content)
  deliverAgentMessage(agent, createUserMessage({
    content: blocks,
    source: { kind: 'plugin', plugin: state.messageSource },
  }), mode)
}

function combineExecSignal(options: PiExecOptions): {
  signal: AbortSignal
  killed(): boolean
  cleanup(): void
} {
  const controller = new AbortController()
  let killed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = (reason: unknown): void => {
    if (controller.signal.aborted) return
    killed = true
    controller.abort(reason)
  }
  const onAbort = (): void => abort(options.signal?.reason ?? new Error('Pi exec aborted'))
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })
  if (typeof options.timeout === 'number' && Number.isFinite(options.timeout) && options.timeout > 0) {
    timer = setTimeout(() => abort(new Error(`Pi exec timed out after ${options.timeout}ms`)), options.timeout)
  }
  return {
    signal: controller.signal,
    killed: () => killed,
    cleanup() {
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function executePiCommand(
  service: DshSubprocessService,
  cwd: string,
  command: string,
  args: string[],
  options: PiExecOptions,
): Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> {
  const operation = combineExecSignal(options)
  try {
    if (typeof command !== 'string' || command.length === 0) throw new TypeError('Pi exec command must be a non-empty string')
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new TypeError('Pi exec args must be strings')
    const executable = await service.resolveExecutable(command, undefined, operation.signal)
    const collect = { maxBytes: 64 * 1024 * 1024 }
    const handle = service.spawn({
      argv: [executable, ...args],
      cwd: options.cwd ?? cwd,
      stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
      graceMs: 5_000,
      signal: operation.signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    const truncation = [stdout?.lossy ? 'stdout' : '', stderr?.lossy ? 'stderr' : ''].filter(Boolean)
    return {
      stdout: stdout?.text ?? '',
      stderr: `${stderr?.text ?? ''}${truncation.length === 0 ? '' : `\n[pi2dsh: ${truncation.join(' and ')} exceeded the 64 MiB compatibility limit]`}`,
      code: outcome.exitCode ?? 0,
      killed: operation.killed(),
    }
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      code: operation.signal.aborted ? 0 : 1,
      killed: operation.killed(),
    }
  } finally {
    operation.cleanup()
  }
}

function dshCommandName(ctx: Context, piName: string): string {
  // DSH command names are /^[a-z][a-z0-9_-]*$/; Pi allows richer names like
  // "btw:tangent". Normalize instead of refusing the whole package.
  const normalized = piName.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^[^a-z]+/u, '')
  const name = normalized.length > 0 ? normalized : 'pi-command'
  if (name !== piName) logger(ctx).warn(`[pi2dsh] Pi command /${piName} registered as /${name} to satisfy DSH command naming`)
  return name
}

function registerCommand(ctx: Context, state: RuntimeState, command: PiCommand): void {
  if (state.commands.has(command.name)) throw new Error(`Pi command ${JSON.stringify(command.name)} is already registered`)
  state.commands.set(command.name, command)
  const commands = (ctx as unknown as { get(name: string): unknown }).get('commands') as {
    register(definition: UnknownRecord): () => void
  } | undefined
  if (commands === undefined) {
    logger(ctx).warn(`[pi2dsh] command /${command.name} was not registered because this DSH composition has no ctx.commands`)
    return
  }
  commands.register({
    name: dshCommandName(ctx, command.name),
    description: command.description || `Migrated Pi command /${command.name}`,
    ...(command.argumentHint !== undefined ? { input: { hint: command.argumentHint } } : {}),
    async handler(invocation: UnknownRecord) {
      const agent = invocation.agent as UnknownRecord
      const commandContext = contextFor(ctx, state, agent, invocation.signal as AbortSignal, true)
      await state.agentScope.run(agent, () => command.handler(String(invocation.rawInput ?? '').trimStart(), commandContext))
      const notices = commandContext.__notices as string[]
      return { kind: 'success', ...(notices.length > 0 ? { text: notices.join('\n') } : {}) }
    },
  })
}

function requireSession(state: RuntimeState, operation: string): { id: string; events: unknown } {
  const agent = currentAgent(state)
  const session = agentSession(agent)
  if (session === undefined) {
    throw new Error(`pi2dsh: ${operation} requires one active DSH agent with a durable session`)
  }
  return session
}

function createPiApi(ctx: Context, state: RuntimeState): UnknownRecord {
  return {
    on(event: string, handler: PiHandler) {
      const list = state.handlers.get(event) ?? []
      list.push(handler)
      state.handlers.set(event, list)
    },
    registerTool: (tool: PiTool) => registerTool(ctx, state, tool),
    unregisterTool: (name: string) => unregisterTool(state, name),
    registerCommand(name: string, options: UnknownRecord) {
      registerCommand(ctx, state, {
        name,
        description: typeof options.description === 'string' ? options.description : `Migrated Pi command /${name}`,
        ...(typeof options.argumentHint === 'string' ? { argumentHint: options.argumentHint } : {}),
        handler: options.handler as PiCommand['handler'],
      })
    },
    // Registered and introspectable; DSH surfaces have no terminal key
    // bindings, so handlers never fire — the same as Pi's non-TUI modes.
    registerShortcut(shortcut: string, options: UnknownRecord) {
      state.shortcuts.set(shortcut, options)
    },
    registerFlag(name: string, options: UnknownRecord) {
      state.flags.set(name, options.default as boolean | string | undefined)
      logger(ctx).warn(`[pi2dsh] Pi flag --${name} uses its default only; DSH CLI registration is unsupported`)
    },
    getFlag: (name: string) => state.flags.get(name),
    registerProvider(providerOrName: unknown, config?: UnknownRecord) {
      // pi-ai createProvider() objects are keyed by id in Pi's registry
      // (name is the display name); extension-generation calls pass the key
      // explicitly as the first argument.
      const name = typeof providerOrName === 'string'
        ? providerOrName
        : String((providerOrName as UnknownRecord | undefined)?.id
          ?? (providerOrName as UnknownRecord | undefined)?.name ?? 'unnamed')
      const value = typeof providerOrName === 'string' ? config ?? {} : providerOrName as UnknownRecord
      state.providers.set(name, value)
      if (providerSupportsOAuth(value)) {
        // Pi hosts expose /login <provider> for oauth-capable providers; the
        // package's own login flow runs, credentials land in auth.json.
        ensureLoginCommand(ctx, state)
        logger(ctx).info(`[pi2dsh] Pi provider ${JSON.stringify(name)} supports OAuth — log in with /login ${name}`)
      }
      // A provider carrying its own transport becomes a REAL DSH llm route:
      // the loop and child agents route to it natively, with credentials
      // resolved through Pi's own chain per request.
      const routeDisposer = registerPiProviderRoute({
        llm: llmOf(ctx) as never,
        providerId: name,
        provider: value,
        host: {
          resolveAuth: async () => resolvePiProviderAuth({
            providerId: name, providerConfig: value, store: oauthStoreOf(state),
          }) as Promise<{ auth?: UnknownRecord } | undefined>,
          warn: message => logger(ctx).warn(message),
        },
      })
      if (routeDisposer !== undefined) {
        state.providerRouteDisposers.set(name, routeDisposer)
        void state.modelCatalog?.refresh()
        logger(ctx).info(`[pi2dsh] Pi provider ${JSON.stringify(name)} registered as a native DSH llm route`)
      } else if (!providerSupportsOAuth(value)) {
        logger(ctx).info(`[pi2dsh] recorded Pi provider ${JSON.stringify(name)}; model calls stay on DSH llm adapters`)
      }
      // Pi hosts refresh a registered provider's dynamic model catalog
      // (fetchModels against its gateway); best-effort and non-blocking, with
      // pi-ai's publish/store contract and the provider's own resolved
      // credential (gateway discovery needs one).
      const refreshModels = (value as { refreshModels?: unknown }).refreshModels
      if (typeof refreshModels === 'function') {
        void (async () => {
          const resolved = await resolvePiProviderAuth({
            providerId: name, providerConfig: value, store: oauthStoreOf(state),
          }).catch(() => undefined)
          const apiKey = (resolved?.auth as UnknownRecord | undefined)?.apiKey
          await Promise.resolve(refreshModels.call(value, {
            stored: undefined,
            ...(apiKey === undefined ? {} : { credential: { type: 'api_key', key: apiKey } }),
            store: {
              read: async () => undefined,
              write: async () => {},
              delete: async () => {},
            },
            allowNetwork: true,
            signal: new AbortController().signal,
            publish: async (publication: { update?: () => void }) => {
              publication.update?.()
              return true
            },
          }))
          void state.modelCatalog?.refresh()
        })().catch(error => logger(ctx).warn(`[pi2dsh] model catalog refresh for Pi provider ${JSON.stringify(name)} failed (its registry entries stay static): ${error instanceof Error ? error.message : String(error)}`))
      }
    },
    unregisterProvider(name: string) {
      state.providers.delete(name)
      const routeDisposer = state.providerRouteDisposers.get(name)
      if (routeDisposer !== undefined) {
        state.providerRouteDisposers.delete(name)
        routeDisposer()
      }
    },
    // Renderer registrations are accepted verbatim; DSH owns presentation, so
    // they are never invoked — matching Pi's own non-TUI surfaces.
    registerMessageRenderer(customType: string, renderer: unknown) {
      state.messageRenderers.set(customType, renderer)
    },
    registerEntryRenderer(customType: string, renderer: unknown) {
      state.entryRenderers.set(customType, renderer)
    },
    registerMarkdownTransformer(transformer: unknown) {
      state.markdownTransformer = transformer
    },
    sendMessage(message: UnknownRecord, options: UnknownRecord = {}) {
      requireAgent(state, 'sendMessage')
      const mode = options.deliverAs === 'steer'
        ? 'steer'
        : options.deliverAs === 'followUp' || options.deliverAs === 'nextTurn' || options.triggerTurn === true
          ? 'followup'
          : 'inject'
      return sendPiMessage(ctx, state, message.content, mode)
    },
    sendUserMessage(content: unknown, options: UnknownRecord = {}) {
      requireAgent(state, 'sendUserMessage')
      return sendPiMessage(ctx, state, content, options.deliverAs === 'steer' ? 'steer' : 'followup')
    },
    appendEntry(customType: string, data?: unknown) {
      const session = requireSession(state, 'appendEntry')
      state.bridge.appendCustomEntry(session.id, customType, data)
    },
    setSessionName(name: string) {
      const session = requireSession(state, 'setSessionName')
      state.bridge.setName(session.id, String(name))
      void dispatch(state, 'session_info_changed', {
        type: 'session_info_changed',
        name: state.bridge.getName(session.id),
      }, contextFor(ctx, state, currentAgent(state), undefined))
        .catch(error => logger(ctx).warn(`[pi2dsh] session_info_changed handler failed: ${String(error)}`))
    },
    getSessionName() {
      const agent = currentAgent(state)
      const session = agentSession(agent)
      return session === undefined ? undefined : state.bridge.getName(session.id)
    },
    setLabel(entryId: string, label: string | undefined) {
      const session = requireSession(state, 'setLabel')
      state.bridge.appendLabel(session.id, String(entryId), label)
    },
    exec(command: string, args: string[] = [], options: PiExecOptions = {}) {
      const service = optionalService<DshSubprocessService>(ctx, 'subprocess')
      if (service === undefined) unsupported('exec')
      return executePiCommand(service, cwdOf(currentAgent(state)), command, args, options)
    },
    getActiveTools: () => getActiveTools(ctx, state),
    getAllTools: () => {
      // Enumerate Pi-registered tools through the runner facade: a package
      // that patched ExtensionRunner.prototype.getAllRegisteredTools
      // (pi-fabric's catalog capture) filters what this surface reports.
      const visiblePiTools = new Set(
        state.runner.getAllRegisteredTools()
          .map(record => (record.definition as PiTool | undefined)?.name)
          .filter((name): name is string => typeof name === 'string'),
      )
      return toolRuntime(ctx, currentAgent(state)).schemas(currentAgent(state))
        .filter(tool => !state.tools.has(tool.name) || visiblePiTools.has(tool.name))
        .map(tool => ({
          name: tool.name,
          description: tool.description ?? '',
          parameters: tool.parameters ?? {},
          source: state.tools.has(tool.name) ? 'extension' : 'builtin',
          sourceInfo: { path: '', source: state.tools.has(tool.name) ? 'pi2dsh' : 'dsh', scope: 'session', origin: 'runtime' },
        }))
    },
    setActiveTools: (names: string[]) => setActiveTools(ctx, state, names),
    getCommands: () => [...state.commands.values()].map(command => ({
      name: command.name,
      description: command.description,
      source: 'extension',
      sourceInfo: { path: '', source: 'pi2dsh', scope: 'user', origin: 'package' },
    })),
    async setModel(model: UnknownRecord) {
      const agent = currentAgent(state)
      if (agent === undefined) return false
      const override = {
        ...(typeof model?.provider === 'string' ? { provider: model.provider } : {}),
        ...(typeof model?.id === 'string' ? { model: model.id } : {}),
      }
      if (override.model === undefined) return false
      state.modelOverrides.set(agent, override)
      const previous = state.modelOverrides.get(agent)
      void dispatch(state, 'model_select', {
        type: 'model_select', model, previousModel: previous, source: 'set',
      }, contextFor(ctx, state, agent, undefined))
        .catch(error => logger(ctx).warn(`[pi2dsh] model_select handler failed: ${String(error)}`))
      return true
    },
    getThinkingLevel: () => thinkingLevelOf(state, currentAgent(state)),
    setThinkingLevel(level: string) {
      const agent = currentAgent(state)
      const previousLevel = thinkingLevelOf(state, agent)
      if (agent === undefined) state.globalThinkingLevel = String(level)
      else state.thinkingLevels.set(agent, String(level))
      void dispatch(state, 'thinking_level_select', {
        type: 'thinking_level_select', level: String(level), previousLevel,
      }, contextFor(ctx, state, agent, undefined))
        .catch(error => logger(ctx).warn(`[pi2dsh] thinking_level_select handler failed: ${String(error)}`))
    },
    events: {
      emit(channel: string, data: unknown) {
        state.eventBus.emit(channel, data)
      },
      on(channel: string, handler: (data: unknown) => unknown) {
        const safeHandler = (data: unknown) => {
          Promise.resolve(handler(data)).catch(error => logger(ctx).warn(`[pi2dsh] package event ${channel} handler failed: ${String(error)}`))
        }
        state.eventBus.on(channel, safeHandler)
        return () => state.eventBus.off(channel, safeHandler)
      },
    },
  }
}

function splitArguments(input: string): string[] {
  const values: string[] = []
  let current = ''
  let quote: string | undefined
  for (const character of input) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/u.test(character)) {
      if (current.length > 0) {
        values.push(current)
        current = ''
      }
    } else {
      current += character
    }
  }
  if (current.length > 0) values.push(current)
  return values
}

function promptBody(text: string): string {
  const normalized = text.replace(/\r\n?/gu, '\n')
  if (!normalized.startsWith('---')) return normalized
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return normalized
  return normalized.slice(endIndex + 4).trim()
}

function expandPrompt(text: string, rawInput: string): string {
  const args = splitArguments(rawInput)
  const all = args.join(' ')
  return promptBody(text).replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/gu,
    (_match, defaultTarget: string | undefined, fallback: string | undefined, sliceStart: string | undefined, sliceLength: string | undefined, simple: string | undefined) => {
      if (defaultTarget !== undefined) {
        const value = defaultTarget === '@' || defaultTarget === 'ARGUMENTS'
          ? all
          : args[Number(defaultTarget) - 1]
        return value || fallback || ''
      }
      if (sliceStart !== undefined) {
        const offset = Math.max(0, Number(sliceStart) - 1)
        return args.slice(offset, sliceLength === undefined ? undefined : offset + Number(sliceLength)).join(' ')
      }
      if (simple === '@' || simple === 'ARGUMENTS') return all
      return args[Number(simple) - 1] ?? ''
    },
  )
}

async function registerPromptCommands(ctx: Context, state: RuntimeState, rootDir: string, manifest: GeneratedRuntimeManifest): Promise<void> {
  for (const prompt of manifest.prompts) {
    const text = await readFile(join(rootDir, prompt.path), 'utf8')
    registerCommand(ctx, state, {
      name: prompt.name,
      description: prompt.description,
      ...(prompt.argumentHint !== undefined ? { argumentHint: prompt.argumentHint } : {}),
      handler(rawInput, commandContext) {
        const agent = (commandContext as UnknownRecord).__agent as UnknownRecord | undefined
        const invocationAgent = agent ?? [...state.activeAgents][0]
        if (invocationAgent === undefined || typeof invocationAgent.steer !== 'function') {
          throw new Error(`pi2dsh: /${prompt.name} requires a live DSH agent`)
        }
        invocationAgent.steer(createUserMessage({
          content: [{ type: 'text', text: expandPrompt(text, rawInput) }],
          source: { kind: 'plugin', plugin: `pi2dsh:${manifest.package.name}`, form: 'relay' },
        }))
      },
    })
  }
}

async function loadExtensions(
  rootDir: string,
  manifest: GeneratedRuntimeManifest,
  api: UnknownRecord,
  onExtensionError?: (failure: string) => void,
): Promise<void> {
  const resolveShim = async (name: string): Promise<string> => {
    const compiled = fileURLToPath(new URL(`./compat/${name}.mjs`, import.meta.url))
    try {
      await access(compiled)
      return compiled
    } catch {
      return fileURLToPath(new URL(`./compat/${name}.ts`, import.meta.url))
    }
  }
  const [codingAgentShim, tuiShim, aiShim] = await Promise.all([
    resolveShim('pi-coding-agent'),
    resolveShim('pi-tui'),
    resolveShim('pi-ai'),
  ])
  const aliases: Record<string, string> = {}
  for (const family of ['@earendil-works', '@mariozechner']) {
    aliases[`${family}/pi-coding-agent`] = codingAgentShim
    aliases[`${family}/pi-tui`] = tuiShim
    aliases[`${family}/pi-ai`] = aiShim
    // Pi resolves subpath entries of pi-ai (compat superset, oauth, provider
    // catalogs) for extensions; all of them land on the same shim surface.
    aliases[`${family}/pi-ai/compat`] = aiShim
    aliases[`${family}/pi-ai/oauth`] = aiShim
    aliases[`${family}/pi-ai/providers/all`] = aiShim
  }
  // Pi's loader hands extensions the host's typebox without a declaration;
  // mirror that by resolving every typebox entry the whitelist names to the
  // bridge's own copy.
  // typebox restricts its exports map (no ./package.json), so resolve each
  // public entry directly; resolution anchors at this runtime file, which in a
  // generated bundle sits next to the bundle's own node_modules.
  const require = createRequire(import.meta.url)
  for (const entry of ['typebox', 'typebox/value', 'typebox/compile']) {
    try {
      const resolved = require.resolve(entry)
      aliases[entry] = resolved
      aliases[entry.replace('typebox', '@sinclair/typebox')] = resolved
    } catch {
      // Without a resolvable typebox entry extensions fall back to normal
      // resolution against their own dependencies.
    }
  }
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: aliases,
  })
  // Pi's loader isolates per-extension failures: one broken entry reports and
  // the rest keep loading. A package whose every entry fails still errors.
  const failures: string[] = []
  let mounted = 0
  for (const extension of manifest.extensions) {
    try {
      const loaded: unknown = await jiti.import(join(rootDir, extension))
      const candidate = typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? (loaded as { default: unknown }).default
        : loaded
      if (typeof candidate !== 'function') throw new TypeError(`Pi extension ${extension} has no default factory function`)
      await candidate(api)
      mounted += 1
    } catch (error) {
      failures.push(`${extension}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length > 0 && mounted === 0 && manifest.extensions.length > 0) {
    throw new Error(`every Pi extension entry failed to load:\n${failures.map(item => `- ${item}`).join('\n')}`)
  }
  for (const failure of failures) onExtensionError?.(failure)
}

export async function applyPiPackage(ctx: Context, options: RuntimeOptions): Promise<void> {
  if (options.manifest.schemaVersion !== 1) throw new Error(`unsupported pi2dsh manifest version ${String(options.manifest.schemaVersion)}`)
  const rootDir = fileURLToPath(options.rootUrl)
  const runtimeTools = new Map<string, PiTool>()
  const piToolRecords = (): Array<{ definition: unknown, sourceInfo: { path: string, source: string, scope: string, origin: string } }> =>
    [...runtimeTools.values()].map(tool => ({
      definition: tool,
      sourceInfo: { path: '', source: 'pi2dsh', scope: 'session', origin: 'package' },
    }))
  const state: RuntimeState = {
    handlers: new Map(),
    tools: runtimeTools,
    runner: new ExtensionRunner(piToolRecords),
    toolDisposers: new Map(),
    toolRestrictions: new WeakMap(),
    commands: new Map(),
    flags: new Map(),
    notifications: [],
    activeAgents: new Set(),
    disposedAgents: new WeakSet(),
    currentSystemPrompt: '',
    messageSource: `pi2dsh:${options.manifest.package.name}`,
    eventBus: new EventEmitter(),
    agentScope: new AsyncLocalStorage(),
    bridge: new PiSessionBridge(),
    theme: new Theme(),
    shortcuts: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    providers: new Map(),
    autocompleteProviders: [],
    editorBuffers: new WeakMap(),
    toolsExpanded: false,
    modelOverrides: new WeakMap(),
    thinkingLevels: new WeakMap(),
    globalThinkingLevel: 'off',
    argMutations: new WeakMap(),
    streamingTexts: new Map(),
    lastLoggedModels: new WeakMap(),
    providerRouteDisposers: new Map(),
  }
  subscribeLifecycle(ctx, state)
  subscribeInterceptors(ctx, state)
  // Pi hosts ship their built-in OAuth providers ready to log in; preload the
  // four vendored official flows so `/login openai-codex` (etc.) works out of
  // the box, before any package registers its own providers.
  for (const provider of builtinProviders()) {
    state.providers.set(provider.id, { name: provider.name, baseUrl: provider.baseUrl, oauth: provider.auth.oauth })
  }
  ensureLoginCommand(ctx, state)
  if (options.manifest.skillDirs.length > 0) {
    const skills = (ctx as unknown as { get(name: string): unknown }).get('skills')
    if (skills === undefined) logger(ctx).warn('[pi2dsh] migrated skills were not mounted because this DSH composition has no ctx.skills')
    else {
      const { apply: applyFilesystemSkills } = await import('@deepseek-ai/dsh-skill-filesystem')
      applyFilesystemSkills(ctx, {
        providerName: `pi2dsh-${options.manifest.package.name.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '')}`,
        includeDefaultRoots: false,
        customSkillDirs: options.manifest.skillDirs.map(path => join(rootDir, path)),
        watch: false,
      })
    }
  }
  // Model Runtime Bridge: project the DSH llm directory as Pi's model catalog
  // and route hand-built pi-ai complete()/stream() calls through the native
  // llm service. Compositions without llm keep the empty-catalog semantics.
  const llm = llmOf(ctx)
  state.modelCatalog = new ModelCatalog(llm)
  if (llm !== undefined) {
    const cordisCtx = ctx as unknown as { on(name: string, callback: (...args: unknown[]) => unknown): () => void }
    cordisCtx.on('llm/adapters-updated', () => { void state.modelCatalog?.refresh() })
    // Pi hosts finish loading the model directory before extensions can see
    // the registry, so extension-visible reads (guardian reviewer probes)
    // never race the initial catalog fill. Later refreshes stay concurrent.
    await state.modelCatalog.refresh()
    __setPiAiLlmBridge((model, context, callOptions) => streamViaDshLlm(llm, { model, context, options: callOptions }))
    ctx.effect(() => () => __setPiAiLlmBridge(undefined))
  }
  // createAgentSession builds a real DSH child agent through ctx.agents; the
  // factory lives for exactly the runtime's lifetime.
  __setSubagentSessionFactory(subagentOptions => createBridgedAgentSession({
    cordis: ctx,
    cwd: () => cwdOf(currentAgent(state)),
    parentSessionId: () => {
      const session = agentSession(currentAgent(state))
      return session === undefined ? undefined : String(session.id ?? '') || undefined
    },
    piContentToDsh: content => piToDshContent(ctx, content),
    deliver: (agent, message, mode) => deliverAgentMessage(agent as DshAgent, message, mode),
    messageFromSessionEvent,
    messageSource: state.messageSource,
  }, subagentOptions))
  ctx.effect(() => () => __setSubagentSessionFactory(undefined))
  await registerPromptCommands(ctx, state, rootDir, options.manifest)
  await loadExtensions(rootDir, options.manifest, createPiApi(ctx, state),
    failure => logger(ctx).warn(`[pi2dsh] extension entry failed and was skipped (matching Pi's per-extension error isolation): ${failure}`))
  logger(ctx).info(`[pi2dsh] loaded ${options.manifest.package.name}: ${state.tools.size} tools, ${state.commands.size} commands, ${options.manifest.skillDirs.length} skill roots`)
}

export const runtimeInternals = {
  expandPrompt,
  normalizeToolResult,
  splitArguments,
  textBlocks,
}
