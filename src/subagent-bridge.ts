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
  piContentToDsh(content: unknown): Promise<ContentBlock[]>
  deliver(agent: UnknownRecord, message: unknown, mode: 'inject' | 'steer' | 'followup'): void
  messageFromSessionEvent(event: UnknownRecord): UnknownRecord | undefined
  messageSource: string
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
}

let subagentSerial = 0

export class PiBridgedAgentSession {
  readonly agent: PiSubagentFacade = {}
  readonly messages: UnknownRecord[] = []

  readonly #host: SubagentHost
  readonly #handle: { agent: UnknownRecord, dispose(): Promise<void> }
  readonly #session: UnknownRecord
  readonly #tools: unknown[]
  readonly #subscribers = new Set<PiSessionEventHandler>()
  readonly #disposers: Array<() => void> = []
  #activeToolNames: string[]
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
      emit({ type: 'turn_start', turnIndex: Number((event.data as UnknownRecord).turn ?? 1) - 1 })
    }
    if (type === 'tool/call') {
      const data = event.data as UnknownRecord
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
      emit({ type: 'turn_end', turnIndex: Number((event.data as UnknownRecord).turn ?? 1) - 1, message: { role: 'assistant', content: [] }, toolResults: [] })
    }
  }

  subscribe(handler: PiSessionEventHandler): () => void {
    this.#subscribers.add(handler)
    return () => this.#subscribers.delete(handler)
  }

  async prompt(text: string): Promise<void> {
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
    const cancel = (this.#handle.agent as { cancel?: (reason: UnknownRecord) => void }).cancel
    cancel?.({ kind: 'hook', reason: 'pi2dsh subagent abort()' })
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
    handle = await agents.create({
      sessionId,
      meta: {
        cwd: typeof options.cwd === 'string' ? options.cwd : host.cwd(),
        origin: 'subagent',
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
  return { session: new PiBridgedAgentSession(host, handle, tools) }
}
