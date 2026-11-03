import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { mcpRegistrations, mcpRegistrationChanged, registerMcpServer } from '../src/mcp-registration.js'

describe('Pi 1.x MCP registration metadata', () => {
  it('shares registrations within one Agent, clones reads and isolates other Agents', () => {
    const a = new EventEmitter()
    const b = new EventEmitter()
    const config = { command: 'node', args: ['server.js'], exposure: 'direct' }
    registerMcpServer(a, '/extensions/a.ts', 'docs', config)
    config.args.push('changed')
    const read = mcpRegistrations(a).list()
    expect(read[0]).toMatchObject({ name: 'docs', config: { args: ['server.js'] } })
    read[0]!.config.enabled = false
    expect(mcpRegistrations(a).list()[0]!.config.enabled).toBeUndefined()
    expect(mcpRegistrations(b).list()).toEqual([])
  })

  it('rejects namespace and ownership collisions and only lets the owner unregister', () => {
    const bus = new EventEmitter()
    registerMcpServer(bus, 'a', 'my-docs', { command: 'node' })
    expect(() => registerMcpServer(bus, 'b', 'my-docs', { command: 'node' })).toThrow('already registered')
    expect(() => registerMcpServer(bus, 'b', 'my_docs', { command: 'node' })).toThrow('conflicts')
    mcpRegistrations(bus).unregister('my-docs', 'b')
    expect(mcpRegistrations(bus).list()).toHaveLength(1)
    mcpRegistrations(bus).unregister('my-docs', 'a')
    expect(mcpRegistrations(bus).list()).toEqual([])
  })

  it('validates Pi configs and announces only actual accepted mutations', () => {
    const bus = new EventEmitter()
    const events: unknown[] = []
    bus.on(mcpRegistrationChanged, value => events.push(value))
    expect(() => registerMcpServer(bus, 'a', 'bad name', { command: 'node' })).toThrow('invalid server name')
    expect(() => registerMcpServer(bus, 'a', 'docs', { url: 'file:///secret' })).toThrow('http or https')
    registerMcpServer(bus, 'a', 'docs', { url: 'https://example.com/mcp', exposure: 'codemode-deferred' })
    expect(mcpRegistrations(bus).list()[0]!.config.exposure).toBe('codemode')
    mcpRegistrations(bus).unregister('docs', 'a')
    expect(events).toHaveLength(2)
    expect(events.at(-1)).toEqual([])
  })
})
