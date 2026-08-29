// Native subagent coverage contract: the `serveNativeSubagents` engine config
// (default OFF) serves DSH-native subagents with the profile's Pi extensions.
//
// Lineage routing (one check per created Agent):
//  - Pi-origin (bridge) children are already served by the creator's per-spawn
//    loader mount; the `pi2dsh-sub-` session-id prefix identifies them on
//    creation AND on a persisted resume, so the native path skips them and a
//    bridge child is never mounted twice.
//  - DSH-native children (subagent origin, no bridge prefix) get the full
//    discovered set — Pi's default discovery, the catalog's no-loader path —
//    mounted onto the child's OWN ctx, unwinding with the child.
//  - Runtime roots are the root-mount path's territory: DSH's delegation
//    tools create children through a non-agent scope, so the registry can
//    report them as roots; the native path skips exactly those (the root
//    path serves and gates them) and serves the remainder.
// Served children are gated on their mount for their first turn: a direct
// tool execution issued before the mount lands must still resolve (the
// pre-execute gate), and the pre-waterfall tools snapshot is reconciled
// against the official scoped projection at assembly time.
//
// Probed through a real engine apply() on a fixture profile with two Pi
// packages. Each fixture extension names its tool per MOUNT: jiti caches the
// module (the body runs once per path), but the default-export factory is
// re-invoked on every mount, so a function-attached counter makes each mount
// register a DISTINCT name. A double mount is therefore visible as a second
// name per package, and same-name masking in the tool registry cannot hide it.
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CallId } from './lib/dsh-compat.js'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { apply } from '../src/engine.js'
import { getSharedChildExtensionCatalog, runtimeInternals } from '../src/runtime.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for: ${what}`)
    await delay(10)
  }
}

async function makeProfile(dependencies: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi2dsh-native-subagents-'))
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

function probeExtension(prefix: string, ledgerPath: string): string {
  return [
    "import { appendFileSync } from 'node:fs'",
    'export default function probe(pi) {',
    '  probe.mounts = (probe.mounts ?? 0) + 1',
    '  const n = probe.mounts',
    // Durable factory-invocation ledger. Registry-side oracles (name counts,
    // per-mount numbered names) CANNOT see a raced double mount: the second
    // apply onto the same scope trips DSH's duplicate prompt-section rejection
    // and unwinds itself, so the surviving registrations look exactly like a
    // single mount. The ledger records every factory invocation regardless of
    // whether its registrations survive.
    '  appendFileSync(' + JSON.stringify(ledgerPath) + ", '" + prefix + "\\n')",
    '  pi.registerTool({',
    '    name: `native_' + prefix + '_${n}`,',
    '    label: `Native probe ' + prefix + ' #${n}`,',
    "    description: 'Proves the native subagent mount path.',",
    "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
    "    async execute() { return { content: [{ type: 'text', text: `native-" + prefix + "-${n}` }] } },",
    '  })',
    // Stable-name tool (no native_ prefix, so nativeNames ignores it): the
    // first-turn gate contract executes THIS name on the child immediately
    // after creation, while the mount is still in flight.
    '  pi.registerTool({',
    "    name: 'gate_probe_" + prefix + "',",
    "    label: 'Gate probe " + prefix + "',",
    "    description: 'Stable-name tool for the first-turn gate contract.',",
    "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
    "    async execute() { return { content: [{ type: 'text', text: 'gate-ok' }] } },",
    '  })',
    '}',
  ].join('\n')
}

async function makeProbeProfile(): Promise<string> {
  const root = await makeProfile({ 'pi-probe-a': '1.0.0', 'pi-probe-b': '1.0.0' })
  const ledger = join(root, 'factory-invocations.log')
  await installFixturePackage(root, 'pi-probe-a', { pi: { extensions: ['extensions/probe.js'] } }, {
    'extensions/probe.js': probeExtension('a', ledger),
  })
  await installFixturePackage(root, 'pi-probe-b', { pi: { extensions: ['extensions/probe.js'] } }, {
    'extensions/probe.js': probeExtension('b', ledger),
  })
  return root
}

/** Factory invocations recorded so far for one package's extension. */
function ledgerCount(profileRoot: string, prefix: string): number {
  try {
    return readFileSync(join(profileRoot, 'factory-invocations.log'), 'utf8')
      .split('\n').filter(line => line === prefix).length
  } catch {
    return 0
  }
}

/**
 * The stock core services the engine hangs off, plus a REAL agent registry:
 * subagents here are what DSH's delegation tools produce — agents created
 * FROM the parent's scoped context (the registry records the runtime owner,
 * so roots() excludes them) whose session carries origin: "subagent".
 */
async function buildRuntime(root: string, config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt as never, { includeHarnessIdentity: false } as never)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(LlmRuntime as never, {} as never)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop as never, {} as never)
  ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
  await apply(ctx, config as never)
  await delay(25)
  return ctx
}

interface AgentHandle {
  agent: Record<string, unknown>
  dispose(): Promise<void>
}
interface AgentsFace {
  create(options: Record<string, unknown>): Promise<AgentHandle>
}
interface ToolsFace {
  schemas(agent: unknown): Array<{ name: string }>
  execute(request: Record<string, unknown>): Promise<{ isError?: boolean, content: Array<{ type: string, text?: string }> }>
}

async function createRoot(ctx: Context, sessionId: string): Promise<AgentHandle> {
  const agents = (ctx as unknown as { agents: AgentsFace }).agents
  return agents.create({ sessionId: SessionId(sessionId) })
}

async function createChildOf(parent: Record<string, unknown>, sessionId: string): Promise<AgentHandle> {
  const agents = (parent.ctx as unknown as { agents: AgentsFace }).agents
  return agents.create({ sessionId: SessionId(sessionId), meta: { origin: 'subagent' } })
}

function nativeNames(ctx: Context, agent: unknown): string[] {
  const tools = (ctx as unknown as { tools: ToolsFace }).tools
  return tools.schemas(agent).map(schema => schema.name).filter(name => name.startsWith('native_')).sort()
}

function nativeNamesSafe(ctx: Context, agent: unknown): string[] {
  try {
    return nativeNames(ctx, agent)
  } catch {
    // A disposed agent's scope is gone: no projection, no registrations.
    return []
  }
}

/**
 * The double-mount contract, relative form: exactly ONE name per package.
 * Absolute counter values are asserted nowhere — the engine's host anchor
 * consumes one factory call per package before any agent mounts (it projects
 * no DSH tools), so the root's own mount is already the second call.
 */
function expectOnePerPackage(names: string[]): void {
  expect(names).toHaveLength(2)
  expect(names.filter(name => name.startsWith('native_a_'))).toHaveLength(1)
  expect(names.filter(name => name.startsWith('native_b_'))).toHaveLength(1)
}

describe('serveNativeSubagents opt-in', () => {
  it('leaves native subagents plain when the flag is off (default)', async () => {
    const root = await makeProbeProfile()
    const ctx = await buildRuntime(root)

    const rootHandle = await createRoot(ctx, 'native-off-root')
    const childHandle = await createChildOf(rootHandle.agent, 'native-off-child')

    // Roots are served unconditionally — the flag governs native children only.
    await waitFor(() => nativeNames(ctx, rootHandle.agent).length === 2, 'root probe tools')
    expectOnePerPackage(nativeNames(ctx, rootHandle.agent))

    // The (absent) native mount path never runs: the child stays plain.
    await delay(50)
    expect(nativeNames(ctx, childHandle.agent)).toEqual([])

    await childHandle.dispose()
    await rootHandle.dispose()
  }, 20000)

  it('serves the full discovered set to native subagents when the flag is on', async () => {
    const root = await makeProbeProfile()
    const ctx = await buildRuntime(root, { serveNativeSubagents: true })

    const rootHandle = await createRoot(ctx, 'native-on-root')
    await waitFor(() => nativeNames(ctx, rootHandle.agent).length === 2, 'root probe tools')

    // Slow the CHILD's mount (wrapper around the shared catalog's mount —
    // the engine looks the property up at call time) so the first-turn gates
    // have a real race to hold: an ungated first assembly or execution would
    // provably miss the tools. The root's mount already landed, above, and
    // only mounts started after this point (the child's) pass the wrapper.
    const catalog = getSharedChildExtensionCatalog(ctx)
    if (catalog === undefined) throw new Error('child extension catalog missing')
    const originalMount = catalog.mount
    catalog.mount = (async (agent: Record<string, unknown>, names: string[]) => {
      await delay(50)
      return originalMount(agent, names)
    }) as never

    const childHandle = await createChildOf(rootHandle.agent, 'native-on-child')

    // Gate 2 (tools/pre-execute) fires FIRST and is not awaited yet: a direct
    // tool execution issued while the mount is still in flight must still
    // resolve — the gate holds the execution until the mount lands. Without
    // it the dispatch stage sees an unknown tool; that is exactly the live
    // depth-2 failure (the grandchild's first turn saw zero extension tools
    // because its mount raced its first model call).
    const tools = (ctx as unknown as { tools: ToolsFace }).tools
    const gateResultPromise = tools.execute({
      signal: new AbortController().signal,
      callId: CallId('native-child-gate'),
      name: 'gate_probe_a',
      arguments: {},
      agent: childHandle.agent as never,
    })

    // Gate 1 (system-prompt/assemble): assemble IMMEDIATELY — the worst-case
    // first-turn race. The pre-waterfall tools snapshot is taken before the
    // gate runs, so only the gate's wait + official-projection patch can put
    // the (not-yet-registered) extension tools into this assembly.
    const assembly = await (ctx as unknown as {
      systemPrompt: { assemble(context: unknown): Promise<{ tools: Array<{ name: string }> }> }
    }).systemPrompt.assemble(assembleContextFor(childHandle.agent as never))
    const assemblyNames = assembly.tools.map(tool => tool.name)
    expect(assemblyNames).toContain('gate_probe_a')
    expect(assemblyNames).toContain('gate_probe_b')

    const gateResult = await gateResultPromise
    expect(gateResult.isError ?? false).toBe(false)
    expect(gateResult.content[0]?.text).toBe('gate-ok')

    catalog.mount = originalMount
    await waitFor(() => nativeNames(ctx, childHandle.agent).length === 2, 'child probe tools')

    // Exactly ONE mount per package on each agent: a double mount would
    // surface a second name per package (the fixture names itself per mount).
    const rootNames = nativeNames(ctx, rootHandle.agent)
    const childNames = nativeNames(ctx, childHandle.agent)
    expectOnePerPackage(rootNames)
    expectOnePerPackage(childNames)
    // Separate mount instances: the child's names never overlap the root's.
    expect(childNames.filter(name => rootNames.includes(name))).toEqual([])

    // The child's tools are live and resolve through its own mount.
    const probeA = childNames.find(name => name.startsWith('native_a_'))!
    const result = await tools.execute({
      signal: new AbortController().signal,
      callId: CallId('native-child-probe'),
      name: probeA,
      arguments: {},
      agent: childHandle.agent as never,
    })
    expect(result.isError ?? false).toBe(false)
    expect(result.content[0]?.text).toMatch(/^native-a-\d+$/)

    // The child's mount never leaks onto the root.
    expect(nativeNames(ctx, rootHandle.agent)).toEqual(rootNames)

    // The mount unwinds with the child…
    await childHandle.dispose()
    await waitFor(() => nativeNamesSafe(ctx, childHandle.agent).length === 0, 'child mount unwind')

    // …and a later child mounts fresh from the same catalog (no leaked state):
    // again exactly one name per package, again distinct from the root's.
    const second = await createChildOf(rootHandle.agent, 'native-on-child-2')
    await waitFor(() => nativeNames(ctx, second.agent).length === 2, 'second child probe tools')
    const secondNames = nativeNames(ctx, second.agent)
    expectOnePerPackage(secondNames)
    expect(secondNames.filter(name => rootNames.includes(name))).toEqual([])
    expect(nativeNames(ctx, rootHandle.agent)).toEqual(rootNames)

    await second.dispose()
    await rootHandle.dispose()
  }, 20000)

  it('does not double-serve runtime-root subagent children (root path owns them)', async () => {
    const root = await makeProbeProfile()
    const ctx = await buildRuntime(root, { serveNativeSubagents: true })

    const rootHandle = await createRoot(ctx, 'rootchild-root')
    await waitFor(() => nativeNames(ctx, rootHandle.agent).length === 2, 'root probe tools')
    const rootNames = nativeNames(ctx, rootHandle.agent)

    // Falsifiable oracle for the partition (mutation-proven): registry-side
    // signals CANNOT catch a raced double serve — the second apply onto the
    // same scope trips DSH's duplicate prompt-section rejection, unwinds
    // itself, and leaves the survivor looking exactly like a single mount
    // (name counts AND per-mount numbered names both stay clean). What a
    // double serve DOES leave behind: a second factory invocation in the
    // on-disk ledger, and the loser's mount-failure warning. Sample both
    // around the child's creation.
    const invocationsBefore = ledgerCount(root, 'a')
    const warns: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(' ')) }

    try {
      // A subagent-origin child created through the HOST-LEVEL agents service
      // — the shape DSH's delegation tools produce live (their create call is
      // traced through a non-agent scope, so the registry records no runtime
      // owner): the registry reports the child as a runtime root, and the
      // root-mount path serves it. The native listener must NOT serve it too.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hostAgents = (ctx as any).get('agents')
      const rootChild = await hostAgents.create({
        sessionId: SessionId('rootchild-child'),
        meta: { origin: 'subagent' },
      })

      const agents = (ctx as unknown as { agents: { roots(): unknown[] } }).agents
      expect(agents.roots().includes(rootChild.agent)).toBe(true)

      // Served exactly once: the root path's mount.
      await waitFor(() => nativeNames(ctx, rootChild.agent).length === 2, 'root child probe tools')
      const childNames = nativeNames(ctx, rootChild.agent)
      expectOnePerPackage(childNames)
      expect(childNames.filter(name => rootNames.includes(name))).toEqual([])

      // Let any raced second mount land before sampling the ledger.
      await delay(300)
      expect(ledgerCount(root, 'a')).toBe(invocationsBefore + 1)
      expect(ledgerCount(root, 'b')).toBe(invocationsBefore + 1)
      expect(warns.filter(line => /did not mount|failed to mount/.test(line))).toEqual([])

      // The stable-name gate tool is live for the root child too (its path is
      // gated the same way), even though it is not this listener's child.
      const tools = (ctx as unknown as { tools: ToolsFace }).tools
      const gateResult = await tools.execute({
        signal: new AbortController().signal,
        callId: CallId('rootchild-gate'),
        name: 'gate_probe_a',
        arguments: {},
        agent: rootChild.agent as never,
      })
      expect(gateResult.isError ?? false).toBe(false)
      expect(gateResult.content[0]?.text).toBe('gate-ok')

      await rootChild.dispose()
      await rootHandle.dispose()
    } finally {
      console.warn = originalWarn
    }
  }, 20000)

  it('never double-mounts bridge children (pi2dsh-sub- prefix skip)', async () => {
    const root = await makeProbeProfile()
    const ctx = await buildRuntime(root, { serveNativeSubagents: true })

    const rootHandle = await createRoot(ctx, 'bridge-root')
    await waitFor(() => nativeNames(ctx, rootHandle.agent).length === 2, 'root probe tools')
    const rootNames = nativeNames(ctx, rootHandle.agent)
    expectOnePerPackage(rootNames)

    // A bridge child: subagent origin AND the bridge-minted session id prefix
    // (the id survives a persisted resume, so the skip holds on both paths).
    const bridgeChild = await createChildOf(rootHandle.agent, 'pi2dsh-sub-contract-1')

    // The native listener must have skipped it: no mount from this code path.
    await delay(50)
    expect(nativeNames(ctx, bridgeChild.agent)).toEqual([])

    // Simulate the bridge's own per-spawn loader mount: the catalog's
    // no-loader default-discovery set, mounted onto the child — exactly what
    // the bridge hook does at creation.
    const catalog = getSharedChildExtensionCatalog(ctx)
    expect(catalog).toBeDefined()
    const { names, failures } = runtimeInternals.resolveChildExtensionPackages(undefined, catalog!)
    expect(failures).toEqual([])
    expect(names.sort()).toEqual(['pi-probe-a', 'pi-probe-b'])
    const mountFailures = await catalog!.mount(bridgeChild.agent, names)
    expect(mountFailures).toEqual([])

    await waitFor(() => nativeNames(ctx, bridgeChild.agent).length === 2, 'bridge child mount')
    const bridgeNames = nativeNames(ctx, bridgeChild.agent)
    expectOnePerPackage(bridgeNames)
    expect(bridgeNames.filter(name => rootNames.includes(name))).toEqual([])

    // No second set appears on later ticks: the listener stays quiet for the
    // bridge child — the double-mount contract.
    await delay(100)
    expect(nativeNames(ctx, bridgeChild.agent)).toEqual(bridgeNames)

    await bridgeChild.dispose()
    await rootHandle.dispose()
  }, 20000)
})