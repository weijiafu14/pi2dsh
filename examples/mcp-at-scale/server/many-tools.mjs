// A REAL stdio MCP server with deliberately many tools — the "1,000 tools"
// shape from deepseek-harness discussion #1604, scaled to 50 so the example
// runs in seconds. Built on the official @modelcontextprotocol/sdk; nothing
// here fakes a protocol frame.
//
// Three kinds of tools:
//   tool_001 … tool_050  — each returns a deterministic sentence; tool_037
//                          additionally returns the launch marker, which
//                          exists NOWHERE else, so an assertion that sees the
//                          marker proves a real call went through the proxy.
//   slow_task            — sleeps ~120 s: timeout-budget material. Any client
//                          that claims a working timeout must produce a
//                          structured failure long before this returns.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const MARKER = 'LAUNCH-MARKER-7741-ZEBRA'

const server = new McpServer({ name: 'many-tools', version: '1.0.0' })

for (let index = 1; index <= 50; index += 1) {
  const name = `tool_${String(index).padStart(3, '0')}`
  server.tool(
    name,
    index === 37
      ? 'Returns the launch marker for the demo mission.'
      : `Demo tool #${index}: returns a fixed sentence.`,
    { probe: z.string().optional().describe('Optional probe text, echoed back.') },
    async ({ probe }) => ({
      content: [{
        type: 'text',
        text: index === 37
          ? `${MARKER} (echo: ${probe ?? 'none'})`
          : `${name} reporting in (echo: ${probe ?? 'none'})`,
      }],
    }),
  )
}

server.tool(
  'slow_task',
  'Simulates a long-running job: resolves after roughly two minutes.',
  {},
  async () => {
    await new Promise(resolve => setTimeout(resolve, 120_000))
    return { content: [{ type: 'text', text: 'slow_task finally finished' }] }
  },
)

await server.connect(new StdioServerTransport())
