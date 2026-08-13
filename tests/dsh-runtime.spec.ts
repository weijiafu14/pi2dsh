import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { generateBundle } from '../src/generator.js'
import { applyPiPackage } from '../src/runtime.js'
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
    ctx.systemPrompt.section({ name: 'fixture:base', order: 0, text: 'Base DSH prompt.' })
    const fiber = await ctx.plugin(generated)

    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe('Base DSH prompt.\n\nMigrated Pi system prompt hook active.')
    expect(assembly.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'pi_greet', 'pi_probe', 'pi_error', 'pi_context_probe', 'pi_mutation_probe', 'pi_post_block_probe', 'pi_api_probe',
    ]))

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
      unavailable: ['select', 'confirm', 'input', 'custom', 'abort', 'shutdown', 'compact'],
    })

    const mutationProbe = await ctx.tools.execute({
      signal,
      callId: CallId('mutation-probe'),
      name: 'pi_mutation_probe',
      arguments: { value: 'original' },
    })
    expect(mutationProbe.isError).toBe(true)
    expect(mutationProbe.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('argument mutation') })

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
      registrationFailures: [
        'sendMessage', 'sendUserMessage', 'appendEntry', 'setSessionName', 'setLabel', 'exec',
        'setActiveTools', 'setModel', 'setThinkingLevel',
      ],
      thinking: 'off',
    })

    const session = ctx.sessions.create(SessionId('pi2dsh-integration'), {
      meta: { createdAt: Date.now(), cwd: scratch },
    })
    const steered: unknown[] = []
    const agent = {
      id: session.id,
      session,
      steer(message: unknown) { steered.push(message) },
      whenIdle: () => Promise.resolve(),
    }

    ctx.emit('agent/session-start', { agent: agent as never, source: 'fresh' as never })
    const command = await ctx.commands.execute(agent as never, '/pi-hello Ada', signal)
    expect(command?.result).toEqual({ kind: 'success', text: 'Pi command says hello to Ada' })

    const contextCommand = await ctx.commands.execute(agent as never, '/pi-context-probe Ada', signal)
    expect(contextCommand?.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('newSession'),
    })

    const prompt = await ctx.commands.execute(agent as never, '/pi-review src/index.ts "focus errors"', signal)
    expect(prompt?.result.kind).toBe('success')
    expect(steered).toHaveLength(1)
    expect(steered[0]).toMatchObject({
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
    ctx.emit('agent/disposed', { agent: agent as never })
    await settle()

    const probe = await ctx.tools.execute({ signal, callId: CallId('probe-1'), name: 'pi_probe', arguments: {} })
    const counters = JSON.parse((probe.content[0] as { type: 'text'; text: string }).text) as Record<string, number>
    expect(counters).toMatchObject({
      session_start: 1,
      session_shutdown: 1,
      package_event: 1,
      flag_default: 1,
      command: 1,
      tool_execute: 1,
      tool_call: 8,
      tool_result: 7,
      agent_start: 1,
      turn_start: 1,
      message_start: 1,
      message_end: 1,
      tool_execution_start: 1,
      tool_execution_end: 7,
      turn_end: 1,
      agent_end: 1,
      agent_settled: 1,
    })

    await fiber.dispose()
  })
})
