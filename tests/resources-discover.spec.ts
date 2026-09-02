// resources_discover contract — Pi fires it right after session_start with the
// session cwd; handlers hand back extra skill roots (pi-code: the project's
// .claude/skills). On DSH those roots must land in the host skills registry
// through the official filesystem provider, so `ctx.skills.list()` sees them.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { applyPiPackage } from '../src/runtime.js'
import type { GeneratedRuntimeManifest } from '../src/types.js'

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const EXTENSION = [
  "import { join } from 'node:path'",
  'export default function discover(pi: any) {',
  "  pi.on('resources_discover', async (event: any, ctx: any) => {",
  "    ;(globalThis as any).__rd = { reason: event.reason, cwd: event.cwd, ctxCwd: ctx.cwd }",
  "    return { skillPaths: [join(ctx.cwd, '.claude', 'skills'), join(ctx.cwd, 'lonely', 'SKILL.md')], promptPaths: ['/nowhere/prompt.md'] }",
  '  })',
  '}',
].join('\n')

describe('resources_discover on DSH', () => {
  it('fires after session_start and mounts returned skill roots into the host skills registry', async () => {
    const bundle = await mkdtemp(join(tmpdir(), 'pi2dsh-rd-'))
    cleanup.push(bundle)
    await mkdir(join(bundle, 'extensions'), { recursive: true })
    await writeFile(join(bundle, 'extensions/discover.ts'), EXTENSION)
    // The project the session runs in, with a Claude-shaped skills tree.
    const project = await mkdtemp(join(tmpdir(), 'pi2dsh-rd-project-'))
    cleanup.push(project)
    await mkdir(join(project, '.claude', 'skills', 'demo-skill'), { recursive: true })
    await writeFile(join(project, '.claude', 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: A discovered probe skill\n---\nRD_SKILL_OK\n')
    await mkdir(join(project, 'lonely'), { recursive: true })
    await writeFile(join(project, 'lonely', 'SKILL.md'), '---\nname: lonely\ndescription: single file, no root\n---\n')

    const manifest: GeneratedRuntimeManifest = {
      schemaVersion: 1,
      package: { name: '@pi2dsh-fixtures/rd-probe', version: '0.0.0', source: 'fixture' },
      extensions: ['extensions/discover.ts'],
      skillDirs: [],
      prompts: [],
    }
    const plugin: Plugin.Object = {
      name: 'pi2dsh:test-rd',
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

    const typed = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      agents: { register(agent: Record<string, unknown>): () => void }
      skills: { list(options: { cwd: string, signal: AbortSignal }): Promise<Array<{ name: string, provider: string }>>, get(name: string, options: { cwd: string, signal: AbortSignal }): Promise<{ content: string } | undefined> }
      emit(name: string, payload: Record<string, unknown>): void
    }
    const session = typed.sessions.create(SessionId('pi2dsh-rd'), { meta: { createdAt: Date.now(), cwd: project } })
    const agent = { id: session.id, session, options: {}, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    typed.agents.register(agent)
    typed.emit('agent/session-start', { agent, source: 'fresh' })
    const signal = new AbortController().signal
    const deadline = Date.now() + 5000
    let listed: Array<{ name: string, provider: string }> = []
    while (Date.now() < deadline) {
      listed = await typed.skills.list({ cwd: project, signal })
      if (listed.some(skill => skill.name === 'demo-skill')) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const record = (globalThis as Record<string, unknown>).__rd as { reason: string, cwd: string, ctxCwd: string }
    expect(record).toMatchObject({ reason: 'startup', cwd: project, ctxCwd: project })
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'demo-skill', provider: 'pi2dsh-pi2dsh-fixtures-rd-probe-discovered-1' }),
    ]))
    expect((await typed.skills.get('demo-skill', { cwd: project, signal }))?.content).toContain('RD_SKILL_OK')
    // The single SKILL.md path has no root: reported, never mounted as a skill.
    expect(listed.some(skill => skill.name === 'lonely')).toBe(false)
  })
})
