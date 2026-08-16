#!/usr/bin/env node
// End-to-end proof, on the real dsh CLI against a live model, of the step
// seams this bridge rewired — each one a place where a migrated Pi package
// previously observed something other than what DSH held:
//
//   1. the argument gate  — the tool's prepareArguments shim hands the gate a
//                           string where the schema says number, plus an
//                           explicit null on an optional property, and the
//                           tool receives 7 with the null gone, as under Pi
//   2. before_agent_start — a returned systemPrompt reaches the assembly of
//                           ITS OWN turn (observable in the request header's
//                           prompt), not the turn after it
//   3. tool_execution_end — fires before the turn that produced it ends
//   4. turn_end           — carries that turn's real tool results
//
// Usage: DEEPSEEK_API_KEY=… node scripts/verify-step-seams-e2e.mjs [outfile]
//
// The key is read from the environment only: never written to the bundle, the
// profile, the session log, or the evidence file, and asserted absent from
// every captured artifact before anything is written.

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
const outputPath = resolve(process.argv[2] ?? 'community/step-seams-e2e.json')
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

const OVERRIDE_MARKER = 'PI2DSH-E2E-OVERRIDE-MARKER'
const GUIDELINE = 'Always call pi_repeat rather than answering from memory.'
const SNIPPET = 'pi_repeat: repeat a word a given number of times'

/** The Pi package under test: one typed tool plus the two step-seam hooks. */
const EXTENSION_SOURCE = `
export default function stepSeams(pi) {
  const seen = (globalThis.__pi2dshE2E ??= { order: [], toolArgs: null, turnEnd: null })

  pi.registerTool({
    name: 'pi_repeat',
    description: 'Repeat a word a given number of times.',
    label: 'Repeat',
    promptSnippet: ${JSON.stringify(SNIPPET)},
    promptGuidelines: [${JSON.stringify(GUIDELINE)}],
    parameters: {
      type: 'object',
      properties: { word: { type: 'string' }, times: { type: 'number' }, note: { type: 'string' } },
      required: ['word', 'times'],
    },
    // Pi runs the tool's own shim BEFORE the argument gate. Stringifying here
    // makes the coercion deterministic in a live run: whatever the model
    // emitted, the gate now has a string where the schema says number, and an
    // explicit null on an optional property. Without the gate the tool would
    // receive both verbatim.
    prepareArguments(args) {
      return { ...args, times: String(args.times), note: null }
    },
    async execute(_id, args) {
      // Recorded as the tool ACTUALLY received them: the gate runs before this.
      seen.toolArgs = {
        times: args.times,
        timesType: typeof args.times,
        word: args.word,
        keys: Object.keys(args).sort(),
      }
      return { content: [{ type: 'text', text: Array(args.times).fill(args.word).join(' ') }] }
    },
  })

  pi.on('before_agent_start', async () => {
    seen.order.push('before_agent_start')
    return { systemPrompt: 'You are a migration acceptance test. ${OVERRIDE_MARKER}' }
  })

  pi.on('tool_execution_end', async (event) => {
    seen.order.push('tool_execution_end:' + event.toolName)
  })

  pi.on('agent_start', async () => { seen.order.push('agent_start') })

  pi.on('turn_start', async (event) => {
    seen.order.push('turn_start:' + event.turnIndex)
  })

  pi.on('agent_end', async () => {
    seen.order.push('agent_end')
    if (process.env.PI2DSH_E2E_REPORT !== undefined) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.PI2DSH_E2E_REPORT, JSON.stringify(seen, null, 2))
    }
  })

  pi.on('turn_end', async (event) => {
    seen.order.push('turn_end:' + event.turnIndex)
    // Pi's turn_end reports ONE model call, so each step gets its own entry.
    ;(seen.turns ??= []).push({
      turnIndex: event.turnIndex,
      toolResultCount: (event.toolResults ?? []).length,
      toolResultRoles: (event.toolResults ?? []).map(result => result.role),
      finalRole: event.message?.role ?? null,
    })
    seen.turnEnd = seen.turns[seen.turns.length - 1]
    // Written where the harness can read it after the process exits.
    if (process.env.PI2DSH_E2E_REPORT !== undefined) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.PI2DSH_E2E_REPORT, JSON.stringify(seen, null, 2))
    }
  })
}
`

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-step-seams-'))
try {
  const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
  await stat(dshBin)

  const home = join(scratch, 'dsh-home')
  const bundle = join(scratch, 'bundle')
  const source = join(scratch, 'pi-package')
  const report = join(scratch, 'report.json')
  const shimDir = join(scratch, 'bin')
  await mkdir(shimDir, { recursive: true })
  const pnpmShim = join(shimDir, 'pnpm')
  await writeFile(pnpmShim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(pnpmShim, 0o755)

  // A real Pi package on disk, converted by the real generator.
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'package.json'), `${JSON.stringify({
    name: '@pi2dsh-e2e/step-seams',
    version: '0.0.0',
    type: 'module',
    pi: { extensions: ['extension.js'] },
  }, null, 2)}\n`)
  await writeFile(join(source, 'extension.js'), EXTENSION_SOURCE)

  const pkg = await resolvePiPackage(source)
  let generatedPackage
  try {
    generatedPackage = (await generateBundle(pkg, { outDir: bundle })).packageName
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
    PI2DSH_E2E_REPORT: report,
    npm_config_registry: 'https://registry.npmjs.org',
    PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
  }
  const runDsh = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args], {
    cwd: dshRoot,
    env: environment,
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  })

  const installed = await runDsh(['plugin', '--profile', 'headless', 'add', `file:${bundle}`])
  await writeFile(join(home, 'profiles/headless/cordis.patch.yml'), [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'))

  const prompt = 'Call the pi_repeat tool exactly once with word "ok" and times 7,'
    + ' then reply with the tool output verbatim.'
  const run = await runDsh(['--profile', 'headless', prompt])

  const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
  assert.equal(sessionFiles.length, 1, `expected one durable session log, found ${sessionFiles.length}`)
  const rawLog = await readFile(sessionFiles[0], 'utf8')
  const seen = JSON.parse(await readFile(report, 'utf8'))

  const potentiallySensitive = `${installed.stdout}\n${installed.stderr}\n${run.stdout}\n${run.stderr}\n${rawLog}\n${JSON.stringify(seen)}`
  assert(!potentiallySensitive.includes(apiKey), 'credential appeared in captured test artifacts')

  const records = rawLog.split('\n').filter(Boolean).map(line => JSON.parse(line))

  // ---- 1. the argument gate ------------------------------------------------
  const calls = records.filter(record => record.type === 'tool/call' && record.data?.name === 'pi_repeat')
  assert.equal(calls.length, 1, `expected exactly one pi_repeat call, saw ${calls.length}`)
  const wireArguments = JSON.parse(calls[0].data.arguments)
  // prepareArguments handed the gate a string; the tool must receive a number.
  assert.equal(seen.toolArgs?.timesType, 'number',
    `the tool received times as ${seen.toolArgs?.timesType}, so the coercion gate did not run`)
  assert.equal(seen.toolArgs?.times, 7)
  // …and the explicit null on the optional property is gone, not passed through.
  assert.deepEqual(seen.toolArgs?.keys, ['times', 'word'],
    `the tool received ${JSON.stringify(seen.toolArgs?.keys)}; the optional explicit null was not removed`)

  // ---- 2. the override reached ITS OWN turn --------------------------------
  // The request header records the exact system prompt that was sent.
  const headers = records.filter(record => record.type === 'request/header')
  assert(headers.length > 0, 'no request/header events in the durable log')
  const firstPrompt = JSON.stringify(headers[0].data ?? {})
  assert(firstPrompt.includes(OVERRIDE_MARKER),
    'the first request of the turn did not carry the override, so it landed a turn late')

  // ---- 3. execution end precedes its step's end ----------------------------
  const endIndex = seen.order.indexOf('tool_execution_end:pi_repeat')
  const turnEndIndex = seen.order.findIndex(entry => entry.startsWith('turn_end:'))
  assert(endIndex >= 0, `tool_execution_end never fired; order was ${JSON.stringify(seen.order)}`)
  assert(turnEndIndex > endIndex,
    `turn_end (${turnEndIndex}) did not follow tool_execution_end (${endIndex}): ${JSON.stringify(seen.order)}`)

  // ---- 4. Pi's turn granularity: ONE PER MODEL CALL ------------------------
  // A prompt that calls a tool takes two model calls, so Pi fires turn_start
  // and turn_end twice, indexed from zero, inside a single agent_start /
  // agent_end pair. Mapping Pi's turn onto DSH's turn fired them once.
  const starts = seen.order.filter(entry => entry.startsWith('turn_start:'))
  const ends = seen.order.filter(entry => entry.startsWith('turn_end:'))
  assert(starts.length >= 2,
    `expected a turn_start per model call (at least 2 for a tool-calling prompt), saw ${JSON.stringify(starts)}`)
  assert.equal(starts.length, ends.length, `turn_start/turn_end are unpaired: ${JSON.stringify(seen.order)}`)
  assert.deepEqual(starts, starts.map((_, index) => `turn_start:${index}`),
    `turnIndex does not count model calls from zero: ${JSON.stringify(starts)}`)
  assert.equal(seen.order.filter(entry => entry === 'agent_start').length, 1)
  assert.equal(seen.order.filter(entry => entry === 'agent_end').length, 1)

  // The tool's result belongs to the step that ran it, not to every step.
  const withResults = (seen.turns ?? []).filter(turn => turn.toolResultCount > 0)
  assert.equal(withResults.length, 1,
    `exactly one model call ran a tool, but ${withResults.length} turn_end events carried results`)
  assert.deepEqual(withResults[0].toolResultRoles, ['toolResult'])
  assert.equal(seen.turns.at(-1)?.finalRole, 'assistant')

  // The converted bundle really is the thing that ran.
  const listed = await runDsh(['plugin', '--profile', 'headless', 'list'])
  assert(listed.stdout.includes(generatedPackage),
    `the converted package ${generatedPackage} is not installed in the profile`)

  const evidence = {
    schemaVersion: 1,
    generatedPackage,
    dshCommit: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: dshRoot })).stdout.trim(),
    pi2dshCommit: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim(),
    profile: 'headless',
    prompt,
    seams: {
      argumentGate: {
        modelSent: wireArguments.times,
        modelSentType: typeof wireArguments.times,
        // What prepareArguments handed the gate, which is what makes this
        // deterministic rather than dependent on how the model spelled it.
        gateReceivedType: 'string',
        toolReceived: seen.toolArgs.times,
        toolReceivedType: seen.toolArgs.timesType,
        optionalNullRemoved: true,
      },
      beforeAgentStartOverride: { appliedToOwnTurn: true, marker: OVERRIDE_MARKER },
      handlerOrder: seen.order,
      turns: seen.turns,
    },
  }
  await mkdir(resolve(outputPath, '..'), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`[step-seams-e2e] all seams verified on the real dsh CLI → ${outputPath}`)
  console.log(`[step-seams-e2e] model sent times=${JSON.stringify(wireArguments.times)}`
    + ` (${typeof wireArguments.times}); prepareArguments made it a string;`
    + ` the tool received ${seen.toolArgs.times} (${seen.toolArgs.timesType}),`
    + ` keys ${JSON.stringify(seen.toolArgs.keys)}`)
  console.log(`[step-seams-e2e] handler order: ${seen.order.join(' → ')}`)
  console.log(`[step-seams-e2e] per-model-call turn_end payloads: ${JSON.stringify(seen.turns)}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
