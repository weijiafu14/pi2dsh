#!/usr/bin/env node
// Real-machine proof of the single-path per-Agent architecture, on the exact
// stack a user installs — no forks anywhere:
//
//   - CLI:      @deepseek-ai/dsh@0.1.0-rc.8            (npm, stock)
//   - Surface:  @deepseek-harness-tui/dsh-tui           (npm, stock — no
//               tui/agent-setup seam; the engine must not need one)
//   - Engine:   this working tree (or PI2DSH_ENGINE_SPEC)
//   - Plugin:   pi-mcp-adapter (npm, stock)
//   - Model:    real DeepSeek (DEEPSEEK_API_KEY; inheritable from a live
//               tmux pane's environment, never echoed, never written)
//
// What must be true only if the architecture works:
//   1. Agent A's /pi-mcp manager scene lists the everything server fully
//      connected (its Pi runtime mounted per agent, scenes included).
//   2. A real model turn in Agent A calls everything_echo and the SESSION LOG
//      carries the non-error tool result with marker A (screen text is never
//      the assertion).
//   3. /new creates Agent B: a FRESH mount (manager scene shows the server
//      again), marker B lands in B's session log, and B's marker is absent
//      from A's log — per-agent isolation, not a shared singleton.
//
// Skipped (with the reason recorded) when no DeepSeek credential can be
// found, per the examples-verification standard: a run without the README's
// prerequisites tests something else.
//
//   node scripts/verify-tui-singlepath-e2e.mjs [community/tui-singlepath-e2e.json]

import { execFile as execFileCallback, execSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outPath = resolve(process.argv[2] ?? 'community/tui-singlepath-e2e.json')

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.0-rc.8'
const TUI_SPEC = process.env.PI2DSH_TUI_SPEC ?? '@deepseek-harness-tui/dsh-tui'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const MCP_ADAPTER_SPEC = process.env.PI2DSH_MCP_ADAPTER_SPEC ?? 'pi-mcp-adapter@2.27.0'
const EVERYTHING_PACKAGE = '@modelcontextprotocol/server-everything@2026.8.18'
const TMUX_SESSION = 'pi2dsh-singlepath-e2e'
// Unique per run: a reused scratch (PI2DSH_E2E_ROOT) keeps earlier session
// logs, and a stale marker from a previous run must never satisfy this one.
const RUN_TAG = `${Date.now().toString(36)}`.toUpperCase()
const MARKER_A = `PI2DSH_SINGLEPATH_A_${RUN_TAG}`
const MARKER_B = `PI2DSH_SINGLEPATH_B_${RUN_TAG}`

const log = message => console.log(`[singlepath-e2e] ${message}`)

function sh(command, options = {}) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

/** Find a DeepSeek key: own env first, else inherit from a live process env (never printed). */
function findDeepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const out = sh('ps axeww 2>/dev/null | grep -o "DEEPSEEK_API_KEY=[^ ]*" | sort -u')
    for (const line of out.split('\n')) {
      const match = /^DEEPSEEK_API_KEY=(.+)$/u.exec(line.trim())
      if (match && match[1].length > 10) return match[1]
    }
  } catch { /* fall through to skipped */ }
  return undefined
}

function tmux(args) {
  return execFile('tmux', args, { timeout: 30_000 })
}

async function capture() {
  const { stdout } = await execFile('tmux', ['capture-pane', '-p', '-t', TMUX_SESSION, '-S', '-200'], { timeout: 15_000 })
  return stdout
}

async function sendLine(text) {
  await tmux(['send-keys', '-t', TMUX_SESSION, '-l', text])
  await delay(300)
  await tmux(['send-keys', '-t', TMUX_SESSION, 'Enter'])
}

async function waitFor(description, predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await predicate()
    if (result !== undefined && result !== false) return result
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await delay(intervalMs)
  }
}

/** Session logs live at sessions/<flattened-cwd>/<session-id>/session.jsonl. */
async function sessionFiles(home) {
  const dir = join(home, 'sessions')
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

/**
 * The session-log tool-result proof: a `tool/result` event carrying the
 * marker and no error flag. The user prompt and the model's reply also carry
 * the marker text and must never satisfy this.
 */
async function markerToolResult(file, marker) {
  const text = await readFile(file, 'utf8')
  if (!text.includes(marker)) return undefined
  for (const line of text.split('\n')) {
    if (!line.includes(marker)) continue
    let record
    try { record = JSON.parse(line) } catch { continue }
    if (record.type !== 'tool/result') continue
    const flat = JSON.stringify(record)
    if (/"isError"\s*:\s*true/u.test(flat)) throw new Error(`tool result for ${marker} in ${file} is an error: ${flat.slice(0, 400)}`)
    return record
  }
  return undefined
}

const startedAt = new Date().toISOString()
const record = async (status, extra) => {
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    startedAt,
    scenario: 'stock-tui-single-path-per-agent',
    cliSpec: DSH_CLI_SPEC,
    tuiSpec: TUI_SPEC,
    engineSpec: ENGINE_SPEC,
    mcpAdapterSpec: MCP_ADAPTER_SPEC,
    status,
    ...extra,
  }, null, 2)}\n`)
}

const apiKey = findDeepseekKey()
if (apiKey === undefined) {
  log('SKIPPED: no DEEPSEEK_API_KEY in this environment or any live process')
  await record('skipped', { reason: 'no DeepSeek credential available; a run without the real model would not prove the tool chain' })
  process.exit(0)
}

const root = process.env.PI2DSH_E2E_ROOT ?? await mkdtemp('/tmp/pi2dsh-singlepath-e2e.')
const home = join(root, 'dsh-home')
const cliDir = join(root, 'cli')
const piAgentDir = join(root, 'pi-agent')
log(`scratch: ${root}`)

// `dsh plugin` shells out to the pnpm on PATH; profiles are initialized by
// pnpm@11 and a different major fakes a failure (the documented store-version
// trap) — pin the PATH to a pnpm@11 shim exactly like the examples harness.
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

try {
  // ---- 1. stock CLI from npm --------------------------------------------
  const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh')
  const cliReady = await readFile(join(cliDir, 'package.json'), 'utf8').then(() => true, () => false)
  if (!cliReady) {
    await mkdir(cliDir, { recursive: true })
    await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
      name: 'pi2dsh-singlepath-e2e-cli',
      private: true,
      dependencies: { [DSH_CLI_SPEC.slice(0, DSH_CLI_SPEC.lastIndexOf('@'))]: DSH_CLI_SPEC.slice(DSH_CLI_SPEC.lastIndexOf('@') + 1) },
    }, null, 2)}\n`)
    // Harness properties, not product ones: a fresh release would otherwise be
    // held back by pnpm 11's minimumReleaseAge (the documented regression
    // trap), and the CLI's platform helpers (pty, subprocess spawn helper,
    // ffi) need their build scripts — exactly what `pnpm approve-builds`
    // would interactively allow.
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

  // ---- 2. profile: stock TUI + engine + adapter -------------------------
  const profileRoot = join(home, 'profiles', 'tui')
  const profileReady = await readdir(join(profileRoot, 'node_modules', '@deepseek-ai')).then(entries => entries.length > 3, () => false)
  if (!profileReady) {
    log(`installing profile: ${TUI_SPEC} + engine + ${MCP_ADAPTER_SPEC} …`)
    await execFile(dshBin, ['plugin', '--profile', 'tui', 'add', '-w', TUI_SPEC, ENGINE_SPEC, MCP_ADAPTER_SPEC], {
      env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
    })
  }

  // The stock proof, recorded with the run: the DSH core executing this run
  // comes from the pinned npm CLI (@deepseek-ai/dsh@rc.8 carries exact rc.8
  // core dependencies) and its dsh-agent knows NOTHING of the abandoned
  // agent/setup contributor seam; the installed TUI manifest advertises no
  // agentSetupEvent. The profile itself carries surfaces and plugins only —
  // if it resolved its own core copy (npm `latest` is still the rc.6 line),
  // that copy could shadow the CLI's rc.8 core, so its absence is asserted
  // too. This run can only pass on official stock seams.
  const agentPkgPath = sh(`find ${JSON.stringify(join(cliDir, 'node_modules'))} -path '*/node_modules/@deepseek-ai/dsh-agent/package.json' -print | head -n 1`).trim()
  if (agentPkgPath === '') throw new Error('the CLI install did not resolve @deepseek-ai/dsh-agent')
  const agentVersion = JSON.parse(await readFile(agentPkgPath, 'utf8')).version
  if (agentVersion !== '0.1.0-rc.8') throw new Error(`the CLI resolved dsh-agent@${agentVersion}, expected stock 0.1.0-rc.8`)
  const profileCore = sh(`find ${JSON.stringify(join(profileRoot, 'node_modules'))} -maxdepth 4 -path '*/@deepseek-ai/dsh-agent' -print 2>/dev/null | head -n 1`).trim()
  if (profileCore !== '') throw new Error(`the profile resolved its own core copy at ${profileCore} — it would shadow the CLI's rc.8 core`)
  const agentLib = await readFile(join(agentPkgPath, '..', 'lib', 'index.js'), 'utf8')
  if (agentLib.includes("'agent/setup'") || agentLib.includes('"agent/setup"')) {
    throw new Error('the installed dsh-agent carries an agent/setup seam — this is NOT the stock core')
  }
  const tuiManifest = JSON.parse(await readFile(join(profileRoot, 'node_modules', '@deepseek-harness-tui', 'dsh-tui', 'package.json'), 'utf8'))
  if (tuiManifest.dshTui?.agentSetupEvent !== undefined) {
    throw new Error('the installed dsh-TUI advertises an agentSetupEvent — this is NOT the stock surface')
  }
  const engineVersion = JSON.parse(await readFile(join(profileRoot, 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version
  log(`stock proof: dsh-agent@${agentVersion} (no agent/setup), dsh-tui@${tuiManifest.version} (no seam), engine ${engineVersion}, cli ${cliVersion}`)

  // ---- 3. session logs + MCP config -------------------------------------
  await writeFile(join(profileRoot, 'cordis.patch.yml'), [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'))
  await mkdir(piAgentDir, { recursive: true })
  await writeFile(join(piAgentDir, 'mcp.json'), `${JSON.stringify({
    mcpServers: {
      everything: { enabled: true, command: 'npx', args: ['-y', EVERYTHING_PACKAGE], directTools: true },
    },
  }, null, 2)}\n`)

  // ---- 4. launch the real TUI in tmux ------------------------------------
  await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
  const launcher = join(root, 'launch-tui.sh')
  // The credential reaches the TUI through the environment of this launcher
  // process only; the script file itself never contains it.
  await writeFile(launcher, `#!/bin/sh\nexec "${dshBin}" --profile tui\n`)
  await chmod(launcher, 0o755)
  await execFile('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-x', '180', '-y', '50', '-c', root,
    'env',
    `DSH_HOME=${home}`,
    `PI_CODING_AGENT_DIR=${piAgentDir}`,
    `DEEPSEEK_API_KEY=${apiKey}`,
    'NO_COLOR=1',
    launcher,
  ], { timeout: 30_000 })

  log('waiting for the TUI composer …')
  await waitFor('TUI startup', async () => {
    const screen = await capture()
    if (/error|Error:|failed/u.test(screen) && !/\bcomposer|›|❯|>/u.test(screen)) {
      // keep polling; startup logs may transiently mention "failed"
    }
    return /(Ctrl|\/help|❯|›|deepseek)/iu.test(screen) ? screen : undefined
  }, 120_000)

  // MCP mounting is lazy per agent; the everything server (an npx download on
  // first run) can take a while. The manager scene is the readiness signal.
  log('opening /pi-mcp for Agent A …')
  const managerA = await waitFor('Agent A /pi-mcp manager listing the everything server', async () => {
    await tmux(['send-keys', '-t', TMUX_SESSION, 'Escape']).catch(() => {})
    await delay(300)
    await sendLine('/pi-mcp')
    await delay(2500)
    const screen = await capture()
    const match = /everything[\s\S]{0,200}?(\d+)\s*\/\s*(\d+)/u.exec(screen)
    if (match !== null && Number(match[1]) > 0 && match[1] === match[2]) return { screen, tools: Number(match[1]) }
    if (/everything[\s\S]{0,120}?connected/iu.test(screen)) return { screen, tools: -1 }
    return undefined
  }, 180_000, 4000)
  log(`Agent A manager scene: everything ${managerA.tools > 0 ? `${managerA.tools}/${managerA.tools}` : 'connected'}`)
  await tmux(['send-keys', '-t', TMUX_SESSION, 'Escape'])
  await delay(500)

  // ---- 5. Agent A: real model turn, session-log proof ---------------------
  const filesBefore = await sessionFiles(home)
  log('Agent A: real DeepSeek turn calling everything_echo …')
  await sendLine(`Use the everything_echo tool exactly once with message ${MARKER_A}. Then reply with the echoed text only.`)
  const sessionA = await waitFor(`marker ${MARKER_A} tool result in a session log`, async () => {
    for (const file of await sessionFiles(home)) {
      if (await markerToolResult(file, MARKER_A) !== undefined) return file
    }
    return undefined
  }, 180_000, 3000)
  log(`Agent A tool result proven in ${sessionA}`)

  // ---- 6. /new → Agent B: fresh mount, isolation --------------------------
  // Typing into a TUI is not a transaction: a suggestion popup or a scene can
  // swallow the line, and every later assertion would then silently run
  // against Agent A. The proof that /new took effect is a NEW session
  // directory (persistence starts at agent creation), so demand it, retrying
  // the keystrokes until it exists.
  log('/new → Agent B …')
  const sessionsBefore = new Set(await sessionFiles(home))
  await waitFor('a new session after /new', async () => {
    await tmux(['send-keys', '-t', TMUX_SESSION, 'Escape']).catch(() => {})
    await delay(500)
    await sendLine('/new')
    await delay(4000)
    for (const file of await sessionFiles(home)) {
      if (!sessionsBefore.has(file)) return file
    }
    return undefined
  }, 60_000, 1000)

  const managerB = await waitFor('Agent B /pi-mcp manager listing the everything server', async () => {
    await tmux(['send-keys', '-t', TMUX_SESSION, 'Escape']).catch(() => {})
    await delay(300)
    await sendLine('/pi-mcp')
    await delay(2500)
    const screen = await capture()
    const match = /everything[\s\S]{0,200}?(\d+)\s*\/\s*(\d+)/u.exec(screen)
    if (match !== null && Number(match[1]) > 0 && match[1] === match[2]) return { screen, tools: Number(match[1]) }
    return undefined
  }, 120_000, 4000)
  log(`Agent B manager scene: everything ${managerB.tools}/${managerB.tools} — fresh per-agent mount`)
  await tmux(['send-keys', '-t', TMUX_SESSION, 'Escape'])
  await delay(500)

  log('Agent B: real DeepSeek turn calling everything_echo …')
  await sendLine(`Use the everything_echo tool exactly once with message ${MARKER_B}. Then reply with the echoed text only.`)
  const sessionB = await waitFor(`marker ${MARKER_B} tool result in a NEW session log`, async () => {
    for (const file of await sessionFiles(home)) {
      if (file === sessionA) continue
      if (await markerToolResult(file, MARKER_B) !== undefined) return file
    }
    return undefined
  }, 180_000, 3000)
  log(`Agent B tool result proven in ${sessionB}`)

  // Isolation: B's marker must not appear in A's log.
  const logA = await readFile(sessionA, 'utf8')
  if (logA.includes(MARKER_B)) throw new Error("Agent B's tool result leaked into Agent A's session log — the runtimes are not isolated")

  await record('passed', {
    cliVersion,
    dshAgentVersion: agentVersion,
    dshAgentHasAgentSetupSeam: false,
    tuiVersion: tuiManifest.version,
    tuiAdvertisesSetupSeam: false,
    engineVersion,
    agentA: { managerTools: managerA.tools, sessionLog: sessionA, marker: MARKER_A },
    agentB: { managerTools: managerB.tools, sessionLog: sessionB, marker: MARKER_B },
    isolation: 'marker B absent from agent A session log',
  })
  log(`PASS → ${outPath}`)
  await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
} catch (error) {
  const screen = await capture().catch(() => '(no tmux capture available)')
  await record('failed', { error: error instanceof Error ? error.message : String(error), lastScreen: screen.split('\n').slice(-40).join('\n'), scratch: root })
  log(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  log(`scratch kept for forensics: ${root}; tmux session ${TMUX_SESSION} left running`)
  process.exitCode = 1
}
