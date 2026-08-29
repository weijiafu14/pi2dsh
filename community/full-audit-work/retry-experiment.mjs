// R1 validation for #3338 / #3407: does the REAL Pi transport retry path
// recover from 429 insufficient_quota (Retry-After honored) and server_error?
// Fault injection at the wire (options.fetch); pi-ai 0.84.1 stream() +
// retryProviderRequest are the real code under test.
const path = process.env.PI_AI + '/dist/api/openai-completions.js'
const { stream } = await import('file://' + path)

const okBody = [
  'data: ' + JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'recovered' }, finish_reason: null }] }),
  'data: ' + JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
  'data: [DONE]', '',
].join('\n\n')

const model = {
  id: 'm', name: 'M', api: 'openai-completions', provider: 'probe',
  baseUrl: 'http://127.0.0.1:9/v1', reasoning: false,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192, maxTokens: 1024,
}
const context = { messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [] }

const mkCase = (failures) => {
  let call = 0
  const trace = []
  const fetchImpl = async () => {
    const turn = call++
    if (turn < failures.length) {
      const f = failures[turn]
      trace.push(`attempt${turn}:${f.status}`)
      return new Response(JSON.stringify(f.body), { status: f.status, headers: f.headers ?? {} })
    }
    trace.push(`attempt${turn}:200`)
    return new Response(okBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetchImpl, trace }
}

const results = {}
const run = async (name, failures, options = {}) => {
  const { fetchImpl, trace } = mkCase(failures)
  const started = Date.now()
  try {
    const s = stream(model, context, { apiKey: 'k', fetch: fetchImpl, maxRetries: 3, ...options })
    let final
    for await (const event of s) if (event.partial) final = event.partial
    results[name] = {
      trace, elapsedMs: Date.now() - started,
      stopReason: final?.stopReason,
      text: (final?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''),
      errorMessage: final?.errorMessage,
    }
  } catch (error) {
    results[name] = { trace, elapsedMs: Date.now() - started, thrown: String(error).slice(0, 200) }
  }
}

// #3338: 429 insufficient_quota with a short Retry-After — must retry and recover
await run('rate_limit_retry_after', [
  { status: 429, headers: { 'retry-after': '2' }, body: { error: { message: 'insufficient_quota', type: 'insufficient_quota' } } },
])
// #3407: transient 500 server_error — must retry and recover
await run('server_error', [
  { status: 500, body: { error: { message: 'server_error', type: 'server_error' } } },
])
// boundary: Retry-After far above the 60s cap — must fail LOUD naming the delay
await run('rate_limit_over_cap', [
  { status: 429, headers: { 'retry-after': '120' }, body: { error: { message: 'insufficient_quota' } } },
])
// #3338 variant: minute-scale window ACCEPTED when caller raises the cap
await run('rate_limit_long_window_cap_raised', [
  { status: 429, headers: { 'retry-after': '3' }, body: { error: { message: 'insufficient_quota' } } },
], { maxRetryDelayMs: 300_000 })

console.log(JSON.stringify(results, null, 1))
