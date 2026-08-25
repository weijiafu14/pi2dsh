// The pi2dsh engine: ONE installed copy of the bridge that mounts every Pi
// package the user has added to their DSH profile.
//
//   dsh plugin --profile p add pi2dsh              ← the engine (this plugin)
//   dsh plugin --profile p add @kassing/pi-vision  ← plain npm dependency
//   dsh plugin --profile p add pi-vision-tool      ← plain npm dependency
//
// DSH's plugin manager records only packages that declare `dsh.bundle` as
// profile layers; everything else stays an ordinary dependency ("a plain
// library is fine"). The engine reads the profile manifest's DIRECT
// dependencies — every entry there was an explicit `dsh plugin add` — and
// mounts each package that identifies as a Pi package, all through one
// bridge instance: one model ledger, one command space, one upgrade unit.
//
// Discovery is manifest-driven, never a node_modules scan (the lesson from
// Prettier 3 dropping directory-based plugin discovery): the dependency list
// is the user's explicit intent, and package identification uses the same
// Pi markers `resolvePiPackage` has always used (the `pi` manifest field,
// with Pi's directory conventions as fallback).

import { readFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { applyPreparedPiHost, preparePiHost, type PreparedPiHostPackage } from './host.js'
import { registerChildExtensionCatalog, registerVisionCompanions } from './runtime.js'
import { providePiExtensionDiscovery } from './compat/pi-coding-agent.js'
import { resolvePiPackage } from './source.js'

export interface EngineConfig {
  /** Mount exactly these packages (skips discovery). */
  packages?: string[]
  /** Never mount these packages even when discovered. */
  exclude?: string[]
  /**
   * Image-admission companion routes. Default: AUTOMATIC — every text-only
   * llm route gets a \`<route>-vision\` companion that admits pasted images
   * (a mounted vision extension analyzes them; without one the image is
   * materialized to a file any image-capable tool can read). \`false\`
   * turns companions off; an explicit \`{ <route>: [modelIds] }\` narrows.
   */
  visionCompanions?: false | Record<string, readonly string[]>
}

/** Locate the DSH profile root: the nearest ancestor holding cordis.yml. */
export function findProfileRoot(start: string): string | undefined {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'cordis.yml')) && existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

interface DiscoveredPackage {
  name: string
  dir: string
  /** Resolution anchor when the package is carried by a suite (its members
   * are the suite's dependencies, unreachable from the profile root under
   * pnpm's isolated layout). */
  anchor?: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

async function readProfileManifest(profileRoot: string): Promise<ProfileManifest> {
  return JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8')) as ProfileManifest
}

function resolveDependencyDir(profileRoot: string, name: string): string | undefined {
  // Direct dependencies of the profile live under its node_modules by name
  // (pnpm links them there); resolving by path needs no exports gymnastics.
  const dir = join(profileRoot, 'node_modules', name)
  return existsSync(join(dir, 'package.json')) ? dir : undefined
}

/**
 * The profile's direct dependencies that identify as Pi packages: not the
 * engine itself, not a `dsh.bundle` (those are DSH plugins, not Pi
 * packages), carrying either Pi's `pi` manifest field or extension sources
 * under Pi's directory conventions.
 */
export async function discoverProfilePiPackages(
  profileRoot: string,
  options: { exclude?: string[], warn?: (message: string) => void } = {},
): Promise<DiscoveredPackage[]> {
  const warn = options.warn ?? (() => {})
  const excluded = new Set(options.exclude ?? [])
  const manifest = await readProfileManifest(profileRoot)
  const discovered: DiscoveredPackage[] = []
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name === 'pi2dsh' || excluded.has(name)) continue
    const dir = resolveDependencyDir(profileRoot, name)
    if (dir === undefined) {
      warn(`[pi2dsh engine] dependency ${JSON.stringify(name)} is not installed under the profile; skipping`)
      continue
    }
    let packageJson: Record<string, unknown>
    try {
      packageJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    } catch (error) {
      warn(`[pi2dsh engine] cannot read ${name}/package.json (${error instanceof Error ? error.message : String(error)}); skipping`)
      continue
    }
    // A suite: `pi2dsh: { suite: [names...] }` mounts the listed Pi packages
    // as if the user had added each one. The list is an explicit manifest —
    // the same discovery covenant as the profile dependency list, one hop
    // deeper — and the members are the suite's own dependencies, so each
    // resolves anchored at the suite package (pnpm keeps transitive
    // dependencies out of the profile root). One level only, no recursion.
    const suite = (packageJson.pi2dsh as { suite?: unknown } | undefined)?.suite
    if (Array.isArray(suite)) {
      // The anchor must be the suite's REAL directory: the profile's
      // node_modules entry is a pnpm symlink into .pnpm, and Node resolution
      // walks up from the anchor's literal path — only the realpath has the
      // suite's own dependencies as .pnpm neighbours.
      let anchorDir = dir
      try {
        anchorDir = realpathSync(dir)
      } catch { /* an unreadable dir keeps the literal path and fails loud in prepare */ }
      for (const member of suite) {
        if (typeof member !== 'string' || member.length === 0) continue
        if (member === 'pi2dsh' || excluded.has(member)) continue
        discovered.push({ name: member, dir, anchor: join(anchorDir, 'package.json') })
      }
      continue
    }
    // A dsh.bundle-declaring package is a DSH plugin layer, never a Pi package.
    if ((packageJson.dsh as { bundle?: unknown } | undefined)?.bundle !== undefined) continue
    if (packageJson.pi !== undefined && typeof packageJson.pi === 'object') {
      discovered.push({ name, dir })
      continue
    }
    // No `pi` field: fall back to Pi's directory conventions via the same
    // resolver every other mount path uses (a package with zero extension
    // sources is a plain library and stays unmounted).
    try {
      const pkg = await resolvePiPackage(dir)
      try {
        if (pkg.resources.extensions.length > 0) discovered.push({ name, dir })
      } finally {
        await pkg.dispose()
      }
    } catch {
      // Not resolvable as a Pi package — a plain library.
    }
  }
  // One mount per name. A package that is both a direct dependency and a
  // suite member mounts as the DIRECT dependency (the user's own explicit
  // add, resolved from the profile root) — the suite copy yields.
  const byName = new Map<string, DiscoveredPackage>()
  for (const pkg of discovered) {
    const existing = byName.get(pkg.name)
    if (existing === undefined || (existing.anchor !== undefined && pkg.anchor === undefined)) {
      byName.set(pkg.name, pkg)
    }
  }
  return [...byName.values()]
}

interface AgentScopedMount {
  ready: Promise<void>
  /** Set when the mount failed; the agent then runs as a plain DSH agent. */
  failure?: string
}

/** The loose shapes of the official DSH seams this file consumes. */
interface AgentLike {
  ctx: Context
}
interface EngineHostContext {
  /** Un-injected reflection access (the ctx.get('loader') idiom): the engine
   * must not hard-depend on the agent registry — compositions without one
   * (bare test hosts) simply have no agents to mount for. */
  get?(name: string): unknown
  tools?: { schemas?(scope: unknown): Array<{ name: string }> }
  on(name: string, listener: (...args: never[]) => unknown): () => void
}
interface AgentRegistryLike {
  roots?(): AgentLike[]
}

/**
 * The single mount path on every DSH surface: one Pi runtime per root Agent.
 *
 * Pi instantiates its extensions once per session; DSH's twin of that scope is
 * the Agent with its public `agent.ctx` ("contributions are agent-local,
 * unwind on disposal"). Mounting is driven purely by official core seams, so
 * the same semantics hold on the TUI, web, headless, ACP and config-declared
 * agents alike:
 *
 *   - `agent/created` fires on every publication path before the loop can run
 *     a first turn; it eagerly starts that agent's mount.
 *   - `system-prompt/assemble` (awaited waterfall, runs in every step's
 *     preStep) gates the assembly on the mount and patches the pre-waterfall
 *     tools snapshot from the official scoped projection `tools.schemas()` —
 *     stock DSH collects `assembly.tools` before dispatching the waterfall,
 *     so a mount that lands during the wait would otherwise miss turn one.
 *   - `tools/pre-execute` (awaited waterfall) closes the same window for
 *     direct executions that bypass assembly.
 *
 * `agent/session-start` deliberately is NOT the trigger: DSH documents it as a
 * veto-less notification that cannot gate startup. The waterfalls above are
 * the officially awaited seams, and the exact pattern of registering onto a
 * foreign agent's ctx from a lifecycle event is what DSH's own schedule
 * plugin ships.
 *
 * A mount failure never takes the Agent down: the agent keeps running as a
 * plain DSH agent, the failure is reported loudly once, and only the Pi
 * packages are missing — the capability-gap discipline, not a rollback.
 */
export function installAgentScopedMounts(
  ctx: Context,
  preparedPackages: Promise<readonly PreparedPiHostPackage[]>,
  report: { warn(message: string): void },
): void {
  const host = ctx as unknown as EngineHostContext
  const mounts = new WeakMap<object, AgentScopedMount>()

  const registry = (): AgentRegistryLike | undefined => {
    try {
      return host.get?.('agents') as AgentRegistryLike | undefined
    } catch {
      return undefined
    }
  }

  const isRootAgent = (agent: object): boolean => {
    // Subagents keep Pi's own sub-session semantics through the session
    // bridge; only runtime roots receive a Pi runtime (the same distinction
    // DSH's schedule plugin draws via agents.roots()).
    const agents = registry()
    const roots = agents?.roots
    if (typeof roots !== 'function') return true
    try {
      return (roots.call(agents) as unknown[]).includes(agent)
    } catch {
      return true
    }
  }

  const ensureMount = (agent: AgentLike): AgentScopedMount => {
    let mount = mounts.get(agent)
    if (mount === undefined) {
      const started: AgentScopedMount = { ready: Promise.resolve() }
      started.ready = preparedPackages.then(async prepared => {
        if (prepared.length === 0) return
        try {
          await applyPreparedPiHost(agent.ctx, prepared, agent as unknown as Record<string, unknown>)
        } catch (error) {
          // Loud, once per agent; the gates resolve so the plain DSH agent
          // keeps working. Faking success is forbidden — the message names
          // what is missing.
          started.failure = error instanceof Error ? error.message : String(error)
          report.warn(`[pi2dsh engine] Pi packages failed to mount for this agent; it continues without them: ${started.failure}`)
        }
      })
      mounts.set(agent, started)
      mount = started
    }
    return mount
  }

  // Eager start on publication. `agent/created` reaches host-level listeners
  // on every create/resume/config path, before the loop can open a turn.
  host.on('agent/created', ((payload: { agent: AgentLike }) => {
    if (isRootAgent(payload.agent)) ensureMount(payload.agent)
  }) as never)

  // Correctness boundary #1: no prompt assembly for a root agent proceeds
  // before its Pi runtime is mounted, and the tools snapshot taken before
  // this waterfall is reconciled against the official scoped projection.
  host.on('system-prompt/assemble', (async (
    assembly: { tools: Array<{ name: string }> },
    context: { agent?: AgentLike },
    next: () => Promise<unknown>,
  ) => {
    const agent = context.agent
    if (agent !== undefined && isRootAgent(agent)) {
      await ensureMount(agent).ready
      const schemas = host.tools?.schemas
      if (typeof schemas === 'function') {
        const present = new Set(assembly.tools.map(tool => tool.name))
        for (const schema of schemas.call(host.tools, agent)) {
          if (!present.has(schema.name)) assembly.tools.push(schema)
        }
      }
    }
    return next()
  }) as never)

  // Correctness boundary #2: tool execution for a root agent waits for the
  // same mount (serially awaited by the tool runtime before dispatch).
  host.on('tools/pre-execute', (async (
    exec: { agent?: AgentLike },
    next: () => Promise<unknown>,
  ) => {
    if (exec.agent !== undefined && isRootAgent(exec.agent)) await ensureMount(exec.agent).ready
    return next()
  }) as never)

  // Backfill: agents published before this plugin finished loading (a surface
  // that skips the official await-the-loader pattern DSH's headless runner
  // uses). Their next assembly still passes the gates above.
  void preparedPackages.then(() => {
    const agents = registry()
    const roots = agents?.roots
    if (typeof roots !== 'function') return
    for (const agent of roots.call(agents)) ensureMount(agent)
  })
}

/** Cordis plugin surface: `dsh plugin add pi2dsh` mounts this. */
export const name = 'pi2dsh'
export const inject = ['tools', 'systemPrompt', 'commands', 'skills']

export async function apply(ctx: Context, config: EngineConfig = {}): Promise<void> {
  // Same emission as the runtime's logger helper: the cordis logger AND the
  // console — profile logger levels must never hide what the engine mounted.
  const log = (ctx as unknown as { logger?: { info?(m: string): void, warn?(m: string): void } }).logger
  const warn = (message: string): void => { log?.warn?.(message); console.warn(message) }
  const info = (message: string): void => { log?.info?.(message); console.log(message) }

  // The loader resolves plugins against the profile's baseUrl; that IS the
  // profile root. The ancestor walk from the installed engine is the
  // fallback for compositions without a loader (tests, hand-built hosts).
  const baseUrl = (ctx as unknown as { baseUrl?: string }).baseUrl
  const profileRoot = (baseUrl !== undefined ? findProfileRoot(fileURLToPath(new URL('.', baseUrl))) : undefined)
    ?? findProfileRoot(dirname(fileURLToPath(import.meta.url)))
  if (profileRoot === undefined) {
    throw new Error('pi2dsh engine: no DSH profile root (cordis.yml + package.json) above the installed engine — is pi2dsh installed via `dsh plugin add pi2dsh`?')
  }

  // The single mount path, before any await: gates and lifecycle listeners
  // must exist the moment a surface can publish its first Agent. Package
  // preparation resolves behind this promise; the gates hold each agent's
  // first assembly until its own mount lands.
  let resolvePrepared!: (prepared: readonly PreparedPiHostPackage[]) => void
  const preparedPackages = new Promise<readonly PreparedPiHostPackage[]>(resolve => {
    resolvePrepared = resolve
  })
  installAgentScopedMounts(ctx, preparedPackages, { warn })

  registerVisionCompanions(ctx, config.visionCompanions)

  try {
    // The host half, mounted exactly once regardless of packages or agents:
    // Pi's built-in provider directory, `/login`, and credential recovery.
    // Without it a fresh engine cannot run `/login openai-codex`: DSH treats
    // the unknown slash line as a model prompt and fails on the unrelated
    // default provider credential. Community packages join the same
    // SharedHostState (keyed on ctx.root), so host-level resources stay
    // single-instance no matter which agent scope mounts them.
    await applyPreparedPiHost(ctx, [{
      name: 'pi2dsh-builtins',
      rootUrl: new URL('.', import.meta.url),
      manifest: {
        schemaVersion: 1,
        package: { name: 'pi2dsh-builtins', version: '0.0.0', source: 'engine' },
        extensions: [],
        skillDirs: [],
        prompts: [],
      },
    }])

    const packages: Array<{ name: string, anchor?: string }> = Array.isArray(config.packages) && config.packages.length > 0
      ? config.packages.map(name => ({ name }))
      : await discoverProfilePiPackages(profileRoot, {
          ...(Array.isArray(config.exclude) ? { exclude: config.exclude } : {}),
          warn,
        })
    if (packages.length === 0) {
      info('[pi2dsh engine] no Pi packages installed in this profile yet — add one with: dsh plugin --profile <p> add <pi-package>')
      resolvePrepared([])
      return
    }
    info(`[pi2dsh engine] preparing ${packages.length} Pi package(s): ${packages.map(pkg => pkg.name).join(', ')}`)
    const prepared = await preparePiHost(
      {
        packages: packages.map(pkg =>
          pkg.anchor === undefined ? { name: pkg.name } : { name: pkg.name, anchor: pkg.anchor }),
      },
      join(profileRoot, 'package.json'),
    )
    // Child-extension catalog: what real Pi's createAgentSession "default-
    // discovered extensions" means on this host. Entries are each package's
    // DECLARED pi extension files (absolute, inside the installed dir), so a
    // creator's own filter code (pi-subagents' extensions/exclude/ext:
    // machinery) canonicalizes them exactly as it does on Pi. Mounting lands
    // on the child agent's OWN ctx — contributions unwind with the agent,
    // which is what makes per-child instances leak-free by construction.
    const entryCatalog = new Map<string, string>()
    for (const pkg of prepared) {
      const rootDir = fileURLToPath(pkg.rootUrl)
      // Resolved keys, because the consumer looks entries up by resolved path.
      for (const rel of pkg.manifest.extensions) entryCatalog.set(resolve(rootDir, rel), pkg.name)
    }
    providePiExtensionDiscovery([...entryCatalog.keys()].map(path => ({ path })))
    registerChildExtensionCatalog(ctx, {
      packageByEntryPath: entryCatalog,
      mount: async (childAgent, packageNames) => {
        const wanted = new Set(packageNames)
        const subset = prepared.filter(pkg => wanted.has(pkg.name))
        const scope = (childAgent as { ctx?: Context }).ctx
        if (scope === undefined) {
          return subset.map(pkg => ({ name: pkg.name, error: 'the child agent exposes no ctx scope to mount into' }))
        }
        return applyPreparedPiHost(scope, subset, childAgent)
      },
    })

    // Host anchors, before the per-Agent gates open: every package's
    // HOST-level contributions (provider routes, OAuth accounts, /login,
    // credential recovery, companions, skills) exist from engine apply — a
    // surface with zero live Agents (web at boot) still advertises them, the
    // first Agent's model resolution finds its routes, and routes survive
    // Agent churn. Anchors serve no Agent; sessions belong to the per-Agent
    // instances the gates mount.
    await applyPreparedPiHost(ctx, prepared, undefined, { hostAnchor: true })
    resolvePrepared(prepared)
  } catch (error) {
    // The gates must never hang on a failed preparation; agents keep running
    // as plain DSH agents while the engine failure propagates loudly.
    resolvePrepared([])
    throw error
  }
}
