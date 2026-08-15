import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
import { CapabilityLedger, PiCapabilityError } from './capability.js'
import { PiSessionBridge } from './session-bridge.js'
import { ExtensionRunner, Theme, __setSubagentSessionFactory, generateBranchSummary, getAgentDir } from './compat/pi-coding-agent.js'
import { createBridgedAgentSession } from './subagent-bridge.js'
import {
  FileCredentialStore,
  loginPiProvider,
  providerSupportsOAuth,
  resolvePiProviderAuth,
} from './oauth-bridge.js'
import { __setPiAiLlmBridge, builtinProviders } from './compat/pi-ai.js'
import { ModelCatalog, llmOf, streamViaDshLlm } from './model-bridge.js'
import { imageAdmissionCompanionAdapter, registerPiProviderRoute } from './provider-adapter.js'

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
  packageName: string
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
  // DSH-side disposers for registered commands, so Pi's same-name
  // registerCommand replacement (Map.set semantics) can release the old one.
  commandDisposers: Map<string, () => void>
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
  autocompleteProviders: unknown[]
  editorComponentFactory?: unknown
  editorBuffers: WeakMap<object, string>
  toolsExpanded: boolean
  // Per-agent model/thinking overrides applied through the agent/request waterfall.
  modelOverrides: WeakMap<object, { provider?: string; model?: string }>
  thinkingLevels: WeakMap<object, string>
  // Per-agent, per-turn system-prompt override returned by before_agent_start
  // (Pi resets to the base prompt when a turn's handlers return none).
  turnSystemPromptOverrides: WeakMap<object, string>
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
  // HOST-level slices (same instances across every package in this host —
  // see SharedHostState): companion mapping, live route disposers, and the
  // provider directory.
  // Image-admission companion routes (companion id → original route id).
  // Pi's ctx.model reports the ORIGINAL route for a companion selection: the
  // model actually generating is the original text-only one, and extensions
  // branching on input modalities (a vision bridge deciding whether to act)
  // need that truth, not the admission face.
  companionRoutes: Map<string, string>
  // Live DSH llm routes registered for transport-carrying Pi providers.
  providerRouteDisposers: Map<string, () => void>
  // The host-shared slice this package state was built over.
  shared: SharedHostState
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

// One capability ledger per host: capability-gap hits are package facts with a
// host-level user-facing report channel (once per package+capability).
function capabilityLedgerOf(ctx: Context, state: RuntimeState): CapabilityLedger {
  const shared = state.shared
  if (shared.capabilityLedger === undefined) {
    shared.capabilityLedger = new CapabilityLedger(message => logger(ctx).warn(message))
  }
  return shared.capabilityLedger
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
// An image-admission companion selection reports its ORIGINAL route: the
// generating model is the original text-only one, and that truth is what
// extensions branching on input modalities need.
function currentPiModel(state: RuntimeState, agent: UnknownRecord): UnknownRecord | undefined {
  const override = state.modelOverrides.get(agent)
  const options = agent.options as { provider?: unknown, model?: unknown } | undefined
  const selectedProvider = String(override?.provider ?? options?.provider ?? '')
  const provider = state.companionRoutes.get(selectedProvider) ?? selectedProvider
  const id = String(override?.model ?? options?.model ?? '')
  if (id.length === 0) return override
  const known = provider.length > 0 ? state.modelCatalog?.find(provider, id) : undefined
  return known ?? { id, name: id, provider, api: 'faux', input: ['text'], reasoning: false }
}

function thinkingLevelOf(state: RuntimeState, agent: UnknownRecord | undefined): string {
  if (agent !== undefined) {
    const scoped = state.thinkingLevels.get(agent)
    if (scoped !== undefined) return scoped
  }
  return state.globalThinkingLevel
}

// Durable-log projection entries carry their source seq in the id ("dsh-<seq>").
// Sidecar entries (package-appended) have generated ids and are NOT part of the
// durable log, so they cannot anchor a fork.
function durableSeqOf(entryId: string): number | undefined {
  const match = /^dsh-(\d+)$/.exec(entryId)
  return match === null ? undefined : Number(match[1])
}

interface DshSessionsService {
  create(id?: unknown, options?: UnknownRecord): UnknownRecord
  fork(source: unknown, boundary?: number, childSessionId?: unknown): UnknownRecord
  get(id: unknown): UnknownRecord | undefined
  list(): UnknownRecord[]
}

// DSH's official fork constraint: the seed must not end inside an open turn.
// Pi allows forking at any entry, so the requested boundary shrinks to the
// nearest safe position at or before it (documented in compatibility.ts).
function shrinkToTurnBoundary(events: readonly UnknownRecord[], boundary: number): number {
  const slice = events.slice(0, boundary + 1)
  for (let i = slice.length - 1; i >= 0; i--) {
    const type = slice[i]?.type
    if (type === 'turn/end') return boundary
    if (type === 'turn/start') return Number(slice[i]!.seq) - 1
  }
  return boundary
}

// Summarize the durable slice abandoned by navigateTree, with Pi's own
// vendored summarizer; the model call runs on the DSH llm bridge. Returns
// undefined (navigation proceeds unsummarized) when no model route or no
// abandoned content exists.
async function summarizeAbandonedBranch(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  events: readonly UnknownRecord[],
  boundary: number,
  options: UnknownRecord,
): Promise<string | undefined> {
  const abandoned = events.slice(boundary + 1)
  if (abandoned.length === 0) return undefined
  const model = agent === undefined ? undefined : currentPiModel(state, agent)
  if (model === undefined) {
    logger(ctx).warn('[pi2dsh] ctx.navigateTree: no current model route, navigating without a branch summary')
    return undefined
  }
  const projection = state.bridge.readonlySessionManager(
    { id: 'pi2dsh-abandoned-branch', events: abandoned } as never,
    cwdOf(agent),
  ) as { getEntries?(): unknown[] }
  const entries = projection.getEntries?.() ?? []
  if (entries.length === 0) return undefined
  const result = await generateBranchSummary(entries, {
    model,
    signal: new AbortController().signal,
    ...(typeof options.customInstructions === 'string' ? { customInstructions: options.customInstructions } : {}),
    ...(options.replaceInstructions === true ? { replaceInstructions: true } : {}),
  }) as { summary?: string; error?: string; aborted?: boolean }
  if (result.error !== undefined) {
    logger(ctx).warn(`[pi2dsh] ctx.navigateTree: branch summarization failed (${result.error}), navigating without a summary`)
    return undefined
  }
  return result.summary
}

function contextFor(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  signal: AbortSignal | undefined,
  command = false,
  sessionOverride?: UnknownRecord,
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
  // A replaced-session context (Pi's withSession callback) binds to the
  // replacement session while the live agent — and everything that needs
  // one — stays with the turn that initiated the operation.
  const session = sessionOverride ?? agentSession(agent)
  // Pi's ModelRegistry surface over the ONE model directory — the DSH llm
  // directory — projected faithfully into Pi vocabulary (package-registered
  // route entries carry their full Pi Model fields through it). Neither
  // side sees the other: packages read exact Pi Models, DSH routes to
  // ordinary adapters. The provider-auth half resolves package-registered
  // providers through Pi's full credential chain (vendored
  // double-checked-lock refresh) and DSH routes through the host's public
  // configurable-provider and credentials seams.
  const providerConfig = (name: string): UnknownRecord | undefined => state.providers.get(name)
  const catalog = state.modelCatalog
  // Directory membership comes from the DSH llm directory alone. The DSH
  // catalog channel detaches entries to its own metadata contract, so the
  // projection restores each Pi-native route's entry from the registration
  // source at the exit — packages read the EXACT Pi Model (api, baseUrl,
  // cost, …) they configured, and never see that a DSH directory sat in
  // between. DSH-owned routes project as-is.
  const piNativeEntry = (provider: string, id: string): UnknownRecord | undefined => {
    // Restore only entries OUR route registration put in the directory
    // (package providers restore only while they own their route). A
    // foreign adapter's models never wear a Pi-native configuration's
    // fields.
    const source = (state.providerRouteDisposers.has(provider) ? state.providers.get(provider) : undefined) as
      | { getModels?(): unknown; models?: unknown }
      | undefined
    if (source === undefined) return undefined
    let models: unknown
    try {
      models = typeof source.getModels === 'function' ? source.getModels() : source.models
    } catch {
      return undefined
    }
    if (!Array.isArray(models)) return undefined
    return (models as UnknownRecord[]).find(model => model.id === id)
  }
  const restorePiShape = (entry: UnknownRecord): UnknownRecord => {
    const native = piNativeEntry(String(entry.provider ?? ''), String(entry.id ?? ''))
    return native === undefined ? entry : { ...entry, ...native, provider: entry.provider }
  }
  const allModels = () => (catalog?.all() ?? []).map(restorePiShape)
  // THE one call path for every standard Pi model call: package → bridge →
  // DSH llm route → adapter. No provider surface hands a package a direct
  // wire transport; the wire clients live inside route adapters only.
  const dshRoutedStream = (model: UnknownRecord, context: UnknownRecord, options?: UnknownRecord) => {
    const llm = llmOf(ctx)
    if (llm === undefined) {
      throw new Error('pi2dsh: model calls need a DSH llm service; this composition mounts none')
    }
    return streamViaDshLlm(llm, { model, context, options: options as never })
  }
  const dshRoutedPiProvider = (base: UnknownRecord, providerId: string): UnknownRecord => ({
    ...base,
    id: providerId,
    getModels: () => allModels().filter(model => model.provider === providerId),
    stream: dshRoutedStream,
    streamSimple: dshRoutedStream,
  })
  const modelRegistry = {
    getAll: () => allModels(),
    getAvailable: () => allModels(),
    find: (provider: string, modelId: string) => {
      const entry = catalog?.find(provider, modelId)
      return entry === undefined ? undefined : restorePiShape(entry)
    },
    getError: () => undefined,
    hasConfiguredAuth: (model: unknown) => {
      // Configuration check, not key liveness (Pi's is also a config check):
      // the route resolves iff its provider is in the live llm directory or
      // registered by a package.
      const provider = String((model as UnknownRecord | undefined)?.provider ?? '')
      if (provider.length === 0) return false
      return state.providers.has(provider)
        || (catalog?.all() ?? []).some(entry => entry.provider === provider)
    },
    // Pi's per-model credential read, two families with one resolver:
    // package-registered providers use their own declared chain; DSH routes
    // resolve through the host's public configurable-provider directory and
    // credentials service. Neither family fabricates a key: no resolution →
    // not ok.
    getApiKeyAndHeaders: async (model: unknown) => {
      const provider = String((model as UnknownRecord | undefined)?.provider ?? '')
      const config = providerConfig(provider)
      if (config !== undefined) {
        const resolved = await resolvePiProviderAuth({
          providerId: provider, providerConfig: config, store: oauthStoreOf(state),
        })
        const auth = resolved?.auth as UnknownRecord | undefined
        if (auth?.apiKey === undefined) return { ok: false }
        return {
          ok: true,
          apiKey: auth.apiKey,
          ...(auth.headers === undefined ? {} : { headers: auth.headers as Record<string, string> }),
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
    // Every provider the directory carries answers as a Pi Provider whose
    // stream surface runs through the DSH llm route — packages never hold a
    // wire transport. A package-registered provider keeps its fields (Pi's
    // read-back contract) with its stream rerouted while its route is live;
    // a DSH-owned route answers a synthesized Pi Provider over its
    // directory models.
    getProvider: (provider: string) => {
      const base = providerConfig(provider)
      if (base !== undefined) {
        const routed = state.providerRouteDisposers.has(provider)
        // A package provider that never became a route keeps its own object:
        // that transport is the package's own asset, not a bridge surface.
        return routed ? dshRoutedPiProvider(base, provider) : base
      }
      if ((catalog?.all() ?? []).some(entry => entry.provider === provider)) {
        return dshRoutedPiProvider({ id: provider, name: provider }, provider)
      }
      return undefined
    },
    // Pi's registry.complete: one designated-model call through the same
    // single path (the DSH llm route), collected to an AssistantMessage.
    complete: async (model: unknown, context: unknown, options?: unknown) => {
      const stream = dshRoutedStream(
        model as UnknownRecord,
        (context ?? {}) as UnknownRecord,
        options as UnknownRecord | undefined,
      ) as unknown as { result(): Promise<unknown> }
      const result = await stream.result()
      if (result instanceof Error) throw result
      return result
    },
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
      // Pi's refresh() re-reads the model directory projection.
      await catalog?.refresh()
      return { models: allModels(), errors: [] }
    },
  }
  const contextCwd = typeof (sessionOverride?.header as UnknownRecord | undefined)?.cwd === 'string'
    ? (sessionOverride!.header as { cwd: string }).cwd
    : cwdOf(agent)
  const base: UnknownRecord = {
    ui,
    mode: 'rpc',
    hasUI: userQuestions !== undefined,
    cwd: contextCwd,
    sessionManager: session === undefined
      ? state.bridge.readonlySessionManager({ id: 'pi2dsh-detached', events: [] }, contextCwd)
      : state.bridge.readonlySessionManager(session as never, contextCwd),
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
    // Pi defines shutdown() as "request a graceful shutdown; the actual
    // behavior is provided by the host" (runner.ts bindExtensions). This
    // host's behavior: on DSH the user owns process exit, so the request is
    // absorbed — reported to the user once, and the package keeps running.
    shutdown: () => {
      capabilityLedgerOf(ctx, state).reportHostDecision({
        capability: 'ctx.shutdown',
        reason: 'Pi delegates shutdown behavior to the host, and on DSH the user owns process exit.',
        guidance: 'The shutdown request was recorded and ignored.',
        packageName: state.packageName,
      })
    },
    getContextUsage: () => undefined,
    // Pi's compact() is a fire-and-forget trigger (void; completion flows
    // through the options callbacks). Translated to the official DSH manual
    // compaction surface: ctx.compaction.compactNow() on the live agent.
    compact: (options?: UnknownRecord) => {
      const ledger = capabilityLedgerOf(ctx, state)
      const compaction = optionalService<{
        compactNow(agent: unknown, signal: AbortSignal): Promise<unknown>
      }>(ctx, 'compaction')
      const target = agent as {
        runMaintenance?: <T>(job: (signal: AbortSignal) => Promise<T>) => Promise<T>
      } | undefined
      const onError = (options?.onError as ((error: Error) => void) | undefined)
      if (compaction === undefined || typeof target?.runMaintenance !== 'function') {
        const gap = new PiCapabilityError({
          capability: 'ctx.compact',
          reason: compaction === undefined
            ? 'this DSH composition mounts no compaction service.'
            : 'compaction needs a live DSH agent for this turn.',
          guidance: 'Compaction runs through the host compaction plugin when one is composed.',
          packageName: state.packageName,
        })
        ledger.reportDegraded({
          capability: 'ctx.compact',
          reason: gap.message,
          guidance: '',
          packageName: state.packageName,
        })
        // Pi's own error channel for compact() is the onError callback, not a
        // synchronous throw from a void trigger.
        onError?.(gap)
        return
      }
      void compaction.compactNow(target, new AbortController().signal)
        .then(result => {
          if (result === null || result === undefined) return
          const dsh = result as { summary?: unknown; shadowedTokenCount?: number }
          const summaryBlocks = Array.isArray(dsh.summary) ? dsh.summary : []
          const summaryText = summaryBlocks
            .filter((block): block is { type: string; text: string } =>
              typeof block === 'object' && block !== null
              && (block as UnknownRecord).type === 'text'
              && typeof (block as UnknownRecord).text === 'string')
            .map(block => block.text)
            .join('\n')
          const onComplete = options?.onComplete as ((result: UnknownRecord) => void) | undefined
          // Honest projection: summary text and the shadowed-content token
          // estimate are real; the DSH log has no Pi entry ids, so
          // firstKeptEntryId is empty (documented in compatibility.ts).
          onComplete?.({
            summary: summaryText,
            firstKeptEntryId: '',
            tokensBefore: dsh.shadowedTokenCount ?? 0,
          })
        })
        .catch((error: unknown) => {
          const failure = error instanceof Error ? error : new Error(String(error))
          if (onError !== undefined) {
            onError(failure)
            return
          }
          logger(ctx).warn(`[pi2dsh] plugin "${state.packageName}": ctx.compact failed: ${failure.message}`)
        })
    },
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
      // Pi's session-tree operations, on DSH's OWN official surfaces:
      // ctx.sessions.create() (new session), ctx.sessions.fork() (prefix fork
      // with lineage + open-turn validation), and the live session store
      // (switch). The replacement/forked session really exists — it appears in
      // the host's session surfaces, and the withSession callback operates on
      // it through a projection context. What DSH deliberately does NOT have
      // is a host-level "current session pointer" a plugin could move: which
      // session the user is looking at stays a host-surface choice, announced
      // once through the ledger.
      newSession: async (options?: UnknownRecord) => {
        const sessions = optionalService<DshSessionsService>(ctx, 'sessions')
        if (sessions === undefined) {
          capabilityLedgerOf(ctx, state).reportDegraded({
            capability: 'ctx.newSession',
            reason: 'this DSH composition mounts no session service.',
            guidance: '',
            packageName: state.packageName,
          })
          return { cancelled: true }
        }
        const parent = agentSession(agent) as { id?: unknown } | undefined
        const created = sessions.create(undefined, {
          meta: {
            cwd: cwdOf(agent),
            ...(parent?.id === undefined ? {} : { parentSession: parent.id }),
          },
        })
        const withSession = options?.withSession as ((replaced: unknown) => Promise<void>) | undefined
        await withSession?.(contextFor(ctx, state, agent, signal, true, created))
        capabilityLedgerOf(ctx, state).reportHostDecision({
          capability: 'ctx.newSession',
          reason: `a new DSH session was created (${String((created as { id?: unknown }).id)}).`,
          guidance: 'Which session the surface shows stays a host choice — open it from the DSH session list.',
          packageName: state.packageName,
        })
        return { cancelled: false }
      },
      fork: async (entryId: string, options?: UnknownRecord) => {
        const sessions = optionalService<DshSessionsService>(ctx, 'sessions')
        const source = agentSession(agent)
        if (sessions === undefined || source === undefined) {
          capabilityLedgerOf(ctx, state).reportDegraded({
            capability: 'ctx.fork',
            reason: sessions === undefined
              ? 'this DSH composition mounts no session service.'
              : 'forking needs the live session of an active agent.',
            guidance: '',
            packageName: state.packageName,
          })
          return { cancelled: true }
        }
        const seq = durableSeqOf(String(entryId))
        if (seq === undefined) {
          throw new Error(
            `pi2dsh: ctx.fork(${JSON.stringify(String(entryId))}) — only durable-log entries (projected ids "dsh-<seq>") `
            + 'can anchor a fork; package-appended sidecar entries are not part of the DSH durable log',
          )
        }
        // Pi's default position is "before": fork the history strictly before
        // the entry; "at" includes it.
        const position = (options?.position as string | undefined) ?? 'before'
        const events = ((source as { events?: readonly UnknownRecord[] }).events ?? []) as readonly UnknownRecord[]
        const requested = Math.min(position === 'at' ? seq : seq - 1, events.length - 1)
        const boundary = requested < 0 ? -1 : shrinkToTurnBoundary(events, requested)
        const child = boundary < 0
          ? sessions.create(undefined, {
              meta: { cwd: cwdOf(agent), parentSession: (source as { id?: unknown }).id },
            })
          : sessions.fork(source, boundary)
        const withSession = options?.withSession as ((replaced: unknown) => Promise<void>) | undefined
        await withSession?.(contextFor(ctx, state, agent, signal, true, child))
        capabilityLedgerOf(ctx, state).reportHostDecision({
          capability: 'ctx.fork',
          reason: `the session was forked on DSH's official prefix-fork surface (child ${String((child as { id?: unknown }).id)}; DSH forks land on completed-turn boundaries).`,
          guidance: 'Open the forked session from the DSH session list.',
          packageName: state.packageName,
        })
        return { cancelled: false }
      },
      navigateTree: async (targetId: string, options?: UnknownRecord) => {
        const sessions = optionalService<DshSessionsService>(ctx, 'sessions')
        const source = agentSession(agent)
        if (sessions === undefined || source === undefined) {
          capabilityLedgerOf(ctx, state).reportDegraded({
            capability: 'ctx.navigateTree',
            reason: sessions === undefined
              ? 'this DSH composition mounts no session service.'
              : 'tree navigation needs the live session of an active agent.',
            guidance: '',
            packageName: state.packageName,
          })
          return { cancelled: true }
        }
        const seq = durableSeqOf(String(targetId))
        if (seq === undefined) {
          throw new Error(
            `pi2dsh: ctx.navigateTree(${JSON.stringify(String(targetId))}) — only durable-log entries (projected ids "dsh-<seq>") `
            + 'can be navigation targets; package-appended sidecar entries are not part of the DSH durable log',
          )
        }
        const events = ((source as { events?: readonly UnknownRecord[] }).events ?? []) as readonly UnknownRecord[]
        const capped = Math.min(seq, events.length - 1)
        const boundary = capped < 0 ? -1 : shrinkToTurnBoundary(events, capped)
        const child = boundary < 0
          ? sessions.create(undefined, {
              meta: { cwd: cwdOf(agent), parentSession: (source as { id?: unknown }).id },
            })
          : sessions.fork(source, boundary)
        // Pi's navigateTree can summarize the branch being left. The vendored
        // Pi summarizer runs it over the abandoned durable slice, with the
        // model call on the DSH llm bridge; without a current model route the
        // navigation still happens, just unsummarized.
        if (options?.summarize === true) {
          const summary = await summarizeAbandonedBranch(ctx, state, agent, events, boundary, options)
          if (summary !== undefined) {
            state.bridge.appendBranchSummary(String((child as { id?: unknown }).id), summary, String(targetId))
          }
        }
        if (typeof options?.label === 'string') {
          state.bridge.appendLabel(String((child as { id?: unknown }).id), String(targetId), options.label)
        }
        capabilityLedgerOf(ctx, state).reportHostDecision({
          capability: 'ctx.navigateTree',
          reason: `navigation forked the session at the target on DSH's official surface (child ${String((child as { id?: unknown }).id)}; the DSH tree lives BETWEEN sessions via fork lineage, not inside one log).`,
          guidance: 'Open the navigated session from the DSH session list.',
          packageName: state.packageName,
        })
        return { cancelled: false }
      },
      switchSession: async (sessionPath: string, options?: UnknownRecord) => {
        const sessions = optionalService<DshSessionsService>(ctx, 'sessions')
        if (sessions === undefined) {
          capabilityLedgerOf(ctx, state).reportDegraded({
            capability: 'ctx.switchSession',
            reason: 'this DSH composition mounts no session service.',
            guidance: '',
            packageName: state.packageName,
          })
          return { cancelled: true }
        }
        // Pi passes a session FILE path; the DSH identity is the session id.
        // Accept either the bare id or a path whose basename is "<id>.jsonl".
        const raw = String(sessionPath)
        const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw
        const candidate = base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base
        const target = sessions.get(candidate) ?? sessions.list().find(entry => String((entry as { id?: unknown }).id) === candidate)
        if (target === undefined) {
          throw new Error(
            `pi2dsh: ctx.switchSession(${JSON.stringify(raw)}) — no live DSH session ${JSON.stringify(candidate)}; `
            + 'switching to persisted sessions is host-owned (resume them from the DSH surface first)',
          )
        }
        const withSession = options?.withSession as ((replaced: unknown) => Promise<void>) | undefined
        await withSession?.(contextFor(ctx, state, agent, signal, true, target))
        capabilityLedgerOf(ctx, state).reportHostDecision({
          capability: 'ctx.switchSession',
          reason: `the live DSH session ${JSON.stringify(candidate)} was targeted.`,
          guidance: 'Which session the surface shows stays a host choice — open it from the DSH session list.',
          packageName: state.packageName,
        })
        return { cancelled: false }
      },
      // Pi's reload() re-runs extensions: every mounted package disposes its
      // registrations and its entries run again through a fresh loader, so
      // edited plugin code takes effect. Skills/prompts/themes stay
      // host-managed (they reload with dsh itself) — documented in
      // compatibility.ts.
      reload: async () => {
        const remounts = state.shared.packageRemounts
        if (remounts === undefined || remounts.size === 0) return
        for (const [name, remount] of remounts) {
          try {
            await remount()
          } catch (error) {
            logger(ctx).warn(`[pi2dsh] ctx.reload: remounting "${name}" failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        capabilityLedgerOf(ctx, state).reportHostDecision({
          capability: 'ctx.reload',
          reason: 'extension entries were disposed and remounted through a fresh loader.',
          guidance: 'Skills, prompts, and themes are host-managed and reload when dsh restarts.',
          packageName: state.packageName,
        })
      },
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

  // Pi's before_agent_start fires once per user prompt: after the user
  // message is known, before the first model call. DSH's agent/pre-step
  // waterfall is exactly that seam — the step-1 decision carries the turn's
  // entering user messages, so the Pi event sees the real prompt text and
  // image attachments (Pi's expandedText/currentImages), returned custom
  // messages join the step beside the user message as plugin-sourced context
  // (Pi's role:"custom" append), and a returned systemPrompt becomes this
  // turn's override, consumed by the assembly interceptor below and reset
  // next turn exactly as Pi resets to the base prompt.
  cordis.on('agent/pre-step', async (payload: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const decision = await next() as UnknownRecord & { kind?: string, messages?: UnknownRecord[] }
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    if ((state.handlers.get('before_agent_start')?.length ?? 0) === 0) return decision
    const agent = payload.agent as UnknownRecord
    if (isSubagentOrigin(agent)) return decision
    const signal = payload.signal as AbortSignal | undefined
    const messages = decision.messages ?? []
    const userMessages = messages.filter(message =>
      ((message as { source?: { kind?: string } }).source?.kind ?? 'user') === 'user')
    const prompt = userMessages
      .flatMap(message => textBlocks((message as { content?: unknown }).content))
      .map(block => block.text)
      .join('\n')
    const images = await collectPiImages(ctx, userMessages)
    state.turnSystemPromptOverrides.delete(agent)
    const event: UnknownRecord = {
      type: 'before_agent_start',
      prompt,
      ...(images.length > 0 ? { images } : {}),
      systemPrompt: state.currentSystemPrompt,
      systemPromptOptions: {},
    }
    const results = await dispatch(state, 'before_agent_start', event, contextFor(ctx, state, agent, signal))
    const injected: UnknownRecord[] = []
    for (const result of results) {
      if (typeof result !== 'object' || result === null) continue
      const record = result as UnknownRecord
      if (typeof record.systemPrompt === 'string') {
        state.turnSystemPromptOverrides.set(agent, record.systemPrompt)
        event.systemPrompt = record.systemPrompt
      }
      const message = record.message as UnknownRecord | undefined
      if (message !== undefined) {
        const content = message.content
        const blocks = await piToDshContent(ctx, typeof content === 'string' ? [{ type: 'text', text: content }] : content ?? [])
        injected.push(createUserMessage({
          content: blocks,
          // piCustomType rides the merge-extensible source so the durable log
          // (and every later projection) keeps Pi's role:"custom" identity.
          source: {
            kind: 'plugin', plugin: state.messageSource,
            ...(typeof message.customType === 'string' ? { piCustomType: message.customType } : {}),
          },
        }) as unknown as UnknownRecord)
      }
    }
    const stepMessages = injected.length === 0 ? messages : [...messages, ...injected]
    // Pi's context event fires before every model call with the full message
    // array and may return a transformed copy. DSH's durable history is
    // append-only, so the projection splits: entered history is read-only,
    // and only this step's not-yet-entered messages accept the transform —
    // which is exactly the slice packages rewrite (their own custom messages
    // and the turn's user message, e.g. image placeholders → guide text).
    const transformed = await applyPiContextTransform(ctx, state, agent, signal, stepMessages)
    if (transformed === stepMessages && injected.length === 0) return decision
    return { ...decision, messages: transformed }
  })

  cordis.on('system-prompt/assemble', async (assembly: UnknownRecord, assembleContext: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const downstream = await next()
    if ((state.handlers.get('before_agent_start')?.length ?? 0) === 0) return downstream
    const original = renderPrompt(downstream as never)
    state.currentSystemPrompt = original
    const agent = (assembleContext.agent ?? assembleContext.scope) as UnknownRecord | undefined
    if (agent !== undefined && !isSubagentOrigin(agent)) {
      // A live agent assembly: the pre-step bridge above owns the Pi event
      // for its turn; this interceptor only applies the stored override.
      const override = state.turnSystemPromptOverrides.get(agent)
      if (override === undefined) return downstream
      state.currentSystemPrompt = override
      return { ...downstream, sections: [{ name: 'pi2dsh:system-prompt', text: override }] }
    }
    // No live agent (diagnostics, compositions without the agent loop): keep
    // the assembly-time dispatch so systemPrompt-replacement packages still
    // run; Pi's prompt/images/custom-message surfaces need a real turn.
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
    }
    state.currentSystemPrompt = replacement
    return { ...downstream, sections: [{ name: 'pi2dsh:system-prompt', text: replacement }] }
  })
}

// Project one not-yet-entered DSH message as the Pi message shape context
// handlers expect: a piCustomType source marker restores Pi's role:"custom"
// identity, everything else is a user message.
function piShapeOfPending(message: UnknownRecord): UnknownRecord {
  const source = message.source as UnknownRecord | undefined
  const content = dshToPiContent((message.content ?? []) as ContentBlock[])
  return typeof source?.piCustomType === 'string'
    ? { role: 'custom', customType: source.piCustomType, content }
    : { role: 'user', content }
}

// Pi's context event on the DSH seam: full history (read-only projection from
// the durable log) plus this step's pending messages (transformable). A
// handler's returned array must keep the length; only the pending tail is
// applied, with each message's blocks rebuilt from the returned Pi content.
async function applyPiContextTransform(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord,
  signal: AbortSignal | undefined,
  pending: UnknownRecord[],
): Promise<UnknownRecord[]> {
  if ((state.handlers.get('context')?.length ?? 0) === 0) return pending
  const session = agentSession(agent)
  const history: UnknownRecord[] = []
  for (const event of ((session?.events ?? []) as UnknownRecord[])) {
    const projected = messageFromSessionEvent(event)
    if (projected === undefined) continue
    if (event.type === 'user/message') {
      const customType = ((event.data as UnknownRecord | undefined)?.source as UnknownRecord | undefined)?.piCustomType
      if (typeof customType === 'string') {
        history.push({ ...projected, role: 'custom', customType })
        continue
      }
    }
    history.push(projected)
  }
  const projectedPending = pending.map(piShapeOfPending)
  const event: UnknownRecord = { type: 'context', messages: [...history, ...projectedPending] }
  const results = await dispatch(state, 'context', event, contextFor(ctx, state, agent, signal))
  let current = event.messages as UnknownRecord[]
  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue
    const returned = (result as UnknownRecord).messages
    if (!Array.isArray(returned)) continue
    if (returned.length !== current.length) {
      logger(ctx).warn('[pi2dsh] a Pi context handler changed the message count; DSH durable history is append-only, so the transform was ignored')
      continue
    }
    current = returned as UnknownRecord[]
  }
  if (current === event.messages) return pending
  for (let index = 0; index < history.length; index++) {
    if (current[index] === history[index]) continue
    if (JSON.stringify(current[index]) === JSON.stringify(history[index])) continue
    logger(ctx).warn('[pi2dsh] a Pi context handler edited already-entered history; DSH durable history is append-only, so those edits were ignored (only this step\'s not-yet-entered messages accept the transform)')
    break
  }
  const tail = current.slice(history.length)
  const rebuilt: UnknownRecord[] = []
  for (const [index, original] of pending.entries()) {
    const shape = tail[index]
    if (shape === undefined) { rebuilt.push(original); continue }
    const blocks = await piToDshContent(ctx, typeof shape.content === 'string'
      ? [{ type: 'text', text: shape.content }]
      : shape.content ?? [])
    rebuilt.push(createUserMessage({
      content: blocks,
      source: (original.source ?? { kind: 'plugin', plugin: state.messageSource }) as never,
    }) as unknown as UnknownRecord)
  }
  return rebuilt
}

// Pi's before_agent_start images: the entering user messages' image
// attachments, read back from the DSH attachment store as base64
// ImageContent. Messages without attachments (or compositions without the
// attachment service) simply contribute none — the path-in-prompt flow the
// vision packages document works either way.
async function collectPiImages(ctx: Context, messages: UnknownRecord[]): Promise<UnknownRecord[]> {
  const attachments = (ctx as unknown as { get(name: string): unknown }).get('attachments') as {
    readImage(attachment: unknown): Promise<{ data: ArrayBufferLike }>
  } | undefined
  if (attachments === undefined) return []
  const images: UnknownRecord[] = []
  for (const message of messages) {
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const block of content as UnknownRecord[]) {
      if (block?.type !== 'image' || block.attachment === undefined) continue
      try {
        const stored = await attachments.readImage(block.attachment)
        images.push({
          type: 'image',
          data: Buffer.from(stored.data).toString('base64'),
          mimeType: String((block.attachment as UnknownRecord).mediaType ?? 'image/png'),
        })
      } catch {
        // An unreadable attachment contributes no image; Pi passes what exists.
      }
    }
  }
  return images
}

function oauthStoreOf(state: RuntimeState): FileCredentialStore {
  state.shared.oauthStore ??= new FileCredentialStore(join(getAgentDir(), 'auth.json'))
  return state.shared.oauthStore
}

const COMPANION_ROUTE_PREFIX = 'pi2dsh-companion/'

// HOST-level state, shared by every Pi package mounted into one host
// composition (the engine and host bundles mount several packages through
// one module graph and one Context). Pi's own semantics make these
// singular per host: ONE provider directory, ONE /login command, ONE
// credential store, ONE catalog projection. Package state (tools,
// commands, events, runner) stays per-package. Separate converted bundles
// each carry their own module graph, so this map is naturally per-bundle
// there — existing behavior unchanged.
interface SharedHostState {
  companionRoutes: Map<string, string>
  providerRouteDisposers: Map<string, () => void>
  providers: Map<string, UnknownRecord>
  modelCatalog?: ModelCatalog
  catalogSubscribed?: boolean
  loginRegistered?: boolean
  companionSweepSubscribed?: boolean
  oauthStore?: FileCredentialStore
  capabilityLedger?: CapabilityLedger
  // Per-package remount closures backing Pi's ctx.reload(): dispose every
  // extension-owned registration and run the extension entries again through
  // a fresh loader, so edited plugin code takes effect. Host-managed resources
  // (skills, prompts) reload with dsh itself.
  packageRemounts?: Map<string, () => Promise<void>>
}

const SHARED_HOST_STATE = new WeakMap<object, SharedHostState>()

function sharedHostStateOf(ctx: Context): SharedHostState {
  const key = ((ctx as unknown as { root?: object }).root ?? ctx) as object
  let shared = SHARED_HOST_STATE.get(key)
  if (shared === undefined) {
    shared = {
      companionRoutes: new Map(),
      providerRouteDisposers: new Map(),
      providers: new Map(),
    }
    SHARED_HOST_STATE.set(key, shared)
  }
  return shared
}

/** Companion configuration: default (auto), `false` (off), or an explicit narrow map. */
export type VisionCompanionsConfig = false | Record<string, readonly string[]> | undefined

/**
 * Image-admission companion routes: for every text-only route in the DSH
 * llm directory, a `<route>-vision` route that admits images at the host's
 * admission checks, replaces image blocks with explicit path-carrying
 * notices, and forwards text-only to the original route. What happens to
 * an admitted image is decided at run time by whatever is mounted — a
 * vision extension analyzes it through the turn's entering messages, and
 * without one the notice's file path lets any image-capable tool read it —
 * so companions need no knowledge of any particular plugin and are
 * registered AUTOMATICALLY (zero configuration). `visionCompanions: false`
 * turns them off; an explicit `{ <route>: [modelIds] }` map narrows them.
 * The directory is live: adapters-updated re-sweeps, adding companions for
 * new text-only routes and disposing companions whose original vanished.
 * The companion is an ordinary directory entry (single-directory
 * contract); Pi's ctx.model reports the original route for it
 * (companionRoutes). Idempotent per host.
 */
export function registerVisionCompanions(ctx: Context, config: VisionCompanionsConfig): void {
  if (config === false) return
  const shared = sharedHostStateOf(ctx)
  const llm = llmOf(ctx)
  if (llm === undefined) return
  const sweep = async (): Promise<void> => {
    const explicit = config
    const providers = llm.listProviders()
    const wanted = new Map<string, { originalId: string, imageModels: Set<string> | undefined }>()
    if (explicit !== undefined) {
      for (const [originalId, modelIds] of Object.entries(explicit)) {
        if (!Array.isArray(modelIds) || modelIds.length === 0) continue
        if (!providers.some(provider => provider.id === originalId)) {
          logger(ctx).warn(`[pi2dsh] visionCompanions names route ${JSON.stringify(originalId)}, but no such llm route exists; no companion route was registered`)
          continue
        }
        wanted.set(`${originalId}-vision`, { originalId, imageModels: new Set(modelIds.map(String)) })
      }
    } else {
      for (const provider of providers) {
        if (shared.companionRoutes.has(provider.id)) continue
        try {
          const models = await llm.listModels(provider.id)
          if (models.length === 0) continue
          const textOnly = models.every(model => !(Array.isArray(model.inputModalities) && (model.inputModalities as string[]).includes('image')))
          // undefined imageModels = every model of the route.
          if (textOnly) wanted.set(`${provider.id}-vision`, { originalId: provider.id, imageModels: undefined })
        } catch {
          // A provider whose adapter fails to list contributes no companion.
        }
      }
    }
    // Dispose companions whose original route vanished from the directory.
    for (const [key, dispose] of shared.providerRouteDisposers) {
      if (!key.startsWith(COMPANION_ROUTE_PREFIX)) continue
      const companionId = key.slice(COMPANION_ROUTE_PREFIX.length)
      const originalId = shared.companionRoutes.get(companionId)
      if (originalId !== undefined && !providers.some(provider => provider.id === originalId)) {
        shared.providerRouteDisposers.delete(key)
        dispose()
        logger(ctx).info(`[pi2dsh] companion route ${JSON.stringify(companionId)} disposed (its original route ${JSON.stringify(originalId)} left the directory)`)
      }
    }
    for (const [companionId, spec] of wanted) {
      // The companion→original mapping is a CONFIGURATION fact, not a
      // registration outcome: in a host with several bundles, one bundle
      // wins the route name and the others' registration is refused, but
      // every bundle's ctx.model projection must still report the original
      // route for a companion selection.
      shared.companionRoutes.set(companionId, spec.originalId)
      if (shared.providerRouteDisposers.has(`${COMPANION_ROUTE_PREFIX}${companionId}`)) continue
      try {
        const dispose = (llm as unknown as { registerAdapter(providers: string[], adapter: unknown): () => void })
          .registerAdapter([companionId], imageAdmissionCompanionAdapter({
            originalId: spec.originalId,
            ...(spec.imageModels === undefined ? {} : { imageModels: spec.imageModels }),
            llm,
            materializeImage: attachment => materializeAttachmentImage(ctx, attachment),
          }))
        shared.providerRouteDisposers.set(`${COMPANION_ROUTE_PREFIX}${companionId}`, dispose)
        logger(ctx).info(`[pi2dsh] image-admission companion route ${JSON.stringify(companionId)} registered for ${JSON.stringify(spec.originalId)}`)
      } catch (error) {
        logger(ctx).warn(`[pi2dsh] companion route ${JSON.stringify(companionId)} already has a live adapter in this host (${error instanceof Error ? error.message : String(error)}); reusing it`)
      }
    }
  }
  // Our own companion registrations fire llm/adapters-updated, so the
  // event-triggered sweep must coalesce: one in flight, at most one queued.
  // Convergence: a re-sweep after registration finds nothing new to add.
  let sweeping = false
  let queued = false
  const runSweep = (): void => {
    if (sweeping) {
      queued = true
      return
    }
    sweeping = true
    void sweep().finally(() => {
      sweeping = false
      if (queued) {
        queued = false
        runSweep()
      }
    })
  }
  runSweep()
  if (shared.companionSweepSubscribed !== true) {
    shared.companionSweepSubscribed = true
    const cordisCtx = ctx as unknown as { on(name: string, callback: (...args: unknown[]) => unknown): () => void }
    cordisCtx.on('llm/adapters-updated', () => { runSweep() })
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
}

// Give a stored image attachment a filesystem path so path-taking tools
// (Pi's read, vision tools) can reach it — Pi's own world has no attachment
// store, images are inline or file paths, so a path IS the Pi-shaped answer.
// Files are cached per attachment id under the OS temp dir.
async function materializeAttachmentImage(ctx: Context, attachment: UnknownRecord): Promise<string | undefined> {
  const attachments = (ctx as unknown as { get(name: string): unknown }).get('attachments') as {
    readImage(attachment: unknown): Promise<{ data: ArrayBufferLike }>
  } | undefined
  const id = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : undefined
  if (attachments === undefined || id === undefined) return undefined
  const extension = IMAGE_EXTENSIONS[String(attachment.mediaType)] ?? 'png'
  const dir = join(tmpdir(), 'pi2dsh-attached-images')
  const filePath = join(dir, `${id}.${extension}`)
  try {
    if (!existsSync(filePath)) {
      const stored = await attachments.readImage(attachment)
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, Buffer.from(stored.data))
    }
    return filePath
  } catch {
    // An unreadable attachment simply keeps the plain omission notice.
    return undefined
  }
}

// Pi hosts ship /login <provider> as a built-in; register it once per HOST
// (the provider directory it reads is host-shared, so one command serves
// every mounted package). The try/catch still guards the separate-bundle
// layout, where each bundle carries its own module graph and host slice.
function ensureLoginCommand(ctx: Context, state: RuntimeState): void {
  if (state.shared.loginRegistered === true) return
  state.shared.loginRegistered = true
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
  // catalog packages (pi-fabric) re-register wrapped variants at runtime,
  // and the reload remount re-registers every tool. The DSH-side
  // registration STAYS on a replacement: its execute() resolves the live
  // ledger entry, so swapping the ledger swaps the behavior. (Re-registering
  // on the DSH side from an execution stack would attach the effect to the
  // wrong fiber scope and hide the tool from registered agents.)
  if (state.tools.has(tool.name)) {
    const previous = state.tools.get(tool.name)!
    state.tools.set(tool.name, tool)
    if (JSON.stringify(previous.parameters ?? null) !== JSON.stringify(tool.parameters ?? null)) {
      logger(ctx).warn(`[pi2dsh] tool ${tool.name} was re-registered with a different parameter schema; the new schema takes effect when dsh restarts (behavior is already live)`)
    }
    return
  }
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
      // Live ledger resolution (see the re-registration note above).
      const live = state.tools.get(tool.name) ?? tool
      const mutated = state.argMutations.get(exec as unknown as object)
      if (mutated !== undefined) state.argMutations.delete(exec as unknown as object)
      const effective = mutated ?? args
      const prepared = live.prepareArguments?.(cloneJson(effective)) ?? effective
      const agent = exec.agent as unknown as UnknownRecord | undefined
      const result = await normalizeToolResultForDsh(ctx, await state.agentScope.run(agent, () => live.execute(
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
  // Pi's registerCommand never throws. Within one extension it is Map.set —
  // a same-name registration replaces the earlier one (loader.ts
  // extension.commands.set). Colliding registrations from DIFFERENT sources
  // both survive in Pi under numbered invocation names (runner.ts
  // resolveRegisteredCommands: /name:1, /name:2). On the shared DSH command
  // namespace the earlier registration's name cannot be rewritten from here,
  // so the mapped semantics are: this package's re-registration replaces its
  // own command and keeps the base name; a collision with another package's
  // command registers under Pi's numbered scheme (/name-2, /name-3 — DSH
  // command naming takes '-' where Pi takes ':') while the first keeps the
  // bare name.
  if (state.commands.has(command.name)) {
    // Same-name re-registration (Pi's Map.set semantics, and the reload
    // remount path): the DSH-side registration STAYS — its handler resolves
    // the live command from the ledger below, so replacing the ledger entry
    // is the complete replacement. Re-registering on the DSH side from a
    // command execution stack would attach the effect to the wrong fiber
    // scope and make the command invisible to registered agents.
    state.commands.set(command.name, command)
    return
  }
  state.commands.set(command.name, command)
  const commands = (ctx as unknown as { get(name: string): unknown }).get('commands') as {
    register(definition: UnknownRecord): () => void
  } | undefined
  if (commands === undefined) {
    logger(ctx).warn(`[pi2dsh] command /${command.name} was not registered because this DSH composition has no ctx.commands`)
    return
  }
  const baseName = dshCommandName(ctx, command.name)
  const definitionFor = (dshName: string): UnknownRecord => ({
    name: dshName,
    description: command.description || `Migrated Pi command /${command.name}`,
    // EVERY Pi command takes a free-form argument string by contract
    // (`handler(args, ctx)`), whether or not the package declared a hint. DSH
    // surfaces only pass arguments to commands that declare an `input`
    // descriptor — without one, "/name some args" is sent as a chat message
    // instead of invoking the command (ui-commands' matchEnter: an argued
    // line for an input-less command is not claimed). So the descriptor is
    // always declared, using the package's hint when it has one.
    input: { hint: command.argumentHint ?? 'arguments (optional)' },
    async handler(invocation: UnknownRecord) {
      const agent = invocation.agent as UnknownRecord
      const commandContext = contextFor(ctx, state, agent, invocation.signal as AbortSignal, true)
      // Resolve the LIVE command from the ledger: a same-name re-registration
      // (including a reload remount) replaces the ledger entry while this one
      // DSH-side registration keeps serving the name.
      const live = state.commands.get(command.name) ?? command
      await state.agentScope.run(agent, () => live.handler(String(invocation.rawInput ?? '').trimStart(), commandContext))
      const notices = commandContext.__notices as string[]
      return { kind: 'success', ...(notices.length > 0 ? { text: notices.join('\n') } : {}) }
    },
  })
  let lastError: unknown
  for (let ordinal = 1; ordinal <= 9; ordinal++) {
    const dshName = ordinal === 1 ? baseName : `${baseName}-${ordinal}`
    try {
      state.commandDisposers.set(command.name, commands.register(definitionFor(dshName)))
      if (ordinal > 1) {
        logger(ctx).warn(`[pi2dsh] command /${command.name} collides with an earlier registration in this host; mounted as /${dshName} (Pi numbers colliding commands the same way)`)
      }
      return
    } catch (error) {
      lastError = error
    }
  }
  logger(ctx).warn(`[pi2dsh] command /${command.name} was not registered: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
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
  onCapabilityGap?: (error: PiCapabilityError, extension: string) => void,
  onHostInfraReference?: (symbol: string, extension: string) => void,
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
    // Startup check, BEFORE the entry runs: an import of a host-owned symbol
    // that cannot work on DSH is surfaced at mount time, so the user learns
    // at startup instead of when some later code path constructs it.
    try {
      const source = await readFile(join(rootDir, extension), 'utf8')
      const infraImport = /import[^;]*?\b(ModelRuntime|DefaultPackageManager)\b[^;]*?from\s*['"]@(?:earendil-works|mariozechner)\/pi-coding-agent['"]/su.exec(source)
      if (infraImport !== null) onHostInfraReference?.(infraImport[1]!, extension)
    } catch {
      // Unreadable entries fail below through the loader with a real error.
    }
    try {
      const loaded: unknown = await jiti.import(join(rootDir, extension))
      const candidate = typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? (loaded as { default: unknown }).default
        : loaded
      if (typeof candidate !== 'function') throw new TypeError(`Pi extension ${extension} has no default factory function`)
      await candidate(api)
      mounted += 1
    } catch (error) {
      // A capability gap during entry setup means this package cannot start
      // at all — the user gets the unusable verdict, not just a skip line.
      // Matched by name: the shim chunk carries its own compiled copy of the
      // class, so instanceof does not hold across that bundle boundary.
      if (error instanceof PiCapabilityError
        || (error instanceof Error && error.name === 'PiCapabilityError')) {
        onCapabilityGap?.(error as PiCapabilityError, extension)
      }
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
  const shared = sharedHostStateOf(ctx)
  const state: RuntimeState = {
    shared,
    packageName: options.manifest.package.name,
    handlers: new Map(),
    tools: runtimeTools,
    runner: new ExtensionRunner(piToolRecords),
    toolDisposers: new Map(),
    toolRestrictions: new WeakMap(),
    commands: new Map(),
    commandDisposers: new Map(),
    companionRoutes: shared.companionRoutes,
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
    providers: shared.providers,
    autocompleteProviders: [],
    editorBuffers: new WeakMap(),
    toolsExpanded: false,
    modelOverrides: new WeakMap(),
    thinkingLevels: new WeakMap(),
    turnSystemPromptOverrides: new WeakMap(),
    globalThinkingLevel: 'off',
    argMutations: new WeakMap(),
    streamingTexts: new Map(),
    lastLoggedModels: new WeakMap(),
    providerRouteDisposers: shared.providerRouteDisposers,
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
  // Model Runtime Bridge: ONE model directory — the DSH llm directory —
  // projected as Pi's model catalog; hand-built pi-ai complete()/stream()
  // calls route through the native llm service. Compositions without llm
  // keep the empty-catalog semantics.
  const llm = llmOf(ctx)
  // ONE catalog projection and ONE adapters-updated subscription per host;
  // every package's registry reads the same directory view.
  state.modelCatalog = shared.modelCatalog ??= new ModelCatalog(llm)
  registerVisionCompanions(ctx, (options.config as { visionCompanions?: VisionCompanionsConfig } | undefined)?.visionCompanions)
  if (llm !== undefined) {
    if (shared.catalogSubscribed !== true) {
      shared.catalogSubscribed = true
      const cordisCtx = ctx as unknown as { on(name: string, callback: (...args: unknown[]) => unknown): () => void }
      cordisCtx.on('llm/adapters-updated', () => { void shared.modelCatalog?.refresh() })
    }
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
    parentDelegationDepth: () => {
      // DSH's delegationDepthOf semantics: header depth and runtime option
      // depth may each deepen the count; absence means top-level zero.
      const parent = currentAgent(state)
      const header = (agentSession(parent) as { header?: { delegationDepth?: unknown } } | undefined)?.header
      const fromHeader = typeof header?.delegationDepth === 'number' ? header.delegationDepth : 0
      const fromOptions = typeof (parent as { options?: { subagentDepth?: unknown } } | undefined)?.options?.subagentDepth === 'number'
        ? (parent as { options: { subagentDepth: number } }).options.subagentDepth
        : 0
      return Math.max(fromHeader, fromOptions)
    },
    piContentToDsh: content => piToDshContent(ctx, content),
    deliver: (agent, message, mode) => deliverAgentMessage(agent as DshAgent, message, mode),
    messageFromSessionEvent,
    messageSource: state.messageSource,
  }, subagentOptions))
  ctx.effect(() => () => __setSubagentSessionFactory(undefined))
  await registerPromptCommands(ctx, state, rootDir, options.manifest)
  const onExtensionError = (failure: string): void =>
    logger(ctx).warn(`[pi2dsh] extension entry failed and was skipped (matching Pi's per-extension error isolation): ${failure}`)
  const onCapabilityGap = (gap: PiCapabilityError): void =>
    capabilityLedgerOf(ctx, state).reportUnusable({
      capability: gap.capability,
      reason: 'this package needs it during startup.',
      guidance: gap.message,
      packageName: state.packageName,
    })
  const onHostInfraReference = (symbol: string): void =>
    capabilityLedgerOf(ctx, state).reportStartupReference({
      capability: symbol,
      reason: symbol === 'DefaultPackageManager'
        ? 'installing packages is owned by the DSH host and its security gates (dsh plugin add/remove).'
        : "standalone model stacks are owned by the DSH host llm configuration (packages read ctx.modelRegistry).",
      guidance: '',
      packageName: state.packageName,
    })
  const mountExtensions = (): Promise<void> => loadExtensions(
    rootDir, options.manifest, createPiApi(ctx, state), onExtensionError, onCapabilityGap, onHostInfraReference)
  await mountExtensions()
  // Pi's ctx.reload() remount: dispose every extension-owned registration and
  // run the entries again through a fresh loader. Prompt commands are package
  // registrations too (they share the command ledger), so they re-register
  // with the entries.
  const remounts = (shared.packageRemounts ??= new Map())
  remounts.set(state.packageName, async () => {
    // Tool and command registrations on the DSH side stay in place — their
    // handlers resolve the live ledger entries, and re-registering from a
    // command execution stack would attach effects to the wrong fiber scope.
    // The remounted entries replace ledger entries through the same-name
    // registration path; event handlers (both Pi lifecycle handlers and the
    // package-local event bus) start from a clean slate — without this every
    // reload would double the subscriptions.
    state.handlers.clear()
    state.eventBus.removeAllListeners()
    await registerPromptCommands(ctx, state, rootDir, options.manifest)
    await mountExtensions()
  })
  ctx.effect(() => () => { remounts.delete(state.packageName) })
  const health = state.shared.capabilityLedger?.healthOf(state.packageName)
  const healthSuffix = health === undefined || health.status === 'ok'
    ? ''
    : ` — ${health.status.toUpperCase()}: missing Pi capabilities ${health.gaps.join(', ')}`
  logger(ctx).info(`[pi2dsh] loaded ${options.manifest.package.name}: ${state.tools.size} tools, ${state.commands.size} commands, ${options.manifest.skillDirs.length} skill roots${healthSuffix}`)
}

export const runtimeInternals = {
  expandPrompt,
  normalizeToolResult,
  splitArguments,
  textBlocks,
}
