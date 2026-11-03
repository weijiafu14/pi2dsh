import { describe, expect, it } from 'vitest'
import { assertMcpScaleTimeout } from '../scripts/lib/mcp-scale-evidence.mjs'

const pair = (id, name, code, text, timeoutMs = 5000) => [
  { type: 'tool/call', data: { callId: id, name, arguments: JSON.stringify({ code, timeoutMs }) } },
  { type: 'tool/result', data: { message: { toolCallId: id, content: [{ type: 'text', text }], isError: false } } },
]
const search = () => pair('search', 'mcpScript', 'return tools.search("slow_task")', '[{"name":"slow_task"}]')
const timeout = () => pair('slow', 'mcpScript', 'return tools.call("many-tools_slow_task", {})', 'mcpScript timed out after 5000ms')
const recovery = () => pair('recovery', 'mcp', '', 'tool_001 reporting in')
const starts = [{ id: 'server-1', tool: 'slow_task', phase: 'started', at: 1001 }]
const check = (records, events = starts, elapsed = 9000) => assertMcpScaleTimeout(records, elapsed, events, 1000)

describe('real MCP timeout acceptance', () => {
  it('ignores a preceding search script and selects the actual timed-out call', () => {
    expect(check([...search(), ...timeout(), ...recovery()])).toEqual({ timeoutCallId: 'slow', serverSlowStarts: 1 })
    // Durable arguments may precede the host's numeric argument coercion.
    expect(check([...pair('slow', 'mcpScript', 'slow_task', 'mcpScript timed out after 5000ms', '5000'), ...recovery()]).serverSlowStarts).toBe(1)
  })
  it('rejects search-only output even if the code contains slow_task and timeoutMs', () => {
    expect(() => check([...search(), ...recovery()])).toThrow('no mcpScript')
  })
  it('rejects a client error when the server handler never ran', () => {
    expect(() => check([...timeout(), ...recovery()], [])).toThrow('never started')
  })
  it('rejects old server events and normal completion', () => {
    expect(() => check([...timeout(), ...recovery()], [{ ...starts[0], at: 999 }])).toThrow('never started')
    expect(() => check([...timeout(), ...recovery()], [...starts, { ...starts[0], phase: 'completed' }])).toThrow('completed normally')
  })
  it('rejects an unrelated error, wrong budget, or recovery before the timeout', () => {
    expect(() => check([...pair('bad', 'mcpScript', 'slow_task', 'Unknown tool'), ...recovery()])).toThrow('no mcpScript')
    expect(() => check([...pair('bad', 'mcpScript', 'slow_task', 'mcpScript timed out after 5000ms', 60000), ...recovery()])).toThrow('no mcpScript')
    expect(() => check([...recovery(), ...timeout()])).toThrow('after the timeout')
  })
  it('rejects a run which waited for the 120-second operation', () => {
    expect(() => check([...timeout(), ...recovery()], starts, 120000)).toThrow('was awaited')
  })
})
