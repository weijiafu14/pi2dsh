#!/usr/bin/env node
// Live validation for deepseek-harness discussion #2170: route DSH through a
// REAL local liteLLM proxy and prove the turn succeeds while the DSH side
// never holds DEEPSEEK_API_KEY — the upstream credential lives only in
// liteLLM's own config, exactly the separation the thread asks about.
//
// Real components end to end: stock npm dsh CLI, published pi2dsh engine, a
// catalog-only Pi provider whose baseUrl is the liteLLM proxy, liteLLM itself
// (via uvx), and the real api.deepseek.com behind it. Nothing is mocked.
//
//   DEEPSEEK_API_KEY=… node scripts/verify-litellm-route-e2e.mjs [outfile]
//     (the key is written ONLY into liteLLM's scratch config, chmod 600,
//      removed with the scratch; the DSH home env explicitly omits it)
//   PI2DSH_ENGINE_SPEC / PI2DSH_CLI_DIR / PI2DSH_DSH_BIN as in the other harnesses.

import assert from 'node:assert/strict'
import { spawn, execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { createE2eHarness, filesBelow } from './lib/e2e-harness.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outputPath = resolve(process.argv[2] ?? 'community/full-audit-work/litellm-route-e2e.json')
const upstreamKey = process.env.DEEPSEEK_API_KEY
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`

if (upstreamKey === undefined || upstreamKey.length === 0) {
  console.error('DEEPSEEK_API_KEY not set — liteLLM needs a real upstream credential; refusing to "pass" without it.')
  process.exit(1)
}

const log = message => console.log(`[litellm-route] ${message}`)

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
async function ensureStockCli() {
  if (process.env.PI2DSH_DSH_BIN !== undefined) return resolve(process.env.PI2DSH_DSH_BIN)
  const cliDir = resolve(process.env.PI2DSH_CLI_DIR ?? join(tmpdir(), 'pi2dsh-provider-threads-cli'))
  const bin = join(cliDir, 'node_modules', '.bin', 'dsh')
  const ready = await readFile(join(cliDir, 'package.json'), 'utf8').then(() => true, () => false)
  if (!ready) {
    await mkdir(cliDir, { recursive: true })
    const name = DSH_CLI_SPEC.slice(0, DSH_CLI_SPEC.lastIndexOf('@'))
    await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
      name: 'pi2dsh-provider-threads-cli',
      private: true,
      dependencies: { [name]: DSH_CLI_SPEC.slice(DSH_CLI_SPEC.lastIndexOf('@') + 1) },
    }, null, 2)}\n`)
    await writeFile(join(cliDir, 'pnpm-workspace.yaml'), [
      'minimumReleaseAge: 0',
      'allowBuilds:',
      "  '@deepseek-ai/dsh-subprocess-local': true",
      '  node-pty: true',
      '  koffi: true',
      "  '@google/genai': false",
      '  protobufjs: false',
      '',
    ].join('\n'))
    log(`installing stock CLI ${DSH_CLI_SPEC} …`)
    await execFile('corepack', ['pnpm@11.7.0', 'install'], {
      cwd: cliDir,
      env: { ...process.env, npm_config_registry: 'https://registry.npmjs.org' },
      timeout: 600_000,
    })
  }
  return bin
}

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-litellm-'))
const report = { meta: {}, verdict: {} }
// A liteLLM virtual key for the DSH side — deliberately NOT the upstream key.
const masterKey = 'sk-litellm-e2e-master'
let litellm

try {
  const directDshBin = await ensureStockCli()

  // ---- real liteLLM proxy; the upstream credential lives ONLY here --------
  const port = Number(process.env.LITELLM_PORT ?? 4300)
  const configPath = join(scratch, 'litellm-config.yaml')
  await writeFile(configPath, [
    'model_list:',
    '  - model_name: deepseek-chat',
    '    litellm_params:',
    '      model: deepseek/deepseek-chat',
    `      api_key: ${upstreamKey}`,
    'general_settings:',
    `  master_key: ${masterKey}`,
    '',
  ].join('\n'), { mode: 0o600 })
  await chmod(configPath, 0o600)
  log('starting liteLLM proxy (uvx) …')
  litellm = spawn('uvx', ['--from', 'litellm[proxy]', 'litellm', '--config', configPath, '--port', String(port), '--host', '127.0.0.1'], {
    cwd: scratch,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let litellmLog = ''
  litellm.stdout.on('data', chunk => { litellmLog += String(chunk) })
  litellm.stderr.on('data', chunk => { litellmLog += String(chunk) })
  const deadline = Date.now() + 300_000
  for (;;) {
    if (litellm.exitCode !== null) throw new Error(`liteLLM died on startup:\n${litellmLog.slice(-3000)}`)
    const up = await fetch(`http://127.0.0.1:${port}/health/liveliness`).then(response => response.ok).catch(() => false)
    if (up) break
    if (Date.now() > deadline) throw new Error(`liteLLM never came up:\n${litellmLog.slice(-3000)}`)
    await new Promise(done => setTimeout(done, 1000))
  }
  log('liteLLM is up')

  // ---- DSH home whose environment NEVER holds the upstream key ------------
  const harness = createE2eHarness({ dshRoot: projectRoot, directDshBin, dshBin: directDshBin, dshCwd: scratch })
  const { home, env, runDsh } = await harness.makeHome(scratch, {
    DEEPSEEK_API_KEY: '',
    LITELLM_VIRTUAL_KEY: masterKey,
  })
  delete env.DEEPSEEK_API_KEY
  assert.equal(env.DEEPSEEK_API_KEY, undefined, 'the DSH environment must not hold the upstream key')

  log(`installing engine ${engineSpec} + litellm probe provider …`)
  await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
  const fixture = join(scratch, 'pi-litellm-probe-provider')
  await mkdir(fixture, { recursive: true })
  await writeFile(join(fixture, 'package.json'), `${JSON.stringify({
    name: 'pi-litellm-probe-provider', version: '1.0.0', type: 'module', pi: { extensions: ['./index.mjs'] },
  }, null, 2)}\n`)
  await writeFile(join(fixture, 'index.mjs'), [
    `const BASE = ${JSON.stringify(`http://127.0.0.1:${port}/v1`)}`,
    'export default function (pi) {',
    "  pi.registerProvider('litellm', { id: 'litellm', name: 'liteLLM Proxy', api: 'openai-completions', baseUrl: BASE, apiKey: '$LITELLM_VIRTUAL_KEY', models: [{",
    "    id: 'deepseek-chat', name: 'DeepSeek via liteLLM', provider: 'litellm', api: 'openai-completions', baseUrl: BASE,",
    "    reasoning: false, input: ['text'], cost: { input: 0, output: 0 }, contextWindow: 128000, maxTokens: 8192,",
    '  }] })',
    '}',
    '',
  ].join('\n'))
  await runDsh(['plugin', '--profile', 'headless', 'add', `file:${fixture}`])
  await harness.useJsonlSessions(home, 'headless')
  await harness.useDefaultModel(home, 'litellm', 'deepseek-chat')

  const engineVersion = JSON.parse(await readFile(
    join(home, 'profiles', 'headless', 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version

  const ws = join(scratch, 'ws')
  await mkdir(ws, { recursive: true })
  log('running the turn through liteLLM …')
  const run = await runDsh(['--profile', 'headless', 'Reply with exactly: LITELLM_OK'], { cwd: ws, timeout: 300_000 })
  assert.match(String(run.stdout), /LITELLM_OK/u, `the turn did not complete:\n${run.stdout}\n${run.stderr}`)

  const files = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
  assert.equal(files.length, 1, `expected one session log, found ${files.length}`)
  const records = (await readFile(files[0], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  const turnEnd = records.find(record => record.type === 'turn/end')
  assert.equal(turnEnd?.data?.reason?.kind, 'completed', `turn did not complete: ${JSON.stringify(turnEnd?.data?.reason)}`)
  // The proxy really served the completion (its log names the model call).
  assert(/deepseek-chat/u.test(litellmLog), 'liteLLM log never mentioned the model — the turn may not have gone through the proxy')

  report.meta = {
    when: new Date().toISOString(),
    cli: { spec: DSH_CLI_SPEC },
    engine: { spec: engineSpec.startsWith('file:') ? 'file:<working-tree>' : engineSpec, installed: engineVersion },
    litellm: 'uvx litellm[proxy], local, upstream api.deepseek.com',
  }
  report.verdict = {
    thread: 2170,
    turnCompleted: true,
    dshEnvHadDeepseekKey: false,
    dshSideCredential: 'liteLLM virtual master key only',
    upstreamKeyLocation: 'liteLLM config file (scratch, 0600) only',
    turnEndReason: turnEnd.data.reason.kind,
  }
  log('verdict: passed')
} finally {
  litellm?.kill('SIGTERM')
  const payload = JSON.stringify(report, null, 2)
  assert(!payload.includes(upstreamKey), 'the upstream key leaked into the report')
  await writeFile(outputPath, `${payload}\n`)
  log(`wrote ${outputPath}`)
  await rm(scratch, { recursive: true, force: true })
}
