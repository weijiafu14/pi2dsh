#!/usr/bin/env node
// Real-machine acceptance for `serveNativeSubagents`: DSH's OWN delegation
// (the stock native `subagent` tool — no Pi subagent package installed) must
// produce children that carry the profile's Pi extensions when the flag is
// on, and stay plain when it is off. Stock stack, no mocks:
//
//   - CLI:      @deepseek-ai/dsh@0.1.1-rc.2 (npm, stock)
//   - Engine:   this working tree (or PI2DSH_ENGINE_SPEC)
//   - Probe:    fixtures/subagent-archive-probe (Pi package with probe_touch)
//   - Model:    real DeepSeek (parent AND child turns)
//
// Falsifiable both ways:
//
//   flag-on:  the probe file can only exist if probe_touch really executed,
//             and the parent is FORBIDDEN from calling it (asserted on its
//             durable log) — so the file plus a non-error probe_touch result
//             in the CHILD's log can only mean the native child was served.
//             The child's session id must NOT carry the bridge prefix
//             (pi2dsh-sub-): this is the native lineage, not the bridge's.
//   flag-off: same task shape. Delegation must still happen (the parent's
//             subagent call is asserted), but no session may carry a
//             non-error probe_touch result and the probe file must be absent
//             — a pass here with the mount leaking would be impossible.
//
//   node scripts/verify-native-subagents-e2e.mjs [community/native-subagents-e2e.json]

import { execFile as execFileCallback } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outPath = resolve(process.argv[2] ?? 'community/native-subagents-e2e.json')

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const PROBE_DIR = join(projectRoot, 'fixtures', 'subagent-archive-probe')
const RUN_TAG = Date.now().toString(36).toUpperCase()

const log = message => console.log(`[native-subagents] ${message}`)
const startedAt = new Date().toISOString()
const scenarios = {}
const record = async status => {
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify({
    scenario: 'serveNativeSubagents (stock native delegation, flag on/off)',
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    runTag: RUN_TAG,
    scenarios,
  }, null, 2)}\n`)
}

function findDeepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const envFile = readFileSync(resolve(projectRoot, '..', 'deepseek-harness', '.env'), 'utf8')
    const fromFile = /^\s*(?:export\s+)?DEEPSEEK_API_KEY=["']?([A-Za-z0-9_-]{20,})["']?\s*$/mu.exec(envFile)
    if (fromFile) return fromFile[1]
  } catch { /* skipped below */ }
  return undefined
}
const apiKey = findDeepseekKey()
if (apiKey === undefined) {
  log('SKIPPED — no DeepSeek credential in the environment')
  scenarios.all = { status: 'skipped', reason: 'no DeepSeek credential; the delegation turns need a real model' }
  await record('skipped')
  process.exit(0)
}

const root = process.env.PI2DSH_NATIVE_SUBAGENTS_E2E_ROOT ?? await mkdtemp('/tmp/pi2dsh-native-subagents.')
const home = join(root, 'dsh-home')
const cliDir = join(root, 'cli')
const workDir = join(root, 'workspace')
await mkdir(workDir, { recursive: true })
log(`scratch: ${root}`)

const shimDir = join(root, 'bin')
await mkdir(shimDir, { recursive: true })
await writeFile(join(shimDir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
await chmod(join(shimDir, 'pnpm'), 0o755)

const baseEnv = {
  ...process.env,
  DEEPSEEK_API_KEY: apiKey,
  DSH_HOME: home,
  PATH: `${shimDir}:${process.env.PATH ?? ''}`,
  CI: '1',
  NO_COLOR: '1',
  DSH_TELEMETRY_DISABLED: '1',
  PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
  npm_config_registry: 'https://registry.npmjs.org',
}

async function sessionFiles(dir) {
  const found = []
  const walk = async current => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.jsonl')) found.push(path)
    }
  }
  await walk(dir)
  return found
}

function parseLines(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch { /* partial write */ }
  }
  return events
}

/** Every session log touched by this run tag, with the calls that matter.
 * Shapes verified against real jsonl (session-persistence-jsonl, compression
 * none): the first line is the session header ({type:'session', id, origin,
 * parentSession}), tool/call carries data.{callId,name,arguments}, and the
 * matching tool/result carries data.message.source.callId with per-item
 * isError on the tool-result content entry. */
async function loadSessions(marker) {
  const out = []
  for (const file of await sessionFiles(join(home, 'sessions'))) {
    const raw = await readFile(file, 'utf8')
    if (!raw.includes(marker)) continue
    const events = parseLines(raw)
    const header = events.find(event => event.type === 'session')
    const toolCalls = events
      .filter(event => event.type === 'tool/call')
      .map(event => event.data ?? {})
    out.push({
      file,
      raw,
      events,
      header,
      toolCalls,
      isSubagent: header?.origin === 'subagent',
      delegates: toolCalls.some(call => String(call.name ?? '').includes('subagent')),
      probeCalls: toolCalls.filter(call => String(call.name ?? '') === 'probe_touch'),
      bashCalls: toolCalls.filter(call => String(call.name ?? '') === 'bash'),
    })
  }
  return out
}

/** The tool-result content item for one callId, or undefined. */
function resultFor(session, callId) {
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const message = event.data?.message
    if (message?.source?.callId !== callId) continue
    const item = (message.content ?? []).find(entry => entry.toolCallId === callId)
    if (item !== undefined) return item
  }
  return undefined
}

/** Non-error probe_touch results in a session (linked by callId, never by
 * string luck — a failure narration mentioning the tag must not count). */
function successfulProbeResults(session) {
  return session.probeCalls
    .map(call => resultFor(session, call.callId))
    .filter(item => item !== undefined && item.isError !== true)
}

async function runHeadlessTurn(prompt, doneFile, deadlineMs) {
  const child = spawn(join(cliDir, 'node_modules', '.bin', 'dsh'), ['--profile', 'headless', prompt], {
    cwd: workDir, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  const deadline = Date.now() + deadlineMs
  while (child.exitCode === null && Date.now() < deadline) {
    if (doneFile !== undefined && existsSync(doneFile)) break
    await delay(2000)
  }
  // Let the parent finish narrating, then stop the process either way — the
  // assertions read durable logs and the filesystem, never the screen.
  for (let settle = 0; settle < 60 && child.exitCode === null; settle += 1) await delay(2000)
  if (child.exitCode === null) child.kill('SIGTERM')
  return output
}

const profileRoot = join(home, 'profiles', 'headless')

/** The engine flag travels through the OFFICIAL config seam: the plugin row's
 * patch in cordis.patch.yml — exactly what the README tells users to write. */
async function writePatch(serveNativeSubagents) {
  const lines = [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
  ]
  if (serveNativeSubagents) {
    lines.push('- id: pi2dsh', '  config:', '    serveNativeSubagents: true')
  }
  await writeFile(join(profileRoot, 'cordis.patch.yml'), `${lines.join('\n')}\n`)
}

try {
  // ---- 1. stock CLI ------------------------------------------------------
  const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh')
  if (!existsSync(join(cliDir, 'package.json'))) {
    await mkdir(cliDir, { recursive: true })
    await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
      name: 'pi2dsh-native-subagents-cli',
      private: true,
      dependencies: { [DSH_CLI_SPEC.slice(0, DSH_CLI_SPEC.lastIndexOf('@'))]: DSH_CLI_SPEC.slice(DSH_CLI_SPEC.lastIndexOf('@') + 1) },
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
    await execFile('corepack', ['pnpm@11.7.0', 'install'], { cwd: cliDir, env: baseEnv, timeout: 300_000 })
  }
  const cliVersion = JSON.parse(await readFile(join(cliDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version

  // ---- 2. one profile: engine + probe (NO Pi subagent package — the whole
  // point is DSH's own delegation) ----------------------------------------
  if (!existsSync(join(profileRoot, 'node_modules', 'pi2dsh'))) {
    await mkdir(profileRoot, { recursive: true })
    await writeFile(join(profileRoot, 'pnpm-workspace.yaml'), [
      'minimumReleaseAge: 0',
      'allowBuilds:',
      "  '@google/genai': false",
      '  protobufjs: false',
      '',
    ].join('\n'))
    log('installing headless profile (engine + probe) …')
    await execFile(dshBin, ['plugin', '--profile', 'headless', 'add', ENGINE_SPEC, PROBE_DIR], {
      env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
    })
  }
  const engineVersion = JSON.parse(await readFile(join(profileRoot, 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version
  log(`stock stack: cli ${cliVersion}, engine ${engineVersion}`)

  const taskFor = (tag, outFile) => [
    `You are testing subagent delegation. Use your native subagent tool to delegate this exact task to ONE`,
    `child agent and wait for it to finish: "Call the probe_touch tool with out set to ${outFile} and text set`,
    `to ${tag}. If you do not have a tool named probe_touch, reply exactly TOOL_MISSING and stop — do NOT`,
    `create that file with bash, write, or any other tool. Then reply done." Do NOT call probe_touch yourself`,
    `under any circumstances — only the child may call it. Do not run bash and do not write any file yourself.`,
    `When the child finishes, reply with one line reporting what it said.`,
  ].join(' ')

  // ======================================================================
  // Scenario 1 — flag ON: the native child carries the probe extension.
  // ======================================================================
  {
    const TAG = `NATON_${RUN_TAG}`
    const probeFile = join(workDir, `native-on-${RUN_TAG}.txt`)
    await rm(probeFile, { force: true })
    await writePatch(true)
    log('scenario flag-on: running the headless turn …')
    const output = await runHeadlessTurn(taskFor(TAG, probeFile), probeFile, 420_000)

    const problems = []
    const fileContent = existsSync(probeFile) ? (await readFile(probeFile, 'utf8')).trim() : undefined
    if (fileContent !== TAG) problems.push(`probe file missing or wrong (${JSON.stringify(fileContent)})`)

    const sessions = await loadSessions(TAG)
    const parents = sessions.filter(session => !session.isSubagent && session.delegates)
    const children = sessions.filter(session => session.isSubagent)
    if (parents.length !== 1) problems.push(`expected exactly one delegating parent session, saw ${parents.length}`)
    if (children.length !== 1) problems.push(`expected exactly one subagent-origin child session, saw ${children.length}`)
    const parent = parents[0]
    const child = children[0]
    // The parent has the probe tool too (roots are always served) — the file
    // alone proves nothing. The decisive signal is the CHILD's own linked
    // tool result; the parent is asserted clean of both direct routes.
    if (parent !== undefined && parent.probeCalls.length > 0) {
      problems.push('the parent called probe_touch itself — the file proves nothing about the child')
    }
    if (parent !== undefined && parent.bashCalls.length > 0) {
      problems.push('the parent ran bash itself — the file proves nothing about the child')
    }
    if (child !== undefined) {
      const results = successfulProbeResults(child)
      if (results.length === 0) {
        problems.push("no non-error probe_touch result linked by callId in the child's durable log")
      } else if (!JSON.stringify(results[0]).includes(probeFile)) {
        problems.push(`the child's probe_touch result does not name the probe file: ${JSON.stringify(results[0]).slice(0, 200)}`)
      }
      const childId = String(child.header?.id ?? '')
      if (childId.startsWith('pi2dsh-sub-')) {
        problems.push('the child carries the bridge session-id prefix — this is not the native lineage')
      }
      if (parent !== undefined && child.header?.parentSession !== parent.header?.id) {
        problems.push('the child does not name the delegating parent in its session header')
      }
    }

    scenarios.flagOn = {
      status: problems.length === 0 ? 'passed' : 'failed',
      probeFile: fileContent === TAG ? 'written with the exact tag' : fileContent,
      parentSession: parent?.file,
      childSession: child?.file,
      childSessionId: child?.header?.id,
      problems,
      ...(problems.length > 0 ? { outputTail: output.slice(-1200) } : {}),
    }
    log(`scenario flag-on: ${scenarios.flagOn.status}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}`)
  }

  // ======================================================================
  // Scenario 2 — flag OFF (default): delegation happens, the child is plain.
  // ======================================================================
  {
    const TAG = `NATOFF_${RUN_TAG}`
    const probeFile = join(workDir, `native-off-${RUN_TAG}.txt`)
    await rm(probeFile, { force: true })
    await writePatch(false)
    log('scenario flag-off: running the headless turn …')
    const output = await runHeadlessTurn(taskFor(TAG, probeFile), undefined, 420_000)

    const problems = []
    // NOT asserted: probe-file absence. A plain child can improvise the file
    // with its native bash/write tools (observed live) — that tests model
    // obedience, not the mount. Whether probe_touch really ran is decided by
    // the callId-linked durable results below, nowhere else.
    const sessions = await loadSessions(TAG)
    const parents = sessions.filter(session => !session.isSubagent && session.delegates)
    const children = sessions.filter(session => session.isSubagent)
    if (parents.length !== 1) problems.push(`expected exactly one delegating parent session, saw ${parents.length}`)
    if (parents[0] !== undefined && parents[0].probeCalls.length > 0) problems.push('the parent called probe_touch itself')
    // Delegation must really have happened — a run where no child ever spawned
    // would "pass" the leak assertions vacuously.
    if (children.length === 0) problems.push('no subagent-origin child session found — delegation never happened, the negative proves nothing')
    for (const session of children) {
      if (successfulProbeResults(session).length > 0) {
        problems.push(`non-error probe_touch result found in ${session.file} — the mount leaked to a plain child`)
      }
    }

    scenarios.flagOff = {
      status: problems.length === 0 ? 'passed' : 'failed',
      parentSession: parents[0]?.file,
      childSessions: children.map(session => session.file),
      problems,
      ...(problems.length > 0 ? { outputTail: output.slice(-1200) } : {}),
    }
    log(`scenario flag-off: ${scenarios.flagOff.status}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}`)
  }

  const failed = Object.values(scenarios).some(scenario => scenario.status !== 'passed')
  await record(failed ? 'failed' : 'passed')
  log(failed ? 'FAILED — see the per-scenario problems above' : `PASSED — evidence in ${outPath}`)
  process.exit(failed ? 1 : 0)
} catch (error) {
  scenarios.crash = { status: 'failed', error: error instanceof Error ? error.stack ?? error.message : String(error) }
  await record('failed')
  log(`CRASHED — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
