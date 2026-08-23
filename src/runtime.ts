// TODO: 拆解本文件（2026-08-20 用户拍板，待做）。~3.9k 行承载了包挂载、
// SharedHostState、模型目录投影、/login 与凭证恢复、伴生路由、命令/工具/
// 事件桥等多个职责。拆法必须跟着架构走：按 CLAUDE.md 三层结构与 host 级/
// 包级资源边界切模块，纯搬家不改逻辑；动手前先给出切分方案对齐再执行。
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createJiti } from 'jiti'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
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
import {
  ExtensionRunner,
  Theme,
  __runWithSubagentSessionFactory,
  generateBranchSummary,
  getAgentDir,
} from './compat/pi-coding-agent.js'
import { getKeybindings, stripTerminalSequences } from './compat/pi-tui.js'
import { childLabel, createBridgedAgentSession, type SubagentHost } from './subagent-bridge.js'
import { openBrowser } from './compat/vendor/pi-open-browser.js'
import { BrowserSurfaces, publishAuthorization, registerBrowserSurfaceRoute, revokeAuthorization, surfaceText, type SurfaceKey } from './browser-surfaces.js'

/** Fallback thread ids when a child session reports none. */
let sidePanelSerial = 0
import {
  FileCredentialStore,
  joinSignals,
  loginPiProvider,
  providerSupportsOAuth,
  resolveOAuthApiKey,
  resolvePiProviderAuth,
  storedOAuthCredential,
} from './oauth-bridge.js'
import { __createPiAiRuntimeRegistry, __runWithPiAiRuntime, builtinProviders } from './compat/pi-ai.js'
import { validateToolArguments } from './compat/vendor/pi-tool-validation.js'
import { ModelCatalog, llmOf, streamViaDshLlm, type DshAttachmentsLike } from './model-bridge.js'
import { imageAdmissionCompanionAdapter, providerCarriesTransport, registerPiProviderRoute, type PiRouteHandle } from './provider-adapter.js'
import { oauthCredentialRef } from './oauth-bridge.js'
import {
  commandNameForDshTui,
  mountTuiSurfaceAdapter,
  type PiCustomFactory,
  type PiCustomOptions,
  type TuiSurfaceAdapter,
  type TuiSurfaceContext,
} from './tui-surfaces.js'

type UnknownRecord = Record<string, unknown>
type PiHandler = (event: UnknownRecord, context: UnknownRecord) => unknown | Promise<unknown>

// DSH's browser tool-view slot is keyed by exact wire tool name. Pi has no
// output-schema flag for image results, so support only packages whose image
// tool contract we have verified. This is intentionally small and explicit:
// mounting an unrelated Pi package must never replace its existing DSH card.
const KNOWN_IMAGE_TOOLS_BY_PACKAGE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['@crazygit/pi-codex-image-gen', new Set(['codex_generate_image'])],
])

function isKnownImageTool(packageName: string, toolName: string): boolean {
  return KNOWN_IMAGE_TOOLS_BY_PACKAGE.get(packageName)?.has(toolName) === true
}

interface RuntimeOptions {
  rootUrl: URL
  manifest: GeneratedRuntimeManifest
  config?: UnknownRecord
  /** Exact Agent owner supplied by the pre-publication setup host. */
  ownerAgent?: UnknownRecord
  /**
   * Host-anchor mount: the once-per-host instance that carries a package's
   * HOST-level contributions — provider routes, OAuth accounts, `/login`
   * availability, credential recovery, companion routes, skills — so they
   * exist from engine apply with zero live Agents and survive Agent churn
   * (SharedHostState keeps them single-instance and refcounted alongside the
   * per-Agent instances). The anchor serves no Agent: it never bridges
   * session lifecycles and its agent-facing surfaces (DSH tools, commands,
   * prompt sections) are not projected — those belong to the per-Agent
   * instances that own real sessions.
   */
  hostAnchor?: boolean
}

interface PiTool {
  name: string
  label?: string
  description: string
  parameters: unknown
  /** Pi: one line for the system prompt's "Available tools" list. */
  promptSnippet?: string
  /** Pi: guideline bullets that apply while this tool is active. */
  promptGuidelines?: string[]
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
  /** Exact DSH Agent that owns this runtime; absent only for legacy root mounts. */
  ownerAgent: UnknownRecord | undefined
  /** Host-anchor mount: host-level contributions only, serves no Agent (see RuntimeOptions.hostAnchor). */
  hostAnchor: boolean
  /** The session-event projector, exposed for the mount-time backlog replay. */
  projectSessionEvent?: (session: UnknownRecord, event: UnknownRecord) => void
  /** Owned mounts: live session-event delivery starts after the backlog replay. */
  sessionEventsLive?: boolean
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
  /** DSH command name -> Pi command that currently owns that public name. */
  dshCommandOwners: Map<string, string>
  flags: Map<string, boolean | string | undefined>
  notifications: string[]
  activeAgents: Set<UnknownRecord>
  /** Latest non-child Agent whose Pi session owns this package instance. */
  hostAgent: UnknownRecord | undefined
  /** Agents whose linear Pi session_shutdown has already been projected. */
  piShutdownAgents: WeakSet<object>
  disposedAgents: WeakSet<object>
  /** Durable sessions that have already received Pi's session_start event. */
  startedSessions: Set<string>
  /** In-flight session_start handlers, so an immediate command can await initialization. */
  sessionStartTasks: Map<string, Promise<void>>
  /** Fallback dedupe for command agents whose composition has no durable session. */
  startedSessionlessAgents: WeakSet<object>
  /** In-flight session_start handlers for agents without a durable session id. */
  sessionlessStartTasks: WeakMap<object, Promise<void>>
  /** Extension entries are async imports; lifecycle events wait until handlers exist. */
  extensionsReady: boolean
  /** Agent starts observed while extension entries are still loading. */
  pendingSessionStarts: Map<UnknownRecord, string>
  currentSystemPrompt: string
  messageSource: string
  /** Pi's cross-extension bus: shared by every package instance of one agent
   * (host/anchor instances share the host bus), matching Pi's one-bus-per-
   * session contract. NEVER removeAllListeners on it — that would strip the
   * other packages' subscriptions; unwind through eventBusOffs instead. */
  eventBus: EventEmitter
  /** This instance's own bus subscriptions, for scoped unwind on dispose/reload. */
  eventBusOffs: Array<() => void>
  agentScope: AsyncLocalStorage<UnknownRecord | undefined>
  /** Per-Agent bridge used by Pi's designated-model calls. */
  llmBridge: PiAiLlmBridge | undefined
  /** Per-Agent copy of Pi's compat and API-provider registries. */
  piAiRegistry: ReturnType<typeof __createPiAiRuntimeRegistry>
  /** Per-Agent factory used by Pi's createAgentSession(). */
  subagentSessionFactory: SubagentSessionFactory | undefined
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
  /**
   * The single ordered stream for projections that must keep durable-log
   * order. Several of them now await the attachment service (Pi's content
   * blocks carry image bytes inline), and the subscribers that feed them are
   * synchronous — without one shared chain a tool result with an image can be
   * announced after the turn that produced it has already ended.
   */
  projection: Promise<unknown>
  /**
   * Pi's `terminate` hint, accumulated across the current tool batch. Pi stops
   * the loop only when EVERY finalized call in the batch asked for it, and a
   * single call cannot know that — so the calls record here and the next step
   * boundary reads the verdict.
   */
  terminateBatch: WeakMap<object, { calls: number, terminating: number }>
  /** Pi's turnIndex: reset when a DSH turn opens, incremented after each step. */
  piTurnIndex: WeakMap<object, number>
  /** Messages DSH claimed for the step that is about to be assembled. */
  claimedForStep: WeakMap<object, UnknownRecord[]>
  /** The turn each agent's before_agent_start has already fired for. */
  promptedTurn: WeakMap<object, number>
  /** Custom messages a before_agent_start handler returned, awaiting the step. */
  pendingInjections: WeakMap<object, UnknownRecord[]>
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
  providerRouteDisposers: Map<string, PiRouteHandle>
  /** Host-shared provider routes this Agent runtime owns one reference to. */
  ownedProviderRoutes: Set<string>
  // Last key handed to the host credential store per provider, so a request
  // that did not rotate anything writes nothing.
  publishedOAuthKeys: Map<string, string>
  // The host-shared slice this package state was built over.
  shared: SharedHostState
  // Package-scoped terminal surface, present only in a composition that
  // mounts dsh-TUI's public `tuiScenes` service.
  tuiSurfaces: TuiSurfaceAdapter | undefined
}

type PiAiLlmBridge = (
  model: UnknownRecord,
  context: UnknownRecord,
  options: UnknownRecord | undefined,
) => ReturnType<typeof streamViaDshLlm>

type SubagentSessionFactory = (
  options: Record<string, unknown>,
) => Promise<{ session: unknown }>

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
  try {
    const result = await service.ask({ questions: [question], ...(agent !== undefined ? { agent } : {}), signal })
    return answerText(result.answers.find(answer => answer.id === question.id))
  } catch (error) {
    // Pi's ExtensionUIDialogOptions.signal means "programmatically dismiss
    // the dialog": a dismissed dialog resolves undefined, same as the user
    // cancelling — it is not an error the package must handle.
    if (signal?.aborted === true) return undefined
    throw error
  }
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

/** A session's durable events, whether the store exposes them as value or method. */
function eventsOf(session: UnknownRecord): readonly UnknownRecord[] {
  const events = (session as { events?: unknown }).events
  if (typeof events === 'function') return (events as () => readonly UnknownRecord[]).call(session) ?? []
  return Array.isArray(events) ? events as readonly UnknownRecord[] : []
}

/** The session id a presentation call belongs to, or '' outside a session. */
function sessionIdOf(state: RuntimeState, agent: UnknownRecord | undefined): string {
  const session = agentSession(agent ?? currentAgent(state))
  return session === undefined ? '' : String(session.id ?? '')
}

/**
 * Record one Pi presentation call against the session that made it.
 * @param ctx - context, for the logger on an unmounted host.
 * @param state - runtime state carrying the shared surface registry.
 * @param agent - the agent whose context the call came through.
 * @param key - which surface.
 * @param value - a string or Pi component; undefined clears it.
 */
function putSurface(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  key: SurfaceKey,
  value: unknown,
): void {
  const surfaces = state.shared.browserSurfaces
  if (surfaces === undefined) return
  // The headless theme styles factory-built chrome with identity functions,
  // which is exactly what a text projection needs.
  surfaces.setSurface(sessionIdOf(state, agent), state.packageName, key, value, state.theme)
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

/** Resolve Pi's official `ExtensionUIDialogOptions` third argument
 * (`{ signal?, timeout? }`, types.ts:96 at the pinned upstream) into one
 * abort signal. A bare AbortSignal is also accepted — pi-ai's OAuth prompt
 * callbacks hand the signal directly. Anything else resolves to undefined.
 * The `timeout` field is realized with AbortSignal.timeout, so a dialog the
 * package wants auto-dismissed really leaves the screen. Silently ignoring
 * the options object is what left the OAuth paste box on screen after the
 * browser callback had already won (pi-mcp-adapter passes
 * `ui.input(title, undefined, { signal })` and cancels it in its
 * waitForAuthorizationResponse finally block). */
function dialogAbortSignal(opts: unknown): AbortSignal | undefined {
  if (opts instanceof AbortSignal) return opts
  if (typeof opts !== 'object' || opts === null) return undefined
  const record = opts as { signal?: unknown; timeout?: unknown }
  const signals: AbortSignal[] = []
  if (record.signal instanceof AbortSignal) signals.push(record.signal)
  if (typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0) {
    signals.push(AbortSignal.timeout(record.timeout))
  }
  if (signals.length === 0) return undefined
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals)
}

const OSC8_HYPERLINK = /\u001b\]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)([\s\S]*?)\u001b\]8;;(?:\u0007|\u001b\\)/gu
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/gu

interface DialogPromptProjection {
  question: string
  detail?: string
}

type DialogLinkMode = 'markdown' | 'terminal'

/**
 * Translate terminal-oriented Pi dialog copy into DSH's native question
 * shape. Pi packages legitimately put OSC 8 links and a multi-line body in
 * the dialog title because Pi's TUI owns that whole text block. DSH separates
 * a plain-text heading from a Markdown detail block, and its Web client renders
 * terminal control bytes literally. Keep the plugin's words and destination,
 * but move them onto the host's real presentation contract.
 */
function projectDialogPrompt(
  title: unknown,
  supplementalDetail: unknown,
  linkMode: DialogLinkMode,
): DialogPromptProjection {
  const linkedUrls = new Set<string>()
  const normalize = (value: unknown): string => {
    const formatted = String(value).replace(
    OSC8_HYPERLINK,
    (whole, url: string, label: string) => {
      linkedUrls.add(url)
      if (linkMode === 'terminal') return whole
      const safeLabel = stripTerminalSequences(label).replace(/([\\\[\]])/gu, '\\$1')
      return `[${safeLabel}](${url})`
    },
    )
    return (linkMode === 'terminal' ? formatted : stripTerminalSequences(formatted)).replace(/\r\n?/gu, '\n')
  }

  const titleLines = normalize(title).split('\n')
  while (titleLines[0]?.trim() === '') titleLines.shift()
  while (titleLines.at(-1)?.trim() === '') titleLines.pop()

  const headingLine = titleLines.shift()?.trim() || 'Input required'
  const headingHasLink = linkMode === 'terminal'
    ? headingLine.includes('\u001b]8;')
    : [...headingLine.matchAll(MARKDOWN_LINK)].length > 0
  const question = linkMode === 'terminal'
    ? stripTerminalSequences(headingLine)
    : headingLine.replace(MARKDOWN_LINK, '$1')
  if (headingHasLink) titleLines.unshift('', headingLine)

  const detailLines = [...titleLines]
  if (supplementalDetail !== undefined) {
    if (detailLines.length > 0 && detailLines.at(-1)?.trim() !== '') detailLines.push('')
    detailLines.push(...normalize(supplementalDetail).split('\n'))
  }

  const deduplicated: string[] = []
  for (const line of detailLines) {
    if (linkedUrls.has(line.trim())) continue
    if (line.trim() === '' && deduplicated.at(-1)?.trim() === '') continue
    deduplicated.push(line.replace(/[ \t]+$/gu, ''))
  }
  while (deduplicated[0]?.trim() === '') deduplicated.shift()
  while (deduplicated.at(-1)?.trim() === '') deduplicated.pop()

  const detail = deduplicated.join('\n')
  return { question, ...(detail.length === 0 ? {} : { detail }) }
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
  // The same native DSH question seam has two renderers: Web consumes
  // Markdown detail, while dsh-TUI consumes terminal text and preserves OSC 8.
  // Keep one dialog lifecycle/answer path, choosing only the link encoding the
  // active public surface actually renders.
  const dialogLinkMode: DialogLinkMode = optionalService(ctx, 'tuiScenes') === undefined ? 'markdown' : 'terminal'
  const ui = {
    // Pi: `notify(message, type?: 'info' | 'warning' | 'error')`. The severity
    // is the whole point of the second argument — dropping it filed a
    // package's error notification at info, where an operator scanning for
    // problems never sees it.
    notify(message: unknown, type?: unknown) {
      const text = String(message)
      notices.push(text)
      state.notifications.push(text)
      const level = type === 'warning' || type === 'error' ? 'warn' : 'info'
      logger(ctx)[level](`[pi2dsh] ${text}`)
    },
    // Pi's contract is that select() returns ONE OF THE OPTIONS. DSH's dialog
    // renders them as numbered rows and also offers a free-text box, so a user
    // who types what they read on screen ("1", or a differently-cased name)
    // sends text that is not an option — and the package then rejects its own
    // answer ("Unknown OpenAI Codex login method: 1"). Resolve back to the
    // option here, once, for every package rather than in each caller.
    select: async (title: unknown, options: unknown[], opts?: unknown) => {
      const labels = options.map(option => String(option))
      const answered = await askOne(ctx, agent, joinSignals(signal, dialogAbortSignal(opts)), {
        id: 'pi2dsh-select',
        ...projectDialogPrompt(title, undefined, dialogLinkMode),
        options: labels.map(label => ({ label })),
      })
      return answered === undefined ? undefined : resolveOfferedChoice(answered, labels)
    },
    async confirm(title: unknown, message: unknown, opts?: unknown) {
      return await askOne(ctx, agent, joinSignals(signal, dialogAbortSignal(opts)), {
        id: 'pi2dsh-confirm',
        ...projectDialogPrompt(title, message, dialogLinkMode),
        options: [{ label: 'Yes' }, { label: 'No' }],
      }) === 'Yes'
    },
    // Pi's dialog surfaces take ExtensionUIDialogOptions as their trailing
    // argument; dialogAbortSignal resolves it (and the bare-signal shape
    // pi-ai's OAuth prompt callbacks use) so a package cancelling one prompt
    // path really dismisses the DSH question — the browser callback beating
    // the paste box must take the paste box off the screen.
    input: (title: unknown, placeholder?: unknown, opts?: unknown) => askOne(
      ctx, agent, joinSignals(signal, dialogAbortSignal(opts)), {
        id: 'pi2dsh-input',
        ...projectDialogPrompt(title, placeholder, dialogLinkMode),
      }),
    // Device-code OAuth does not ask for text after announcing the code; the
    // provider simply polls. Keep that expiring code in DSH's live question
    // surface until the flow finishes. Any user dismissal is a cancellation,
    // which oauthInteraction turns into an abort of the package-owned flow.
    deviceCode: async (title: unknown, detail: unknown, opts?: unknown) => {
      await askOne(ctx, agent, joinSignals(signal, dialogAbortSignal(opts)), {
        id: 'pi2dsh-device-code',
        ...projectDialogPrompt(title, detail, dialogLinkMode),
        options: [{ label: 'Cancel login' }],
      })
    },
    editor: (title: unknown, prefill?: unknown) => askOne(ctx, agent, signal, {
      id: 'pi2dsh-editor',
      ...projectDialogPrompt(title, prefill === undefined ? undefined : `Current text:\n${String(prefill)}`, dialogLinkMode),
    }),
    // Pi's presentation calls, on DSH's browser surface. Each records what the
    // package put on screen for THIS session; the bridge's own browser half
    // draws it in the host's matching slot. Signatures are Pi's exact ones
    // (types.ts): setStatus/setWidget are keyed, setFooter/setHeader take
    // factories, setWorkingIndicator takes {frames}. In a composition with no
    // web server (the CLI profile) the recording is simply never read — the
    // same shape as Pi's own non-TUI modes, where these are accepted and
    // nothing draws.
    setStatus: (key: unknown, text: unknown) => {
      const surfaces = state.shared.browserSurfaces
      surfaces?.setStatus(sessionIdOf(state, agent), state.packageName, String(key), text)
      state.tuiSurfaces?.setStatus(String(key), text)
    },
    setWidget: (key: unknown, content: unknown) => {
      const surfaces = state.shared.browserSurfaces
      if (surfaces === undefined) return
      // Lines or a component factory, both rendered by the server half with
      // the same headless theme the header and footer use.
      surfaces.setWidget(sessionIdOf(state, agent), state.packageName, String(key), content, state.theme)
    },
    onTerminalInput: () => () => undefined,
    setWorkingMessage: (message?: unknown) => putSurface(ctx, state, agent, 'workingMessage', message),
    setWorkingVisible: (visible: unknown) => {
      const surfaces = state.shared.browserSurfaces
      if (surfaces === undefined) return
      surfaces.setWorkingVisible(sessionIdOf(state, agent), state.packageName, visible !== false)
    },
    setWorkingIndicator: (options?: unknown) => putSurface(ctx, state, agent, 'workingIndicator', options),
    setHiddenThinkingLabel: (label?: unknown) => putSurface(ctx, state, agent, 'hiddenThinkingLabel', label),
    setFooter: (factory?: unknown) => putSurface(ctx, state, agent, 'footer', factory),
    setHeader: (factory?: unknown) => putSurface(ctx, state, agent, 'header', factory),
    // Pi's setTitle is transient window chrome. It deliberately does NOT rename
    // the DSH session: a session title is durable, user-owned and shown in the
    // session list, and quietly rewriting it would outlive the turn that asked.
    setTitle: (title: unknown) => putSurface(ctx, state, agent, 'title', title),
    // A terminal composition gets the package's real Pi component through
    // dsh-TUI's public full-screen scene seam. Browser/headless compositions
    // keep Pi's own rpc-mode behavior and resolve undefined.
    custom: async (factory: unknown, options?: unknown) => {
      const surfaces = state.tuiSurfaces
      if (surfaces === undefined || typeof factory !== 'function') return undefined
      return surfaces.custom(
        factory as PiCustomFactory<unknown>,
        state.theme,
        getKeybindings(),
        options as PiCustomOptions | undefined,
      )
    },
    // Pi's editor calls, on DSH's real composer. `inputActions.setDraft` is
    // part of the session standard kit every session-scoped slot component
    // receives, so the bridge's own browser half can perform the write; the
    // per-agent buffer stays as the answer for a composition with no browser
    // (the CLI profile), where Pi's own non-interactive modes behave the same.
    pasteToEditor(text: unknown) {
      const surfaces = state.shared.browserSurfaces
      const sessionId = sessionIdOf(state, agent)
      const current = surfaces?.liveDraft(sessionId) ?? (agent === undefined ? '' : state.editorBuffers.get(agent) ?? '')
      const next = current + String(text)
      if (agent !== undefined) state.editorBuffers.set(agent, next)
      surfaces?.requestDraft(sessionId, next)
    },
    setEditorText(text: unknown) {
      if (agent !== undefined) state.editorBuffers.set(agent, String(text))
      state.shared.browserSurfaces?.requestDraft(sessionIdOf(state, agent), String(text))
    },
    // The composer's real contents when a browser is showing this session (the
    // browser half reports them back), falling back to what this package last
    // wrote when nothing is watching.
    getEditorText: () => {
      const live = state.shared.browserSurfaces?.liveDraft(sessionIdOf(state, agent)) ?? ''
      if (live.length > 0) return live
      return agent === undefined ? '' : state.editorBuffers.get(agent) ?? ''
    },
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
  // Pi's ReplacedSessionContext adds these three on top of the command
  // context, and they belong to the REPLACEMENT session. Routing them through
  // the live agent (which still belongs to the turn that started the
  // operation) wrote into the old session — worse than not implementing them.
  const replacedSessionActions: UnknownRecord = sessionOverride === undefined ? {} : {
    sendMessage: (message: UnknownRecord, options: UnknownRecord = {}) => sendPiMessage(
      ctx, state, message.content, deliveryMode(options), sessionOverride,
      typeof message.customType === 'string' ? message.customType : undefined,
    ),
    sendUserMessage: (content: unknown) => sendPiMessage(ctx, state, content, 'followup', sessionOverride),
    appendEntry: (customType: string, data?: unknown) => {
      state.bridge.appendCustomEntry(String(sessionOverride.id ?? ''), customType, data)
    },
  }
  const base: UnknownRecord = {
    ...replacedSessionActions,
    ui,
    get mode(): 'tui' | 'rpc' { return state.tuiSurfaces?.available === true ? 'tui' : 'rpc' },
    // A getter, not a value: this context is rebuilt for every dispatched
    // event, and the probe below costs a register/dispose. Packages read
    // `hasUI` rarely, and reading it lazily also makes the answer current at
    // the moment it is asked rather than at the moment the context was built.
    get hasUI(): boolean {
      return state.tuiSurfaces?.available === true || humanAnswererAvailable(userQuestions, agent)
    },
    cwd: contextCwd,
    sessionManager: session === undefined
      ? state.bridge.readonlySessionManager({ id: 'pi2dsh-detached', events: [] }, contextCwd)
      : state.bridge.readonlySessionManager(session as never, contextCwd),
    modelRegistry,
    // Current effective model: a setModel() override wins; otherwise the DSH
    // agent's own provider/model route (Agent.options), enriched from the
    // catalog when the entry is known there.
    model: agent === undefined ? undefined : currentPiModel(state, agent),
    // Pi: "Models scoped to this session … Empty when no scoping is configured
    // (all available models are usable)." DSH has no model-scope concept, so
    // empty is the accurate answer and carries exactly Pi's meaning. Handing
    // back the whole catalog said the opposite — that the session is RESTRICTED
    // to every model — and in the wrong shape besides (Pi wants
    // `{model, thinkingLevel?}` wrappers around Pi Models, not DSH entries).
    scopedModels: [],
    thinkingLevel: thinkingLevelOf(state, agent),
    isIdle: () => command,
    isProjectTrusted: () => false,
    signal,
    abort: () => {
      const target = agent as { cancel?(cause: unknown): void } | undefined
      if (typeof target?.cancel !== 'function') unsupported('ctx.abort without a live DSH agent')
      target.cancel({ kind: 'hook', reason: 'pi2dsh: aborted by migrated Pi extension' })
    },
    // Pi: "Whether there are queued messages waiting" — steering plus follow-up.
    // DSH keeps exactly that on the agent's durable inbox (next-step plus
    // next-turn); a hardcoded false told every package the queue is always
    // empty, so anything that waits for the queue to drain never waited.
    hasPendingMessages: () => (agent as { inbox?: { hasPending?: unknown } } | undefined)?.inbox?.hasPending === true,
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
        const remounts = packageRemountsOf(ctx, state.shared)
        if (remounts.size === 0) return
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
    results.push(await runInPiRuntime(state, agent, () => handler(event, eventContext)))
  }
  return results
}

/**
 * Bind every compatibility singleton to this exact Agent runtime for the
 * duration of extension-owned work. AsyncLocalStorage follows promises and
 * detached work spawned inside the callback, so two live Agents cannot
 * overwrite each other's model bridge or child-session factory.
 */
function runInPiRuntime<T>(
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  callback: () => T,
): T {
  return state.agentScope.run(agent, () => __runWithSubagentSessionFactory(
    state.subagentSessionFactory,
    () => __runWithPiAiRuntime(state.llmBridge, state.piAiRegistry, callback),
  ))
}

/**
 * Pi's request-body event is a waterfall over the body the provider transport
 * will actually send. Only package-registered Pi transports expose that body
 * through SimpleStreamOptions.onPayload; native DSH adapters build it behind
 * their own boundary and never call this function.
 */
async function dispatchBeforeProviderRequest(
  ctx: Context,
  state: RuntimeState,
  payload: UnknownRecord,
  request: { provider: string, model: UnknownRecord, sessionId?: string, signal?: AbortSignal },
): Promise<UnknownRecord> {
  let current = payload
  const agent = currentAgent(state)
  const eventContext = contextFor(ctx, state, agent, request.signal)
  // A direct ctx.llm.stream() call may have no live agent, but the adapter
  // still knows the exact selected model. Pi handlers are entitled to it.
  eventContext.model = { ...request.model, provider: request.provider }
  for (const handler of state.handlers.get('before_provider_request') ?? []) {
    try {
      const result = await runInPiRuntime(state, agent, () => handler({
        type: 'before_provider_request',
        payload: current,
      }, eventContext))
      if (result !== undefined && typeof result === 'object' && result !== null) {
        current = result as UnknownRecord
      }
    } catch (error) {
      // Pi isolates extension hook failures: one bad observer must not take
      // down the provider or prevent later waterfall handlers from running.
      logger(ctx).warn(`[pi2dsh] before_provider_request handler failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return current
}

/** Run Pi's provider-body waterfall through every package runtime of one Agent. */
async function dispatchHostProviderRequest(
  ctx: Context,
  shared: SharedHostState,
  fallback: RuntimeState,
  payload: UnknownRecord,
  request: { provider: string, model: UnknownRecord, sessionId?: string, signal?: AbortSignal },
): Promise<UnknownRecord> {
  const scoped = request.sessionId === undefined
    ? undefined
    : shared.runtimeStatesBySession.get(request.sessionId)
  const states = scoped === undefined || scoped.size === 0 ? [fallback] : [...scoped]
  let current = payload
  for (const state of states) {
    current = await dispatchBeforeProviderRequest(ctx, state, current, request)
  }
  return current
}

/**
 * What triggered a compaction, in Pi's vocabulary.
 *
 * DSH's durable lifecycle events say two things about the trigger: a manual
 * compaction runs with no open turn (`turn: null`), and one a command drove
 * cites that command. Both are Pi's "manual".
 *
 * The limit, stated rather than papered over: DSH's automatic trigger is
 * `'pressure' | 'context-overflow'` at the call site but is NOT written to the
 * log, so Pi's `threshold` and `overflow` cannot be told apart after the fact.
 * Automatic compactions report `threshold`, the far more common of the two —
 * and `willRetry` stays false for the same reason. A package keying behavior
 * on `overflow` specifically will not see it.
 * @param data - the `compaction/start` or `compaction/summary` event data.
 */
function compactionReason(data: UnknownRecord): 'manual' | 'threshold' | 'overflow' {
  if (data.sourceCommandId !== undefined) return 'manual'
  return data.turn === null ? 'manual' : 'threshold'
}

/**
 * DSH content → the Pi content blocks packages read.
 *
 * Asynchronous because Pi's image block carries the bytes inline while DSH's
 * carries only an attachment reference, and the bytes come from the attachment
 * service. The sync version this replaced projected an image as a bare
 * `{type:'image'}` — a block that announces an image and contains none, which
 * is the exact shape a package cannot tell from a real one.
 * @param ctx - context used to reach the attachment service.
 * @param content - the DSH blocks to project.
 */
async function dshToPiContent(ctx: Context, content: readonly ContentBlock[]): Promise<Array<UnknownRecord>> {
  const out: UnknownRecord[] = []
  for (const block of content) {
    if (block.type === 'text') out.push({ type: 'text', text: block.text })
    else if (block.type === 'reasoning') out.push({ type: 'thinking', thinking: block.text })
    else if (block.type === 'tool-call') out.push({ type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments })
    else if (block.type === 'image') {
      const image = await piImageBlock(ctx, (block as unknown as UnknownRecord).attachment)
      // An unreadable attachment contributes nothing rather than an empty
      // image: Pi passes what exists.
      if (image !== undefined) out.push(image)
    }
    else out.push({ type: block.type })
  }
  return out
}

/**
 * One DSH image attachment as Pi's inline image block.
 * @param ctx - context used to reach the attachment service.
 * @param attachment - the durable reference on an image block.
 * @returns the Pi block, or undefined when the bytes cannot be read.
 */
async function piImageBlock(ctx: Context, attachment: unknown): Promise<UnknownRecord | undefined> {
  if (attachment === undefined || attachment === null) return undefined
  const attachments = optionalService<DshAttachmentsLike>(ctx, 'attachments')
  if (attachments === undefined) return undefined
  try {
    const stored = await attachments.readImage(attachment)
    return {
      type: 'image',
      data: Buffer.from(stored.data).toString('base64'),
      mimeType: String((attachment as UnknownRecord).mediaType ?? 'image/png'),
    }
  } catch {
    return undefined
  }
}

async function messageFromSessionEvent(ctx: Context, event: UnknownRecord): Promise<UnknownRecord | undefined> {
  const type = event.type
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as UnknownRecord
  if (type === 'user/message') return { role: 'user', content: await dshToPiContent(ctx, (record.content ?? []) as ContentBlock[]) }
  if (type === 'assistant/message') {
    const message = record.message as UnknownRecord | undefined
    return { role: 'assistant', content: await dshToPiContent(ctx, (message?.content ?? []) as ContentBlock[]) }
  }
  if (type === 'tool/result') {
    const message = record.message as UnknownRecord | undefined
    const blocks = (message?.content ?? []) as Array<UnknownRecord>
    const tool = blocks.find(block => block.type === 'tool-result')
    return {
      role: 'toolResult',
      toolCallId: tool?.toolCallId,
      content: await dshToPiContent(ctx, (tool?.content ?? []) as ContentBlock[]),
      isError: tool?.isError === true,
    }
  }
  return undefined
}

function sourceReason(value: unknown): string {
  return value === 'resume' ? 'resume' : value === 'fork' ? 'fork' : 'startup'
}

/**
 * Claim Pi's once-per-session `session_start` event.
 *
 * dsh-TUI can execute a slash command before DSH starts the first model turn,
 * so `agent/session-start` has not necessarily been announced yet. Pi, by
 * contrast, announces `session_start` before the user can execute a command.
 * The command bridge uses this same claim before invoking a Pi command; when
 * DSH later announces the real agent lifecycle, the durable session id keeps
 * the second path from restarting the extension.
 */
function claimPiSessionStart(state: RuntimeState, agent: UnknownRecord | undefined): boolean {
  const id = agentSession(agent)?.id
  if (typeof id === 'string') {
    if (state.startedSessions.has(id)) return false
    state.startedSessions.add(id)
    return true
  }
  if (typeof agent === 'object' && agent !== null) {
    if (state.startedSessionlessAgents.has(agent)) return false
    state.startedSessionlessAgents.add(agent)
    return true
  }
  return false
}

async function ensurePiSessionStarted(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  await startPiSession(ctx, state, agent, 'startup', signal)
}

function inFlightPiSessionStart(state: RuntimeState, agent: UnknownRecord | undefined): Promise<void> | undefined {
  const id = agentSession(agent)?.id
  if (typeof id === 'string') return state.sessionStartTasks.get(id)
  if (typeof agent === 'object' && agent !== null) return state.sessionlessStartTasks.get(agent)
  return undefined
}

function rememberPiSessionStart(state: RuntimeState, agent: UnknownRecord | undefined, task: Promise<void>): void {
  const id = agentSession(agent)?.id
  if (typeof id === 'string') state.sessionStartTasks.set(id, task)
  else if (typeof agent === 'object' && agent !== null) state.sessionlessStartTasks.set(agent, task)
}

function forgetPiSessionStart(state: RuntimeState, agent: UnknownRecord | undefined, task: Promise<void>): void {
  const id = agentSession(agent)?.id
  if (typeof id === 'string') {
    if (state.sessionStartTasks.get(id) === task) state.sessionStartTasks.delete(id)
  } else if (typeof agent === 'object' && agent !== null && state.sessionlessStartTasks.get(agent) === task) {
    state.sessionlessStartTasks.delete(agent)
  }
}

function releasePiSessionClaim(state: RuntimeState, agent: UnknownRecord | undefined): void {
  const id = agentSession(agent)?.id
  if (typeof id === 'string') {
    state.startedSessions.delete(id)
    state.sessionStartTasks.delete(id)
  } else if (typeof agent === 'object' && agent !== null) {
    state.startedSessionlessAgents.delete(agent)
    state.sessionlessStartTasks.delete(agent)
  }
}

function replacementReason(reason: string): 'new' | 'resume' | 'fork' {
  if (reason === 'resume') return 'resume'
  if (reason === 'fork') return 'fork'
  return 'new'
}

function trackRuntimeSession(state: RuntimeState, agent: UnknownRecord | undefined): void {
  const id = agentSession(agent)?.id
  if (typeof id !== 'string') return
  let states = state.shared.runtimeStatesBySession.get(id)
  if (states === undefined) {
    states = new Set()
    state.shared.runtimeStatesBySession.set(id, states)
  }
  states.add(state)
}

function untrackRuntimeSession(state: RuntimeState, agent: UnknownRecord | undefined): void {
  const id = agentSession(agent)?.id
  if (typeof id !== 'string') return
  const states = state.shared.runtimeStatesBySession.get(id)
  states?.delete(state)
  if (states?.size === 0) state.shared.runtimeStatesBySession.delete(id)
}

/** Dispatch or join the one in-flight Pi session_start for this session. */
async function startPiSession(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  reason: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!acceptsAgent(state, agent)) return
  const existing = inFlightPiSessionStart(state, agent)
  if (existing !== undefined) {
    await existing
    return
  }
  const task = runInPiRuntime(state, agent, async () => {
    const previous = state.hostAgent
    const replacing = typeof previous === 'object' && previous !== null && previous !== agent
    const transitionReason = replacing ? replacementReason(reason) : reason

    // DSH deliberately overlaps physical Agents during an atomic switch:
    // B is fully created (and announces agent/session-start) before A is
    // disposed. Pi deliberately exposes one linear extension runtime:
    // session_shutdown(A) must settle before session_start(B). Serialize that
    // semantic handoff here; the later physical disposal of A is then only a
    // DSH-resource event and must not emit a second Pi shutdown.
    if (replacing && !state.piShutdownAgents.has(previous)) {
      state.piShutdownAgents.add(previous)
      releasePiSessionClaim(state, previous)
      await runInPiRuntime(state, previous, () => dispatch(
        state,
        'session_shutdown',
        { type: 'session_shutdown', reason: replacementReason(reason) },
        contextFor(ctx, state, previous, signal),
      ))
    }

    if (typeof agent === 'object' && agent !== null) {
      state.hostAgent = agent
      state.piShutdownAgents.delete(agent)
    }
    if (!claimPiSessionStart(state, agent)) return
    try {
      await dispatch(
        state,
        'session_start',
        { type: 'session_start', reason: transitionReason },
        contextFor(ctx, state, agent, signal),
      )
    } catch (error) {
      releasePiSessionClaim(state, agent)
      throw error
    }
  })
  rememberPiSessionStart(state, agent, task)
  try {
    await task
  } finally {
    forgetPiSessionStart(state, agent, task)
  }
}

function subscribeLifecycle(ctx: Context, state: RuntimeState): void {
  const cordis = ctx as unknown as {
    on(name: string, callback: (...args: any[]) => unknown, options?: unknown): () => void
    effect(callback: () => unknown, label?: string): unknown
  }
  const warn = (event: string, error: unknown) => logger(ctx).warn(`[pi2dsh] ${event} handler failed: ${String(error)}`)

  cordis.on('agent/session-start', (payload: UnknownRecord) => {
    const agent = payload.agent as UnknownRecord
    if (!acceptsAgent(state, agent)) return
    state.activeAgents.add(agent)
    trackRuntimeSession(state, agent)
    const session = agentSession(agent)
    if (session !== undefined) state.bridge.load(session.id)
    if (state.pendingActiveTools !== undefined) {
      runInPiRuntime(state, agent, () => setActiveTools(ctx, state, state.pendingActiveTools!))
    }
    // dsh-TUI creates its initial Agent while plugin entries are still being
    // imported. Marking the session as started at that instant would dispatch
    // into an empty handler ledger, then suppress the real delivery once the
    // extension is ready. Buffer the fact, not the event execution.
    if (!state.extensionsReady) {
      state.pendingSessionStarts.set(agent, sourceReason(payload.source))
      return
    }
    void startPiSession(ctx, state, agent, sourceReason(payload.source), undefined)
      .catch(error => warn('session_start', error))
  })
  cordis.on('agent/disposed', (payload: UnknownRecord) => {
    const agent = payload.agent as UnknownRecord
    if (!acceptsAgent(state, agent)) return
    const ownsHostSession = state.hostAgent === agent
    state.activeAgents.delete(agent)
    untrackRuntimeSession(state, agent)
    state.pendingSessionStarts.delete(agent)
    if (typeof agent === 'object' && agent !== null) {
      state.toolRestrictions.get(agent)?.()
      state.toolRestrictions.delete(agent)
    }
    if (typeof agent === 'object' && agent !== null && !state.disposedAgents.has(agent)) {
      state.disposedAgents.add(agent)
      releasePiSessionClaim(state, agent)
      // A scoped runtime owns exactly this Agent. Legacy root mounts may
      // still replace first and dispose second; the ownership guard above
      // prevents one Agent's late disposal from touching another runtime.
      if (ownsHostSession && !state.piShutdownAgents.has(agent)) {
        state.piShutdownAgents.add(agent)
        state.hostAgent = undefined
        void dispatch(state, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, contextFor(ctx, state, agent, undefined))
          .catch(error => warn('session_shutdown', error))
      }
    }
  })

  const projectSessionEvent = (session: UnknownRecord, event: UnknownRecord): void => {
    const agent = [...state.activeAgents].find(candidate => candidate.session === session)
    const eventContext = contextFor(ctx, state, agent, undefined)
    const type = event.type
    // Pi's vocabulary is one level finer than DSH's name for the same thing:
    // Pi emits turn_start/turn_end around EVERY model call (its inner loop),
    // and agent_start/agent_end around the whole prompt. DSH calls those a
    // step and a turn. Mapping Pi's turn onto DSH's turn fired the per-call
    // events once per prompt, so a package counting model calls, or reading
    // one call's assistant message out of turn_end, saw the wrong thing.
    if (type === 'turn/start') {
      // Pi resets turnIndex at agent_start, so the counter is per prompt.
      if (session !== undefined) state.piTurnIndex.set(session as unknown as object, 0)
      void dispatch(state, 'agent_start', { type: 'agent_start' }, eventContext).catch(error => warn('agent_start', error))
    }
    if (type === 'step/start') {
      const index = state.piTurnIndex.get(session as unknown as object) ?? 0
      void dispatch(state, 'turn_start', { type: 'turn_start', turnIndex: index, timestamp: event.time ?? Date.now() }, eventContext)
        .catch(error => warn('turn_start', error))
    }
    if (type === 'step/end') {
      const data = event.data as UnknownRecord
      const turn = Number(data.turn ?? 1)
      const step = Number(data.step ?? 1)
      const key = session as unknown as object
      const index = state.piTurnIndex.get(key) ?? 0
      state.piTurnIndex.set(key, index + 1)
      state.projection = state.projection.then(async () => {
        // This STEP's assistant message and this STEP's tool results — Pi's
        // turn_end reports one model call, not a whole prompt.
        const stepEvents = ((session.events ?? []) as UnknownRecord[]).filter(entry => {
          const entryData = entry.data as UnknownRecord | undefined
          return Number(entryData?.turn ?? -1) === turn && Number(entryData?.step ?? -1) === step
        })
        const toolResults = (await Promise.all(stepEvents
          .filter(entry => entry.type === 'tool/result')
          .map(entry => messageFromSessionEvent(ctx, entry))))
          .filter((message): message is UnknownRecord => message !== undefined)
        const assistant = stepEvents.findLast(entry => entry.type === 'assistant/message')
        const message = assistant === undefined
          ? { role: 'assistant', content: [] }
          : await messageFromSessionEvent(ctx, assistant) ?? { role: 'assistant', content: [] }
        await dispatch(state, 'turn_end', { type: 'turn_end', turnIndex: index, message, toolResults }, eventContext)
      }).catch(error => warn('turn_end', error))
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
        reason: compactionReason(event.data as UnknownRecord),
        willRetry: false,
      }, eventContext).catch(error => warn('session_before_compact', error))
    }
    // `compaction/summary` and ONLY it. `compaction/end` closes the bracket
    // whether the compaction succeeded or failed (it carries `error` when it
    // did not), so firing on both dispatched twice for every success and once,
    // falsely, for every failure — telling packages the history was compacted
    // when nothing had been.
    if (type === 'compaction/summary') {
      const data = event.data as UnknownRecord
      const shadowed = data.shadowedRange as { start?: unknown, end?: unknown } | undefined
      const usage = data.usage as UnknownRecord | undefined
      void dispatch(state, 'session_compact', {
        type: 'session_compact',
        compactionEntry: {
          type: 'compaction',
          id: `dsh-${String(event.seq ?? '')}`,
          // Pi's CompactionEntry.summary is a STRING. DSH's is a ContentBlock
          // array, and the old spread of the raw event data over this object
          // put that array back under the same name — so every package doing
          // string work on the summary got an array instead.
          summary: textBlocks(data.summary).map(block => block.text).join('\n'),
          firstKeptEntryId: typeof shadowed?.end === 'number' ? `dsh-${shadowed.end + 1}` : '',
          tokensBefore: Number(data.shadowedTokenCount ?? 0),
          ...(usage === undefined ? {} : { usage }),
          fromHook: false,
        },
        fromExtension: false,
        reason: compactionReason(data),
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
    state.projection = state.projection.then(async () => {
      const message = await messageFromSessionEvent(ctx, event)
      if (message === undefined) return
      await dispatch(state, 'message_start', { type: 'message_start', message }, eventContext)
      await dispatch(state, 'message_end', { type: 'message_end', message }, eventContext)
    }).catch(error => warn('message lifecycle', error))
    if (type === 'turn/end') {
      // Behind the shared stream so the prompt's own steps have announced
      // themselves before it is declared finished.
      state.projection = state.projection.then(async () => {
        await dispatch(state, 'agent_end', { type: 'agent_end', messages: [] }, eventContext)
        await dispatch(state, 'agent_settled', { type: 'agent_settled' }, eventContext)
      }).catch(error => warn('turn end lifecycle', error))
    }
  }
  // Exposed for the mount-time backlog replay (flushPendingSessionStarts):
  // events appended between Agent publication and extension readiness are
  // otherwise lost to a per-Agent instance.
  state.projectSessionEvent = projectSessionEvent

  cordis.on('session/event', (session: UnknownRecord, event: UnknownRecord) => {
    // The host anchor serves no session; this listener's own session guard
    // predates acceptsAgent and must exclude it explicitly, or the anchor's
    // extension instance receives a second copy of every lifecycle event
    // beside the owning per-Agent instance (step-seams caught turn_start
    // firing twice per model call through a globalThis-shared recorder).
    if (state.hostAnchor) return
    const ownedSession = agentSession(state.ownerAgent)
    if (ownedSession !== undefined ? session !== ownedSession : isSubagentOrigin(session)) return
    // A per-Agent mount runs AFTER its Agent published: events arriving
    // before the extension handlers exist would dispatch into an empty
    // ledger and be lost (a one-shot run opens its turn during module
    // loading). Drop them here — the durable log holds them, and the flush
    // replays the still-open turn synchronously before flipping this flag,
    // so the seam is gap- and overlap-free.
    if (ownedSession !== undefined && state.sessionEventsLive !== true) return
    projectSessionEvent(session, event)
  })

  // Per-agent model/thinking overrides recorded by setModel()/setThinkingLevel()
  // are applied at the request boundary, DSH's sanctioned seam for call-config
  // replacement.
  cordis.on('agent/request', async (payload: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const config = await next()
    const agent = payload.agent as UnknownRecord | undefined
    if (agent === undefined || !acceptsAgent(state, agent)) return config
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


  cordis.effect(() => async () => {
    const agent = state.hostAgent
    if (typeof agent === 'object' && agent !== null && !state.piShutdownAgents.has(agent)) {
      state.piShutdownAgents.add(agent)
      state.disposedAgents.add(agent)
      await dispatch(state, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, contextFor(ctx, state, agent, undefined))
    }
    state.hostAgent = undefined
    for (const active of state.activeAgents) untrackRuntimeSession(state, active)
    state.activeAgents.clear()
    state.startedSessions.clear()
    state.sessionStartTasks.clear()
    state.pendingSessionStarts.clear()
    for (const dispose of state.toolDisposers.values()) dispose()
    state.toolDisposers.clear()
    for (const provider of [...state.ownedProviderRoutes]) releaseSharedProviderRoute(state, provider)
    // The bus is agent-shared: unwind only this instance's subscriptions.
    for (const off of state.eventBusOffs.splice(0)) off()
  }, 'pi2dsh session shutdown')
}

async function flushPendingSessionStarts(ctx: Context, state: RuntimeState): Promise<void> {
  state.extensionsReady = true
  // A per-Agent mount happens AFTER DSH published the Agent: its
  // agent/session-start fired before this instance existed, so no listener
  // could even buffer it. The owner's session has started by definition —
  // deliver the missed start now, exactly as Pi hosts run session_start
  // before the first turn (a default-on status package draws from it; the
  // lazy first-execution gate alone would leave it blank until the first
  // command, and a toggle command would then flip it OFF instead of ON).
  if (state.ownerAgent !== undefined && !state.pendingSessionStarts.has(state.ownerAgent)) {
    const owned = state.ownerAgent
    if (!state.activeAgents.has(owned)) {
      state.activeAgents.add(owned)
      trackRuntimeSession(state, owned)
      const session = agentSession(owned)
      if (session !== undefined) state.bridge.load(session.id)
    }
    state.pendingSessionStarts.set(owned, 'startup')
  }
  const pending = [...state.pendingSessionStarts]
  state.pendingSessionStarts.clear()
  for (const [agent, reason] of pending) {
    await startPiSession(ctx, state, agent, reason, undefined)
  }
  // Backlog replay for a per-Agent mount: the owner's loop may have OPENED a
  // turn before this instance's handlers existed (a one-shot headless run
  // prompts the instant the Agent publishes; DSH appends `turn/start` while
  // extension modules are still loading, and the assembly our engine gate
  // holds comes later in the same turn). Live delivery is suppressed until
  // this point (see the session/event subscription), so Pi's event stream —
  // agent_start before the prompt's first turn_start — is reconstructed from
  // the durable log: replay the still-open turn and flip live delivery in
  // the same synchronous stretch, so no event is doubled and none is lost.
  if (state.ownerAgent !== undefined && state.projectSessionEvent !== undefined) {
    const session = agentSession(state.ownerAgent) as (UnknownRecord & { events?: UnknownRecord[] }) | undefined
    if (session !== undefined) {
      const events = (session.events ?? []) as Array<UnknownRecord & { type?: string }>
      let from = -1
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]!.type === 'turn/end') break
        if (events[index]!.type === 'turn/start') { from = index; break }
      }
      if (from >= 0) {
        for (let index = from; index < events.length; index += 1) {
          state.projectSessionEvent(session, events[index]!)
        }
      }
    }
    state.sessionEventsLive = true
  }
}

/**
 * Start freshly reloaded extension handlers in every live Pi host session.
 *
 * `ctx.reload()` creates a new extension instance. The durable session has
 * already been claimed by the previous instance, so the ordinary once-per-
 * session guard must deliberately NOT suppress this replay: from the new
 * instance's point of view this is its first `session_start`. The command's
 * AsyncLocalStorage agent is included because a lean composition can execute
 * a Pi command without publishing DSH's optional agent/session-start event.
 */
async function restartReloadedPiSessions(ctx: Context, state: RuntimeState): Promise<void> {
  state.extensionsReady = true
  const pending = new Map(state.pendingSessionStarts)
  state.pendingSessionStarts.clear()
  const commandAgent = currentAgent(state)
  const candidates = [...state.activeAgents, ...(commandAgent === undefined ? [] : [commandAgent])]
  const seenSessions = new Set<string>()
  const seenSessionless = new Set<UnknownRecord>()
  for (const agent of candidates) {
    if (!acceptsAgent(state, agent)) continue
    const sessionId = agentSession(agent)?.id
    if (typeof sessionId === 'string') {
      if (seenSessions.has(sessionId)) continue
      seenSessions.add(sessionId)
    } else {
      if (seenSessionless.has(agent)) continue
      seenSessionless.add(agent)
    }
    await runInPiRuntime(state, agent, () => dispatch(
      state,
      'session_start',
      { type: 'session_start', reason: pending.get(agent) ?? 'resume' },
      contextFor(ctx, state, agent, undefined),
    ))
  }
}

function subscribeInterceptors(ctx: Context, state: RuntimeState): void {
  const cordis = ctx as unknown as { on(name: string, callback: (...args: any[]) => unknown): () => void }
  cordis.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    // A child agent's tool traffic must not reach extensions mounted on the
    // parent: DSH lets an untagged listener see every scope, so without this
    // a parent's guard would silently police another session's calls, and its
    // handlers would receive an end without ever having seen the start.
    if (!acceptsAgent(state, exec.agent as unknown as UnknownRecord | undefined)) return next()
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
    // Pi's `terminate` is a batch verdict, not a per-call one: the loop stops
    // after a tool batch only when EVERY finalized call in it was blocked with
    // terminate. One call cannot see the batch, so each records its vote and
    // the next step boundary counts them.
    const agent = exec.agent as unknown as object | undefined
    const tally = agent === undefined
      ? undefined
      : state.terminateBatch.get(agent) ?? { calls: 0, terminating: 0 }
    if (tally !== undefined && agent !== undefined) {
      tally.calls += 1
      state.terminateBatch.set(agent, tally)
    }
    for (const result of results) {
      if (typeof result !== 'object' || result === null) continue
      const record = result as UnknownRecord
      if (record.block !== true) continue
      // Only a BLOCKED call's terminate counts — Pi documents it as a hint
      // "when this call is blocked", and an executed call never carries one.
      if (record.terminate === true && tally !== undefined) tally.terminating += 1
      return { kind: 'deny', reason: String(record.reason ?? 'blocked by migrated Pi tool_call hook') }
    }
    return next()
  })

  cordis.on('tools/post-execute', async (
    exec: ToolExecution,
    result: ToolExecutionResult,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    // A child agent's tool traffic must not reach extensions mounted on the
    // parent: DSH lets an untagged listener see every scope, so without this
    // a parent's guard would silently police another session's calls, and its
    // handlers would receive an end without ever having seen the start.
    if (!acceptsAgent(state, exec.agent as unknown as UnknownRecord | undefined)) return next()
    const downstream = await next()
    // Pi emits the execution's end as part of completing it, so a handler has
    // run before the caller sees the result. This waterfall is that moment;
    // the `tools/result` observer it used to ride is a fire-and-forget emit,
    // which — once projecting the content had to await the attachment service
    // — could land after the turn that produced it had already ended.
    await dispatch(state, 'tool_execution_end', {
      type: 'tool_execution_end',
      toolCallId: exec.callId,
      toolName: exec.name,
      result: { content: await dshToPiContent(ctx, result.content), details: result.meta ?? null },
      isError: result.isError,
    }, contextFor(ctx, state, exec.agent as unknown as UnknownRecord, exec.signal))
      .catch(error => logger(ctx).warn(`[pi2dsh] tool_execution_end handler failed: ${String(error)}`))
    if (downstream.kind === 'block') return downstream
    const event: UnknownRecord = {
      type: 'tool_result',
      toolName: exec.name,
      toolCallId: exec.callId,
      input: cloneJson(exec.arguments),
      content: await dshToPiContent(ctx, result.content),
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
    if (!jsonEqual(event.content, await dshToPiContent(ctx, result.content))) return { kind: 'accept', content }
    return downstream
  })

  // The claim that opens a step happens immediately BEFORE the assembly
  // (agent-loop: `inbox.claim(...)` then `systemPrompt.assemble(...)`), and it
  // publishes each claimed message. Catching them here is what lets the Pi
  // event run during the assembly it is supposed to influence.
  cordis.on('agent/inbox/claimed', (payload: UnknownRecord) => {
    const agent = payload.agent as UnknownRecord | undefined
    if (agent === undefined || !acceptsAgent(state, agent)) return
    const claimed = state.claimedForStep.get(agent) ?? []
    claimed.push({ message: payload.message, turn: Number(payload.turn ?? 0) })
    state.claimedForStep.set(agent, claimed)
  })

  cordis.on('agent/pre-step', async (payload: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const agent = payload.agent as UnknownRecord
    if (!acceptsAgent(state, agent)) return next()
    // The step boundary IS the end of the previous tool batch, so this is
    // where Pi's batch verdict is read: stop only when every call in that
    // batch was blocked asking to terminate. Rejecting the proposed step is
    // exactly Pi's "stop after the current tool batch" — the results already
    // entered the conversation; the agent simply does not take another step.
    const tally = state.terminateBatch.get(agent as unknown as object)
    state.terminateBatch.delete(agent as unknown as object)
    if (tally !== undefined && tally.calls > 0 && tally.calls === tally.terminating) {
      logger(ctx).info(
        `[pi2dsh] a Pi tool_call hook terminated the turn: all ${tally.calls} call(s) in the batch were blocked`
        + ' with terminate',
      )
      return { kind: 'reject' }
    }
    const decision = await next() as UnknownRecord & { kind?: string, messages?: UnknownRecord[] }
    if (decision.kind !== 'enter') return decision
    const signal = payload.signal as AbortSignal | undefined
    const messages = decision.messages ?? []
    // The custom messages a before_agent_start handler returned during this
    // step's assembly, joining the step beside the user message as
    // plugin-sourced context (Pi's role:"custom" append).
    const injected = state.pendingInjections.get(agent) ?? []
    state.pendingInjections.delete(agent)
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

  // Pi tools contribute two things to the system prompt: a one-line
  // `promptSnippet` for the "Available tools" list (without which Pi omits the
  // tool from that list entirely) and `promptGuidelines` bullets that apply
  // only while the tool is active. Both were being dropped on registration, so
  // a migrated tool that documents itself through them documented nothing.
  //
  // They belong in a registered SECTION, not in this bridge's waterfall
  // rewrite: DSH orders sections itself, and 100-199 is its own tool-guidance
  // band — so a Pi tool's guidance lands exactly where DSH's does.
  const systemPrompt = optionalService<{ section(section: UnknownRecord): () => void }>(ctx, 'systemPrompt')
  // The anchor registers no prompt section: tool guidance describes the
  // per-Agent instances' DSH-registered tools, which the anchor projects none of.
  if (systemPrompt !== undefined && !state.hostAnchor) {
    // The section name carries the package: the guidance IS per-package (it
    // describes that package's tools), and a shared constant made the second
    // Pi package in a profile fail to mount entirely — DSH rejects a duplicate
    // section name, and the whole mount unwound with it. Every package
    // contributes its own section; DSH orders them within its own band.
    ctx.effect(() => systemPrompt.section({
      name: `pi2dsh:tool-guidance:${state.packageName ?? 'pi'}`,
      order: 150,
      text: () => piToolPromptContribution(ctx, state),
    }))
  }

  cordis.on('system-prompt/assemble', async (assembly: UnknownRecord, assembleContext: UnknownRecord, next: () => Promise<UnknownRecord>) => {
    const downstream = await next()
    // Recorded on EVERY assembly, before any gate: this is the value
    // `ctx.getSystemPrompt()` reports and the one the before_agent_start event
    // carries. Deciding whether to record it by whether some package happens
    // to subscribe to before_agent_start left a package that only READS the
    // prompt reading an empty string for the life of the session.
    const original = renderPrompt(downstream as never)
    state.currentSystemPrompt = original
    const agent = (assembleContext.agent ?? assembleContext.scope) as UnknownRecord | undefined
    if (agent !== undefined && !acceptsAgent(state, agent)) return downstream
    if (agent !== undefined && acceptsAgent(state, agent)) {
      // Pi's before_agent_start fires once per user prompt: after the user
      // message is known, before the first model call. That is HERE — the
      // loop claims the turn's messages and then assembles — and it has to be
      // here, because a handler's returned systemPrompt is meant to be this
      // turn's prompt. Running it on the later pre-step waterfall (what this
      // bridge did) left the override one step behind: it missed the turn
      // that produced it and then applied to the following one.
      await runBeforeAgentStart(ctx, state, agent, assembleContext.signal as AbortSignal | undefined, original)
      const override = state.turnSystemPromptOverrides.get(agent)
      if (override === undefined) return downstream
      state.currentSystemPrompt = override
      return { ...downstream, sections: [{ name: 'pi2dsh:system-prompt', text: override }] }
    }
    // No live agent (diagnostics, compositions without the agent loop): keep
    // the assembly-time dispatch so systemPrompt-replacement packages still
    // run; Pi's prompt/images/custom-message surfaces need a real turn.
    if ((state.handlers.get('before_agent_start')?.length ?? 0) === 0) return downstream
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

/**
 * Pi's `before_agent_start`, run inside the assembly of the turn it belongs to.
 *
 * Fires once per user prompt: only when this step's claim opened a NEW turn,
 * matching Pi, where the event follows the user's message rather than every
 * model call. A handler's `systemPrompt` becomes this turn's override (reset
 * at the next turn, exactly as Pi resets to the base prompt) and a returned
 * `message` is held for the step that is about to be entered.
 * @param ctx - context used for attachments and handler dispatch.
 * @param state - runtime state holding claims, overrides, and injections.
 * @param agent - the agent whose assembly this is.
 * @param signal - the turn's control signal, when one exists.
 * @param assembled - the prompt as assembled, before any package override.
 */
async function runBeforeAgentStart(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord,
  signal: AbortSignal | undefined,
  assembled: string,
): Promise<void> {
  const claimed = state.claimedForStep.get(agent) ?? []
  state.claimedForStep.delete(agent)
  if (claimed.length === 0) return
  // Steering claimed mid-turn carries the turn already prompted for; only a
  // turn this bridge has not announced yet is a new user prompt.
  const turn = Number(claimed[0]?.turn ?? 0)
  if (state.promptedTurn.get(agent) === turn) return
  state.promptedTurn.set(agent, turn)
  // A new turn resets to the base prompt whether or not any handler runs.
  state.turnSystemPromptOverrides.delete(agent)
  if ((state.handlers.get('before_agent_start')?.length ?? 0) === 0) return

  const userMessages = claimed
    .map(entry => entry.message as UnknownRecord)
    .filter(message => ((message.source as { kind?: string } | undefined)?.kind ?? 'user') === 'user')
  const prompt = userMessages
    .flatMap(message => textBlocks(message.content))
    .map(block => block.text)
    .join('\n')
  const images = await collectPiImages(ctx, userMessages)
  const event: UnknownRecord = {
    type: 'before_agent_start',
    prompt,
    ...(images.length > 0 ? { images } : {}),
    systemPrompt: assembled,
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
    if (message === undefined) continue
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
  if (injected.length > 0) state.pendingInjections.set(agent, injected)
}

// Project one not-yet-entered DSH message as the Pi message shape context
// handlers expect: a piCustomType source marker restores Pi's role:"custom"
// identity, everything else is a user message.
async function piShapeOfPending(ctx: Context, message: UnknownRecord): Promise<UnknownRecord> {
  const source = message.source as UnknownRecord | undefined
  const content = await dshToPiContent(ctx, (message.content ?? []) as ContentBlock[])
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
    const projected = await messageFromSessionEvent(ctx, event)
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
  const projectedPending = await Promise.all(pending.map(message => piShapeOfPending(ctx, message)))
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
  const attachments = optionalService<DshAttachmentsLike>(ctx, 'attachments')
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
  providerRouteDisposers: Map<string, PiRouteHandle>
  /** Coalesced dynamic-catalog refreshes, shared by startup and first use. */
  providerModelDiscoveries: Map<string, Promise<number | undefined>>
  /** Agent-runtime owners for each host-global provider route. */
  providerRouteOwners: Map<string, Set<RuntimeState>>
  /** Per-session Pi runtimes, in package mount order, for provider waterfalls. */
  runtimeStatesBySession: Map<string, Set<RuntimeState>>
  publishedOAuthKeys: Map<string, string>
  /** Composed canonical provider configs — the ONLY read surface. Maintained
   * exclusively by recomposeSharedProvider from the layered ledger below. */
  providers: Map<string, UnknownRecord>
  /** Base layer: the engine's built-in OAuth directory entries (Pi's
   * `builtins` map). Survives any package overlay; restored on unregister. */
  providerBuiltins?: Map<string, UnknownRecord>
  /** Extension layer, one slot per package so a package's per-agent instances
   * re-registering the same content stay idempotent instead of perturbing
   * cross-package overlay order. Slot content follows Pi's re-registration
   * contract: defined values merge over the previous registration. */
  providerPackages?: Map<string, Map<string, UnknownRecord>>
  /** Package overlay order = first-registration order, mirroring Pi where
   * "last registration wins" is load order (per-session rebuilds keep it stable). */
  providerPackageOrder?: string[]
  /** Pi's cross-extension event bus is ONE bus per session; ours is one per
   * agent (host/anchor instances share the host bus). */
  agentEventBuses?: WeakMap<object, EventEmitter>
  hostEventBus?: EventEmitter
  /** Pi's theme is session-shared UI state, not per-extension. */
  agentThemes?: WeakMap<object, Theme>
  hostTheme?: Theme
  /** Provider ids whose DSH authorization-seam projection is armed (an
   * inject scope waiting on — or holding — the authorization service). */
  authorizationArmedIds?: Set<string>
  modelCatalog?: ModelCatalog
  catalogSubscribed?: boolean
  loginRegistered?: WeakSet<object>
  oauthRefreshHooked?: boolean
  companionSweepSubscribed?: boolean
  oauthStore?: FileCredentialStore
  capabilityLedger?: CapabilityLedger
  // Per-package remount closures backing Pi's ctx.reload(): dispose every
  // extension-owned registration and run the extension entries again through
  // a fresh loader, so edited plugin code takes effect. Host-managed resources
  // (skills, prompts) reload with dsh itself.
  packageRemounts?: WeakMap<object, Map<string, () => Promise<void>>>
  // The side-conversation panel is ONE surface per host, however many packages
  // contribute threads to it — same rule as the provider directory.
  browserSurfaces?: BrowserSurfaces
  browserSurfacesRouted?: boolean
  // The one login allowed to be in flight. Interactive OAuth flows own a FIXED
  // local callback port (codex: 1455) and Pi's own flow, finding it taken,
  // silently degrades to a server that never receives a code — so a second
  // concurrent flow hands the user an address whose callback lands on the FIRST
  // flow's listener, which rejects it as a state mismatch and leaves both
  // dialogs waiting forever. Pi cannot hit this: its login dialog is modal, so
  // a second flow cannot be started. On DSH /login is an ordinary command a
  // user can run again, so the bridge has to enforce what Pi's shape enforced.
  activeLogin?: ActiveLogin | undefined
}

interface ActiveLogin {
  providerName: string
  controller: AbortController
  /** Settles when the flow has released its callback port. */
  finished: Promise<void>
  /** Short links this flow published, retired when it ends. */
  published: string[]
}

const SHARED_HOST_STATE = new WeakMap<object, SharedHostState>()

/**
 * Pi's provider ledger is layered, not flat (model-runtime.ts:742-786 at the
 * pinned upstream): a builtin base map, an extension overlay where defined
 * fields merge over the base (undefined fields expose the base — a package
 * overriding only baseUrl keeps the builtin OAuth flow), later registrations
 * overriding earlier ones, and unregistration restoring the builtin. These
 * helpers vendor that contract for the shared host ledger. One deliberate
 * adaptation: the overlay is slotted per PACKAGE and folded in package
 * first-registration order, because in Pi "last wins" is load order (each
 * session rebuilds the runtime so registration order is always load order),
 * while our host ledger accumulates across sessions — folding raw arrival
 * order would let a later agent's re-registration of package A overturn
 * package B for no Pi-semantic reason.
 */
export function mergeProviderRegistration(previous: UnknownRecord | undefined, config: UnknownRecord): UnknownRecord {
  const effective: UnknownRecord = { ...previous }
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) effective[key] = value
  }
  return effective
}

export function overlayProviderConfig(base: UnknownRecord | undefined, overlay: UnknownRecord): UnknownRecord {
  const merged: UnknownRecord = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined) merged[key] = value
  }
  // Pi's applyExtension: an overlay WITHOUT its own model list keeps the base
  // models, rebased onto the overlay's gateway when one is given; an overlay
  // WITH a model list replaces the base list outright (handled by the field
  // copy above).
  const baseModels = base?.models
  if (overlay.models === undefined && typeof overlay.baseUrl === 'string' && Array.isArray(baseModels)) {
    merged.models = baseModels.map(entry => (
      typeof entry === 'object' && entry !== null ? { ...entry as UnknownRecord, baseUrl: overlay.baseUrl } : entry
    ))
  }
  return merged
}

/** Structural fingerprint used to decide whether a recomposition actually
 * changed the canonical shape. Function identities differ on every factory
 * run (each agent instance registers fresh closures), so functions compare
 * by presence — behaviourally equivalent re-registrations keep the existing
 * canonical reference and the route built on it, exactly like today. */
function providerFingerprint(config: UnknownRecord | undefined): string {
  if (config === undefined) return 'absent'
  return JSON.stringify(config, (_key, value: unknown) => (typeof value === 'function' ? '[function]' : value))
}

function recordPackageProviderRegistration(shared: SharedHostState, packageName: string, name: string, value: UnknownRecord): void {
  shared.providerPackages ??= new Map()
  shared.providerPackageOrder ??= []
  if (!shared.providerPackageOrder.includes(packageName)) shared.providerPackageOrder.push(packageName)
  let slots = shared.providerPackages.get(name)
  if (slots === undefined) {
    slots = new Map()
    shared.providerPackages.set(name, slots)
  }
  slots.set(packageName, mergeProviderRegistration(slots.get(packageName), value))
}

/** Rebuild the canonical entry for one provider id from builtin + package
 * slots. Returns whether the composed shape changed (callers retire the
 * route on change so it is rebuilt from the new canonical). */
function recomposeSharedProvider(shared: SharedHostState, name: string): boolean {
  const builtin = shared.providerBuiltins?.get(name)
  const slots = shared.providerPackages?.get(name)
  let canonical: UnknownRecord | undefined
  if (slots === undefined || slots.size === 0) {
    // No overlays: expose the builtin untouched so its auth/login behavior is
    // exact (Pi recomposeProvider takes the same shortcut).
    canonical = builtin
  } else {
    canonical = { ...(builtin ?? {}) }
    for (const packageName of shared.providerPackageOrder ?? []) {
      const registration = slots.get(packageName)
      if (registration !== undefined) canonical = overlayProviderConfig(canonical, registration)
    }
  }
  const previous = shared.providers.get(name)
  const changed = providerFingerprint(previous) !== providerFingerprint(canonical)
  if (!changed) return false
  if (canonical === undefined) shared.providers.delete(name)
  else shared.providers.set(name, canonical)
  return true
}

/** Force-retire a provider's route regardless of refcounts: the canonical
 * definition changed, so a route built on the old shape must not serve it. */
function retireSharedProviderRoute(shared: SharedHostState, name: string): void {
  const route = shared.providerRouteDisposers.get(name)
  if (route === undefined) return
  shared.providerRouteDisposers.delete(name)
  shared.providerRouteOwners.delete(name)
  route()
}

function sharedEventBusFor(shared: SharedHostState, ownerAgent: UnknownRecord | undefined): EventEmitter {
  if (ownerAgent === undefined) {
    if (shared.hostEventBus === undefined) {
      shared.hostEventBus = new EventEmitter()
      shared.hostEventBus.setMaxListeners(0)
    }
    return shared.hostEventBus
  }
  shared.agentEventBuses ??= new WeakMap()
  let bus = shared.agentEventBuses.get(ownerAgent)
  if (bus === undefined) {
    bus = new EventEmitter()
    bus.setMaxListeners(0)
    shared.agentEventBuses.set(ownerAgent, bus)
  }
  return bus
}

function sharedThemeFor(shared: SharedHostState, ownerAgent: UnknownRecord | undefined): Theme {
  if (ownerAgent === undefined) {
    shared.hostTheme ??= new Theme()
    return shared.hostTheme
  }
  shared.agentThemes ??= new WeakMap()
  let theme = shared.agentThemes.get(ownerAgent)
  if (theme === undefined) {
    theme = new Theme()
    shared.agentThemes.set(ownerAgent, theme)
  }
  return theme
}

function sharedHostStateOf(ctx: Context): SharedHostState {
  const key = ((ctx as unknown as { root?: object }).root ?? ctx) as object
  let shared = SHARED_HOST_STATE.get(key)
  if (shared === undefined) {
    shared = {
      companionRoutes: new Map(),
      providerRouteDisposers: new Map(),
      providerModelDiscoveries: new Map(),
      providerRouteOwners: new Map(),
      runtimeStatesBySession: new Map(),
      publishedOAuthKeys: new Map(),
      providers: new Map(),
    }
    SHARED_HOST_STATE.set(key, shared)
  }
  return shared
}

function packageRemountsOf(ctx: Context, shared: SharedHostState): Map<string, () => Promise<void>> {
  const scoped = scopeOf(ctx)
  const owner = (typeof scoped === 'object' && scoped !== null ? scoped : ctx) as object
  const byOwner = (shared.packageRemounts ??= new WeakMap())
  let remounts = byOwner.get(owner)
  if (remounts === undefined) {
    remounts = new Map()
    byOwner.set(owner, remounts)
  }
  return remounts
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

// Pi hosts ship /login <provider> as a built-in. Commands are Agent-scoped,
// while the provider directory they read is host-shared, so register one
// command per Agent regardless of how many Pi packages that Agent mounts.
function ensureLoginCommand(ctx: Context, state: RuntimeState): void {
  const scoped = scopeOf(ctx)
  const owner = (typeof scoped === 'object' && scoped !== null ? scoped : ctx) as object
  const registered = (state.shared.loginRegistered ??= new WeakSet())
  if (registered.has(owner)) return
  registered.add(owner)
  try {
    registerLoginCommand(ctx, state)
  } catch (error) {
    registered.delete(owner)
    logger(ctx).warn(`[pi2dsh] /login is already registered by an earlier package in this host; this package's providers use that command (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * Turn what the user answered into one of the offered options.
 * @param answer - the label, a differently-cased label, or a 1-based position.
 * @param offered - the options as they were shown, in order.
 * @returns the matching option, or undefined when nothing matches.
 */
function resolveOfferedChoice(answer: string, offered: readonly string[]): string | undefined {
  const trimmed = answer.trim()
  if (offered.includes(trimmed)) return trimmed
  const insensitive = offered.find(name => name.toLowerCase() === trimmed.toLowerCase())
  if (insensitive !== undefined) return insensitive
  if (/^\d+$/u.test(trimmed)) {
    const at = Number(trimmed) - 1
    if (at >= 0 && at < offered.length) return offered[at]
  }
  return undefined
}

/**
 * Cancel the login already in flight, if any, and wait for it to let go.
 *
 * Waiting matters: the next flow binds the same fixed callback port, and Pi's
 * flow answers a taken port by silently degrading to a listener that never
 * receives a code. Starting the new flow before the old one has closed
 * reproduces exactly that.
 * @param state - the mounting package's state, holding the shared host state.
 * @returns the cancelled provider's name, or undefined when nothing was running.
 */
async function supersedeActiveLogin(state: RuntimeState): Promise<string | undefined> {
  const previous = state.shared.activeLogin
  if (previous === undefined) return undefined
  state.shared.activeLogin = undefined
  previous.controller.abort()
  for (const path of previous.published) revokeAuthorization(path)
  let timer: ReturnType<typeof setTimeout> | undefined
  const released = await Promise.race([
    previous.finished.then(() => true),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5_000) }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  // Never start a flow that would silently lose its callback: say so instead.
  if (!released) {
    throw new Error(`the ${previous.providerName} login is still shutting down; try /login again in a moment`)
  }
  return previous.providerName
}

/**
 * Give a logged-in provider a route, if nothing else already gave it one.
 *
 * Pi's built-in OAuth providers (openai-codex, anthropic, github-copilot,
 * kimi-coding) are seeded so `/login` can offer them, but they carry no
 * transport and no catalog — so the registration path above never builds them
 * a route, and a successful login used to leave the model picker unchanged.
 * A stored credential is the whole precondition: with one, the models pi-ai's
 * installed catalog describes become selectable through DSH's own adapter.
 * @param name - the Pi provider id, which is also its DSH route name.
 * @param config - the provider config, whose oauth block made it loginable.
 * @returns whether this call put a route in place.
 */
async function ensureLoggedInProviderRoute(
  ctx: Context,
  state: RuntimeState,
  name: string,
  config: UnknownRecord,
): Promise<boolean> {
  if (!providerSupportsOAuth(config)) return false
  // A package that carries a transport or declares a catalog already has its
  // own, better, route — this is only for a provider whose sole capability is
  // logging in.
  if (providerCarriesTransport(config) || state.providerRouteDisposers.has(name)) return false
  // A route written by an earlier session may already be registered when this
  // package mounts. That only means its SETTINGS survived; it says nothing
  // about the credential behind apiKeyEnv (a copied profile, a cleared host
  // store, or a rotated OAuth token can all leave it missing/stale). Publish
  // and arm refresh first, then skip only the redundant settings write.
  const alreadyRouted = llmOf(ctx)?.listProviders().some(provider => provider.id === name) === true
  const credential = await storedOAuthCredential(oauthStoreOf(state), name).catch(() => undefined)
  if (credential === undefined) return false
  // The route is CONFIGURATION, not transport: the official llm-pi-ai adapter
  // is already mounted and owns this namespace, so the profile goes into its
  // settings section — mounting a second copy of that plugin collides on the
  // provider directory it declares ("configurable provider ... is already
  // declared"). The profile names the credential and nothing else: no api, no
  // baseURL, no models, so the adapter reuses pi-ai's installed provider with
  // its own protocol, quirks and model catalog.
  // The profile names a credential; something has to put a value behind that
  // name. DSH's credentials service is a SINGLE service (credentials-local
  // holds it), so a bridge-owned provider cannot be mounted beside it without
  // shadowing the host's own store — the value goes into the host's store
  // instead, and stays fresh through the per-request hook below.
  const published = await publishOAuthCredential(ctx, state, name, config)
  if (!published.ok) return false
  keepOAuthCredentialFresh(ctx, state)
  if (alreadyRouted) return false
  const settings = optionalService<{ update(ns: string, patch: object): Promise<void> }>(ctx, 'settings')
  if (settings === undefined) {
    logger(ctx).warn(`[pi2dsh] logged in to ${JSON.stringify(name)}, but this composition has no settings service to declare its model route in`)
    return false
  }
  await settings.update('llm-pi-ai', {
    providers: {
      [name]: {
        // The name the user logged in as, so the picker groups models under
        // "OpenAI (ChatGPT Plus/Pro)" rather than a bare route key.
        ...(typeof config.name === 'string' ? { displayName: config.name } : {}),
        // An endpoint the credential itself decided (github-copilot reads its
        // host out of the token, so an enterprise or proxied account is not on
        // the catalog default). It is an address, not a secret, and overriding
        // it does NOT repoint the route — only naming `api` would, and that is
        // what would cost the catalog provider's own protocol and quirks.
        ...(published.baseUrl === undefined ? {} : { baseURL: published.baseUrl }),
        apiKeyEnv: oauthCredentialRef(name),
      },
    },
  })
  return true
}

interface DshCredentialsLike {
  set(ref: string, value: string): Promise<void>
  describe(ref: string): Promise<{ configured: boolean, writable: boolean }>
}

/**
 * Put a logged-in provider's current key where the official adapter reads it.
 *
 * Pi keeps the OAuth credential (access + refresh + expiry) in its own store;
 * DSH's adapter reads one opaque value through the credentials seam. This is
 * the join: Pi's resolution runs — including its double-checked-lock refresh
 * when the token is inside the five-minute window — and whatever key that
 * yields is stored under the reference the profile names.
 * @returns whether a key is now behind the reference, plus any endpoint the
 *   credential itself decided (some providers read their host out of the token).
 */
async function publishOAuthCredential(
  ctx: Context,
  state: RuntimeState,
  name: string,
  config: UnknownRecord,
): Promise<{ ok: boolean, baseUrl?: string }> {
  const credentials = optionalService<DshCredentialsLike>(ctx, 'credentials')
  if (credentials === undefined) {
    logger(ctx).warn(`[pi2dsh] logged in to ${JSON.stringify(name)}, but this composition has no credentials service to hand the token to`)
    return { ok: false }
  }
  const resolvedAuth = (await resolvePiProviderAuth({
    providerId: name, providerConfig: config, store: oauthStoreOf(state),
  }).catch(() => undefined))?.auth as { apiKey?: unknown, baseUrl?: unknown } | undefined
  const key = typeof resolvedAuth?.apiKey === 'string' ? resolvedAuth.apiKey : undefined
  if (key === undefined || key.length === 0) {
    // Some flows hand back a header rather than a key (kimi-coding returns
    // `{headers: {Authorization: ...}}`). DSH's profile carries a credential
    // REFERENCE, never a secret, so a header-shaped credential has nowhere to
    // go — and staying silent about it is how "logged in, still no models"
    // happens. Say it once, plainly, instead of leaving an empty picker.
    logger(ctx).warn(`[pi2dsh] logged in to ${JSON.stringify(name)}, but this provider authenticates with a request header rather than an api key — DSH routes name a credential reference, so no model route was added for it`)
    return { ok: false }
  }
  const ref = oauthCredentialRef(name)
  // An inherited environment value is the one layer the host cannot edit, and
  // it WINS resolution — writing under it would be stored and never read.
  const endpoint = typeof resolvedAuth?.baseUrl === 'string' ? { baseUrl: resolvedAuth.baseUrl } : {}
  const described = await credentials.describe(ref).catch(() => undefined)
  if (described?.writable === false) return { ok: true, ...endpoint }
  if (state.publishedOAuthKeys.get(name) === key) return { ok: true, ...endpoint }
  await credentials.set(ref, key)
  state.publishedOAuthKeys.set(name, key)
  return { ok: true, ...endpoint }
}

/**
 * Re-publish rotating OAuth keys at the moment a request needs them.
 *
 * An access token expires (codex's in about an hour), so a value stored once at
 * login goes stale and every later request fails on a credential the user
 * believes they supplied. DSH's own credentials contract is per-operation for
 * exactly this reason, and `llm/stream` is the per-operation seam.
 *
 * Whether the refresh is awaited depends on whether this request can still be
 * served by what is stored. Inside Pi's refresh window the stored token is
 * still VALID, so refreshing beside the request costs nothing and the rotated
 * key is there for the next one. Past expiry it is not: publishing in the
 * background there means the first request after an idle stretch goes out with
 * a dead token and fails, every time, and only the second one works. So an
 * expired credential blocks its own request until it has been renewed.
 */
function keepOAuthCredentialFresh(ctx: Context, state: RuntimeState): void {
  if (state.shared.oauthRefreshHooked === true) return
  state.shared.oauthRefreshHooked = true
  const cordisCtx = ctx as unknown as { on(event: string, handler: (...args: never[]) => unknown): () => void }
  cordisCtx.on('llm/stream', ((options: UnknownRecord, next: () => AsyncIterable<unknown>) => {
    const provider = typeof options.provider === 'string' ? options.provider : undefined
    const config = provider === undefined ? undefined : state.shared.providers.get(provider)
    if (provider === undefined || config === undefined || !providerSupportsOAuth(config)) return next()
    const publish = (): Promise<unknown> => publishOAuthCredential(ctx, state, provider, config)
      .catch(error => logger(ctx).warn(`[pi2dsh] could not refresh the stored credential for ${JSON.stringify(provider)}: ${error instanceof Error ? error.message : String(error)}`))
    return (async function* () {
      const stored = await storedOAuthCredential(oauthStoreOf(state), provider).catch(() => undefined)
      const expires = typeof stored?.expires === 'number' ? stored.expires : undefined
      // Expired (or an unstated expiry, which cannot be trusted): this request
      // cannot go out on what is stored, so wait for the renewal.
      if (expires === undefined || expires <= Date.now()) await publish()
      else void publish()
      yield* next()
    })()
  }) as never)
}

/**
 * Ask a provider package to discover its models, then let the host see them.
 *
 * Gateway discovery needs a credential, and a credential is not always there
 * when the provider registers: OAuth providers get theirs from a `/login` the
 * user runs later. So this is called at registration AND after a login — the
 * two moments a credential can appear — and it ends by re-announcing the
 * route, because DSH's directory observers (the model picker among them)
 * re-read on the route-set notification and nothing else.
 * @param name - the Pi provider id, which is also its DSH route name.
 * @param value - the provider config the package registered.
 * @returns how many models the route lists afterwards, or undefined when the
 *   package has no discovery of its own.
 */
async function discoverProviderModels(
  ctx: Context,
  state: RuntimeState,
  name: string,
  value: UnknownRecord,
): Promise<number | undefined> {
  const refreshModels = (value as { refreshModels?: unknown }).refreshModels
  if (typeof refreshModels !== 'function') return undefined
  const existing = state.shared.providerModelDiscoveries.get(name)
  if (existing !== undefined) return await existing
  const task = (async (): Promise<number | undefined> => {
    try {
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
    } catch (error) {
      logger(ctx).warn(`[pi2dsh] model catalog refresh for Pi provider ${JSON.stringify(name)} failed (its registry entries stay static): ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    // The Pi-side projection, then the DSH-side announcement. Refreshing only
    // the first is what left a post-login model list invisible until a restart:
    // the entries existed, and no directory observer had been told to look.
    void state.modelCatalog?.refresh()
    state.providerRouteDisposers.get(name)?.reannounce?.()
    return await llmOf(ctx)?.listModels(name).then(models => models.length).catch(() => undefined)
  })()
  state.shared.providerModelDiscoveries.set(name, task)
  try {
    return await task
  } finally {
    if (state.shared.providerModelDiscoveries.get(name) === task)
      state.shared.providerModelDiscoveries.delete(name)
  }
}

/** The dialog surface a login flow talks to — the /login command hands the
 * DSH command UI, the authorization-seam flow hands a session adapter. */
export interface ProviderLoginUi {
  input(title: unknown, placeholder?: unknown, signal?: AbortSignal): Promise<string | undefined>
  select(title: unknown, options: unknown[], signal?: AbortSignal): Promise<string | undefined>
  notify(message: unknown): void
  deviceCode?(title: unknown, detail: unknown, signal?: AbortSignal): Promise<void>
}

/**
 * Run one provider's own OAuth login end to end — the shared spine behind
 * the /login command and the DSH authorization-seam flow. Owns the
 * host-wide single-flight (the fixed callback port), the short-link
 * publication, and the post-login route + catalog refresh.
 * @returns the user-facing summary line.
 */
async function runProviderLogin(
  ctx: Context,
  state: RuntimeState,
  providerId: string,
  config: UnknownRecord,
  ui: ProviderLoginUi,
  externalSignal?: AbortSignal,
): Promise<string> {
  const oauthName = ((config.oauth as UnknownRecord | undefined)?.name as string | undefined) ?? providerId
  // One login at a time, host-wide (see SharedHostState.activeLogin). A
  // newer login is the user's current intent — nobody runs it twice
  // wanting two — so it takes over: the previous flow is cancelled, which
  // also closes its dialog and frees the callback port the new flow needs.
  const superseded = await supersedeActiveLogin(state)
  if (superseded !== undefined) ui.notify(`Cancelled the ${superseded} login that was still waiting.`)
  const active: ActiveLogin = {
    providerName: oauthName,
    controller: new AbortController(),
    finished: Promise.resolve(),
    published: [],
  }
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) active.controller.abort()
    else externalSignal.addEventListener('abort', () => active.controller.abort(), { once: true })
  }
  const attempt = loginPiProvider({
    // The host action: this is the one place that opens a window on the
    // machine dsh runs on. Nothing below this layer reaches for it.
    open: openBrowser,
    // A short link on this app's own origin, because a 400-character
    // authorize URL in a dialog is not something a person can click.
    shorten: (url: string) => {
      const path = publishAuthorization(url)
      const web = (ctx as unknown as { get(name: string): { port?: number, host?: string } | undefined }).get('webServer')
      if (path === undefined || web?.port === undefined) return undefined
      active.published.push(path)
      const host = web.host === '0.0.0.0' || web.host === undefined ? '127.0.0.1' : web.host
      return `http://${host}:${web.port}${path}`
    },
    providerId,
    providerName: oauthName,
    providerConfig: config,
    store: oauthStoreOf(state),
    ui,
    signal: active.controller.signal,
  })
  // What the NEXT login waits on before binding the port: the attempt
  // itself, however it ends.
  active.finished = attempt.then(() => undefined, () => undefined)
  state.shared.activeLogin = active
  try {
    await attempt
  } finally {
    for (const path of active.published) revokeAuthorization(path)
    if (state.shared.activeLogin === active) state.shared.activeLogin = undefined
  }
  // The credential the user just supplied is the one gateway discovery was
  // missing. Running it now — and re-announcing the route — is what makes
  // this provider's models appear in the model picker without a restart;
  // logging in and then finding nothing to select is not a login.
  // Logging in is only half of "I want this gateway's models": the other
  // half is the route. Declared first, so the discovery below (and the
  // count reported to the user) sees it.
  const declared = await ensureLoggedInProviderRoute(ctx, state, providerId, config)
  const discovered = await discoverProviderModels(ctx, state, providerId, config)
    ?? (declared ? await llmOf(ctx)?.listModels(providerId).then(list => list.length).catch(() => undefined) : undefined)
  const models = discovered === undefined ? '' : `; ${discovered} models available`
  ui.notify(`Logged in to ${oauthName}${models}`)
  return `Logged in to ${oauthName}${models}`
}

/**
 * Project one provider's OAuth login onto DSH's official authorization seam
 * (`ctx.authorization`, 0.1.1 line). The flow runs the SAME login spine as
 * /login; the DSH sign-in surface supplies the interaction. On hosts without
 * the seam (rc.8 line) this is a no-op and /login stays the only entry.
 *
 * The credential itself stays in the bridge's Pi-format store — the DSH
 * credential record written at the end is the seam's commit witness (the
 * service verifies it observed a record update for the flow's key), and the
 * official sign-out (`deleteRecord`) is mirrored back into the Pi store by
 * the watcher below.
 *
 * Same id under another scope (the official llm-pi-ai catalog registers
 * sign-ins for its whole catalog) is NOT a conflict: flows are keyed by
 * scope/id exactly so registrars can coexist, and the credential spaces
 * really are separate — signing in through the official flow lands a record
 * only llm-pi-ai routes can use, while this flow authorizes the routes the
 * bridge actually serves (package transports and logged-in builtins).
 * Standing down here would leave those routes unreachable from the native
 * surface. The label carries "(pi2dsh)" so a future surface shows whose
 * sign-in each entry is. Only our own exact key is defended: a collision on
 * `pi2dsh/<id>` throws in registerFlow and degrades to /login-only.
 *
 * Composition order is not ours to assume: the stock 0.1.1 compositions ship
 * the authorization package without composing it, so the service may appear
 * (or bounce) at any time after this provider registers. The official
 * pattern — the one llm-pi-ai itself uses — is `ctx.inject(['authorization',
 * ...], cb)`: cordis mounts the callback when the services are present,
 * disposes everything it registered when they leave, and mounts it again if
 * they return. The scope hangs off the CALLING ctx, so a flow projected for
 * a package's provider dies with that package, and a built-in entry's flow
 * dies with the engine.
 */
function maybeProjectAuthorizationFlow(ctx: Context, state: RuntimeState, providerId: string): void {
  const shared = state.shared
  shared.authorizationArmedIds ??= new Set()
  if (shared.authorizationArmedIds.has(providerId)) return
  const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: Context) => void) => void }).inject
  if (typeof inject !== 'function') return
  shared.authorizationArmedIds.add(providerId)
  inject.call(ctx, ['authorization', 'credentials'], scope => {
    void projectAuthorizationFlow(scope, state, providerId)
  })
}

/** The per-mount half: services are present on `scope`, register the flow and
 * this provider's sign-out mirror. Everything registered here is disposed by
 * cordis with the scope. */
async function projectAuthorizationFlow(scope: Context, state: RuntimeState, providerId: string): Promise<void> {
  const shared = state.shared
  const ctx = scope
  const authorization = optionalService<{
    registerFlow(flow: UnknownRecord): () => void
  }>(ctx, 'authorization')
  const credentials = optionalService<{
    modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
    readRecord(key: unknown): Promise<unknown>
  }>(ctx, 'credentials')
  if (authorization === undefined || credentials === undefined) return
  try {
    // The key helpers are 0.1.1-line exports of the credentials package;
    // resolve them dynamically so no chunk references symbols the rc.8
    // generation lacks. Reaching here implies ctx.authorization exists, so
    // the peer IS the new generation — a miss still degrades to a warning.
    const credentialsModule = await import('@deepseek-ai/dsh-credentials') as unknown as {
      credentialKey?(scope: string, id: string): unknown
      isCredentialKeySegment?(value: string): boolean
    }
    const { credentialKey, isCredentialKeySegment } = credentialsModule
    if (credentialKey === undefined || isCredentialKeySegment === undefined) return
    if (!isCredentialKeySegment(providerId)) {
      logger(ctx).warn(`[pi2dsh] provider ${JSON.stringify(providerId)} cannot appear on the DSH sign-in surface (its id is outside the credential-key grammar); /login still works`)
      return
    }
    const canonicalOf = (): UnknownRecord => shared.providers.get(providerId) ?? {}
    const labelOf = (): string =>
      ((canonicalOf().oauth as UnknownRecord | undefined)?.name as string | undefined) ?? providerId
    const key = credentialKey('pi2dsh', providerId)
    // registerFlow's effect is created on the calling ctx (cordis binds
    // `this.ctx` to the caller), so the flow is withdrawn with this scope;
    // the returned disposer would only serve early withdrawal.
    authorization.registerFlow({
      key,
      label: `${labelOf()} (pi2dsh)`,
      methods: [{ id: 'oauth', label: `Sign in to ${labelOf()}` }],
      run: async (session: {
        method: string
        signal: AbortSignal
        notify(notice: UnknownRecord): void
        prompt(prompt: UnknownRecord): Promise<string>
      }) => {
        const ui: ProviderLoginUi = {
          notify: message => { session.notify({ message: String(message) }) },
          input: async (title, _placeholder, promptSignal) => {
            try {
              return await session.prompt({
                kind: 'text',
                message: String(title),
                ...(promptSignal instanceof AbortSignal ? { signal: promptSignal } : {}),
              })
            } catch (error) {
              // A withdrawn prompt (the browser callback won the race) is a
              // dismissal, not a failure — same contract as ui.input.
              if (promptSignal instanceof AbortSignal && promptSignal.aborted) return undefined
              throw error
            }
          },
          select: async (title, options, promptSignal) => {
            try {
              return await session.prompt({
                kind: 'select',
                message: String(title),
                options: options.map(option => ({ id: String(option), label: String(option) })),
                ...(promptSignal instanceof AbortSignal ? { signal: promptSignal } : {}),
              })
            } catch (error) {
              if (promptSignal instanceof AbortSignal && promptSignal.aborted) return undefined
              throw error
            }
          },
          // A device code is exactly what AuthorizationNotice.code is for.
          deviceCode: async (title, detail) => {
            session.notify({ message: String(title), code: String(detail) })
          },
        }
        const canonical = canonicalOf()
        if (!providerSupportsOAuth(canonical)) throw new Error(`${providerId} no longer supports OAuth login`)
        await runProviderLogin(ctx, state, providerId, canonical, ui, session.signal)
        await credentials.modifyRecord(key, async () => ({
          kind: 'grant',
          payload: { provider: providerId, managedBy: 'pi2dsh' },
        }))
      },
    })
    // The official sign-out mirror for THIS flow's key: deleting the DSH
    // credential record removes the bridge's stored login too. Registered on
    // the same scope, so it lives exactly as long as the flow it mirrors.
    ;(ctx as unknown as { on(event: string, callback: (eventKey: unknown) => void): unknown }).on('credentials/record-updated', (eventKey: unknown) => {
      void (async () => {
        try {
          if (String(eventKey) !== String(key)) return
          if (await credentials.readRecord(key) !== undefined) return
          await oauthStoreOf(state).delete(providerId)
          // A login placeholder route exists only because of the stored
          // credential; retire it. A package-owned transport route stays — its
          // per-request credential resolution reports the missing login itself.
          const canonical = shared.providers.get(providerId)
          if (canonical !== undefined && !providerCarriesTransport(canonical)) {
            retireSharedProviderRoute(shared, providerId)
          }
          logger(ctx).info(`[pi2dsh] signed out of ${providerId}: the DSH credential record was deleted, so the bridge's stored login was removed`)
        } catch (error) {
          logger(ctx).warn(`[pi2dsh] sign-out mirror failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    })
  } catch (error) {
    logger(ctx).warn(`[pi2dsh] could not project ${JSON.stringify(providerId)} onto the DSH sign-in surface: ${error instanceof Error ? error.message : String(error)}; /login still works`)
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
      const ui = commandContext.ui as ProviderLoginUi & {
        select(title: unknown, options: unknown[]): Promise<string | undefined>
      }
      let answer = args.trim().split(/\s+/u)[0] ?? ''
      if (answer.length === 0) {
        answer = oauthProviders.length === 1
          ? oauthProviders[0] as string
          : String(await ui.select('Log in to which provider?', oauthProviders) ?? '')
      }
      // The picker's answer is a LABEL by DSH's contract, but the same dialog
      // also offers a free-text box — a user who types the row number there
      // sends "1", and the row number is what a person reads off the screen
      // anyway. Accept the name, any casing of it, or the 1-based position;
      // anything else still fails loud with the list.
      // Answering nothing is a cancellation, and Pi's protocol has a channel
      // for that. Reporting it as `unknown OAuth provider ""` told the user
      // their choice was wrong when they had simply not made one.
      if (answer.length === 0) return 'Login cancelled'
      const providerId = resolveOfferedChoice(answer, oauthProviders)
      const config = providerId === undefined ? undefined : state.providers.get(providerId)
      if (providerId === undefined || config === undefined || !providerSupportsOAuth(config)) {
        throw new Error(`unknown OAuth provider ${JSON.stringify(answer)}; available: ${oauthProviders.join(', ')}`)
      }
      return await runProviderLogin(ctx, state, providerId, config, ui, commandContext.signal as AbortSignal | undefined)
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
  if (state.hostAnchor) {
    // The anchor keeps the package's own Pi-side ledger (getActiveTools,
    // re-registration and unregister semantics stay exact) but projects no
    // DSH tool: every executable session belongs to a per-Agent instance,
    // and a host-level twin would put duplicate names in front of the model.
    state.toolDisposers.set(tool.name, () => {})
    return
  }
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
      const agent = exec.agent as unknown as UnknownRecord | undefined
      // A DSH surface may replace its Agent without publishing the optional
      // agent/session-start event first (dsh-TUI /new does exactly that).
      // Pi initializes session-owned tools such as MCP before any tool can be
      // invoked, so the tool boundary must share the same once-per-session
      // start gate as the slash-command boundary. Without it the first MCP
      // call in a fresh TUI session reaches the adapter as "not initialized".
      await ensurePiSessionStarted(ctx, state, agent, exec.signal)
      const mutated = state.argMutations.get(exec as unknown as object)
      if (mutated !== undefined) state.argMutations.delete(exec as unknown as object)
      const effective = mutated ?? args
      // Pi's order, unchanged: the tool's own `prepareArguments` shim first,
      // then the argument gate its agent loop runs before EVERY execution —
      // coerce against the schema, then check. Without it a model that emits
      // "3" for a number parameter hands the tool a string (Pi hands it 3),
      // and malformed arguments reach the tool instead of coming back to the
      // model as the violation text it can retry against.
      const prepared = validateToolArguments(
        { name: live.name, parameters: live.parameters },
        { name: live.name, arguments: live.prepareArguments?.(cloneJson(effective)) ?? effective },
      )
      const result = await normalizeToolResultForDsh(ctx, await runInPiRuntime(state, agent, () => live.execute(
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
  // Register the browser card at package mount, not after the first result.
  // The package and tool name must both match the verified contract, so no
  // unrelated tool presentation is replaced.
  if (isKnownImageTool(state.packageName, tool.name)) {
    state.shared.browserSurfaces?.registerImageTool(tool.name)
  }
}

/**
 * Register ONE Pi custom tool into a child agent's scope (createAgentSession
 * customTools). Same translation as {@link registerTool}'s definition, but:
 * the registration goes through the CHILD ctx (a scoped registration that
 * unwinds with the child, invisible to the parent and siblings), and the
 * package's own Pi tool ledger is untouched — a child session's custom tools
 * belong to that session in Pi, not to the extension's registered set.
 * Partial-result updates have no Pi-side consumer on this path yet (the
 * façade projects durable events only), so the update callback is a no-op —
 * never a fake dispatch.
 */
function registerChildPiTool(childCtx: Context, state: RuntimeState, tool: PiTool): void {
  const normalized = normalizeToolSchema(tool.parameters)
  for (const warning of normalized.warnings) logger(childCtx).warn(`[pi2dsh] subagent tool ${tool.name}: ${warning}`)
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
      const agent = exec.agent as unknown as UnknownRecord | undefined
      // Pi's argument gate, unchanged: the tool's own prepareArguments shim,
      // then schema coercion + check before every execution.
      const prepared = validateToolArguments(
        { name: tool.name, parameters: tool.parameters },
        { name: tool.name, arguments: tool.prepareArguments?.(cloneJson(args)) ?? args },
      )
      const result = await normalizeToolResultForDsh(childCtx, await runInPiRuntime(state, agent, () => tool.execute(
        String(exec.callId),
        prepared,
        exec.signal,
        () => { /* no Pi-side partial-update consumer on the child path */ },
        contextFor(childCtx, state, agent, exec.signal),
      )))
      if (result.terminate === true) exec.concludeTurn()
      if (result.isError === true) {
        const message = textBlocks(result.content).map(block => block.text).filter(Boolean).join('\n')
        throw new Error(message || `Pi tool ${tool.name} failed`)
      }
      return result
    },
  }
  ;(childCtx as unknown as { tools: { register(toolDefinition: ToolDefinition): () => void } }).tools.register(definition)
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

/** Exact-Agent ownership for scoped mounts; legacy root mounts retain their old host-session rule. */
function acceptsAgent(state: RuntimeState, agent: UnknownRecord | undefined): boolean {
  // The host anchor serves no Agent at all: every live Agent has its own
  // instance, so anchor participation would double-run session lifecycles.
  if (state.hostAnchor) return false
  if (state.ownerAgent !== undefined) return agent === state.ownerAgent
  return !isSubagentOrigin(agent)
}

function toolRuntime(ctx: Context, agent?: UnknownRecord): {
  schemas(scope?: unknown): Array<{ name: string; description?: string; parameters?: unknown }>
  restrict?(filter: { allow?: string[], deny?: string[] }): () => void
} {
  const scoped = agent?.ctx as { tools?: ReturnType<typeof toolRuntime> } | undefined
  return scoped?.tools ?? (ctx as unknown as { tools: ReturnType<typeof toolRuntime> }).tools
}

/**
 * The system-prompt text a package's ACTIVE tools contribute.
 *
 * Pi renders `promptSnippet` into its "Available tools" list and
 * `promptGuidelines` into its "Guidelines" bullets. DSH assembles its prompt
 * from ordered sections, so both arrive as one section in DSH's tool-guidance
 * band, headed the way Pi heads them.
 * @param ctx - context used to read which tools are active.
 * @param state - runtime state holding the registered Pi tools.
 * @returns the section text, empty when no active Pi tool contributes any.
 */
function piToolPromptContribution(ctx: Context, state: RuntimeState): string {
  const active = new Set(getActiveTools(ctx, state))
  const snippets: string[] = []
  const guidelines: string[] = []
  for (const [name, tool] of state.tools) {
    if (!active.has(name)) continue
    const snippet = tool.promptSnippet
    if (typeof snippet === 'string' && snippet.trim().length > 0) snippets.push(`- ${snippet.trim()}`)
    const bullets = tool.promptGuidelines
    if (!Array.isArray(bullets)) continue
    for (const bullet of bullets) {
      if (typeof bullet === 'string' && bullet.trim().length > 0) guidelines.push(`- ${bullet.trim()}`)
    }
  }
  const parts: string[] = []
  if (snippets.length > 0) parts.push(`Available tools:\n${snippets.join('\n')}`)
  if (guidelines.length > 0) parts.push(`Guidelines:\n${guidelines.join('\n')}`)
  return parts.join('\n\n')
}

function getActiveTools(ctx: Context, state: RuntimeState): string[] {
  const agent = currentAgent(state)
  return toolRuntime(ctx, agent).schemas(agent).map(tool => tool.name)
}

/**
 * Pi's `setActiveTools`, on DSH's restriction seam.
 *
 * Pi walks the requested names and keeps the ones its registry knows —
 * **unknown names are silently skipped**. DSH's `restrict` instead FAILS the
 * whole call on a name it cannot restrict (unknown, scope-local, or a
 * reserved transport name), so passing Pi's list through verbatim turned a
 * routine Pi call into a hard error over one stale name.
 *
 * So the list is narrowed to what DSH says is restrictable before restricting.
 * The one case that cannot be both: a tool that is VISIBLE but not
 * restrictable (a scope's own registration, `run_code` outside native mode)
 * cannot be switched off at all. Silence there would leave a tool running that
 * the package believes it disabled, so it is reported once — the package's
 * call still takes effect for everything else.
 * @param ctx - context used to reach the tool runtime.
 * @param state - runtime state holding the per-agent restriction disposers.
 * @param names - the tool names the package wants active.
 */
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
  const restrictable = restrictableToolNames(scopedTools, agent)
  const allow = restrictable === undefined ? unique : unique.filter(name => restrictable.has(name))
  if (restrictable !== undefined) {
    const visible = new Set(scopedTools.schemas(agent as never).map(schema => schema.name))
    const unswitchable = [...visible].filter(name => !restrictable.has(name) && !unique.includes(name))
    if (unswitchable.length > 0) {
      logger(ctx).warn(
        `[pi2dsh] setActiveTools could not deactivate ${unswitchable.map(name => JSON.stringify(name)).join(', ')}:`
        + ' DSH does not allow restricting a scope-registered or reserved tool, so it stays available to the model',
      )
    }
  }
  state.toolRestrictions.get(agent)?.()
  // An empty allow-list is refused by DSH (an empty filter fails), and it is
  // also not what Pi means: Pi's empty list deactivates everything, which on
  // DSH is spelled as denying every restrictable name.
  state.toolRestrictions.set(agent, allow.length === 0
    ? scopedTools.restrict({ deny: [...(restrictable ?? new Set<string>())] })
    : scopedTools.restrict({ allow }))
}

/**
 * The tool names DSH will accept in a restriction for this scope.
 * @param tools - the agent-scoped tool runtime.
 * @param agent - the scope key.
 * @returns the restrictable names, or undefined when this runtime exposes no view.
 */
function restrictableToolNames(tools: UnknownRecord, agent: unknown): ReadonlySet<string> | undefined {
  const view = tools.view
  if (typeof view !== 'function') return undefined
  try {
    const names = (view.call(tools, agent) as { restrictableNames?: unknown } | undefined)?.restrictableNames
    return names instanceof Set ? names as ReadonlySet<string> : undefined
  } catch {
    return undefined
  }
}

function deliverAgentMessage(agent: DshAgent, message: unknown, mode: 'inject' | 'steer' | 'followup'): void {
  const deliver = agent[mode]
  if (typeof deliver !== 'function') throw new Error(`pi2dsh: active DSH agent has no ${mode}() delivery method`)
  deliver.call(agent, message)
}

/**
 * Pi's `sendMessage` / `sendUserMessage`, on DSH.
 *
 * Two things this has to get right that a plain `deliverAgentMessage` does not:
 *
 *  - **Durability.** Pi's no-turn `sendMessage` appends to the session and
 *    emits its message events before it returns: on return the message IS in
 *    the conversation. DSH's inject only queues it in the agent's inbox, where
 *    it becomes a `user/message` when the next step claims it — so a turn
 *    cancelled in between dropped it, and a package that had already reported
 *    success was wrong. The no-turn mode now appends to the durable log
 *    itself, which is what Pi's contract promises.
 *  - **Which session.** Inside a `withSession` callback the context is bound to
 *    the REPLACEMENT session, but the live agent is still the one that started
 *    the operation — so routing through the agent wrote into the OLD session.
 *    An override session is written to directly.
 * @param ctx - context used for content conversion.
 * @param state - runtime state (message source, active agent).
 * @param content - the Pi content to deliver.
 * @param mode - inject (no turn), steer, or followup.
 * @param sessionOverride - the replacement session, inside a withSession callback.
 * @param customType - Pi's role:"custom" marker, when the caller sent one.
 */
async function sendPiMessage(
  ctx: Context,
  state: RuntimeState,
  content: unknown,
  mode: 'inject' | 'steer' | 'followup',
  sessionOverride?: UnknownRecord,
  customType?: string,
): Promise<void> {
  const blocks = await piToDshContent(ctx, typeof content === 'string' ? [{ type: 'text', text: content }] : content)
  const message = createUserMessage({
    content: blocks,
    source: {
      kind: 'plugin', plugin: state.messageSource,
      ...(customType === undefined ? {} : { piCustomType: customType }),
    },
  })
  // A replacement session has no live agent of its own; the durable log IS the
  // conversation, so every mode writes there.
  if (sessionOverride !== undefined) {
    appendUserMessage(sessionOverride, message as unknown as UnknownRecord)
    return
  }
  if (mode === 'inject') {
    const session = agentSession(currentAgent(state))
    if (session === undefined) {
      throw new Error('pi2dsh: sendMessage requires one active DSH agent with a durable session')
    }
    appendUserMessage(session as unknown as UnknownRecord, message as unknown as UnknownRecord)
    return
  }
  const agent = requireAgent(state, 'sendUserMessage')
  deliverAgentMessage(agent, message, mode)
}

/**
 * Pi's delivery options → this bridge's mode. No options at all means "into
 * the conversation, no turn", which is Pi's own default.
 * @param options - the caller's delivery options.
 */
function deliveryMode(options: UnknownRecord): 'inject' | 'steer' | 'followup' {
  if (options.deliverAs === 'steer') return 'steer'
  if (options.deliverAs === 'followUp' || options.deliverAs === 'nextTurn' || options.triggerTurn === true) {
    return 'followup'
  }
  return 'inject'
}

/**
 * Append one plugin-sourced user message to a session's durable log, which is
 * what makes it part of the conversation before the call returns.
 * @param session - the live DSH session to append to.
 * @param message - the message, already in DSH shape.
 */
function appendUserMessage(session: UnknownRecord, message: UnknownRecord): void {
  const append = session.append
  if (typeof append !== 'function') {
    throw new Error('pi2dsh: this session cannot be appended to, so the message could not be delivered durably')
  }
  // `user/message` is surface-eligible, so DSH requires the marker that says
  // where it lands on the model-visible surface — the same `append` the agent
  // loop uses when it enters a claimed prompt.
  append.call(session, 'user/message', message, { surfaceOp: 'append' })
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

function normalizedPiCommandName(piName: string): string {
  // DSH command names are /^[a-z][a-z0-9_-]*$/; Pi allows richer names like
  // "btw:tangent". Normalize instead of refusing the whole package.
  const normalized = piName.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^[^a-z]+/u, '')
  return normalized.length > 0 ? normalized : 'pi-command'
}

function dshCommandName(ctx: Context, state: RuntimeState, piName: string): string {
  const validName = normalizedPiCommandName(piName)
  const tuiAvailable = state.tuiSurfaces?.available === true || optionalService(ctx, 'tuiScenes') !== undefined
  const name = commandNameForDshTui(validName, tuiAvailable)
  if (name !== piName) {
    const reason = name === `pi-${validName}`
      ? `because dsh-TUI reserves /${validName} for its own local command (locals win on name collisions)`
      : 'to satisfy DSH command naming'
    logger(ctx).warn(`[pi2dsh] Pi command /${piName} registered as /${name} ${reason}`)
  }
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
  if (state.hostAnchor) {
    // Anchor ledger only: the command palette entries belong to the
    // per-Agent instances; a host-level twin would collide into the
    // numbered-alias scheme (/name-2) against its own package.
    return
  }
  const commands = (ctx as unknown as { get(name: string): unknown }).get('commands') as {
    register(definition: UnknownRecord): () => void
  } | undefined
  if (commands === undefined) {
    logger(ctx).warn(`[pi2dsh] command /${command.name} was not registered because this DSH composition has no ctx.commands`)
    return
  }
  const baseName = dshCommandName(ctx, state, command.name)
  const existingOwner = state.dshCommandOwners.get(baseName)
  // Prefer a Pi command that NATURALLY owns this name over an earlier command
  // the host renamed into it. pi-mcp-adapter deliberately declares both
  // /mcp and /pi-mcp; dsh-TUI reserves /mcp, so the first declaration is
  // temporarily projected onto /pi-mcp. When the explicit /pi-mcp arrives it
  // should replace that temporary projection, not leak a meaningless
  // /pi-mcp-2. The rule is generic: normalization collisions where both Pi
  // names naturally map to the same DSH name still use numbered aliases.
  if (existingOwner !== undefined
    && existingOwner !== command.name
    && normalizedPiCommandName(command.name) === baseName
    && normalizedPiCommandName(existingOwner) !== baseName) {
    state.commandDisposers.get(existingOwner)?.()
    state.commandDisposers.delete(existingOwner)
    state.dshCommandOwners.delete(baseName)
  }
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
      await runInPiRuntime(state, agent, async () => {
        await ensurePiSessionStarted(ctx, state, agent, invocation.signal as AbortSignal | undefined)
        await live.handler(String(invocation.rawInput ?? '').trimStart(), commandContext)
      })
      const notices = commandContext.__notices as string[]
      return { kind: 'success', ...(notices.length > 0 ? { text: notices.join('\n') } : {}) }
    },
  })
  let lastError: unknown
  for (let ordinal = 1; ordinal <= 9; ordinal++) {
    const dshName = ordinal === 1 ? baseName : `${baseName}-${ordinal}`
    try {
      state.commandDisposers.set(command.name, commands.register(definitionFor(dshName)))
      state.dshCommandOwners.set(dshName, command.name)
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

/**
 * DSH's own session title service, when the profile mounts it.
 *
 * Pi's "session name" and DSH's "session title" are the same fact under two
 * names, and DSH's is the one every DSH surface displays. This bridge used to
 * keep the name only in its own sidecar, so a package could rename the session
 * and nothing the user looks at ever changed — while `getSessionName()` read
 * back a name DSH had never adopted, and DSH's own generated titles were
 * invisible to packages entirely.
 */
interface DshSessionTitleService {
  get(session: unknown): { title?: unknown } | undefined
  rename(session: unknown, title: string): unknown
}

/**
 * The session's current name: DSH's title when a title service is mounted,
 * this bridge's sidecar otherwise (and as the fallback for a session named
 * before the service was there).
 * @param ctx - the cordis context to resolve the optional service from.
 * @param state - runtime state holding the sidecar.
 * @param session - the live DSH session.
 */
function sessionNameOf(ctx: Context, state: RuntimeState, session: { id: string }): string | undefined {
  const titles = optionalService<DshSessionTitleService>(ctx, 'sessionTitle')
  const title = titles?.get(session)?.title
  return typeof title === 'string' && title.length > 0 ? title : state.bridge.getName(session.id)
}

/**
 * Whether a human can actually answer a question right now.
 *
 * Two facts decide it, and the old check (`the service is mounted`) saw
 * neither: a headless composition mounts the service and registers NO
 * provider, and a delegated child agent has no human answerer at all — both
 * make every `ctx.ui.select/confirm/input` throw for a package that was told
 * `hasUI: true` and skipped its non-interactive path.
 *
 * The provider is a private field, but its existence is publicly observable:
 * DSH allows exactly one provider per context and refuses a second with
 * `DUPLICATE_PROVIDER`. So registering a probe answers the question — a
 * refusal means a real provider is there, and an acceptance means there was
 * none, which the immediate disposal restores.
 * @param userQuestions - the mounted question service, if any.
 * @param agent - the agent whose turn this context belongs to.
 */
function humanAnswererAvailable(userQuestions: unknown, agent: UnknownRecord | undefined): boolean {
  if (userQuestions === undefined) return false
  // A child agent is owned by another agent; DSH refuses its questions with
  // DELEGATED_CALLER however the composition is wired.
  if (isSubagentOrigin(agent)) return false
  const service = userQuestions as { registerProvider?(provider: unknown): () => void }
  if (typeof service.registerProvider !== 'function') return false
  let dispose: (() => void) | undefined
  try {
    dispose = service.registerProvider({ ask: async () => { throw new Error('pi2dsh probe provider') } })
  } catch {
    // Refused: a real provider holds the slot.
    return true
  }
  dispose?.()
  return false
}

function requireSession(state: RuntimeState, operation: string): { id: string; events: unknown } {
  const agent = currentAgent(state)
  const session = agentSession(agent)
  if (session === undefined) {
    throw new Error(`pi2dsh: ${operation} requires one active DSH agent with a durable session`)
  }
  return session
}

function releaseSharedProviderRoute(state: RuntimeState, name: string): void {
  if (!state.ownedProviderRoutes.delete(name)) return
  const owners = state.shared.providerRouteOwners.get(name)
  owners?.delete(state)
  if (owners !== undefined && owners.size > 0) return
  state.shared.providerRouteOwners.delete(name)
  const route = state.shared.providerRouteDisposers.get(name)
  state.shared.providerRouteDisposers.delete(name)
  route?.()
}

function registerSharedProviderRoute(
  ctx: Context,
  state: RuntimeState,
  name: string,
  value: UnknownRecord,
): PiRouteHandle | undefined {
  const shared = state.shared
  const existing = shared.providerRouteDisposers.get(name)
  if (existing !== undefined) {
    let owners = shared.providerRouteOwners.get(name)
    if (owners === undefined) {
      owners = new Set()
      shared.providerRouteOwners.set(name, owners)
    }
    owners.add(state)
    state.ownedProviderRoutes.add(name)
    return existing
  }

  // The canonical composed config is maintained by recomposeSharedProvider;
  // the fallback only covers host paths (stored-login placeholder routes)
  // that reach here before any composition happened for this id.
  const canonical = shared.providers.get(name) ?? value
  if (!shared.providers.has(name)) shared.providers.set(name, canonical)
  const route = registerPiProviderRoute({
    llm: llmOf(ctx) as never,
    ctx: ctx as never,
    providerId: name,
    provider: canonical,
    host: {
      resolveAuth: async () => resolvePiProviderAuth({
        providerId: name,
        providerConfig: canonical,
        store: oauthStoreOf(state),
      }) as Promise<{ auth?: UnknownRecord } | undefined>,
      ensureModel: async () => { await discoverProviderModels(ctx, state, name, canonical) },
      warn: message => logger(ctx).warn(message),
      beforeProviderRequest: (payload, request) => dispatchHostProviderRequest(
        ctx,
        shared,
        state,
        payload,
        request,
      ),
      resolveAttachments: () => optionalService<DshAttachmentsLike>(ctx, 'attachments'),
    },
  })
  if (route === undefined) return undefined
  shared.providerRouteDisposers.set(name, route)
  shared.providerRouteOwners.set(name, new Set([state]))
  state.ownedProviderRoutes.add(name)
  return route
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
      // Pi's layered ledger: this registration merges into the package's slot
      // (defined fields over the previous registration), the canonical is
      // recomposed as builtin base + package overlays in load order, and a
      // changed shape retires the existing route so it is rebuilt from the
      // new canonical — partial overlays keep the builtin OAuth base instead
      // of discarding it, later packages override earlier ones, and an
      // idempotent re-registration from another agent's instance changes
      // nothing (same fingerprint keeps the existing canonical and route).
      recordPackageProviderRegistration(state.shared, state.packageName, name, value)
      if (recomposeSharedProvider(state.shared, name)) {
        retireSharedProviderRoute(state.shared, name)
      }
      const canonical = state.shared.providers.get(name) ?? value
      if (providerSupportsOAuth(canonical)) {
        // Pi hosts expose /login <provider> for oauth-capable providers; the
        // package's own login flow runs, credentials land in auth.json.
        ensureLoginCommand(ctx, state)
        // 0.1.1-line hosts additionally show it on their native sign-in
        // surface through the official authorization seam.
        maybeProjectAuthorizationFlow(ctx, state, name)
        logger(ctx).info(`[pi2dsh] Pi provider ${JSON.stringify(name)} supports OAuth — log in with /login ${name}`)
      }
      // A provider carrying its own transport becomes a REAL DSH llm route:
      // the loop and child agents route to it natively, with credentials
      // resolved through Pi's own chain per request.
      const routeDisposer = registerSharedProviderRoute(ctx, state, name, canonical)
      if (routeDisposer !== undefined) {
        void state.modelCatalog?.refresh()
        // Only the transport-carrying path is registered by the time this
        // returns. The catalog-only path mounts DSH's official adapter
        // asynchronously and reports its OWN outcome, so announcing success
        // here claimed a route that could still fail a moment later — which is
        // exactly what a fake credential produced: "registered as a native DSH
        // llm route" immediately followed by "could not be served".
        if (providerCarriesTransport(canonical)) {
          logger(ctx).info(`[pi2dsh] Pi provider ${JSON.stringify(name)} registered as a native DSH llm route`)
        }
      } else if (!providerSupportsOAuth(canonical)) {
        logger(ctx).info(`[pi2dsh] recorded Pi provider ${JSON.stringify(name)}; model calls stay on DSH llm adapters`)
      }
      // Pi hosts refresh a registered provider's dynamic model catalog
      // (fetchModels against its gateway); best-effort and non-blocking.
      void discoverProviderModels(ctx, state, name, canonical)
    },
    unregisterProvider(name: string) {
      state.providers.delete(name)
      releaseSharedProviderRoute(state, name)
      // Pi's unregisterProvider deletes the extension layer and recomposes so
      // the builtin base is restored. Adapted to the slotted ledger: this
      // package's slot is removed (other packages' overlays survive — in Pi
      // every unregister nukes the whole extension entry, but that contract
      // exists only inside one short-lived session runtime; on a long-lived
      // host it would let one package erase another's registration).
      const slots = state.shared.providerPackages?.get(name)
      if (slots?.delete(state.packageName) === true && recomposeSharedProvider(state.shared, name)) {
        retireSharedProviderRoute(state.shared, name)
        // Pi's recompose updates the directory entry in place; our route is an
        // explicit registration, so the restored composition (builtin base or
        // the remaining packages' overlays) must be re-published.
        const restored = state.shared.providers.get(name)
        if (restored !== undefined) registerSharedProviderRoute(ctx, state, name, restored)
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
      return sendPiMessage(ctx, state, message.content, deliveryMode(options), undefined,
        typeof message.customType === 'string' ? message.customType : undefined)
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
      const titles = optionalService<DshSessionTitleService>(ctx, 'sessionTitle')
      // DSH's title is durable, pins against automatic regeneration, and is
      // what its surfaces show — so it is where the name goes. The sidecar
      // stays the fallback for a composition that mounts no title service.
      // A blank name is the one case that stays local: DSH refuses a title
      // with no visible characters, while Pi accepts one.
      if (titles !== undefined && String(name).trim().length > 0) titles.rename(session, String(name))
      else state.bridge.setName(session.id, String(name))
      void dispatch(state, 'session_info_changed', {
        type: 'session_info_changed',
        name: sessionNameOf(ctx, state, session),
      }, contextFor(ctx, state, currentAgent(state), undefined))
        .catch(error => logger(ctx).warn(`[pi2dsh] session_info_changed handler failed: ${String(error)}`))
    },
    getSessionName() {
      const session = agentSession(currentAgent(state))
      return session === undefined ? undefined : sessionNameOf(ctx, state, session)
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
      // Read before the write: this used to read the map back AFTER setting it,
      // so `previousModel` was the model just selected and every handler saw
      // "changed from X to X". It also has to be a Pi Model — the map holds a
      // DSH-shaped `{provider, model}` route, which is not what Pi hands a
      // model_select handler.
      const previousModel = currentPiModel(state, agent)
      state.modelOverrides.set(agent, override)
      void dispatch(state, 'model_select', {
        type: 'model_select', model, previousModel, source: 'set',
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
        const off = (): void => { state.eventBus.off(channel, safeHandler) }
        state.eventBusOffs.push(off)
        return off
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
  const require = createRequire(import.meta.url)
  for (const family of ['@earendil-works', '@mariozechner']) {
    aliases[`${family}/pi-coding-agent`] = codingAgentShim
    aliases[`${family}/pi-tui`] = tuiShim
    // Pi publishes `./api/*` too, and a gateway package reaches for the entry
    // that matches its protocol. Every one of them lands on the same shim.
    for (const api of [
      'anthropic-messages', 'openai-completions', 'openai-responses', 'openai-codex-responses',
      'azure-openai-responses', 'google-generative-ai', 'google-vertex',
      'mistral-conversations', 'bedrock-converse-stream', 'pi-messages',
    ]) {
      // The shim itself re-exports Pi's real lazy transport factories. Resolve
      // those PUBLIC package subpaths exactly; otherwise
      // Jiti's prefix alias rewrites e.g. `pi-ai/api/foo.lazy` underneath the
      // shim path (`pi-ai.ts/api/foo.lazy`) when tests load the TypeScript
      // fallback before a dist build exists.
      try {
        aliases[`${family}/pi-ai/api/${api}.lazy`] = fileURLToPath(
          import.meta.resolve(`@earendil-works/pi-ai/api/${api}.lazy`),
        )
      } catch {
        // The ordinary shim alias below preserves a useful missing-package
        // failure if the bridge's declared dependency is unavailable.
      }
      aliases[`${family}/pi-ai/api/${api}`] = aiShim
    }
    // Pi resolves subpath entries of pi-ai (compat superset, oauth, provider
    // catalogs) for extensions; all of them land on the same shim surface.
    // Keep the broad package alias last: Jiti applies prefix aliases in
    // insertion order, so it must not swallow the real `.lazy` subpaths above.
    aliases[`${family}/pi-ai/compat`] = aiShim
    aliases[`${family}/pi-ai/oauth`] = aiShim
    aliases[`${family}/pi-ai/providers/all`] = aiShim
    aliases[`${family}/pi-ai/bedrock-provider`] = aiShim
    aliases[`${family}/pi-ai/bun-oauth`] = aiShim
    aliases[`${family}/pi-ai`] = aiShim
  }
  // Pi's loader hands extensions the host's typebox without a declaration;
  // mirror that by resolving every typebox entry the whitelist names to the
  // bridge's own copy.
  // typebox restricts its exports map (no ./package.json), so resolve each
  // public entry directly; resolution anchors at this runtime file, which in a
  // generated bundle sits next to the bundle's own node_modules.
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
  const scopedOwner = options.ownerAgent ?? scopeOf(ctx)
  const ownerAgent = typeof scopedOwner === 'object' && scopedOwner !== null
    ? scopedOwner as UnknownRecord
    : undefined
  const state: RuntimeState = {
    shared,
    packageName: options.manifest.package.name,
    ownerAgent,
    hostAnchor: options.hostAnchor === true,
    handlers: new Map(),
    tools: runtimeTools,
    runner: new ExtensionRunner(piToolRecords),
    toolDisposers: new Map(),
    toolRestrictions: new WeakMap(),
    commands: new Map(),
    commandDisposers: new Map(),
    dshCommandOwners: new Map(),
    companionRoutes: shared.companionRoutes,
    flags: new Map(),
    notifications: [],
    activeAgents: new Set(),
    hostAgent: undefined,
    piShutdownAgents: new WeakSet(),
    disposedAgents: new WeakSet(),
    startedSessions: new Set(),
    sessionStartTasks: new Map(),
    startedSessionlessAgents: new WeakSet(),
    sessionlessStartTasks: new WeakMap(),
    extensionsReady: false,
    pendingSessionStarts: new Map(),
    currentSystemPrompt: '',
    messageSource: `pi2dsh:${options.manifest.package.name}`,
    eventBus: sharedEventBusFor(shared, ownerAgent),
    eventBusOffs: [],
    agentScope: new AsyncLocalStorage(),
    llmBridge: undefined,
    piAiRegistry: __createPiAiRuntimeRegistry(),
    subagentSessionFactory: undefined,
    bridge: new PiSessionBridge(),
    theme: sharedThemeFor(shared, ownerAgent),
    shortcuts: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    providers: new Map(),
    autocompleteProviders: [],
    editorBuffers: new WeakMap(),
    toolsExpanded: false,
    modelOverrides: new WeakMap(),
    thinkingLevels: new WeakMap(),
    turnSystemPromptOverrides: new WeakMap(),
    projection: Promise.resolve(),
    terminateBatch: new WeakMap(),
    piTurnIndex: new WeakMap(),
    claimedForStep: new WeakMap(),
    promptedTurn: new WeakMap(),
    pendingInjections: new WeakMap(),
    globalThinkingLevel: 'off',
    argMutations: new WeakMap(),
    streamingTexts: new Map(),
    lastLoggedModels: new WeakMap(),
    providerRouteDisposers: shared.providerRouteDisposers,
    ownedProviderRoutes: new Set(),
    publishedOAuthKeys: shared.publishedOAuthKeys,
    tuiSurfaces: undefined,
  }
  // dsh-TUI is optional and may be mounted before or after this package.
  // Cordis keeps the child activation aligned with the service lifecycle;
  // by the time a terminal command executes, context.mode/hasUI and
  // ui.custom reflect whether the real terminal surface is available.
  mountTuiSurfaceAdapter(
    ctx as unknown as TuiSurfaceContext,
    state.packageName,
    adapter => { state.tuiSurfaces = adapter },
    typeof ownerAgent?.id === 'string'
      ? ownerAgent.id
      : undefined,
  )
  subscribeLifecycle(ctx, state)
  subscribeInterceptors(ctx, state)
  // Pi hosts ship their built-in OAuth providers ready to log in; preload the
  // four vendored official flows so `/login openai-codex` (etc.) works out of
  // the box, before any package registers its own providers. They form the
  // BUILTIN BASE LAYER of the layered ledger: a package registering the same
  // provider id overlays it field-wise (its defined fields win, undefined
  // fields keep the builtin — so a partial registration inherits the builtin
  // OAuth flow), and unregistering the overlay restores the builtin.
  shared.providerBuiltins ??= new Map()
  for (const provider of builtinProviders()) {
    const config = { name: provider.name, baseUrl: provider.baseUrl, oauth: provider.auth.oauth }
    state.providers.set(provider.id, config)
    if (!shared.providerBuiltins.has(provider.id)) {
      shared.providerBuiltins.set(provider.id, config)
      recomposeSharedProvider(shared, provider.id)
    }
    // On 0.1.1-line hosts the built-in entries also join the native sign-in
    // surface — unless another flow (the official llm-pi-ai catalog sign-ins)
    // already answers for the same id, in which case that one stands.
    maybeProjectAuthorizationFlow(ctx, state, provider.id)
  }
  ensureLoginCommand(ctx, state)
  // A credential stored by an EARLIER session must still produce a route:
  // otherwise the models a user logged in for vanish on the next restart and
  // they are told to log in again to something they are already logged in to.
  // This is part of mount readiness, not a background convenience. A one-shot
  // profile can start its first model call as soon as applyPiPackage returns;
  // publishing beside that call loses the race and the host reports
  // MISSING_CREDENTIAL even though auth.json already contains a valid login.
  for (const [name, config] of [...state.providers]) {
    try {
      await ensureLoggedInProviderRoute(ctx, state, name, config)
    } catch (error) {
      logger(ctx).warn(`[pi2dsh] could not restore the route for logged-in provider ${JSON.stringify(name)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Skills are static host-level content: DSH's skills registry is a host
  // service and the filesystem provider name is per-package, so per-Agent
  // registration would collide with itself. The anchor (or a legacy unowned
  // mount) carries them exactly once.
  if (options.manifest.skillDirs.length > 0 && state.ownerAgent === undefined) {
    const skills = (ctx as unknown as { get(name: string): unknown }).get('skills')
    if (skills === undefined) logger(ctx).warn('[pi2dsh] migrated skills were not mounted because this DSH composition has no ctx.skills')
    else {
      const { apply: applyFilesystemSkills } = await import('@deepseek-ai/dsh-skill-filesystem')
      const config = {
        providerName: `pi2dsh-${options.manifest.package.name.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '')}`,
        includeDefaultRoots: false,
        customSkillDirs: options.manifest.skillDirs.map(path => join(rootDir, path)),
        watch: false,
      }
      await ctx.plugin(Object.assign(
        (skillCtx: Context) => applyFilesystemSkills(skillCtx, config),
        { inject: ['skills'] },
      ))
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
    state.llmBridge = (model, context, callOptions) => streamViaDshLlm(llm, { model, context, options: callOptions })
  }
  // createAgentSession builds a real DSH child agent through ctx.agents; the
  // factory lives for exactly the runtime's lifetime.
  // The panel's registry and its read route: host-level, mounted once.
  const browserSurfaces = state.shared.browserSurfaces ??= new BrowserSurfaces()
  if (state.shared.browserSurfacesRouted !== true) {
    state.shared.browserSurfacesRouted = registerBrowserSurfaceRoute(ctx, browserSurfaces)
  }
  // Pi's custom entries, drawn by the package's OWN renderer. `appendEntry`
  // writes to the pi2dsh sidecar (DSH's log has no channel for event types
  // declared outside the harness), so nothing in the host's conversation view
  // would ever show them; running the registered EntryRenderer and projecting
  // its component to text is what puts a package's own entries on screen.
  // Pi's autocomplete providers, on DSH's trigger menu. Pi asks a provider at
  // the cursor on every edit; DSH asks a source after `/` or `@`. The two agree
  // exactly for a provider anchored on a trigger character — which is what an
  // @-mention provider is, and what the ecosystem's provider actually does — so
  // the bridge asks the Pi chain with the token the user is typing and offers
  // whatever it returns. A provider that completes bare words mid-sentence has
  // no DSH moment to fire in and simply returns nothing here.
  ctx.effect(() => browserSurfaces.trackCompletions(state.packageName ?? 'pi', async (trigger, query) => {
    if (state.autocompleteProviders.length === 0) return []
    // Pi's chain: each factory wraps the current provider, base returns nothing.
    let provider: UnknownRecord = { getSuggestions: async () => null }
    for (const factory of state.autocompleteProviders) {
      if (typeof factory !== 'function') continue
      provider = (factory as (current: unknown) => UnknownRecord)(provider) ?? provider
    }
    const getSuggestions = provider.getSuggestions
    if (typeof getSuggestions !== 'function') return []
    // The line the provider sees is the token itself: an anchored provider
    // reads backwards from the cursor for its trigger, and that is all there is.
    const line = `${trigger}${query}`
    const suggestions = await (getSuggestions as (
      lines: string[], cursorLine: number, cursorCol: number, options: UnknownRecord,
    ) => Promise<UnknownRecord | null>)([line], 0, line.length, { signal: new AbortController().signal })
    const items = (suggestions?.items ?? []) as Array<{ value?: unknown, label?: unknown, description?: unknown }>
    return items
      .filter(item => typeof item.value === 'string')
      .map(item => ({
        value: String(item.value),
        label: String(item.label ?? item.value),
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
      }))
  }))
  ctx.effect(() => browserSurfaces.trackEntries(state.packageName ?? 'pi', (sessionId) => {
    const rendered: Array<{ id: string, customType: string, text: string }> = []
    const draw = (renderer: unknown, subject: UnknownRecord): string | undefined => (
      typeof renderer !== 'function'
        ? undefined
        : surfaceText(
          (renderer as (subject: unknown, options: unknown, theme: unknown) => unknown)(subject, {}, state.theme),
          state.theme,
        )
    )
    // Custom ENTRIES live in the sidecar, addressed by session id.
    for (const entry of state.bridge.customEntries(sessionId)) {
      const text = draw(state.entryRenderers.get(entry.customType), {
        type: 'custom', id: entry.id, customType: entry.customType, data: entry.data, timestamp: entry.timestamp,
      })
      if (text !== undefined) rendered.push({ id: entry.id, customType: entry.customType, text })
    }
    // Custom MESSAGES are durable DSH log entries carrying Pi's role:"custom"
    // marker, so they are read back from the session itself rather than from a
    // cache — a renderer must still work after a restart.
    if (state.messageRenderers.size > 0) {
      const sessions = optionalService<{ get(id: unknown): UnknownRecord | undefined }>(ctx, 'sessions')
      const session = sessions?.get(sessionId)
      const events = session === undefined ? [] : eventsOf(session)
      for (const event of events) {
        const data = (event.data ?? {}) as UnknownRecord
        const customType = (data.source as UnknownRecord | undefined)?.piCustomType
        if (typeof customType !== 'string') continue
        const text = draw(state.messageRenderers.get(customType), {
          role: 'custom', customType, content: data.content, id: `dsh-${String(event.seq ?? '')}`,
        })
        if (text !== undefined) rendered.push({ id: `dsh-${String(event.seq ?? '')}`, customType, text })
      }
    }
    return rendered
  }))
  state.subagentSessionFactory = async (subagentOptions) => {
    const created = await createBridgedAgentSession(subagentHost(), subagentOptions)
    // Track it against the session the panel floats over — the PARENT, not the
    // child: the panel is a view of "what this conversation started".
    const parent = agentSession(currentAgent(state))
    const parentId = parent === undefined ? '' : String(parent.id ?? '')
    if (parentId.length > 0) {
      const dispose = browserSurfaces.track(parentId, {
        id: String((created.session as unknown as { sessionId?: unknown }).sessionId ?? '')
          || `pi2dsh-thread-${parentId}-${sidePanelSerial++}`,
        label: childLabel(subagentOptions.label, state.packageName),
        package: state.packageName,
        session: created.session,
      })
      ctx.effect(() => dispose)
    }
    return created
  }
  // Extracted so the factory above can build one per call; the annotation
  // carries the contract the object literal used to get from the call site.
  const subagentHost = (): SubagentHost => ({
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
    messageFromSessionEvent: event => messageFromSessionEvent(ctx, event),
    messageSource: state.messageSource,
    packageName: state.packageName,
    parentAgentContext: () => (currentAgent(state) as { ctx?: unknown } | undefined)?.ctx,
    registerChildTools: (childCtx, tools) => {
      for (const tool of tools) registerChildPiTool(childCtx as Context, state, tool as PiTool)
    },
    delegatedPolicyOverrides: () => {
      // DSH's own delegation capture (dsh-subagent semantics), read off the
      // parent's public services: only the parent session's EXPLICIT sandbox
      // override travels, and approval is pinned to 'never' whenever an
      // approval service exists — a child never blocks on a dialog.
      const parent = currentAgent(state) as { ctx?: { get?(name: string): unknown }, session?: unknown } | undefined
      const sandboxPolicy = (typeof parent?.ctx?.get === 'function' ? parent.ctx.get('sandboxPolicy') : undefined) as
        | { overrideOf?(session: unknown): unknown }
        | undefined
      const approval = typeof parent?.ctx?.get === 'function' ? parent.ctx.get('approval') : undefined
      const sandboxMode = sandboxPolicy?.overrideOf?.(parent?.session)
      return {
        ...(sandboxMode !== undefined ? { sandboxMode } : {}),
        ...(approval !== undefined ? { approvalPolicy: 'never' } : {}),
      }
    },
  })
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
  const mountExtensions = (): Promise<void> => runInPiRuntime(
    state,
    currentAgent(state),
    () => loadExtensions(
      rootDir,
      options.manifest,
      createPiApi(ctx, state),
      onExtensionError,
      onCapabilityGap,
      onHostInfraReference,
    ),
  )
  await mountExtensions()
  await flushPendingSessionStarts(ctx, state)
  // Pi's ctx.reload() remount: dispose every extension-owned registration and
  // run the entries again through a fresh loader. Prompt commands are package
  // registrations too (they share the command ledger), so they re-register
  // with the entries.
  const remounts = packageRemountsOf(ctx, shared)
  remounts.set(state.packageName, async () => {
    // Tool and command registrations on the DSH side stay in place — their
    // handlers resolve the live ledger entries, and re-registering from a
    // command execution stack would attach effects to the wrong fiber scope.
    // The remounted entries replace ledger entries through the same-name
    // registration path; event handlers (both Pi lifecycle handlers and the
    // package-local event bus) start from a clean slate — without this every
    // reload would double the subscriptions.
    state.extensionsReady = false
    state.handlers.clear()
    // The bus is agent-shared: unwind only this instance's subscriptions.
    for (const off of state.eventBusOffs.splice(0)) off()
    try {
      await registerPromptCommands(ctx, state, rootDir, options.manifest)
      await mountExtensions()
      await restartReloadedPiSessions(ctx, state)
    } finally {
      // A failed per-entry import is isolated by loadExtensions, but keep the
      // lifecycle gate usable even if host-owned prompt registration itself
      // rejects before the remount completes.
      state.extensionsReady = true
    }
  })
  ctx.effect(() => () => { remounts.delete(state.packageName) })
  const health = state.shared.capabilityLedger?.healthOf(state.packageName)
  const healthSuffix = health === undefined || health.status === 'ok'
    ? ''
    : ` — ${health.status.toUpperCase()}: missing Pi capabilities ${health.gaps.join(', ')}`
  logger(ctx).info(`[pi2dsh] loaded ${options.manifest.package.name}: ${state.tools.size} tools, ${state.commands.size} commands, ${options.manifest.skillDirs.length} skill roots${healthSuffix}${state.hostAnchor ? ' (host anchor)' : ''}`)
}

export const runtimeInternals = {
  compactionReason,
  resolveOfferedChoice,
  dshToPiContent,
  expandPrompt,
  isKnownImageTool,
  isSubagentOrigin,
  normalizeToolResult,
  splitArguments,
  supersedeActiveLogin,
  textBlocks,
}
