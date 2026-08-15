// Contract tests for the bridge's own openai-completions wire client — the
// engine's dependency tree must stay free of install-script packages, so
// this client, not pi-ai, serves the common gateway protocol. Semantics are
// asserted against a real local HTTP gateway speaking OpenAI SSE.
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { liteConvertMessages, stream } from '../src/compat/openai-completions-lite.js'

type UnknownRecord = Record<string, unknown>

let server: Server
let baseUrl: string
let lastRequest: { url: string, headers: Record<string, unknown>, body: UnknownRecord } | undefined

const SSE_CHUNKS: UnknownRecord[] = [
  { choices: [{ delta: { reasoning_content: 'thinking ' } }] },
  { choices: [{ delta: { reasoning_content: 'hard' } }] },
  { choices: [{ delta: { content: 'The answer ' } }] },
  { choices: [{ delta: { content: 'is 42.' } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{"ci' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"x"}' } }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  { usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }, choices: [] },
]

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      lastRequest = {
        url: String(request.url),
        headers: request.headers as Record<string, unknown>,
        body: JSON.parse(body) as UnknownRecord,
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const chunk of SSE_CHUNKS) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
})

describe('liteConvertMessages', () => {
  it('converts system, image-bearing user, assistant tool calls, and tool results', () => {
    const messages = liteConvertMessages({
      systemPrompt: 'be terse',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'look:' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'toolCall', id: 'c1', name: 'lookup', arguments: { q: 1 } }] },
        { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: 'found' }] },
      ],
    })
    expect(messages[0]).toEqual({ role: 'system', content: 'be terse' })
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    })
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: 'calling',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":1}' } }],
    })
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'found' })
  })

  it('keeps a text-only user message as a plain string (gateway compatibility)', () => {
    const messages = liteConvertMessages({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
    expect(messages[0]).toEqual({ role: 'user', content: 'hi' })
  })
})

describe('stream against a real SSE gateway', () => {
  it('emits Pi thinking/text/toolcall events and a done message with usage', async () => {
    const events: UnknownRecord[] = []
    const model = { id: 'gw-mini', provider: 'gw', baseUrl, api: 'openai-completions' }
    for await (const event of stream(model, {
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      tools: [{ name: 'lookup', description: 'find', parameters: { type: 'object', properties: {} } }],
    }, { apiKey: 'test-key', headers: { 'X-Route': 'lite' }, maxTokens: 64, temperature: 0.2 }) as AsyncIterable<UnknownRecord>) {
      events.push(event)
    }
    const kinds = events.map(event => event.type)
    expect(kinds).toEqual([
      'start',
      'thinking_start', 'thinking_delta', 'thinking_delta', 'thinking_end',
      'text_start', 'text_delta', 'text_delta', 'text_end',
      'toolcall_start', 'toolcall_delta', 'toolcall_delta', 'toolcall_end',
      'done',
    ])
    const done = events.at(-1) as { message: { content: UnknownRecord[], usage: UnknownRecord, stopReason: string } }
    expect(done.message.stopReason).toBe('toolUse')
    expect(done.message.usage).toMatchObject({ input: 11, output: 7, totalTokens: 18 })
    expect(done.message.content).toEqual([
      { type: 'thinking', thinking: 'thinking hard' },
      { type: 'text', text: 'The answer is 42.' },
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { city: 'x' } },
    ])

    // The wire request carried the gateway essentials.
    expect(lastRequest?.body).toMatchObject({
      model: 'gw-mini',
      stream: true,
      max_completion_tokens: 64,
      temperature: 0.2,
      stream_options: { include_usage: true },
    })
    expect((lastRequest?.body.messages as UnknownRecord[])[0]).toEqual({ role: 'system', content: 'sys' })
    expect((lastRequest?.body.tools as UnknownRecord[])[0]).toMatchObject({ type: 'function', function: { name: 'lookup' } })
    expect(lastRequest?.headers.authorization).toBe('Bearer test-key')
    expect(lastRequest?.headers['x-route']).toBe('lite')
  })

  it('honors the compat switches gateways vary on', async () => {
    const events: UnknownRecord[] = []
    const model = {
      id: 'gw-legacy', provider: 'gw', baseUrl, api: 'openai-completions',
      compat: { maxTokensField: 'max_tokens', supportsUsageInStreaming: false },
    }
    for await (const event of stream(model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] }, { apiKey: 'k', maxTokens: 9 }) as AsyncIterable<UnknownRecord>) {
      events.push(event)
    }
    expect(events.at(-1)?.type).toBe('done')
    expect(lastRequest?.body).toMatchObject({ max_tokens: 9 })
    expect(lastRequest?.body.max_completion_tokens).toBeUndefined()
    expect(lastRequest?.body.stream_options).toBeUndefined()
  })

  it('surfaces gateway failures as Pi error events, never fabricated completions', async () => {
    const events: UnknownRecord[] = []
    const model = { id: 'gw-mini', provider: 'gw', baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions' }
    for await (const event of stream(model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] }, { apiKey: 'k' }) as AsyncIterable<UnknownRecord>) {
      events.push(event)
    }
    expect(events.map(event => event.type)).toEqual(['start', 'error'])
  })
})
