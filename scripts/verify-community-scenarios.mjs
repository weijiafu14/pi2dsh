#!/usr/bin/env node
// The four community reports that are close but not yet answerable, each run
// against the REAL package named in the report — never a probe package we wrote.
//
//   node scripts/verify-community-scenarios.mjs [out.json]
//   ONLY=1272 node scripts/verify-community-scenarios.mjs
//
// Why real packages: a probe declares what we thought to declare. The reports
// are about what a specific published package declares and what reaches the
// wire because of it — and one earlier round asserted the OPPOSITE field
// (`max_completion_tokens` where the report needs `max_tokens`) while looking
// green, because the probe was the thing under test.
//
// Every scenario reads the request body off the recording proxy: requests go to
// the real upstream and the real response streams back, and the only thing
// added is a copy of what reached the wire.
//
// Needs DEEPSEEK_API_KEY. Scenarios that need an endpoint we do not have report
// skipped with the reason, never passed.
import { execFile as execFileCb, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'

const execFile = promisify(execFileCb)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.DSH_ROOT ?? resolve(projectRoot, '../deepseek-harness')
const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
const outputPath = resolve(projectRoot, process.argv[2] ?? 'community/community-scenarios.json')
const apiKey = process.env.DEEPSEEK_API_KEY
const results = {}

async function makeHome(scratch, extraEnv = {}) {
  const home = join(scratch, 'dsh-home')
  const shimDir = join(scratch, 'bin')
  await mkdir(shimDir, { recursive: true })
  await writeFile(join(shimDir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(join(shimDir, 'pnpm'), 0o755)
  const env = {
    ...process.env, DSH_HOME: home, PATH: `${shimDir}:${process.env.PATH ?? ''}`,
    CI: '1', NO_COLOR: '1', DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'danger-full-access',
    npm_config_registry: 'https://registry.npmjs.org', PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
    PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0', ...extraEnv,
  }
  const runDsh = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args],
    { cwd: dshRoot, env, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
    .then(r => ({ ok: true, stdout: r.stdout, stderr: r.stderr }))
    .catch(e => ({ ok: false, stdout: e.stdout ?? '', stderr: `${e.stderr ?? ''}${e.message}` }))
  await mkdir(home, { recursive: true })
  return { home, env, runDsh }
}

const useDefaultModel = (home, provider, model) => writeFile(join(home, 'settings.yaml'), [
  'agent-default-model:', `  provider: ${provider}`, `  model: ${model}`, '',
].join('\n'))

const jsonlSessions = (home, profile) => writeFile(join(home, `profiles/${profile}/cordis.patch.yml`), [
  '- id: session-persistence-jsonl', '  config:', "    root: !!js dshHomePath('sessions')",
  '    compression: none', '',
].join('\n'))

/** Start the passthrough recorder in front of the real upstream. */
async function startRecorder(scratch, port, upstream = 'https://api.deepseek.com') {
  const recordPath = join(scratch, 'requests.jsonl')
  if (await fetch(`http://127.0.0.1:${port}/v1/models`).then(() => true).catch(() => false)) {
    throw new Error(`port ${port} is already serving — a leftover recorder would answer this run and log elsewhere`)
  }
  const proc = spawn('node', [join(projectRoot, 'examples/gateway-compat/probe/recording-proxy.mjs')], {
    cwd: projectRoot,
    env: { ...process.env, PROXY_PORT: String(port), PROXY_LOG: recordPath, PROXY_UPSTREAM: upstream },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proc.stdout.on('data', c => { log += String(c) })
  proc.stderr.on('data', c => { log += String(c) })
  const deadline = Date.now() + 20_000
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`recorder died on startup:\n${log}`)
    if (await fetch(`http://127.0.0.1:${port}/v1/models`).then(() => true).catch(() => false)) break
    if (Date.now() > deadline) throw new Error(`recorder never came up:\n${log}`)
    await new Promise(done => setTimeout(done, 200))
  }
  return { recordPath, stop: () => proc.kill('SIGTERM') }
}

const completionsFrom = async recordPath =>
  (await readFile(recordPath, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(entry => entry.roles !== null)

// ---------------------------------------------------------------------------
// #1272 — a provider that declares maxTokensField: "max_tokens"
// ---------------------------------------------------------------------------
// The report is about a gateway that rejects `max_completion_tokens`. An
// earlier round "verified" this with a probe declaring the OPPOSITE field, so
// the assertion here is the report's direction, from the real package
// (pi-provider-litellm declares `maxTokensField: "max_tokens"` in its source).
async function run1272() {
  if (apiKey === undefined || apiKey.length === 0) {
    results['1272'] = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-c1272-'))
  let recorder
  try {
    const port = Number(process.env.RECORD_PORT_1272 ?? 4611)
    // #1272 is a LiteLLM report, so the upstream is a REAL LiteLLM proxy: the
    // package asks litellm's own endpoints (/model/info) that a plain OpenAI
    // API answers with 404, which is why its catalog stayed empty before.
    const litellm = process.env.LITELLM_UPSTREAM ?? 'http://127.0.0.1:4000'
    const reachable = await fetch(`${litellm}/v1/models`, { headers: { authorization: 'Bearer sk-1234' } })
      .then(r => r.ok).catch(() => false)
    if (!reachable) {
      results['1272'] = { status: 'skipped', reason: `no LiteLLM proxy at ${litellm} (start one: litellm --config <cfg> --port 4000)` }
      return
    }
    recorder = await startRecorder(scratch, port, litellm)
    const base = `http://127.0.0.1:${port}/v1`
    const { home, runDsh } = await makeHome(scratch, {
      LITELLM_BASE_URL: base, LITELLM_API_KEY: apiKey,
      OPENAI_BASE_URL: base, OPENAI_API_KEY: apiKey, PI2DSH_TRACE_COMPAT: '1',
    })
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${projectRoot}`])
    const added = await runDsh(['plugin', '--profile', 'headless', 'add', 'pi-provider-litellm'])
    await jsonlSessions(home, 'headless')
    // The turn has to RUN on the package's route; on the profile default it
    // completes happily through another provider and the recorder stays empty.
    // The report's model family: the package declares max_tokens (and no
    // developer role) only for Moonshot/Kimi names, which is exactly the
    // gateway pairing the reporter runs.
    await useDefaultModel(home, 'litellm', 'kimi-k2-0905-preview')

    const run = await runDsh(['--profile', 'headless', 'Reply with exactly: litellm-ok'])
    const everything = (await readFile(recorder.recordPath, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
    console.log(`   recorder saw ${everything.length} request(s): ${JSON.stringify(everything.map(e => `${e.method ?? '?'} ${e.path ?? e.url ?? '?'}`).slice(0, 8))}`)
    const completions = await completionsFrom(recorder.recordPath)
    if (completions.length === 0) {
      // Report what the run actually did instead of asserting into the dark:
      // this package may need configuration we have not discovered yet, and
      // "no request" must never read as a product verdict.
      results['1272'] = {
        status: 'skipped',
        reason: 'the package sent no completion through the recorder — configuration not established yet',
        addOutput: `${added.stdout}${added.stderr}`.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 500),
        runOutput: `${run.stdout}${run.stderr}`.split('\n').filter(Boolean).slice(-8).join(' | ').slice(0, 800),
      }
      return
    }
    const traced = `${run.stdout}${run.stderr}`.split('\n').filter(l => l.includes('[trace]'))
    console.log(`   trace lines: ${traced.length === 0 ? '(none — our adapter never ran)' : traced.map(l => l.slice(0, 300)).join(' || ')}`)
    const first = completions[0]
    console.log(`   first completion: ${JSON.stringify({ model: first.model, maxTokensField: first.maxTokensField, bodyKeys: first.bodyKeys })}`)
    assert.equal(first.maxTokensField, 'max_tokens',
      `the report needs max_tokens on the wire; the request carried ${first.maxTokensField}`)
    results['1272'] = { status: 'passed', maxTokensField: first.maxTokensField, requests: completions.length }
  } finally {
    recorder?.stop()
    await rm(scratch, { recursive: true, force: true })
  }
}

const SCENARIOS = [['1272', run1272]]
const only = process.env.ONLY
const selected = SCENARIOS.filter(([name]) => only === undefined || only === name)
for (const [name, run] of selected) {
  try {
    await run()
    console.log(`[community] #${name}: ${results[name]?.status}${results[name]?.reason === undefined ? '' : ` — ${results[name].reason}`}`)
    if (results[name]?.runOutput !== undefined) console.log(`   run said: ${results[name].runOutput}`)
  } catch (error) {
    results[name] = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    console.error(`[community] #${name}: FAILED — ${results[name].error}`)
  }
}

await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, results }, null, 2)}\n`)
console.log(`[community] evidence → ${outputPath}`)
