#!/usr/bin/env node
// End-to-end proof that a Pi OAuth token is consumed by DeepSeek Harness's
// NATIVE model-call path — the full L4 loop:
//
//   auth.json (from a real /login)
//     → pi2dsh's dsh-credentials provider (PI2DSH_OAUTH_* refs, per-request
//       resolution through Pi's double-checked-lock refresh)
//     → official @deepseek-ai/dsh-llm-pi-ai route (apiKeyEnv)
//     → ctx.llm.stream() — DSH's own LLM runtime issues the request
//     → a real model reply comes back on the OAuth subscription.
//
// Usage: node scripts/verify-oauth-llm-e2e.mjs [authDir] [model]

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

if (process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY) {
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
  console.log('[llm-e2e] proxying fetch through the environment proxy')
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const jiti = createJiti(import.meta.url)

const { Context } = await import('@deepseek-ai/cordis')
const llm = await import('@deepseek-ai/dsh-llm')
const piAiAdapter = await import('@deepseek-ai/dsh-llm-pi-ai')
const credentialsOAuth = await jiti.import(join(projectRoot, 'src/credentials-oauth.ts'))

const authDir = process.argv[2] ?? join(projectRoot, '.oauth-e2e')
const model = process.argv[3] ?? 'gpt-5.6-luna'
const providerId = 'openai-codex'
const ref = credentialsOAuth.oauthCredentialRef(providerId)
console.log(`[llm-e2e] provider route: ${providerId} | model: ${model} | credential ref: ${ref}`)
console.log(`[llm-e2e] auth store: ${join(authDir, 'auth.json')}`)

const ctx = new Context()
await ctx.plugin(llm.default ?? llm.LlmRuntime)
credentialsOAuth.apply(ctx, { authPath: join(authDir, 'auth.json') })
await ctx.plugin(piAiAdapter, {
  providers: {
    [providerId]: { apiKeyEnv: ref, models: [{ id: model }] },
  },
})
await new Promise(resolve => setTimeout(resolve, 800))

const credential = await ctx.credentials.resolve(ref)
if (!credential) {
  console.error('[llm-e2e] no stored OAuth credential — run scripts/verify-oauth-e2e.mjs first')
  process.exit(1)
}
console.log(`[llm-e2e] ctx.credentials resolved the ref (source: ${credential.source}, ${credential.value.length} chars) — value never printed`)

const message = llm.createUserMessage({ content: [{ type: 'text', text: 'Reply with exactly: PI2DSH_L4_OK' }], source: { producer: 'user' } })
let reply = ''
const started = Date.now()
try {
  console.log('[llm-e2e] retry policy for route:', JSON.stringify(ctx.llm.providerRetryPolicy?.(providerId) ?? 'n/a'))
} catch (error) {
  console.log('[llm-e2e] providerRetryPolicy threw:', String(error?.message ?? error).slice(0, 200))
}
for await (const chunk of ctx.llm.stream({
  provider: providerId,
  model,
  messages: [message],
  tools: [],
  system: 'You are a terse echo bot.',
  maxTokens: 2048,
})) {
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
  if (chunk.type === 'finish') console.log(`[llm-e2e] finish: ${JSON.stringify(chunk.reason?.kind)} | usage seen above`)
}
console.log(`[llm-e2e] model replied in ${Date.now() - started}ms: ${JSON.stringify(reply.trim().slice(0, 200))}`)

if (!reply.includes('PI2DSH_L4_OK')) {
  console.error('[llm-e2e] FAIL: reply did not contain the expected marker')
  process.exit(1)
}
console.log('[llm-e2e] PASS: OAuth token -> pi2dsh credentials provider -> official dsh-llm-pi-ai route -> DSH-native model call -> real reply')
process.exit(0)
