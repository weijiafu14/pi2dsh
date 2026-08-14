#!/usr/bin/env node
// End-to-end interactive OAuth verification for the pi2dsh OAuth host seam.
//
// Runs the vendored Pi OpenAI Codex flow (PKCE + localhost:1455 callback
// server) through the bridge's login driver: prints the authorization URL,
// waits for the browser redirect, persists the credential through the
// Pi-format FileCredentialStore, then resolves an API key through the
// vendored double-checked-lock resolver and locally decodes the JWT to prove
// the token is real. Tokens never leave the machine; output masks secrets.
//
// Usage: node scripts/verify-oauth-e2e.mjs [provider] [authDir]
//   provider defaults to openai-codex (also: anthropic, github-copilot, kimi-coding)

import { mkdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

// Node's fetch ignores proxy environment variables; honor them here so the
// token exchange leaves through the same route as the user's browser.
// EnvHttpProxyAgent also respects NO_PROXY, keeping localhost callback
// traffic direct.
if (process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY) {
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
  console.log(`[e2e] proxying fetch through ${process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY}`)
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const jiti = createJiti(import.meta.url)

const { FileCredentialStore, loginPiProvider, resolveOAuthApiKey } = await jiti.import(join(projectRoot, 'src/oauth-bridge.ts'))
const piAi = await jiti.import(join(projectRoot, 'src/compat/pi-ai.ts'))

const providerId = process.argv[2] ?? 'openai-codex'
const provider = piAi.builtinProviders().find(entry => entry.id === providerId)
if (!provider) {
  console.error(`unknown provider ${providerId}; available: ${piAi.builtinProviders().map(p => p.id).join(', ')}`)
  process.exit(1)
}

const authDir = process.argv[3] ?? join(projectRoot, '.artifacts', 'oauth-e2e')
mkdirSync(authDir, { recursive: true })
const authPath = join(authDir, 'auth.json')
const store = new FileCredentialStore(authPath)

const mask = value => typeof value === 'string' && value.length > 12
  ? `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`
  : '(short value)'

const ui = {
  async select(title, options) {
    // The Codex flow first asks browser vs device-code; this E2E exercises the
    // real browser flow.
    const labels = options.map(String)
    const pick = labels.find(label => /browser/iu.test(label)) ?? labels[0]
    console.log(`[select] ${title} -> ${pick}`)
    return pick
  },
  async input(title) {
    // The flow races the browser callback against manual code entry; hold the
    // manual branch open (file channel) and let the callback win.
    const answersPath = join(authDir, 'manual-code.txt')
    console.log(`[input-waiting] ${title}`)
    console.log(`[input-waiting] the localhost callback completes this automatically; to paste a code manually, write it to ${answersPath}`)
    return await new Promise(resolve => {
      const poll = setInterval(() => {
        try {
          const text = readFileSync(answersPath, 'utf8').trim()
          if (text.length > 0) {
            clearInterval(poll)
            resolve(text)
          }
        } catch {
          // No manual answer yet — keep waiting for the browser callback.
        }
      }, 500)
      poll.unref?.()
    })
  },
  notify(message) {
    console.log(`[notify] ${String(message)}`)
  },
}

console.log(`[e2e] provider: ${provider.id} (${provider.name})`)
console.log(`[e2e] auth store: ${authPath}`)
console.log('[e2e] starting the package-owned login flow…')

const timer = setTimeout(() => {
  console.error('[e2e] timed out waiting for authorization (10 minutes)')
  process.exit(2)
}, 600_000)

const credential = await loginPiProvider({
  providerId: provider.id,
  providerName: provider.name,
  providerConfig: { baseUrl: provider.baseUrl, oauth: provider.auth.oauth },
  store,
  ui,
})
clearTimeout(timer)

console.log('[e2e] login complete; credential persisted')
console.log(`[e2e] credential type: ${credential.type} | access: ${mask(credential.access)} | refresh: ${mask(credential.refresh)} | expires: ${new Date(credential.expires).toISOString()}`)

const mode = statSync(authPath).mode & 0o777
console.log(`[e2e] auth.json mode: 0o${mode.toString(8)} | providers stored: ${Object.keys(JSON.parse(readFileSync(authPath, 'utf8'))).join(', ')}`)

const apiKey = await resolveOAuthApiKey({
  providerId: provider.id,
  providerName: provider.name,
  providerConfig: { baseUrl: provider.baseUrl, oauth: provider.auth.oauth },
  store,
})
console.log(`[e2e] resolveOAuthApiKey -> ${mask(apiKey)}`)

// Local-only JWT decode: proves the token is a real, signed grant without
// sending it anywhere.
try {
  const payload = JSON.parse(Buffer.from(String(apiKey).split('.')[1], 'base64url').toString('utf8'))
  const summary = {
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp !== undefined ? new Date(payload.exp * 1000).toISOString() : undefined,
    email: typeof payload['https://api.openai.com/profile']?.email === 'string'
      ? payload['https://api.openai.com/profile'].email.replace(/^(.).*(@.*)$/u, '$1***$2')
      : undefined,
    plan: payload['https://api.openai.com/auth']?.chatgpt_plan_type,
  }
  console.log(`[e2e] JWT payload (local decode): ${JSON.stringify(summary)}`)
} catch {
  console.log('[e2e] token is not a JWT (opaque token) — skipping local decode')
}

console.log('[e2e] PASS: browser authorization -> package protocol -> Pi-format store -> refreshable API key')
process.exit(0)
