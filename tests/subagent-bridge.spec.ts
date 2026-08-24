import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { runtimeInternals } from '../src/runtime.js'
import { childLabel, createBridgedAgentSession, type SubagentHost } from '../src/subagent-bridge.js'

type UnknownRecord = Record<string, unknown>

function makeHost(ctx: Context, deliveries: Array<{ mode: string, message: unknown }>): SubagentHost {
  return {
    cordis: ctx,
    cwd: () => process.cwd(),
    parentSessionId: () => 'parent-session',
    parentDelegationDepth: () => 0,
    piContentToDsh: async content => (Array.isArray(content) ? content : []) as never,
    deliver: (_agent, message, mode) => {
      deliveries.push({ mode, message })
    },
    messageFromSessionEvent: async event => {
      if (event.type === 'assistant/message') {
        return { role: 'assistant', content: [{ type: 'text', text: String((event.data as UnknownRecord).text ?? '') }] }
      }
      return undefined
    },
    messageSource: 'pi2dsh:test',
    parentAgentContext: () => undefined,
    registerChildTools: () => {},
    delegatedPolicyOverrides: () => ({}),
  }
}

describe('Pi createAgentSession bridged onto real DSH agents', () => {
  it('fails explicitly when the composition has no agent factory', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const deliveries: Array<{ mode: string, message: unknown }> = []
    // dsh-agent's registry exists only with its plugin; here ctx.agents is
    // absent entirely, the harsher of the two degraded compositions.
    await expect(createBridgedAgentSession(makeHost(ctx, deliveries), {}))
      .rejects.toThrowError(/agent registry|host loop/u)
  })

  it('creates a child through the factory, projects its durable events, and completes prompt() on turn end', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`sub-${Date.now()}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    let disposed = 0
    const cancels: unknown[] = []
    const created: UnknownRecord[] = []
    // The bridge resolves the registry through ctx.get('agents') (no inject
    // declaration at arbitrary extension call sites); route that name to the
    // mock loop factory and everything else to the real resolver.
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    const mockAgents = {
      async create(options: UnknownRecord) {
        created.push(options)
        return {
          agent: { id: session.id, session, cancel: (reason: unknown) => cancels.push(reason) },
          dispose: async () => {
            disposed += 1
          },
        }
      },
    }
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents' ? mockAgents : realGet(name)

    const deliveries: Array<{ mode: string, message: unknown }> = []
    const { session: pi } = await createBridgedAgentSession(makeHost(ctx, deliveries), { tools: [{ name: 'read' }, { name: 'bash' }] })
    expect(created[0]).toMatchObject({ meta: { origin: 'subagent', parentSession: 'parent-session' } })
    expect(pi.getActiveToolNames()).toEqual(['read', 'bash'])

    const seen: string[] = []
    pi.subscribe(event => seen.push(String((event as UnknownRecord).type)))

    const emit = (event: UnknownRecord): void => {
      ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit('session/event', session, event)
    }
    const prompted = pi.prompt('investigate this')
    // The child's turn can only begin after the prompt message is delivered;
    // wait for that delivery before replaying the durable events.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(deliveries).toHaveLength(1)
    emit({ type: 'turn/start', data: { turn: 1 } })
    emit({ type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { text: 'partial' } } })
    emit({ type: 'assistant/message', data: { turn: 1, step: 0, text: 'done' } })
    emit({ type: 'turn/end', data: { turn: 1 } })
    await prompted

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.mode).toBe('followup')
    expect(seen).toContain('turn_start')
    expect(seen).toContain('message_update')
    expect(seen).toContain('message_start')
    expect(seen).toContain('turn_end')
    expect(pi.messages.at(-1)).toMatchObject({ role: 'assistant' })
    expect(pi.getSessionStats()).toMatchObject({ turns: 1, aborted: false })

    pi.setSessionName('investigator#1')
    expect(pi.getSessionName()).toBe('investigator#1')
    pi.abort()
    expect(cancels).toHaveLength(1)
    await pi.dispose()
    expect(disposed).toBe(1)
  })

  // Pi's AgentState is public and `messages` is settable: packages seed a
  // child transcript by assigning it (pi-btw builds its side thread that
  // way), reading it back through `session.state.messages`. Both
  // `session.state` and `session.agent.state` must be the SAME object, as in
  // Pi's own AgentSession.
  it('exposes Pi\'s settable AgentState transcript and carries a seeded transcript into the child', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`seed-${Date.now()}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    const mockAgents = {
      async create() {
        return { agent: { id: session.id, session }, dispose: async () => {} }
      },
    }
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents' ? mockAgents : realGet(name)

    const deliveries: Array<{ mode: string, message: unknown }> = []
    const { session: pi } = await createBridgedAgentSession(makeHost(ctx, deliveries), { tools: [{ name: 'read' }] })
    const typed = pi as unknown as {
      state: { messages: UnknownRecord[], isStreaming: boolean, tools: unknown[] }
      agent: { state?: unknown }
      prompt(text: string): Promise<void>
      messages: UnknownRecord[]
    }

    // One shared AgentState object, exactly like Pi's AgentSession.
    expect(typed.agent.state).toBe(typed.state)
    expect(typed.state.messages).toEqual([])
    expect(typed.state.tools).toEqual([{ name: 'read' }])

    // The assignment Pi packages use.
    typed.state.messages = [
      { role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    ]
    expect(typed.state.messages).toHaveLength(2)
    expect(pi.messages).toHaveLength(2)

    const prompted = typed.prompt('follow-up question')
    await new Promise(resolve => setTimeout(resolve, 10))
    ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void })
      .emit('session/event', session, { type: 'turn/end', data: { turn: 1 } })
    await prompted

    // The seeded transcript really reached the child before its prompt.
    expect(deliveries).toHaveLength(2)
    expect(deliveries[0]?.mode).toBe('inject')
    const seedText = JSON.stringify(deliveries[0]?.message)
    expect(seedText).toContain('earlier question')
    expect(seedText).toContain('earlier answer')
    expect(seedText).toContain('prior-conversation')
    expect(deliveries[1]?.mode).toBe('followup')
    expect(JSON.stringify(deliveries[1]?.message)).toContain('follow-up question')

    // A second assignment that repeats known messages does not re-deliver them.
    typed.state.messages = [
      { role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    ]
    const again = typed.prompt('second follow-up')
    await new Promise(resolve => setTimeout(resolve, 10))
    ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void })
      .emit('session/event', session, { type: 'turn/end', data: { turn: 2 } })
    await again
    expect(deliveries).toHaveLength(3)
    expect(deliveries[2]?.mode).toBe('followup')

    await pi.dispose()
  })

  // The caller's behavior contract arrives on two public Pi surfaces; both
  // must land on the child's own systemPrompt service as a complete section
  // (Pi's systemPromptOverride replaces the default prompt).
  function makeCtxWithFactory(sections: UnknownRecord[], options?: { agentCtx?: false }): Context {
    const ctx = new Context()
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    const agentCtx = options?.agentCtx === false
      ? undefined
      : { get: (name: string) => (name === 'systemPrompt' ? { section: (input: UnknownRecord) => sections.push(input) } : undefined) }
    const mockAgents = {
      async create(createOptions: UnknownRecord) {
        const agent = { id: String(createOptions.sessionId), session: {}, ...(agentCtx === undefined ? {} : { ctx: agentCtx }) }
        // The real factory's creator-exclusive contract: setup runs on the
        // unpublished child scope before publication.
        const setup = createOptions.setup
        if (typeof setup === 'function') {
          await setup(agentCtx === undefined ? { agent } : { ...agentCtx, agent })
        }
        return { agent, dispose: async () => {} }
      },
    }
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents' ? mockAgents : realGet(name)
    return ctx
  }

  it('registers a resourceLoader systemPromptOverride as the child\'s sole prompt section (guardian\'s path)', async () => {
    const sections: UnknownRecord[] = []
    const ctx = makeCtxWithFactory(sections)
    const deliveries: Array<{ mode: string, message: unknown }> = []
    await createBridgedAgentSession(makeHost(ctx, deliveries), {
      resourceLoader: {
        getSystemPrompt: () => 'You are a reviewer. Respond with JSON only.',
        getAppendSystemPrompt: () => ['Appendix: extra rules.'],
      },
    })
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({
      name: 'pi2dsh:subagent-system-prompt',
      complete: true,
      text: 'You are a reviewer. Respond with JSON only.\n\nAppendix: extra rules.',
    })
  })

  it('registers a plain systemPrompt option the same way, taking precedence over the loader', async () => {
    const sections: UnknownRecord[] = []
    const ctx = makeCtxWithFactory(sections)
    const deliveries: Array<{ mode: string, message: unknown }> = []
    await createBridgedAgentSession(makeHost(ctx, deliveries), {
      systemPrompt: 'Direct contract.',
      resourceLoader: { getSystemPrompt: () => 'loader contract (must lose)' },
    })
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ complete: true, text: 'Direct contract.' })
  })

  it('fails loud when a contract is supplied but the child has no systemPrompt service', async () => {
    const ctx = makeCtxWithFactory([], { agentCtx: false })
    const deliveries: Array<{ mode: string, message: unknown }> = []
    await expect(createBridgedAgentSession(makeHost(ctx, deliveries), { systemPrompt: 'contract' }))
      .rejects.toThrowError(/no systemPrompt service/u)
  })

  // DSH recognises a session-backed child by ONE durable event inside the
  // child's own log: `subagent/descriptor` (the dsh-subagent vocabulary).
  // Without it the host's child catalog reports a `diagnostic` row ("corrupt")
  // and the side thread cannot be listed or reopened from the conversation.
  it("records the host's own subagent identity in the child log so DSH can list and reopen it", async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`ident-${Date.now()}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? { async create() { return { agent: { id: session.id, session }, dispose: async () => {} } } }
        : realGet(name)

    const deliveries: Array<{ mode: string, message: unknown }> = []
    const host = { ...makeHost(ctx, deliveries), packageName: 'pi-btw' }
    await createBridgedAgentSession(host, {})

    // `subagent/descriptor` belongs to @deepseek-ai/dsh-subagent, which widens
    // the core SessionEventMap through `declare module` when it is part of the
    // composition. This package does not depend on it, so the core union here
    // does not carry the name and the read is widened deliberately — the event
    // is the host's, not ours to declare.
    const descriptor = session.events.find(event => (event.type as string) === 'subagent/descriptor')
    expect(descriptor).toBeDefined()
    expect((descriptor as unknown as { data: UnknownRecord }).data).toEqual({
      version: 2,
      mode: 'continuable',
      provider: 'pi2dsh',
      label: 'pi-btw side conversation',
    })
  })

  // Pi's abort() contract: the run stops and STAYS stopped until the next
  // explicit prompt(). On DSH, a tool result reaching quiescence after the
  // cancel is waking input that opens a fresh turn — the real-machine stop
  // scenario caught a "stopped" child finishing its task in that second turn.
  // The bridge cancels every turn that opens while aborted; prompt() lifts it.
  it('keeps an aborted child quiet — a post-abort wake is re-cancelled until the next prompt()', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`quiet-${Date.now()}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    const cancels: unknown[] = []
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? {
            async create() {
              return {
                agent: { id: session.id, session, cancel: (reason: unknown) => cancels.push(reason) },
                dispose: async () => {},
              }
            },
          }
        : realGet(name)
    const deliveries: Array<{ mode: string, message: unknown }> = []
    const { session: pi } = await createBridgedAgentSession(makeHost(ctx, deliveries), {})
    const seen: string[] = []
    pi.subscribe(event => seen.push(String((event as UnknownRecord).type)))
    const emit = (event: UnknownRecord): void => {
      ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit('session/event', session, event)
    }

    pi.abort()
    expect(cancels).toHaveLength(1)
    // A late tool result wakes the driver: the opened turn is re-cancelled and
    // not projected to Pi subscribers — the aborted run stays silent. The
    // guard fires on every opening event, because a cancel issued exactly at
    // turn/start can race the driver claiming its activity and no-op.
    emit({ type: 'turn/start', data: { turn: 2 } })
    expect(cancels).toHaveLength(2)
    emit({ type: 'step/start', data: { turn: 2, step: 1 } })
    emit({ type: 'request/header', data: { turn: 2 } })
    expect(cancels).toHaveLength(4)
    expect(seen).not.toContain('turn_start')

    // Prompting again is Pi's way to restart an aborted session: turns project.
    const prompted = pi.prompt('again')
    await new Promise(resolve => setTimeout(resolve, 10))
    emit({ type: 'turn/start', data: { turn: 3 } })
    emit({ type: 'turn/end', data: { turn: 3 } })
    await prompted
    expect(seen).toContain('turn_start')
    // No further cancels once prompt() lifted the suppression.
    expect(cancels).toHaveLength(4)
    await pi.dispose()
  })

  // Pi's AgentSession exposes steer AND followUp as async faces that resolve
  // once the message is queued — pi-subagents chains `.catch` on the return
  // value directly, so anything but a Promise is a synchronous crash there.
  it('queues steer and followUp through the delivery channel and returns awaitable promises', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`queue-${Date.now()}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? {
            async create() {
              return {
                agent: { id: session.id, session, cancel: () => {} },
                dispose: async () => {},
              }
            },
          }
        : realGet(name)
    const deliveries: Array<{ mode: string, message: unknown }> = []
    const { session: pi } = await createBridgedAgentSession(makeHost(ctx, deliveries), {})

    const steered = pi.steer('change of plan')
    expect(steered).toBeInstanceOf(Promise)
    await steered
    const followed = pi.followUp('and afterwards')
    expect(followed).toBeInstanceOf(Promise)
    await followed

    expect(deliveries.map(d => d.mode)).toEqual(['steer', 'followup'])
    expect(JSON.stringify(deliveries[0]?.message)).toContain('change of plan')
    expect(JSON.stringify(deliveries[1]?.message)).toContain('and afterwards')
    await pi.dispose()
  })

  // Pi's contract fires tool_execution_end per finished call. pi-subagents
  // counts its user-facing "N tool uses" on exactly this event — before the
  // bridge emitted it, a child that really ran tools reported "0 tool uses"
  // and the parent model distrusted its own successes.
  it('projects a durable tool/result into Pi\'s tool_execution_end with the tool name and error flag', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`toolend-${Date.now()}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? { async create() { return { agent: { id: session.id, session }, dispose: async () => {} } } }
        : realGet(name)

    const deliveries: Array<{ mode: string, message: unknown }> = []
    const { session: pi } = await createBridgedAgentSession(makeHost(ctx, deliveries), {})
    const ends: UnknownRecord[] = []
    pi.subscribe(event => {
      if ((event as UnknownRecord).type === 'tool_execution_end') ends.push(event as UnknownRecord)
    })
    const emit = (event: UnknownRecord): void => {
      ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit('session/event', session, event)
    }
    emit({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' } })
    emit({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }], isError: false }],
        },
      },
    })
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ toolCallId: 'call-1', toolName: 'bash', isError: false })
    expect(JSON.stringify(ends[0]?.result)).toContain('ok')
    await pi.dispose()
  })

  // On roster-owned surfaces (dsh-tui moves every model-facing tool into the
  // agent-presets roster and disables the host-layer rows) a child that joins
  // no preset composition resolves its tools against the EMPTY global layer
  // and runs toolless. The bridge joins in the roster's official preference
  // order: inherit the parent's standing composition, else mount the default.
  function presetHarness(options: {
    parentPreset?: string
    composeFromResult?: string
    defaultPreset?: string
    rosterOnRoot?: boolean
  }) {
    const calls: Array<{ op: string, args: unknown[] }> = []
    const roster = {
      composedPreset: (target: unknown) => { calls.push({ op: 'composedPreset', args: [target] }); return options.parentPreset },
      composeFrom: (child: unknown, parent: unknown) => {
        calls.push({ op: 'composeFrom', args: [child, parent] })
        return options.composeFromResult
      },
      resolve: async (id?: string) => {
        calls.push({ op: 'resolve', args: [id] })
        if (options.defaultPreset === undefined) throw new Error('empty roster')
        return { id: options.defaultPreset }
      },
      mount: async (target: unknown, id: string) => { calls.push({ op: 'mount', args: [target, id] }) },
    }
    const ctx = new Context()
    const created: UnknownRecord[] = []
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) => {
      if (name === 'agents') {
        return {
          async create(createOptions: UnknownRecord) {
            created.push(createOptions)
            const agent = { id: 'child', session: {} }
            const setup = createOptions.setup
            if (typeof setup === 'function') await setup({ get: () => undefined, agent })
            return { agent, dispose: async () => {} }
          },
        }
      }
      if (name === 'agentPresets' && options.rosterOnRoot === true) return roster
      return realGet(name)
    }
    const parentCtx = { get: (name: string) => (name === 'agentPresets' && options.rosterOnRoot !== true ? roster : undefined) }
    return { ctx, created, calls, parentCtx }
  }

  it('joins the child to the parent\'s standing preset composition when the parent has one', async () => {
    const { ctx, created, calls, parentCtx } = presetHarness({ parentPreset: 'code', composeFromResult: 'code' })
    const deliveries: Array<{ mode: string, message: unknown }> = []
    const host = { ...makeHost(ctx, deliveries), parentAgentContext: () => parentCtx }
    await createBridgedAgentSession(host, {})
    expect(calls.some(call => call.op === 'composeFrom')).toBe(true)
    expect(calls.some(call => call.op === 'mount')).toBe(false)
    expect((created[0]?.meta as UnknownRecord).agentPreset).toBe('code')
  })

  it('mounts the roster default when the parent joined no preset (roster reachable from the root ctx)', async () => {
    const { ctx, created, calls } = presetHarness({ defaultPreset: 'standard', rosterOnRoot: true })
    const deliveries: Array<{ mode: string, message: unknown }> = []
    // No parent agent ctx at all — the roster is still reachable via the root.
    await createBridgedAgentSession(makeHost(ctx, deliveries), {})
    const mount = calls.find(call => call.op === 'mount')
    expect(mount?.args[1]).toBe('standard')
    expect((created[0]?.meta as UnknownRecord).agentPreset).toBe('standard')
  })

  it('composes nothing on a rosterless deployment, exactly as before', async () => {
    const ctx = new Context()
    const created: UnknownRecord[] = []
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? {
            async create(createOptions: UnknownRecord) {
              created.push(createOptions)
              const agent = { id: 'child', session: {} }
              if (typeof createOptions.setup === 'function') await (createOptions.setup as (c: unknown) => unknown)({ get: () => undefined, agent })
              return { agent, dispose: async () => {} }
            },
          }
        : realGet(name)
    const deliveries: Array<{ mode: string, message: unknown }> = []
    await createBridgedAgentSession(makeHost(ctx, deliveries), {})
    expect((created[0]?.meta as UnknownRecord).agentPreset).toBeUndefined()
  })

  // Pi's reopen contract: a caller hands createAgentSession a SessionManager
  // opened FROM a session file (pi-subagents' tombstone resurrect). When the
  // file is an archive this bridge minted, the durable identity it names is a
  // DSH session — the continuation binds back to THAT session through the
  // registry's official persisted-resume seam, never a lookalike create.
  function resumeHarness() {
    const ctx = new Context()
    const calls: Array<{ op: 'create' | 'resume', options: UnknownRecord }> = []
    const sessionEvents: Array<{ type: string }> = []
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) => {
      if (name !== 'agents') return realGet(name)
      const mint = async (op: 'create' | 'resume', options: UnknownRecord) => {
        calls.push({ op, options })
        const agent = {
          id: op === 'resume' ? options.resumeSessionId : options.sessionId,
          session: { id: op === 'resume' ? options.resumeSessionId : options.sessionId, append: (type: string) => { sessionEvents.push({ type }) } },
        }
        if (typeof options.setup === 'function') await (options.setup as (c: unknown) => unknown)({ get: () => undefined, agent })
        return { agent, dispose: async () => {} }
      }
      return {
        create: (options: UnknownRecord) => mint('create', options),
        resume: (options: UnknownRecord) => mint('resume', options),
      }
    }
    const host: SubagentHost = {
      ...makeHost(ctx, []),
      sessionManagerFor: session => ({ getSessionFile: () => `/ARCHIVE/${String((session as { id?: unknown }).id)}.jsonl` }),
      resumeSessionIdFor: file => (typeof file === 'string' && file.startsWith('/ARCHIVE/') && file.endsWith('.jsonl')
        ? file.slice('/ARCHIVE/'.length, -'.jsonl'.length)
        : undefined),
    }
    return { host, calls, sessionEvents }
  }

  it('reopens an archived child through the official persisted-resume seam, without a duplicate descriptor', async () => {
    const { host, calls, sessionEvents } = resumeHarness()
    const { session: pi } = await createBridgedAgentSession(host, {
      sessionManager: { getSessionFile: () => '/ARCHIVE/pi2dsh-sub-old-7.jsonl' },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.op).toBe('resume')
    expect(calls[0]?.options.resumeSessionId).toBe('pi2dsh-sub-old-7')
    // The original creation already logged subagent/descriptor; a reopen must not duplicate it.
    expect(sessionEvents.map(event => event.type)).not.toContain('subagent/descriptor')
    // The reopened child exposes its own archive identity for the NEXT reopen.
    expect((pi.sessionManager as { getSessionFile(): string }).getSessionFile()).toBe('/ARCHIVE/pi2dsh-sub-old-7.jsonl')
  })

  it('treats a genuine Pi session file (not our archive) as a fresh create', async () => {
    const { host, calls, sessionEvents } = resumeHarness()
    await createBridgedAgentSession(host, {
      sessionManager: { getSessionFile: () => '/home/user/.pi/agent/sessions/2026-01-01-abc.jsonl' },
    })
    expect(calls[0]?.op).toBe('create')
    expect(sessionEvents.map(event => event.type)).toContain('subagent/descriptor')
  })

  it('fails loud when a reopen is asked for but the registry has no persisted-resume seam', async () => {
    const { host } = resumeHarness()
    const bare = new Context()
    const realGet = (bare as unknown as { get(name: string): unknown }).get.bind(bare)
    ;(bare as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? { async create() { return { agent: { id: 'x', session: {} }, dispose: async () => {} } } }
        : realGet(name)
    await expect(createBridgedAgentSession({ ...host, cordis: bare }, {
      sessionManager: { getSessionFile: () => '/ARCHIVE/pi2dsh-sub-old-7.jsonl' },
    })).rejects.toThrowError(/persisted-resume/u)
  })

  // The archive's existence tells Pi consumers "this conversation can be
  // reopened" (existsSync is an OS call the bridge cannot intercept). When a
  // reopen fails, DSH's own verdict — the persistence list() — decides
  // whether the session is truly gone; only that POSITIVE verdict retires
  // the archive, so a composition merely lacking persistence never destroys
  // a valid identity token.
  function failingResumeHarness(verdict: boolean | undefined) {
    const { host } = resumeHarness()
    const discarded: string[] = []
    const bare = new Context()
    const realGet = (bare as unknown as { get(name: string): unknown }).get.bind(bare)
    ;(bare as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? {
            async create() { return { agent: { id: 'x', session: {} }, dispose: async () => {} } },
            async resume() { throw new Error('backend load failed') },
          }
        : realGet(name)
    const wired: SubagentHost = {
      ...host,
      cordis: bare,
      ...(verdict === undefined ? {} : { sessionGoneFromPersistence: async () => verdict }),
      discardStaleArchive: sessionId => { discarded.push(sessionId) },
    }
    return { wired, discarded }
  }

  it('retires the archive when the persistence layer positively says the session is gone', async () => {
    const { wired, discarded } = failingResumeHarness(true)
    await expect(createBridgedAgentSession(wired, {
      sessionManager: { getSessionFile: () => '/ARCHIVE/pi2dsh-sub-old-7.jsonl' },
    })).rejects.toThrowError(/no longer exists.*retired/u)
    expect(discarded).toEqual(['pi2dsh-sub-old-7'])
  })

  it('keeps the archive when the session is still listed — the failure is not "gone"', async () => {
    const { wired, discarded } = failingResumeHarness(false)
    await expect(createBridgedAgentSession(wired, {
      sessionManager: { getSessionFile: () => '/ARCHIVE/pi2dsh-sub-old-7.jsonl' },
    })).rejects.toThrowError(/may lack session persistence/u)
    expect(discarded).toEqual([])
  })

  it('keeps the archive when no persistence verdict is available — absence proves nothing', async () => {
    const { wired, discarded } = failingResumeHarness(undefined)
    await expect(createBridgedAgentSession(wired, {
      sessionManager: { getSessionFile: () => '/ARCHIVE/pi2dsh-sub-old-7.jsonl' },
    })).rejects.toThrowError(/may lack session persistence/u)
    expect(discarded).toEqual([])
  })

  // Pi's model default for a child session is the CALLER's current model. A
  // child agent with no model option fails its first prompt assembly on
  // {{model}}-keyed sections (deployment:persona) before any request is made
  // — the archive-probe child hit exactly that on the real stack.
  it('routes a child without an explicit Pi model on the parent\'s own route', async () => {
    const { host, calls } = resumeHarness()
    await createBridgedAgentSession({
      ...host,
      parentModelRoute: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
    }, {})
    expect(calls[0]?.options.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('lets an explicit Pi model on the options win over the parent route', async () => {
    const { host, calls } = resumeHarness()
    await createBridgedAgentSession({
      ...host,
      parentModelRoute: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
    }, { model: { provider: 'openai-codex', id: 'gpt-5.6-sol' } })
    expect(calls[0]?.options.agentOptions).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-sol' })
  })

  it('labels a child by the package that started it, and honours an explicit label', () => {
    expect(childLabel(undefined, 'pi-btw')).toBe('pi-btw side conversation')
    expect(childLabel('   ', 'pi-btw')).toBe('pi-btw side conversation')
    expect(childLabel('Reviewer', 'pi-btw')).toBe('Reviewer')
    // No package context (a bare bridge host) still produces an honest name.
    expect(childLabel(undefined, undefined)).toBe('Pi side conversation')
    expect(childLabel('x'.repeat(200), undefined)).toHaveLength(80)
  })
})

describe('the caller route a child inherits is the LIVE one', () => {
  // DSH's own subagent line reports this exact bug (#455, #2006): children
  // inherit the parent's CREATION-TIME AgentOptions, so a session that
  // switched models spawns children on the stale default and they fail on a
  // provider the user never configured. The bridge resolves the caller's live
  // route instead — an in-session ctx.setModel override wins over the
  // creation snapshot — so a Pi package that leaves the model to the caller
  // gets the model the caller is actually running.
  it('prefers an in-session setModel override over the creation-time snapshot', () => {
    const overrides = new WeakMap<object, { provider?: string, model?: string }>()
    const state = {
      modelOverrides: overrides,
      companionRoutes: new Map<string, string>(),
      modelCatalog: undefined,
    } as unknown as Parameters<typeof runtimeInternals.currentPiModel>[0]
    const agent = { options: { provider: 'deepseek-official', model: 'stale-default' } }

    // Before any switch: the creation snapshot is the live route.
    expect(runtimeInternals.currentPiModel(state, agent)).toMatchObject({
      id: 'stale-default', provider: 'deepseek-official',
    })

    // After the session switched models, the override is the live route.
    overrides.set(agent, { provider: 'my-gateway', model: 'switched-model' })
    expect(runtimeInternals.currentPiModel(state, agent)).toMatchObject({
      id: 'switched-model', provider: 'my-gateway',
    })
  })
})

describe('per-child thinking level and adoption', () => {
  // Pi's createAgentSession thinkingLevel is per-child request config. On DSH
  // it rides the instance's agent/request waterfall, which only covers agents
  // the instance claims — so creation must ADOPT the child (#2970/#3008-shaped
  // gap: the option used to be accepted and silently dropped, with the state
  // getter hardwired to 'off').
  async function harness(adopted: Array<{ child: unknown, level?: string }>) {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId(`think-${Date.now()}-${Math.random().toString(36).slice(2)}`), {
      meta: { createdAt: Date.now(), cwd: process.cwd() },
    })
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'agents'
        ? { async create() { return { agent: { id: session.id, session }, dispose: async () => {} } } }
        : realGet(name)
    const host: SubagentHost = {
      ...makeHost(ctx, []),
      adoptChildAgent: (child, level) => adopted.push({ child, ...(level === undefined ? {} : { level }) }),
    }
    return host
  }

  it('adopts the child with its thinking level and answers it on state', async () => {
    const adopted: Array<{ child: unknown, level?: string }> = []
    const { session: pi } = await createBridgedAgentSession(await harness(adopted), { thinkingLevel: 'high' })
    expect(adopted).toHaveLength(1)
    expect(adopted[0]?.level).toBe('high')
    expect(adopted[0]?.child).toBeDefined()
    expect((pi as unknown as { state: { thinkingLevel: string } }).state.thinkingLevel).toBe('high')
  })

  it('defaults the state thinking level to off and still adopts (waterfall membership)', async () => {
    const adopted: Array<{ child: unknown, level?: string }> = []
    const { session: pi } = await createBridgedAgentSession(await harness(adopted), {})
    expect(adopted).toHaveLength(1)
    expect(adopted[0]?.level).toBeUndefined()
    expect((pi as unknown as { state: { thinkingLevel: string } }).state.thinkingLevel).toBe('off')
  })
})

describe('the durable last-request route', () => {
  // A DSH UI or /model switch never rewrites the creation-time AgentOptions —
  // it lands in the session log as the next request/header. Reading only the
  // snapshot is the stale-inheritance bug (#455/#2006 shape); the durable
  // header is the authority between explicit Pi setModel and the snapshot.
  it('reads the last request/header in any of its observed nestings', () => {
    const route = { provider: 'work-gw', model: 'deepseek-chat' }
    for (const data of [
      { config: route },
      { header: { config: route } },
      { header: route },
    ]) {
      const session = { id: 's', events: [
        { type: 'request/header', data: { config: { provider: 'old', model: 'old-model' } } },
        { type: 'request/header', data },
      ] }
      expect(runtimeInternals.lastRequestRouteOf(session as never)).toEqual(route)
    }
    expect(runtimeInternals.lastRequestRouteOf({ id: 's', events: [] } as never)).toBeUndefined()
  })

  it('resolves by authority: setModel override, then durable header, then snapshot', () => {
    const override = { provider: 'pi-set', model: 'pi-model' }
    const durable = { provider: 'work-gw', model: 'switched' }
    const snapshot = { provider: 'deepseek-official', model: 'stale' }
    expect(runtimeInternals.resolveCallerRoute(override, durable, snapshot)).toEqual(override)
    expect(runtimeInternals.resolveCallerRoute(undefined, durable, snapshot)).toEqual(durable)
    expect(runtimeInternals.resolveCallerRoute(undefined, undefined, snapshot)).toEqual(snapshot)
    expect(runtimeInternals.resolveCallerRoute(undefined, undefined, undefined)).toBeUndefined()
  })
})
