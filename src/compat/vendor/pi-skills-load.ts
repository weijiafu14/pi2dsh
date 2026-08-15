// @ts-nocheck — vendored Pi source (coding-agent src/core/skills.ts
// @6f707eb36064e82af9c1320a7634f4dfad21049b, MIT, see ./PI-LICENSE); logic unchanged.
// createSyntheticSourceInfo is inlined from src/core/source-info.ts (same commit).
// getAgentDir resolves through the pi2dsh config shim, so default skill
// locations land inside the DSH-owned pi2dsh agent directory — the same
// redirection every other conventional-path API already follows.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import ignore from 'ignore'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { getAgentDir } from './pi-config-shim.js'
import { parseFrontmatter } from './pi-frontmatter.js'
import { canonicalizePath, resolvePath } from './pi-paths.js'

// coding-agent src/config.ts: the conventional Pi config directory name.
const CONFIG_DIR_NAME = '.pi'

/** Max name length per spec */
const MAX_NAME_LENGTH = 64

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024

const IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore']

function toPosixPath(p: string): string {
  return p.split(sep).join('/')
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null

  let pattern = line
  let negated = false

  if (pattern.startsWith('!')) {
    negated = true
    pattern = pattern.slice(1)
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1)
  }

  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1)
  }

  const prefixed = prefix ? `${prefix}${pattern}` : pattern
  return negated ? `!${prefixed}` : prefixed
}

function addIgnoreRules(ig, dir: string, rootDir: string): void {
  const relativeDir = relative(rootDir, dir)
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : ''

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename)
    if (!existsSync(ignorePath)) continue
    try {
      const content = readFileSync(ignorePath, 'utf-8')
      const patterns = content
        .split(/\r?\n/)
        .map(line => prefixIgnorePattern(line, prefix))
        .filter(line => Boolean(line))
      if (patterns.length > 0) {
        ig.add(patterns)
      }
    } catch {}
  }
}

// source-info.ts (same commit): synthesize SourceInfo for resources that do not
// come from a resolved package source.
function createSyntheticSourceInfo(path, options) {
  return {
    path,
    source: options.source,
    scope: options.scope ?? 'temporary',
    origin: options.origin ?? 'top-level',
    baseDir: options.baseDir,
  }
}

export interface SkillFrontmatter {
  name?: string
  description?: string
  'disable-model-invocation'?: boolean
  [key: string]: unknown
}

export interface Skill {
  name: string
  description: string
  filePath: string
  baseDir: string
  sourceInfo
  disableModelInvocation: boolean
}

export interface LoadSkillsResult {
  skills: Skill[]
  diagnostics
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string): string[] {
  const errors: string[] = []

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`)
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`)
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push(`name must not start or end with a hyphen`)
  }

  if (name.includes('--')) {
    errors.push(`name must not contain consecutive hyphens`)
  }

  return errors
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: string | undefined): string[] {
  const errors: string[] = []

  if (!description || description.trim() === '') {
    errors.push('description is required')
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`)
  }

  return errors
}

export interface LoadSkillsFromDirOptions {
  /** Directory to scan for skills */
  dir: string
  /** Source identifier for these skills */
  source: string
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string) {
  switch (source) {
    case 'user':
      return createSyntheticSourceInfo(filePath, {
        source: 'local',
        scope: 'user',
        baseDir,
      })
    case 'project':
      return createSyntheticSourceInfo(filePath, {
        source: 'local',
        scope: 'project',
        baseDir,
      })
    case 'path':
      return createSyntheticSourceInfo(filePath, {
        source: 'local',
        baseDir,
      })
    default:
      return createSyntheticSourceInfo(filePath, { source, baseDir })
  }
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
  const { dir, source } = options
  return loadSkillsFromDirInternal(dir, source, true)
}

function loadSkillsFromDirInternal(
  dir: string,
  source: string,
  includeRootFiles: boolean,
  ignoreMatcher?,
  rootDir?: string,
): LoadSkillsResult {
  const skills: Skill[] = []
  const diagnostics = []

  if (!existsSync(dir)) {
    return { skills, diagnostics }
  }

  const root = rootDir ?? dir
  const ig = ignoreMatcher ?? ignore()
  addIgnoreRules(ig, dir, root)

  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name !== 'SKILL.md') {
        continue
      }

      const fullPath = join(dir, entry.name)

      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile()
        } catch {
          continue
        }
      }

      const relPath = toPosixPath(relative(root, fullPath))
      if (!isFile || ig.ignores(relPath)) {
        continue
      }

      const result = loadSkillFromFile(fullPath, source)
      if (result.skill) {
        skills.push(result.skill)
      }
      diagnostics.push(...result.diagnostics)
      return { skills, diagnostics }
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      // Skip node_modules to avoid scanning dependencies
      if (entry.name === 'node_modules') {
        continue
      }

      const fullPath = join(dir, entry.name)

      // For symlinks, check if they point to a directory and follow them
      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath)
          isDirectory = stats.isDirectory()
          isFile = stats.isFile()
        } catch {
          // Broken symlink, skip it
          continue
        }
      }

      const relPath = toPosixPath(relative(root, fullPath))
      const ignorePath = isDirectory ? `${relPath}/` : relPath
      if (ig.ignores(ignorePath)) {
        continue
      }

      if (isDirectory) {
        const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root)
        skills.push(...subResult.skills)
        diagnostics.push(...subResult.diagnostics)
        continue
      }

      if (!isFile || !includeRootFiles || !entry.name.endsWith('.md')) {
        continue
      }

      const result = loadSkillFromFile(fullPath, source)
      if (result.skill) {
        skills.push(result.skill)
      }
      diagnostics.push(...result.diagnostics)
    }
  } catch {}

  return { skills, diagnostics }
}

function loadSkillFromFile(filePath: string, source: string): { skill: Skill | null; diagnostics } {
  const diagnostics = []

  try {
    const rawContent = readFileSync(filePath, 'utf-8')
    const { frontmatter } = parseFrontmatter(rawContent)
    const skillDir = dirname(filePath)
    const parentDirName = basename(skillDir)

    // Validate description
    const descErrors = validateDescription(frontmatter.description)
    for (const error of descErrors) {
      diagnostics.push({ type: 'warning', message: error, path: filePath })
    }

    // Use name from frontmatter, or fall back to parent directory name
    const name = frontmatter.name || parentDirName

    // Validate name
    const nameErrors = validateName(name)
    for (const error of nameErrors) {
      diagnostics.push({ type: 'warning', message: error, path: filePath })
    }

    // Still load the skill even with warnings (unless description is completely missing)
    if (!frontmatter.description || frontmatter.description.trim() === '') {
      return { skill: null, diagnostics }
    }

    return {
      skill: {
        name,
        description: frontmatter.description,
        filePath,
        baseDir: skillDir,
        sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
        disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      },
      diagnostics,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to parse skill file'
    diagnostics.push({ type: 'warning', message, path: filePath })
    return { skill: null, diagnostics }
  }
}

export interface LoadSkillsOptions {
  /** Working directory for project-local skills. */
  cwd: string
  /** Agent config directory for global skills. */
  agentDir: string
  /** Explicit skill paths (files or directories) */
  skillPaths: string[]
  /** Include default skills directories. */
  includeDefaults: boolean
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
  const { agentDir, skillPaths, includeDefaults } = options

  // Resolve agentDir - if not provided, use default from config
  const resolvedCwd = resolvePath(options.cwd)
  const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir())

  const skillMap = new Map<string, Skill>()
  const realPathSet = new Set<string>()
  const allDiagnostics = []
  const collisionDiagnostics = []

  function addSkills(result: LoadSkillsResult) {
    allDiagnostics.push(...result.diagnostics)
    for (const skill of result.skills) {
      // Resolve symlinks to detect duplicate files
      const realPath = canonicalizePath(skill.filePath)

      // Skip silently if we've already loaded this exact file (via symlink)
      if (realPathSet.has(realPath)) {
        continue
      }

      const existing = skillMap.get(skill.name)
      if (existing) {
        collisionDiagnostics.push({
          type: 'collision',
          message: `name "${skill.name}" collision`,
          path: skill.filePath,
          collision: {
            resourceType: 'skill',
            name: skill.name,
            winnerPath: existing.filePath,
            loserPath: skill.filePath,
          },
        })
      } else {
        skillMap.set(skill.name, skill)
        realPathSet.add(realPath)
      }
    }
  }

  if (includeDefaults) {
    addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, 'skills'), 'user', true))
    addSkills(loadSkillsFromDirInternal(resolve(resolvedCwd, CONFIG_DIR_NAME, 'skills'), 'project', true))
  }

  const userSkillsDir = join(resolvedAgentDir, 'skills')
  const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, 'skills')

  const isUnderPath = (target: string, root: string): boolean => {
    const normalizedRoot = resolve(root)
    if (target === normalizedRoot) {
      return true
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`
    return target.startsWith(prefix)
  }

  const getSource = (resolvedPath: string): 'user' | 'project' | 'path' => {
    if (!includeDefaults) {
      if (isUnderPath(resolvedPath, userSkillsDir)) return 'user'
      if (isUnderPath(resolvedPath, projectSkillsDir)) return 'project'
    }
    return 'path'
  }

  for (const rawPath of skillPaths) {
    const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true })
    if (!existsSync(resolvedPath)) {
      allDiagnostics.push({ type: 'warning', message: 'skill path does not exist', path: resolvedPath })
      continue
    }

    try {
      const stats = statSync(resolvedPath)
      const source = getSource(resolvedPath)
      if (stats.isDirectory()) {
        addSkills(loadSkillsFromDirInternal(resolvedPath, source, true))
      } else if (stats.isFile() && resolvedPath.endsWith('.md')) {
        const result = loadSkillFromFile(resolvedPath, source)
        if (result.skill) {
          addSkills({ skills: [result.skill], diagnostics: result.diagnostics })
        } else {
          allDiagnostics.push(...result.diagnostics)
        }
      } else {
        allDiagnostics.push({ type: 'warning', message: 'skill path is not a markdown file', path: resolvedPath })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to read skill path'
      allDiagnostics.push({ type: 'warning', message, path: resolvedPath })
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    diagnostics: [...allDiagnostics, ...collisionDiagnostics],
  }
}
