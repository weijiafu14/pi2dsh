#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { generateBundle, resolvePiPackage } from '../dist/index.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
  ? resolve(projectRoot, '..', 'deepseek-harness')
  : resolve(process.env.PI2DSH_DSH_ROOT)
const outputPath = resolve(process.argv[2] ?? 'community/live-deepseek-results.json')
const apiKey = process.env.DEEPSEEK_API_KEY

if (apiKey === undefined || apiKey.length === 0) {
  throw new Error('DEEPSEEK_API_KEY is required and is read from process environment only')
}

async function filesBelow(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(path))
    else if (entry.isFile()) output.push(path)
  }
  return output
}

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-live-deepseek-'))
try {
  const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
  await stat(dshBin)

  const home = join(scratch, 'dsh-home')
  const bundle = join(scratch, 'bundle')
  const shimDir = join(scratch, 'bin')
  await mkdir(shimDir, { recursive: true })
  const pnpmShim = join(shimDir, 'pnpm')
  await writeFile(pnpmShim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(pnpmShim, 0o755)

  const pkg = await resolvePiPackage(join(projectRoot, 'fixtures/complete-package'))
  let generatedPackage
  try {
    generatedPackage = (await generateBundle(pkg, {
      outDir: bundle,
      runtimeSpec: `file:${projectRoot}`,
    })).packageName
  } finally {
    await pkg.dispose()
  }

  const environment = {
    ...process.env,
    DSH_HOME: home,
    PATH: `${shimDir}:${process.env.PATH ?? ''}`,
    CI: '1',
    NO_COLOR: '1',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_PERMISSION_MODE: 'danger-full-access',
    npm_config_registry: 'https://registry.npmjs.org',
    PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
  }
  const runDsh = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args], {
    cwd: dshRoot,
    env: environment,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  })

  const installed = await runDsh(['plugin', '--profile', 'headless', 'add', `file:${bundle}`])
  const profilePatch = join(home, 'profiles/headless/cordis.patch.yml')
  await writeFile(profilePatch, [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'))

  const prompt = 'You are running a migration acceptance test. You MUST call the pi_greet tool exactly once with name Ada. Do not claim success without the tool result. After the tool result, reply with the exact returned greeting and a short confirmation.'
  const run = await runDsh(['--profile', 'headless', prompt])
  const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
  assert.equal(sessionFiles.length, 1, `expected one durable session log, found ${sessionFiles.length}`)
  const rawLog = await readFile(sessionFiles[0], 'utf8')

  const potentiallySensitive = `${installed.stdout}\n${installed.stderr}\n${run.stdout}\n${run.stderr}\n${rawLog}`
  assert(!potentiallySensitive.includes(apiKey), 'credential appeared in captured test artifacts')

  const records = rawLog.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const calls = records.filter(record => record.type === 'tool/call' && record.data?.name === 'pi_greet')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].data.arguments), { name: 'Ada' })
  const results = records.filter(record => (
    record.type === 'tool/result'
    && record.data?.message?.source?.callId === calls[0].data.callId
  ))
  assert.equal(results.length, 1)
  const toolResult = results[0].data.message.content[0]
  assert.equal(toolResult.isError, false)
  const texts = toolResult.content.filter(block => block.type === 'text').map(block => block.text)
  assert.deepEqual(texts, ['Hello, Ada!', 'Result passed through migrated Pi hook.'])
  const turnEnd = records.findLast(record => record.type === 'turn/end')
  assert.equal(turnEnd?.data?.reason?.kind, 'completed')

  const dshCommit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: dshRoot })).stdout.trim()
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    dsh: {
      repository: 'deepseek-ai/deepseek-harness',
      commit: dshCommit,
      profile: 'headless',
    },
    model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    fixture: {
      piPackage: '@pi2dsh-fixtures/complete@1.2.3',
      generatedBundle: generatedPackage,
      tool: 'pi_greet',
    },
    checks: {
      officialPluginManagerInstall: 'passed',
      officialHeadlessModelRun: 'passed',
      durableToolCallCount: calls.length,
      durableToolCallArguments: JSON.parse(calls[0].data.arguments),
      durableToolResult: { isError: toolResult.isError, texts },
      turnEndReason: turnEnd.data.reason.kind,
    },
    security: { credentialPersisted: false, credentialIncludedInEvidence: false },
  }
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  throw new Error(message.replaceAll(apiKey, '[REDACTED]'))
} finally {
  if (process.env.PI2DSH_KEEP_TEST_ARTIFACTS !== '1') await rm(scratch, { recursive: true, force: true })
}
