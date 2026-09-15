// Real HTTP passthrough only: never manufactures a successful model response.
// Records lifecycle/shape, not credentials or private message bodies.
import { createServer } from 'node:http'
import { EnvHttpProxyAgent, fetch as upstreamFetch } from 'undici'
export async function liveModelRecorder(upstream, classify) {
  const requests = []
  const dispatcher = new EnvHttpProxyAgent()
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => { void (async () => {
      const raw = Buffer.concat(chunks)
      let body
      try { body = JSON.parse(raw.toString('utf8')) } catch { body = {} }
      const observation = { kind: classify(body), startedAt: Date.now(), completed: false, cancelled: false, status: undefined,
        model: body.model, thinking: body.thinking, reasoningEffort: body.reasoning_effort }
      requests.push(observation)
      const controller = new AbortController()
      res.on('close', () => {
        if (!observation.completed) {
          observation.cancelled = true
          observation.cancelledAt = Date.now()
          controller.abort()
        }
      })
      const headers = { ...req.headers }
      delete headers.host
      delete headers['content-length']
      try {
        const response = await upstreamFetch(`${upstream.replace(/\/$/, '')}${req.url}`, { method: req.method, headers, body: raw, signal: controller.signal, dispatcher })
        observation.status = response.status
        const forwarded = Object.fromEntries([...response.headers].filter(([key]) => !['connection', 'transfer-encoding', 'content-encoding', 'content-length'].includes(key)))
        res.writeHead(response.status, forwarded)
        const decoder = new TextDecoder()
        let pending = ''
        if (response.body) for await (const chunk of response.body) {
          if (observation.kind === 'maintenance' && response.headers.get('content-type')?.includes('event-stream')) {
            pending += decoder.decode(chunk, { stream: true })
            let boundary
            while ((boundary = pending.indexOf('\n')) !== -1) {
              const line = pending.slice(0, boundary).trim()
              pending = pending.slice(boundary + 1)
              if (line.startsWith('data:') && !line.includes('[DONE]')) {
                try {
                  const data = JSON.parse(line.slice(5).trim())
                  const text = data.choices?.[0]?.delta?.content
                  if (typeof text === 'string') observation.responseText = (observation.responseText ?? '') + text
                } catch { /* non-JSON SSE framing is not model content */ }
              }
            }
          }
          res.write(Buffer.from(chunk))
        }
        observation.completed = true
        observation.completedAt = Date.now()
        res.end()
      } catch (error) {
        observation.error = controller.signal.aborted ? 'caller aborted' : String(error)
        if (!res.destroyed) { res.writeHead(502); res.end('upstream forwarding failed') }
      }
    })() })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await dispatcher.close()
  } }
}
