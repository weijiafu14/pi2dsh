// #3923: is streamed tool-call `arguments` accumulation quadratic in the
// argument length? Fault injection at the wire only — the OpenAI client, SSE
// parser and block accumulator under test are unmodified pi-ai; we vary how
// many delta chunks carry one tool call's arguments and time the stream.
//
//   REPO=<repo> PI_AI=<pi-ai dir> node args-reparse-scaling.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.env.REPO + '/package.json')
const { stream } = await import('file://' + process.env.PI_AI + '/dist/api/openai-completions.js')

const model = {
  id: 'm', name: 'M', api: 'openai-completions', provider: 'probe',
  baseUrl: 'http://127.0.0.1:9/v1', reasoning: false,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000, maxTokens: 8192,
}
const context = { messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [] }

/** One tool call whose JSON arguments arrive in `chunks` equal slices. */
const build = chunks => {
  // A realistic big argument: a file-write payload.
  const payload = JSON.stringify({ file_path: 'a.txt', content: 'x'.repeat(chunks * 20) })
  const slice = Math.ceil(payload.length / chunks)
  const frames = [{
    id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm',
    choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write', arguments: '' } }] }, finish_reason: null }],
  }]
  for (let at = 0; at < payload.length; at += slice) {
    frames.push({
      id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm',
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: payload.slice(at, at + slice) } }] }, finish_reason: null }],
    })
  }
  frames.push({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  return { body: [...frames.map(f => `data: ${JSON.stringify(f)}`), 'data: [DONE]', ''].join('\n\n'), payloadChars: payload.length }
}

const results = []
for (const chunks of [100, 400, 1600, 3200]) {
  const { body, payloadChars } = build(chunks)
  const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const started = process.hrtime.bigint()
  let final
  for await (const event of stream(model, context, { apiKey: 'k', fetch: fetchImpl })) {
    if (event.partial) final = event.partial
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  const call = (final?.content ?? []).find(block => block.type === 'toolCall')
  results.push({
    chunks, payloadChars,
    ms: Math.round(ms),
    msPerChunk: Number((ms / chunks).toFixed(3)),
    argsParsedOk: typeof call?.arguments?.content === 'string' && call.arguments.content.length > 0,
  })
  console.error(`chunks=${chunks} payload=${payloadChars} ${Math.round(ms)}ms`)
}

// Quadratic signature: doubling the chunk count more than doubles the time,
// i.e. per-chunk cost grows with the accumulated length.
const first = results[0], last = results[results.length - 1]
const chunkRatio = last.chunks / first.chunks
const timeRatio = last.ms / Math.max(first.ms, 1)
console.log(JSON.stringify({
  results,
  chunkRatio,
  timeRatio: Number(timeRatio.toFixed(2)),
  growth: timeRatio > chunkRatio * 1.5 ? 'super-linear (quadratic signature)' : 'roughly linear',
}, null, 2))
