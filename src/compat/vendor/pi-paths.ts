// @ts-nocheck — vendored Pi source (coding-agent src/utils/paths.ts subset
// @6f707eb36064e82af9c1320a7634f4dfad21049b, MIT, see ./PI-LICENSE); logic unchanged.
// The subset the vendored skills loader and trust store reach: normalizePath,
// resolvePath, canonicalizePath, and their helpers.
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve as nodeResolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

export interface PathInputOptions {
  trim?: boolean
  normalizeUnicodeSpaces?: boolean
  stripAtPrefix?: boolean
  expandTilde?: boolean
  homeDir?: string
}

/** Convert Git Bash, MSYS, Cygwin, and WSL drive paths to a form native Windows APIs accept. */
export function normalizeWindowsShellPath(filePath: string): string {
  if (!filePath.startsWith('/') || filePath.startsWith('//') || filePath.includes('\\')) return filePath
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
  if (!match) return filePath
  const suffix = match[2]?.replaceAll('/', '\\')
  return `${match[1].toUpperCase()}:\\${suffix ?? ''}`
}

export function normalizePath(input: string, options: PathInputOptions = {}): string {
  let normalized = options.trim ? input.trim() : input
  if (options.normalizeUnicodeSpaces) {
    normalized = normalized.replace(UNICODE_SPACES, ' ')
  }
  if (options.stripAtPrefix && normalized.startsWith('@')) {
    normalized = normalized.slice(1)
  }
  if (process.platform === 'win32') {
    normalized = normalizeWindowsShellPath(normalized)
  }

  if (options.expandTilde ?? true) {
    const home = options.homeDir ?? homedir()
    if (normalized === '~') return home
    if (normalized.startsWith('~/') || (process.platform === 'win32' && normalized.startsWith('~\\'))) {
      return join(home, normalized.slice(2))
    }
  }

  if (/^file:\/\//.test(normalized)) {
    return fileURLToPath(normalized)
  }

  return normalized
}

export function resolvePath(input: string, baseDir: string = process.cwd(), options: PathInputOptions = {}): string {
  const normalized = normalizePath(input, options)
  const normalizedBaseDir = normalizePath(baseDir)
  return isAbsolute(normalized) ? nodeResolvePath(normalized) : nodeResolvePath(normalizedBaseDir, normalized)
}

export function canonicalizePath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
