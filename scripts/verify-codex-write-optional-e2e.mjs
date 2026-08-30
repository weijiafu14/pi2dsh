#!/usr/bin/env node
// Live validation for deepseek-harness discussion #1149: GPT-5.6-sol via the
// Codex wire treats declared-but-optional top-level tool parameters as
// required, so write/bash calls fail validation. This runs the SAME model
// through pi2dsh's built-in OpenAI-Codex OAuth route on a stock npm dsh CLI
// and records, from the session log, exactly which argument keys the model
// submitted for a real `write` call and whether validation/execution passed.
//
// Usage:
//   CODEX_AUTH_FILE=$HOME/.codex/auth.json node scripts/verify-codex-write-optional-e2e.mjs [outfile]
//   PI2DSH_ENGINE_SPEC / PI2DSH_CLI_DIR / PI2DSH_DSH_BIN as in the other harnesses.
//
// Tokens are copied only into the temporary home; the home is removed after
// the run and no token material is written to the report.

import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { createE2eHarness, filesBelow, seedCodexLogin } from './lib/e2e-harness.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outputPath = resolve(process.argv[2] ?? 'community/full-audit-work/codex-write-optional-e2e.json')
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`
const codexAuthFile = process.env.CODEX_AUTH_FILE

if (codexAuthFile === undefined || codexAuthFile.length === 0) {
  console.error('CODEX_AUTH_FILE not set — the account is the fixture; refusing to "pass" without it.')
  process.exit(1)
}

const log = message => console.log(`[codex-write-optional] ${message}`)

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

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-codex-1149-'))
const report = { meta: {}, verdict: {} }
try {
  const directDshBin = await ensureStockCli()
  const harness = createE2eHarness({ dshRoot: projectRoot, directDshBin, dshBin: directDshBin, dshCwd: scratch })
  const { home, runDsh } = await harness.makeHome(scratch, {
    // api.openai.com is reached through the developer's system proxy; without
    // this, node's fetch ignores HTTP(S)_PROXY and dies with "fetch failed"
    // (same setting the codex-image scenario carries).
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1',
  })
  log(`installing engine ${engineSpec} …`)
  await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
  // Control fixture: a Pi package that registers NOTHING. Included to hold the
  // profile shape constant with the other codex scenarios while isolating the
  // write-tool behavior; a zero-package profile must behave identically (the
  // host half is unconditional), and running with PI2DSH_NO_FIXTURE=1 checks
  // exactly that.
  if (process.env.PI2DSH_NO_FIXTURE !== '1') {
    const noop = join(scratch, 'pi-noop-fixture')
    await mkdir(noop, { recursive: true })
    await writeFile(join(noop, 'package.json'), `${JSON.stringify({
      name: 'pi-noop-fixture', version: '1.0.0', type: 'module', pi: { extensions: ['./index.mjs'] },
    }, null, 2)}\n`)
    await writeFile(join(noop, 'index.mjs'), 'export default function () {}\n')
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${noop}`])
  }
  await harness.useJsonlSessions(home, 'headless')
  await seedCodexLogin(home, codexAuthFile)
  // Same settings shape the codex-image scenario (and its README) uses: the
  // OAuth route is served through the official llm-pi-ai profile.
  await writeFile(join(home, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: openai-codex',
    '  model: gpt-5.6-sol',
    'llm-pi-ai:',
    '  providers:',
    '    openai-codex:',
    '      displayName: OpenAI (ChatGPT Plus/Pro)',
    '      apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX',
    '',
  ].join('\n'))

  const engineVersion = JSON.parse(await readFile(
    join(home, 'profiles', 'headless', 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version
  const cliVersion = JSON.parse(await readFile(
    join(resolve(directDshBin, '..', '..', '..'), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
  report.meta = {
    when: new Date().toISOString(),
    cli: { spec: DSH_CLI_SPEC, installed: cliVersion },
    engine: { spec: engineSpec.startsWith('file:') ? 'file:<working-tree>' : engineSpec, installed: engineVersion },
    model: 'openai-codex/gpt-5.6-sol',
  }

  const ws = join(scratch, 'ws')
  await mkdir(ws, { recursive: true })
  log('running the write turn …')
  const run = await runDsh(['--profile', 'headless',
    'Use your file-writing tool to create a file named probe-1149.txt in the current working directory containing exactly: OPTIONAL_OK. Then reply with the single word DONE.',
  ], { cwd: ws, timeout: 420_000 })

  const files = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
  assert.equal(files.length, 1, `expected one session log, found ${files.length}`)
  const records = (await readFile(files[0], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))

  const calls = records.filter(record => record.type === 'tool/call')
  const write = calls.find(call => JSON.stringify(call.data ?? {}).includes('probe-1149.txt'))
  assert(write, `no tool call mentioned probe-1149.txt; calls: ${calls.map(call => call.data?.name).join(', ')}`)
  const args = write.data.arguments ?? write.data.args ?? {}
  const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
  const argKeys = Object.keys(parsedArgs)

  let resultBlock
  for (const record of records) {
    if (record.type !== 'tool/result') continue
    const block = (record.data?.message?.content ?? []).find(item => item.toolCallId === write.data.callId)
    if (block) { resultBlock = block; break }
  }
  assert(resultBlock, 'the write call has no result record')
  assert(resultBlock.isError !== true,
    `the write call FAILED — the #1149 failure mode may reproduce on this route: ${JSON.stringify(resultBlock.content).slice(0, 500)}`)
  const written = await readFile(join(ws, 'probe-1149.txt'), 'utf8')
  assert.match(written, /OPTIONAL_OK/u, `file content wrong: ${JSON.stringify(written).slice(0, 200)}`)
  const turnEnd = records.find(record => record.type === 'turn/end')
  assert.equal(turnEnd?.data?.reason?.kind, 'completed', `turn did not complete: ${JSON.stringify(turnEnd?.data?.reason)}`)

  // The thread's materialized-optional markers, checked by name.
  const materialized = argKeys.filter(key => ['sandbox_permissions', 'justification'].includes(key))
  report.verdict = {
    thread: 1149,
    toolName: write.data.name,
    callId: write.data.callId,
    argKeys,
    materializedOptionalKeys: materialized,
    optionalParamsForced: materialized.length > 0,
    writeSucceeded: true,
    fileOnDisk: true,
    turnEndReason: 'completed',
    stdoutTail: String(run.stdout).slice(-200),
  }
  log(`write args: ${JSON.stringify(argKeys)} — materialized optional: ${JSON.stringify(materialized)}`)
} finally {
  const payload = JSON.stringify(report, null, 2)
  const auth = await readFile(resolve(codexAuthFile), 'utf8').then(JSON.parse)
  for (const secret of [auth?.tokens?.access_token, auth?.tokens?.refresh_token].filter(Boolean)) {
    assert(!payload.includes(secret), 'token material leaked into the report')
  }
  await writeFile(outputPath, `${payload}\n`)
  log(`wrote ${outputPath}`)
  await rm(scratch, { recursive: true, force: true })
}
