import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createBridgedAgentSession, type SubagentHost } from '../src/subagent-bridge.js'

type UnknownRecord = Record<string, unknown>

function makeHost(ctx: Context, deliveries: Array<{ mode: string, message: unknown }>): SubagentHost {
  return {
    cordis: ctx,
    cwd: () => process.cwd(),
    parentSessionId: () => 'parent-session',
    piContentToDsh: async content => (Array.isArray(content) ? content : []) as never,
    deliver: (_agent, message, mode) => {
      deliveries.push({ mode, message })
    },
    messageFromSessionEvent: event => {
      if (event.type === 'assistant/message') {
        return { role: 'assistant', content: [{ type: 'text', text: String((event.data as UnknownRecord).text ?? '') }] }
      }
      return undefined
    },
    messageSource: 'pi2dsh:test',
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
        return {
          agent: { id: String(createOptions.sessionId), session: {}, ...(agentCtx === undefined ? {} : { ctx: agentCtx }) },
          dispose: async () => {},
        }
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
})
