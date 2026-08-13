import { access, readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
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
  commands: Map<string, PiCommand>
  flags: Map<string, boolean | string | undefined>
  notifications: string[]
  activeAgents: Set<UnknownRecord>
  disposedAgents: WeakSet<object>
  currentSystemPrompt: string
  eventBus: EventEmitter
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

function contextFor(
  ctx: Context,
  state: RuntimeState,
  agent: UnknownRecord | undefined,
  signal: AbortSignal | undefined,
  command = false,
): UnknownRecord {
  const notices: string[] = []
  const ui = {
    notify(message: unknown) {
      const text = String(message)
      notices.push(text)
      state.notifications.push(text)
      logger(ctx).info(`[pi2dsh] ${text}`)
    },
    select: async () => unsupported('ctx.ui.select'),
    confirm: async () => unsupported('ctx.ui.confirm'),
    input: async () => unsupported('ctx.ui.input'),
    setStatus: () => logger(ctx).warn('[pi2dsh] ignored Pi TUI status update in DSH'),
    setWidget: () => logger(ctx).warn('[pi2dsh] ignored Pi TUI widget update in DSH'),
    custom: async () => unsupported('ctx.ui.custom'),
  }
  const base: UnknownRecord = {
    ui,
    mode: 'rpc',
    hasUI: false,
    cwd: cwdOf(agent),
    sessionManager: {
      getEntries: () => [],
      getLabel: () => undefined,
    },
    modelRegistry: {},
    model: undefined,
    scopedModels: [],
    thinkingLevel: undefined,
    isIdle: () => command,
    isProjectTrusted: () => false,
    signal,
    abort: () => unsupported('ctx.abort'),
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
  for (const handler of state.handlers.get(eventName) ?? []) results.push(await handler(event, eventContext))
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
    state.activeAgents.add(agent)
    void dispatch(state, 'session_start', { type: 'session_start', reason: sourceReason(payload.source) }, contextFor(ctx, state, agent, undefined))
      .catch(error => warn('session_start', error))
  })
  cordis.on('agent/disposed', (payload: UnknownRecord) => {
    const agent = payload.agent as UnknownRecord
    state.activeAgents.delete(agent)
    if (typeof agent === 'object' && agent !== null && !state.disposedAgents.has(agent)) {
      state.disposedAgents.add(agent)
      void dispatch(state, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, contextFor(ctx, state, agent, undefined))
        .catch(error => warn('session_shutdown', error))
    }
  })

  cordis.on('session/event', (session: UnknownRecord, event: UnknownRecord) => {
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
    state.eventBus.removeAllListeners()
  }, 'pi2dsh session shutdown')
}

function subscribeInterceptors(ctx: Context, state: RuntimeState): void {
  const cordis = ctx as unknown as { on(name: string, callback: (...args: any[]) => unknown): () => void }
  cordis.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    const input = cloneJson(exec.arguments)
    const event: UnknownRecord = { type: 'tool_call', toolName: exec.name, toolCallId: exec.callId, input }
    const results = await dispatch(state, 'tool_call', event, contextFor(ctx, state, exec.agent as unknown as UnknownRecord, exec.signal))
    if (!jsonEqual(input, exec.arguments)) {
      return { kind: 'deny', reason: 'pi2dsh rejected a Pi tool_call argument mutation because DSH logs arguments before policy' }
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

function registerTool(ctx: Context, state: RuntimeState, tool: PiTool): void {
  if (state.tools.has(tool.name)) throw new Error(`Pi tool ${JSON.stringify(tool.name)} is already registered`)
  const normalized = normalizeToolSchema(tool.parameters)
  for (const warning of normalized.warnings) logger(ctx).warn(`[pi2dsh] tool ${tool.name}: ${warning}`)
  state.tools.set(tool.name, tool)
  const definition: ToolDefinition = {
    name: tool.name,
    description: tool.description,
    parameters: normalized.schema,
    output: {
      schema: {},
      render: (_args, value) => textBlocks((value as UnknownRecord).content),
      presentationMeta: (_args, value) => jsonValue((value as UnknownRecord).details) as never,
    },
    isConcurrencySafe: () => tool.executionMode === 'parallel',
    async execute(args, exec) {
      const prepared = tool.prepareArguments?.(cloneJson(args)) ?? args
      const result = normalizeToolResult(await tool.execute(
        String(exec.callId),
        prepared,
        exec.signal,
        update => logger(ctx).debug(`[pi2dsh] tool ${tool.name} emitted a partial update: ${JSON.stringify(jsonValue(update))}`),
        contextFor(ctx, state, exec.agent as unknown as UnknownRecord, exec.signal),
      ))
      if (result.terminate === true) exec.concludeTurn()
      if (result.isError === true) {
        const message = textBlocks(result.content).map(block => block.text).filter(Boolean).join('\n')
        throw new Error(message || `Pi tool ${tool.name} failed`)
      }
      return result
    },
  }
  ;(ctx as unknown as { tools: { register(toolDefinition: ToolDefinition): () => void } }).tools.register(definition)
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
    name: command.name,
    description: command.description || `Migrated Pi command /${command.name}`,
    ...(command.argumentHint !== undefined ? { input: { hint: command.argumentHint } } : {}),
    async handler(invocation: UnknownRecord) {
      const agent = invocation.agent as UnknownRecord
      const commandContext = contextFor(ctx, state, agent, invocation.signal as AbortSignal, true)
      await command.handler(String(invocation.rawInput ?? '').trimStart(), commandContext)
      const notices = commandContext.__notices as string[]
      return { kind: 'success', ...(notices.length > 0 ? { text: notices.join('\n') } : {}) }
    },
  })
}

function createPiApi(ctx: Context, state: RuntimeState): UnknownRecord {
  const ignored = (name: string) => (..._args: unknown[]) => logger(ctx).warn(`[pi2dsh] ignored unsupported Pi registration: ${name}`)
  return {
    on(event: string, handler: PiHandler) {
      const list = state.handlers.get(event) ?? []
      list.push(handler)
      state.handlers.set(event, list)
    },
    registerTool: (tool: PiTool) => registerTool(ctx, state, tool),
    registerCommand(name: string, options: UnknownRecord) {
      registerCommand(ctx, state, {
        name,
        description: typeof options.description === 'string' ? options.description : `Migrated Pi command /${name}`,
        ...(typeof options.argumentHint === 'string' ? { argumentHint: options.argumentHint } : {}),
        handler: options.handler as PiCommand['handler'],
      })
    },
    registerShortcut: ignored('registerShortcut'),
    registerFlag(name: string, options: UnknownRecord) {
      state.flags.set(name, options.default as boolean | string | undefined)
      logger(ctx).warn(`[pi2dsh] Pi flag --${name} uses its default only; DSH CLI registration is unsupported`)
    },
    getFlag: (name: string) => state.flags.get(name),
    registerProvider: ignored('registerProvider'),
    unregisterProvider: ignored('unregisterProvider'),
    registerMessageRenderer: ignored('registerMessageRenderer'),
    registerEntryRenderer: ignored('registerEntryRenderer'),
    registerMarkdownTransformer: ignored('registerMarkdownTransformer'),
    sendMessage: () => unsupported('sendMessage'),
    sendUserMessage: () => unsupported('sendUserMessage'),
    appendEntry: () => unsupported('appendEntry'),
    setSessionName: () => unsupported('setSessionName'),
    getSessionName: () => undefined,
    setLabel: () => unsupported('setLabel'),
    exec: () => unsupported('exec'),
    getActiveTools: () => [...state.tools.keys()],
    getAllTools: () => [...state.tools.values()].map(tool => ({
      name: tool.name, description: tool.description, parameters: tool.parameters, source: 'extension',
    })),
    setActiveTools: () => unsupported('setActiveTools'),
    getCommands: () => [...state.commands.values()].map(command => ({
      name: command.name,
      description: command.description,
      source: 'extension',
      sourceInfo: { path: '', source: 'pi2dsh', scope: 'user', origin: 'package' },
    })),
    setModel: () => unsupported('setModel'),
    getThinkingLevel: () => 'off',
    setThinkingLevel: () => unsupported('setThinkingLevel'),
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

async function loadExtensions(rootDir: string, manifest: GeneratedRuntimeManifest, api: UnknownRecord): Promise<void> {
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
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: {
      '@earendil-works/pi-coding-agent': codingAgentShim,
      '@mariozechner/pi-coding-agent': codingAgentShim,
      '@earendil-works/pi-tui': tuiShim,
      '@mariozechner/pi-tui': tuiShim,
      '@earendil-works/pi-ai': aiShim,
      '@mariozechner/pi-ai': aiShim,
    },
  })
  for (const extension of manifest.extensions) {
    const loaded: unknown = await jiti.import(join(rootDir, extension))
    const candidate = typeof loaded === 'object' && loaded !== null && 'default' in loaded
      ? (loaded as { default: unknown }).default
      : loaded
    if (typeof candidate !== 'function') throw new TypeError(`Pi extension ${extension} has no default factory function`)
    await candidate(api)
  }
}

export async function applyPiPackage(ctx: Context, options: RuntimeOptions): Promise<void> {
  if (options.manifest.schemaVersion !== 1) throw new Error(`unsupported pi2dsh manifest version ${String(options.manifest.schemaVersion)}`)
  const rootDir = fileURLToPath(options.rootUrl)
  const state: RuntimeState = {
    handlers: new Map(),
    tools: new Map(),
    commands: new Map(),
    flags: new Map(),
    notifications: [],
    activeAgents: new Set(),
    disposedAgents: new WeakSet(),
    currentSystemPrompt: '',
    eventBus: new EventEmitter(),
  }
  subscribeLifecycle(ctx, state)
  subscribeInterceptors(ctx, state)
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
  await registerPromptCommands(ctx, state, rootDir, options.manifest)
  await loadExtensions(rootDir, options.manifest, createPiApi(ctx, state))
  logger(ctx).info(`[pi2dsh] loaded ${options.manifest.package.name}: ${state.tools.size} tools, ${state.commands.size} commands, ${options.manifest.skillDirs.length} skill roots`)
}

export const runtimeInternals = {
  expandPrompt,
  normalizeToolResult,
  splitArguments,
  textBlocks,
}
