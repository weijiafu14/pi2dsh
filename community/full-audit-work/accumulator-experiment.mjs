// R1 step-1 experiment: does pi-ai's REAL openai-completions accumulator
// survive the malformed tool-call delta shapes gateways actually emit?
// Fault injection at the wire: options.fetch returns crafted SSE bytes; the
// openai client, SSE parser and accumulator under test are all real code
// (pi-ai 0.84.1 — the pinned generation the bridge routes through).
import { createRequire } from 'node:module'
const require = createRequire(process.env.REPO + '/package.json')
const path = process.env.PI_AI + '/dist/api/openai-completions.js'
const { stream } = await import('file://' + path)

const sse = chunks => [...chunks.map(c => `data: ${JSON.stringify(c)}`), 'data: [DONE]', ''].join('\n\n')
const chunk = (delta, finish = null) => ({
  id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm',
  choices: [{ index: 0, delta, finish_reason: finish }],
})

const CASES = {
  // A. well-formed: id+name on first delta, args split across index-keyed deltas
  baseline: [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"paris"}' } }] }),
    chunk({}, 'tool_calls'),
  ],
  // B. continuation deltas carry EMPTY id/name strings (common gateway shape)
  emptyContinuation: [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, id: '', function: { name: '', arguments: '{"city":' } }] }),
    chunk({ tool_calls: [{ index: 0, id: '', function: { name: '', arguments: '"paris"}' } }] }),
    chunk({}, 'tool_calls'),
  ],
  // C. first delta has EMPTY id/name; real ones only arrive later
  lateIdentity: [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: '', type: 'function', function: { name: '', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, id: 'call_9', function: { name: 'get_time', arguments: '{"city":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"paris"}' } }] }),
    chunk({}, 'tool_calls'),
  ],
  // D. TWO parallel calls, NO ids anywhere, interleaved purely by index
  parallelNoIds: [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, type: 'function', function: { name: 'get_time', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 1, type: 'function', function: { name: 'get_weather', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":"paris"}' } }] }),
    chunk({ tool_calls: [{ index: 1, function: { arguments: '{"city":"oslo"}' } }] }),
    chunk({}, 'tool_calls'),
  ],
  // E. no index field at all (id-keyed continuation only)
  noIndex: [
    chunk({ role: 'assistant', tool_calls: [{ id: 'call_5', type: 'function', function: { name: 'get_time', arguments: '' } }] }),
    chunk({ tool_calls: [{ id: 'call_5', function: { arguments: '{"city":"paris"}' } }] }),
    chunk({}, 'tool_calls'),
  ],
  // G. TWO calls arriving under the SAME index (the #4091 shape): does the
  // accumulator keep them apart (by id) or silently merge them into one?
  duplicateIndex: [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_time', arguments: '{"city":"paris"}' } }] }),
    chunk({ tool_calls: [{ index: 0, id: 'call_b', type: 'function', function: { name: 'get_weather', arguments: '{"city":"oslo"}' } }] }),
    chunk({}, 'tool_calls'),
  ],
  // F. markdown fence around arguments (the #3047 family)
  fencedArgs: [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_2', type: 'function', function: { name: 'get_time', arguments: '```json\n{"city":"paris"}\n```' } }] }),
    chunk({}, 'tool_calls'),
  ],
}

const model = {
  id: 'm', name: 'M', api: 'openai-completions', provider: 'probe',
  baseUrl: 'http://127.0.0.1:9/v1', reasoning: false,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192, maxTokens: 1024,
}
const context = {
  messages: [{ role: 'user', content: 'now?', timestamp: 1 }],
  tools: [
    { name: 'get_time', description: 'time', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
    { name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
  ],
}

const results = {}
for (const [name, chunks] of Object.entries(CASES)) {
  const body = sse(chunks)
  const fetchImpl = async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
  try {
    const s = stream(model, context, { apiKey: 'test-key', fetch: fetchImpl, maxRetries: 0 })
    let final
    for await (const event of s) {
      if (event.type === 'done' || event.type === 'end') final = event.message ?? event.partial
      if (event.partial) final = event.partial
    }
    const calls = (final?.content ?? []).filter(b => b.type === 'toolCall')
      .map(b => ({ id: b.id, name: b.name, args: b.arguments }))
    results[name] = { stopReason: final?.stopReason, calls }
  } catch (error) {
    results[name] = { error: String(error).slice(0, 200) }
  }
}
console.log(JSON.stringify(results, null, 1))
