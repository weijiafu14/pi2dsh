import { EventEmitter } from 'node:events'
import { McpServerRegistry, mcpNamespace, validateMcpServerConfig } from './compat/vendor/pi-mcp-servers.js'

// The bus is already owned by one Agent. This is Pi's registration ledger,
// not a connection manager; the consuming MCP extension owns connections.
const registries = new WeakMap<EventEmitter, McpServerRegistry>()
export const mcpRegistrationChanged = Symbol('pi2dsh.mcpRegistrationChanged')

export function mcpRegistrations(bus: EventEmitter): McpServerRegistry {
  let registry = registries.get(bus)
  if (registry === undefined) {
    registry = new McpServerRegistry()
    const current = registry
    current.setChangeListener(() => bus.emit(mcpRegistrationChanged, current.list()))
    registries.set(bus, current)
  }
  return registry
}

/** Pi loader ownership and namespace checks, before changing the shared ledger. */
export function registerMcpServer(bus: EventEmitter, owner: string, name: string, config: unknown): void {
  const validated = validateMcpServerConfig(name, config)
  if (typeof validated === 'string') throw new Error(`Invalid MCP server registered by extension "${owner}": ${validated}`)
  const registry = mcpRegistrations(bus)
  const existingOwner = registry.get(name)?.extensionPath
  if (existingOwner !== undefined && existingOwner !== owner) throw new Error(`MCP server "${name}" is already registered by extension "${existingOwner}"`)
  const clash = registry.list().find(server => server.name !== name && mcpNamespace(server.name) === mcpNamespace(name))
  if (clash !== undefined) throw new Error(`MCP server "${name}" conflicts with registered server "${clash.name}"`)
  registry.register({ name, config: structuredClone(validated), extensionPath: owner })
}
