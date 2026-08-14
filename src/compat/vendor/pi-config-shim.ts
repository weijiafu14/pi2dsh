// @ts-nocheck — vendored Pi source; checked upstream under Pi's own tsconfig.
// Minimal stand-ins for pi-coding-agent's config.ts and utils/paths.ts,
// scoped to what the vendored SessionManager consumes. The agent directory is
// redirected into DSH's home so migrated state never collides with a real Pi
// installation on the same machine.
import { homedir } from 'node:os'
import { isAbsolute, join, resolve as nodeResolvePath } from 'node:path'

export function getAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'pi2dsh', 'agent')
}

export function getSessionsDir(): string {
  return join(getAgentDir(), 'sessions')
}

export function normalizePath(input: string): string {
  const home = homedir()
  if (input === '~') return home
  if (input.startsWith('~/')) return join(home, input.slice(2))
  return input
}

export function resolvePath(input: string, baseDir: string = process.cwd()): string {
  const normalized = normalizePath(input)
  const normalizedBase = normalizePath(baseDir)
  return isAbsolute(normalized) ? nodeResolvePath(normalized) : nodeResolvePath(normalizedBase, normalized)
}
