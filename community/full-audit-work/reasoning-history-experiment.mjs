// #1146 validation: what happens to reasoning (thinking) content when
// assistant HISTORY is replayed through pi-ai's openai-completions transform —
// the cross-provider shape the thread diagnosed as "reasoning_content dropped,
// backend 400".
//
// Two measurements:
//   A. transform-level A/B: convertMessages() of pi-ai 0.82.1 (what
//      @deepseek-ai/dsh@0.1.1-rc.2's dsh-llm-pi-ai ships, and the version the
//      thread diagnosed) vs 0.84.1 (current line), fed an assistant history
//      message carrying a Pi-canonical thinking block.
//   B. live end-to-end on 0.84.1: the same context through the real stream()
//      against the real api.deepseek.com — options.fetch only COPIES the
//      outgoing body and forwards it verbatim; the response is the upstream's
//      own. Proves the transformed history is actually accepted.
//
//   PI_AI_082=<dir> PI_AI_084=<dir> DEEPSEEK_API_KEY=… node reasoning-history-experiment.mjs
import { writeFileSync } from 'node:fs'

const key = process.env.DEEPSEEK_API_KEY
if (!key) { console.error('DEEPSEEK_API_KEY required (real upstream)'); process.exit(1) }

const context = {
  messages: [
    { role: 'user', content: 'What is 2+2? Think first.', timestamp: 1 },
    // Cross-provider history: an assistant message with a thinking block,
    // exactly as Pi persists a reasoning model's answer.
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'REASONING_MARKER_84121: the user asks 2+2; that is 4.' },
        { type: 'text', text: 'The answer is 4.' },
      ],
      api: 'openai-completions',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 2,
    },
    { role: 'user', content: 'Now reply with exactly: HISTORY_OK', timestamp: 3 },
  ],
  tools: [],
}

const model = {
  id: 'deepseek-chat', name: 'DeepSeek Chat', api: 'openai-completions', provider: 'probe',
  baseUrl: 'https://api.deepseek.com/v1', reasoning: false,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000, maxTokens: 1024,
}

const results = { transform: {}, live: {} }

// A. transform-level A/B — the layer the thread's diff targets.
for (const [label, dir] of [['pi-ai-0.82.1', process.env.PI_AI_082], ['pi-ai-0.84.1', process.env.PI_AI_084]]) {
  if (!dir) { results.transform[label] = { skipped: 'path not provided' }; continue }
  const { convertMessages } = await import(`file://${dir}/dist/api/openai-completions.js`)
  try {
    const wire = convertMessages(model, context, {}, {})
    const assistant = wire.find(message => message.role === 'assistant')
    results.transform[label] = {
      assistantKeys: assistant ? Object.keys(assistant).sort() : null,
      reasoningContentField: typeof assistant?.reasoning_content === 'string',
      thinkingTextPreserved: JSON.stringify(wire).includes('REASONING_MARKER_84121'),
      assistantContent: typeof assistant?.content === 'string' ? assistant.content : JSON.stringify(assistant?.content),
    }
  } catch (error) {
    results.transform[label] = { thrown: String(error).slice(0, 300) }
  }
}

// B. live wire on 0.84.1 — request copied, forwarded verbatim, real response.
if (process.env.PI_AI_084) {
  const { stream } = await import(`file://${process.env.PI_AI_084}/dist/api/openai-completions.js`)
  let captured
  const fetchImpl = async (url, init) => {
    captured = JSON.parse(init.body)
    return fetch(url, init)
  }
  const s = stream(model, context, { apiKey: key, fetch: fetchImpl })
  let final
  for await (const event of s) if (event.partial) final = event.partial
  const assistant = (captured?.messages ?? []).find(message => message.role === 'assistant')
  results.live['pi-ai-0.84.1'] = {
    requestAssistantKeys: assistant ? Object.keys(assistant).sort() : null,
    thinkingTextOnWire: JSON.stringify(captured).includes('REASONING_MARKER_84121'),
    upstream: 'https://api.deepseek.com',
    stopReason: final?.stopReason,
    finalText: (final?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('').slice(0, 120),
  }
}

const payload = JSON.stringify(results, null, 2)
if (payload.includes(key)) { console.error('key leaked into results'); process.exit(1) }
writeFileSync(new URL('reasoning-history-results.json', import.meta.url), `${payload}\n`)
console.log(payload)
