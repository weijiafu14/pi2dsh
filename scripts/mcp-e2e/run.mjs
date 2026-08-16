#!/usr/bin/env node
// Drive pi-mcp-adapter through one deliberately broken MCP server per
// scenario, on a real DSH loop, and record what actually happened.
//
//   node scripts/mcp-e2e/run.mjs <out.json> [--only <scenario>]
//
// Required environment:
//   DSH_CHECKOUT   path to a deepseek-harness checkout (the CLI runs from it)
//   DSH_HOME       a profile home with pi2dsh + pi-mcp-adapter installed
//   MCP_HOME       HOME for the launched dsh, where the MCP config is written
//   DEEPSEEK_API_KEY  only needed by scenarios that run a turn
//
// Why the observation is the startup log: an MCP client connects, negotiates
// and discovers during mount, and pi2dsh reports the resulting registration
// count. A scenario that hangs or crashes shows up there — as a missing
// count, a wrong count, or a startup that never finishes — without needing a
// model in the loop.
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [outPath = 'community/mcp-e2e-results.json'] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const onlyAt = process.argv.indexOf('--only')
const only = onlyAt === -1 ? undefined : process.argv[onlyAt + 1]

const CHECKOUT = process.env.DSH_CHECKOUT
const DSH_HOME = process.env.DSH_HOME
const MCP_HOME = process.env.MCP_HOME
if (CHECKOUT === undefined || DSH_HOME === undefined || MCP_HOME === undefined) {
  throw new Error('mcp-e2e: DSH_CHECKOUT, DSH_HOME and MCP_HOME are required')
}

const SERVER = new URL('scenario-server.mjs', import.meta.url).pathname
const PORT = Number(process.env.MCP_E2E_PORT ?? 5190)
// A cold dsh start compiles TypeScript on the fly; anything past this means
// the client is blocking startup rather than the host being slow.
const STARTUP_BUDGET_MS = 90_000

/**
 * One scenario: the MCP servers to configure, and what the run must show.
 * `expect` reads the observations and returns a failure string, or undefined
 * when the behaviour is correct.
 */
const SCENARIOS = [
  {
    id: 'healthy',
    covers: 'control — a well-behaved server',
    servers: { healthy: 'healthy' },
    expect: run => run.mcpTools >= 1
      ? undefined
      : `expected the server's tool to be registered, saw ${run.mcpTools}`,
  },
  {
    id: 'slow-init',
    covers: '#247 connect/discovery timeout',
    servers: { slow: 'slow-init' },
    expect: run => run.startupMs < STARTUP_BUDGET_MS
      ? undefined
      : `startup blocked ${run.startupMs}ms on a server that never finishes initialize`,
  },
  {
    id: 'dead-init',
    covers: '#314 hang during activation',
    servers: { dead: 'dead-init' },
    expect: run => run.started
      ? undefined
      : 'the host never finished starting with a silent MCP server',
  },
  {
    id: 'one-bad-server',
    covers: '#522 one failing server must not sink the others',
    servers: { healthy: 'healthy', broken: 'crash-on-init' },
    expect: run => run.mcpTools >= 1
      ? undefined
      : `the healthy server's tool went missing when a sibling crashed (${run.mcpTools} tools)`,
  },
  {
    id: 'list-changed',
    covers: '#618 tools/list_changed resync',
    servers: { changing: 'list-changed' },
    // The extra tool arrives 2s after connect; the count is read after that.
    expect: run => run.mcpTools >= 2
      ? undefined
      : `expected the late-announced tool after list_changed, saw ${run.mcpTools}`,
  },
  {
    id: 'old-protocol',
    covers: '#1757 older protocol version negotiation',
    servers: { legacy: 'old-protocol' },
    expect: run => run.mcpTools >= 1
      ? undefined
      : `a 2024-11-05 server produced no tools (${run.mcpTools})`,
  },
  {
    id: 'resources',
    covers: '#2025 resource text must survive',
    servers: { res: 'resources' },
    expect: run => run.mcpTools >= 1
      ? undefined
      : `a resources-capable server produced no tools (${run.mcpTools})`,
  },
]

/**
 * Write the MCP client config the launched dsh will read.
 * @param servers - scenario name per server id.
 */
async function writeConfig(servers) {
  const dir = join(MCP_HOME, '.config', 'mcp')
  await mkdir(dir, { recursive: true })
  const mcpServers = Object.fromEntries(Object.entries(servers).map(([id, scenario]) => [id, {
    command: process.execPath,
    args: [SERVER, scenario],
  }]))
  await writeFile(join(dir, 'mcp.json'), `${JSON.stringify({ mcpServers }, null, 2)}\n`)
}

/**
 * Boot dsh once and observe what the mount produced.
 * @param scenario - the scenario being run.
 */
async function runScenario(scenario) {
  await writeConfig(scenario.servers)
  const logPath = join(MCP_HOME, `mcp-e2e-${scenario.id}.log`)
  await rm(logPath, { force: true })

  const started = Date.now()
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', join(CHECKOUT, 'apps', 'cli', 'src', 'bin.ts'),
    '--profile', 'web', '--port', String(PORT),
  ], {
    cwd: CHECKOUT,
    env: {
      HOME: MCP_HOME,
      PATH: process.env.PATH ?? '',
      DSH_HOME,
      ...process.env.DEEPSEEK_API_KEY === undefined ? {} : { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let log = ''
  child.stdout.on('data', chunk => { log += String(chunk) })
  child.stderr.on('data', chunk => { log += String(chunk) })

  // "Started" is the line the web surface prints once it is listening.
  let startupMs = STARTUP_BUDGET_MS
  let ok = false
  const deadline = Date.now() + STARTUP_BUDGET_MS
  while (Date.now() < deadline) {
    if (/dsh web: http/u.test(log)) { ok = true; startupMs = Date.now() - started; break }
    if (child.exitCode !== null) break
    await delay(500)
  }
  // list_changed lands ~2s after connect; give every scenario the same window
  // so the counts are comparable.
  if (ok) await delay(5000)

  child.kill('SIGKILL')
  await writeFile(logPath, log)

  const loaded = /\[pi2dsh\] loaded pi-mcp-adapter: (\d+) tools, (\d+) commands/u.exec(log)
  const baseTools = 2 // the adapter's own `mcp` and `mcpScript`
  const totalTools = loaded === null ? 0 : Number(loaded[1])
  return {
    started: ok,
    startupMs,
    totalTools,
    // Tools contributed by the MCP servers themselves, above the adapter's own.
    mcpTools: Math.max(0, totalTools - baseTools),
    exitCode: child.exitCode,
    logPath,
  }
}

const results = []
for (const scenario of SCENARIOS) {
  if (only !== undefined && scenario.id !== only) continue
  process.stdout.write(`→ ${scenario.id} … `)
  const run = await runScenario(scenario)
  const failure = scenario.expect(run)
  results.push({ ...scenario, servers: undefined, run, verdict: failure === undefined ? 'pass' : 'fail', failure })
  process.stdout.write(`${failure === undefined ? 'pass' : `FAIL — ${failure}`} (startup ${run.startupMs}ms, ${run.mcpTools} MCP tools)\n`)
}

const summary = {
  generatedAt: new Date().toISOString(),
  adapter: 'pi-mcp-adapter@2.26.0',
  counts: {
    pass: results.filter(r => r.verdict === 'pass').length,
    fail: results.filter(r => r.verdict === 'fail').length,
  },
  results,
}
await mkdir(join(outPath, '..'), { recursive: true }).catch(() => {})
await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\n${summary.counts.pass} pass · ${summary.counts.fail} fail → ${outPath}`)
if (summary.counts.fail > 0) process.exitCode = 1
