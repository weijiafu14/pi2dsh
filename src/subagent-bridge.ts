import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'

type UnknownRecord = Record<string, unknown>
type PiSessionEventHandler = (event: UnknownRecord) => void

// Pi's public AgentSession surface, driven by a REAL DSH agent created
// through ctx.agents — the host loop's registered factory builds the child
// session and drives its turns. The bridge owns no model loop of its own:
// in a composition without the loop/model runtime (e.g. the credential-less
// black-box probe), creation fails with an explicit message instead of
// pretending a subagent ran.
//
// Surface covered is the set the ecosystem's subagent packages actually
// consume (verified against @tintinweb/pi-subagents): prompt, steer, abort,
// subscribe, messages, setSessionName, getSessionStats, bindExtensions,
// getAllTools/getActiveToolNames/setActiveToolsByName, and the
// agent.beforeToolCall hook slot (wired to DSH's tools/pre-execute seam).

export interface SubagentHost {
  cordis: Context
  cwd(): string
  parentSessionId(): string | undefined
  /** The delegating parent's delegation depth (DSH's recursion budget); 0 for a top-level parent. */
  parentDelegationDepth(): number
  piContentToDsh(content: unknown): Promise<ContentBlock[]>
  deliver(agent: UnknownRecord, message: unknown, mode: 'inject' | 'steer' | 'followup'): void
  messageFromSessionEvent(event: UnknownRecord): UnknownRecord | undefined
  messageSource: string
  /** The Pi package that asked for the child, used to label it in DSH's catalog. */
  packageName?: string
}

export interface CreateAgentSessionOptions {
  cwd?: string
  tools?: unknown[]
  customTools?: unknown[]
  model?: unknown
  thinkingLevel?: unknown
  [key: string]: unknown
}

interface BeforeToolCallDecision {
  block?: boolean
  reason?: string
}

interface PiSubagentFacade {
  beforeToolCall?: (
    context: { toolCall: { name: string, id: string, arguments: unknown } },
    signal: AbortSignal | undefined,
  ) => Promise<BeforeToolCallDecision | undefined> | BeforeToolCallDecision | undefined
  /** Pi's AgentState — the same object `session.state` returns. */
  state?: UnknownRecord
}

let subagentSerial = 0

/** Flatten a Pi message's content to text for transcript seeding. */
function piMessageText(message: UnknownRecord): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      const record = block as UnknownRecord | undefined
      if (record?.type === 'text' && typeof record.text === 'string') return record.text
      if (record?.type === 'toolCall' && typeof record.name === 'string') {
        return `(tool ${record.name})`
      }
      return ''
    })
    .filter(text => text.length > 0)
    .join('\n')
}

export class PiBridgedAgentSession {
  readonly agent: PiSubagentFacade = {}
  readonly messages: UnknownRecord[] = []
  // Transcript assigned through Pi's public `state.messages` setter and not
  // yet carried into the child's durable log (see #state).
  #seed: UnknownRecord[] = []

  readonly #host: SubagentHost
  readonly #handle: { agent: UnknownRecord, dispose(): Promise<void> }
  readonly #session: UnknownRecord
  readonly #tools: unknown[]
  readonly #subscribers = new Set<PiSessionEventHandler>()
  readonly #disposers: Array<() => void> = []
  #activeToolNames: string[]
  #state!: UnknownRecord
  #model: unknown
  #streaming = false
  #pendingToolCalls = new Set<string>()
  #sessionName = ''
  #turns = 0
  #aborted = false

  constructor(
    host: SubagentHost,
    handle: { agent: UnknownRecord, dispose(): Promise<void> },
    tools: unknown[],
  ) {
    this.#host = host
    this.#handle = handle
    this.#session = (handle.agent as { session?: UnknownRecord }).session ?? {}
    this.#tools = tools
    this.#activeToolNames = tools
      .map(tool => (tool as { name?: unknown } | undefined)?.name)
      .filter((name): name is string => typeof name === 'string')

    const cordis = host.cordis as unknown as {
      on(name: string, callback: (...args: any[]) => unknown): () => void
    }
    // Project this child session's durable events into Pi AgentSessionEvents.
    const offEvents = cordis.on('session/event', (session: UnknownRecord, event: UnknownRecord) => {
      if (session !== this.#session) return
      this.#project(event)
    })
    // Pi packages assign session.agent.beforeToolCall to gate the subagent's
    // tool calls; DSH's pre-execute seam is the same decision point.
    const offPre = cordis.on('tools/pre-execute', async (
      exec: { agent?: unknown, name: string, callId: string, arguments: unknown },
      next: () => Promise<UnknownRecord>,
    ): Promise<UnknownRecord> => {
      if (exec.agent !== this.#handle.agent || this.agent.beforeToolCall === undefined) return next()
      const decision = await this.agent.beforeToolCall(
        { toolCall: { name: exec.name, id: exec.callId, arguments: exec.arguments } },
        undefined,
      )
      if (decision?.block === true) {
        return { kind: 'deny', reason: decision.reason ?? `Tool "${exec.name}" is not available to this subagent.` }
      }
      return next()
    })
    this.#disposers.push(offEvents, offPre)
    // Pi's AgentSession exposes ONE AgentState object as both `session.state`
    // and `session.agent.state` (agent-session.ts: `get state() { return
    // this.agent.state }`). `messages` is a PUBLIC settable member of
    // AgentState, and packages seed a child transcript by assigning it
    // (pi-btw builds its side thread that way). DSH history is an append-only
    // durable log, so an assignment cannot rewrite history: the assigned
    // transcript is carried into the child with the next prompt instead
    // (documented in compatibility.ts).
    const session = this
    this.#state = {
      get systemPrompt(): string { return '' },
      get model(): unknown { return session.#model },
      get thinkingLevel(): string { return 'off' },
      get tools(): unknown[] { return [...session.#tools] },
      set tools(_next: unknown[]) { /* DSH owns the child's tool scope */ },
      get messages(): UnknownRecord[] { return [...session.messages] },
      set messages(next: UnknownRecord[]) { session.#assignTranscript(next) },
      get isStreaming(): boolean { return session.#streaming },
      get pendingToolCalls(): ReadonlySet<string> { return new Set(session.#pendingToolCalls) },
    } as unknown as UnknownRecord
    this.agent.state = this.#state
  }

  /** Pi's AgentState projection, shared by `session.state` and `session.agent.state`. */
  get state(): UnknownRecord {
    return this.#state
  }

  /**
   * Pi's `state.messages = …` assignment. Messages already present in this
   * child's projection stay as they are (they are durable); anything new is
   * queued and delivered with the next prompt so the child model really sees
   * the transcript the package seeded.
   */
  #assignTranscript(next: readonly UnknownRecord[]): void {
    const identity = (message: UnknownRecord): string => JSON.stringify([message.role, message.content])
    const known = new Set(this.messages.map(identity))
    this.#seed = next.filter(message => !known.has(identity(message)))
    for (const message of this.#seed) this.messages.push(message)
  }

  #project(event: UnknownRecord): void {
    const type = event.type
    const emit = (piEvent: UnknownRecord): void => {
      for (const handler of [...this.#subscribers]) {
        try {
          handler(piEvent)
        } catch {
          // A broken subscriber must not sever the projection for the rest.
        }
      }
    }
    if (type === 'turn/start') {
      this.#streaming = true
      emit({ type: 'turn_start', turnIndex: Number((event.data as UnknownRecord).turn ?? 1) - 1 })
    }
    if (type === 'request/header') {
      // The route this child is actually calling, in Pi Model shape.
      const config = ((event.data as UnknownRecord).config ?? {}) as UnknownRecord
      if (typeof config.model === 'string') {
        this.#model = { id: config.model, provider: String(config.provider ?? '') }
      }
    }
    if (type === 'tools/result' || type === 'tool/result') {
      const data = event.data as UnknownRecord
      this.#pendingToolCalls.delete(String(data.callId ?? ''))
    }
    if (type === 'tool/call') {
      const data = event.data as UnknownRecord
      this.#pendingToolCalls.add(String(data.callId ?? ''))
      let args: unknown = {}
      try {
        args = JSON.parse(String(data.arguments ?? '{}'))
      } catch {
        args = {}
      }
      emit({ type: 'tool_execution_start', toolCallId: data.callId, toolName: data.name, args })
    }
    if (type === 'assistant/chunk') {
      const chunk = ((event.data as UnknownRecord).chunk ?? {}) as UnknownRecord
      const delta = typeof chunk.text === 'string' ? chunk.text : typeof chunk.delta === 'string' ? chunk.delta : ''
      emit({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: delta }] },
        assistantMessageEvent: { type: 'text_delta', delta, ...chunk },
      })
    }
    const message = this.#host.messageFromSessionEvent(event)
    if (message !== undefined) {
      this.messages.push(message)
      emit({ type: 'message_start', message })
      emit({ type: 'message_end', message })
    }
    if (type === 'turn/end') {
      this.#turns += 1
      this.#streaming = false
      this.#pendingToolCalls.clear()
      emit({ type: 'turn_end', turnIndex: Number((event.data as UnknownRecord).turn ?? 1) - 1, message: { role: 'assistant', content: [] }, toolResults: [] })
    }
  }

  subscribe(handler: PiSessionEventHandler): () => void {
    this.#subscribers.add(handler)
    return () => this.#subscribers.delete(handler)
  }

  async prompt(text: string): Promise<void> {
    // Carry a seeded transcript (Pi's `state.messages = …`) into the child's
    // durable log before the prompt it is meant to precede.
    if (this.#seed.length > 0) {
      const seeded = this.#seed
      this.#seed = []
      const rendered = seeded
        .map(message => {
          const role = String(message.role ?? 'user')
          const content = piMessageText(message)
          return content.length === 0 ? undefined : `[${role}]: ${content}`
        })
        .filter((line): line is string => line !== undefined)
      if (rendered.length > 0) {
        const seedBlocks = await this.#host.piContentToDsh([{
          type: 'text',
          text: `<prior-conversation>\n${rendered.join('\n\n')}\n</prior-conversation>`,
        }])
        this.#host.deliver(this.#handle.agent, createUserMessage({
          content: seedBlocks,
          source: { kind: 'plugin', plugin: this.#host.messageSource },
        }), 'inject')
      }
    }
    const blocks = await this.#host.piContentToDsh([{ type: 'text', text: String(text) }])
    const cordis = this.#host.cordis as unknown as {
      on(name: string, callback: (...args: any[]) => unknown): () => void
    }
    const completed = new Promise<void>(resolve => {
      const off = cordis.on('session/event', (session: UnknownRecord, event: UnknownRecord) => {
        if (session !== this.#session) return
        if (event.type === 'turn/end') {
          off()
          resolve()
        }
      })
      this.#disposers.push(off)
    })
    this.#host.deliver(this.#handle.agent, createUserMessage({
      content: blocks,
      source: { kind: 'plugin', plugin: this.#host.messageSource },
    }), 'followup')
    await completed
  }

  steer(text: string): void {
    void this.#host.piContentToDsh([{ type: 'text', text: String(text) }]).then(blocks => {
      this.#host.deliver(this.#handle.agent, createUserMessage({
        content: blocks,
        source: { kind: 'plugin', plugin: this.#host.messageSource },
      }), 'steer')
    })
  }

  abort(): void {
    this.#aborted = true
    // Pi's session.abort() is idempotent and safe at any lifecycle point;
    // DSH's Agent.cancel throws once the agent is disposed, so contain it.
    try {
      const cancel = (this.#handle.agent as { cancel?: (reason: UnknownRecord) => void }).cancel
      cancel?.({ kind: 'hook', reason: 'pi2dsh subagent abort()' })
    } catch {
      // already disposed — nothing left to abort
    }
  }

  setSessionName(name: string): void {
    this.#sessionName = String(name)
  }

  getSessionName(): string {
    return this.#sessionName
  }

  getSessionStats(): UnknownRecord {
    return { turns: this.#turns, messages: this.messages.length, aborted: this.#aborted }
  }

  getAllTools(): unknown[] {
    return [...this.#tools]
  }

  getActiveToolNames(): string[] {
    return [...this.#activeToolNames]
  }

  setActiveToolsByName(names: string[]): void {
    this.#activeToolNames = names.filter(name => typeof name === 'string')
  }

  async bindExtensions(_bindings: UnknownRecord = {}): Promise<void> {
    // The parent pi2dsh runtime already owns extension binding for the host
    // composition; a child session shares those registrations. Kept as an
    // accepted no-op so Pi's construction sequence proceeds unchanged.
  }

  async dispose(): Promise<void> {
    for (const dispose of this.#disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // Disposal is best-effort teardown; the handle dispose below decides.
      }
    }
    this.#subscribers.clear()
    await this.#handle.dispose()
  }
}

/**
 * The name DSH's own child catalog shows for a side thread. Pi packages rarely
 * label a child, so the package that started it is the honest fallback: with
 * several Pi packages installed, their threads stay apart in one list.
 * @param requested - a label the calling package supplied, if any.
 * @param packageName - the Pi package the call came from.
 */
export function childLabel(requested: unknown, packageName: string | undefined): string {
  if (typeof requested === 'string' && requested.trim().length > 0) return requested.trim().slice(0, 80)
  const owner = packageName?.trim()
  return owner === undefined || owner.length === 0 ? 'Pi side conversation' : `${owner} side conversation`
}

export async function createBridgedAgentSession(
  host: SubagentHost,
  options: CreateAgentSessionOptions,
): Promise<{ session: PiBridgedAgentSession }> {
  // ctx.get() resolves the service without an inject declaration — the bridge
  // is constructed from arbitrary extension call sites, not a fiber of its own.
  const agents = (host.cordis as unknown as { get(name: string): unknown }).get('agents') as
    | { create?: (options: UnknownRecord) => Promise<{ agent: UnknownRecord, dispose(): Promise<void> }> }
    | undefined
  if (agents?.create === undefined) {
    throw new Error('pi2dsh: createAgentSession() needs the DSH agent registry in the host composition')
  }
  subagentSerial += 1
  const sessionId = `pi2dsh-sub-${Date.now().toString(36)}-${subagentSerial}`
  let handle
  try {
    // A Pi model object on the options routes the child agent: DSH's
    // agentOptions carry the provider route and model id the child's loop
    // will call (reviewer sessions, model division of labor).
    const requestedModel = options.model as { provider?: unknown, id?: unknown } | undefined
    // Pi's createAgentSession carries the caller's behavior contract on two
    // public surfaces: a plain systemPrompt option, or a ResourceLoader whose
    // getSystemPrompt() yields the override (guardian builds its reviewer
    // this way: DefaultResourceLoader with systemPromptOverride). An override
    // REPLACES the host's default prompt in Pi, and appendSystemPrompt
    // entries follow it.
    const loader = options.resourceLoader as {
      getSystemPrompt?(): string | undefined
      getAppendSystemPrompt?(): string[]
    } | undefined
    const overrideText = typeof options.systemPrompt === 'string' && options.systemPrompt.length > 0
      ? options.systemPrompt
      : (typeof loader?.getSystemPrompt === 'function' ? loader.getSystemPrompt() : undefined)
    const appendTexts = (typeof loader?.getAppendSystemPrompt === 'function' ? loader.getAppendSystemPrompt() : [])
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
    const systemPrompt = overrideText !== undefined && overrideText.length > 0
      ? [overrideText, ...appendTexts].join('\n\n')
      : undefined
    handle = await agents.create({
      sessionId,
      meta: {
        cwd: typeof options.cwd === 'string' ? options.cwd : host.cwd(),
        origin: 'subagent',
        // DSH's durable recursion budget (childSessionMeta semantics): the
        // child persists parent depth + 1 so resumed children cannot delegate
        // as if they were top-level.
        delegationDepth: host.parentDelegationDepth() + 1,
        ...(host.parentSessionId() !== undefined ? { parentSession: host.parentSessionId() } : {}),
      },
      ...(typeof requestedModel?.id === 'string' && requestedModel.id.length > 0
        ? {
            agentOptions: {
              model: requestedModel.id,
              ...(typeof requestedModel.provider === 'string' && requestedModel.provider.length > 0
                ? { provider: requestedModel.provider }
                : {}),
            },
          }
        : {}),
    })
    // Registered through the child's own Agent.ctx: ctx.get() returns a
    // caller-bound service view, so the section lands in this agent's scope
    // layer (dsh-scope kScope tag on Agent.ctx) and unwinds on disposal —
    // never visible to the parent or sibling sessions. `complete: true` is
    // DSH's sole-prompt-section semantics, matching Pi's systemPromptOverride
    // replacing the default prompt.
    if (systemPrompt !== undefined) {
      const agentCtx = (handle.agent as { ctx?: { get?(name: string): unknown } }).ctx
      const prompt = (typeof agentCtx?.get === 'function' ? agentCtx.get('systemPrompt') : undefined) as
        | { section(input: { name: string, order: number, text: string, complete?: boolean }): unknown }
        | undefined
      if (prompt === undefined) {
        throw new Error('pi2dsh: createAgentSession() got a system prompt but the DSH composition has no systemPrompt service to carry it')
      }
      prompt.section({ name: 'pi2dsh:subagent-system-prompt', order: -1_000_000, text: systemPrompt, complete: true })
    }
  } catch (error) {
    throw new Error(
      'pi2dsh: subagent creation needs the DSH host loop (model runtime) to provide the agent factory; '
      + `this composition cannot run one (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const tools = [
    ...(Array.isArray(options.tools) ? options.tools : []),
    ...(Array.isArray(options.customTools) ? options.customTools : []),
  ]
  // DSH identifies session-backed children by ONE durable event appended
  // inside the child's own log: `subagent/descriptor` (dsh-subagent). Without
  // it the host's child catalog reports the session as a `diagnostic` row
  // ("corrupt") instead of a child, so nothing can list or reopen it. The
  // event type is DSH's own — this is the official identity channel, not a
  // vocabulary of ours.
  const childSession = (handle.agent as { session?: { append?(type: string, data: unknown): unknown } }).session
  if (typeof childSession?.append === 'function') {
    try {
      childSession.append('subagent/descriptor', {
        version: 2,
        mode: 'continuable',
        provider: 'pi2dsh',
        label: childLabel(options.label, host.packageName),
      })
    } catch (error) {
      // A host without the subagent vocabulary rejects the type; the child
      // still runs, it just will not be enumerable. Never fatal, never silent.
      host.cordis.logger?.warn?.(
        `[pi2dsh] child session could not record its subagent identity: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { session: new PiBridgedAgentSession(host, handle, tools) }
}
