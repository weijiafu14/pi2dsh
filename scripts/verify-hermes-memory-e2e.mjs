#!/usr/bin/env node
// Published-package acceptance on a real DSH CLI. Uses a disposable home;
// every CLI prompt runs in a new process. No tool or model calls are mocked.
import assert from 'node:assert/strict'
import { execFile as callback, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { installedCoreVersions } from './lib/e2e-harness.mjs'

const execFile = promisify(callback)
const root = resolve(process.env.HERMES_E2E_ROOT ?? '/tmp/pi2dsh-hermes-20260910')
const cli = process.env.PI2DSH_DSH_BIN ?? join(root, 'cli/node_modules/.bin/dsh')
const coreVersions = installedCoreVersions(cli)
const cliVersion = coreVersions.get('@deepseek-ai/dsh')
const home = join(root, 'home')
const cwd = join(root, 'project')
const phase = process.argv[2] ?? 'cli'
const apiKey = process.env.DEEPSEEK_API_KEY
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? 'pi2dsh@0.24.0'
assert(apiKey, 'DEEPSEEK_API_KEY required: this is a live-model test')
await mkdir(cwd, { recursive: true })
await mkdir(join(root, 'logs'), { recursive: true })
await mkdir(join(root, 'bin'), { recursive: true })
await writeFile(join(root, 'bin/pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
await chmod(join(root, 'bin/pnpm'), 0o755)
const env = { ...process.env, DSH_HOME: home,
  PATH: `${root}/bin:${process.env.PATH}`, CI: '1', NO_COLOR: '1',
  DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'danger-full-access',
  npm_config_registry: 'https://registry.npmjs.org', PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
  PNPM_CONFIG_NETWORK_CONCURRENCY: '3', PNPM_CONFIG_FETCH_TIMEOUT: '300000' }
const clean = text => text.replaceAll(apiKey, '[REDACTED]')
async function run(label, args, options = {}) {
  console.log(`[hermes] ${label}: starting`)
  try {
    const result = await execFile(cli, args, { cwd, env, timeout: 600_000, maxBuffer: 32 * 1024 * 1024, ...options })
    await writeFile(join(root, 'logs', `${label}.log`), clean(result.stdout + result.stderr))
    console.log(`[hermes] ${label}: complete`)
    return result
  } catch (e) {
    await writeFile(join(root, 'logs', `${label}.log`), clean(`${e.stdout ?? ''}\n${e.stderr ?? ''}`))
    throw new Error(`${label}: ${clean(e.message)}`)
  }
}
async function files(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, e.name)
    if (e.isDirectory()) out.push(...await files(path))
    else out.push(path)
  }
  return out
}
async function sessions() {
  return Promise.all((await files(join(home, 'sessions'))).filter(p => /\/session(?:\.v\d+)?\.jsonl$/u.test(p)).map(async path => ({
    path, records: (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse),
  })))
}
function resultsFor(records, name, { allowError = false } = {}) {
  const calls = records.filter(r => r.type === 'tool/call' && r.data?.name === name)
  assert(calls.length, `${name} was not called`)
  return calls.map(c => {
    const result = records.filter(r => r.type === 'tool/result').flatMap(r => r.data?.message?.content ?? [])
      .find(b => b.toolCallId === c.data.callId)
    assert(result, `${name} has no result`)
    if (!allowError) assert(!result.isError, `${name} failed: ${JSON.stringify(result)}`)
    return result
  })
}
async function verifyWeb({ word, key }) {
  const all = await sessions()
  const save = all.find(s => s.records.some(r => r.type === 'user/message' && JSON.stringify(r.data).includes(word)))
  assert(save, 'missing web save session')
  resultsFor(save.records, 'memory_add')
  const recall = all.find(s => s.records.some(r => r.type === 'user/message' && JSON.stringify(r.data).includes(`find the ${key} codename. Report`)))
  assert(recall, 'missing web recall session')
  assert(JSON.stringify(resultsFor(recall.records, 'memory_search')).includes(word))
  assert(!JSON.stringify(recall.records.filter(r => r.type === 'user/message')).includes(word), 'word leaked into recall input')
  const commands = recall.records.filter(r => r.type === 'command/done')
  for (const expected of ['Session indexing complete', 'SQLite sync complete', 'Memory Insights', 'injected into every session', 'Injected Context Preview']) {
    assert(commands.some(r => r.data?.kind === 'success' && r.data?.text?.includes(expected)), `missing command completion: ${expected}`)
  }
  const removal = all.find(s => s.records.some(r => r.type === 'user/message' && JSON.stringify(r.data).includes(`find the ${key} codename, then memory_remove`)))
  assert(removal, 'missing web removal session')
  resultsFor(removal.records, 'memory_remove')
  const oldHeader = JSON.stringify(removal.records.filter(r => r.type === 'request/header')).includes('Use concise acceptance summaries.')
  const inHistory = removal.records.some(r => r.type === 'request/context' && r.data?.systemPromptUpdate === 'in-history')
    && JSON.stringify(removal.records.filter(r => r.type === 'system/message')).includes('Use concise acceptance summaries.')
  assert(oldHeader || inHistory, 'pinned instruction not in fresh-session model context')
  const pin = await readFile(join(home, 'pi2dsh/agent/pi-hermes-memory/STANDING.md'), 'utf8')
  assert(pin.includes('Use concise acceptance summaries.'))
  await writeFile(join(root, 'web-evidence.json'), JSON.stringify({ status: 'passed', word, key,
    versions: { dsh: cliVersion, pi2dsh: '0.24.0', memory: '0.9.8' },
    checks: ['browser-save', 'new-session-recall', 'browser-remove', 'five-slash-command-completions', 'slash-pin-persisted', 'pin-in-fresh-model-context'],
    commands: commands.map(r => r.data), screenshots: await files(join(root, 'screenshots')) }, null, 2))
  console.log('[hermes] web: passed')
}
if (phase === 'install') {
  await execFile('git', ['init', '-q', cwd])
  for (const profile of ['headless', 'web']) {
    const dir = join(home, 'profiles', profile)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nminimumReleaseAge: 0\nautoInstallPeers: false\nallowBuilds:\n  better-sqlite3: true\n  esbuild: true\n  protobufjs: false\n  "@google/genai": false\n')
    await run(`install-${profile}`, ['plugin', '--profile', profile, 'add', '-w', engineSpec, 'pi-hermes-memory@0.9.8'])
    await writeFile(join(dir, 'cordis.patch.yml'), '- id: session-persistence-jsonl\n  config:\n    root: !!js dshHomePath("sessions")\n    compression: none\n')
  }
} else if (phase === 'cli' || phase === 'verify-cli') {
  const proof = phase === 'verify-cli' ? JSON.parse(await readFile(join(root, 'proof.json'), 'utf8')) : {
    codeword: `AZURE${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    revised: `CORAL${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    skill: `hermes-proof-${randomUUID().slice(0, 8)}`,
    secret: `ORCHID${randomUUID().replaceAll('-', '').slice(0, 12)}`, startedAt: new Date().toISOString(),
  }
  const { codeword, revised, skill, secret } = proof
  await writeFile(join(root, 'proof.json'), JSON.stringify(proof, null, 2))
  const prompt = (label, text) => phase === 'verify-cli' ? Promise.resolve() : run(label, ['--profile', 'headless', text])
  await prompt('A-save', `Use memory_add with target=user to save exactly: "The acceptance project codename is ${codeword}." Then use skill_manage to create a global skill named ${skill}, description "Procedure for the hermes acceptance check", with body "## Procedure\nReturn the verification word ${secret}." Do not use shell or filesystem tools. Confirm both results.`)
  await prompt('A-project-skill', `Use skill_manage to create a project-scoped skill named ${skill}-project, description "Procedure for the acceptance project", with body "## Procedure\nReturn the project verification word PROJECT${secret}." Do not use shell or filesystem tools.`)
  await prompt('B-recall', 'Use memory_search to find the acceptance project codename and report its exact value. Then use session_search with query "acceptance project codename" to recover the earlier conversation. Do not use shell or filesystem tools.')
  await prompt('C-skill', `Load both native DSH skills ${skill} and ${skill}-project using the host skill tool, follow their procedures, and report both verification words. Do not use skill_manage or shell/file tools to find them.`)
  await prompt('D-replace', `Use memory_replace target=user to change "The acceptance project codename is ${codeword}." into "The acceptance project codename is ${revised}." Then use memory_search to check the replacement. Do not use shell or filesystem tools.`)
  await prompt('E-remove', 'Use memory_search to find the acceptance project codename. Then use memory_remove with the exact stored entry and its target to delete it. Do not use shell or filesystem tools.')
  await prompt('F-absent', 'Use memory_search query="acceptance project codename" and report whether that memory exists. Do not recreate any memory and do not use shell or filesystem tools.')
  const all = await sessions()
  const selectedPaths = new Set()
  const byPrompt = fragment => {
    const match = all.filter(s => s.records.some(r => r.type === 'user/message'
      && r.data.source?.kind === 'user' && r.time >= Date.parse(proof.startedAt)
      && JSON.stringify(r.data).includes(fragment)))
    assert.equal(match.length, 1, `expected one session for ${fragment}`)
    selectedPaths.add(match[0].path)
    return match[0].records
  }
  const checks = []
  function check(name, test) {
    try { test(); checks.push({ name, status: 'passed' }) }
    catch (error) { checks.push({ name, status: 'failed', error: clean(error.message) }) }
  }
  check('memory-add', () => resultsFor(byPrompt('save exactly:'), 'memory_add'))
  check('skill-create', () => resultsFor(byPrompt('save exactly:'), 'skill_manage'))
  check('project-skill-create', () => resultsFor(byPrompt('project-scoped skill named'), 'skill_manage'))
  const b = byPrompt('recover the earlier conversation')
  check('fresh-process-memory-search', () => {
    assert(!JSON.stringify(b.filter(r => r.type === 'user/message')).includes(codeword))
    assert(JSON.stringify(resultsFor(b, 'memory_search')).includes(codeword), 'fresh process did not recover memory')
  })
  check('prior-session-search', () => assert(JSON.stringify(resultsFor(b, 'session_search')).includes(codeword), 'session_search did not recover prior conversation'))
  const c = byPrompt('Load both native DSH skills')
  check('native-skill-discovery-and-load', () => {
    const skillResults = resultsFor(c, 'skill')
    assert(skillResults.length >= 2, 'both skill scopes must load through native skill tool')
    assert(JSON.stringify(skillResults).includes(secret), 'native skill load did not recover skill body')
    assert(JSON.stringify(skillResults).includes(`PROJECT${secret}`), 'project skill was not discovered and loaded')
    assert(JSON.stringify(c.filter(r => r.type === 'assistant/message')).includes(secret), 'skill procedure was not followed')
  })
  check('memory-replace', () => resultsFor(byPrompt('Use memory_replace'), 'memory_replace'))
  const e = byPrompt('delete it.')
  check('replacement-persists', () => {
    const beforeRemove = e.slice(0, e.findIndex(r => r.type === 'tool/call' && r.data?.name === 'memory_remove'))
    assert(JSON.stringify(resultsFor(beforeRemove, 'memory_search')).includes(revised), 'replacement did not persist into next process')
  })
  check('memory-remove', () => resultsFor(e, 'memory_remove'))
  check('removal-persists', () => {
    const f = resultsFor(byPrompt('Do not recreate any memory'), 'memory_search', { allowError: true })
    assert(!JSON.stringify(f).includes(revised), 'deleted entry survived restart')
    assert(/No memories|No .*matching|0 memories/i.test(JSON.stringify(f)), 'missing explicit empty search result')
  })
  const installedProfile = JSON.parse(await readFile(join(home, 'profiles/headless/package.json'), 'utf8'))
  const report = { ...proof, status: checks.every(c => c.status === 'passed') ? 'passed' : 'failed', engineSpec: installedProfile.dependencies.pi2dsh, versions: { dsh: cliVersion, pi2dsh: '0.24.0', memory: '0.9.8' },
    sessionCount: selectedPaths.size, checks,
    sessions: all.filter(s => selectedPaths.has(s.path)).map(s => ({ path: s.path, calls: s.records.filter(r => r.type === 'tool/call').map(r => r.data.name) })) }
  await writeFile(join(root, 'cli-evidence.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (report.status === 'failed') process.exitCode = 1
} else if (phase === 'probe-local-skills') {
  const proof = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'))
  const tarball = process.env.HERMES_LOCAL_TARBALL
  assert(tarball, 'HERMES_LOCAL_TARBALL must name a locally built engine tarball')
  await run('install-local-headless', ['plugin', '--profile', 'headless', 'add', '-w', resolve(tarball)])
  await run('local-native-skills', ['--profile', 'headless', `LOCAL_SKILL_PROBE: Use the native skill tool to load ${proof.skill} and ${proof.skill}-project. Follow both procedures and report both verification words. Do not use skill_manage, shell or file tools.`])
  const session = (await sessions()).find(s => s.records.some(r => r.type === 'user/message' && JSON.stringify(r.data).includes('LOCAL_SKILL_PROBE:')))
  assert(session, 'local probe produced no session')
  const results = resultsFor(session.records, 'skill')
  assert(JSON.stringify(results).includes(proof.secret))
  assert(JSON.stringify(results).includes(`PROJECT${proof.secret}`))
  await writeFile(join(root, 'local-skills-evidence.json'), JSON.stringify({ status: 'passed', engine: { from: 'local-tarball', tarball, commit: (await execFile('git', ['rev-parse', 'HEAD'])).stdout.trim() }, calls: session.records.filter(r => r.type === 'tool/call').map(r => r.data.name) }, null, 2))
} else if (phase === 'verify-web') {
  await verifyWeb(JSON.parse(await readFile(join(root, 'web-proof.json'), 'utf8')))
} else if (phase === 'web') {
  const port = Number(process.env.HERMES_WEB_PORT ?? 5197)
  const url = `http://127.0.0.1:${port}`
  const server = spawn(cli, ['web', '--port', String(port), '--no-open'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', b => { log += b })
  server.stderr.on('data', b => { log += b })
  let browser
  try {
    const deadline = Date.now() + 120_000
    let token
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`web exited: ${clean(log)}`)
      token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(log)?.[1]
      if (token && await fetch(url).then(r => r.ok || r.status === 401).catch(() => false)) break
      await new Promise(r => setTimeout(r, 500))
    }
    assert(token, 'web did not print launch URL')
    process.env.CAPTURE_WORKSPACE = cwd
    process.env.PLAYWRIGHT_FROM ??= resolve('../deepseek-harness/apps/web')
    process.argv = ['node', 'capture', join(root, 'screenshots'), '--url', `${url}/?token=${token}`]
    const { openApp } = await import('../docs/posting-kit/web-drive.mjs')
    const app = await openApp()
    browser = app.browser
    const { page, send, shot } = app
    const word = `WEB${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const key = `browser-${randomUUID().slice(0, 8)}`
    await writeFile(join(root, 'web-proof.json'), JSON.stringify({ word, key }))
    const fresh = () => page.getByRole('button', { name: /new session/i }).first().click()
    await fresh()
    await send(`Use memory_add target=user to save exactly "The ${key} codename is ${word}." Confirm in one sentence.`)
    await shot('01-web-save')
    await fresh()
    await send(`Use memory_search to find the ${key} codename. Report its exact value. Do not ask follow-up questions.`)
    await shot('02-web-recall')
    assert((await page.locator('body').innerText()).includes(word), 'web did not show recalled word')
    for (const [command, expected] of [
      ['memory-index-sessions', 'Session indexing complete'],
      ['memory-sync-markdown', 'SQLite sync complete'],
      ['memory-insights', 'Memory Insights'],
      ['memory-pin Use concise acceptance summaries.', 'injected into every session'],
      ['memory-preview-context', 'Injected Context Preview'],
    ]) {
      await send(`/${command}`)
      assert((await page.locator('body').innerText()).includes(expected), `${command} did not show its completion`)
      await shot(`command-${command.split(' ')[0]}`)
    }
    const pin = await readFile(join(home, 'pi2dsh/agent/pi-hermes-memory/STANDING.md'), 'utf8')
    assert(pin.includes('Use concise acceptance summaries.'), 'slash command did not persist pin')
    await fresh()
    await send(`Use memory_search to find the ${key} codename, then memory_remove to delete that exact entry from the user target. Confirm deletion.`)
    await shot('03-web-remove')
    await verifyWeb({ word, key })
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
    await writeFile(join(root, 'logs/web.log'), clean(log).replace(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1[REDACTED]'))
  }
} else if (phase !== 'library') throw new Error(`unknown phase ${phase}`)

export { root, home, cwd, cli, cliVersion, env, run, sessions, resultsFor, files, clean }
