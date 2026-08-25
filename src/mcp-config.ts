// Pi MCP configuration -> DSH mcp-client patch entries.
//
// Pi (via pi-mcp-adapter) reads the standard `mcpServers` files. DSH ships an
// official MCP client (`@deepseek-ai/dsh-mcp-client`) configured through
// cordis patch layers — so migration is config translation, not running Pi's
// adapter code. This module reads Pi's documented six-layer precedence,
// resolves `disabled` flags, and emits one patch entry per enabled server.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAgentDir } from './compat/vendor/pi-config-shim.js'

type UnknownRecord = Record<string, unknown>

export interface PiMcpServer {
  name: string
  sourcePath: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  disabled: boolean
}

export interface McpConversionWarning {
  server: string
  message: string
}

export interface McpConversionResult {
  servers: PiMcpServer[]
  entries: UnknownRecord[]
  warnings: McpConversionWarning[]
  sources: string[]
}

/** Pi's documented config precedence, lowest to highest. */
export function piMcpConfigPaths(cwd: string): string[] {
  const home = homedir()
  return [
    join(home, '.config', 'mcp', 'mcp.json'),
    join(home, '.agents', 'mcp.json'),
    join(home, '.agents', 'mcp', 'mcp.json'),
    join(getAgentDir(), 'mcp.json'),
    join(cwd, '.mcp.json'),
    join(cwd, '.pi', 'mcp.json'),
  ]
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

function parseServer(name: string, raw: unknown, sourcePath: string): PiMcpServer | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as UnknownRecord
  const disabled = record.disabled === true
  if (typeof record.url === 'string') {
    return {
      name, sourcePath, transport: 'streamable-http', url: record.url,
      ...(stringRecord(record.headers) === undefined ? {} : { headers: stringRecord(record.headers)! }),
      disabled,
    }
  }
  if (typeof record.command === 'string') {
    return {
      name, sourcePath, transport: 'stdio', command: record.command,
      ...(Array.isArray(record.args) ? { args: record.args.map(String) } : {}),
      ...(stringRecord(record.env) === undefined ? {} : { env: stringRecord(record.env)! }),
      ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
      disabled,
    }
  }
  return undefined
}

export function collectPiMcpServers(cwd: string, extraPaths: string[] = []): { servers: Map<string, PiMcpServer>; sources: string[] } {
  const servers = new Map<string, PiMcpServer>()
  const sources: string[] = []
  for (const path of [...piMcpConfigPaths(cwd), ...extraPaths]) {
    if (!existsSync(path)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    const mcpServers = (parsed as UnknownRecord | undefined)?.mcpServers
    if (typeof mcpServers !== 'object' || mcpServers === null) continue
    sources.push(path)
    for (const [name, raw] of Object.entries(mcpServers)) {
      const record = raw as UnknownRecord | null
      const existing = servers.get(name)
      // Later (higher-precedence) layers override whole entries; a bare
      // `disabled` toggle updates the effective server from a lower layer.
      // The toggle keeps the DEFINING file's sourcePath — a project-local
      // disable of a global server must not reclassify it as project-defined
      // (the Settings view groups by where the definition lives).
      if (existing !== undefined && typeof record === 'object' && record !== null
        && record.command === undefined && record.url === undefined && typeof record.disabled === 'boolean') {
        servers.set(name, { ...existing, disabled: record.disabled })
        continue
      }
      const server = parseServer(name, raw, path)
      if (server !== undefined) servers.set(name, server)
    }
  }
  return { servers, sources }
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u
const ENV_REFERENCE_PATTERN = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/u
const SECRETISH_KEY_PATTERN = /token|secret|key|password|credential/iu

interface JsExpression {
  __pi2dshJs: string
}

function js(expression: string): JsExpression {
  return { __pi2dshJs: expression }
}

function convertValueMap(
  server: string,
  kind: 'env' | 'headers',
  values: Record<string, string> | undefined,
  warnings: McpConversionWarning[],
): Record<string, string | JsExpression> | undefined {
  if (values === undefined) return undefined
  const output: Record<string, string | JsExpression> = {}
  for (const [key, value] of Object.entries(values)) {
    const reference = ENV_REFERENCE_PATTERN.exec(value)
    if (reference !== null) {
      output[key] = js(`process.env.${reference[1]}`)
      continue
    }
    if (SECRETISH_KEY_PATTERN.test(key)) {
      warnings.push({
        server,
        message: `${kind}.${key} carries a literal value; move the secret to an environment variable and reference it as $NAME so the patch stays credential-free`,
      })
    }
    output[key] = value
  }
  return output
}

export function convertPiMcpConfig(cwd: string, extraPaths: string[] = []): McpConversionResult {
  const { servers, sources } = collectPiMcpServers(cwd, extraPaths)
  const warnings: McpConversionWarning[] = []
  const entries: UnknownRecord[] = []
  for (const server of servers.values()) {
    if (server.disabled) {
      warnings.push({ server: server.name, message: 'skipped: disabled in Pi configuration' })
      continue
    }
    if (!SERVER_NAME_PATTERN.test(server.name)) {
      warnings.push({
        server: server.name,
        message: 'skipped: DSH serverName must match [A-Za-z0-9_-]{1,32}; rename the server in the Pi config',
      })
      continue
    }
    const config: UnknownRecord = { serverName: server.name, transport: server.transport }
    if (server.transport === 'stdio') {
      config.command = server.command
      if (server.args !== undefined) config.args = server.args
      const env = convertValueMap(server.name, 'env', server.env, warnings)
      if (env !== undefined) config.env = env
      if (server.cwd !== undefined) config.cwd = server.cwd
    } else {
      config.url = server.url
      const headers = convertValueMap(server.name, 'headers', server.headers, warnings)
      if (headers !== undefined) config.headers = headers
    }
    entries.push({ id: `mcp-${server.name}`, name: '@deepseek-ai/dsh-mcp-client', config })
  }
  return { servers: [...servers.values()], entries, warnings, sources }
}

function yamlScalar(value: unknown, indent: string): string {
  if (typeof value === 'object' && value !== null && '__pi2dshJs' in (value as JsExpression)) {
    return `!!js ${(value as JsExpression).__pi2dshJs}`
  }
  if (typeof value === 'string') {
    return /^[A-Za-z0-9@._\/:-]+$/u.test(value) ? value : JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `\n${value.map(item => `${indent}  - ${yamlScalar(item, `${indent}  `)}`).join('\n')}`
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as UnknownRecord
    const keys = Object.keys(record)
    if (keys.length === 0) return '{}'
    return `\n${keys.map(key => `${indent}  ${key}: ${yamlScalar(record[key], `${indent}  `)}`).join('\n')}`
  }
  return String(value)
}

/** Render the converted entries as a cordis.patch.yml `insert` block. */
export function renderMcpPatch(result: McpConversionResult): string {
  if (result.entries.length === 0) return '# no enabled MCP servers found in Pi configuration\n'
  const lines: string[] = ['- insert:']
  for (const entry of result.entries) {
    lines.push(`    - id: ${String(entry.id)}`)
    lines.push(`      name: '@deepseek-ai/dsh-mcp-client'`)
    lines.push(`      inject: [tools]`)
    lines.push(`      config:${yamlScalar(entry.config, '      ')}`)
  }
  return `${lines.join('\n')}\n`
}
