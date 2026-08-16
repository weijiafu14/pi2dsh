#!/usr/bin/env node
// A deliberately misbehaving MCP stdio server, one scenario per invocation:
//
//   node scenario-server.mjs <scenario>
//
// Each scenario reproduces a failure mode an MCP client has to survive. The
// point is not to test the server — it is to give the client something real
// to be wrong about, so "the plugin mounts" can be told apart from "the
// plugin actually handles this".
//
// Scenarios:
//   healthy        answers everything correctly (the control)
//   slow-init      accepts initialize, answers 60s later — connect timeout
//   dead-init      accepts initialize and never answers — activation hang
//   crash-on-init  exits non-zero during initialize — one bad server
//   list-changed   healthy, then announces a changed tool list after 2s
//   old-protocol   negotiates 2024-11-05 regardless of what is asked
//   resources      healthy plus resources/list + resources/read with text
//
// Every scenario speaks real JSON-RPC over stdio: no scenario is a stub that
// merely prints something plausible.
import { createInterface } from 'node:readline'

const scenario = process.argv[2] ?? 'healthy'
const LATEST_PROTOCOL = '2025-06-18'

const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const reply = (id, result) => send({ id, result })
const fail = (id, code, message) => send({ id, error: { code, message } })

/** The tool list, which `list-changed` swaps out mid-session. */
let tools = [{
  name: 'fixture_echo',
  description: 'Echo back the given text.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'text to echo' } },
    required: ['text'],
  },
}]

const RESOURCE_TEXT = 'PI2DSH_RESOURCE_TEXT resource bodies must survive the round trip'

if (scenario === 'list-changed') {
  // Announce a second tool once the client is up, the notification a client
  // must react to by re-listing rather than caching forever.
  setTimeout(() => {
    tools = [...tools, {
      name: 'fixture_added_later',
      description: 'Appeared after a tools/list_changed notification.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }]
    send({ method: 'notifications/tools/list_changed', params: {} })
  }, 2000).unref?.()
}

createInterface({ input: process.stdin }).on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  const { id, method, params } = message
  if (id === undefined) return // a notification: nothing to answer

  if (method === 'initialize') {
    if (scenario === 'dead-init') return // never answers, on purpose
    if (scenario === 'crash-on-init') { process.exit(3) }
    const answer = () => reply(id, {
      protocolVersion: scenario === 'old-protocol'
        ? '2024-11-05'
        : (params?.protocolVersion ?? LATEST_PROTOCOL),
      capabilities: {
        tools: scenario === 'list-changed' ? { listChanged: true } : {},
        ...scenario === 'resources' ? { resources: {} } : {},
      },
      serverInfo: { name: `pi2dsh-${scenario}`, version: '0.0.0' },
    })
    if (scenario === 'slow-init') setTimeout(answer, 60_000).unref?.()
    else answer()
    return
  }

  if (method === 'tools/list') { reply(id, { tools }); return }

  if (method === 'tools/call') {
    const text = String(params?.arguments?.text ?? '')
    reply(id, { content: [{ type: 'text', text: `PI2DSH_CALL_OK ${text}` }], isError: false })
    return
  }

  if (method === 'resources/list') {
    reply(id, { resources: [{ uri: 'pi2dsh://fixture/note.txt', name: 'note.txt', mimeType: 'text/plain' }] })
    return
  }

  if (method === 'resources/read') {
    reply(id, {
      contents: [{ uri: 'pi2dsh://fixture/note.txt', mimeType: 'text/plain', text: RESOURCE_TEXT }],
    })
    return
  }

  // Unknown methods get a proper JSON-RPC error, not silence.
  fail(id, -32601, `method not found: ${String(method)}`)
})
