import { access, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import type { ResolvedPiPackage, ResourceInventory } from './types.js'

type PiManifest = Partial<Record<'extensions' | 'skills' | 'prompts' | 'themes', string[]>>

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined
}

function piManifest(packageJson: Record<string, unknown>): PiManifest | undefined {
  const raw = packageJson.pi
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const extensions = stringArray(record.extensions)
  const skills = stringArray(record.skills)
  const prompts = stringArray(record.prompts)
  const themes = stringArray(record.themes)
  return {
    ...(extensions !== undefined ? { extensions } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(prompts !== undefined ? { prompts } : {}),
    ...(themes !== undefined ? { themes } : {}),
  }
}

const DEFAULT_PATTERNS: Record<keyof ResourceInventory, string[]> = {
  extensions: ['extensions/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}'],
  skills: ['skills/**/*'],
  prompts: ['prompts/*.md'],
  themes: ['themes/*.json'],
}

const FILE_PATTERNS: Record<keyof ResourceInventory, string> = {
  extensions: '**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}',
  skills: '**/*',
  prompts: '**/*.md',
  themes: '**/*.json',
}

// Pi's own loader tolerates resource paths that do not resolve (existsSync
// filtering); mirror that leniency for patterns escaping the package root:
// skip the pattern with a warning instead of refusing the whole package.
// Files outside the package are still never globbed or copied.
function safePattern(pattern: string): string | undefined {
  const normalized = pattern.replaceAll('\\', '/')
  const positive = normalized.startsWith('!') ? normalized.slice(1) : normalized
  if (isAbsolute(positive) || positive.split('/').includes('..')) {
    console.warn(`pi2dsh: skipping resource pattern that escapes the package root (Pi itself would not resolve it either at install layout): ${JSON.stringify(pattern)}`)
    return undefined
  }
  return normalized
}

async function patternsFor(
  rootDir: string,
  kind: keyof ResourceInventory,
  configured: string[] | undefined,
): Promise<string[]> {
  if (configured === undefined) return DEFAULT_PATTERNS[kind]
  const output: string[] = []
  for (const raw of configured) {
    const pattern = safePattern(raw)
    if (pattern === undefined) continue
    if (pattern.startsWith('!')) {
      output.push(pattern)
      continue
    }
    const absolute = resolve(rootDir, pattern)
    try {
      const info = await stat(absolute)
      output.push(info.isDirectory() ? `${pattern.replace(/\/$/u, '')}/${FILE_PATTERNS[kind]}` : pattern)
    } catch {
      output.push(pattern)
    }
  }
  return output
}

// Pi's extension discovery for a DIRECTORY entry (coding-agent
// src/core/package-manager.ts resolveExtensionEntries/collectAutoExtensionEntries
// @6f707eb36064e82af9c1320a7634f4dfad21049b; logic unchanged, minus the
// .gitignore/.piignore filter): a directory that carries its own
// package.json `pi.extensions` or an index.ts/index.js IS one entry set;
// otherwise its direct *.ts/*.js files are entries and each subdirectory
// contributes only through that same rule. No recursion beyond one level —
// a package's `internal/` helpers (no index) are shared modules, not entries.
// The old `dir/**/*.ts` glob loaded every helper as an extension and logged
// "has no default factory function" for each (pi-code: 40 of 64 files).
async function resolveExtensionEntries(dir: string): Promise<string[] | null> {
  const packageJsonPath = join(dir, 'package.json')
  if (await exists(packageJsonPath)) {
    try {
      const manifest = piManifest(JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>)
      if (manifest?.extensions !== undefined && manifest.extensions.length > 0) {
        const entries: string[] = []
        for (const extPath of manifest.extensions) {
          const resolved = resolve(dir, extPath)
          if (await exists(resolved)) entries.push(resolved)
        }
        if (entries.length > 0) return entries
      }
    } catch {
      // An unreadable nested manifest falls through to the index rule, as Pi does.
    }
  }
  for (const index of ['index.ts', 'index.js']) {
    const candidate = join(dir, index)
    if (await exists(candidate)) return [candidate]
  }
  return null
}

async function collectAutoExtensionEntries(dir: string): Promise<string[]> {
  if (!await exists(dir)) return []
  const rootEntries = await resolveExtensionEntries(dir)
  if (rootEntries !== null) return rootEntries
  const entries: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const fullPath = join(dir, entry.name)
    let isDir = entry.isDirectory()
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      try {
        const info = await stat(fullPath)
        isDir = info.isDirectory()
        isFile = info.isFile()
      } catch {
        continue
      }
    }
    if (isFile && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) entries.push(fullPath)
    else if (isDir) {
      const resolved = await resolveExtensionEntries(fullPath)
      if (resolved !== null) entries.push(...resolved)
    }
  }
  return entries
}

async function discoverExtensions(rootDir: string, configured: string[] | undefined): Promise<string[]> {
  // Pi: no manifest → the package's `extensions/` directory under the auto
  // rule; a manifest → each entry is a file (as is) or a directory (auto rule).
  // Patterns Pi would not understand (globs, negations) keep the glob path.
  const entries = configured === undefined ? ['extensions'] : configured
  const output = new Set<string>()
  const globPatterns: string[] = []
  for (const raw of entries) {
    const pattern = safePattern(raw)
    if (pattern === undefined) continue
    if (pattern.startsWith('!') || /[*?[\]{}]/u.test(pattern)) {
      globPatterns.push(pattern)
      continue
    }
    const absolute = resolve(rootDir, pattern)
    try {
      const info = await stat(absolute)
      if (info.isDirectory()) for (const entry of await collectAutoExtensionEntries(absolute)) output.add(entry)
      else output.add(absolute)
    } catch {
      // Pi skips manifest entries that do not resolve.
    }
  }
  if (globPatterns.length > 0) {
    const matches = await glob(globPatterns, { cwd: rootDir, absolute: true, onlyFiles: true, dot: false, followSymbolicLinks: false })
    for (const match of matches) output.add(match)
  }
  return [...output].sort()
}

async function discoverResources(rootDir: string, packageJson: Record<string, unknown>): Promise<ResourceInventory> {
  const manifest = piManifest(packageJson)
  const discover = async (kind: keyof ResourceInventory): Promise<string[]> => {
    const patterns = await patternsFor(rootDir, kind, manifest?.[kind])
    const matches = await glob(patterns, {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
    })
    return matches.sort()
  }
  return {
    extensions: await discoverExtensions(rootDir, manifest?.extensions),
    skills: await discover('skills'),
    prompts: await discover('prompts'),
    themes: await discover('themes'),
  }
}

function packageIdentity(packageJson: Record<string, unknown>, source: string, fallbackName: string) {
  return {
    name: typeof packageJson.name === 'string' ? packageJson.name : fallbackName,
    version: typeof packageJson.version === 'string' ? packageJson.version : '0.0.0-local',
    source,
  }
}

async function readPackageJson(rootDir: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(rootDir, 'package.json'), 'utf8')
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json must contain an object')
  }
  return parsed as Record<string, unknown>
}

export async function resolvePiPackage(source: string, cwd = process.cwd()): Promise<ResolvedPiPackage> {
  const localCandidate = resolve(cwd, source.replace(/^file:/u, ''))
  const local = source.startsWith('.')
    || source.startsWith('/')
    || source.startsWith('file:')
    || await exists(localCandidate)
  let rootDir: string
  let temporary = false
  let packageJson: Record<string, unknown>

  if (local) {
    const requested = localCandidate
    const info = await stat(requested)
    if (info.isFile()) {
      rootDir = dirname(requested)
      const packagePath = join(rootDir, 'package.json')
      packageJson = await exists(packagePath)
        ? await readPackageJson(rootDir)
        : { name: basename(requested).replace(/\.[^.]+$/u, ''), pi: { extensions: [basename(requested)] } }
    } else {
      rootDir = requested
      packageJson = await readPackageJson(rootDir)
    }
  } else {
    rootDir = await mkdtemp(join(tmpdir(), 'pi2dsh-source-'))
    temporary = true
    try {
      // Lazy: only npm-spec resolution needs the registry client. Host
      // bundles resolve installed directories and never load pacote.
      const { default: pacote } = await import('pacote')
      await pacote.extract(source, rootDir)
      packageJson = await readPackageJson(rootDir)
    } catch (error) {
      await rm(rootDir, { recursive: true, force: true })
      throw error
    }
  }

  const resources = await discoverResources(rootDir, packageJson)
  const identity = packageIdentity(packageJson, source, basename(rootDir))
  return {
    rootDir,
    temporary,
    identity,
    packageJson,
    resources,
    async dispose() {
      if (temporary) await rm(rootDir, { recursive: true, force: true })
    },
  }
}
