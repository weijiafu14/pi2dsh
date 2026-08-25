// Engine contract: `dsh plugin add pi2dsh` mounts ONE bridge that discovers
// and hosts every Pi package the user added to the profile. Discovery is
// manifest-driven (the profile's direct dependencies — each one an explicit
// `dsh plugin add`), identification uses Pi's own markers, and explicit
// config narrows or overrides it.
import { realpathSync } from 'node:fs'
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
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { apply, discoverProfilePiPackages, findProfileRoot, inject, name } from '../src/engine.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function makeProfile(dependencies: Record<string, string>, bundles: string[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi2dsh-engine-profile-'))
  cleanup.push(root)
  await writeFile(join(root, 'cordis.yml'), '- name: dsh-base\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies,
    dsh: { profile: { bundles } },
  }, null, 2))
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

async function mountAgentRuntime(ctx: Context, agent: Record<string, unknown>): Promise<Scope> {
  const scope = createScope(ctx, agent as never)
  const agentCtx = scope.ctx.extend({ agent: agent as never })
  agent.ctx = agentCtx
  // The official publication notifications, exactly as agent-loop's publish()
  // delivers them. The engine's single mount path listens for agent/created
  // and mounts every prepared Pi package into agent.ctx; its assemble and
  // pre-execute gates hold model-facing work until that mount lands.
  agentEvents(ctx, agent as never).emit('agent/created', { agent: agent as never })
  agentEvents(ctx, agent as never).emit('agent/session-start', { source: 'startup' })
  return scope
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

  // A suite (dsh-x's shape): one profile dependency whose manifest lists the
  // Pi packages it carries. Members are the suite's OWN dependencies — under
  // pnpm's isolated layout they are unreachable from the profile root, so
  // each member must resolve anchored at the suite package.
  it('expands a pi2dsh.suite manifest into members anchored at the suite package', async () => {
    const root = await makeProfile({ 'dsh-x': '1.0.0', 'pi-direct': '1.0.0' })
    await installFixturePackage(root, 'pi-direct', { pi: { extensions: ['main.js'] } }, { 'main.js': '' })
    await installFixturePackage(root, 'dsh-x', {
      pi2dsh: { suite: ['pi-suite-member', 'pi-direct', 'pi2dsh', '', 42] },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    const found = await discoverProfilePiPackages(root)
    // Members surface without a profile-root install; the engine itself and
    // junk entries are dropped; a name discovered both directly and via the
    // suite mounts once (profile order first).
    expect(found.map(pkg => pkg.name).sort()).toEqual(['pi-direct', 'pi-suite-member'])
    const member = found.find(pkg => pkg.name === 'pi-suite-member')
    // The anchor is the suite's REAL directory: under pnpm the profile entry
    // is a symlink into .pnpm, and only the realpath has the suite's own
    // dependencies as resolvable neighbours.
    expect(member?.anchor).toBe(join(realpathSync(join(root, 'node_modules', 'dsh-x')), 'package.json'))
    const direct = found.find(pkg => pkg.name === 'pi-direct')
    expect(direct?.anchor).toBeUndefined()
  })

  it('suite members honor exclude like any discovered package', async () => {
    const root = await makeProfile({ 'dsh-x': '1.0.0' })
    await installFixturePackage(root, 'dsh-x', {
      pi2dsh: { suite: ['pi-kept', 'pi-dropped'] },
    })
    const found = await discoverProfilePiPackages(root, { exclude: ['pi-dropped'] })
    expect(found.map(pkg => pkg.name)).toEqual(['pi-kept'])
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
    await mountAgentRuntime(ctx, agent)
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

  it('mounts the built-in OAuth login command before any community Pi package is installed', async () => {
    const root = await makeProfile({})
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`

    await apply(ctx, {})
    await settle()

    const typedCtx = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      commands: { list(agent: unknown): Array<{ name: string }> }
    }
    const session = typedCtx.sessions.create(SessionId('pi2dsh-engine-builtins'), {
      meta: { createdAt: Date.now(), cwd: root },
    })
    const agent = { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    await mountAgentRuntime(ctx, agent)

    expect(typedCtx.commands.list(agent).map(command => command.name)).toContain('login')
  })

  it('host anchor carries host-level halves with zero agents and never doubles agent-facing surfaces', async () => {
    const root = await makeProfile({ 'pi-anchored': '1.0.0' })
    await installFixturePackage(root, 'pi-anchored', { pi: { extensions: ['extension.ts'], skills: ['skills'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        '  pi.registerTool({',
        "    name: 'anchor_probe_tool',",
        "    description: 'probe',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        "    async execute() { return { content: [{ type: 'text', text: 'ok' }] } },",
        '  })',
        "  pi.registerCommand('anchor-probe', { description: 'probe', handler: async () => {} })",
        '}',
      ].join('\n'),
      'skills/anchored/SKILL.md': '---\nname: anchored-skill\ndescription: proves host-level skills mount at apply\n---\nPI2DSH_ANCHOR_SKILL_OK\n',
    })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
    await apply(ctx, {})
    await settle()

    // Host half, with ZERO agents: the skill is discoverable from engine
    // apply alone (web boots with no session; /login-class capabilities must
    // not wait for one).
    const signal = new AbortController().signal
    const skills = await (ctx as unknown as {
      skills: { list(options: Record<string, unknown>): Promise<Array<{ name: string }>> }
    }).skills.list({ cwd: root, signal })
    expect(skills.map(skill => skill.name)).toContain('anchored-skill')

    // Agent-facing halves are NOT projected by the anchor: no tool and no
    // command exist before an agent mounts…
    const typedCtx = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      commands: { list(agent: unknown): Array<{ name: string }> }
      tools: { execute(request: Record<string, unknown>): Promise<{ isError?: boolean, content: Array<{ text?: string }> }> }
    }
    const bare = { id: 'anchor-bare', steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    expect(typedCtx.commands.list(bare).map(command => command.name)).not.toContain('anchor-probe')

    // …and exactly ONE of each exists after one agent mounts (no anchor twin,
    // no /anchor-probe-2 numbered collision).
    const session = typedCtx.sessions.create(SessionId('pi2dsh-anchor-agent'), {
      meta: { createdAt: Date.now(), cwd: root },
    })
    const agent = { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    await mountAgentRuntime(ctx, agent)
    // The per-agent mount is asynchronous; the tool/assembly gates await it,
    // the command palette simply converges. Poll for the converged palette.
    let named: string[] = []
    for (let waited = 0; waited < 5000; waited += 50) {
      named = typedCtx.commands.list(agent).map(command => command.name).filter(name => name.startsWith('anchor-probe'))
      if (named.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(named).toEqual(['anchor-probe'])
    const result = await typedCtx.tools.execute({
      signal,
      callId: CallId('anchor-probe-call'),
      name: 'anchor_probe_tool',
      arguments: {},
      agent: agent as never,
    })
    expect(result.isError ?? false).toBe(false)
  })

  it('creates one isolated Pi runtime per Agent and disposing A leaves B live', async () => {
    const root = await makeProfile({ 'pi-isolation': '1.0.0' })
    const counter = join(root, 'factory-counter')
    await installFixturePackage(root, 'pi-isolation', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
        `const counter = ${JSON.stringify(counter)}`,
        'export default function extension(pi: any) {',
        "  const instance = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) + 1 : 1",
        "  writeFileSync(counter, String(instance))",
        '  let starts = 0',
        "  pi.on('session_start', () => { starts += 1 })",
        '  pi.registerTool({',
        "    name: 'agent_isolation_probe',",
        "    description: 'Reports this extension factory instance.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        '    async execute() {',
        "      return { content: [{ type: 'text', text: `instance:${instance};starts:${starts}` }] }",
        '    },',
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

    const sessions = (ctx as unknown as { sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } } }).sessions
    const makeAgent = (id: string): Record<string, unknown> => {
      const session = sessions.create(SessionId(id), { meta: { createdAt: Date.now(), cwd: root } })
      return { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    }
    const agentA = makeAgent('pi2dsh-agent-a')
    const agentB = makeAgent('pi2dsh-agent-b')
    const scopeA = await mountAgentRuntime(ctx, agentA)
    await mountAgentRuntime(ctx, agentB)

    const execute = async (agent: Record<string, unknown>): Promise<string | undefined> => {
      const result = await (ctx as unknown as {
        tools: { execute(request: Record<string, unknown>): Promise<{ content: Array<{ text?: string }> }> }
      }).tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`probe-${String(agent.id)}`),
        name: 'agent_isolation_probe',
        arguments: {},
        agent,
      })
      return result.content[0]?.text
    }

    const a = await execute(agentA)
    const b = await execute(agentB)
    expect(a).toMatch(/^instance:\d+;starts:1$/u)
    expect(b).toMatch(/^instance:\d+;starts:1$/u)
    expect(a).not.toBe(b)

    agentEvents(ctx, agentA as never).emit('agent/disposed', {})
    await scopeA.dispose()
    await expect(execute(agentB)).resolves.toBe(b)
  })

  it('a package registering a built-in provider id overlays the builtin base and becomes a native route', async () => {
    // The engine preloads built-in OAuth directory entries (openai-codex,
    // kimi-coding, …) as the BUILTIN BASE LAYER of Pi's layered ledger. A
    // package registering the SAME provider id overlays it field-wise — its
    // transport and catalog become the live definition (leaving the login
    // placeholder as the canonical is what silently produced "OAuth line
    // logged, no native route, no models" in the kimi-coding regression),
    // while fields the package does not define keep the builtin base.
    const root = await makeProfile({ 'pi-kimi-shape': '1.0.0' })
    await installFixturePackage(root, 'pi-kimi-shape', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        "  pi.registerProvider('kimi-coding', {",
        "    baseUrl: 'https://gw.example/anthropic',",
        "    api: 'openai-completions',",
        '    streamSimple: async function* () { yield { type: "done" } },',
        "    models: [{ id: 'kimi-test-1', name: 'Kimi Test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],",
        "    oauth: { name: 'Kimi (OAuth)', login: async () => ({ type: 'oauth' }) },",
        '  })',
        '}',
      ].join('\n'),
    })
    const { ctx, llm } = await makeLlmContext(root)
    await apply(ctx, {})
    await settle()

    // The package's transport definition became the live route under the
    // built-in id, with the package's own catalog — with zero live agents.
    expect(llm.listProviders().map(provider => provider.id)).toContain('kimi-coding')
    const models = await llm.listModels('kimi-coding')
    expect(models.map(model => model.id)).toContain('kimi-test-1')
  })

  it('a later package overlays an earlier one on the same provider id, and unregistering restores the earlier layer', async () => {
    // Pi's contract: registrations layer, later ones override earlier ones
    // (in Pi "later" is load order — each session rebuilds the runtime), and
    // unregistering an overlay restores what is underneath. The old flat
    // first-wins ledger inverted this: the first package froze the canonical
    // and a user installing a replacement gateway saw nothing change.
    const root = await makeProfile({ 'pi-gw-first': '1.0.0', 'pi-gw-second': '1.0.0' })
    await installFixturePackage(root, 'pi-gw-first', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        "  pi.registerProvider('gw-shared', {",
        "    baseUrl: 'https://first.example',",
        "    api: 'openai-completions',",
        '    streamSimple: async function* () { yield { type: "done" } },',
        "    models: [{ id: 'model-first', name: 'First', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],",
        '  })',
        '}',
      ].join('\n'),
    })
    await installFixturePackage(root, 'pi-gw-second', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        "  pi.registerProvider('gw-shared', {",
        "    baseUrl: 'https://second.example',",
        "    api: 'openai-completions',",
        '    streamSimple: async function* () { yield { type: "done" } },',
        "    models: [{ id: 'model-second', name: 'Second', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],",
        '  })',
        '  pi.registerTool({',
        "    name: 'drop_gw_overlay',",
        "    description: 'Unregisters this package\\'s gw-shared overlay.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        '    async execute() {',
        "      pi.unregisterProvider('gw-shared')",
        "      return { content: [{ type: 'text', text: 'dropped' }] }",
        '    },',
        '  })',
        '}',
      ].join('\n'),
    })
    const { ctx, llm } = await makeLlmContext(root)
    await apply(ctx, {})
    await settle()

    // Later package wins while both overlays stand.
    let models = await llm.listModels('gw-shared')
    expect(models.map(model => model.id)).toContain('model-second')
    expect(models.map(model => model.id)).not.toContain('model-first')

    // Unregistering the later overlay restores the earlier layer — and the
    // route is REBUILT from the restored composition, not just retired.
    const sessions = (ctx as unknown as { sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } } }).sessions
    const session = sessions.create(SessionId('pi2dsh-ledger-agent'), { meta: { createdAt: Date.now(), cwd: root } })
    const agent: Record<string, unknown> = { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    await mountAgentRuntime(ctx, agent)
    await (ctx as unknown as {
      tools: { execute(request: Record<string, unknown>): Promise<unknown> }
    }).tools.execute({
      signal: new AbortController().signal,
      callId: CallId('drop-gw-overlay'),
      name: 'drop_gw_overlay',
      arguments: {},
      agent,
    })
    await settle()
    models = await llm.listModels('gw-shared')
    expect(models.map(model => model.id)).toContain('model-first')
    expect(models.map(model => model.id)).not.toContain('model-second')
  })

  it("the Pi cross-extension event bus is shared per agent: same-agent packages hear each other, other agents do not", async () => {
    // Pi's loader hands ONE event bus to every extension of a session
    // (loader.ts:550 at the pinned upstream). The old per-package emitter
    // silently broke cooperating packages: A's emit never reached B.
    const root = await makeProfile({ 'pi-bus-sender': '1.0.0', 'pi-bus-receiver': '1.0.0' })
    await installFixturePackage(root, 'pi-bus-sender', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        '  pi.registerTool({',
        "    name: 'bus_send',",
        "    description: 'Broadcasts on the shared Pi event bus.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        '    async execute() {',
        "      pi.events.emit('pi2dsh-bus-test', 'ping')",
        "      return { content: [{ type: 'text', text: 'sent' }] }",
        '    },',
        '  })',
        '}',
      ].join('\n'),
    })
    await installFixturePackage(root, 'pi-bus-receiver', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        '  const received: string[] = []',
        "  pi.events.on('pi2dsh-bus-test', (data: unknown) => { received.push(String(data)) })",
        '  pi.registerTool({',
        "    name: 'bus_report',",
        "    description: 'Reports what this instance heard on the bus.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        '    async execute() {',
        "      return { content: [{ type: 'text', text: received.join(',') }] }",
        '    },',
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

    const sessions = (ctx as unknown as { sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } } }).sessions
    const makeAgent = (id: string): Record<string, unknown> => {
      const session = sessions.create(SessionId(id), { meta: { createdAt: Date.now(), cwd: root } })
      return { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    }
    const agentA = makeAgent('pi2dsh-bus-agent-a')
    const agentB = makeAgent('pi2dsh-bus-agent-b')
    await mountAgentRuntime(ctx, agentA)
    await mountAgentRuntime(ctx, agentB)

    const execute = async (agent: Record<string, unknown>, name: string): Promise<string | undefined> => {
      const result = await (ctx as unknown as {
        tools: { execute(request: Record<string, unknown>): Promise<{ content: Array<{ text?: string }> }> }
      }).tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`bus-${name}-${String(agent.id)}`),
        name,
        arguments: {},
        agent,
      })
      return result.content[0]?.text
    }

    await execute(agentA, 'bus_send')
    // Same agent: the receiver package heard the sender package.
    await expect(execute(agentA, 'bus_report')).resolves.toBe('ping')
    // Different agent: its bus is separate, nothing arrived.
    await expect(execute(agentB, 'bus_report')).resolves.toBe('')
  })

  it("cancelling a dialog's ExtensionUIDialogOptions.signal dismisses the DSH question and resolves undefined", async () => {
    // Upstream host-scenario checklist (pi-mcp-adapter OAuth): the package
    // races the localhost callback against a manual paste box —
    // `ui.input(title, undefined, { signal })` — and aborts the loser in a
    // finally block (mcp-auth-flow.ts waitForAuthorizationResponse). Pi's
    // trailing dialog argument is ExtensionUIDialogOptions ({ signal?,
    // timeout? }, types.ts:96): treating it as a bare AbortSignal silently
    // dropped the cancellation, leaving the paste box on screen after the
    // browser login had already succeeded.
    const authorizationUrl = 'https://auth.example.test/authorize?client_id=pi2dsh&state=dialog-projection'
    const terminalPrompt = [
      'Complete example OAuth',
      '',
      `\u001b]8;;${authorizationUrl}\u001b\\Open authorization page\u001b]8;;\u001b\\`,
      authorizationUrl,
      '',
      'Approve access, then return to DSH.',
    ].join('\n')
    const root = await makeProfile({ 'pi-dialog-cancel': '1.0.0' })
    await installFixturePackage(root, 'pi-dialog-cancel', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        'export default function extension(pi: any) {',
        '  pi.registerTool({',
        "    name: 'dialog_cancel_probe',",
        "    description: 'Races a dialog against a programmatic dismissal.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        '    async execute(_id: string, _args: unknown, _signal: AbortSignal, _update: unknown, ctx: any) {',
        '      const controller = new AbortController()',
        `      const pending = ctx.ui.input(${JSON.stringify(terminalPrompt)}, undefined, { signal: controller.signal })`,
        '      setTimeout(() => controller.abort(), 25)',
        '      const answer = await pending',
        "      return { content: [{ type: 'text', text: `answer:${String(answer)}` }] }",
        '    },',
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
    // Human interaction demands the exact live registry agent, so this
    // scenario runs on a REAL registry-published agent, not a hand-rolled one.
    const { default: LlmRuntime } = await import('@deepseek-ai/dsh-llm')
    const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
    const { default: AgentLoop } = await import('@deepseek-ai/dsh-agent-loop')
    await ctx.plugin(LlmRuntime as never, {} as never)
    await ctx.plugin(AgentRegistry as never, {} as never)
    await ctx.plugin(AgentLoop as never, {} as never)
    const { default: UserQuestionService } = await import('@deepseek-ai/dsh-user-questions')
    await ctx.plugin(UserQuestionService as never, {} as never)
    // A hanging provider standing in for a real UI: it never answers on its
    // own and withdraws the question only when the request's signal aborts —
    // exactly what a human-facing surface does when the dialog is dismissed.
    let sawSignal = false
    let seenQuestion: { question: string; detail?: string } | undefined
    ;(ctx as unknown as { userQuestions: { registerProvider(provider: unknown): unknown } }).userQuestions.registerProvider({
      async ask(request: { questions: Array<{ id: string; question: string; detail?: string }>; signal?: AbortSignal }) {
        sawSignal = request.signal instanceof AbortSignal
        seenQuestion = request.questions[0]
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => { reject(new Error('question withdrawn')) }, { once: true })
        })
      },
    })
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
    await apply(ctx, {})

    const registry = (ctx as unknown as {
      agents: { create(options: Record<string, unknown>): Promise<{ agent: Record<string, unknown> }> }
    }).agents
    const { agent } = await registry.create({ sessionId: SessionId('pi2dsh-dialog-cancel') })

    const result = await (ctx as unknown as {
      tools: { execute(request: Record<string, unknown>): Promise<{ content: Array<{ text?: string }> }> }
    }).tools.execute({
      signal: new AbortController().signal,
      callId: CallId('dialog-cancel'),
      name: 'dialog_cancel_probe',
      arguments: {},
      agent,
    })
    // The abort reached the DSH question service (the withdrawal really
    // happened), and Pi's contract held: a dismissed dialog resolves
    // undefined, it does not throw at the package.
    expect(sawSignal).toBe(true)
    expect(result.content[0]?.text).toBe('answer:undefined')
    expect(seenQuestion).toEqual({
      id: 'pi2dsh-input',
      question: 'Complete example OAuth',
      detail: `[Open authorization page](${authorizationUrl})\n\nApprove access, then return to DSH.`,
    })
    expect(JSON.stringify(seenQuestion)).not.toContain('\u001b')
    expect(seenQuestion?.detail?.split(authorizationUrl)).toHaveLength(2)
  })

  it('a slow package operation outliving its disposed agent fails catchably, never crashing the host', async () => {
    // Upstream host-scenario checklist (pi-mcp-adapter "initializeMcp vs. a
    // ctx invalidated mid-connect"): a package starts a slow connect-like
    // operation, the agent is disposed before it finishes, and the late ctx
    // use must be a catchable failure or a no-op — a bridge that lets it
    // escape as an unhandled rejection takes down the whole DSH host.
    const root = await makeProfile({ 'pi-race-connect': '1.0.0' })
    const resultFile = join(root, 'race-result')
    await installFixturePackage(root, 'pi-race-connect', { pi: { extensions: ['extension.ts'] } }, {
      'extension.ts': [
        "import { writeFileSync } from 'node:fs'",
        `const resultFile = ${JSON.stringify(resultFile)}`,
        // The write helper swallows fs errors: the temp dir may already be
        // gone when a late timer fires after the test — that cleanup race is
        // not the contract under test.
        'const record = (text: string) => { try { writeFileSync(resultFile, text) } catch {} }',
        'let starts = 0',
        'export default function extension(pi: any) {',
        "  pi.on('session_start', (_event: unknown, ctx: any) => {",
        '    starts += 1',
        '    record(`started:${starts}`)',
        '    setTimeout(() => {',
        '      try {',
        "        ctx.sendMessage({ content: 'late after dispose' })",
        "        record(`completed:${starts}`)",
        '      } catch {',
        "        record(`caught:${starts}`)",
        '      }',
        '    }, 80)',
        '  })',
        '  pi.registerTool({',
        "    name: 'race_probe',",
        "    description: 'Liveness probe.',",
        "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
        "    async execute() { return { content: [{ type: 'text', text: 'alive' }] } },",
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

    const escaped: unknown[] = []
    const onRejection = (reason: unknown): void => { escaped.push(reason) }
    process.on('unhandledRejection', onRejection)
    try {
      const sessions = (ctx as unknown as { sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } } }).sessions
      const makeAgent = (id: string): Record<string, unknown> => {
        const session = sessions.create(SessionId(id), { meta: { createdAt: Date.now(), cwd: root } })
        return { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
      }
      const doomed = makeAgent('pi2dsh-race-doomed')
      const scope = await mountAgentRuntime(ctx, doomed)
      // Wait until the package's slow operation has actually started — the
      // race is only real if dispose lands while it is in flight.
      const { readFile: readResult } = await import('node:fs/promises')
      for (let tick = 0; tick < 50; tick += 1) {
        const marker = await readResult(resultFile, 'utf8').catch(() => undefined)
        if (marker?.startsWith('started') === true) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      // Exactly ONE session_start reached the handler (Pi's once-per-instance
      // contract) — a doubled dispatch would fork two timers and betray a
      // duplicated lifecycle delivery.
      expect(await readResult(resultFile, 'utf8')).toBe('started:1')
      // Dispose while the package's slow operation is still pending.
      agentEvents(ctx, doomed as never).emit('agent/disposed', {})
      await scope.dispose()
      await new Promise(resolve => setTimeout(resolve, 160))

      // The late ctx use resolved catchably (either the surface no-opped or
      // threw a catchable error) — and nothing escaped the event loop.
      const outcome = await readResult(resultFile, 'utf8')
      expect(['caught:1', 'completed:1']).toContain(outcome)
      expect(escaped).toEqual([])

      // The host is intact: a fresh agent mounts and executes normally.
      const survivor = makeAgent('pi2dsh-race-survivor')
      await mountAgentRuntime(ctx, survivor)
      const result = await (ctx as unknown as {
        tools: { execute(request: Record<string, unknown>): Promise<{ content: Array<{ text?: string }> }> }
      }).tools.execute({
        signal: new AbortController().signal,
        callId: CallId('race-probe'),
        name: 'race_probe',
        arguments: {},
        agent: survivor,
      })
      expect(result.content[0]?.text).toBe('alive')
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

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
