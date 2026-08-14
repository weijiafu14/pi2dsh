import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
    extensions: await discover('extensions'),
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
