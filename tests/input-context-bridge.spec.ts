// Input/Context Bridge contracts — Pi's before_agent_start and context events
// on DSH's step seams. The tests drive the agent loop's REAL order, which is
// what makes the override land on its own turn:
//
//   inbox.claim(...)            → publishes `agent/inbox/claimed` per message
//   systemPrompt.assemble(...)  → where before_agent_start runs
//   agent/pre-step waterfall    → where the step's messages are decided
//
// (dsh-agent-loop `agent.ts`: claim, then assemble, then the pre-step
// waterfall.) Driving pre-step alone — what these tests used to do — cannot
// observe the ordering the override depends on.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CallId } from './lib/dsh-compat.js'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { applyPiPackage } from '../src/runtime.js'
import type { GeneratedRuntimeManifest } from '../src/types.js'

const cleanup: string[] = []

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__icb
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const PROBE_EXTENSION = [
  "export default function probe(pi: any) {",
  "  const record: any = ((globalThis as any).__icb ??= {})",
  "  pi.on('before_agent_start', async (event: any) => {",
  "    record.beforeAgentStart = { prompt: event.prompt, systemPrompt: event.systemPrompt }",
  "    return {",
  "      systemPrompt: 'OVERRIDDEN BY TEST',",
  "      message: { customType: 'test-bridge', content: 'bridge analysis result', display: true },",
  "    }",
  "  })",
  "  pi.on('context', async (event: any) => {",
  "    record.contextShapes = event.messages.map((m: any) => ({ role: m.role, customType: m.customType }))",
  "    return {",
  "      messages: event.messages.map((m: any) => {",
  "        if (m.role === 'custom' && m.customType === 'test-bridge') {",
  "          return { ...m, content: [{ type: 'text', text: '[prefixed] bridge analysis result' }] }",
  "        }",
  "        if (m.role === 'user') {",
  "          const content = (Array.isArray(m.content) ? m.content : []).map((b: any) =>",
  "            b.type === 'text' ? { ...b, text: b.text.replace('/tmp/x.png', '[image handled]') } : b)",
  "          return { ...m, content }",
  "        }",
  "        return m",
  "      }),",
  "    }",
  "  })",
  // Two tools, and a tool_call hook that blocks one asking to terminate and
  // the other without: Pi stops only when the WHOLE batch asked for it.
  "  pi.registerTool({ name: 'icb_terminating', description: 'blocked, asks to stop', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) })",
  "  pi.registerTool({ name: 'icb_plain', description: 'blocked, no opinion', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) })",
  "  pi.on('tool_call', async (event: any) => {",
  "    if (event.toolName === 'icb_terminating') return { block: true, reason: 'stop here', terminate: true }",
  "    if (event.toolName === 'icb_plain') return { block: true, reason: 'just blocked' }",
  "    return undefined",
  "  })",
  "  pi.registerCommand('icb-dup', { description: 'first', handler: async () => { record.command = 'first' } })",
  "  pi.registerCommand('icb-dup', { description: 'second', handler: async () => { record.command = 'second' } })",
  "}",
].join('\n')

async function mountedContext() {
  const bundle = await mkdtemp(join(tmpdir(), 'pi2dsh-icb-'))
  cleanup.push(bundle)
  await mkdir(join(bundle, 'extensions'), { recursive: true })
  await writeFile(join(bundle, 'extensions/probe.ts'), PROBE_EXTENSION)
  const manifest: GeneratedRuntimeManifest = {
    schemaVersion: 1,
    package: { name: '@pi2dsh-fixtures/input-context-probe', version: '0.0.0', source: 'fixture' },
    extensions: ['extensions/probe.ts'],
    skillDirs: [],
    prompts: [],
  }
  const plugin: Plugin.Object = {
    name: 'pi2dsh:test-input-context',
    inject: ['tools', 'systemPrompt', 'commands', 'skills'],
    async apply(ctx) {
      await applyPiPackage(ctx, { rootUrl: pathToFileURL(`${bundle}/`), manifest })
    },
  }
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(plugin)
  await new Promise(resolve => setTimeout(resolve, 25))

  const typedCtx = ctx as unknown as {
    sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
    agents: { register(agent: Record<string, unknown>): () => void }
    commands: { execute(agent: never, input: string, images: readonly never[], signal: AbortSignal): Promise<{ result: { kind: string } } | undefined> }
    systemPrompt: { assemble(input?: Record<string, unknown>): Promise<Record<string, unknown>> }
    tools: { execute(input: Record<string, unknown>): Promise<{ isError: boolean }> }
  }
  const session = typedCtx.sessions.create(SessionId('pi2dsh-icb'), {
    meta: { createdAt: Date.now(), cwd: bundle },
  })
  const agent = { id: session.id, session, options: {}, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
  typedCtx.agents.register(agent)
  return { ctx, typedCtx, agent }
}

describe('input/context bridge in the real DSH runtime', () => {
  /** One step of the loop's real sequence: claim → assemble → pre-step. */
  async function driveStep(
    ctx: Context,
    typedCtx: { systemPrompt: { assemble(context: unknown): Promise<unknown> } },
    agent: unknown,
    entering: unknown[],
    turn = 1,
  ): Promise<{ decision: { kind: string, messages: Array<{ content: Array<{ type: string, text?: string }>, source: Record<string, unknown> }> }, assembly: unknown }> {
    const signal = new AbortController().signal
    const events = agentEvents(ctx, agent as never) as unknown as {
      emit(name: string, payload: Record<string, unknown>): void
      waterfall(name: string, payload: Record<string, unknown>, terminal: () => Promise<unknown>): Promise<never>
    }
    for (const message of entering) events.emit('agent/inbox/claimed', { agent, message, turn })
    const assembly = await typedCtx.systemPrompt.assemble({ agent, signal })
    const decision = await events.waterfall(
      'agent/pre-step',
      { turn, step: 1, signal },
      async () => ({ kind: 'enter', messages: entering }),
    ) as unknown as { kind: string, messages: Array<{ content: Array<{ type: string, text?: string }>, source: Record<string, unknown> }> }
    return { decision, assembly }
  }

  it('runs before_agent_start during the assembly with the real prompt, injects the custom message, and applies the context transform', async () => {
    const { ctx, typedCtx, agent } = await mountedContext()
    const entering = createUserMessage({
      content: [{ type: 'text', text: 'What color fills /tmp/x.png ?' }],
      source: { kind: 'user' },
    })
    const { decision } = await driveStep(ctx, typedCtx as never, agent, [entering])
    const _unused = (agentEvents(ctx, agent as never) as unknown as {
      waterfall?: unknown
    })
    void _unused

    const record = (globalThis as Record<string, unknown>).__icb as {
      beforeAgentStart?: { prompt: string }
      contextShapes?: Array<{ role: string; customType?: string }>
    }
    // Pi saw the turn's real prompt text — not an empty assembly-time string.
    expect(record.beforeAgentStart?.prompt).toBe('What color fills /tmp/x.png ?')
    // The context event saw both the user message and the custom identity.
    expect(record.contextShapes).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'custom', customType: 'test-bridge' }),
    ]))

    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(2)
    const user = decision.messages[0]!
    const custom = decision.messages[1]!
    // The context transform rewrote the step's user message in place.
    expect(user.content[0]?.text).toBe('What color fills [image handled] ?')
    // The injected message entered with Pi's custom identity and the prefix.
    expect(custom.source).toMatchObject({ kind: 'plugin', piCustomType: 'test-bridge' })
    expect(custom.content[0]?.text).toBe('[prefixed] bridge analysis result')
  })

  it("applies the returned systemPrompt to the assembly of its OWN turn", async () => {
    const { ctx, typedCtx, agent } = await mountedContext()
    const hello = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
    // The assembly this step actually sends carries the override. Running the
    // Pi event on the later pre-step waterfall left this assembly with the
    // base prompt and the override applied to the following turn instead.
    const { assembly } = await driveStep(ctx, typedCtx as never, agent, [hello])
    expect(renderPrompt(assembly as never)).toContain('OVERRIDDEN BY TEST')
  })

  it("honours Pi's batch rule for terminate: all blocked-and-terminating, or the turn continues", async () => {
    const { ctx, typedCtx, agent } = await mountedContext()
    const events = agentEvents(ctx, agent as never) as unknown as {
      emit(name: string, payload: Record<string, unknown>): void
      waterfall(name: string, payload: Record<string, unknown>, terminal: () => Promise<unknown>): Promise<{ kind: string }>
    }
    const signal = new AbortController().signal
    const step = async (): Promise<{ kind: string }> => events.waterfall(
      'agent/pre-step',
      { turn: 1, step: 2, signal },
      async () => ({ kind: 'enter', messages: [] }),
    )
    const call = async (name: string): Promise<unknown> => typedCtx.tools.execute({
      signal, callId: CallId(`terminate-${name}`), name, arguments: {}, agent: agent as never,
    })

    // One call, blocked with terminate → the whole batch asked to stop.
    await call('icb_terminating')
    expect((await step()).kind).toBe('reject')

    // A batch where one call did NOT ask to terminate keeps the turn going —
    // this is the half a per-call translation gets wrong.
    await call('icb_terminating')
    await call('icb_plain')
    expect((await step()).kind).toBe('enter')

    // And a batch with no Pi opinion at all is untouched.
    expect((await step()).kind).toBe('enter')
  })

  it("keeps Pi's same-name registerCommand replacement: the second handler wins without aborting the package", async () => {
    const { typedCtx, agent } = await mountedContext()
    const signal = new AbortController().signal
    const outcome = await typedCtx.commands.execute(agent as never, '/icb-dup', [], signal)
    expect(outcome?.result.kind).toBe('success')
    const record = (globalThis as Record<string, unknown>).__icb as { command?: string }
    expect(record.command).toBe('second')
  })
})
