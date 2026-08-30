#!/usr/bin/env node
// A passthrough recorder for the requests pi2dsh sends to your gateway.
//
// It is NOT a stand-in for a gateway: every request is forwarded to the real
// upstream and the real response is streamed back untouched. All it adds is a
// copy of each request body on disk, so you can see exactly what reached the
// wire — which is the only way to check a compat declaration actually took
// effect.
//
//   PROXY_UPSTREAM=https://api.deepseek.com node recording-proxy.mjs
//   PROXY_PORT=4599 PROXY_LOG=/tmp/requests.jsonl node recording-proxy.mjs
//
// PROXY_UPSTREAM is the upstream ORIGIN, with no path: the incoming request's
// own path (`/v1/chat/completions`) is appended to it verbatim.
//
// Then point a Pi provider's baseUrl at http://127.0.0.1:4599/v1 and run a
// normal turn. The upstream credential rides the request's own Authorization
// header, exactly as it would without the proxy in the way — nothing is read
// from the environment and nothing is stored.
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'

const LOG = process.env.PROXY_LOG ?? new URL('requests.jsonl', import.meta.url).pathname
const PORT = Number(process.env.PROXY_PORT ?? 4599)
const UPSTREAM = (process.env.PROXY_UPSTREAM ?? 'https://api.deepseek.com').replace(/\/+$/u, '')
writeFileSync(LOG, '')

/** Whether any message carries an image part (the multimodal check). */
const hasImagePart = messages => (messages ?? []).some(message =>
  Array.isArray(message?.content)
  && message.content.some(part => typeof part?.type === 'string' && part.type.includes('image')))

createServer((req, res) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    void (async () => {
      const raw = Buffer.concat(chunks)
      let parsed = {}
      try { parsed = JSON.parse(raw.toString('utf8') || '{}') } catch { parsed = {} }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : undefined

      appendFileSync(LOG, `${JSON.stringify({
        url: req.url,
        model: parsed.model,
        // supportsDeveloperRole: `system` here means the plugin's flag won.
        roles: messages?.map(message => message.role) ?? null,
        // maxTokensField: which spelling the request used.
        maxTokensField: parsed.max_completion_tokens !== undefined
          ? 'max_completion_tokens'
          : parsed.max_tokens !== undefined ? 'max_tokens' : null,
        maxTokensValue: parsed.max_completion_tokens ?? parsed.max_tokens ?? null,
        // What the tool declarations carried: name, description length, and
        // per-parameter description lengths. Length instead of text keeps the
        // log compact while still proving the fields were sent non-empty.
        tools: Array.isArray(parsed.tools) ? parsed.tools.map(tool => ({
          name: tool.function?.name,
          descriptionChars: typeof tool.function?.description === 'string' ? tool.function.description.length : 0,
          params: Object.fromEntries(Object.entries(tool.function?.parameters?.properties ?? {})
            .map(([key, schema]) => [key, typeof schema?.description === 'string' ? schema.description.length : 0])),
        })) : null,
        // The effort the user picked, after the model's thinkingLevelMap.
        reasoningEffort: parsed.reasoning_effort ?? null,
        // supportsStore and friends: present only when the compat allows them.
        store: parsed.store ?? null,
        hasImagePart: hasImagePart(messages),
        // Everything else, so an unexpected field is visible rather than lost.
        bodyKeys: Object.keys(parsed).sort(),
        previews: messages?.map(message => {
          const content = message.content
          const text = typeof content === 'string'
            ? content
            : (Array.isArray(content) ? content : []).map(part => part?.text ?? `[${part?.type}]`).join(' ')
          return `${message.role}: ${String(text).slice(0, 60).replace(/\s+/gu, ' ')}`
        }) ?? null,
      })}\n`)

      // Forward untouched. The response the caller sees is the upstream's own.
      const headers = { ...req.headers }
      delete headers.host
      delete headers['content-length']
      let upstream
      try {
        upstream = await fetch(`${UPSTREAM}${req.url}`, {
          method: req.method,
          headers,
          ...(raw.length === 0 ? {} : { body: raw }),
        })
      } catch (error) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `recording-proxy: upstream unreachable: ${String(error)}` } }))
        return
      }
      const forwarded = {}
      for (const [name, value] of upstream.headers) {
        // Hop-by-hop headers must not be replayed onto a different connection.
        if (['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length'].includes(name)) continue
        forwarded[name] = value
      }
      res.writeHead(upstream.status, forwarded)
      if (upstream.body === null) { res.end(); return }
      const reader = upstream.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    })()
  })
}).listen(PORT, '127.0.0.1', () => console.log(`recording proxy on ${PORT} → ${UPSTREAM}, logging to ${LOG}`))
