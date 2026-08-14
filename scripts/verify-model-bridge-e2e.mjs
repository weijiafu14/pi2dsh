#!/usr/bin/env node
// End-to-end proof of the Model Runtime Bridge against a REAL model:
//
//   official @deepseek-ai/dsh-llm-pi-ai route (DEEPSEEK_API_KEY from env)
//     → ModelCatalog projects the live llm directory as Pi Model objects
//     → a hand-built pi-ai-style stream() call runs on ctx.llm.stream()
//     → Pi AssistantMessageEventStream events come back, done message carries
//       the reply and real token usage.
//
// Usage: DEEPSEEK_API_KEY=… node scripts/verify-model-bridge-e2e.mjs [model]

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('[model-bridge-e2e] DEEPSEEK_API_KEY is required (from env only; never persisted)')
  process.exit(1)
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const jiti = createJiti(import.meta.url)

const { Context } = await import('@deepseek-ai/cordis')
const llmModule = await import('@deepseek-ai/dsh-llm')
const piAiAdapter = await import('@deepseek-ai/dsh-llm-pi-ai')
const bridge = await jiti.import(join(projectRoot, 'src/model-bridge.ts'))

const model = process.argv[2] ?? 'deepseek-chat'
const ctx = new Context()
await ctx.plugin(llmModule.default ?? llmModule.LlmRuntime)
await ctx.plugin(piAiAdapter, {
  providers: {
    deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', models: [{ id: model }] },
  },
})
await new Promise(resolve => setTimeout(resolve, 500))

const llm = bridge.llmOf(ctx)
if (llm === undefined) {
  console.error('[model-bridge-e2e] llmOf(ctx) returned undefined — bridge cannot see the llm service')
  process.exit(1)
}

// 1. Catalog projection from the live directory.
const catalog = new bridge.ModelCatalog(llm)
await catalog.refresh()
const models = catalog.all()
console.log(`[model-bridge-e2e] catalog: ${models.length} model(s):`, models.map(entry => `${entry.provider}/${entry.id}`).join(', '))
if (!models.some(entry => entry.provider === 'deepseek' && entry.id === model)) {
  console.error('[model-bridge-e2e] FAIL: configured model missing from the projected catalog')
  process.exit(1)
}

// 2. Designated-model call through the bridge, consumed as Pi events.
const stream = bridge.streamViaDshLlm(llm, {
  model: { id: model, provider: 'deepseek' },
  context: {
    systemPrompt: 'You are a terse echo bot.',
    messages: [{ role: 'user', content: 'Reply with exactly: PI2DSH_MODEL_BRIDGE_OK' }],
  },
  options: { maxTokens: 64 },
})

const seen = []
for await (const event of stream) {
  seen.push(event.type)
  if (event.type === 'error') {
    console.error('[model-bridge-e2e] FAIL: error event:', String(event.error?.message ?? event.error))
    process.exit(1)
  }
  if (event.type === 'done') {
    const text = event.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    console.log(`[model-bridge-e2e] event sequence: ${seen.join(' → ')}`)
    console.log(`[model-bridge-e2e] reply: ${JSON.stringify(text.slice(0, 120))}`)
    console.log(`[model-bridge-e2e] stopReason: ${event.message.stopReason} | usage:`, JSON.stringify(event.message.usage))
    const ok = text.includes('PI2DSH_MODEL_BRIDGE_OK') && event.message.usage?.output > 0
    console.log(ok ? '[model-bridge-e2e] PASS' : '[model-bridge-e2e] FAIL: marker or usage missing')
    process.exit(ok ? 0 : 1)
  }
}
console.error('[model-bridge-e2e] FAIL: stream ended without done/error')
process.exit(1)
