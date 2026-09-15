#!/usr/bin/env node
// Full host-sensitive acceptance of the unmodified npm pi-hermes-memory package.
// Package-internal algorithms are covered separately by the exact npm gitHead's suite.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, realpath, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const phase = process.argv[2] ?? 'tools'
process.argv[2] = 'library'
const h = await import('./verify-hermes-memory-e2e.mjs')
const { root, home, cwd, cli, env, run, sessions, resultsFor, clean } = h
const agentDir = join(home, 'pi2dsh/agent')
const evidence = join(root, 'full-evidence')
await mkdir(evidence, { recursive: true })
const require = createRequire(await realpath(join(home, 'profiles/web/node_modules/pi-hermes-memory/package.json')))
const Database = require('better-sqlite3')
const engineManifest = JSON.parse(await readFile(join(home, 'profiles/web/node_modules/pi2dsh/package.json'), 'utf8'))
const engineDependency = JSON.parse(await readFile(join(home, 'profiles/web/package.json'), 'utf8')).dependencies.pi2dsh
const engineFiles = await h.files(join(home, 'profiles/web/node_modules/pi2dsh/dist'))
const engineHash = createHash('sha256')
for (const file of engineFiles.sort()) engineHash.update(await readFile(file))
const build = { dshVersion: h.cliVersion, engineVersion: engineManifest.version, engineDependency, engineDistSha256: engineHash.digest('hex'), memoryVersion: require('./package.json').version }
const nonce = () => randomUUID().replaceAll('-', '').slice(0, 12)
const reports = []
let lastChildren = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(test, label, timeout = 90000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await test()
    if (value) return value
    await sleep(250)
  }
  throw new Error(`timeout: ${label}`)
}
function memories() {
  const db = new Database(join(agentDir, 'pi-hermes-memory/sessions.db'), { readonly: true })
  try { return db.prepare('SELECT id,target,project,content FROM memories').all() }
  finally { db.close() }
}
async function config(values = {}) {
  await mkdir(agentDir, { recursive: true })
  // Isolated test configuration, consumed by the real unmodified plugin.
  await writeFile(join(agentDir, 'hermes-memory-config.json'), JSON.stringify({
    reviewEnabled: false, correctionDetection: false, flushOnShutdown: false,
    flushOnCompact: false, ...values,
  }, null, 2))
}
async function record(name, records, extra = {}) {
  const nativeSession = records.find(r => r.type === 'session')
  const children = new Map(lastChildren.map(s => [s.path, s]))
  if (nativeSession?.id) for (const session of await sessions()) {
    if (session.records[0]?.parentSession === nativeSession.id) children.set(session.path, session)
  }
  const selected = records.filter(r => ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'command/run', 'command/done', 'compaction/start', 'compaction/summary', 'compaction/end'].includes(r.type))
  const data = { name, status: 'passed', build, nativeSession, ...extra, events: selected,
    nativeChildren: [...children.values()].map(s => ({ path: s.path, events: s.records.filter(r => ['session', 'subagent/descriptor', 'permission/preset', 'sandbox/mode', 'approval/policy', 'request/header', 'user/message', 'tool/call', 'tool/result', 'assistant/message', 'turn/end'].includes(r.type)) })) }
  await writeFile(join(evidence, `${name}.json`), clean(JSON.stringify(data, null, 2)))
  reports.push({ name, status: data.status })
  console.log(`[hermes-full] ${name}: ${data.status}`)
}
async function prompt(name, text, directory = cwd) {
  const before = new Set((await sessions()).map(s => s.path))
  await run(name, ['--profile', 'headless', text], { cwd: directory })
  const added = (await sessions()).filter(s => !before.has(s.path))
  const main = added.filter(s => s.records.some(e => e.type === 'user/message' && e.data.source?.kind === 'user'
    && (e.data.content ?? []).some(b => b.text === text)))
  assert.equal(main.length, 1, `${name}: expected one fresh main native session`)
  lastChildren = added.filter(s => s.path !== main[0].path)
  return main[0].records
}
const toolCalls = records => records.filter(r => r.type === 'tool/call').map(r => r.data.name)
const systemText = records => records.filter(e => e.type === 'system/message')
  .flatMap(e => e.data.message?.content ?? e.data.content ?? []).map(b => b.text ?? '').join('\n')
function callsWith(records, name, predicate) {
  return records.filter(r => r.type === 'tool/call' && r.data.name === name).filter(r => {
    const args = typeof r.data.arguments === 'string' ? JSON.parse(r.data.arguments) : r.data.arguments
    return predicate(args)
  })
}

async function openWeb(label) {
  lastChildren = []
  const port = Number(process.env.HERMES_WEB_PORT ?? 5198)
  const url = `http://127.0.0.1:${port}`
  const server = spawn(cli, ['web', '--port', String(port), '--no-open'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  const captureLog = b => {
    log += b
    writeFileSync(join(evidence, `${label}-server.log`), clean(log).replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]'))
  }
  server.stdout.on('data', captureLog)
  server.stderr.on('data', captureLog)
  let browser
  try {
    const token = await until(async () => {
      if (server.exitCode !== null) throw new Error(clean(log))
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(log)?.[1]
      return token && await fetch(url).then(r => r.ok || r.status === 401).catch(() => false) ? token : false
    }, 'web start')
    process.env.CAPTURE_WORKSPACE = cwd
    process.env.PLAYWRIGHT_FROM ??= resolve('../deepseek-harness/apps/web')
    process.argv = ['node', 'capture', join(evidence, label), '--url', `${url}/?token=${token}`]
    const { openApp } = await import('../docs/posting-kit/web-drive.mjs')
    const app = await openApp()
    browser = app.browser
    const send = async text => {
      const beforeCommands = new Set((await sessions()).flatMap(s => s.records.filter(e => e.type === 'command/run').map(e => e.data.commandId)))
      await app.send(text, { typingDelayMs: text.length > 1000 ? 0 : 12 })
      if (text.startsWith('/')) {
        const command = text.slice(1).split(' ')[0]
        return until(async () => {
          for (const session of await sessions()) {
            const run = session.records.find(e => e.type === 'command/run' && e.data.name === command && !beforeCommands.has(e.data.commandId))
            const done = run && session.records.find(e => e.type === 'command/done' && e.data.commandId === run.data.commandId)
            if (done) return done.data
          }
          return undefined
        }, `native /${command} completion`, 180000)
      } else {
        await until(async () => (await sessions()).some(s => {
          const user = s.records.find(e => e.type === 'user/message' && e.data.source?.kind === 'user'
            && (e.data.content ?? []).some(b => b.text === text))
          return user && s.records.some(e => e.type === 'turn/end' && e.seq > user.seq)
        }), 'native user turn completion', 180000)
      }
    }
    const fresh = async () => {
      await app.page.getByRole('button', { name: /new session/i }).first().click()
      await app.page.waitForTimeout(300)
    }
    const text = () => app.page.locator('body').innerText()
    return { ...app, send, fresh, text, log: () => log, close: async () => {
      server.kill('SIGTERM')
      await until(() => server.exitCode !== null || server.signalCode !== null, 'web shutdown', 30000)
      await Promise.race([browser.close(), sleep(10000).then(() => { throw new Error('test browser close timed out after native server exit') })])
      await writeFile(join(evidence, `${label}-server.log`), clean(log).replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]'))
    } }
  } catch (error) {
    await browser?.close()
    server.kill('SIGTERM')
    await writeFile(join(evidence, `${label}-server.log`), clean(log).replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]'))
    throw error
  }
}

try {
  if (phase === 'tools') {
    await config()
    const core = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'))
    const cleanup = await prompt('cleanup-core-skills', `Use skill_manage action=delete for global:${core.skill} and project:project:${core.skill}-project. These completed acceptance fixtures must be removed. Do not use other tools.`)
    resultsFor(cleanup, 'skill_manage')
    await record('cleanup-core-skills', cleanup)
    const marker = `DOMAINS${nonce()}`
    let r = await prompt('memory-domains', `Use memory_add to save four separate durable entries, one each in target memory, user, project, and failure. Each entry must contain ${marker} and its target name. The failure entry should use category=correction and explain that an incorrect test path was corrected. Then use memory_search query=${marker} to find them. Do not use other tools.`)
    resultsFor(r, 'memory_add')
    for (const target of ['memory', 'user', 'project', 'failure']) assert(callsWith(r, 'memory_add', a => a.target === target).length)
    assert(JSON.stringify(resultsFor(r, 'memory_search')).includes(marker))
    assert(memories().filter(m => m.content.includes(marker)).length >= 4)
    await record('memory-domains', r)

    const fakeSecret = `ghp_${'a'.repeat(36)}`
    r = await prompt('secret-scanner', `Acceptance test with a synthetic credential, not a real token: call memory_add target=user content="My test credential is ${fakeSecret}" exactly once to verify the plugin scanner rejects it. Do not transform or redact it before calling the tool. Do not use other tools.`)
    const rejected = resultsFor(r, 'memory_add', { allowError: true })
    assert(/secret|credential|blocked|refus/i.test(JSON.stringify(rejected)), 'scanner did not report rejection')
    assert(!memories().some(m => m.content.includes(fakeSecret)), 'rejected credential was persisted')
    await record('secret-scanner', r)

    const name = `full-skill-${nonce()}`
    const body = `PATCHED${nonce()}`
    r = await prompt('skill-crud', `Using only skill_manage: create a global skill named ${name}, description "Checks a portable acceptance procedure", scope=global, content="## Procedure\nReturn ORIGINAL."; view it; patch its Procedure section to "Return ${body}."; view it again; update its full content to "## Procedure\nReturn FINAL${body}."; finally view it again. Carry out all six operations in order.`)
    const actions = r.filter(e => e.type === 'tool/call' && e.data.name === 'skill_manage').map(e => JSON.parse(e.data.arguments).action)
    assert.deepEqual(actions, ['create', 'view', 'patch', 'view', 'update', 'view'])
    resultsFor(r, 'skill_manage')
    await record('skill-crud', r)
    r = await prompt('skill-updated-restart', `Use the native skill tool to load ${name}, follow it, and report its result. Do not use skill_manage or file tools.`)
    assert(JSON.stringify(resultsFor(r, 'skill')).includes(`FINAL${body}`))
    await record('skill-updated-restart', r)
    r = await prompt('skill-delete', `Use skill_manage action=delete skill_id=global:${name}. Do not use other tools.`)
    resultsFor(r, 'skill_manage')
    await record('skill-delete', r)
    r = await prompt('skill-deleted-restart', `For an acceptance check call the native skill tool with name=${name} once. Report its absence. Do not create any skill or use file tools.`)
    assert(/unknown|no longer available/i.test(JSON.stringify(resultsFor(r, 'skill', { allowError: true }))))
    await record('skill-deleted-restart', r)
  } else if (phase === 'cold-history') {
    const coldHome = join(root, `cold-history-${nonce()}`)
    const directory = join(coldHome, 'profiles/headless')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - .\nautoInstallPeers: false\nminimumReleaseAge: 0\nallowBuilds:\n  better-sqlite3: true\n  esbuild: true\n')
    const coldEnv = { ...env, DSH_HOME: coldHome }
    await run('cold-init', ['plugin', '--profile', 'headless', 'list'], { env: coldEnv })
    await writeFile(join(directory, 'cordis.patch.yml'), '- id: session-persistence-jsonl\n  config:\n    root: !!js dshHomePath("sessions")\n    compression: none\n')
    const word = `COLD${nonce()}`
    const manifestBefore = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert(!manifestBefore.dependencies?.pi2dsh && !manifestBefore.dependencies?.['pi-hermes-memory'])
    await run('cold-original-session', ['--profile', 'headless', `The legacy project code is ${word}. Reply ACK without using tools.`], { env: coldEnv })
    await run('cold-install-memory', ['plugin', '--profile', 'headless', 'add', '-w', engineDependency, 'pi-hermes-memory@0.9.8'], { env: coldEnv })
    await run('cold-history-recall', ['--profile', 'headless', 'Use session_search with query="legacy project code" to recover the old project code. Do not use any other tools.'], { env: coldEnv })
    const logs = await Promise.all((await h.files(join(coldHome, 'sessions'))).filter(path => /\/session(?:\.v\d+)?\.jsonl$/.test(path)).map(async path => ({ path, records: (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse) })))
    const recall = logs.find(s => s.records.some(e => e.type === 'user/message' && JSON.stringify(e.data).includes('recover the old project code')))
    assert(recall)
    assert(!JSON.stringify(recall.records.filter(e => e.type === 'user/message')).includes(word))
    assert.deepEqual(toolCalls(recall.records), ['session_search'])
    assert(JSON.stringify(resultsFor(recall.records, 'session_search')).includes(word), 'pre-install native history was not backfilled')
    await record('pre-install-native-history', recall.records, { coldHome, originalPluginDependencies: manifestBefore.dependencies, word, sessionFiles: logs.map(s => s.path) })
  } else if (phase === 'native-shutdown') {
    const nativeHome = join(root, 'native-shutdown-home')
    const directory = join(nativeHome, 'profiles/headless')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - .\nautoInstallPeers: false\nminimumReleaseAge: 0\n')
    const target = join(evidence, 'native-shutdown-observation.json')
    const nativeEnv = { ...env, DSH_HOME: nativeHome, NATIVE_SHUTDOWN_PROBE_OUT: target }
    await run('install-native-shutdown', ['plugin', '--profile', 'headless', 'add', '-w', resolve('fixtures/native-shutdown-probe')], { env: nativeEnv })
    await run('native-shutdown', ['--profile', 'headless', 'Reply NATIVE_LIVE_OK without using tools.'], { env: nativeEnv })
    const observation = JSON.parse(await readFile(target, 'utf8'))
    assert(observation.live.providers.includes(observation.route.provider), 'native route was not available before teardown')
    await record('native-shutdown-seam', [], { status: observation.finish?.kind === 'stop' ? 'passed' : 'model-error',
      build: { dshVersion: h.cliVersion, bridgeInstalled: false, fixture: 'fixtures/native-shutdown-probe' }, observation })
  } else if (phase === 'overflow-retry') {
    const input = JSON.parse(await readFile(join(root, 'overflow-retry.json'), 'utf8'))
    const r = await prompt('overflow-retry', input.text)
    resultsFor(r, 'memory_add')
    await record('overflow-retry', r, { after: memories().filter(m => m.target === 'user' && !m.project) })
  } else if (phase === 'overflow' || phase === 'cli-cancel') {
    await config()
    const old = memories().filter(m => m.target === 'user' && !m.project).map(m => m.content)
    if (old.length) {
      const cleared = await prompt('overflow-clear', `Using only memory_remove, delete each of these user-target fixture entries by its exact text: ${JSON.stringify(old)}. These are disposable acceptance data.`)
      resultsFor(cleared, 'memory_remove')
    }
    const word = `OVERFLOW${nonce()}`
    const seeds = ['First', 'Second', 'Third'].map(label => `${label} preference record: For all routine TypeScript development I prefer Vim as my text editor. Keep this Vim editor preference for all future work. ${word}.`)
    const seeded = await prompt('overflow-seed', `Using only memory_add target=user, save each of these three exact entries separately: ${JSON.stringify(seeds)}.`)
    resultsFor(seeded, 'memory_add')
    const before = memories().filter(m => m.target === 'user' && !m.project)
    const incoming = `Additional note ${word}: ${'Vim remains my preferred editor for future development. '.repeat(7)}`
    const beforeChars = before.map(m => m.content).join('\n§\n').length
    const limit = Math.max(incoming.length + 100, beforeChars + incoming.length - 70)
    assert(beforeChars + incoming.length > limit)
    await config({ memoryMode: 'legacy-inject', userCharLimit: limit, memoryOverflowStrategy: 'auto-consolidate', overflowGraceMs: 0,
      ...(phase === 'cli-cancel' ? { consolidationTimeoutMs: 1500 } : {}),
    })
    const r = await prompt('automatic-overflow-consolidation', `Call memory_add target=user content=${JSON.stringify(incoming)} once. Do not call any other tool or edit files. The plugin should handle its own storage limit.`)
    assert.deepEqual(toolCalls(r), ['memory_add'])
    if (phase === 'cli-cancel') {
      const results = resultsFor(r, 'memory_add', { allowError: true })
      assert(results.some(result => result.isError === true), 'worker finished before timeout; this does not prove cancellation')
      assert(/terminat|timeout|cancel/i.test(JSON.stringify(results)))
      assert(lastChildren.some(child => child.records.some(e => e.type === 'request/header')), 'worker never reached a real model call')
      const observed = memories()
      assert(!observed.some(m => m.content.includes(incoming.trim())))
      await sleep(2500)
      assert.deepEqual(memories(), observed, 'memory changed after worker cancellation completed')
      await record('cli-worker-cancellation', r, { limit, timeoutMs: 1500, after: observed })
      await config()
    } else {
    resultsFor(r, 'memory_add')
    const after = memories().filter(m => m.target === 'user' && !m.project)
    assert(after.some(m => m.content.includes(incoming.trim())))
    const afterChars = after.map(m => m.content).join('\n§\n').length
    assert(afterChars <= limit, 'store exceeded its configured cap instead of consolidating')
    assert(afterChars < beforeChars + incoming.length, 'no shrink happened')
    const markdownChars = (await readFile(join(agentDir, 'pi-hermes-memory/USER.md'), 'utf8')).length
    assert(markdownChars <= limit, 'persisted Markdown including metadata exceeded the cap')
    assert(lastChildren.some(child => child.records.some(e => e.type === 'tool/call' && ['memory_replace', 'memory_remove'].includes(e.data.name))), 'no native worker actually consolidated memory')
    for (const child of lastChildren) {
      assert(toolCalls(child.records).every(name => ['memory_add', 'memory_replace', 'memory_remove', 'memory_search'].includes(name)), 'worker bypassed the package tool path')
    }
    await record('automatic-overflow-consolidation', r, { beforeChars, incomingChars: incoming.length, afterChars, markdownChars, limit, before, after })
    await config()
    }
  } else if (phase === 'session-dispose') {
    await config({ flushOnShutdown: true, flushMinTurns: 1 })
    await run('install-session-probe', ['plugin', '--profile', 'web', 'add', '-w', resolve('fixtures/native-shutdown-probe')])
    const web = await openWeb('session-dispose')
    try {
      await web.fresh()
      await web.send('Reply ACK without using tools.')
      const word = `SESSIONFLUSH${nonce()}`
      const result = await web.send(`/native-session-flush-probe ${word}`)
      assert.equal(result.kind, 'success')
      const session = (await sessions()).find(s => s.records[0]?.id === result.text)
      assert(session)
      assert.equal(toolCalls(session.records).length, 0)
      assert(memories().some(m => m.content.includes(word)), 'per-agent shutdown flush did not save while host services remained alive')
      await record('per-agent-shutdown-flush', session.records, { saved: memories().filter(m => m.content.includes(word)) })
      await web.shot('native-session-disposed')
    } finally {
      await web.close()
      await run('remove-session-probe', ['plugin', '--profile', 'web', 'remove', '-w', 'pi2dsh-native-shutdown-probe'])
      await config()
    }
  } else if (phase === 'shutdown') {
    await config({ flushOnShutdown: true, flushMinTurns: 1 })
    const word = `FLUSH${nonce()}`
    const r = await prompt('shutdown-flush', `Our project's permanent release train name is ${word}; this is a public, non-secret project nickname used on every release. For this turn only reply ACK without calling any tools.`)
    assert.equal(toolCalls(r).length, 0, 'interactive model saved memory instead of the shutdown handler')
    const saved = memories().filter(m => m.content.includes(word))
    assert(saved.length > 0, 'awaited shutdown handler did not save the durable fact')
    await record('shutdown-flush', r, { saved })
    await config()
    const recalled = await prompt('shutdown-recall', 'Use memory_search query="release train name" to recall the project release train name. Do not use other tools.')
    assert(JSON.stringify(resultsFor(recalled, 'memory_search')).includes(word))
    await record('shutdown-recall', recalled)
  } else if (phase === 'project-isolation') {
    await config()
    const second = join(root, 'second-project')
    await mkdir(second, { recursive: true })
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', '-q', second])
    const one = `PROJECTONE${nonce()}`
    const two = `PROJECTTWO${nonce()}`
    let r = await prompt('project-one-save', `Use memory_add target=project to save "The project convention marker is ${one}." Do not use other tools.`)
    resultsFor(r, 'memory_add')
    await record('project-one-save', r)
    r = await prompt('project-two-save', `Use memory_add target=project to save "The project convention marker is ${two}." Do not use other tools.`, second)
    resultsFor(r, 'memory_add')
    await record('project-two-save', r)
    await config({ memoryMode: 'legacy-inject' })
    r = await prompt('project-one-context', 'Reply ACK without using tools.')
    assert(systemText(r).includes(one))
    assert(!systemText(r).includes(two), 'another project leaked into the active project prompt')
    await record('project-one-context', r, { nativeSystem: r.filter(e => e.type === 'system/message') })
    r = await prompt('project-two-context', 'Reply ACK without using tools.', second)
    assert(systemText(r).includes(two))
    assert(!systemText(r).includes(one))
    await record('project-two-context', r, { nativeSystem: r.filter(e => e.type === 'system/message') })
    await config()
  } else if (phase === 'policies') {
    const known = memories().find(m => m.target === 'user' && m.content.includes('DOMAINS'))
    assert(known, 'tools phase must seed a user memory')
    await config()
    let r = await prompt('policy-only', 'Reply ACK without using tools.')
    let system = systemText(r)
    assert(system.includes('<memory-policy>'))
    assert(!system.includes(known.content), 'policy-only unexpectedly injected stored content')
    await record('policy-only', r, { nativeSystem: r.filter(e => e.type === 'system/message') })
    await config({ memoryMode: 'legacy-inject' })
    r = await prompt('legacy-injection', 'Reply ACK without using tools.')
    system = systemText(r)
    assert(system.includes(known.content), 'legacy memory did not enter native model context')
    await record('legacy-injection', r, { nativeSystem: r.filter(e => e.type === 'system/message') })
    const custom = `CUSTOMPOLICY${nonce()}`
    await config({ memoryPolicyStyle: 'custom', memoryPolicyCustomText: custom })
    r = await prompt('custom-policy', 'Reply ACK without using tools.')
    assert(systemText(r).includes(custom))
    await record('custom-policy', r, { nativeSystem: r.filter(e => e.type === 'system/message') })
    await config({ memoryPolicyStyle: 'none' })
    r = await prompt('disabled-policy', 'Reply ACK without using tools.')
    assert(!systemText(r).includes('<memory-policy>'))
    await record('disabled-policy', r, { nativeSystem: r.filter(e => e.type === 'system/message') })
    await config({ sessionSearch: { variant: 'anchors' } })
    const core = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'))
    r = await prompt('anchor-search', `Use session_search with markdown="limit: 5\\n\\nall:\\n- ${core.codeword}" to find source anchors for that earlier conversation. Do not use any other tools.`)
    const text = resultsFor(r, 'session_search').flatMap(result => result.content ?? []).map(b => b.text ?? '').join('\n')
    const anchor = /(\/[^\s]+\.jsonl):(\d+)-(\d+)/.exec(text)
    assert(anchor, `no JSONL source anchor: ${text}`)
    const lines = (await readFile(anchor[1], 'utf8')).split('\n').slice(Number(anchor[2]) - 1, Number(anchor[3])).join('\n')
    assert(lines.includes(core.codeword), 'returned source anchor does not point to matching actual file content')
    await record('anchor-search', r, { anchor: anchor[0] })
    await config()
  } else if (phase === 'commands') {
    await config()
    const external = `external-catalog-${nonce()}`
    const externalDir = join(cwd, '.agents/skills', external)
    await mkdir(externalDir, { recursive: true })
    await writeFile(join(externalDir, 'SKILL.md'), `---\nname: ${external}\ndescription: Only use when explicitly asked to draw the Icarus catalog diagram.\n---\nDraw a small triangle.\n`)
    const web = await openWeb('commands')
    try {
      await web.fresh()
      const tag = `COMMANDS${nonce()}`
      await web.send(`This is acceptance session ${tag}. Reply ACK. For any interview later, ask your questions in ordinary chat text rather than using ask_user_question.`)
      const commands = [
        ['memory-insights', 'Memory Insights'],
        ['memory-skills', 'Skills'],
        ['memory-switch-project', 'Project Memory'],
        ['memory-index-sessions', 'Session indexing complete'],
        ['memory-sync-markdown', 'SQLite sync complete'],
        [`memory-pin Use ${tag} as a harmless response-format label.`, 'injected into every session'],
        ['memory-preview-context', 'Injected Context Preview'],
      ]
      for (const [command, text] of commands) {
        const result = await web.send(`/${command}`)
        assert((await web.text()).includes(text), `command did not display result: ${command}`)
        if (command === 'memory-skills') assert(result.text?.includes(external), 'native external skill is absent from the package read-only manager')
        await web.shot(command.split(' ')[0])
      }
      const guide = web.send('/learn-memory-tool')
      await web.page.getByRole('radio', { name: /Tools Available/i }).click({ timeout: 30000 })
      await web.page.getByRole('button', { name: /^submit$/i }).click()
      await guide
      assert((await web.text()).includes('memory_add'))
      await web.shot('learn-memory-guide')
      await web.send('/memory-consolidate')
      assert(/consolidated/i.test(await web.text()), 'no consolidation completed')
      await web.shot('manual-consolidate')
      await web.send('/memory-interview')
      await web.shot('interview-questions')
      await web.send(`My name is Profile${tag}. I develop TypeScript services, prefer concise responses and pnpm, and use the ${tag} workspace. Please store this profile now; do not ask any more questions.`)
      await until(() => memories().some(m => m.target === 'user' && m.content.includes(tag)), 'interview profile persisted')
      await web.shot('interview-persisted')
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && JSON.stringify(e.data).includes(`acceptance session ${tag}`)))
      assert(session)
      const done = session.records.filter(r => r.type === 'command/done')
      assert.equal(done.length, 10, 'all ten package commands must actually complete')
      assert(done.every(r => r.data.kind === 'success'))
      const index = done.find(r => r.data.text?.includes('Messages indexed:'))
      assert(index && !/Database totals:[\s\S]*├─ 0 messages/.test(index.data.text), 'history index is still empty')
      assert(done.some(r => r.data.text?.includes('consolidated')))
      const backendFailures = done.filter(r => /❌|failed in both transports/i.test(r.data.text ?? ''))
      await record('ten-commands', session.records, { status: backendFailures.length ? 'partial' : 'passed', backendFailures: backendFailures.map(e => e.data), savedProfile: memories().filter(m => m.target === 'user' && m.content.includes(tag)) })
    } finally { await web.close() }
  } else if (phase === 'consolidation') {
    await config()
    const web = await openWeb('consolidation')
    try {
      await web.fresh()
      const tag = `CONSOLIDATE${nonce()}`
      await web.send(`This is diagnostic session ${tag}. Reply ACK without tools.`)
      await web.send('/memory-consolidate')
      await web.shot('consolidation-result')
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && JSON.stringify(e.data).includes(tag)))
      assert(session)
      const result = session.records.find(e => e.type === 'command/done')
      assert(result)
      await record('consolidation', session.records, { status: /❌/.test(result.data.text ?? '') ? 'failed' : 'passed' })
    } finally { await web.close() }
  } else if (phase === 'compaction') {
    await config({ flushOnCompact: true, flushMinTurns: 1 })
    const web = await openWeb('compaction')
    try {
      await web.fresh()
      const word = `COMPACT${nonce()}`
      const buildLog = Array.from({ length: 120 }, (_, i) => `Transient build check ${i + 1}: completed successfully; no changes, warnings, or durable decisions.`).join(' ')
      await web.send(`Our permanent, public project nickname is ${word}. This is a durable convention for future development work. The following transient build log needs no memory storage:\n${buildLog}\nReply ACK without calling tools.`)
      await web.send('The nickname applies to the whole repository and every release. Reply ACK without calling tools.')
      assert(!memories().some(m => m.content.includes(word)), 'a different mechanism saved the fact before compaction')
      await web.send('/compact')
      await until(() => memories().some(m => m.content.includes(word)), 'compaction-triggered memory flush')
      await web.shot('compaction-flush')
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && e.data.source?.kind === 'user' && JSON.stringify(e.data).includes(word)))
      assert(session)
      assert(session.records.some(e => e.type === 'compaction/summary'), 'native compaction did not run')
      assert.equal(toolCalls(session.records).length, 0, 'foreground tools cannot prove compaction flush')
      await record('compaction-flush', session.records, { saved: memories().filter(m => m.content.includes(word)), timingContract: 'compaction/start is an observation, not an awaited veto gate' })
    } finally { await web.close() }
  } else if (['automatic-tools', 'model-override', 'model-fallback'].includes(phase)) {
    const word = `ROUTED${nonce()}`
    const wrong = `missing-model-${nonce()}`
    const options = phase === 'automatic-tools'
      ? { reviewEnabled: true, nudgeInterval: 1000, nudgeToolCalls: 1 }
      : { reviewEnabled: true, nudgeInterval: 1,
        llmModelOverride: `deepseek-official/${phase === 'model-override' ? 'deepseek-v4-pro' : wrong}`,
        llmThinkingOverride: phase === 'model-override' ? 'low' : 'off',
        ...(phase === 'model-fallback' ? { llmFallbackModels: ['deepseek-official/deepseek-flash'] } : {}),
      }
    await config(options)
    const settingsPath = join(home, 'settings.yaml')
    const previous = await readFile(settingsPath, 'utf8').catch(() => undefined)
    let recorder
    {
      const { liveModelRecorder } = await import('./lib/live-model-recorder.mjs')
      recorder = await liveModelRecorder(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', body => {
        const text = JSON.stringify(body.messages ?? [])
        return text.includes('--- Conversation to Review ---') && text.includes(word) ? 'maintenance' : 'foreground'
      })
      await writeFile(settingsPath, JSON.stringify({ 'llm-deepseek': { baseURL: recorder.url,
        ...(phase === 'model-fallback' ? { models: [{ id: wrong, name: 'Invalid route acceptance probe' }, { id: 'deepseek-flash', name: 'DeepSeek Flash' }] } : {}),
      } }))
    }
    let web
    try {
      web = await openWeb(phase)
      await web.fresh()
      await web.send(`Disposable diagnostic sequence ${word}; this is not a user preference or a project convention. Reply ACK without tools.`)
      await web.send('Continue the disposable diagnostic. Reply ACK without tools.')
      await web.send(phase === 'automatic-tools'
        ? 'Call memory_search once with query="absent routing probe"; then answer ACK. Use only that search tool for this reply.'
        : 'That completes the discussion. Reply ACK without tools.')
      await until(() => recorder.requests.some(r => r.kind === 'maintenance' && r.completed && r.status === 200), `${phase} completed its real review request`, 150000)
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && e.data.source?.kind === 'user' && JSON.stringify(e.data).includes(word)))
      assert(session)
      if (phase === 'automatic-tools') assert.deepEqual(toolCalls(session.records), ['memory_search'])
      else assert.equal(toolCalls(session.records).length, 0)
      const requests = recorder?.requests.filter(r => r.kind === 'maintenance') ?? []
      assert(requests.some(r => r.completed && r.status === 200), 'maintenance did not complete a real model request')
      if (phase === 'model-override') {
        assert(requests.some(r => r.model === 'deepseek-v4-pro' && r.completed && r.status === 200))
        assert(requests.some(r => r.reasoningEffort === 'low'), 'thinking override did not reach the real request')
      }
      if (phase === 'model-fallback') {
        const failed = requests.findIndex(r => r.model === wrong && r.status >= 400)
        assert(failed >= 0, 'configured primary did not produce a real upstream error')
        assert(requests.slice(failed + 1).some(r => r.model === 'deepseek-flash' && r.completed && r.status === 200))
      }
      await web.shot(phase)
      await record(phase, session.records, { requests,
        purpose: phase === 'automatic-tools' ? 'tool-call threshold triggers review independently of the turn threshold' : 'explicit maintenance model routing and fallback',
        storedEntriesMentioningMarker: memories().filter(m => m.content.includes(word)),
      })
    } finally {
      await web?.close()
      if (recorder) await writeFile(join(evidence, `${phase}-requests.json`), JSON.stringify(recorder.requests, null, 2))
      await recorder?.close()
      if (recorder) {
        if (previous === undefined) await unlink(settingsPath)
        else await writeFile(settingsPath, previous)
      }
      await config()
    }
  } else if (phase === 'automatic' || phase === 'subprocess-review') {
    await config({ reviewEnabled: true, nudgeInterval: 1, nudgeToolCalls: 1,
      ...(phase === 'subprocess-review' ? { reviewTransport: 'subprocess', llmModelOverride: 'deepseek-official/deepseek-v4-pro', llmThinkingOverride: 'off' } : {}),
    })
    const web = await openWeb(phase)
    try {
      await web.fresh()
      const word = `REVIEW${nonce()}`
      await web.send(`For diagrams, my permanent preferred color palette is ${word}. Reply ACK only, without calling tools.`)
      await web.send('This diagram palette applies to all future diagrams and is a durable personal preference. Reply ACK only, without calling tools.')
      await web.send('That is all for today. Reply ACK only, without calling tools.')
      const saved = await until(() => memories().filter(m => m.content.includes(word)).length > 0, 'automatic review persistence')
      assert(saved)
      await web.shot('automatic-review-saved')
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && e.data.source?.kind === 'user' && JSON.stringify(e.data).includes(word)))
      assert(session)
      assert.equal(toolCalls(session.records).length, 0, 'foreground model used tools; this would not prove background review')
      if (phase === 'subprocess-review') {
        await until(async () => (await sessions()).some(s => s.records[0]?.parentSession === session.records[0]?.id && s.records.some(e => e.type === 'turn/end' && e.data.reason?.kind === 'completed')), 'native review worker completion')
        const children = (await sessions()).filter(s => s.records[0]?.parentSession === session.records[0]?.id)
        assert(children.length > 0, 'forced subprocess review did not run a native worker')
        const headers = children.flatMap(s => s.records.filter(e => e.type === 'request/header'))
        assert(headers.some(e => e.data.header?.config?.model === 'deepseek-v4-pro'), 'CLI model selection did not reach native DSH')
        assert(headers.every(e => e.data.header?.config?.reasoningEffort === 'off'), 'CLI --thinking off was dropped')
      }
      await record(phase === 'automatic' ? 'automatic-review' : phase, session.records, { saved: memories().filter(m => m.content.includes(word)) })
    } finally { await web.close() }
  } else if (phase === 'review-cancel') {
    await config({ reviewEnabled: true, nudgeInterval: 1, llmThinkingOverride: 'high' })
    const word = `CANCEL${nonce()}`
    const { liveModelRecorder } = await import('./lib/live-model-recorder.mjs')
    const recorder = await liveModelRecorder(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', body => {
      const text = JSON.stringify(body.messages ?? [])
      return text.includes('--- Conversation to Review ---') && text.includes(word) ? 'maintenance' : 'foreground'
    })
    const settingsPath = join(home, 'settings.yaml')
    const previous = await readFile(settingsPath, 'utf8').catch(() => undefined)
    await writeFile(settingsPath, `llm-deepseek:\n  baseURL: ${recorder.url}\n`)
    let web
    try {
      web = await openWeb('review-cancel')
      await web.fresh()
      await web.send(`Our new durable release train is ${word}; this is a public project name. Reply ACK without tools.`)
      await web.send('It applies to all future releases. Reply ACK without tools.')
      const finalTurn = web.send('Confirm the convention in one word, without tools.').catch(() => {})
      const active = await until(() => recorder.requests.find(r => r.kind === 'maintenance' && !r.completed), 'real maintenance HTTP request start')
      assert.equal(active.completed, false, 'review finished before cancellation could be issued')
      active.shutdownRequestedAt = Date.now()
      await web.close()
      web = undefined
      await finalTurn
      await until(() => active.cancelled, 'maintenance request aborted by native shutdown')
      assert.equal(active.completed, false)
      assert(active.cancelledAt - active.shutdownRequestedAt < 3000, 'cancellation only happened at forced process exit')
      assert(!memories().some(m => m.content.includes(word)), 'aborted review committed a memory')
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && e.data.source?.kind === 'user' && JSON.stringify(e.data).includes(word)))
      assert(session)
      assert.equal(toolCalls(session.records).length, 0)
      await record('background-review-cancellation', session.records, { requests: recorder.requests })
    } finally {
      await web?.close()
      await writeFile(join(evidence, 'review-cancel-requests.json'), JSON.stringify(recorder.requests, null, 2))
      await recorder.close()
      if (previous === undefined) await unlink(settingsPath)
      else await writeFile(settingsPath, previous)
      await config()
    }
  } else if (phase === 'correction') {
    await config({ correctionDetection: true })
    const web = await openWeb('correction')
    try {
      await web.fresh()
      const word = `CORRECT${nonce()}`
      await web.send(`No, that is wrong. Our permanent release tool is ${word}, never the old tool. Always use ${word} for this project. For this reply say ACK only without calling tools.`)
      await until(() => memories().some(m => m.content.includes(word)), 'automatic correction persistence')
      await web.shot('correction-saved')
      const session = (await sessions()).find(s => s.records.some(e => e.type === 'user/message' && e.data.source?.kind === 'user' && JSON.stringify(e.data).includes(word)))
      assert(session)
      assert.equal(toolCalls(session.records).length, 0)
      await record('correction', session.records, { saved: memories().filter(m => m.content.includes(word)) })
    } finally { await web.close() }
  } else throw new Error(`unknown full phase ${phase}`)
} catch (error) {
  await writeFile(join(evidence, `${phase}-failure.json`), JSON.stringify({ phase, status: 'failed', build, error: clean(error.stack ?? String(error)) }, null, 2))
  throw error
} finally {
  await writeFile(join(evidence, `${phase}-summary.json`), JSON.stringify({ phase, build, reports }, null, 2))
}
