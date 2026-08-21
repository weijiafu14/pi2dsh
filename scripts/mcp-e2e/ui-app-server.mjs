#!/usr/bin/env node
// Minimal real stdio MCP server for the host-side MCP Apps acceptance path.
// It deliberately uses the wire protocol directly so the verifier does not
// need a second SDK implementation or a private pi-mcp-adapter import.

import { createInterface } from 'node:readline'

const RESOURCE_URI = 'ui://pi2dsh-e2e/dashboard.html'
const APP_MARKER = 'PI2DSH_MCP_APP_HTML_OK'

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', line => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize':
      result(request.id, {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: 'pi2dsh-mcp-app-e2e', version: '1.0.0' },
        instructions: 'Open the dashboard to verify MCP Apps through the Pi host bridge.',
      })
      break
    case 'ping':
      result(request.id, {})
      break
    case 'tools/list':
      result(request.id, {
        tools: [{
          name: 'open_dashboard',
          description: 'Open the pi2dsh MCP Apps acceptance dashboard.',
          inputSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
            additionalProperties: false,
          },
          _meta: { ui: { resourceUri: RESOURCE_URI } },
        }],
      })
      break
    case 'resources/list':
      result(request.id, {
        resources: [{ name: 'dashboard', uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app' }],
      })
      break
    case 'resources/templates/list':
    case 'prompts/list':
      result(request.id, request.method === 'prompts/list' ? { prompts: [] } : { resourceTemplates: [] })
      break
    case 'resources/read':
      if (request.params?.uri !== RESOURCE_URI) {
        error(request.id, -32602, 'unknown resource')
        break
      }
      result(request.id, {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: `<!doctype html><html><body><main id="marker">${APP_MARKER}</main></body></html>`,
        }],
      })
      break
    case 'tools/call':
      if (request.params?.name !== 'open_dashboard') {
        error(request.id, -32602, 'unknown tool')
        break
      }
      result(request.id, {
        content: [{ type: 'text', text: `Opened dashboard: ${String(request.params?.arguments?.title ?? '')}` }],
        structuredContent: { opened: true, title: request.params?.arguments?.title ?? '' },
      })
      break
    default:
      error(request.id, -32601, `method not found: ${String(request.method)}`)
  }
})
