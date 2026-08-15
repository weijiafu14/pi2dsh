// PiHostOnDSH: one DSH plugin that hosts unmodified Pi packages.
//
// Instead of converting each package into a vendored bundle, the host bundle
// declares Pi packages as ordinary npm dependencies; DSH's plugin manager
// (pnpm) installs them, and at load time this module resolves each installed
// package, discovers its Pi entry points, and mounts it through the same
// package-agnostic runtime as converted bundles. One host, any package —
// there is deliberately no per-package branching here.

import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat, writeFile, mkdir, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { applyPiPackage } from './runtime.js'
import { resolvePiPackage } from './source.js'
import type { GeneratedRuntimeManifest, ResolvedPiPackage } from './types.js'

type UnknownRecord = Record<string, unknown>

export interface PiHostPackageSpec {
  /** npm package name as installed in the host bundle's node_modules. */
  name: string
  /** Optional per-package config forwarded to the runtime. */
  config?: UnknownRecord
}

export interface PiHostConfig {
  packages: Array<string | PiHostPackageSpec>
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
  const anchorPath = anchor ?? fileURLToPath(import.meta.url)
  const errors: Array<{ name: string; error: string }> = []
  for (const spec of normalizeSpecs(config)) {
    try {
      const dir = resolveInstalledDir(anchorPath, spec.name)
      const pkg = await resolvePiPackage(dir)
      try {
        const manifest = await manifestForInstalled(pkg)
        await applyPiPackage(ctx, {
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
    const log = (ctx as unknown as { logger?: { warn?(message: string): void } }).logger
    const warn = log?.warn?.bind(log) ?? console.warn
    warn(`[pi2dsh host] failed to mount ${failure.name}: ${failure.error}`)
  }
  if (errors.length > 0 && errors.length === normalizeSpecs(config).length) {
    throw new Error(`pi2dsh host mounted no packages; first failure: ${errors[0]!.name}: ${errors[0]!.error}`)
  }
}

// ---------------------------------------------------------------------------
// Host bundle generation
// ---------------------------------------------------------------------------

export interface HostBundleOptions {
  outDir: string
  /** npm specs, e.g. "@narumitw/pi-lsp@0.49.4" or "pi-ask-user". */
  packages: string[]
  bundleName?: string
}

function splitSpec(spec: string): { name: string; range: string } {
  const at = spec.lastIndexOf('@')
  if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) }
  return { name: spec, range: '*' }
}

async function firstExisting(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      await stat(path)
      return path
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(`cannot locate pi2dsh runtime artifact; tried: ${paths.join(', ')}`)
}

async function copyEmbeddedHostRuntime(outDir: string): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const hostSource = await firstExisting([
    join(moduleDir, 'host.mjs'),
    join(moduleDir, '../dist/host.mjs'),
  ])
  const distRoot = dirname(hostSource)
  const targetRoot = join(outDir, 'runtime')
  await mkdir(join(targetRoot, 'compat', 'vendor'), { recursive: true })
  for (const entry of await readdir(distRoot)) {
    if (entry.endsWith('.mjs') || entry.endsWith('.d.mts')) {
      await cp(join(distRoot, entry), join(targetRoot, entry))
    }
  }
  for (const sub of ['compat', join('compat', 'vendor')]) {
    const dir = join(distRoot, sub)
    try {
      for (const entry of await readdir(dir)) {
        if (entry.endsWith('.mjs')) await cp(join(dir, entry), join(targetRoot, sub, entry))
      }
    } catch {
      // dist layout without that subdirectory
    }
  }
}

export async function generateHostBundle(options: HostBundleOptions): Promise<{ outDir: string; packageName: string }> {
  const specs = options.packages.map(splitSpec)
  if (specs.length === 0) throw new Error('host bundle requires at least one Pi package spec')
  const packageName = options.bundleName ?? 'dsh-pi-host'
  await mkdir(options.outDir, { recursive: true })
  await copyEmbeddedHostRuntime(options.outDir)

  const packageJson = {
    name: packageName,
    version: '0.1.0',
    description: `pi2dsh host bundle mounting ${specs.map(spec => spec.name).join(', ')} as native DSH plugins`,
    type: 'module',
    main: './index.js',
    files: ['index.js', 'cordis.patch.yml', 'runtime', 'PI2DSH-LICENSE', 'README.md'],
    dependencies: {
      ...Object.fromEntries(specs.map(spec => [spec.name, spec.range])),
      jiti: '^2.7.0',
      'get-east-asian-width': '^1.6.0',
      marked: '^16.4.1',
      typebox: '^1.0.4',
      tinyglobby: '^0.2.15',
      // The vendored Pi built-in tool constructors spawn through cross-spawn
      // and diff exactly as Pi does — same runtime set the convert bundle
      // carries (generator.ts keeps the sibling list).
      'cross-spawn': '^7.0.6',
      diff: '^9.0.0',
      '@deepseek-ai/dsh-skill-filesystem': '^0.1.0-rc.6',
      // The bridge's own openai-completions client (openai SDK) serves the
      // common gateway protocol; rarer apis lazily use a real pi-ai from
      // the mounted packages' own dependency trees. A direct pi-ai
      // dependency would drag @google/genai → protobufjs, whose blocked
      // install script fails `dsh plugin add` for transitive dependencies.
      openai: '^6.40.0',
    },
    peerDependencies: {
      '@deepseek-ai/dsh-llm': '^0.1.0-rc.6',
      '@deepseek-ai/dsh-system-prompt': '^0.1.0-rc.6',
    },
    keywords: ['dsh-plugin', 'deepseek-harness', 'pi-package', 'pi2dsh', 'pi-host'],
    license: 'MIT',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
  await writeFile(join(options.outDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)

  const hostConfig: PiHostConfig = { packages: specs.map(spec => spec.name) }
  const indexSource = `import { applyPiHost } from './runtime/host.mjs'\n\n`
    + `export const name = ${JSON.stringify(packageName)}\n`
    + `export const inject = ${JSON.stringify(['tools', 'systemPrompt', 'commands', 'skills'])}\n\n`
    + `const hostConfig = ${JSON.stringify(hostConfig, null, 2)}\n\n`
    + `export async function apply(ctx, config = {}) {\n`
    + `  await applyPiHost(ctx, { ...hostConfig, ...config }, new URL(import.meta.url).pathname)\n`
    + `}\n`
  await writeFile(join(options.outDir, 'index.js'), indexSource)

  await writeFile(join(options.outDir, 'cordis.patch.yml'),
    `- insert:\n    - id: ${packageName}\n      name: ${JSON.stringify(packageName)}\n`)

  const licenseSource = await firstExisting([
    join(dirname(fileURLToPath(import.meta.url)), 'compat/vendor/PI-LICENSE'),
    join(dirname(fileURLToPath(import.meta.url)), '../src/compat/vendor/PI-LICENSE'),
  ])
  await cp(licenseSource, join(options.outDir, 'PI2DSH-LICENSE'))

  await writeFile(join(options.outDir, 'README.md'),
    `# ${packageName}\n\n`
    + `A [pi2dsh](https://github.com/weijiafu14/pi2dsh) host bundle. The Pi packages below are installed as ordinary npm dependencies and mounted at load time — no per-package conversion, no vendored source snapshots.\n\n`
    + specs.map(spec => `- \`${spec.name}@${spec.range}\`\n`).join('')
    + `\nInstall:\n\n\`\`\`sh\ndsh plugin --profile headless add file:$PWD\ndsh --profile headless --dump-config\n\`\`\`\n`
    + `\nThe packages execute their original Pi extension source inside the pi2dsh Host ABI; install only sources you trust. Run \`pi2dsh inspect <package>\` for each package's compatibility report.\n`)

  return { outDir: options.outDir, packageName }
}
