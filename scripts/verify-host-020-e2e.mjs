#!/usr/bin/env node
// The reported user path: stock DSH + published pi-subagents@0.20.0,
// installed into a fresh profile through dsh plugin add. No simulated LLM.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createE2eHarness, filesBelow, installedCoreVersions } from './lib/e2e-harness.mjs'
import { isSessionLog } from './lib/session-log.mjs'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const hostVersion = manifest.devDependencies['@deepseek-ai/dsh-agent']
assert(process.env.PI2DSH_DSH_CWD, 'PI2DSH_DSH_CWD must point to a stock npm CLI install')
const cliDir = resolve(process.env.PI2DSH_DSH_CWD)
const cli = resolve(process.env.PI2DSH_DSH_BIN ?? join(cliDir, 'node_modules/.bin/dsh'))
const root = await mkdtemp('/tmp/pi2dsh-host020-live-')
const workspace = join(root, 'workspace')
await mkdir(workspace)
const out = resolve(process.argv[2] ?? 'community/host-020-e2e.json')
const report = { target: `DSH ${hostVersion} + pi-subagents 0.20.0`, status: 'running', scratch: root }
const persist = async () => {
  const encoded = JSON.stringify(report, null, 2)
  assert(!process.env.DEEPSEEK_API_KEY || !encoded.includes(process.env.DEEPSEEK_API_KEY), 'secret in evidence')
  await mkdir(resolve(out, '..'), { recursive: true })
  await writeFile(out, encoded + '\n')
}
try {
  assert(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required for live model evidence')
  const versions = installedCoreVersions(cli)
  assert.equal(versions.get('@deepseek-ai/dsh'), hostVersion)
  const harness = createE2eHarness({ directDshBin: cli, dshBin: cli, dshCwd: cliDir })
  const { home, runDsh } = await harness.makeHome(root)
  const engine = process.env.PI2DSH_ENGINE_SPEC ?? `file:${resolve(`.artifacts/pi2dsh-${manifest.version}.tgz`)}`
  report.engine = engine.startsWith('file:')
    ? { from: 'local-tarball', sha256: createHash('sha256').update(await readFile(engine.slice(5))).digest('hex') }
    : { from: 'registry', spec: engine }
  console.log(`[host020] installing engine and unmodified Pi subagents into ${root}`)
  await runDsh(['plugin', '--profile', 'headless', 'add', engine, '@tintinweb/pi-subagents@0.20.0'])
  await harness.useJsonlSessions(home, 'headless')
  await harness.useDefaultModel(home, 'deepseek-official', 'deepseek-flash')
  const installed = JSON.parse(await readFile(join(home, 'profiles/headless/node_modules/pi2dsh/package.json'), 'utf8'))
  assert.equal(installed.version, manifest.version)
  report.engineVersion = installed.version
  const marker = `CHILD_${randomUUID().replaceAll('-', '')}`
  const markerPath = join(workspace, 'child-output.txt')
  const prompt = `Use the Agent tool from Pi subagents exactly once, with subagent_type general-purpose and run_in_background false. Give that child this task: write the exact text ${marker} into ${markerPath}, using its file tools, then answer with that text. Wait for the child. You must not write or read the file yourself. Reply with the child's returned result.`
  console.log('[host020] running a real parent → Pi child → native file tool → parent report turn')
  const result = await runDsh(['--profile', 'headless', prompt], { cwd: workspace, timeout: 300000 })
  const logs = []
  for (const file of (await filesBelow(join(home, 'sessions'))).filter(isSessionLog)) {
    logs.push({ file, events: (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) })
  }
  const parent = logs.find(log => log.events.some(e => e.type === 'tool/call' && e.data.name === 'Agent'))
  const child = logs.find(log => log.events.some(e => e.type === 'subagent/descriptor' && e.data.provider === 'pi2dsh'))
  assert(parent, 'no original Pi Agent call in parent log')
  assert(child, 'no bridge-created native child session')
  assert(child.events.some(e => e.type === 'request/header'), 'child never called a model')
  assert(child.events.some(e => e.type === 'tool/call' && ['write', 'bash', 'run_code'].includes(e.data.name)), 'child used no native file tool')
  assert.equal((await readFile(markerPath, 'utf8')).trim(), marker)
  const parentCall = parent.events.find(e => e.type === 'tool/call' && e.data.name === 'Agent')
  const returned = parent.events.find(e => e.type === 'tool/result' && e.data.message.toolCallId === parentCall.data.callId)
  assert(returned && returned.data.message.isError !== true && JSON.stringify(returned.data.message.content).includes(marker), 'child result did not reach parent tool result')
  assert(!parent.events.some(e => e.type === 'tool/call' && ['write', 'read', 'bash'].includes(e.data.name)), 'parent completed the child task itself')
  assert(child.events.some(e => e.type === 'turn/end' && e.data.reason.kind === 'completed'), 'child did not complete')
  Object.assign(report, { status: 'passed', childRequestHeaders: child.events.filter(e => e.type === 'request/header').length,
    childToolCalls: child.events.filter(e => e.type === 'tool/call').map(e => e.data.name),
    parentReceivedChildOutput: true, cliExited: true, outputContainsMarker: result.stdout.includes(marker) })
} catch (error) {
  Object.assign(report, { status: 'failed', error: String(error?.message ?? error).replaceAll(process.env.DEEPSEEK_API_KEY ?? '\0', '[redacted]') })
  console.error(`[host020] ${report.error}`)
  process.exitCode = 1
} finally {
  await persist()
  console.log(`[host020] ${report.status}: ${out}`)
}
