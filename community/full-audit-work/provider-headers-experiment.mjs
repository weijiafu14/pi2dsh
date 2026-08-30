// What can a provider declaration put on the WIRE besides the body?
// Three community asks converge here: custom headers for internal gateways
// (#2475), request-body/identity passthrough (#3761), and per-session
// attribution on a gateway's usage panel (#599).
//
// Fault injection at the wire only: options.fetch captures the outgoing
// headers and returns a canned SSE; the OpenAI client, header merge and
// accumulator under test are unmodified pi-ai.
//
//   REPO=<repo> PI_AI=<pi-ai dir> node provider-headers-experiment.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.env.REPO + '/package.json')
const { stream } = await import('file://' + process.env.PI_AI + '/dist/api/openai-completions.js')

const okBody = [
  'data: ' + JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }),
  'data: ' + JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
  'data: [DONE]', '',
].join('\n\n')

const baseModel = {
  id: 'm', name: 'M', api: 'openai-completions', provider: 'probe',
  baseUrl: 'http://127.0.0.1:9/v1', reasoning: false,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192, maxTokens: 1024,
}
const context = { messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [] }

const results = {}
const run = async (name, model, options = {}) => {
  let seen
  const fetchImpl = async (url, init) => {
    // Header names only, plus values for the non-secret ones under test. The
    // api key never appears: the Authorization value is replaced by its
    // presence bit before anything is recorded.
    const raw = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : { ...(init?.headers ?? {}) }
    seen = {}
    for (const [key, value] of Object.entries(raw)) {
      const lower = key.toLowerCase()
      seen[lower] = /^(authorization|proxy-authorization|api-key|apikey|x-api-key)$/u.test(lower) ? '<present>' : String(value)
    }
    return new Response(okBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  try {
    const s = stream(model, context, { apiKey: 'probe-key', fetch: fetchImpl, ...options })
    for await (const event of s) void event
  } catch (error) {
    results[name] = { thrown: String(error).slice(0, 200), headers: seen }
    return
  }
  const names = Object.keys(seen ?? {}).sort()
  results[name] = {
    customHeaderOnWire: seen?.['x-custom-gateway-token'] ?? null,
    sessionHeaders: Object.fromEntries(Object.entries(seen ?? {}).filter(([key]) =>
      /session|client-request-id/u.test(key))),
    headerNames: names,
  }
}

// A. #2475: a declared custom header on the model entry.
await run('declaredCustomHeader', {
  ...baseModel,
  headers: { 'X-Custom-Gateway-Token': 'CUSTOM_HEADER_MARKER' },
})

// B. #599 default: a session id is supplied but nothing is declared — is the
// session identifiable to the gateway at all?
await run('sessionIdDefault', baseModel, { sessionId: 'session-abc123' })

// C. #599 opt-in: the compat switch pi-ai already has for session affinity.
await run('sessionAffinityOptIn', {
  ...baseModel,
  compat: { sendSessionAffinityHeaders: true },
}, { sessionId: 'session-abc123' })

// D. openrouter format variant.
await run('sessionAffinityOpenrouter', {
  ...baseModel,
  compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: 'openrouter' },
}, { sessionId: 'session-abc123' })

// E. cacheRetention none suppresses the session id even when opted in.
await run('sessionAffinityCacheNone', {
  ...baseModel,
  compat: { sendSessionAffinityHeaders: true },
}, { sessionId: 'session-abc123', cacheRetention: 'none' })

// F. both together: a gateway that wants its own header AND session affinity.
await run('customHeaderPlusSession', {
  ...baseModel,
  headers: { 'X-Custom-Gateway-Token': 'CUSTOM_HEADER_MARKER' },
  compat: { sendSessionAffinityHeaders: true },
}, { sessionId: 'session-abc123' })

console.log(JSON.stringify(results, null, 2))
