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
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { applyPreparedPiHost, preparePiHost, type PreparedPiHostPackage } from './host.js'
import { registerVisionCompanions } from './runtime.js'
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
  return discovered
}

/** Discover a surface-owned, pre-publication Agent setup event from direct dependencies. */
export async function discoverAgentSetupEvent(profileRoot: string): Promise<string | undefined> {
  const manifest = await readProfileManifest(profileRoot)
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!bundles.has(name)) continue
    const dir = resolveDependencyDir(profileRoot, name)
    if (dir === undefined) continue
    try {
      const dependency = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
        dshTui?: { agentSetupEvent?: unknown }
      }
      const event = dependency.dshTui?.agentSetupEvent
      if (typeof event === 'string' && event.length > 0) return event
    } catch {
      // Package discovery already reports unreadable direct dependencies. A
      // surface capability probe only decides between scoped and legacy mount.
    }
  }
  return undefined
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

  const packages = Array.isArray(config.packages) && config.packages.length > 0
    ? config.packages.map(name => ({ name }))
    : await discoverProfilePiPackages(profileRoot, {
        ...(Array.isArray(config.exclude) ? { exclude: config.exclude } : {}),
        warn,
      })
  registerVisionCompanions(ctx, config.visionCompanions)
  let prepared: PreparedPiHostPackage[]
  if (packages.length === 0) {
    // The host itself owns Pi's built-in provider directory and `/login`.
    // Mount an empty internal package so those host-level capabilities exist
    // even before the user installs their first community Pi package. Calling
    // registerVisionCompanions alone here left a fresh engine unable to run
    // `/login openai-codex`: DSH treated the unknown slash line as a model
    // prompt and failed on the unrelated default provider credential.
    prepared = [{
      name: 'pi2dsh-builtins',
      rootUrl: new URL('.', import.meta.url),
      manifest: {
        schemaVersion: 1,
        package: { name: 'pi2dsh-builtins', version: '0.0.0', source: 'engine' },
        extensions: [],
        skillDirs: [],
        prompts: [],
      },
    }]
    info('[pi2dsh engine] no Pi packages installed in this profile yet — add one with: dsh plugin --profile <p> add <pi-package>')
  } else {
    info(`[pi2dsh engine] preparing ${packages.length} Pi package(s): ${packages.map(pkg => pkg.name).join(', ')}`)
    prepared = await preparePiHost(
      { packages: packages.map(pkg => ({ name: pkg.name })) },
      join(profileRoot, 'package.json'),
    )
  }

  const agentSetupEvent = await discoverAgentSetupEvent(profileRoot)
  if (agentSetupEvent === undefined) {
    // Web, headless and older TUI surfaces do not expose a pre-publication
    // contributor seam. Preserve pi2dsh's established host-scoped behavior on
    // those products; the per-Agent path below is an additive surface
    // capability, never a regression for existing profiles.
    await applyPreparedPiHost(ctx, prepared)
    return
  }

  // dsh-TUI runs this serial event from its existing agents.create/resume
  // setup callback, after preset composition and before DSH publishes the
  // Agent. Every Agent therefore receives fresh Pi extension instances and
  // owns their effects through its agentCtx; stock DSH Core needs no patch.
  ;(ctx as unknown as {
    on(name: string, listener: (payload: { agent: Record<string, unknown>, agentCtx: Context }) => Promise<void>): () => void
  }).on(agentSetupEvent, async ({ agent, agentCtx }) => {
    await applyPreparedPiHost(agentCtx, prepared, agent)
  })
}
