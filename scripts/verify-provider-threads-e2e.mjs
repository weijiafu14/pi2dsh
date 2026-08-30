#!/usr/bin/env node
// Live validation battery for the provider-interoperability discussion
// threads (community/r1-reply-ledger.md, bucket "e2e_only / A"). Each case
// reproduces the property one upstream thread asks about, through the real
// user path: stock npm dsh CLI, the published pi2dsh engine, a catalog-only
// Pi provider, and a REAL upstream model behind the example's transparent
// recording proxy (requests forwarded verbatim, responses streamed back —
// nothing is mocked; the proxy only writes down what was sent).
//
//   tools-fields   #947   tool declarations reach the wire with full
//                         description + per-parameter descriptions
//   write-second-step #3342 write tool: declaration → call id/name/args →
//                         result → second model step, file really on disk
//   parallel-calls #2859  two shell calls in one turn, distinct call ids,
//                         both execute, history parses clean
//   long-output    #2659  multi-thousand-token single answer arrives complete
//   encoding       #2670  Chinese output round-trips with no mojibake
//   token-limit    #1166  a declared tiny maxTokens is sent on the wire and
//                         the truncated stop is surfaced, not crashed on
//
// Usage:
//   DEEPSEEK_API_KEY=… node scripts/verify-provider-threads-e2e.mjs [outfile]
//   PI2DSH_ENGINE_SPEC=pi2dsh@<version>  engine under test (default: this tree)
//   PI2DSH_DSH_BIN=<dsh>                 reuse an installed stock CLI;
//   PI2DSH_CLI_DIR=<dir>                 else one is installed (and cached) here
//   ONLY=<case-id>                       run a single case
//
// The credential is read from the environment only and asserted absent from
// the evidence before anything is written.

import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { createE2eHarness, filesBelow } from './lib/e2e-harness.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outputPath = resolve(process.argv[2] ?? 'community/full-audit-work/provider-threads-e2e.json')
const apiKey = process.env.DEEPSEEK_API_KEY
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`
const only = process.env.ONLY

if (apiKey === undefined || apiKey.length === 0) {
  console.error('DEEPSEEK_API_KEY not set — every case here needs the real upstream; refusing to "pass" without it.')
  process.exit(1)
}

const log = message => console.log(`[provider-threads] ${message}`)

// ---------------------------------------------------------------------------
// Stock CLI: the same npm install a user performs (verify-tui-singlepath's
// recipe). PI2DSH_DSH_BIN reuses one; PI2DSH_CLI_DIR caches the install.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Probe fixture: catalog-only Pi providers over the recording proxy. Same
// posture as examples/gateway-compat, plus a second provider whose one model
// declares a deliberately tiny maxTokens (the #1166 case). Both models are
// the REAL upstream model id — the declaration is the only thing that varies.
// ---------------------------------------------------------------------------
async function stageProbeFixture(scratch, proxyBase) {
  const dir = join(scratch, 'pi-thread-probe-provider')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name: 'pi-thread-probe-provider',
    version: '1.0.0',
    type: 'module',
    pi: { extensions: ['./index.mjs'] },
  }, null, 2)}\n`)
  const model = (id, { maxTokens }) => ({
    id: 'deepseek-chat',
    name: `Probe ${id}`,
    provider: id,
    api: 'openai-completions',
    baseUrl: proxyBase,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens,
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsStore: false },
  })
  await writeFile(join(dir, 'index.mjs'), [
    `const BASE = ${JSON.stringify(proxyBase)}`,
    'export default function (pi) {',
    `  pi.registerProvider('thread-probe', { id: 'thread-probe', name: 'Thread Probe', api: 'openai-completions', baseUrl: BASE, apiKey: '$PROBE_API_KEY', models: [${JSON.stringify(model('thread-probe', { maxTokens: 8192 }))}] })`,
    `  pi.registerProvider('thread-probe-tiny', { id: 'thread-probe-tiny', name: 'Thread Probe Tiny', api: 'openai-completions', baseUrl: BASE, apiKey: '$PROBE_API_KEY', models: [${JSON.stringify(model('thread-probe-tiny', { maxTokens: 24 }))}] })`,
    '}',
    '',
  ].join('\n'))
  return dir
}

// ---------------------------------------------------------------------------
// Shared run plumbing: one home, one proxy; each case gets its own workspace
// directory, its own slice of the proxy log, and its own session file.
// ---------------------------------------------------------------------------
const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-threads-'))
const recordPath = join(scratch, 'requests.jsonl')
// An ONLY= rerun must not clobber the verdicts of cases it did not run.
const previous = await readFile(outputPath, 'utf8').then(JSON.parse).catch(() => undefined)
const results = { meta: {}, cases: previous?.cases ?? {} }
let proxy

const readRecorded = async () =>
  (await readFile(recordPath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))

const sessionFiles = async home =>
  (await filesBelow(join(home, 'sessions')).catch(() => [])).filter(path => path.endsWith('/session.jsonl')).sort()

const assistantText = records => records
  .filter(record => record.type === 'assistant/message')
  .flatMap(record => Array.isArray(record.data?.message?.content) ? record.data.message.content : [])
  .filter(block => block.type === 'text')
  .map(block => String(block.text ?? ''))
  .join('\n')

const toolCalls = records => records.filter(record => record.type === 'tool/call')
const resultBlockFor = (records, callId) => {
  for (const record of records) {
    if (record.type !== 'tool/result') continue
    const block = (record.data?.message?.content ?? []).find(item => item.toolCallId === callId)
    if (block) return block
  }
  return undefined
}

try {
  const directDshBin = await ensureStockCli()
  const cliVersion = JSON.parse(await readFile(
    join(resolve(directDshBin, '..', '..', '..'), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version

  // The recording proxy, in front of the REAL upstream (port must be free —
  // a leftover listener would answer this run while logging elsewhere).
  const port = Number(process.env.PROBE_PORT ?? 4601)
  const alreadyUp = await fetch(`http://127.0.0.1:${port}/v1/models`).then(() => true).catch(() => false)
  if (alreadyUp) throw new Error(`port ${port} already serving — stop the leftover proxy or set PROBE_PORT`)
  proxy = spawn('node', [join(projectRoot, 'examples/gateway-compat/probe/recording-proxy.mjs')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PROXY_PORT: String(port),
      PROXY_LOG: recordPath,
      PROXY_UPSTREAM: process.env.PROXY_UPSTREAM ?? 'https://api.deepseek.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let proxyLog = ''
  proxy.stdout.on('data', chunk => { proxyLog += String(chunk) })
  proxy.stderr.on('data', chunk => { proxyLog += String(chunk) })
  const deadline = Date.now() + 20_000
  for (;;) {
    if (proxy.exitCode !== null) throw new Error(`recording proxy died on startup:\n${proxyLog}`)
    if (await fetch(`http://127.0.0.1:${port}/v1/models`).then(() => true).catch(() => false)) break
    if (Date.now() > deadline) throw new Error(`recording proxy never came up:\n${proxyLog}`)
    await new Promise(done => setTimeout(done, 200))
  }

  const harness = createE2eHarness({ dshRoot: projectRoot, directDshBin, dshBin: directDshBin, dshCwd: scratch })
  const { home, runDsh } = await harness.makeHome(scratch, {
    PROBE_API_KEY: apiKey,
  })
  log(`installing engine ${engineSpec} + probe fixture …`)
  await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
  const fixture = await stageProbeFixture(scratch, `http://127.0.0.1:${port}/v1`)
  await runDsh(['plugin', '--profile', 'headless', 'add', `file:${fixture}`])
  await harness.useJsonlSessions(home, 'headless')

  const engineManifest = join(home, 'profiles', 'headless', 'node_modules', 'pi2dsh', 'package.json')
  const engineVersion = JSON.parse(await readFile(engineManifest, 'utf8')).version
  results.meta = {
    when: new Date().toISOString(),
    cli: { spec: DSH_CLI_SPEC, installed: cliVersion },
    engine: { spec: engineSpec.startsWith('file:') ? 'file:<working-tree>' : engineSpec, installed: engineVersion },
    upstream: process.env.PROXY_UPSTREAM ?? 'https://api.deepseek.com',
    model: 'deepseek-chat',
  }

  let seenSessions = []
  let seenRequests = 0
  /**
   * Run one case: route the default model, run the prompt in a private
   * workspace, hand the case its own new session records + request slice.
   */
  const runCase = async (id, { provider = 'thread-probe', prompt, timeout, allowExit = false, check }) => {
    if (only !== undefined && only !== id) { results.cases[id] ??= { status: 'skipped', reason: `ONLY=${only}` }; return }
    log(`case ${id} …`)
    const ws = join(scratch, `ws-${id}`)
    await mkdir(ws, { recursive: true })
    await harness.useDefaultModel(home, provider, 'deepseek-chat')
    const before = await sessionFiles(home)
    seenSessions = before
    seenRequests = (await readRecorded()).length
    try {
      let run
      try {
        run = await runDsh(['--profile', 'headless', prompt], { cwd: ws, timeout })
      } catch (error) {
        // With allowExit the nonzero exit is part of the behavior under test
        // (e.g. a max-tokens stop); the session and wire evidence still decide.
        if (!allowExit) throw error
        run = { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), exitFailed: true }
      }
      const after = await sessionFiles(home)
      const fresh = after.filter(file => !before.includes(file))
      assert.equal(fresh.length, 1, `expected exactly one new session, got ${fresh.length}`)
      const records = (await readFile(fresh[0], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
      const requests = (await readRecorded()).slice(seenRequests).filter(entry => entry.roles !== null)
      assert(requests.length > 0, 'no completion request reached the proxy for this case')
      const evidence = await check({ run, records, requests, ws })
      results.cases[id] = { status: 'passed', requests: requests.length, ...evidence }
      log(`case ${id} ✅`)
    } catch (error) {
      results.cases[id] = { status: 'failed', error: String(error?.stack ?? error).slice(0, 4000) }
      log(`case ${id} ❌ ${String(error).slice(0, 300)}`)
    }
  }

  // ---- #947: tool declarations carry full descriptions on the wire --------
  await runCase('tools-fields', {
    prompt: 'Use your shell tool to run exactly this command: echo TOOLFIELDS_OK — then reply with the single word DONE.',
    check: async ({ run, records, requests }) => {
      const withTools = requests.find(request => Array.isArray(request.tools) && request.tools.length > 0)
      assert(withTools, 'no request carried a tools array')
      const shell = withTools.tools.find(tool => /bash|shell|command|exec/iu.test(String(tool.name)))
      assert(shell, `no shell-like tool declared: ${withTools.tools.map(tool => tool.name).join(', ')}`)
      assert(shell.descriptionChars > 0, `tool ${shell.name} was declared with an empty description`)
      const paramNames = Object.keys(shell.params)
      assert(paramNames.length > 0, `tool ${shell.name} was declared with no parameters`)
      const described = paramNames.filter(name => shell.params[name] > 0)
      assert(described.length > 0, `no parameter of ${shell.name} carried a description: ${JSON.stringify(shell.params)}`)
      const calls = toolCalls(records)
      const executed = calls.find(call => JSON.stringify(call.data?.arguments ?? call.data?.args ?? {}).includes('TOOLFIELDS_OK'))
      assert(executed, 'the shell tool never ran the probe command')
      const result = resultBlockFor(records, executed.data.callId)
      assert(result && result.isError !== true, 'the probe command failed')
      assert.match(assistantText(records), /DONE/u, 'the turn did not complete')
      return {
        thread: 947,
        toolsDeclared: withTools.tools.map(tool => ({ name: tool.name, descriptionChars: tool.descriptionChars, params: tool.params })),
        shellTool: shell.name,
        run: run.stdout.length,
      }
    },
  })

  // ---- #3342: write tool full chain + second model step -------------------
  await runCase('write-second-step', {
    prompt: 'Use your file-writing tool to create a file named probe-3342.txt in the current working directory containing exactly: WRITE_PATH_OK (no trailing newline needed). Then reply with the single word FINISHED.',
    check: async ({ records, requests, ws }) => {
      const calls = toolCalls(records)
      const write = calls.find(call => JSON.stringify(call.data ?? {}).includes('probe-3342.txt'))
      assert(write, `no tool call mentioned probe-3342.txt; calls: ${calls.map(call => call.data?.name).join(', ')}`)
      assert(typeof write.data.callId === 'string' && write.data.callId.length > 0, 'the write call has no id')
      const result = resultBlockFor(records, write.data.callId)
      assert(result && result.isError !== true, `the write tool failed: ${JSON.stringify(result?.content).slice(0, 300)}`)
      const written = await readFile(join(ws, 'probe-3342.txt'), 'utf8')
      assert.match(written, /WRITE_PATH_OK/u, `file content wrong: ${JSON.stringify(written).slice(0, 200)}`)
      assert(requests.length >= 2, `no second model step: only ${requests.length} completion request(s)`)
      assert.match(assistantText(records), /FINISHED/u, 'no post-tool assistant step completed the turn')
      return {
        thread: 3342,
        toolName: write.data.name,
        callId: write.data.callId,
        argsPreview: JSON.stringify(write.data.arguments ?? write.data.args ?? {}).slice(0, 200),
        modelSteps: requests.length,
      }
    },
  })

  // ---- #2859: two shell calls in one turn, distinct ids, clean history ----
  await runCase('parallel-calls', {
    prompt: 'Run two shell commands: `echo P_ONE` and `echo P_TWO`. If you can, issue both tool calls in the same response (in parallel); otherwise one after the other. Then reply with the single word BOTH_DONE.',
    check: async ({ records, requests }) => {
      const calls = toolCalls(records)
      assert(calls.length >= 2, `expected two tool calls, got ${calls.length}`)
      const ids = new Set(calls.map(call => call.data.callId))
      assert.equal(ids.size, calls.length, `call ids are not distinct: ${[...ids].join(', ')}`)
      for (const marker of ['P_ONE', 'P_TWO']) {
        const call = calls.find(item => JSON.stringify(item.data ?? {}).includes(marker))
        assert(call, `no tool call ran ${marker}`)
        const result = resultBlockFor(records, call.data.callId)
        assert(result && result.isError !== true, `the ${marker} call failed`)
        assert(JSON.stringify(result.content).includes(marker), `the ${marker} result does not echo its marker`)
      }
      // Parallel-in-one-step is a model choice, not a bridge property — record
      // it honestly instead of asserting it.
      const firstResultAt = records.findIndex(record => record.type === 'tool/result')
      const callsBeforeFirstResult = records.slice(0, firstResultAt).filter(record => record.type === 'tool/call').length
      assert.match(assistantText(records), /BOTH_DONE/u, 'the turn did not complete')
      return {
        thread: 2859,
        callIds: [...ids],
        sameStep: callsBeforeFirstResult >= 2,
        modelSteps: requests.length,
        historyRecords: records.length,
      }
    },
  })

  // ---- #2659: long single completion arrives complete ---------------------
  await runCase('long-output', {
    prompt: 'Tool use is FORBIDDEN for this task; creating or writing files is forbidden; the essay must appear directly in your reply text. Write a single continuous English essay of at least 2500 words on the history of the Roman Empire, from the founding of the Republic to the fall of the Western Empire. Do not stop early. After the final sentence print a new line containing exactly: LONG_END',
    timeout: 540_000,
    check: async ({ records }) => {
      // The property under test is that a completion running into thousands of
      // tokens arrives complete: the end marker lands, and the turn closes as
      // completed rather than a max-tokens cut. (An integer-list variant was
      // abandoned honestly: deepseek-chat refuses to hand-write 3000 integers
      // with or without tools, so that prompt tested obedience, not transport.)
      const text = assistantText(records)
      assert(text.length >= 9000, `only ${text.length} chars — not a multi-thousand-token completion`)
      assert.match(text, /LONG_END/u, `the end marker is missing — output was cut at ${text.length} chars: …${text.slice(-120)}`)
      const turnEnd = records.find(record => record.type === 'turn/end')
      assert.equal(turnEnd?.data?.reason?.kind, 'completed',
        `the turn did not close as completed: ${JSON.stringify(turnEnd?.data?.reason)}`)
      return { thread: 2659, chars: text.length, toolCallsUsed: toolCalls(records).length, turnEndReason: turnEnd.data.reason.kind }
    },
  })

  // ---- #2670: Chinese output, no mojibake ---------------------------------
  await runCase('encoding', {
    prompt: '不要使用任何工具。用中文写一段大约两百字的短文，介绍杭州西湖的三个景点。写完后另起一行，只写：编码检查完毕',
    check: async ({ records }) => {
      const text = assistantText(records)
      assert.match(text, /编码检查完毕/u, 'the Chinese end marker is missing')
      assert.match(text, /西湖/u, 'the answer is not about the asked topic')
      assert(!text.includes('�'), 'U+FFFD replacement characters present — the stream was mis-decoded')
      const cjk = (text.match(/[一-鿿]/gu) ?? []).length
      assert(cjk > 100, `only ${cjk} CJK characters — not the asked Chinese passage`)
      return { thread: 2670, chars: text.length, cjkChars: cjk }
    },
  })

  // ---- #1166: declared tiny maxTokens on the wire, truncation surfaced ----
  await runCase('token-limit', {
    provider: 'thread-probe-tiny',
    prompt: 'Do not use any tools. Explain the causes of the fall of the Western Roman Empire in as much detail as you can.',
    // Hitting the cap ends the turn with reason max-tokens and a nonzero CLI
    // exit — that exit IS the surfaced signal, not a harness failure.
    allowExit: true,
    check: async ({ run, records, requests }) => {
      const request = requests[0]
      assert.equal(request.maxTokensField, 'max_tokens', `wrong max-tokens spelling: ${request.maxTokensField}`)
      assert(typeof request.maxTokensValue === 'number' && request.maxTokensValue <= 24,
        `the declared tiny cap did not reach the wire: ${request.maxTokensValue}`)
      const text = assistantText(records)
      assert(text.length > 0, 'no assistant text at all — the truncated stop crashed the turn')
      assert(text.length < 600, `answer too long for a 24-token cap (${text.length} chars) — the cap was ignored`)
      const turnEnd = records.find(record => record.type === 'turn/end')
      assert(turnEnd, 'no turn/end record — the session did not close')
      assert.equal(turnEnd.data?.reason?.kind, 'max-tokens',
        `the truncation was not surfaced as max-tokens: ${JSON.stringify(turnEnd.data?.reason)}`)
      return { thread: 1166, maxTokensSent: request.maxTokensValue, chars: text.length, turnEndReason: turnEnd.data.reason.kind, cliExitNonzero: run.exitFailed === true }
    },
  })
} finally {
  proxy?.kill('SIGTERM')
}

// The evidence is committed publicly; the credential must not be in it.
const payload = JSON.stringify(results, null, 2)
assert(!payload.includes(apiKey), 'the API key leaked into the evidence')
await writeFile(outputPath, `${payload}\n`)
log(`wrote ${outputPath}`)
if (process.env.PI2DSH_KEEP_SCRATCH === '1') log(`scratch kept: ${scratch}`)
else await rm(scratch, { recursive: true, force: true })

const failed = Object.entries(results.cases).filter(([, value]) => value.status === 'failed')
for (const [id, value] of Object.entries(results.cases)) log(`${id}: ${value.status}`)
process.exit(failed.length === 0 ? 0 : 1)
