#!/usr/bin/env node
// Real-machine acceptance for the pi-subagents LIFECYCLE surfaces the P0 run
// left open: steer / resume / stop. Stock stack, no mocks:
//
//   - CLI:      @deepseek-ai/dsh@0.1.1-rc.2 (npm, stock)
//   - Engine:   this working tree (or PI2DSH_ENGINE_SPEC)
//   - Plugin:   @tintinweb/pi-subagents (npm, stock)
//   - Model:    real DeepSeek (parent AND child turns)
//
// Every assertion is falsifiable — it fails when the feature is broken:
//
//   steer:  the steered file's path+content exist ONLY in the steer message
//           (never in the spawn prompt), and the parent is forbidden from
//           running bash itself (asserted on its log) — so the file on disk
//           can only mean the mid-run steer reached the child's model.
//   resume: the codeword exists ONLY inside a file on disk (no prompt carries
//           it). Turn 1 has the child read + memorize it; the resumed turn 2
//           forbids reading and asks it to write the codeword from memory.
//           Passing needs: recall file content matches, both turns live in the
//           SAME child session log, and turn 2 made no read call.
//   stop:   a foreground child runs `sleep N` then writes a file. The parent
//           turn is interrupted (Esc in the stock TUI — the official
//           parent-abort → child-stop wiring). The file must still be absent
//           well after the sleep window — without a real stop it appears.
//
//   node scripts/verify-subagents-lifecycle-e2e.mjs [community/subagents-lifecycle-e2e.json]

import { execFile as execFileCallback } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outPath = resolve(process.argv[2] ?? 'community/subagents-lifecycle-e2e.json')

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const SUBAGENTS_SPEC = process.env.PI2DSH_SUBAGENTS_SPEC ?? '@tintinweb/pi-subagents@0.18.0'
// Cross-restart reopen probe (public Pi ABI: createAgentSession + SessionManager.open).
const PROBE_DIR = join(projectRoot, 'fixtures', 'subagent-archive-probe')
const RUN_TAG = Date.now().toString(36).toUpperCase()

const log = message => console.log(`[subagents-lifecycle] ${message}`)

const startedAt = new Date().toISOString()
const scenarios = {}
const record = async status => {
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    startedAt,
    scenario: 'pi-subagents-lifecycle (steer / resume / stop)',
    cliSpec: DSH_CLI_SPEC,
    engineSpec: ENGINE_SPEC,
    subagentsSpec: SUBAGENTS_SPEC,
    status,
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
  log('SKIPPED: no DeepSeek credential available')
  scenarios.all = { status: 'skipped', reason: 'no DeepSeek credential; the lifecycle turns need a real model' }
  await record('skipped')
  process.exit(0)
}

const root = process.env.PI2DSH_SUBAGENTS_E2E_ROOT ?? await mkdtemp('/tmp/pi2dsh-subagents-lifecycle.')
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

/** Load every session log, split parent (has Agent tool/call) from children. */
async function loadSessions(marker) {
  const out = []
  for (const file of await sessionFiles(join(home, 'sessions'))) {
    const raw = await readFile(file, 'utf8')
    if (!raw.includes(marker)) continue
    const events = parseLines(raw)
    out.push({
      file,
      raw,
      events,
      isChild: events.some(event => event.type === 'subagent/descriptor'),
      toolCalls: events.filter(event => event.type === 'tool/call'),
      requestCount: events.filter(event => event.type === 'request/header').length,
    })
  }
  return out
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
  for (let settle = 0; settle < 90 && child.exitCode === null; settle += 1) await delay(2000)
  if (child.exitCode === null) child.kill('SIGTERM')
  return output
}

try {
  // ---- 1. stock CLI ------------------------------------------------------
  const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh')
  if (!existsSync(join(cliDir, 'package.json'))) {
    await mkdir(cliDir, { recursive: true })
    await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
      name: 'pi2dsh-subagents-lifecycle-cli',
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

  // ---- 2. profiles: engine + pi-subagents (headless and tui) -------------
  for (const profile of ['headless', 'tui']) {
    const profileRoot = join(home, 'profiles', profile)
    if (!existsSync(join(profileRoot, 'node_modules', 'pi2dsh'))) {
      log(`installing ${profile} profile …`)
      const extra = profile === 'tui' ? ['-w', process.env.PI2DSH_TUI_SPEC ?? '@deepseek-harness-tui/dsh-tui'] : []
      const probe = profile === 'headless' ? [PROBE_DIR] : []
      await execFile(dshBin, ['plugin', '--profile', profile, 'add', ...extra, ENGINE_SPEC, SUBAGENTS_SPEC, ...probe], {
        env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
      })
    } else if (profile === 'headless' && !existsSync(join(profileRoot, 'node_modules', '@pi2dsh-fixtures', 'subagent-archive-probe'))) {
      // A reused scratch predating the probe: add it in place.
      await execFile(dshBin, ['plugin', '--profile', profile, 'add', PROBE_DIR], {
        env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
      })
    }
    await writeFile(join(profileRoot, 'cordis.patch.yml'), [
      '- id: session-persistence-jsonl',
      '  config:',
      "    root: !!js dshHomePath('sessions')",
      '    compression: none',
      '',
    ].join('\n'))
  }
  const engineVersion = JSON.parse(await readFile(join(home, 'profiles', 'headless', 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version
  log(`stock stack: cli ${cliVersion}, engine ${engineVersion}`)

  // ======================================================================
  // Scenario 1 — steer: a mid-run steer_subagent reaches the child model.
  // ======================================================================
  {
    const STEER_TAG = `STEER_${RUN_TAG}`
    const steeredPath = join(workDir, `steered-${RUN_TAG}.txt`)
    const alphaPath = join(workDir, `alpha-${RUN_TAG}.txt`)
    await rm(steeredPath, { force: true })
    await rm(alphaPath, { force: true })
    // The steered file's name and content live ONLY in the steer text.
    const spawnTask = [
      `First run the bash command \`sleep 25\`. When it finishes, write the file ${alphaPath}`,
      `with the single word ALPHA_${RUN_TAG} using bash, then reply done.`,
    ].join(' ')
    const steerText = [
      `URGENT change of plan: do NOT write the alpha file. Instead run exactly one bash command that writes`,
      `the single word ${STEER_TAG} into ${steeredPath}, then finish immediately.`,
    ].join(' ')
    const prompt = [
      `Do these steps in order and do not run bash or write any file yourself — only the subagent may.`,
      `Step 1: call the Agent tool once: subagent_type general-purpose, name "writer", run_in_background true,`,
      `prompt: "${spawnTask}".`,
      `Step 2: immediately call steer_subagent with agent "writer" and message: "${steerText}".`,
      `Step 3: call get_subagent_result with agent "writer" and wait true.`,
      `Step 4: reply with the agent's report only.`,
    ].join(' ')
    log('scenario steer: running the headless turn …')
    const output = await runHeadlessTurn(prompt, steeredPath, 420_000)

    const sessions = await loadSessions(RUN_TAG)
    const parent = sessions.find(s => !s.isChild && s.toolCalls.some(c => c.data?.name === 'Agent'))
    const child = sessions.find(s => s.isChild && s.raw.includes('sleep 25'))
    const problems = []
    const steeredLanded = existsSync(steeredPath) && readFileSync(steeredPath, 'utf8').includes(STEER_TAG)
    if (!steeredLanded) problems.push('steered file missing or wrong — the steer never reached the child model')
    if (parent === undefined) problems.push('no parent session with an Agent tool/call')
    if (parent !== undefined) {
      if (!parent.toolCalls.some(c => c.data?.name === 'steer_subagent')) problems.push('parent never called steer_subagent')
      if (parent.toolCalls.some(c => c.data?.name === 'bash')) problems.push('parent ran bash itself — the file proves nothing')
    }
    if (child === undefined) problems.push('no child session carrying the spawn task')
    if (child !== undefined) {
      if (!child.raw.includes(STEER_TAG)) problems.push('steer text absent from the child durable log')
      const firstRequest = child.events.findIndex(e => e.type === 'request/header')
      const steerEvent = child.events.findIndex(e => JSON.stringify(e).includes(STEER_TAG) && e.type !== 'request/header')
      if (firstRequest !== -1 && steerEvent !== -1 && steerEvent < firstRequest) {
        problems.push('steer message precedes the first model request — not a mid-run delivery')
      }
    }
    scenarios.steer = {
      status: problems.length === 0 ? 'passed' : 'failed',
      problems,
      steeredLanded,
      alphaAlsoLanded: existsSync(alphaPath),
      parentToolCalls: parent?.toolCalls.map(c => c.data?.name) ?? null,
      childFile: child?.file ?? null,
      outputTail: problems.length > 0 ? output.slice(-1200) : undefined,
    }
    log(`scenario steer: ${scenarios.steer.status}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}`)
  }

  // ======================================================================
  // Scenario 2 — resume: a resumed child keeps its session and its memory.
  // Model-compliance failures (the parent grabbing bash/read itself) get ONE
  // retry — they falsify the evidence, not the feature.
  // ======================================================================
  for (let resumeAttempt = 1; resumeAttempt <= 2; resumeAttempt += 1) {
    const CODEWORD = `CODEWORD_${randomBytes(6).toString('hex').toUpperCase()}`
    const secretPath = join(workDir, `secret-${RUN_TAG}-${resumeAttempt}.txt`)
    const recallPath = join(workDir, `recall-${RUN_TAG}-${resumeAttempt}.txt`)
    await rm(recallPath, { force: true })
    await writeFile(secretPath, `${CODEWORD}\n`)
    // No prompt below contains the codeword — it exists only inside secret.txt.
    // Upstream note (pi-subagents 0.18.0): resume accepts only the agent ID
    // (getRecord), while steer/get_result also accept the handle — so the
    // parent must capture the ID from get_subagent_result before resuming.
    const prompt = [
      `Do these steps in order. You yourself must NEVER call the read or bash tools under any circumstances — only the subagent may; if you call them yourself the task is failed. Do not verify any file yourself at any point.`,
      `Step 1: call the Agent tool: subagent_type general-purpose, name "memory", run_in_background true,`,
      `prompt: "Use the read tool to read the file ${secretPath} and memorize the codeword written inside.`,
      `Reply with exactly the single word: memorized. Never write the codeword in any reply."`,
      `Step 2: call get_subagent_result with agent "memory" and wait true. Note the exact Agent ID from the first`,
      `line of the result (the string after "Agent: ").`,
      `Step 3: call the Agent tool again with resume set to that exact Agent ID (NOT the name) and run_in_background false,`,
      `and the prompt EXACTLY this text, copied verbatim with nothing added: "Without reading any file, run exactly`,
      `one bash command that writes the codeword you memorized into ${recallPath}. Then reply done."`,
      `The resume prompt must NOT contain the codeword itself — the agent remembers it.`,
      `Step 4: reply done.`,
    ].join(' ')
    log('scenario resume: running the headless turn …')
    const output = await runHeadlessTurn(prompt, recallPath, 480_000)

    const problems = []
    const recalled = existsSync(recallPath) && readFileSync(recallPath, 'utf8').includes(CODEWORD)
    if (!recalled) problems.push('recall file missing or wrong — the resumed child did not carry its memory')
    const sessions = await loadSessions(secretPath)
    const parent = sessions.find(s => !s.isChild)
    const children = sessions.filter(s => s.isChild)
    const both = children.filter(s => s.raw.includes('memorized') || s.raw.includes(secretPath))
    const sameSession = children.find(s => s.raw.includes(secretPath) && s.raw.includes(recallPath))
    if (sameSession === undefined) {
      problems.push(`memorize and recall turns are not in one child session (${children.length} child log(s) matched)`)
    } else {
      // DSH logs request/header once per turn opening, and a followup that
      // extends a still-open turn shares it — TURNS are the resume signal.
      const turns = sameSession.events.filter(e => e.type === 'turn/start').length
      if (turns < 2) problems.push(`the resumed session shows ${turns} turn(s); resume must open a second one`)
      const reads = sameSession.toolCalls.filter(c => c.data?.name === 'read' && JSON.stringify(c.data?.arguments ?? '').includes('secret'))
      if (reads.length !== 1) problems.push(`expected exactly one read of the secret (turn 1); saw ${reads.length}`)
      // The resumed user prompt must not smuggle the codeword in.
      const userEvents = sameSession.events.filter(e => JSON.stringify(e).includes(recallPath) && !JSON.stringify(e).includes('tool'))
      if (userEvents.some(e => JSON.stringify(e).includes(CODEWORD))) {
        problems.push('the resume prompt itself contained the codeword — memory proves nothing')
      }
    }
    if (parent !== undefined) {
      if (parent.toolCalls.some(c => c.data?.name === 'bash')) problems.push('parent ran bash itself')
      if (parent.toolCalls.some(c => c.data?.name === 'read' && JSON.stringify(c.data?.arguments ?? '').includes('secret'))) {
        problems.push('parent read the secret itself')
      }
      if (parent.raw.includes(CODEWORD) && !recalled) problems.push('codeword leaked into the parent log without a recall')
    }
    scenarios.resume = {
      status: problems.length === 0 ? 'passed' : 'failed',
      problems,
      attempt: resumeAttempt,
      recalled,
      childSessionFile: sameSession?.file ?? null,
      childTurns: sameSession?.events.filter(e => e.type === 'turn/start').length ?? 0,
      matchedChildLogs: both.length,
      outputTail: problems.length > 0 ? output.slice(-1200) : undefined,
    }
    log(`scenario resume (attempt ${resumeAttempt}): ${scenarios.resume.status}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}`)
    const compliance = problems.every(problem => problem.includes('parent ran bash')
      || problem.includes('parent read the secret')
      || problem.includes('resume prompt itself contained the codeword'))
    if (problems.length === 0 || !compliance) break
  }

  // ======================================================================
  // Scenario 4 — resume-archive: a child reopened ACROSS PROCESSES by its
  // archive identity is the same conversation (pi-subagents' tombstone
  // resurrect shape: SessionManager.open(file) -> createAgentSession).
  // ======================================================================
  {
    const CODEWORD = `ARCHIVE_${randomBytes(6).toString('hex').toUpperCase()}`
    const secretPath = join(workDir, `archive-secret-${RUN_TAG}.txt`)
    const identityPath = join(workDir, `archive-identity-${RUN_TAG}.json`)
    const recallPath = join(workDir, `archive-recall-${RUN_TAG}.txt`)
    await rm(identityPath, { force: true })
    await rm(recallPath, { force: true })
    await writeFile(secretPath, `${CODEWORD}\n`)
    const problems = []
    log('scenario resume-archive: process 1 (spawn + memorize) …')
    const promptA = [
      `Call the sub_archive_spawn tool exactly once with arguments {"secret": "${secretPath}", "out": "${identityPath}"}.`,
      'Do not call any other tool and do not use read or bash yourself. Then reply done.',
    ].join(' ')
    const outA = await runHeadlessTurn(promptA, identityPath, 300_000)
    if (!existsSync(identityPath)) {
      problems.push('the probe never recorded an archive identity (process 1 failed)')
      scenarios.resumeArchive = { status: 'failed', problems, outputTail: outA.slice(-1200) }
    } else {
      const identity = JSON.parse(readFileSync(identityPath, 'utf8'))
      if (!existsSync(String(identity.archive))) problems.push('the archive path does not exist on disk')
      log('scenario resume-archive: process 2 (reopen + recall from memory) …')
      const promptB = [
        `Call the sub_archive_resume tool exactly once with arguments {"identity": "${identityPath}", "recall": "${recallPath}"}.`,
        'Do not call any other tool and do not use read or bash yourself. Then reply done.',
      ].join(' ')
      const outB = await runHeadlessTurn(promptB, recallPath, 300_000)
      const recalled = existsSync(recallPath) && readFileSync(recallPath, 'utf8').includes(CODEWORD)
      if (!recalled) problems.push('the reopened child did not recall the codeword — the reopen is not the same conversation')
      const sessions = await loadSessions(secretPath)
      const children = sessions.filter(s => s.isChild)
      const same = children.find(s => s.raw.includes(recallPath))
      if (same === undefined) {
        problems.push(`memorize and recall are not in one child session (${children.length} child log(s) matched)`)
      } else {
        const turns = same.events.filter(e => e.type === 'turn/start').length
        if (turns < 2) problems.push(`the reopened session shows ${turns} turn(s); the recall must be a new turn in the SAME log`)
        const descriptors = same.events.filter(e => e.type === 'subagent/descriptor').length
        if (descriptors !== 1) problems.push(`expected exactly one subagent/descriptor, saw ${descriptors} (a reopen must not duplicate identity)`)
        const reads = same.toolCalls.filter(c => c.data?.name === 'read' && JSON.stringify(c.data?.arguments ?? '').includes('archive-secret'))
        if (reads.length !== 1) problems.push(`expected exactly one read of the secret (process 1); saw ${reads.length}`)
        if (String(identity.sessionId ?? '').length > 0 && !same.file.includes(String(identity.sessionId))) {
          problems.push('the recall landed in a different session than the recorded identity')
        }
      }
      scenarios.resumeArchive = {
        status: problems.length === 0 ? 'passed' : 'failed',
        problems,
        recalled,
        archive: identity.archive ?? null,
        childSessionFile: same?.file ?? null,
        childTurns: same?.events.filter(e => e.type === 'turn/start').length ?? 0,
        outputTail: problems.length > 0 ? outB.slice(-1200) : undefined,
      }
    }
    log(`scenario resume-archive: ${scenarios.resumeArchive.status}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}`)
  }

  // ======================================================================
  // Scenario 3 — stop: interrupting the parent stops the running child.
  // ======================================================================
  if (process.env.PI2DSH_SKIP_TUI !== undefined) {
    scenarios.stop = { status: 'skipped', reason: 'PI2DSH_SKIP_TUI set' }
  } else {
    const STOP_TAG = `SHOULD_NOT_EXIST_${RUN_TAG}`
    const cPath = join(workDir, `stopped-agent-output-${RUN_TAG}.txt`)
    await rm(cPath, { force: true })
    const TMUX_SESSION = 'pi2dsh-subagents-lifecycle-tui'
    const tuiVersion = JSON.parse(await readFile(
      join(home, 'profiles', 'tui', 'node_modules', '@deepseek-harness-tui', 'dsh-tui', 'package.json'), 'utf8')).version
    await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
    const launcher = join(root, 'launch-tui.sh')
    await writeFile(launcher, `#!/bin/sh\nexec "${dshBin}" --profile tui\n`)
    await chmod(launcher, 0o755)
    log(`scenario stop: booting the stock TUI ${tuiVersion} in tmux …`)
    await execFile('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-x', '180', '-y', '50', '-c', workDir,
      'env', `DSH_HOME=${home}`, `DEEPSEEK_API_KEY=${apiKey}`, 'NO_COLOR=1', launcher,
    ], { timeout: 30_000 })
    const capture = async () => {
      const { stdout } = await execFile('tmux', ['capture-pane', '-p', '-t', TMUX_SESSION, '-S', '-200'], { timeout: 15_000 })
      return stdout
    }
    const problems = []
    let interruptedAt = 0
    try {
      const composerDeadline = Date.now() + 120_000
      for (;;) {
        const screen = await capture()
        if (/(Ctrl|\/help|❯|›|deepseek)/iu.test(screen)) break
        if (Date.now() > composerDeadline) throw new Error('TUI composer never appeared')
        await delay(1500)
      }
      const message = [
        `Call the Agent tool exactly once: subagent_type general-purpose, name "sleeper", run_in_background false,`,
        `prompt: "Run the bash command \`sleep 90\`. When it finishes, write the file ${cPath} containing ${STOP_TAG}`,
        `using bash, then reply done." Do not run bash yourself.`,
      ].join(' ')
      await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, '-l', message])
      await delay(500)
      await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, 'Enter'])
      // Wait until the child's sleep is really running (its durable log shows
      // the bash call), then interrupt the parent turn with Esc.
      const runningDeadline = Date.now() + 240_000
      let childRunning = false
      for (;;) {
        const sessions = await loadSessions(STOP_TAG)
        const child = sessions.find(s => s.isChild && s.toolCalls.some(c => c.data?.name === 'bash'))
        if (child !== undefined) { childRunning = true; break }
        if (Date.now() > runningDeadline) break
        await delay(2000)
      }
      if (!childRunning) {
        problems.push('the child never started its sleep — nothing to stop')
      } else {
        // Esc is delivered by tmux, and the TUI can eat one keypress (an
        // autocomplete or overlay steals focus). The DURABLE parent log is
        // the authority on whether the interrupt took: retry Esc until the
        // parent's turn really ends with an aborted/user reason.
        const parentAborted = async () => {
          const sessions = await loadSessions(STOP_TAG)
          const parent = sessions.find(s => !s.isChild)
          return parent?.events.some(e =>
            e.type === 'turn/end' && JSON.stringify(e.data?.reason ?? {}).includes('aborted')) === true
        }
        for (let attempt = 0; attempt < 8 && interruptedAt === 0; attempt += 1) {
          await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, 'Escape'])
          await delay(3000)
          if (await parentAborted()) interruptedAt = Date.now()
        }
        if (interruptedAt === 0) {
          problems.push('the parent turn never recorded an aborted turn/end — the interrupt did not reach the TUI (harness)')
        } else {
          log('scenario stop: parent turn durably aborted — waiting out the sleep window …')
          // The sleep would finish ~90s after it started. Wait until well
          // past that from the moment of interruption, then check the file.
          await delay(130_000)
          if (existsSync(cPath)) {
            problems.push('the stopped child still wrote its output file — the stop did not take')
          }
          // Durable record of how the child's turn ended (aborted = stopped).
          const sessions = await loadSessions(STOP_TAG)
          const child = sessions.find(s => s.isChild)
          scenarios.stopChildTurnEnds = child?.events
            .filter(e => e.type === 'turn/end')
            .map(e => JSON.stringify(e.data?.reason ?? {})) ?? []
        }
        // The bridge warns loud (console + logger) when Agent.cancel is
        // missing or fails; the pane is where that console line surfaces.
        scenarios.stopPaneTail = (await capture().catch(() => '')).slice(-2000)
        // Secondary (non-gating) evidence: what the package's manager shows.
        await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, '-l', '/pi-agents']).catch(() => {})
        await delay(500)
        await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, 'Enter']).catch(() => {})
        await delay(4000)
        scenarios.stopManagerScreen = (await capture().catch(() => '')).slice(-1500)
      }
    } finally {
      await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
    }
    scenarios.stop = {
      status: problems.length === 0 ? 'passed' : 'failed',
      problems,
      tuiVersion,
      interrupted: interruptedAt > 0,
      outputFileAbsentAfterWindow: !existsSync(cPath),
    }
    log(`scenario stop: ${scenarios.stop.status}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}`)
  }

  const failed = Object.values(scenarios).filter(s => s?.status === 'failed').length
  scenarios.stack = { cliVersion, engineVersion, scratch: root }
  await record(failed === 0 ? 'passed' : 'failed')
  log(`${failed === 0 ? 'PASSED' : `FAILED (${failed} scenario(s))`} — evidence in ${outPath}`)
  process.exit(failed === 0 ? 0 : 1)
} catch (error) {
  scenarios.harness = { status: 'failed', error: String((error && error.message) || error) }
  await record('failed')
  log(`FAILED: ${String((error && error.message) || error)}`)
  process.exit(1)
}
