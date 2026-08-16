// A fake OpenAI-compatible endpoint that records exactly what roles it is sent.
// This is the whole experiment: does a Pi-plugin-declared compat reach the wire?
import { createServer } from 'node:http'
import { writeFileSync, appendFileSync } from 'node:fs'

const LOG = process.env.PROBE_LOG ?? new URL('requests.jsonl', import.meta.url).pathname
writeFileSync(LOG, '')

createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    let parsed
    try { parsed = JSON.parse(body) } catch { parsed = { unparsed: body } }
    appendFileSync(LOG, JSON.stringify({
      url: req.url,
      roles: Array.isArray(parsed.messages) ? parsed.messages.map(m => m.role) : null,
      hasReasoningEffort: parsed.reasoning_effort !== undefined,
      model: parsed.model,
    }) + '\n')

    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'probe-model' }] }))
      return
    }
    // Minimal streaming answer so the loop completes.
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, index: 0 }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
}).listen(4599, '127.0.0.1', () => console.log('fake endpoint on 4599'))
