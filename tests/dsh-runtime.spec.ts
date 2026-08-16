import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { generateBundle } from '../src/generator.js'
import { applyPiPackage, runtimeInternals } from '../src/runtime.js'
import { resolvePiPackage } from '../src/source.js'
import type { GeneratedRuntimeManifest } from '../src/types.js'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const fixtureRoot = join(projectRoot, 'fixtures/complete-package')
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

async function linkRuntimeDependencies(bundle: string): Promise<void> {
  const modules = join(bundle, 'node_modules')
  await mkdir(modules, { recursive: true })
  await symlink(projectRoot, join(modules, 'pi2dsh'), 'dir')
  await symlink(join(projectRoot, 'node_modules/@earendil-works'), join(modules, '@earendil-works'), 'dir')
  await symlink(join(projectRoot, 'node_modules/typebox'), join(modules, 'typebox'), 'dir')
}

describe('generated plugin in the real DSH runtime', () => {
  it('loads one generated bundle and executes tools, policy hooks, commands, prompts, skills, and lifecycle events', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-dsh-runtime-'))
    cleanup.push(scratch)
    const bundle = join(scratch, 'bundle')
    const pkg = await resolvePiPackage(fixtureRoot)
    try {
      await generateBundle(pkg, { outDir: bundle, runtimeSpec: `file:${projectRoot}` })
    } finally {
      await pkg.dispose()
    }
    await linkRuntimeDependencies(bundle)

    const manifest = JSON.parse(await readFile(join(bundle, 'pi2dsh.manifest.json'), 'utf8')) as GeneratedRuntimeManifest
    const runtimeEdgePath = 'vendor/runtime-edge-extension.ts'
    await copyFile(join(projectRoot, 'fixtures/runtime-edge-extension.ts'), join(bundle, runtimeEdgePath))
    manifest.extensions.push(runtimeEdgePath)
    const generated: Plugin.Object = {
      name: 'pi2dsh:test-runtime-source',
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
    await ctx.plugin(LocalAttachmentStore, { dshHome: join(scratch, 'dsh-home') })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(UserQuestionService)
    ctx.userQuestions.registerProvider({
      async ask(request) {
        return {
          answers: request.questions.map(question => question.id === 'pi2dsh-input'
            ? { id: question.id, selected: [], custom: 'typed' }
            : { id: question.id, selected: [question.id === 'pi2dsh-select' ? 'beta' : 'Yes'] }),
        }
      },
    })
    ctx.systemPrompt.section({ name: 'fixture:base', order: 0, text: 'Base DSH prompt.' })
    const fiber = await ctx.plugin(generated)

    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe('Base DSH prompt.\n\nMigrated Pi system prompt hook active.')
    expect(assembly.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'pi_greet', 'pi_probe', 'pi_error', 'pi_context_probe', 'pi_mutation_probe', 'pi_post_block_probe', 'pi_api_probe',
      'pi_exec_probe', 'pi_message_probe', 'pi_ask_probe', 'pi_image_probe',
    ]))
    expect(assembly.tools.map(tool => tool.name)).not.toContain('pi_dynamic_removed')

    const signal = new AbortController().signal
    const greeting = await ctx.tools.execute({
      signal,
      callId: CallId('greet-1'),
      name: 'pi_greet',
      arguments: { name: 'Ada' },
    })
    expect(greeting.isError).toBe(false)
    expect(greeting.content).toEqual([
      { type: 'text', text: 'Hello, Ada!' },
      { type: 'text', text: 'Result passed through migrated Pi hook.' },
    ])
    expect(greeting.meta).toEqual({ greeted: 'Ada' })

    const blocked = await ctx.tools.execute({
      signal,
      callId: CallId('greet-2'),
      name: 'pi_greet',
      arguments: { name: 'blocked' },
    })
    expect(blocked.isError).toBe(true)
    expect(blocked.content).toEqual([{ type: 'text', text: 'Error: blocked by migrated Pi hook' }])

    const piError = await ctx.tools.execute({
      signal,
      callId: CallId('pi-error-1'),
      name: 'pi_error',
      arguments: {},
    })
    expect(piError.isError).toBe(true)
    expect(piError.content).toEqual([{ type: 'text', text: 'Error: PI2DSH_PI_ERROR_OK' }])

    const contextProbe = await ctx.tools.execute({
      signal,
      callId: CallId('context-probe'),
      name: 'pi_context_probe',
      arguments: { value: 'original' },
    })
    expect(contextProbe.isError).toBe(false)
    const contextValue = JSON.parse((contextProbe.content[0] as { text: string }).text) as Record<string, unknown>
    expect(contextValue).toMatchObject({
      args: { value: 'original', prepared: true },
      idle: false,
      trusted: false,
      pending: false,
      hasUI: true,
      // ui.custom resolves to undefined per Pi's own rpc-mode semantics;
      // abort still fails here because the probe agent has no cancel().
      // shutdown is absorbed (Pi's host-defined semantics) and compact is a
      // fire-and-forget trigger whose errors flow through the onError
      // callback — neither throws synchronously anymore.
      unavailable: ['abort'],
    })

    // Pi semantics: a tool_call hook mutates event.input in place and the
    // mutated arguments reach the Pi-owned tool's execute.
    const mutationProbe = await ctx.tools.execute({
      signal,
      callId: CallId('mutation-probe'),
      name: 'pi_mutation_probe',
      arguments: { value: 'original' },
    })
    expect(mutationProbe.isError).toBe(false)
    expect(mutationProbe.content[0]).toMatchObject({ type: 'text', text: 'executed with mutated' })

    const postBlockProbe = await ctx.tools.execute({
      signal,
      callId: CallId('post-block-probe'),
      name: 'pi_post_block_probe',
      arguments: {},
    })
    expect(postBlockProbe).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'blocked after execution' }],
    })

    const apiProbe = await ctx.tools.execute({ signal, callId: CallId('api-probe'), name: 'pi_api_probe', arguments: {} })
    const apiValue = JSON.parse((apiProbe.content[0] as { text: string }).text) as Record<string, unknown>
    expect(apiValue).toMatchObject({
      // Load-time session mutations still fail (no live agent yet, matching
      // Pi's own load-phase restriction); setThinkingLevel becomes the global
      // default and setModel resolves false without a live agent.
      registrationFailures: ['appendEntry', 'setSessionName', 'setLabel'],
      thinking: 'high',
    })

    const session = ctx.sessions.create(SessionId('pi2dsh-integration'), {
      meta: { createdAt: Date.now(), cwd: scratch },
    })
    const injected: unknown[] = []
    const steered: unknown[] = []
    const followedUp: unknown[] = []
    const agent = {
      id: session.id,
      session,
      ctx: undefined as unknown,
      options: {},
      inbox: {},
      status: 'idle',
      inject(message: unknown) { injected.push(message) },
      steer(message: unknown) { steered.push(message) },
      followup(message: unknown) { followedUp.push(message) },
      whenIdle: () => Promise.resolve(),
    }

    let agentScope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { agentScope = createScope(inner, agent) }, {
      inject: ['tools', 'systemPrompt'],
    }))
    agent.ctx = agentScope.ctx
    const disposeAgent = ctx.agents.register(agent as never)

    ctx.emit('agent/session-start', { agent: agent as never, source: 'fresh' as never })
    await settle()
    expect(ctx.tools.schemas(agent as never).map(tool => tool.name).sort()).toEqual([
      'pi_api_probe', 'pi_ask_probe', 'pi_exec_probe', 'pi_greet', 'pi_image_probe', 'pi_message_probe',
    ])
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('pi_probe')

    const execProbe = await ctx.tools.execute({
      signal,
      callId: CallId('exec-probe'),
      name: 'pi_exec_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(JSON.parse((execProbe.content[0] as { text: string }).text)).toEqual({
      stdout: await realpath(scratch),
      stderr: '',
      code: 0,
      killed: false,
    })

    const askProbe = await ctx.tools.execute({
      signal,
      callId: CallId('ask-probe'),
      name: 'pi_ask_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(JSON.parse((askProbe.content[0] as { text: string }).text)).toEqual({
      hasUI: true,
      selected: 'beta',
      confirmed: true,
      typed: 'typed',
    })

    const imageProbe = await ctx.tools.execute({
      signal,
      callId: CallId('image-probe'),
      name: 'pi_image_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(imageProbe.isError).toBe(false)
    expect(imageProbe.meta).toEqual({ nativeAttachment: true })
    expect(imageProbe.content[0]).toMatchObject({
      type: 'image',
      attachment: { mediaType: 'image/png', width: 1, height: 1 },
    })
    if (imageProbe.content[0]?.type !== 'image') throw new Error('expected a native DSH image block')
    const storedImage = await ctx.attachments.readImage(imageProbe.content[0].attachment)
    expect(Buffer.from(storedImage.data).toString('base64')).toBe(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    )

    const messageProbe = await ctx.tools.execute({
      signal,
      callId: CallId('message-probe'),
      name: 'pi_message_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(messageProbe.isError).toBe(false)
    expect(injected).toHaveLength(1)
    expect(steered).toHaveLength(1)
    expect(followedUp).toHaveLength(1)
    for (const delivered of [...injected, ...steered, ...followedUp]) {
      expect(delivered).toMatchObject({ source: { kind: 'plugin', plugin: 'pi2dsh:@pi2dsh-fixtures/complete' } })
    }

    const command = await ctx.commands.execute(agent as never, '/pi-hello Ada', signal)
    expect(command?.result).toEqual({ kind: 'success', text: 'Pi command says hello to Ada' })

    // Session-control operations are REAL now (official ctx.sessions
    // surfaces), so the probe's unavailable list is empty: newSession()
    // succeeds, and the no-argument fork()/navigateTree()/switchSession()
    // calls fail with ordinary argument errors — exactly like real Pi —
    // rather than "needs a native DSH port".
    const contextCommand = await ctx.commands.execute(agent as never, '/pi-context-probe Ada', signal)
    expect(contextCommand?.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('"unavailable":[]'),
    })

    const prompt = await ctx.commands.execute(agent as never, '/pi-review src/index.ts "focus errors"', signal)
    expect(prompt?.result.kind).toBe('success')
    expect(steered).toHaveLength(2)
    expect(steered[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Review src/index.ts carefully. Extra context: focus errors.' }],
    })

    const skills = await ctx.skills.list({ cwd: scratch, signal })
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'fixture-skill', provider: 'pi2dsh-pi2dsh-fixtures-complete' }),
    ]))
    expect((await ctx.skills.get('fixture-skill', { cwd: scratch, signal }))?.content).toContain('PI2DSH_SKILL_OK')

    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'test lifecycle' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('durable-call'),
      name: 'pi_greet',
      arguments: '{"name":"Grace"}',
    })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    disposeAgent()
    await settle()

    const probe = await ctx.tools.execute({ signal, callId: CallId('probe-1'), name: 'pi_probe', arguments: {} })
    const counters = JSON.parse((probe.content[0] as { type: 'text'; text: string }).text) as Record<string, number>
    // The context-probe command really runs ctx.reload() now, which remounts
    // the extension entries once: setup-time counters (flag_default,
    // package_event) tick again on the remount pass.
    expect(counters).toMatchObject({
      session_start: 1,
      session_shutdown: 1,
      package_event: 2,
      flag_default: 2,
      command: 1,
      tool_execute: 1,
      tool_call: 12,
      tool_result: 11,
      agent_start: 1,
      turn_start: 1,
      message_start: 1,
      message_end: 1,
      tool_execution_start: 1,
      tool_execution_end: 11,
      turn_end: 1,
      agent_end: 1,
      agent_settled: 1,
    })

    await fiber.dispose()
  })
})

// DSH dispatches an untagged listener across every scope, so tool traffic from
// a child agent reaches extensions mounted on the parent unless the bridge
// filters it. Two things go wrong when it does not: a parent's tool_call guard
// silently polices another session's calls, and its handlers see an end for a
// start they never saw. The bridge's three tool subscriptions all gate on this
// predicate.
describe('DSH content projected into the Pi blocks packages read', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  it('resolves an image attachment into the inline block Pi defines', async () => {
    // DSH keeps image bytes in the attachment service and the block carries
    // only a reference; Pi's block carries the bytes inline. The projection
    // used to emit a bare `{type:'image'}` — a block that announces an image
    // and contains none, which a package cannot tell from a real one.
    const read: unknown[] = []
    const ctx = {
      get: (name: string) => name !== 'attachments' ? undefined : {
        readImage: async (ref: unknown) => {
          read.push(ref)
          return { data: Buffer.from(PNG, 'base64') }
        },
      },
    } as never
    const attachment = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 70, width: 1, height: 1 }
    const projected = await runtimeInternals.dshToPiContent(ctx, [
      { type: 'text', text: 'look' },
      { type: 'image', attachment },
    ] as never)
    expect(read).toEqual([attachment])
    expect(projected).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', data: PNG, mimeType: 'image/png' },
    ])
  })

  it('drops an unreadable image rather than emitting an empty one', async () => {
    const ctx = {
      get: (name: string) => name !== 'attachments' ? undefined : {
        readImage: async () => { throw new Error('attachment evicted') },
      },
    } as never
    const projected = await runtimeInternals.dshToPiContent(ctx, [
      { type: 'image', attachment: { attachmentId: 'gone', mediaType: 'image/png' } },
      { type: 'text', text: 'still here' },
    ] as never)
    expect(projected).toEqual([{ type: 'text', text: 'still here' }])
  })

  it('derives the compaction trigger DSH records, and says manual only when it is', () => {
    // A manual compaction runs with no open turn, or cites the command that
    // drove it. DSH does not persist which automatic trigger fired, so an
    // automatic one reports threshold — stated in the projection, not guessed.
    expect(runtimeInternals.compactionReason({ turn: null })).toBe('manual')
    expect(runtimeInternals.compactionReason({ turn: 3, sourceCommandId: 'cmd-1' })).toBe('manual')
    expect(runtimeInternals.compactionReason({ turn: 3 })).toBe('threshold')
  })
})

describe("Pi's argument gate in front of a migrated tool", () => {
  async function mountToolPackage(scratchName: string): Promise<Context> {
    const scratch = await mkdtemp(join(tmpdir(), scratchName))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'export default function (pi) {',
      '  pi.registerTool({',
      "    name: 'pi_typed',",
      "    description: 'Reports exactly what it was handed.',",
      '    parameters: {',
      "      type: 'object',",
      "      properties: { count: { type: 'number' }, note: { type: 'string' } },",
      "      required: ['count'],",
      '    },',
      '    execute: async (_id, args) => ({',
      "      content: [{ type: 'text', text: JSON.stringify({ value: args.count, kind: typeof args.count, keys: Object.keys(args) }) }],",
      '    }),',
      '  })',
      '}',
    ].join('\n'), 'utf8')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin({
      name: 'pi2dsh:arg-gate-test',
      inject: ['tools', 'systemPrompt', 'commands', 'skills'],
      async apply(inner: Context) {
        await applyPiPackage(inner, {
          rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
          manifest: {
            schemaVersion: 1,
            package: { name: '@pi2dsh-fixtures/typed', version: '0.0.0' },
            extensions: ['extension.js'],
            skillDirs: [],
            prompts: [],
          } as never,
        })
      },
    } as Plugin.Object)
    return ctx
  }

  it('coerces a stringified number the way Pi does, and drops an optional explicit null', async () => {
    // Models emit "3" for number parameters routinely. Pi coerces before the
    // tool sees it; running no gate at all handed the tool's own code a
    // string where its schema says number.
    const ctx = await mountToolPackage('pi2dsh-arg-gate-')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('typed-1'),
      name: 'pi_typed',
      arguments: { count: '3', note: null },
      agent: undefined as never,
    })
    expect(result.isError).toBe(false)
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      value: 3,
      kind: 'number',
      // An explicit null on an OPTIONAL property is removed, not passed through.
      keys: ['count'],
    })
  })

  it('returns the violation to the model instead of running the tool on bad input', async () => {
    const ctx = await mountToolPackage('pi2dsh-arg-gate-bad-')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('typed-2'),
      name: 'pi_typed',
      arguments: { note: 'no count at all' },
      agent: undefined as never,
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('count')
  })
})

describe("a Pi tool's own system-prompt contributions", () => {
  it('renders promptSnippet and promptGuidelines into the assembled DSH prompt', async () => {
    // Pi puts `promptSnippet` in the prompt's "Available tools" list — a tool
    // that supplies none is OMITTED from that list — and `promptGuidelines`
    // in its Guidelines bullets, while the tool is active. Both were dropped
    // on registration, so a migrated tool documented nothing to the model.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-prompt-section-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'export default function (pi) {',
      '  pi.registerTool({',
      "    name: 'pi_documented',",
      "    description: 'A tool that documents itself.',",
      "    promptSnippet: 'pi_documented: run the documented thing',",
      "    promptGuidelines: ['Prefer pi_documented over bash for the documented thing', '  '],",
      "    parameters: { type: 'object', properties: {} },",
      "    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),",
      '  })',
      '}',
    ].join('\n'), 'utf8')

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: 'Base DSH prompt.' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin({
      name: 'pi2dsh:prompt-section-test',
      inject: ['tools', 'systemPrompt', 'commands', 'skills'],
      async apply(inner: Context) {
        await applyPiPackage(inner, {
          rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
          manifest: {
            schemaVersion: 1,
            package: { name: '@pi2dsh-fixtures/documented', version: '0.0.0' },
            extensions: ['extension.js'],
            skillDirs: [],
            prompts: [],
          } as never,
        })
      },
    } as Plugin.Object)

    const rendered = renderPrompt(await ctx.systemPrompt.assemble())
    expect(rendered).toContain('Available tools:\n- pi_documented: run the documented thing')
    expect(rendered).toContain('Guidelines:\n- Prefer pi_documented over bash for the documented thing')
    // A blank bullet is not a bullet.
    expect(rendered).not.toContain('- \n')
    // DSH owns ordering: the persona still leads.
    expect(rendered.indexOf('Base DSH prompt.')).toBeLessThan(rendered.indexOf('Available tools:'))
  })
})

describe('child-agent origin detection (the guard on the tool subscriptions)', () => {
  it('recognises a child session through both header shapes, and passes real ones through', () => {
    const { isSubagentOrigin } = runtimeInternals as unknown as {
      isSubagentOrigin(subject: Record<string, unknown> | undefined): boolean
    }

    // The durable header carries creation meta flattened…
    expect(isSubagentOrigin({ session: { header: { origin: 'subagent' } } })).toBe(true)
    // …and the agent may be passed instead of its session.
    expect(isSubagentOrigin({ header: { origin: 'subagent' } })).toBe(true)
    // …while older and mock shapes nest it under meta.
    expect(isSubagentOrigin({ session: { header: { meta: { origin: 'subagent' } } } })).toBe(true)

    // A real user turn must still be delivered — over-filtering would silence
    // every extension instead of just the child's traffic.
    expect(isSubagentOrigin({ session: { header: { origin: 'user' } } })).toBe(false)
    expect(isSubagentOrigin({ session: { header: {} } })).toBe(false)
    expect(isSubagentOrigin(undefined)).toBe(false)
  })
})
