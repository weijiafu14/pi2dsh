import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CallId } from './lib/dsh-compat.js'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

/**
 * Mechanism probe for the single-path per-Agent architecture, run against the
 * exact stock npm packages the engine pins (dsh-agent/agent-loop/... rc.8).
 *
 * Pillars under test:
 *  1. A root (host-level) `agent/created` listener fires for every registry
 *     creation, synchronously before `agents.create()` resolves, and hands the
 *     listener the published Agent with its public `agent.ctx` scope.
 *  2. Asynchronous mounting into `agent.ctx` (the Pi-package case) started from
 *     that listener lands agent-scoped: tools registered there are visible to
 *     prompt assembly for that agent and unwind on agent disposal.
 *  3. A root `system-prompt/assemble` waterfall listener runs inside the scoped
 *     assemble dispatch, receives `context.agent`, and can await the mount's
 *     readiness — guaranteeing the first assembly never races the mount.
 *  4. A root `tools/pre-execute` waterfall listener runs before execution with
 *     the calling agent, and is awaited.
 *  5. Two live agents own two independent instances; disposing one leaves the
 *     other untouched (the multi-Agent isolation the old host-singleton broke).
 */

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

interface LooseAgent {
  ctx: Context & {
    tools: { register(definition: Record<string, unknown>): () => void }
  }
  id?: unknown
}

async function buildRuntime(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt as never, { includeHarnessIdentity: false } as never)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LlmRuntime as never, {} as never)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop as never, {} as never)
  return ctx
}

function probeTool(name: string, log: string[]): Record<string, unknown> {
  return {
    name,
    description: `probe tool ${name}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {},
      render: () => [],
    },
    async execute() {
      log.push(`executed:${name}`)
      return { ok: true }
    },
  }
}

describe('per-agent mount on stock rc.8 core events and waterfalls', () => {
  it('mounts one runtime per agent from agent/created and gates first assembly on readiness', async () => {
    const ctx = await buildRuntime()
    const log: string[] = []
    interface MountState {
      ready: Promise<void>
      schemas: Array<{ name: string, description: string, parameters: unknown }>
    }
    const mounts = new Map<object, MountState>()

    // Pillar 1: root listener, async per-agent mount kicked off inside it.
    ;(ctx as never as {
      on(name: string, listener: (payload: { agent: LooseAgent }) => void): void
    }).on('agent/created', ({ agent }) => {
      log.push('created')
      const state: MountState = { schemas: [], ready: Promise.resolve() }
      const toolName = `pi_probe_${mounts.size + 1}`
      state.ready = (async () => {
        // Simulated Pi package load: slow enough that an ungated first
        // assembly would provably miss the tool.
        await delay(80)
        agent.ctx.tools.register(probeTool(toolName, log))
        state.schemas.push({
          name: toolName,
          description: `probe tool ${toolName}`,
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        })
        log.push('mounted')
      })()
      mounts.set(agent as never, state)
    })
    ;(ctx as never as {
      on(name: string, listener: (payload: { agent: LooseAgent, source: string }) => void): void
    }).on('agent/session-start', ({ source }) => {
      log.push(`session-start:${source}`)
    })

    // Pillar 3: root assemble gate. `assembly.tools` is snapshotted from the
    // scoped providers BEFORE this waterfall runs (stock rc.8 assemble), so a
    // mount landing during the wait patches the racing snapshot with its own
    // schemas — the same authoritative-return move the bridge already uses for
    // Pi's setActiveTools. Later assemblies see the tools through the normal
    // provider path and the patch becomes a no-op.
    ;(ctx as never as {
      on(name: string, listener: (assembly: { tools: Array<{ name: string }> }, context: { agent?: object }, next: () => Promise<unknown>) => Promise<unknown>): void
    }).on('system-prompt/assemble', async (assembly, context, next) => {
      log.push(`assemble:${context.agent !== undefined ? 'with-agent' : 'no-agent'}`)
      const state = context.agent === undefined ? undefined : mounts.get(context.agent)
      if (state !== undefined) {
        await state.ready
        const present = new Set(assembly.tools.map(tool => tool.name))
        for (const schema of state.schemas) {
          if (!present.has(schema.name)) assembly.tools.push(schema as never)
        }
      }
      return next()
    })

    // Pillar 4: root pre-execute listener, awaited, sees the calling agent.
    ;(ctx as never as {
      on(name: string, listener: (exec: { agent?: object, name: string }, next: () => Promise<unknown>) => Promise<unknown>): void
    }).on('tools/pre-execute', async (exec, next) => {
      log.push(`pre-execute:${exec.name}:${exec.agent !== undefined ? 'with-agent' : 'no-agent'}`)
      return next()
    })

    const registry = (ctx as never as {
      agents: {
        create(options: Record<string, unknown>): Promise<{ agent: LooseAgent, dispose(): Promise<void> }>
        roots?(): unknown[]
      }
    }).agents

    const a = await registry.create({ sessionId: SessionId('probe-a') })

    // Ordering facts: created + session-start(startup) both delivered before
    // create() resolved; the mount is still pending at this instant.
    expect(log).toContain('created')
    expect(log).toContain('session-start:startup')
    expect(log).not.toContain('mounted')

    // Pillar 2+3: assemble immediately — the worst-case first-turn race. The
    // gate must hold assembly until the slow mount lands its tool.
    const assemblyA = await (ctx as never as {
      systemPrompt: { assemble(context: unknown): Promise<{ tools: Array<{ name: string }> }> }
    }).systemPrompt.assemble(assembleContextFor(a.agent as never))
    expect(log).toContain('mounted')
    expect(assemblyA.tools.map(tool => tool.name)).toContain('pi_probe_1')

    // Pillar 4: execute through the runtime with the agent identity.
    const tools = (ctx as never as {
      tools: { execute(input: Record<string, unknown>): Promise<unknown> }
    }).tools
    await tools.execute({
      callId: CallId('probe-call-1'),
      signal: new AbortController().signal,
      name: 'pi_probe_1',
      arguments: {},
      agent: a.agent,
    })
    expect(log).toContain('pre-execute:pi_probe_1:with-agent')
    expect(log).toContain('executed:pi_probe_1')

    // Pillar 5: second agent gets its own instance; disposing A keeps B whole.
    const b = await registry.create({ sessionId: SessionId('probe-b') })
    const assemblyB = await (ctx as never as {
      systemPrompt: { assemble(context: unknown): Promise<{ tools: Array<{ name: string }> }> }
    }).systemPrompt.assemble(assembleContextFor(b.agent as never))
    expect(assemblyB.tools.map(tool => tool.name)).toContain('pi_probe_2')
    // Agent scoping, not global: B's assembly must not see A's instance…
    expect(assemblyB.tools.map(tool => tool.name)).not.toContain('pi_probe_1')

    await a.dispose()
    // …and after disposal A's tool is gone while B still assembles and runs.
    // Drop B's patch state first: this assembly must find pi_probe_2 through
    // the normal scoped provider path alone, proving agent.ctx registration
    // really reaches scope-filtered assembly (not just our snapshot patch).
    mounts.delete(b.agent as never)
    const assemblyB2 = await (ctx as never as {
      systemPrompt: { assemble(context: unknown): Promise<{ tools: Array<{ name: string }> }> }
    }).systemPrompt.assemble(assembleContextFor(b.agent as never))
    expect(assemblyB2.tools.map(tool => tool.name)).toContain('pi_probe_2')
    expect(assemblyB2.tools.map(tool => tool.name)).not.toContain('pi_probe_1')
    await tools.execute({
      callId: CallId('probe-call-2'),
      signal: new AbortController().signal,
      name: 'pi_probe_2',
      arguments: {},
      agent: b.agent,
    })
    expect(log).toContain('executed:pi_probe_2')

    // Registry enumeration exists for the backfill path.
    expect(typeof registry.roots).toBe('function')
    await b.dispose()
  }, 20000)
})
