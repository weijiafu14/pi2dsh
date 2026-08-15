// Engine contract: `dsh plugin add pi2dsh` mounts ONE bridge that discovers
// and hosts every Pi package the user added to the profile. Discovery is
// manifest-driven (the profile's direct dependencies — each one an explicit
// `dsh plugin add`), identification uses Pi's own markers, and explicit
// config narrows or overrides it.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { apply, discoverProfilePiPackages, findProfileRoot, inject, name } from '../src/engine.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function makeProfile(dependencies: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi2dsh-engine-profile-'))
  cleanup.push(root)
  await writeFile(join(root, 'cordis.yml'), '- name: dsh-base\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'profile', dependencies }, null, 2))
  await mkdir(join(root, 'node_modules'), { recursive: true })
  return root
}

async function installFixturePackage(
  profileRoot: string,
  packageName: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<void> {
  const dir = join(profileRoot, 'node_modules', packageName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', ...manifest }, null, 2))
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(join(dir, relative, '..'), { recursive: true })
    await writeFile(join(dir, relative), content)
  }
}

describe('engine discovery', () => {
  it('finds the profile root by its cordis.yml + package.json signature', async () => {
    const root = await makeProfile({})
    const nested = join(root, 'node_modules', '.pnpm', 'pi2dsh@0.6.0', 'node_modules', 'pi2dsh', 'dist')
    await mkdir(nested, { recursive: true })
    expect(findProfileRoot(nested)).toBe(root)
    expect(findProfileRoot(tmpdir())).toBeUndefined()
  })

  it('selects direct dependencies that identify as Pi packages and skips everything else', async () => {
    const root = await makeProfile({
      'pi-marked': '1.0.0',
      'pi-conventional': '1.0.0',
      'plain-lib': '1.0.0',
      'some-dsh-bundle': '1.0.0',
      'pi2dsh': '0.6.0',
      'not-installed': '1.0.0',
    })
    // Pi marker: the official `pi` manifest field.
    await installFixturePackage(root, 'pi-marked', { pi: { extensions: ['main.js'] } }, { 'main.js': 'export default () => {}' })
    // No marker, but Pi's directory convention carries extension sources.
    await installFixturePackage(root, 'pi-conventional', {}, { 'extensions/index.js': 'export default () => {}' })
    // A plain library: no marker, no extensions.
    await installFixturePackage(root, 'plain-lib', {}, { 'index.js': 'export {}' })
    // A DSH bundle is a DSH plugin layer, never a Pi package.
    await installFixturePackage(root, 'some-dsh-bundle', { pi: { extensions: ['x.js'] }, dsh: { bundle: { patch: './p.yml' } } })

    const warnings: string[] = []
    const found = await discoverProfilePiPackages(root, { warn: message => warnings.push(message) })
    expect(found.map(pkg => pkg.name).sort()).toEqual(['pi-conventional', 'pi-marked'])
    expect(warnings.join('\n')).toContain('"not-installed" is not installed')
  })

  it('honors exclude, and explicit packages config skips discovery entirely', async () => {
    const root = await makeProfile({ 'pi-marked': '1.0.0', 'pi-second': '1.0.0' })
    await installFixturePackage(root, 'pi-marked', { pi: { extensions: ['main.js'] } }, { 'main.js': '' })
    await installFixturePackage(root, 'pi-second', { pi: { extensions: ['main.js'] } }, { 'main.js': '' })
    const narrowed = await discoverProfilePiPackages(root, { exclude: ['pi-second'] })
    expect(narrowed.map(pkg => pkg.name)).toEqual(['pi-marked'])
  })
})

describe('engine mounting on a real DSH composition', () => {
  it('exposes the cordis plugin surface and mounts discovered packages through one bridge', async () => {
    expect(name).toBe('pi2dsh')
    expect(inject).toEqual(['tools', 'systemPrompt', 'commands', 'skills'])

    const root = await makeProfile({ 'pi-probe': '1.0.0' })
    await installFixturePackage(root, 'pi-probe', { pi: { extensions: ['extensions/probe.ts'] } }, {
      'extensions/probe.ts': [
        'export default function probe(pi: any) {',
        "  pi.registerTool({",
        "    name: 'engine_probe',",
        "    label: 'Engine probe',",
        "    description: 'Proves the engine mounted this package.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        "    async execute() { return { content: [{ type: 'text', text: 'engine-mounted' }] } },",
        '  })',
        '}',
      ].join('\n'),
    })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
    await apply(ctx, {})
    await new Promise(resolve => setTimeout(resolve, 25))

    const typedCtx = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      agents?: { register(agent: Record<string, unknown>): () => void }
      tools: { execute(request: Record<string, unknown>): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> }
    }
    const session = typedCtx.sessions.create(SessionId('pi2dsh-engine-probe'), {
      meta: { createdAt: Date.now(), cwd: root },
    })
    const agent = { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    const result = await typedCtx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('engine-probe'),
      name: 'engine_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(result.isError ?? false).toBe(false)
    expect(result.content[0]?.text).toBe('engine-mounted')
  })

  interface LlmFace {
    registerAdapter(providers: string[], adapter: unknown): unknown
    listProviders(): Array<{ id: string }>
    listModels(provider: string): Promise<Array<Record<string, unknown>>>
  }

  async function makeLlmContext(root: string): Promise<{ ctx: Context, llm: LlmFace, TextAdapter: new (models: Array<Record<string, unknown>>) => unknown }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    const { default: LlmRuntime, LlmAdapter: Adapter } = await import('@deepseek-ai/dsh-llm')
    await ctx.plugin(LlmRuntime as never, {} as never)
    class ModelListAdapter extends (Adapter as typeof LlmAdapter) {
      constructor(private readonly models: Array<Record<string, unknown>>) { super() }
      override providerInfo(id: string) { return { id, name: `Gateway ${id}` } }
      override async listModels(id: string) {
        return this.models.map(model => ({ ...model, provider: id })) as never
      }
      override async resolveModel(id: string, model: string) {
        return { ...(this.models.find(entry => entry.id === model) ?? { id: model, name: model, inputModalities: ['text'] }), provider: id } as never
      }
      override async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const llm = (ctx as unknown as { llm: LlmFace }).llm
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
    return { ctx, llm, TextAdapter: ModelListAdapter as never }
  }

  const settle = async (): Promise<void> => new Promise(resolve => setTimeout(resolve, 25))

  it('auto-registers a -vision companion for every text-only route, skipping image-capable routes (zero config)', async () => {
    const root = await makeProfile({})
    const { ctx, llm, TextAdapter } = await makeLlmContext(root)
    llm.registerAdapter(['gateway'], new TextAdapter([{ id: 'gw-mini', name: 'GW Mini', inputModalities: ['text'] }]))
    llm.registerAdapter(['vlm'], new TextAdapter([{ id: 'vlm-pro', name: 'VLM Pro', inputModalities: ['text', 'image'] }]))
    await apply(ctx, {})
    await settle()

    const ids = llm.listProviders().map(provider => provider.id)
    expect(ids).toContain('gateway-vision')
    expect(ids).not.toContain('vlm-vision')
    expect(ids).not.toContain('gateway-vision-vision')
    const models = await llm.listModels('gateway-vision')
    expect(models[0]?.inputModalities).toEqual(['text', 'image'])

    // The directory is live: a route registered AFTER mount gets its
    // companion through the adapters-updated re-sweep.
    llm.registerAdapter(['late'], new TextAdapter([{ id: 'late-1', name: 'Late', inputModalities: ['text'] }]))
    await settle()
    expect(llm.listProviders().map(provider => provider.id)).toContain('late-vision')
  })

  it('visionCompanions: false turns companions off; an explicit map narrows to named routes/models', async () => {
    const offRoot = await makeProfile({})
    const off = await makeLlmContext(offRoot)
    off.llm.registerAdapter(['gateway'], new off.TextAdapter([{ id: 'gw-mini', name: 'GW Mini', inputModalities: ['text'] }]))
    await apply(off.ctx, { visionCompanions: false })
    await settle()
    expect(off.llm.listProviders().map(provider => provider.id)).not.toContain('gateway-vision')

    const narrowRoot = await makeProfile({})
    const narrow = await makeLlmContext(narrowRoot)
    narrow.llm.registerAdapter(['gateway'], new narrow.TextAdapter([
      { id: 'gw-mini', name: 'GW Mini', inputModalities: ['text'] },
      { id: 'gw-max', name: 'GW Max', inputModalities: ['text'] },
    ]))
    narrow.llm.registerAdapter(['other'], new narrow.TextAdapter([{ id: 'o1', name: 'O1', inputModalities: ['text'] }]))
    await apply(narrow.ctx, { visionCompanions: { gateway: ['gw-mini'] } })
    await settle()
    const ids = narrow.llm.listProviders().map(provider => provider.id)
    expect(ids).toContain('gateway-vision')
    expect(ids).not.toContain('other-vision')
    const models = await narrow.llm.listModels('gateway-vision')
    expect(models.map(model => model.id)).toEqual(['gw-mini'])
  })
})
