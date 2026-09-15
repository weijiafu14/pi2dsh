#!/usr/bin/env node
// An unmodified npm provider owns the HTTP transport. The recorder forwards
// every request and response to the real upstream; it only records whether
// the system marker reached the wire. No model response is synthesized.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createE2eHarness } from './lib/e2e-harness.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const output = resolve(process.argv[2] ?? 'community/provider-system-e2e.json')
const key = process.env.DEEPSEEK_API_KEY
assert(key, 'DEEPSEEK_API_KEY is required')
const bin = resolve(process.env.PI2DSH_DSH_BIN)
const cwd = resolve(process.env.PI2DSH_DSH_CWD)
const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-native-system-'))
const wireFile = join(scratch, 'wire.jsonl')
const systemMarker = `NATIVE_SYSTEM_${Date.now().toString(36)}`
const toolMarker = `NATIVE_TOOL_${Date.now().toString(36)}`
const port = 4500 + Math.floor(Math.random() * 800)
const model = process.env.PI2DSH_NATIVE_MODEL ?? 'deepseek-flash'
const providerSpec = process.env.PI2DSH_NATIVE_PROVIDER_SPEC ?? 'pi-provider-litellm@2.3.0'
let proxy
try {
  proxy = spawn(process.execPath, [join(root, 'examples/gateway-compat/probe/recording-proxy.mjs')], {
    env: { ...process.env, PROXY_PORT: String(port), PROXY_LOG: wireFile,
      PROXY_UPSTREAM: process.env.PI2DSH_NATIVE_UPSTREAM ?? 'https://api.deepseek.com', PROXY_EXPECT_SYSTEM: systemMarker },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proxy.stdout.on('data', chunk => { log += String(chunk) })
  proxy.stderr.on('data', chunk => { log += String(chunk) })
  const deadline = Date.now() + 20000
  while (!log.includes(`recording proxy on ${port}`)) {
    if (proxy.exitCode !== null || Date.now() > deadline) throw new Error(`Recorder did not start: ${log}`)
    await new Promise(done => setTimeout(done, 100))
  }
  const harness = createE2eHarness({ dshRoot: cwd, directDshBin: bin, dshBin: bin, dshCwd: cwd })
  const { home, runDsh } = await harness.makeHome(scratch, {
    LITELLM_BASE_URL: `http://127.0.0.1:${port}`, LITELLM_API_KEY: key,
  })
  // Only the provider contract is under test, not LiteLLM's optional Skills
  // and MCP products. These are the package's own documented feature flags.
  const agentDir = join(home, 'pi2dsh', 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ litellm: { skills: { enabled: false }, mcp: { enabled: false } } }))
  await runDsh(['plugin', '--profile', 'headless', 'add', process.env.PI2DSH_ENGINE_SPEC ?? `file:${root}`])
  await runDsh(['plugin', '--profile', 'headless', 'add', providerSpec])
  const probe = join(scratch, 'probe')
  await mkdir(probe)
  await writeFile(join(probe, 'package.json'), JSON.stringify({ name: '@pi2dsh-fixtures/native-system', version: '0.0.0', type: 'module', pi: { extensions: ['./index.mjs'] } }))
  await writeFile(join(probe, 'index.mjs'), `export default function(pi) {
    pi.on('before_agent_start', () => ({ systemPrompt: ${JSON.stringify('You are a validation agent. ' + systemMarker + '. Call native_echo when asked, then return its result.')} }));
    pi.registerTool({ name: 'native_echo', label: 'Native echo', description: 'Return the validation codeword.', parameters: {type:'object',properties:{}}, execute: async () => ({content:[{type:'text',text:${JSON.stringify(toolMarker)}}]}) });
  }`)
  await runDsh(['plugin', '--profile', 'headless', 'add', probe])
  await harness.useJsonlSessions(home, 'headless')
  await harness.useDefaultModel(home, 'litellm', model)
  const ws = join(scratch, 'workspace')
  await mkdir(ws)
  const run = await runDsh(['--profile', 'headless', 'Call native_echo exactly once and return its result.'], { cwd: ws })
  const records = await harness.sessionRecords(home)
  const wire = (await readFile(wireFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  const completions = wire.filter(row => row.roles !== null)
  assert(completions.length >= 2, 'no real tool round trip traversed the provider transport')
  assert.equal(completions[0].systemMarkerPresent, true, 'the provider lost the system prompt before HTTP dispatch')
  assert(records.some(record => record.type === 'tool/call' && record.data?.name === 'native_echo'), 'the model did not call the probe tool')
  assert(records.some(record => record.type === 'tool/result' && JSON.stringify(record.data).includes(toolMarker)), 'no real tool result with the private codeword')
  assert(/registered as a native DSH llm route/u.test(run.stdout + run.stderr), 'provider did not register a package-owned transport')
  const report = { status: 'passed', providerSpec, model, cliSpec: process.env.PI2DSH_DSH_CLI_SPEC, systemPreservedOnWire: true,
    realToolRoundTrip: true, requests: completions.length, transport: 'unmodified npm Pi provider',
    upstream: process.env.PI2DSH_NATIVE_UPSTREAM ?? 'https://api.deepseek.com', optionalGatewayProducts: 'not tested' }
  assert(!JSON.stringify(report).includes(key))
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(`[provider-system] passed: system prompt and tool round trip reached the native transport`)
} finally {
  proxy?.kill('SIGTERM')
  await rm(scratch, { recursive: true, force: true })
}
