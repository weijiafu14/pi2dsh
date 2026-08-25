// PiHostOnDSH: one DSH plugin that hosts unmodified Pi packages.
//
// Pi packages are ordinary npm dependencies of the profile; DSH's plugin
// manager (pnpm) installs them, and at load time this module resolves each
// installed package, discovers its Pi entry points, and mounts it through
// the same package-agnostic runtime. One host, any package — there is
// deliberately no per-package branching here.

import { existsSync, readFileSync } from 'node:fs'
import { readFile, stat, writeFile, mkdir, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { applyPiPackage, registerVisionCompanions } from './runtime.js'
import { resolvePiPackage } from './source.js'
import type { GeneratedRuntimeManifest, ResolvedPiPackage } from './types.js'

type UnknownRecord = Record<string, unknown>

export interface PiHostPackageSpec {
  /** npm package name as installed in the host bundle's node_modules. */
  name: string
  /** Optional per-package config forwarded to the runtime. */
  config?: UnknownRecord
  /**
   * Resolution anchor for THIS package (a package.json path). A suite's
   * members are its own dependencies, so under pnpm's isolated layout they
   * resolve from the suite package, not from the profile root.
   */
  anchor?: string
}

export interface PiHostConfig {
  packages: Array<string | PiHostPackageSpec>
  /** Image-admission companions: default automatic; `false` off; explicit map narrows. */
  visionCompanions?: false | Record<string, readonly string[]>
}

export interface PreparedPiHostPackage {
  readonly name: string
  readonly rootUrl: URL
  readonly manifest: GeneratedRuntimeManifest
  readonly config?: UnknownRecord
}

function parseFrontmatter(text: string): { attributes: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n?/gu, '\n')
  if (!normalized.startsWith('---')) return { attributes: {}, body: normalized }
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return { attributes: {}, body: normalized }
  const attributes: Record<string, string> = {}
  for (const line of normalized.slice(4, endIndex).split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key.length > 0) attributes[key] = value
  }
  return { attributes, body: normalized.slice(endIndex + 4).trim() }
}

/** Build a runtime manifest in place over an installed Pi package directory. */
export async function manifestForInstalled(pkg: ResolvedPiPackage): Promise<GeneratedRuntimeManifest> {
  const relativeTo = (file: string): string => relative(pkg.rootDir, file).replaceAll('\\', '/')

  const skillDirs = new Set<string>()
  for (const file of pkg.resources.skills) {
    // <dir>/<name>/SKILL.md contributes <dir>; a flat <dir>/<name>.md contributes <dir>.
    skillDirs.add(relativeTo(basename(file) === 'SKILL.md' ? dirname(dirname(file)) : dirname(file)))
  }

  const prompts: GeneratedRuntimeManifest['prompts'] = []
  const promptNames = new Set<string>()
  for (const source of pkg.resources.prompts) {
    const name = basename(source, '.md').toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
    if (promptNames.has(name)) throw new Error(`prompt command name collision in ${pkg.identity.name}: ${name}`)
    promptNames.add(name)
    const { attributes, body } = parseFrontmatter(await readFile(source, 'utf8'))
    const firstLine = body.split(/\r?\n/u).map(line => line.trim()).find(Boolean)
    prompts.push({
      name,
      description: attributes.description ?? firstLine ?? `Run migrated Pi prompt ${name}`,
      ...(attributes['argument-hint'] !== undefined ? { argumentHint: attributes['argument-hint'] } : {}),
      path: relativeTo(source),
    })
  }

  return {
    schemaVersion: 1,
    package: pkg.identity,
    extensions: pkg.resources.extensions.map(relativeTo),
    skillDirs: [...skillDirs].sort(),
    prompts,
  }
}

function normalizeSpecs(config: PiHostConfig): PiHostPackageSpec[] {
  const packages = Array.isArray(config?.packages) ? config.packages : []
  return packages.map(spec => (typeof spec === 'string' ? { name: spec } : spec))
    .filter(spec => typeof spec?.name === 'string' && spec.name.length > 0)
}

function resolveInstalledDir(anchor: string, packageName: string): string {
  const require = createRequire(anchor)
  try {
    return dirname(require.resolve(`${packageName}/package.json`))
  } catch {
    // Modern strict `exports` maps refuse the package.json subpath, and pure
    // ESM packages (no "require" condition) refuse CJS entry resolution too.
    // Locate the installed directory on the filesystem instead: probe every
    // node_modules candidate on the resolution path — no exports involved.
    for (const candidate of require.resolve.paths(packageName) ?? []) {
      const dir = join(candidate, packageName)
      if (existsSync(join(dir, 'package.json'))) return dir
    }
    throw new Error(`cannot locate the installed package directory for ${JSON.stringify(packageName)} near ${JSON.stringify(anchor)}`)
  }
}

/**
 * Mount every configured Pi package from the host bundle's own node_modules.
 * Packages that fail to mount report their error and do not take down the
 * host or their siblings — matching Pi's own per-extension error isolation.
 */
export async function applyPiHost(ctx: Context, config: PiHostConfig, anchor?: string): Promise<void> {
  registerVisionCompanions(ctx, config.visionCompanions)
  const prepared = await preparePiHost(config, anchor)
  await applyPreparedPiHost(ctx, prepared)
}

/** Resolve installed Pi packages and build immutable manifests without mounting their runtimes. */
export async function preparePiHost(config: PiHostConfig, anchor?: string): Promise<PreparedPiHostPackage[]> {
  const anchorPath = anchor ?? fileURLToPath(import.meta.url)
  const errors: Array<{ name: string; error: string }> = []
  const prepared: PreparedPiHostPackage[] = []
  for (const spec of normalizeSpecs(config)) {
    try {
      const dir = resolveInstalledDir(spec.anchor ?? anchorPath, spec.name)
      const pkg = await resolvePiPackage(dir)
      try {
        const manifest = await manifestForInstalled(pkg)
        prepared.push({
          name: spec.name,
          rootUrl: pathToFileURL(`${pkg.rootDir}/`),
          manifest,
          ...(spec.config === undefined ? {} : { config: spec.config }),
        })
      } finally {
        await pkg.dispose()
      }
    } catch (error) {
      errors.push({ name: spec.name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const failure of errors) {
    // Console AND logger, the same rule the engine states for its own mount
    // line: a profile's logger level must never be able to hide which packages
    // did not mount. It could, and it did — a package failed to mount and the
    // only symptom was its absence from a list nobody was diffing.
    const message = `[pi2dsh host] failed to mount ${failure.name}: ${failure.error}`
    console.warn(message)
  }
  if (errors.length > 0 && errors.length === normalizeSpecs(config).length) {
    throw new Error(`pi2dsh host mounted no packages; first failure: ${errors[0]!.name}: ${errors[0]!.error}`)
  }
  return prepared
}

/** Mount prepared Pi package runtimes into one exact DSH context. */
export async function applyPreparedPiHost(
  ctx: Context,
  prepared: readonly PreparedPiHostPackage[],
  ownerAgent?: UnknownRecord,
  mode: { hostAnchor?: boolean } = {},
): Promise<void> {
  const errors: Array<{ name: string; error: string }> = []
  for (const pkg of prepared) {
    try {
      // One real Cordis activation per Pi package, owned by this Agent scope.
      // Besides giving teardown the correct owner, dsh-TUI's contribution
      // services bind registration and later use to this activation identity;
      // calling applyPiPackage() naked from the setup event has no live plugin
      // caller and cannot register or open a scene correctly.
      await ctx.plugin(Object.assign(
        async (packageCtx: Context) => {
          await applyPiPackage(packageCtx, {
            rootUrl: pkg.rootUrl,
            manifest: pkg.manifest,
            // The engine/host registers companion routes once on the host
            // before mounting prepared packages. Suppress applyPiPackage's
            // standalone default here so one package cannot undo an explicit
            // host-level `visionCompanions: false` or duplicate the catalog.
            config: { ...(pkg.config ?? {}), visionCompanions: false },
            ...(ownerAgent === undefined ? {} : { ownerAgent }),
            ...(mode.hostAnchor === true ? { hostAnchor: true } : {}),
          })
        },
        { inject: ['tools', 'systemPrompt', 'commands'] },
      ))
    } catch (error) {
      errors.push({ name: pkg.name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const failure of errors) {
    const log = (ctx as unknown as { logger?: { warn?(message: string): void } }).logger
    const message = `[pi2dsh host] failed to mount ${failure.name}: ${failure.error}`
    log?.warn?.(message)
    console.warn(message)
  }
  if (errors.length > 0 && errors.length === prepared.length) {
    throw new Error(`pi2dsh host mounted no packages; first failure: ${errors[0]!.name}: ${errors[0]!.error}`)
  }
}
