// @ts-nocheck — vendored Pi source (coding-agent src/core/trust-manager.ts store surface
// @6f707eb36064e82af9c1320a7634f4dfad21049b, MIT, see ./PI-LICENSE); logic unchanged.
// The store operates wherever the caller points it: under pi2dsh the conventional
// agentDir already resolves inside the DSH-owned pi2dsh directory, so a package's
// trust decisions are package-visible state that the DSH host never consumes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import lockfile from 'proper-lockfile'
import { canonicalizePath, resolvePath } from './pi-paths.js'

export type ProjectTrustDecision = boolean | null

export interface ProjectTrustStoreEntry {
  path: string
  decision: boolean
}

export interface ProjectTrustUpdate {
  path: string
  decision: ProjectTrustDecision
}

type TrustFile = Record<string, boolean | null | undefined>

function normalizeCwd(cwd: string): string {
  return canonicalizePath(resolvePath(cwd))
}

function findNearestTrustEntry(data: TrustFile, cwd: string): ProjectTrustStoreEntry | null {
  let currentDir = normalizeCwd(cwd)
  while (true) {
    const value = data[currentDir]
    if (value === true || value === false) {
      return { path: currentDir, decision: value }
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }
    currentDir = parentDir
  }
}

function readTrustFile(path: string): TrustFile {
  if (!existsSync(path)) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read trust store ${path}: ${message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid trust store ${path}: expected an object`)
  }

  const data: TrustFile = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(`Invalid trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`)
    }
    data[key] = value
  }
  return data
}

function writeTrustFile(path: string, data: TrustFile): void {
  const sorted: TrustFile = {}
  for (const key of Object.keys(data).sort()) {
    const value = data[key]
    if (value === true || value === false || value === null) {
      sorted[key] = value
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8')
}

function acquireTrustLockSync(path: string): () => void {
  const trustDir = dirname(path)
  mkdirSync(trustDir, { recursive: true })
  const maxAttempts = 10
  const delayMs = 20
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return lockfile.lockSync(trustDir, { realpath: false, lockfilePath: `${path}.lock` })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined
      if (code !== 'ELOCKED' || attempt === maxAttempts) {
        throw error
      }
      lastError = error
      const start = Date.now()
      while (Date.now() - start < delayMs) {
        // Sleep synchronously to avoid changing trust store callers to async.
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error('Failed to acquire trust store lock')
}

function withTrustFileLock<T>(path: string, fn: () => T): T {
  const release = acquireTrustLockSync(path)
  try {
    return fn()
  } finally {
    release()
  }
}

export class ProjectTrustStore {
  private trustPath: string

  constructor(agentDir: string) {
    this.trustPath = resolvePath(agentDir) + '/trust.json'
  }

  get(cwd: string): ProjectTrustDecision {
    return this.getEntry(cwd)?.decision ?? null
  }

  getEntry(cwd: string): ProjectTrustStoreEntry | null {
    return withTrustFileLock(this.trustPath, () => {
      const data = readTrustFile(this.trustPath)
      return findNearestTrustEntry(data, cwd)
    })
  }

  set(cwd: string, decision: ProjectTrustDecision): void {
    this.setMany([{ path: cwd, decision }])
  }

  setMany(decisions: ProjectTrustUpdate[]): void {
    withTrustFileLock(this.trustPath, () => {
      const data = readTrustFile(this.trustPath)
      for (const { path, decision } of decisions) {
        const key = normalizeCwd(path)
        if (decision === null) {
          delete data[key]
        } else {
          data[key] = decision
        }
      }
      writeTrustFile(this.trustPath, data)
    })
  }
}
