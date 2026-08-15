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
import { applyPiHost } from './host.js'
import { ensureModelsJsonRoutes } from './runtime.js'
import { resolvePiPackage } from './source.js'

export interface EngineConfig {
  /** Mount exactly these packages (skips discovery). */
  packages?: string[]
  /** Never mount these packages even when discovered. */
  exclude?: string[]
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
  const manifestText = await readFile(join(profileRoot, 'package.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as { dependencies?: Record<string, string> }
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
  if (packages.length === 0) {
    // The single-directory capability (models.json providers + companion
    // routes in the DSH picker) is the bridge's own — it works with zero
    // Pi packages installed.
    await ensureModelsJsonRoutes(ctx)
    info('[pi2dsh engine] no Pi packages installed in this profile yet — add one with: dsh plugin --profile <p> add <pi-package>')
    return
  }
  info(`[pi2dsh engine] mounting ${packages.length} Pi package(s): ${packages.map(pkg => pkg.name).join(', ')}`)
  await applyPiHost(
    ctx,
    { packages: packages.map(pkg => ({ name: pkg.name })) },
    join(profileRoot, 'package.json'),
  )
}
