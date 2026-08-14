#!/usr/bin/env node
// Minimal REAL LiteLLM-protocol gateway for scenario verification: implements
// the discovery surface pi-provider-litellm actually calls (/model/info,
// /v1/models, /health) and forwards OpenAI-compatible chat completions to a
// real upstream (DeepSeek). Keys: clients must present LITELLM_GATEWAY_KEY;
// the upstream call uses UPSTREAM_API_KEY. Nothing is mocked at the model
// layer — replies come from the live upstream model.
//
// Usage:
//   LITELLM_GATEWAY_KEY=… UPSTREAM_API_KEY=… [PORT=41888] \
//     node scripts/fixtures/litellm-gateway.mjs
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 41888)
const gatewayKey = process.env.LITELLM_GATEWAY_KEY
const upstreamKey = process.env.UPSTREAM_API_KEY
const upstreamBase = process.env.UPSTREAM_BASE_URL ?? 'https://api.deepseek.com'
const modelName = process.env.GATEWAY_MODEL_NAME ?? 'deepseek-chat'
const upstreamModel = process.env.UPSTREAM_MODEL ?? 'deepseek-chat'
if (!gatewayKey || !upstreamKey) {
  console.error('[litellm-gateway] LITELLM_GATEWAY_KEY and UPSTREAM_API_KEY are required')
  process.exit(1)
}

const modelInfo = {
  data: [{
    model_name: modelName,
    litellm_params: { model: `deepseek/${upstreamModel}` },
    model_info: {
      max_input_tokens: 64000,
      max_output_tokens: 8192,
      mode: 'chat',
      supports_function_calling: true,
    },
  }],
}

function authorized(request) {
  const header = String(request.headers.authorization ?? '')
  return header === `Bearer ${gatewayKey}` || String(request.headers['x-litellm-api-key'] ?? '') === gatewayKey
}

const server = createServer(async (request, response) => {
  if (!authorized(request)) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'invalid gateway key' } }))
    return
  }
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/health' || url.pathname === '/v1/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ healthy_endpoints: [{ model: `deepseek/${upstreamModel}` }], unhealthy_endpoints: [] }))
    return
  }
  if (url.pathname === '/model/info' || url.pathname === '/v1/model/info') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(modelInfo))
    return
  }
  if (url.pathname === '/v1/models' || url.pathname === '/models') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ object: 'list', data: [{ id: modelName, object: 'model', owned_by: 'litellm-gateway' }] }))
    return
  }
  if ((url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions') && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid JSON body' } }))
      return
    }
    body.model = upstreamModel
    try {
      const upstream = await fetch(`${upstreamBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${upstreamKey}` },
        body: JSON.stringify(body),
      })
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      if (upstream.body) {
        for await (const chunk of upstream.body) response.write(chunk)
      }
      response.end()
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: `upstream call failed: ${error?.message ?? error}` } }))
    }
    return
  }
  if (url.pathname === '/v1/skills' || url.pathname === '/skills') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ skills: [] }))
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message: `no route for ${url.pathname}` } }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[litellm-gateway] listening on http://127.0.0.1:${port} (model ${modelName} → ${upstreamBase} ${upstreamModel})`)
})
