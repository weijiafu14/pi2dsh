// The P0 contract this pins: a Pi package's createAgentSession() child runs
// with its TOOLS — the allowlist as an official scoped restriction over the
// host's global tools, and customTools registered in the child Agent's own
// scope — all through DSH's creator-exclusive agents.create({ setup }) seam.
// Regression context: the child used to receive its tools only on the Pi
// façade, so the real DSH agent's requests carried no tools at all and the
// model wrote "bash invocations" as plain text.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from './lib/dsh-compat.js'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { applyPiPackage } from '../src/runtime.js'

type UnknownRecord = Record<string, unknown>

const cleanup: string[] = []
afterEach(async () => {
  delete (globalThis as UnknownRecord).__pi2dshChildSession
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const CHILD_SPAWN_PROBE = `
  import { createAgentSession } from '@earendil-works/pi-coding-agent'
  export default function probe(pi: any) {
    pi.registerCommand('cap-spawn-child', {
      description: 'Create a child session with an allowlist and a custom tool.',
      handler: async (_args: string, ctx: any) => {
        const created = await createAgentSession({
          tools: ['host_probe', 'read'],
          customTools: [{
            name: 'child_probe',
            description: 'A tool that exists only inside this child.',
            parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
            execute: async (_id: string, args: any) => ({ content: [{ type: 'text', text: 'CHILD_TOOL_OK:' + args.word }] }),
          }],
        })
        ;(globalThis as any).__pi2dshChildSession = created.session
        ctx.ui.notify('spawned', 'info')
      },
    })
  }
`

describe('createAgentSession child tools on a real DSH composition', () => {
  it('grants the child its allowlisted globals and scoped custom tools, isolated from the parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-child-tools-'))
    cleanup.push(root)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'probe.ts'), CHILD_SPAWN_PROBE)

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    // The child must be a REAL registry agent: the whole point is what its
    // scope's visibility resolver answers.
    const { default: LlmRuntime } = await import('@deepseek-ai/dsh-llm')
    const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
    const { default: AgentLoop } = await import('@deepseek-ai/dsh-agent-loop')
    await ctx.plugin(LlmRuntime as never, {} as never)
    await ctx.plugin(AgentRegistry as never, {} as never)
    await ctx.plugin(AgentLoop as never, {} as never)

    // Two real global tools: one on the child's allowlist, one not.
    const globalTool = (name: string) => ({
      name,
      description: `global ${name}`,
      parameters: { type: 'object', properties: {} },
      output: { schema: {}, render: () => [], presentationMeta: () => undefined as never },
      isConcurrencySafe: () => false,
      execute: async () => ({ content: [{ type: 'text', text: `${name} ran` }] }),
    })
    const tools = (ctx as unknown as {
      tools: {
        register(definition: UnknownRecord): () => void
        schemas(agent: unknown): ReadonlyArray<{ name: string }>
        execute(request: UnknownRecord): Promise<{ content: Array<{ text?: string }> }>
      }
    }).tools
    tools.register(globalTool('host_probe'))
    tools.register(globalTool('other_tool'))

    const children: UnknownRecord[] = []
    ;(ctx as unknown as { on(event: string, callback: (payload: { agent: UnknownRecord }) => void): unknown })
      .on('agent/created', payload => { children.push(payload.agent) })

    await applyPiPackage(ctx, {
      rootUrl: pathToFileURL(`${root}/`),
      manifest: {
        schemaVersion: 1,
        package: { name: 'pi-child-tools-probe', version: '1.0.0', source: 'test-fixture' },
        extensions: ['probe.ts'],
        skillDirs: [],
        prompts: [],
      },
    })

    const registry = (ctx as unknown as {
      agents: { create(options: UnknownRecord): Promise<{ agent: UnknownRecord }> }
    }).agents
    const { agent: parent } = await registry.create({ sessionId: SessionId('pi2dsh-child-tools-parent') })

    const outcome = await (ctx as unknown as {
      commands: { execute(agent: never, input: string, images: readonly never[], signal: AbortSignal): Promise<unknown> }
    }).commands.execute(parent as never, '/cap-spawn-child', [], new AbortController().signal)
    expect(outcome).toBeDefined()

    const child = children.find(agent => agent !== parent)
    expect(child).toBeDefined()

    // The child's REAL visibility: allowlisted global + scoped custom, and
    // nothing else. The parent keeps both globals and never sees the custom.
    const childNames = tools.schemas(child).map(schema => schema.name)
    expect(childNames).toContain('child_probe')
    expect(childNames).toContain('host_probe')
    expect(childNames).not.toContain('other_tool')
    const parentNames = tools.schemas(parent).map(schema => schema.name)
    expect(parentNames).toContain('host_probe')
    expect(parentNames).toContain('other_tool')
    expect(parentNames).not.toContain('child_probe')

    // The custom tool really EXECUTES through the DSH pipeline (argument
    // validation included) inside the child's scope.
    const result = await tools.execute({
      signal: new AbortController().signal,
      callId: CallId('child-tool-run'),
      name: 'child_probe',
      arguments: { word: 'sesame' },
      agent: child,
    })
    expect(result.content.map(block => block.text).join('')).toContain('CHILD_TOOL_OK:sesame')

    // The Pi façade reads the child's real toolset, and
    // setActiveToolsByName REPLACES the restriction (no stale intersection:
    // were the creation-time allowlist still active, other_tool could never
    // appear).
    const session = (globalThis as UnknownRecord).__pi2dshChildSession as {
      getActiveToolNames(): string[]
      setActiveToolsByName(names: string[]): void
    }
    expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(['child_probe', 'host_probe']))
    session.setActiveToolsByName(['other_tool'])
    const renamed = tools.schemas(child).map(schema => schema.name)
    expect(renamed).toContain('other_tool')
    expect(renamed).not.toContain('host_probe')
    expect(renamed).toContain('child_probe')
  })
})
