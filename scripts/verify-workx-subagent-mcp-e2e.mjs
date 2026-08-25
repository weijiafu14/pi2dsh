#!/usr/bin/env node
// Product-level integration: the dsh-work-x SUITE serves subagents real MCP.
//
// One `dsh plugin add <dsh-work-x tarball>` installs the engine and its four
// pinned Pi packages. A pi-subagents child spawned inside that product must be
// served pi-mcp-adapter exactly as real Pi serves children their extensions:
// the child calls the adapter's `mcp` tool, which lazy-connects a REAL MCP
// server (@modelcontextprotocol/server-everything over stdio) and echoes a
// canary. No mocks anywhere: stock npm CLI, the staged suite tarball, a real
// model, a real MCP server process.
//
// Falsifiable by construction:
//  - the canary is asserted as the server's OWN echo shape ("Echo: <tag>")
//    inside a durable tool/result of the CHILD session — the spawn prompt
//    contains the bare tag, but only a real server round-trip produces the
//    "Echo: " prefix in a tool result;
//  - the child log must carry an `mcp` tool/call, which cannot exist unless
//    the adapter was really mounted into the child (a model cannot call a
//    tool its registry does not offer);
//  - the parent is forbidden from calling mcp itself, asserted on its log.
//
//   node scripts/verify-workx-subagent-mcp-e2e.mjs [community/workx-subagent-mcp-e2e.json]

import { execFile as execFileCallback } from 'node:child_process'
import { zstdDecompressSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outPath = resolve(process.argv[2] ?? 'community/workx-subagent-mcp-e2e.json')

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const MCP_SERVER_SPEC = '@modelcontextprotocol/server-everything@2026.8.18'
const RUN_TAG = Date.now().toString(36).toUpperCase()

const log = message => console.log(`[workx-subagent-mcp] ${message}`)
const startedAt = new Date().toISOString()
const result = {}
const record = async status => {
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    startedAt,
    scenario: 'dsh-work-x suite: a pi-subagents child uses pi-mcp-adapter against a real MCP server',
    cliSpec: DSH_CLI_SPEC,
    engineSpec: ENGINE_SPEC,
    mcpServer: MCP_SERVER_SPEC,
    status,
    ...result,
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
  result.reason = 'no DeepSeek credential; the turns need a real model'
  await record('skipped')
  process.exit(0)
}

const root = await mkdtemp('/tmp/pi2dsh-workx-mcp.')
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
      else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd')) found.push(path)
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

/**
 * An append-mode zstd log is a CONCATENATION of independent frames (one per
 * flush); Node's zstdDecompressSync stops after the first, so split on the
 * frame magic and decompress each frame separately.
 */
function decompressZstdFrames(buf) {
  const offsets = []
  for (let i = 0; i <= buf.length - 4; i += 1) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
  }
  const parts = []
  for (let k = 0; k < offsets.length; k += 1) {
    const slice = buf.subarray(offsets[k], k + 1 < offsets.length ? offsets[k + 1] : buf.length)
    try {
      parts.push(zstdDecompressSync(slice))
    } catch {
      // A torn tail frame from a live writer is dropped, like a torn jsonl line.
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

async function loadSessions(marker) {
  const out = []
  for (const file of await sessionFiles(join(home, 'sessions'))) {
    // The suite composition persists sessions zstd-compressed — read both forms.
    const raw = file.endsWith('.zstd')
      ? decompressZstdFrames(await readFile(file))
      : await readFile(file, 'utf8')
    if (!raw.includes(marker)) continue
    const events = parseLines(raw)
    out.push({
      file,
      raw,
      events,
      isChild: events.some(event => event.type === 'subagent/descriptor'),
      toolCalls: events.filter(event => event.type === 'tool/call'),
    })
  }
  return out
}

try {
  // ---- 1. stock CLI ------------------------------------------------------
  const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh')
  await mkdir(cliDir, { recursive: true })
  await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
    name: 'pi2dsh-workx-mcp-cli',
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
  const cliVersion = JSON.parse(await readFile(join(cliDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version

  // ---- 2. stage the dsh-work-x suite with THIS engine --------------------
  // Same staging the suite's own web E2E uses: the tarball install is the
  // real product install shape, with the engine dependency pointed at the
  // tree (or release spec) under test.
  const suiteDir = join(root, 'dsh-x')
  await mkdir(suiteDir, { recursive: true })
  const manifest = JSON.parse(await readFile(join(projectRoot, 'dsh-x/package.json'), 'utf8'))
  manifest.dependencies.pi2dsh = ENGINE_SPEC.startsWith('pi2dsh@') ? ENGINE_SPEC.slice('pi2dsh@'.length) : ENGINE_SPEC
  await writeFile(join(suiteDir, 'package.json'), JSON.stringify(manifest, null, 2))
  // Stage every published file (the manifest's own `files` list) — prepack
  // guards that client.js is present, so hand-picking a subset fails the pack.
  for (const file of manifest.files ?? []) {
    await writeFile(join(suiteDir, file), await readFile(join(projectRoot, 'dsh-x', file)))
  }
  const packOut = await execFile('npm', ['pack', '--json', '--pack-destination', root], { cwd: suiteDir, env: baseEnv, timeout: 120_000 })
  const tarball = join(root, JSON.parse(packOut.stdout)[0].filename)

  // ---- 3. the ONLY install a workx user runs -----------------------------
  const profileRoot = join(home, 'profiles', 'headless')
  await mkdir(profileRoot, { recursive: true })
  const workspaceLines = [
    'minimumReleaseAge: 0',
    'allowBuilds:',
    "  '@google/genai': false",
    '  protobufjs: false',
  ]
  const pnpmStore = join(cliDir, 'node_modules', '.pnpm')
  if (existsSync(pnpmStore)) {
    const core = new Set()
    for (const entry of await readdir(pnpmStore)) {
      if (entry.startsWith('@deepseek-ai+dsh')) {
        core.add(`@deepseek-ai/${entry.slice('@deepseek-ai+'.length).split('@0')[0]}`)
      }
    }
    if (core.size > 0) {
      workspaceLines.push('overrides:')
      for (const name of [...core].sort()) workspaceLines.push(`  "${name}": ${cliVersion}`)
    }
  }
  await writeFile(join(profileRoot, 'pnpm-workspace.yaml'), `${workspaceLines.join('\n')}\n`)
  log('installing the dsh-work-x suite (one plugin add) …')
  await execFile(dshBin, ['plugin', '--profile', 'headless', 'add', tarball], {
    env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
  })

  // ---- 4. the workspace's MCP config (the adapter's standard file) -------
  await writeFile(join(workDir, '.mcp.json'), `${JSON.stringify({
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', MCP_SERVER_SPEC],
      },
    },
  }, null, 2)}\n`)
  // Warm the npx cache so the child's lazy connect does not spend its model
  // turn waiting on a first-time package download.
  await execFile('npx', ['-y', MCP_SERVER_SPEC, '--help'], { env: baseEnv, timeout: 300_000 }).catch(() => {})

  // ---- 5. the turn: parent spawns, the CHILD talks to the MCP server -----
  const ECHO = `ECHO_${RUN_TAG}`
  const prompt = [
    'Do these steps in order and do not call the mcp tool or bash yourself — only the subagent may.',
    'Step 1: call the Agent tool once: subagent_type general-purpose, name "mcpkid", run_in_background false,',
    `prompt: "Call the mcp tool to run the echo tool on the everything server with message ${ECHO}.`,
    'If it reports the server is not connected, first call the mcp tool with {\\"connect\\": \\"everything\\"} and retry once. Then reply done.".',
    'Step 2: reply with the agent\'s report only.',
  ].join(' ')
  log('running the headless turn (child lazy-connects the real MCP server) …')
  const child = spawn(dshBin, ['--profile', 'headless', prompt], {
    cwd: workDir, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  const deadline = Date.now() + 420_000
  while (child.exitCode === null && Date.now() < deadline) await delay(2000)
  if (child.exitCode === null) child.kill('SIGTERM')

  // ---- 6. durable-log assertions ----------------------------------------
  const problems = []
  if (!/preparing 5 Pi package\(s\)|preparing 4 Pi package\(s\)/u.test(output)) {
    problems.push('the engine never reported preparing the suite packages')
  }
  const sessions = await loadSessions(ECHO)
  const kid = sessions.find(s => s.isChild)
  const parent = sessions.find(s => !s.isChild && s.toolCalls.some(c => c.data?.name === 'Agent'))
  if (parent === undefined) problems.push('no parent session with an Agent tool/call')
  const isMcpToolName = name => name === 'mcp' || /(^|_)echo$/u.test(String(name ?? '')) || String(name ?? '').startsWith('everything_')
  if (parent !== undefined && parent.toolCalls.some(c => isMcpToolName(c.data?.name))) {
    problems.push('the parent called the MCP tool itself — the child proves nothing')
  }
  if (kid === undefined) problems.push('no child session carrying the echo task')
  if (kid !== undefined) {
    if (!kid.toolCalls.some(c => isMcpToolName(c.data?.name))) {
      problems.push('the child\'s durable log has no MCP tool/call (mcp or a direct server tool) — the adapter never reached the child')
    }
    const echoed = kid.events.some(e => e.type === 'tool/result' && JSON.stringify(e).includes(`Echo: ${ECHO}`))
    if (!echoed) problems.push(`no durable tool/result carries "Echo: ${ECHO}" — the real MCP round-trip never happened in the child`)
  }

  result.problems = problems
  result.childFile = kid?.file ?? null
  result.cliVersion = cliVersion
  result.suiteTarball = tarball.split('/').pop()
  if (problems.length > 0) result.outputTail = output.slice(-2000)
  await record(problems.length === 0 ? 'passed' : 'failed')
  log(problems.length === 0 ? `PASSED — evidence in ${outPath}` : `FAILED — ${problems.join('; ')}`)
  process.exit(problems.length === 0 ? 0 : 1)
} catch (error) {
  result.error = String((error && error.message) || error)
  await record('failed')
  log(`FAILED: ${result.error}`)
  process.exit(1)
}
