#!/usr/bin/env node
// Real-machine proof that a @tintinweb/pi-subagents child agent EXECUTES
// TOOLS — the P0 the first acceptance run found missing (child requests
// carried no tools; models wrote "bash runs" as plain text). Stock stack:
//
//   - CLI:      @deepseek-ai/dsh@0.1.1-rc.2 (npm, stock)
//   - Engine:   this working tree (or PI2DSH_ENGINE_SPEC)
//   - Plugin:   @tintinweb/pi-subagents (npm, stock)
//   - Model:    real DeepSeek (parent AND child turns)
//
// What must be true only if child tools work:
//   1. The parent's real model turn calls the package's Agent tool.
//   2. The CHILD session's own request carries a non-empty tools list
//      (read off the durable request/header event, not the screen).
//   3. The child's log carries a real bash tool/call + non-error tool/result.
//   4. The marker file the child was told to write EXISTS on disk with the
//      expected content — the hardest evidence that bash actually ran.
//
//   node scripts/verify-subagents-e2e.mjs [community/subagents-e2e.json]

import { execFile as execFileCallback } from 'node:child_process'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outPath = resolve(process.argv[2] ?? 'community/subagents-e2e.json')

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const SUBAGENTS_SPEC = process.env.PI2DSH_SUBAGENTS_SPEC ?? '@tintinweb/pi-subagents@0.18.0'
const RUN_TAG = Date.now().toString(36).toUpperCase()
const MARKER = `PI2DSH_SUBAGENT_TOOLS_${RUN_TAG}`

const log = message => console.log(`[subagents-e2e] ${message}`)

const startedAt = new Date().toISOString()
const record = async (status, extra) => {
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    startedAt,
    scenario: 'pi-subagents-child-tools',
    cliSpec: DSH_CLI_SPEC,
    engineSpec: ENGINE_SPEC,
    subagentsSpec: SUBAGENTS_SPEC,
    status,
    ...extra,
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
  await record('skipped', { reason: 'no DeepSeek credential; without a real model no child turn can run' })
  process.exit(0)
}

const root = process.env.PI2DSH_SUBAGENTS_E2E_ROOT ?? await mkdtemp('/tmp/pi2dsh-subagents-e2e.')
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

try {
  // ---- 1. stock CLI ------------------------------------------------------
  const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh')
  if (!existsSync(join(cliDir, 'package.json'))) {
    await mkdir(cliDir, { recursive: true })
    await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
      name: 'pi2dsh-subagents-e2e-cli',
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

  // ---- 2. headless profile: engine + pi-subagents ------------------------
  const profileRoot = join(home, 'profiles', 'headless')
  if (!existsSync(join(profileRoot, 'node_modules', 'pi2dsh'))) {
    log(`installing profile: engine + ${SUBAGENTS_SPEC} …`)
    await execFile(dshBin, ['plugin', '--profile', 'headless', 'add', ENGINE_SPEC, SUBAGENTS_SPEC], {
      env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
    })
  }
  const engineVersion = JSON.parse(await readFile(join(profileRoot, 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version
  await writeFile(join(profileRoot, 'cordis.patch.yml'), [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'))
  log(`stock proof: cli ${cliVersion}, engine ${engineVersion}`)

  // ---- 3. one real headless turn: delegate a bash task to a child --------
  const markerPath = join(workDir, 'marker.txt')
  const prompt = [
    `Use the Agent tool exactly once to launch a general-purpose subagent with this task: run the bash command`,
    `\`echo ${MARKER} > ${markerPath}\` and then report the file content.`,
    `Wait for the agent to finish, then reply with its report only.`,
  ].join(' ')
  log('running the headless turn (parent + child on real DeepSeek) …')
  const child = spawn(dshBin, ['--profile', 'headless', prompt], {
    cwd: workDir, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  const deadline = Date.now() + 420_000
  while (child.exitCode === null && Date.now() < deadline) {
    if (existsSync(markerPath)) break
    await delay(2000)
  }
  // The marker may exist while the parent still summarises; give it a moment,
  // then stop the process either way — every assertion below reads durable
  // logs and the filesystem, not the process.
  for (let settle = 0; settle < 60 && child.exitCode === null; settle += 1) await delay(2000)
  if (child.exitCode === null) child.kill('SIGTERM')

  // ---- 4. evidence -------------------------------------------------------
  const markerLanded = existsSync(markerPath) && readFileSync(markerPath, 'utf8').includes(MARKER)

  const files = await sessionFiles(join(home, 'sessions'))
  let parent
  let childSession
  for (const file of files) {
    const events = parseLines(await readFile(file, 'utf8'))
    const header = events.find(event => event.type === 'session/created' || event.type === 'session/meta')
    const isChild = events.some(event => event.type === 'subagent/descriptor')
      || JSON.stringify(header ?? {}).includes('"subagent"')
    const summary = {
      file,
      toolCalls: events.filter(event => event.type === 'tool/call').map(event => event.data?.name),
      toolResults: events.filter(event => event.type === 'tool/result' || event.type === 'tools/result'),
      requestTools: events
        .filter(event => event.type === 'request/header')
        .map(event => (Array.isArray(event.data?.header?.tools) ? event.data.header.tools.length
          : Array.isArray(event.data?.tools) ? event.data.tools.length : 0)),
      hasMarker: JSON.stringify(events).includes(MARKER),
    }
    if (isChild && summary.hasMarker) childSession = summary
    if (!isChild && summary.toolCalls.includes('Agent')) parent = summary
  }

  const problems = []
  if (parent === undefined) problems.push('no parent session with a real Agent tool/call')
  if (childSession === undefined) problems.push('no child session (subagent/descriptor) carrying the task marker')
  if (childSession !== undefined) {
    if (!childSession.toolCalls.includes('bash')) {
      problems.push(`child made no bash tool/call (calls: ${childSession.toolCalls.join(', ') || 'none'})`)
    }
    if (!childSession.requestTools.some(count => count > 0)) {
      problems.push('child request/header carried no tools — the P0 this run exists to disprove')
    }
    const errored = childSession.toolResults.filter(event => JSON.stringify(event).includes('"isError":true'))
    if (errored.length > 0) problems.push(`${errored.length} child tool result(s) errored`)
  }
  if (!markerLanded) problems.push(`the marker file was not written by the child's bash (${markerPath})`)

  if (problems.length > 0) {
    await record('failed', {
      problems,
      parent: parent ?? null,
      child: childSession ?? null,
      outputTail: output.slice(-1200),
      scratch: root,
    })
    log(`FAILED: ${problems.join('; ')}`)
    process.exit(1)
  }

  // ---- 5. dsh-TUI surface: the /agents collision alias -------------------
  // dsh-TUI ≥0.9 reserves /agents locally, so the package's manager must be
  // reachable as /pi-agents there. The readiness signal is the package's OWN
  // menu ("Agent types (N)" is its select prompt; the TUI-local /agents view
  // has no such line).
  const TMUX_SESSION = 'pi2dsh-subagents-e2e-tui'
  let tui = { status: 'skipped', reason: 'PI2DSH_SKIP_TUI set' }
  if (process.env.PI2DSH_SKIP_TUI === undefined) {
    const TUI_SPEC = process.env.PI2DSH_TUI_SPEC ?? '@deepseek-harness-tui/dsh-tui'
    const tuiProfile = join(home, 'profiles', 'tui')
    if (!existsSync(join(tuiProfile, 'node_modules', 'pi2dsh'))) {
      log(`installing TUI profile: ${TUI_SPEC} + engine + ${SUBAGENTS_SPEC} …`)
      await execFile(dshBin, ['plugin', '--profile', 'tui', 'add', '-w', TUI_SPEC, ENGINE_SPEC, SUBAGENTS_SPEC], {
        env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
      })
    }
    // Same session encoding as the headless profile: both share one home,
    // and the zstd default refuses the .jsonl artifacts headless wrote.
    await writeFile(join(tuiProfile, 'cordis.patch.yml'), [
      '- id: session-persistence-jsonl',
      '  config:',
      "    root: !!js dshHomePath('sessions')",
      '    compression: none',
      '',
    ].join('\n'))
    const tuiVersion = JSON.parse(await readFile(
      join(tuiProfile, 'node_modules', '@deepseek-harness-tui', 'dsh-tui', 'package.json'), 'utf8')).version
    await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
    const launcher = join(root, 'launch-tui.sh')
    await writeFile(launcher, `#!/bin/sh\nexec "${dshBin}" --profile tui\n`)
    await chmod(launcher, 0o755)
    log(`booting the stock TUI ${tuiVersion} in tmux …`)
    await execFile('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-x', '180', '-y', '50', '-c', workDir,
      'env', `DSH_HOME=${home}`, `DEEPSEEK_API_KEY=${apiKey}`, 'NO_COLOR=1', launcher,
    ], { timeout: 30_000 })
    const capture = async () => {
      const { stdout } = await execFile('tmux', ['capture-pane', '-p', '-t', TMUX_SESSION, '-S', '-200'], { timeout: 15_000 })
      return stdout
    }
    try {
      const composerDeadline = Date.now() + 120_000
      for (;;) {
        const screen = await capture()
        if (/(Ctrl|\/help|❯|›|deepseek)/iu.test(screen)) break
        if (Date.now() > composerDeadline) throw new Error('TUI composer never appeared')
        await delay(1500)
      }
      await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, '-l', '/pi-agents'])
      await delay(500)
      await execFile('tmux', ['send-keys', '-t', TMUX_SESSION, 'Enter'])
      const menuDeadline = Date.now() + 60_000
      for (;;) {
        const screen = await capture()
        if (/Agent types \(\d+\)/u.test(screen)) break
        if (Date.now() > menuDeadline) {
          throw new Error(`/pi-agents never opened the package menu:\n${(await capture()).slice(-1200)}`)
        }
        await delay(1500)
      }
      tui = { status: 'passed', tuiVersion, aliasedCommand: '/pi-agents', menuSignal: 'Agent types (N)' }
      log(`tui: /pi-agents opened the package's agents menu on dsh-tui ${tuiVersion}`)
    } finally {
      await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
    }
  }

  await record('passed', {
    cliVersion,
    engineVersion,
    parentAgentToolCalls: parent.toolCalls.filter(name => name === 'Agent').length,
    childToolCalls: childSession.toolCalls,
    childRequestToolCounts: childSession.requestTools,
    markerLanded,
    tui,
    scratch: root,
  })
  log(`PASSED — child ran ${childSession.toolCalls.length} tool call(s), marker on disk; evidence in ${outPath}`)
} catch (error) {
  await record('failed', { error: String((error && error.message) || error), scratch: root })
  log(`FAILED: ${String((error && error.message) || error)}`)
  process.exit(1)
}
