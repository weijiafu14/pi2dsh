import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LlmRuntime, { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { manifestForInstalled } from '../src/host.js'
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

describe('an installed Pi package in the real DSH runtime', () => {
  it('mounts one installed package and executes tools, policy hooks, commands, prompts, skills, and lifecycle events', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-dsh-runtime-'))
    cleanup.push(scratch)
    // The engine's own path: the package is mounted where it is installed,
    // with its manifest built in place. Nothing converts it, and nothing is
    // generated — which is the only way a reader ever installs one.
    const bundle = join(scratch, 'package')
    await cp(fixtureRoot, bundle, { recursive: true })
    const runtimeEdgePath = 'vendor/runtime-edge-extension.ts'
    await mkdir(join(bundle, 'vendor'), { recursive: true })
    await copyFile(join(projectRoot, 'fixtures/runtime-edge-extension.ts'), join(bundle, runtimeEdgePath))
    const pkg = await resolvePiPackage(bundle)
    let manifest: GeneratedRuntimeManifest
    try {
      manifest = await manifestForInstalled(pkg)
    } finally {
      await pkg.dispose()
    }
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
    if (messageProbe.isError) throw new Error(`message probe failed: ${JSON.stringify(messageProbe.content)}`)
    expect(messageProbe.isError).toBe(false)
    // Pi's no-turn sendMessage is durable BY THE TIME IT RETURNS — the message
    // is in the conversation, not queued for a step that may never come. So
    // the proof is the session log, not the agent's inbox: routing inject
    // through the inbox meant a turn cancelled in between dropped a message
    // the package had already been told was delivered.
    const injectedEvents = session.events.filter(event =>
      event.type === 'user/message'
      && (event.data.source as { plugin?: string } | undefined)?.plugin === 'pi2dsh:@pi2dsh-fixtures/complete')
    expect(injectedEvents).toHaveLength(1)
    expect(injected).toHaveLength(0)
    // Steering and follow-up DO trigger a turn, so they stay on the agent.
    expect(steered).toHaveLength(1)
    expect(followedUp).toHaveLength(1)
    for (const delivered of [...steered, ...followedUp]) {
      expect(delivered).toMatchObject({ source: { kind: 'plugin', plugin: 'pi2dsh:@pi2dsh-fixtures/complete' } })
    }

    const command = await ctx.commands.execute(agent as never, '/pi-hello Ada', [], signal)
    expect(command?.result).toEqual({ kind: 'success', text: 'Pi command says hello to Ada' })

    // Session-control operations are REAL now (official ctx.sessions
    // surfaces), so the probe's unavailable list is empty: newSession()
    // succeeds, and the no-argument fork()/navigateTree()/switchSession()
    // calls fail with ordinary argument errors — exactly like real Pi —
    // rather than "needs a native DSH port".
    const contextCommand = await ctx.commands.execute(agent as never, '/pi-context-probe Ada', [], signal)
    expect(contextCommand?.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('"unavailable":[]'),
    })

    const prompt = await ctx.commands.execute(agent as never, '/pi-review src/index.ts "focus errors"', [], signal)
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
      // Two, not one: the durably-appended sendMessage is a real user/message
      // in the log, and Pi announces exactly that pair right after appending
      // it. Under the old inbox routing it produced no message at all until
      // some later step claimed it.
      message_start: 2,
      message_end: 2,
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

describe('hasUI reports whether a human can actually answer', () => {
  it('is false when the question service is mounted but no provider registered', async () => {
    // The headless posture: the service exists, nothing answers. Reporting
    // true here made a package skip its non-interactive path and then throw
    // on the first select/confirm/input.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-hasui-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'export default function (pi) {',
      '  pi.registerTool({',
      "    name: 'pi_hasui',",
      "    description: 'Reports ctx.hasUI.',",
      "    parameters: { type: 'object', properties: {} },",
      "    execute: async (_id, _args, _signal, _onUpdate, ctx) => ({",
      "      content: [{ type: 'text', text: JSON.stringify({ hasUI: ctx.hasUI }) }],",
      '    }),',
      '  })',
      '}',
    ].join('\n'), 'utf8')

    const build = async (withProvider: boolean): Promise<boolean> => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(CommandRuntime)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(UserQuestionService)
      if (withProvider) {
        ctx.userQuestions.registerProvider({
          async ask(request: { questions: Array<{ id: string }> }) {
            return { answers: request.questions.map(() => ({ questionId: 'q', optionId: 'a' })) } as never
          },
        } as never)
      }
      await ctx.plugin({
        name: 'pi2dsh:hasui-test',
        inject: ['tools', 'systemPrompt', 'commands', 'skills'],
        async apply(inner: Context) {
          await applyPiPackage(inner, {
            rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
            manifest: {
              schemaVersion: 1,
              package: { name: '@pi2dsh-fixtures/hasui', version: '0.0.0' },
              extensions: ['extension.js'],
              skillDirs: [],
              prompts: [],
            } as never,
          })
        },
      } as Plugin.Object)
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('hasui'),
        name: 'pi_hasui',
        arguments: {},
        agent: undefined as never,
      })
      return (JSON.parse((result.content[0] as { text: string }).text) as { hasUI: boolean }).hasUI
    }

    expect(await build(false)).toBe(false)
    // …and the probe must not have consumed the slot: a real provider still
    // reports true, and is still the one that would be asked.
    expect(await build(true)).toBe(true)
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

describe('logging in is what makes a gateway\'s models selectable', () => {
  it('discovers the models the credential unlocked and announces the route again', async () => {
    // The reason a user logs in to a gateway is to get its models. Discovery
    // needs the credential, and an OAuth credential only exists AFTER the
    // login — so a host that discovers once at mount finds nothing, and the
    // user is left with a successful login and an empty model picker until
    // they restart. This is that whole chain, end to end.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-login-models-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'let discovered = []',
      'export default function (pi) {',
      "  pi.registerProvider('fixgw', {",
      "    id: 'fixgw',",
      "    name: 'Fixture Gateway',",
      '    getModels: () => discovered,',
      // Carrying a transport is what makes this a native DSH route.
      '    stream: async function* () {',
      "      yield { type: 'done', reason: 'stop', message: { role: 'assistant', content: [], usage: {}, stopReason: 'stop' } }",
      '    },',
      // The gateway refuses to list anything without a credential — which is
      // exactly what a real one does, and what pi-provider-litellm does.
      '    refreshModels: async (options) => {',
      '      if (options?.credential?.key === undefined) throw new Error("discovery requires a credential")',
      "      discovered = [{ id: 'fixgw-1', name: 'Fixture One', provider: 'fixgw', contextWindow: 12345 }]",
      '      return true',
      '    },',
      '    oauth: {',
      "      name: 'Fixture Gateway',",
      // No prompting: this test is about what happens AFTER a login succeeds.
      "      login: async () => ({ access: 'tok-abc', refresh: 'r1', expires: Date.now() + 3_600_000 }),",
      '      refreshToken: async (credential) => credential,',
      '      getApiKey: (credential) => credential.access,',
      '    },',
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
    await ctx.plugin(LlmRuntime as never, {} as never)
    // Keep the credential store inside the scratch dir, never the real home:
    // this test performs a real login, and a leaked fixture credential in
    // ~/.dsh would make the NEXT run start already logged in — which silently
    // turns the "empty before login" assertion into a lie.
    process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent')
    try {
      await ctx.plugin({
        name: 'pi2dsh:login-models-test',
        inject: ['tools', 'systemPrompt', 'commands', 'skills'],
        async apply(inner: Context) {
          await applyPiPackage(inner, {
            rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
            manifest: {
              schemaVersion: 1,
              package: { name: '@pi2dsh-fixtures/login-models', version: '0.0.0' },
              extensions: ['extension.js'],
              skillDirs: [],
              prompts: [],
            } as never,
          })
        },
      } as Plugin.Object)
      await settle()

      const llm = (ctx as unknown as {
        llm: { listProviders(): Array<{ id: string }>, listModels(id: string): Promise<Array<Record<string, unknown>>> }
      }).llm
      // The route exists from the moment the package registers it…
      expect(llm.listProviders().map(entry => entry.id)).toContain('fixgw')
      // …and it is EMPTY, because mount-time discovery had no credential.
      expect(await llm.listModels('fixgw')).toEqual([])

      // Every directory observer — the browser's model picker included —
      // re-reads on this notification and on nothing else, so counting it is
      // counting whether the user would ever see the new models.
      let announcements = 0
      ctx.on('llm/adapters-updated' as never, (() => { announcements += 1 }) as never)

      const session = ctx.sessions.create(SessionId('pi2dsh-login-models'), {
        meta: { createdAt: Date.now(), cwd: scratch },
      })
      const agent = { id: session.id, session, ctx: undefined as unknown, options: {}, inbox: {}, status: 'idle' }
      const result = await ctx.commands.execute(agent as never, '/login fixgw', [], new AbortController().signal)
      expect(result?.result.kind).toBe('success')
      await settle()

      // The credential unlocked the catalog, and the catalog reached DSH.
      expect(await llm.listModels('fixgw')).toMatchObject([
        { provider: 'fixgw', id: 'fixgw-1', name: 'Fixture One' },
      ])
      // Announced, or the models sit in a directory nobody re-reads.
      expect(announcements).toBeGreaterThan(0)
      // And the user is told, rather than having to go look.
      expect(String((result?.result as { text?: string }).text)).toContain('1 models available')
    } finally {
      delete process.env.PI_CODING_AGENT_DIR
    }
  })
})

describe('an OAuth-only provider has no models until logging in gives it a route', () => {
  it('declares the route in the official adapter\'s settings section, not a second copy of it', async () => {
    // Pi's built-in OAuth providers (openai-codex, anthropic, github-copilot,
    // kimi-coding) ship no transport and no catalog: nothing above builds them
    // a route, so a successful login stored a token that nothing could use and
    // the model picker did not change. The route is CONFIGURATION — the
    // official llm-pi-ai adapter is already mounted and owns that namespace,
    // so mounting a second copy collides on the provider directory it declares
    // ("configurable provider ... is already declared"). It goes in settings.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-oauth-route-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'export default function (pi) {',
      // Nothing but an oauth block: the shape of every built-in login provider.
      "  pi.registerProvider('fixauth', {",
      "    id: 'fixauth',",
      "    name: 'Fixture Account',",
      '    oauth: {',
      "      name: 'Fixture Account',",
      "      login: async () => ({ access: 'tok-xyz', refresh: 'r1', expires: Date.now() + 3_600_000 }),",
      '      refreshToken: async (credential) => credential,',
      '      getApiKey: (credential) => credential.access,',
      '    },',
      '  })',
      '}',
    ].join('\n'), 'utf8')

    const written: Array<{ ns: string, patch: unknown }> = []
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    // Stand in for the settings service the composition mounts, recording what
    // the bridge asks it to store.
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('settings', {
      update: async (ns: string, patch: unknown) => { written.push({ ns, patch }) },
    })
    // A route is only declared once its credential can actually be supplied —
    // declaring one first is what produced MISSING_CREDENTIAL on every request.
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('credentials', {
      set: async () => {},
      describe: async () => ({ configured: false, writable: true }),
    })
    process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent')
    try {
      await ctx.plugin({
        name: 'pi2dsh:oauth-route-test',
        inject: ['tools', 'systemPrompt', 'commands', 'skills'],
        async apply(inner: Context) {
          await applyPiPackage(inner, {
            rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
            manifest: {
              schemaVersion: 1,
              package: { name: '@pi2dsh-fixtures/oauth-route', version: '0.0.0' },
              extensions: ['extension.js'],
              skillDirs: [],
              prompts: [],
            } as never,
          })
        },
      } as Plugin.Object)
      await settle()

      // Before the login there is nothing to route with, so nothing is written.
      expect(written).toEqual([])

      const session = ctx.sessions.create(SessionId('pi2dsh-oauth-route'), {
        meta: { createdAt: Date.now(), cwd: scratch },
      })
      const agent = { id: session.id, session, ctx: undefined as unknown, options: {}, inbox: {}, status: 'idle' }
      const result = await ctx.commands.execute(agent as never, '/login fixauth', [], new AbortController().signal)
      expect(result?.result.kind).toBe('success')
      await settle()

      // One write, into the official adapter's own namespace, naming the
      // credential REFERENCE and never the token.
      expect(written).toHaveLength(1)
      expect(written[0]?.ns).toBe('llm-pi-ai')
      expect(written[0]?.patch).toEqual({
        providers: { fixauth: { displayName: 'Fixture Account', apiKeyEnv: 'PI2DSH_OAUTH_FIXAUTH' } },
      })
      expect(JSON.stringify(written[0])).not.toContain('tok-xyz')
    } finally {
      delete process.env.PI_CODING_AGENT_DIR
    }
  })
})

describe('a stored OAuth login is ready when a restarted host finishes mounting', () => {
  it('publishes the credential and route before applyPiPackage returns', async () => {
    // A headless profile starts its one and only model call immediately after
    // plugin mount. Restoring auth.json in a detached promise races that call:
    // the route exists in settings, but its credential still reads missing.
    // No settle() is allowed in this test — mount returning is the contract.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-oauth-restore-ready-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), 'export default function () {}\n', 'utf8')
    const agentDir = join(scratch, 'agent')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'auth.json'), JSON.stringify({
      'openai-codex': {
        type: 'oauth',
        access: 'stored-access-token',
        refresh: 'stored-refresh-token',
        expires: Date.now() + 3_600_000,
        accountId: 'account-1',
      },
    }), 'utf8')

    const stored = new Map<string, string>()
    const written: Array<{ ns: string, patch: unknown }> = []
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    // Actual restart shape: settings loaded before pi2dsh, so the adapter
    // route is already present. The credential still has to be republished —
    // route presence is not proof that its apiKeyEnv currently resolves.
    ;(ctx as unknown as { llm: { registerAdapter(providers: string[], adapter: unknown): unknown } })
      .llm.registerAdapter(['openai-codex'], {
        providerInfo: (provider: string) => ({ id: provider, name: 'OpenAI (ChatGPT Plus/Pro)' }),
        providerRetryPolicy: () => undefined,
        listModels: async () => [],
        resolveModel: async (provider: string, id: string) => ({ provider, id, name: id }),
        async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } },
      })
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('settings', {
      update: async (ns: string, patch: unknown) => {
        await new Promise(done => setTimeout(done, 5))
        written.push({ ns, patch })
      },
    })
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('credentials', {
      set: async (ref: string, value: string) => {
        await new Promise(done => setTimeout(done, 5))
        stored.set(ref, value)
      },
      describe: async () => ({ configured: false, writable: true }),
    })

    process.env.PI_CODING_AGENT_DIR = agentDir
    try {
      await ctx.plugin({
        name: 'pi2dsh:oauth-restore-ready-test',
        inject: ['tools', 'systemPrompt', 'commands', 'skills'],
        async apply(inner: Context) {
          await applyPiPackage(inner, {
            rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
            manifest: {
              schemaVersion: 1,
              package: { name: '@pi2dsh-fixtures/oauth-restore-ready', version: '0.0.0' },
              extensions: ['extension.js'],
              skillDirs: [],
              prompts: [],
            } as never,
          })
        },
      } as Plugin.Object)

      expect(stored.get('PI2DSH_OAUTH_OPENAI_CODEX')).toBe('stored-access-token')
      // Existing route: no redundant settings rewrite, but credential ready.
      expect(written).toEqual([])
      expect(JSON.stringify(written)).not.toContain('stored-access-token')
    } finally {
      delete process.env.PI_CODING_AGENT_DIR
    }
  })
})

describe('answering nothing at the login picker', () => {
  it('is a cancellation, not a wrong answer', () => {
    // Dismissing the dialog answers with nothing. Feeding that to the choice
    // resolver produced `unknown OAuth provider ""` — a message that tells the
    // user their pick was invalid when they had simply not picked.
    const { resolveOfferedChoice } = runtimeInternals as unknown as {
      resolveOfferedChoice(answer: string, offered: readonly string[]): string | undefined
    }
    expect(resolveOfferedChoice('', ['openai-codex', 'anthropic'])).toBeUndefined()
    // The command must not reach that resolver at all for an empty answer;
    // the guard is in the handler, so this pins the shape it guards on.
    expect(''.trim().split(/\s+/u)[0]).toBe('')
  })
})

describe('a catalog-only Pi provider is declared, not mounted twice', () => {
  it('writes its profile into the official adapter\'s settings section', async () => {
    // Same collision, the other entry point: a package that declares a gateway
    // without shipping code to call it used to get its own copy of the
    // official llm-pi-ai plugin. In any composition that already mounts that
    // adapter — the normal one — the second copy re-declares the whole
    // provider directory and is refused, so the gateway simply never worked.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-catalog-route-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'export default function (pi) {',
      "  pi.registerProvider('fixcat', {",
      "    id: 'fixcat',",
      "    name: 'Fixture Catalog Gateway',",
      "    compat: { supportsDeveloperRole: false, openRouterRouting: { only: ['x'] } },",
      // Pi's env-reference convention, which is what DSH's apiKeyEnv says too.
      "    apiKey: '$FIXCAT_API_KEY',",
      // A plain `models` array, the shape every vendor package actually uses —
      // pi-ai's createProvider() builds getModels() instead, and reading only
      // that left these packages declaring an empty catalog.
      '    models: [{',
      "      id: 'fixcat-1', name: 'Fixture Cat One', provider: 'fixcat',",
      "      api: 'openai-completions', baseUrl: 'https://gw.fixture.test/v1',",
      // A compat block mixing what DSH's profile knows with what it does not,
      // and a maxTokens of 0 — the "unstated" every vendor package writes.
      "      contextWindow: 64000, maxTokens: 0, reasoning: true,",
      "      thinkingLevelMap: { off: null, minimal: null, low: 'economy', xhigh: 'ultra' },",
      "      input: ['text', 'image', 'audio'],",
      "      compat: {",
      "        supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true,",
      "        supportsUsageInStreaming: false, maxTokensField: 'max_tokens',",
      "        requiresToolResultName: true, requiresAssistantAfterToolResult: true,",
      "        requiresThinkingAsText: false, requiresReasoningContentOnAssistantMessages: true,",
      "        thinkingFormat: 'chat-template',",
      "        chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled', omitWhenOff: true }, effort: { $var: 'thinking.effort' }, fixed: 7, bad: { $var: 'request.secret' } },",
      "        supportsStrictMode: false, cacheControlFormat: 'anthropic', supportsLongCacheRetention: true,",
      "        openRouterRouting: { only: ['x'] }, unknownSwitch: true,",
      "      },",
      '    }],',
      '  })',
      '}',
    ].join('\n'), 'utf8')

    const written: Array<{ ns: string, patch: unknown }> = []
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('settings', {
      update: async (ns: string, patch: unknown) => { written.push({ ns, patch }) },
    })
    await ctx.plugin({
      name: 'pi2dsh:catalog-route-test',
      inject: ['tools', 'systemPrompt', 'commands', 'skills'],
      async apply(inner: Context) {
        await applyPiPackage(inner, {
          rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
          manifest: {
            schemaVersion: 1,
            package: { name: '@pi2dsh-fixtures/catalog-route', version: '0.0.0' },
            extensions: ['extension.js'],
            skillDirs: [],
            prompts: [],
          } as never,
        })
      },
    } as Plugin.Object)
    await settle()

    expect(written).toHaveLength(1)
    expect(written[0]?.ns).toBe('llm-pi-ai')
    expect(written[0]?.patch).toMatchObject({
      providers: {
        fixcat: {
          displayName: 'Fixture Catalog Gateway',
          // The reference travels; the value never does.
          apiKeyEnv: 'FIXCAT_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://gw.fixture.test/v1',
          compat: { supportsDeveloperRole: false },
          models: [{
            id: 'fixcat-1',
            contextWindow: 64000,
            input: ['text', 'image'],
            reasoningEfforts: { low: 'economy', medium: 'medium', high: 'high', xhigh: 'ultra' },
            compat: {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: true,
              supportsUsageInStreaming: false,
              maxTokensField: 'max_tokens',
              requiresToolResultName: true,
              requiresAssistantAfterToolResult: true,
              requiresThinkingAsText: false,
              requiresReasoningContentOnAssistantMessages: true,
              thinkingFormat: 'chat-template',
              chatTemplateKwargs: {
                enable_thinking: { $var: 'thinking.enabled', omitWhenOff: true },
                effort: { $var: 'thinking.effort' },
                fixed: 7,
              },
              supportsStrictMode: false,
              cacheControlFormat: 'anthropic',
              supportsLongCacheRetention: true,
            },
          }],
        },
      },
    })
    // Field by field, because the two vocabularies overlap without matching.
    // One key DSH's schema does not know rejects the WHOLE settings section —
    // every route in it, not just this one — so vendor-owned, unknown and
    // malformed compat values are dropped rather than forwarded. `maxTokens:
    // 0` (Pi's "unstated", below DSH's minimum of 1) also never becomes a
    // number DSH refuses.
    const patch = written[0]?.patch as { providers: { fixcat: { models: Array<Record<string, unknown>> } } }
    const model = patch.providers.fixcat.models[0] as Record<string, unknown>
    expect(model).not.toHaveProperty('maxTokens')
    expect(model.compat).not.toHaveProperty('openRouterRouting')
    expect(model.compat).not.toHaveProperty('unknownSwitch')
    expect((model.compat as Record<string, unknown>).chatTemplateKwargs).not.toHaveProperty('bad')
  })
})

describe('a compat switch that only exists on one protocol', () => {
  it('does not travel with a route that speaks another', async () => {
    // The two protocol families expose different compat shapes. Pi puts one
    // object on the model whatever it speaks; the bridge must carry the
    // Anthropic switches and remove the OpenAI-only ones, or the whole settings
    // section is refused.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-compat-protocol-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'export default function (pi) {',
      "  pi.registerProvider('fixproto', {",
      "    id: 'fixproto', name: 'Fixture Anthropic-Protocol Gateway',",
      "    api: 'anthropic-messages', baseUrl: 'https://gw.fixture.test',",
      "    models: [{ id: 'fixproto-1', compat: {",
      "      thinkingFormat: 'deepseek', supportsReasoningEffort: true,",
      "      supportsEagerToolInputStreaming: false, supportsLongCacheRetention: true,",
      "      supportsCacheControlOnTools: false, supportsTemperature: false,",
      "      forceAdaptiveThinking: true, allowEmptySignature: true, supportsStrictTools: false,",
      "    } }],",
      '  })',
      "  pi.registerProvider('fixresponses', {",
      "    id: 'fixresponses', name: 'Fixture Responses Gateway',",
      "    api: 'openai-responses', baseUrl: 'https://responses.fixture.test',",
      "    models: [{ id: 'fixresponses-1', compat: {",
      "      supportsDeveloperRole: false, supportsStrictMode: true, supportsLongCacheRetention: true,",
      "      supportsStore: false, thinkingFormat: 'deepseek', supportsTemperature: false,",
      "    } }],",
      '  })',
      '}',
    ].join('\n'), 'utf8')

    const written: Array<{ patch: unknown }> = []
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('settings', {
      update: async (_ns: string, patch: unknown) => { written.push({ patch }) },
    })
    await ctx.plugin({
      name: 'pi2dsh:compat-protocol-test',
      inject: ['tools', 'systemPrompt', 'commands', 'skills'],
      async apply(inner: Context) {
        await applyPiPackage(inner, {
          rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
          manifest: {
            schemaVersion: 1,
            package: { name: '@pi2dsh-fixtures/compat-protocol', version: '0.0.0' },
            extensions: ['extension.js'],
            skillDirs: [],
            prompts: [],
          } as never,
        })
      },
    } as Plugin.Object)
    await settle()

    const anthropicPatch = written.find(entry => (
      entry.patch as { providers?: Record<string, unknown> }
    ).providers?.fixproto !== undefined)?.patch as {
      providers: { fixproto: { api: string, models: Array<Record<string, unknown>> } }
    }
    expect(anthropicPatch.providers.fixproto.api).toBe('anthropic-messages')
    expect(anthropicPatch.providers.fixproto.models[0]?.compat).toEqual({
      supportsEagerToolInputStreaming: false,
      supportsLongCacheRetention: true,
      supportsCacheControlOnTools: false,
      supportsTemperature: false,
      forceAdaptiveThinking: true,
      allowEmptySignature: true,
      supportsStrictTools: false,
    })
    const responsesPatch = written.find(entry => (
      entry.patch as { providers?: Record<string, unknown> }
    ).providers?.fixresponses !== undefined)?.patch as {
      providers: { fixresponses: { api: string, models: Array<Record<string, unknown>> } }
    }
    expect(responsesPatch.providers.fixresponses.api).toBe('openai-responses')
    expect(responsesPatch.providers.fixresponses.models[0]?.compat).toEqual({
      supportsDeveloperRole: false,
      supportsStrictMode: true,
      supportsLongCacheRetention: true,
    })
  })
})

describe('the credential behind the reference the profile names', () => {
  it('stores the logged-in key in the host credential service, and refreshes it per request', async () => {
    // The profile says `apiKeyEnv: PI2DSH_OAUTH_<ID>`; something has to put a
    // value behind that name or every request fails with MISSING_CREDENTIAL —
    // which is exactly what a real login produced. DSH's credentials service is
    // a SINGLE service, so the bridge cannot mount a resolver beside the host's
    // own: the value goes into the host's store. And an OAuth token rotates, so
    // storing it once at login is not enough — the per-request seam re-reads it
    // through Pi's own refresh.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-cred-publish-'))
    cleanup.push(scratch)
    await mkdir(join(scratch, 'pkg'), { recursive: true })
    await writeFile(join(scratch, 'pkg', 'extension.js'), [
      'let issued = 0',
      'export default function (pi) {',
      "  pi.registerProvider('fixcred', {",
      "    id: 'fixcred',",
      "    name: 'Fixture Credential Gateway',",
      '    oauth: {',
      "      name: 'Fixture Credential Gateway',",
      // Always inside Pi's five-minute expiry window, so every resolution
      // rotates and a stored value that is never re-read stays visibly stale.
      "      login: async () => ({ access: 'key-1', refresh: 'r1', expires: Date.now() + 60_000 }),",
      // Renews to something ALREADY EXPIRED, so the next request is the
      // "came back after an idle stretch" case rather than the warm one.
      "      refreshToken: async () => ({ access: `key-${++issued + 1}`, refresh: 'r1', expires: Date.now() - 1_000 }),",
      '      getApiKey: (credential) => credential.access,',
      '    },',
      '  })',
      '}',
    ].join('\n'), 'utf8')

    const stored = new Map<string, string>()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('settings', {
      update: async () => {},
    })
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('credentials', {
      set: async (ref: string, value: string) => { stored.set(ref, value) },
      describe: async () => ({ configured: false, writable: true }),
    })
    process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent')
    try {
      await ctx.plugin({
        name: 'pi2dsh:cred-publish-test',
        inject: ['tools', 'systemPrompt', 'commands', 'skills'],
        async apply(inner: Context) {
          await applyPiPackage(inner, {
            rootUrl: pathToFileURL(`${join(scratch, 'pkg')}/`),
            manifest: {
              schemaVersion: 1,
              package: { name: '@pi2dsh-fixtures/cred-publish', version: '0.0.0' },
              extensions: ['extension.js'],
              skillDirs: [],
              prompts: [],
            } as never,
          })
        },
      } as Plugin.Object)
      await settle()

      const session = ctx.sessions.create(SessionId('pi2dsh-cred-publish'), {
        meta: { createdAt: Date.now(), cwd: scratch },
      })
      const agent = { id: session.id, session, ctx: undefined as unknown, options: {}, inbox: {}, status: 'idle' }
      await ctx.commands.execute(agent as never, '/login fixcred', [], new AbortController().signal)
      await settle()

      // The key the package's own getApiKey produced, under the reference the
      // profile names — Pi's resolution refreshed the expiring token first, so
      // this is the ROTATED key and never the refresh token beside it.
      expect(stored.get('PI2DSH_OAUTH_FIXCRED')).toBe('key-2')
      expect([...stored.values()].join()).not.toContain('r1')

      // A request on that route re-publishes: an access token expires, and a
      // value stored once at login goes stale under the user.
      const llm = (ctx as unknown as { llm: { stream(options: object): AsyncIterable<unknown> } }).llm
      // What the store held at the moment the call actually went out. Our hook
      // is registered first, so this one runs inside its `next()`.
      let keyAtCallTime: string | undefined
      ;(ctx as unknown as { on(event: string, handler: unknown): () => void }).on('llm/stream', ((
        _options: unknown,
        next: () => AsyncIterable<unknown>,
      ) => {
        keyAtCallTime = stored.get('PI2DSH_OAUTH_FIXCRED')
        return next()
      }) as never)
      for await (const _ of llm.stream({
        provider: 'fixcred',
        model: 'anything',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }],
      })) { /* the route has no adapter here; the hook runs either way */ }
      await settle()
      expect(stored.get('PI2DSH_OAUTH_FIXCRED')).toBe('key-3')
      // …and it was renewed BEFORE the request went out. Publishing beside the
      // request instead means the first call after an idle stretch always goes
      // out on a dead token and fails, and only the second one works.
      expect(keyAtCallTime).toBe('key-3')
    } finally {
      delete process.env.PI_CODING_AGENT_DIR
    }
  })
})
