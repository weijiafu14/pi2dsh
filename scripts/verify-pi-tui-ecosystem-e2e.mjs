#!/usr/bin/env node
// Published-package E2E for the dsh-pi-tui ecosystem composition:
//
//   @xmoon76/dsh-pi-tui + pi2dsh + pi-mcp-adapter + @tintinweb/pi-subagents
//
// The proof uses one real DSH TUI process and demands product-level facts:
// native /login sees projected Pi OAuth, the original MCP manager renders and
// connects, a real model calls an MCP tool, /agents renders, and a real model
// creates a child through the original Agent tool. No package is patched.

import { execFile as execFileCallback, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const resultPath = resolve(process.argv[2] ?? 'community/pi-tui-ecosystem-e2e.json')
const DSH_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
const TUI_SPEC = process.env.PI2DSH_PI_TUI_SPEC ?? '@xmoon76/dsh-pi-tui@0.3.4'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const MCP_SPEC = process.env.PI2DSH_MCP_ADAPTER_SPEC ?? 'pi-mcp-adapter@2.27.0'
const SUBAGENTS_SPEC = process.env.PI2DSH_SUBAGENTS_SPEC ?? '@tintinweb/pi-subagents@0.18.0'
const EVERYTHING_SPEC = '@modelcontextprotocol/server-everything@2026.8.18'
const runTag = Date.now().toString(36).toUpperCase()
const MCP_MARKER = `PI2DSH_PITUI_MCP_${runTag}`
const SUBAGENT_MARKER = `PI2DSH_PITUI_SUBAGENT_${runTag}`
const TMUX = `pi2dsh-pitui-${process.pid}`
const recordedEngineSpec = ENGINE_SPEC.startsWith('/') ? `local:${basename(ENGINE_SPEC)}` : ENGINE_SPEC

const log = message => console.log(`[pi-tui-e2e] ${message}`)

function shell(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function findDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const text = readFileSync(resolve(projectRoot, '..', 'deepseek-harness', '.env'), 'utf8')
    return /^\s*(?:export\s+)?DEEPSEEK_API_KEY=["']?([^"'\s]+)["']?\s*$/mu.exec(text)?.[1]
  } catch {
    return undefined
  }
}

async function tmux(...args) {
  return await execFile('tmux', args, { timeout: 30_000 })
}

async function capture() {
  return (await tmux('capture-pane', '-p', '-t', TMUX, '-S', '-300')).stdout
}

async function sendLine(text, doubleEnter = false) {
  await tmux('send-keys', '-t', TMUX, '-l', text)
  await delay(250)
  await tmux('send-keys', '-t', TMUX, 'Enter')
  if (doubleEnter) {
    await delay(800)
    await tmux('send-keys', '-t', TMUX, 'Enter')
  }
}

async function closeOverlay() {
  // Searchable overlays use the first Esc to clear the query and the second
  // to close; non-search overlays close on the first and ignore the second.
  await tmux('send-keys', '-t', TMUX, 'Escape')
  await delay(250)
  await tmux('send-keys', '-t', TMUX, 'Escape')
  await delay(500)
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

async function walkJsonl(root) {
  const found = []
  const walk = async current => {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.jsonl')) found.push(path)
    }
  }
  await walk(root)
  return found
}

async function successfulToolResult(home, toolName, marker) {
  for (const path of await walkJsonl(join(home, 'sessions'))) {
    const text = await readFile(path, 'utf8')
    if (!text.includes(marker) || !text.includes(toolName)) continue
    for (const line of text.split('\n')) {
      if (!line.includes(marker)) continue
      let record
      try { record = JSON.parse(line) } catch { continue }
      if (record.type !== 'tool/result') continue
      if (record.isError === true || JSON.stringify(record).includes('"isError":true')) {
        throw new Error(`${toolName} result containing ${marker} was an error`)
      }
      return path
    }
  }
  return undefined
}

async function writeResult(status, detail) {
  await mkdir(resolve(resultPath, '..'), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    scenario: 'dsh-pi-tui + pi2dsh + Pi MCP + Pi Subagents',
    specs: { dsh: DSH_SPEC, tui: TUI_SPEC, engine: recordedEngineSpec, mcp: MCP_SPEC, subagents: SUBAGENTS_SPEC },
    status,
    ...detail,
  }, null, 2)}\n`)
}

const apiKey = findDeepSeekKey()
if (apiKey === undefined) {
  await writeResult('skipped', { reason: 'DEEPSEEK_API_KEY unavailable; UI-only mounting is not the claimed E2E' })
  log('SKIPPED: no DeepSeek credential')
  process.exit(0)
}

const root = process.env.PI2DSH_PI_TUI_E2E_ROOT ?? await mkdtemp('/tmp/pi2dsh-pi-tui-e2e.')
const home = join(root, 'dsh-home')
const cliRoot = join(root, 'cli')
const piAgentDir = join(root, 'pi-agent')
const shimDir = join(root, 'bin')
const baseEnv = {
  ...process.env,
  DSH_HOME: home,
  DEEPSEEK_API_KEY: apiKey,
  PI_CODING_AGENT_DIR: piAgentDir,
  PATH: `${shimDir}:${process.env.PATH ?? ''}`,
  CI: '1',
  NO_COLOR: '1',
  DSH_TELEMETRY_DISABLED: '1',
  PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
  npm_config_registry: 'https://registry.npmjs.org',
}

try {
  await mkdir(shimDir, { recursive: true })
  await writeFile(join(shimDir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(join(shimDir, 'pnpm'), 0o755)
  await mkdir(cliRoot, { recursive: true })
  const at = DSH_SPEC.lastIndexOf('@')
  await writeFile(join(cliRoot, 'package.json'), `${JSON.stringify({
    name: 'pi2dsh-pi-tui-e2e-cli', private: true,
    dependencies: { [DSH_SPEC.slice(0, at)]: DSH_SPEC.slice(at + 1) },
  }, null, 2)}\n`)
  await writeFile(join(cliRoot, 'pnpm-workspace.yaml'), [
    'minimumReleaseAge: 0',
    'allowBuilds:',
    "  '@deepseek-ai/dsh-subprocess-local': true",
    '  node-pty: true',
    '  koffi: true',
    "  '@google/genai': false",
    '  protobufjs: false',
    '',
  ].join('\n'))
  log(`installing ${DSH_SPEC}`)
  await execFile('corepack', ['pnpm@11.7.0', 'install'], { cwd: cliRoot, env: baseEnv, timeout: 300_000 })
  const dsh = join(cliRoot, 'node_modules', '.bin', 'dsh')

  log('installing stock four-package profile')
  await execFile(dsh, ['plugin', '--profile', 'pi-tui', 'add', '-w', TUI_SPEC, ENGINE_SPEC, MCP_SPEC, SUBAGENTS_SPEC], {
    env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
  })
  const profileRoot = join(home, 'profiles', 'pi-tui')
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
      everything: { enabled: true, command: 'npx', args: ['-y', EVERYTHING_SPEC], directTools: true },
    },
  }, null, 2)}\n`)

  const versions = {
    dsh: JSON.parse(await readFile(join(cliRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version,
    tui: JSON.parse(await readFile(join(profileRoot, 'node_modules', '@xmoon76', 'dsh-pi-tui', 'package.json'), 'utf8')).version,
    engine: JSON.parse(await readFile(join(profileRoot, 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version,
    mcp: JSON.parse(await readFile(join(profileRoot, 'node_modules', 'pi-mcp-adapter', 'package.json'), 'utf8')).version,
    subagents: JSON.parse(await readFile(join(profileRoot, 'node_modules', '@tintinweb', 'pi-subagents', 'package.json'), 'utf8')).version,
  }

  await tmux('kill-session', '-t', TMUX).catch(() => {})
  await tmux('new-session', '-d', '-s', TMUX, '-x', '180', '-y', '50', '-c', root,
    'env', `DSH_HOME=${home}`, `PI_CODING_AGENT_DIR=${piAgentDir}`, `DEEPSEEK_API_KEY=${apiKey}`,
    'NO_COLOR=1', dsh, '--profile', 'pi-tui')
  await waitFor('dsh-pi-tui composer', async () => /dsh-pi-tui[\s\S]*❯/u.test(await capture()), 120_000)

  log('native /login + projected OpenAI Codex flow')
  await sendLine('/login')
  await waitFor('native login provider list', async () => /login · providers/u.test(await capture()), 30_000)
  await tmux('send-keys', '-t', TMUX, '-l', 'openai codex')
  const loginScreen = await waitFor('OpenAI Codex in native login', async () => {
    const screen = await capture()
    return /OpenAI Codex — sign in/u.test(screen) ? screen : undefined
  }, 30_000)
  await closeOverlay()

  log('original MCP manager + everything 23/23')
  await sendLine('/pi-mcp')
  const mcpManager = await waitFor('everything MCP manager readiness', async () => {
    const screen = await capture()
    return /everything\s+23\/23/u.test(screen) ? screen : undefined
  }, 180_000, 2500)
  await closeOverlay()

  log('original Pi Agents interactive surface')
  await sendLine('/agents')
  const agentsScreen = await waitFor('/agents interactive surface', async () => {
    const screen = await capture()
    return /Agents[\s\S]*Agent types \(3\)[\s\S]*Create new agent/u.test(screen) ? screen : undefined
  }, 30_000)
  await closeOverlay()

  log('real Pi subagent tool round')
  await sendLine(`Use the Agent tool exactly once to ask a general-purpose subagent: Return exactly ${SUBAGENT_MARKER}. Then reply with the child answer only.`, true)
  await waitFor('subagent final answer', async () => {
    const screen = await capture()
    // The TUI intentionally truncates long tool summaries to the terminal
    // width, so assert the semantic card state rather than its trailing copy.
    return /Tool call Agent[^\n]*\[ok\]/u.test(screen) && screen.includes(SUBAGENT_MARKER) ? screen : undefined
  }, 180_000, 2000)
  const subagentLog = await waitFor('durable successful Agent tool result', () => successfulToolResult(home, 'Agent', SUBAGENT_MARKER), 60_000)

  log('real MCP direct-tool round')
  await sendLine(`Use the everything_echo MCP tool exactly once with message ${MCP_MARKER}. Then reply with the echoed text only.`, true)
  await waitFor('MCP final answer', async () => {
    const screen = await capture()
    return screen.includes('Tool call everything_echo') && screen.includes(MCP_MARKER) ? screen : undefined
  }, 180_000, 2000)
  const mcpLog = await waitFor('durable successful MCP tool result', () => successfulToolResult(home, 'everything_echo', MCP_MARKER), 60_000)

  const logFiles = await readdir(join(home, 'logs'))
  const bootLogs = await Promise.all(logFiles.filter(name => name.endsWith('.log')).map(name => readFile(join(home, 'logs', name), 'utf8')))
  const badLog = bootLogs.find(text => /command registration failed|already registered/u.test(text))
  if (badLog !== undefined) throw new Error('duplicate command registration remained in dsh-pi-tui boot log')

  await writeResult('passed', {
    versions,
    assertions: {
      nativeLogin: /OpenAI Codex — sign in/u.test(loginScreen),
      mcpManager: /everything\s+23\/23/u.test(mcpManager),
      agentsSurface: /Agent types \(3\)/u.test(agentsScreen),
      subagentToolResult: relative(home, subagentLog),
      mcpToolResult: relative(home, mcpLog),
      duplicateCommandErrors: 0,
    },
  })
  log(`PASS → ${resultPath}`)
  await tmux('kill-session', '-t', TMUX).catch(() => {})
} catch (error) {
  const screen = await capture().catch(() => '(no screen)')
  await writeResult('failed', {
    error: error instanceof Error ? error.message : String(error),
    lastScreen: screen.split('\n').slice(-60).join('\n'),
    scratch: root,
  })
  log(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  log(`scratch kept: ${root}; tmux session: ${TMUX}`)
  process.exitCode = 1
}
