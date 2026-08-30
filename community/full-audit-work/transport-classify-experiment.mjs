// Two follow-up fault-injection probes on the REAL pi-ai transport/accumulator
// (same posture as accumulator-experiment.mjs: only the wire is synthetic).
//
//   tcpReset          #3112: a connection-level failure (fetch throws, the
//                     "read tcp ..." family) on attempt 0 — does pi-ai's own
//                     retry treat it as transient and recover on attempt 1?
//   reasoningStream   #1198: deltas carry `reasoning_content` alongside
//                     `content` — does the accumulator classify them as
//                     thinking blocks, or fold them into visible text?
//
//   REPO=<repo> PI_AI=<pi-ai dir> node transport-classify-experiment.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.env.REPO + '/package.json')
const { stream } = await import('file://' + process.env.PI_AI + '/dist/api/openai-completions.js')

const sse = chunks => [...chunks.map(c => `data: ${JSON.stringify(c)}`), 'data: [DONE]', ''].join('\n\n')
const chunk = (delta, finish = null) => ({
  id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const model = {
  id: 'm', name: 'M', api: 'openai-completions', provider: 'probe',
  baseUrl: 'http://127.0.0.1:9/v1', reasoning: true,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192, maxTokens: 1024,
}
const context = { messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [] }
const results = {}

// ---- #3112: connection error on the first attempt ------------------------
{
  let attempt = 0
  const trace = []
  const okBody = sse([chunk({ role: 'assistant', content: 'recovered' }), chunk({}, 'stop')])
  const fetchImpl = async () => {
    const turn = attempt++
    if (turn === 0) {
      trace.push('attempt0:throw fetch failed (read tcp reset)')
      const error = new TypeError('fetch failed')
      error.cause = Object.assign(new Error('read tcp 10.0.0.2:52341->104.18.27.90:443: read: connection reset by peer'), { code: 'ECONNRESET' })
      throw error
    }
    trace.push(`attempt${turn}:200`)
    return new Response(okBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  try {
    const s = stream(model, context, { apiKey: 'k', fetch: fetchImpl, maxRetries: 3 })
    let final
    for await (const event of s) if (event.partial) final = event.partial
    results.tcpReset = {
      trace,
      recovered: (final?.content ?? []).some(block => block.type === 'text' && block.text.includes('recovered')),
      stopReason: final?.stopReason,
      errorMessage: final?.errorMessage,
    }
  } catch (error) {
    results.tcpReset = { trace, thrown: String(error).slice(0, 250) }
  }
}

// ---- #1198: reasoning_content deltas ------------------------------------
{
  const body = sse([
    chunk({ role: 'assistant', reasoning_content: 'THINK_' }),
    chunk({ reasoning_content: 'PART' }),
    chunk({ content: 'visible answer' }),
    chunk({}, 'stop'),
  ])
  const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const s = stream(model, context, { apiKey: 'k', fetch: fetchImpl })
  let final
  const eventTypes = []
  for await (const event of s) {
    eventTypes.push(event.type)
    if (event.partial) final = event.partial
  }
  results.reasoningStream = {
    blocks: (final?.content ?? []).map(block => ({ type: block.type, text: String(block.text ?? block.thinking ?? '').slice(0, 60) })),
    thinkingBlockPresent: (final?.content ?? []).some(block => block.type === 'thinking'),
    thinkingLeakedIntoText: (final?.content ?? []).some(block => block.type === 'text' && String(block.text).includes('THINK_')),
    eventTypes: [...new Set(eventTypes)],
  }
}

// ---- #199: vLLM streams thinking as `reasoning` (not reasoning_content) --
{
  const body = sse([
    chunk({ role: 'assistant', reasoning: 'VLLM_THINK_' }),
    chunk({ reasoning: 'PART' }),
    chunk({ content: 'visible answer' }),
    chunk({}, 'stop'),
  ])
  const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const s = stream(model, context, { apiKey: 'k', fetch: fetchImpl })
  let final
  for await (const event of s) if (event.partial) final = event.partial
  results.reasoningFieldVariant = {
    blocks: (final?.content ?? []).map(block => ({ type: block.type, text: String(block.text ?? block.thinking ?? '').slice(0, 60) })),
    thinkingBlockPresent: (final?.content ?? []).some(block => block.type === 'thinking'),
    thinkingTextAnywhere: JSON.stringify(final?.content ?? []).includes('VLLM_THINK_'),
  }
}

// ---- #2158/#3609: Anthropic-style <invoke> emitted as plain content ------
{
  const body = sse([
    chunk({ role: 'assistant', content: '<invoke name="write"><parameter name="file_path">a.txt</parameter></invoke>' }),
    chunk({}, 'stop'),
  ])
  const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const s = stream(model, context, { apiKey: 'k', fetch: fetchImpl })
  let final
  for await (const event of s) if (event.partial) final = event.partial
  results.invokeTagInContent = {
    blocks: (final?.content ?? []).map(block => block.type),
    toolCallDetected: (final?.content ?? []).some(block => block.type === 'toolCall'),
    landsAsText: (final?.content ?? []).some(block => block.type === 'text' && String(block.text).includes('<invoke')),
    stopReason: final?.stopReason,
  }
}

console.log(JSON.stringify(results, null, 2))
