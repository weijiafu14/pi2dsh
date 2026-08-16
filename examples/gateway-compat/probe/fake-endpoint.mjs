#!/usr/bin/env node
// A fake OpenAI-compatible endpoint that records exactly what it is sent.
// The whole experiment: do a Pi plugin's own model declarations reach the wire?
//
//   node fake-endpoint.mjs           # listens on 4599, logs beside this file
//   PROBE_PORT=4600 PROBE_LOG=/tmp/x.jsonl node fake-endpoint.mjs
//
// Each request appends one line describing the parts that carry a compat
// decision, so a reader can check them without trusting a summary.
import { createServer } from 'node:http'
import { writeFileSync, appendFileSync } from 'node:fs'

const LOG = process.env.PROBE_LOG ?? new URL('requests.jsonl', import.meta.url).pathname
const PORT = Number(process.env.PROBE_PORT ?? 4599)
writeFileSync(LOG, '')

/** Whether any message carries an image part (the multimodal check). */
const hasImagePart = messages => (messages ?? []).some(message =>
  Array.isArray(message?.content)
  && message.content.some(part => typeof part?.type === 'string' && part.type.includes('image')))

createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    let parsed
    try { parsed = JSON.parse(body) } catch { parsed = { unparsed: body } }
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
      // The effort the user picked, after the model's thinkingLevelMap.
      reasoningEffort: parsed.reasoning_effort ?? null,
      // supportsStore and friends: present only when the compat allows them.
      store: parsed.store ?? null,
      hasImagePart: hasImagePart(messages),
      // Everything else, so an unexpected field is visible rather than lost.
      bodyKeys: Object.keys(parsed).sort(),
    })}\n`)

    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'probe-model' }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, index: 0 }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
}).listen(PORT, '127.0.0.1', () => console.log(`fake endpoint on ${PORT}, logging to ${LOG}`))
