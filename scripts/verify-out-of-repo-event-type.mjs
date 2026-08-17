#!/usr/bin/env node
// Why pi2dsh keeps Pi's custom entries beside the DSH session log instead of in it.
//
//   node scripts/verify-out-of-repo-event-type.mjs
//
// Three variants of ONE real session, each opened in a real `dsh web` and
// clicked the way a user clicks it:
//   A untouched                         -> opens
//   B + an event type declared outside   -> the app shows "Failed to load
//     the DSH repository                    history: SessionFormatUnsupportedError"
//   C + the same event, ignorable: true  -> opens
//
// B is what `session.append('pi2dsh/entry', ...)` produces from a package that
// lives outside the DSH repository, and `Session.append(type, data, ...opts)`
// takes only a SurfaceIntent — there is no way for such a package to produce C.
// So writing Pi's custom entries into the durable log would hand users sessions
// that cannot be opened. Reported upstream:
// https://github.com/deepseek-ai/deepseek-harness/discussions/2708
//
// Needs DEEPSEEK_API_KEY (one real turn) and a DSH checkout beside this repo.
import { execFile as execFileCb, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, chmod, readFile, readdir, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const execFile = promisify(execFileCb)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
// The DSH checkout this repo is developed against, beside it by convention.
const dshRoot = process.env.DSH_ROOT ?? resolve(projectRoot, '../deepseek-harness')
const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
const { chromium } = createRequire(`${dshRoot}/apps/web/package.json`)('playwright')

const PROMPT = 'Reply with the single word: ready. No tools.'
const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-evt-'))
const home = join(scratch, 'dsh-home')
const shimDir = join(scratch, 'bin')
await mkdir(shimDir, { recursive: true })
await writeFile(join(shimDir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
await chmod(join(shimDir, 'pnpm'), 0o755)
const env = {
  ...process.env, DSH_HOME: home, PATH: `${shimDir}:${process.env.PATH ?? ''}`,
  CI: '1', NO_COLOR: '1', DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'danger-full-access',
  npm_config_registry: 'https://registry.npmjs.org', PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
}
const dsh = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args],
  { cwd: dshRoot, env, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
  .then(r => ({ ok: true, out: `${r.stdout}${r.stderr}` }))
  .catch(e => ({ ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message}` }))

const walk = async dir => {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path)); else out.push(path)
  }
  return out
}
const jsonl = profile => writeFile(join(home, `profiles/${profile}/cordis.patch.yml`), [
  '- id: session-persistence-jsonl', '  config:', "    root: !!js dshHomePath('sessions')",
  '    compression: none', '',
].join('\n'))

try {
  await mkdir(home, { recursive: true })
  await dsh(['plugin', '--profile', 'headless', 'add', `file:${projectRoot}`])
  await dsh(['plugin', '--profile', 'web', 'add', `file:${projectRoot}`])
  await jsonl('headless'); await jsonl('web')
  const made = await dsh(['--profile', 'headless', PROMPT])
  console.log('turn created:', made.ok)

  const log = (await walk(join(home, 'sessions'))).filter(p => p.endsWith('session.jsonl'))[0]
  const pristine = join(scratch, 'pristine.jsonl')
  await copyFile(log, pristine)
  const lines = (await readFile(pristine, 'utf8')).split('\n').filter(Boolean)
  const last = JSON.parse(lines.at(-1))
  console.log(`session log: ${lines.length} events, last seq ${last.seq}\n`)
  const ours = {
    type: 'pi2dsh/entry', seq: last.seq + 1, time: last.time + 1,
    data: { customType: 'btw-note', text: 'a note a Pi plugin appended' },
  }

  let port = 5310
  const attempt = async (label, extra) => {
    await copyFile(pristine, log)
    if (extra !== undefined) await writeFile(log, `${[...lines, JSON.stringify({ ...ours, ...extra })].join('\n')}\n`)
    port += 1
    const web = spawn('node', ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)],
      { cwd: dshRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let serverLog = ''
    web.stdout.on('data', c => { serverLog += String(c) })
    web.stderr.on('data', c => { serverLog += String(c) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    while (!(await fetch(url).then(() => true).catch(() => false))) {
      if (Date.now() > deadline || web.exitCode !== null) break
      await new Promise(done => setTimeout(done, 500))
    }

    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const notice = page.getByRole('button', { name: 'Continue' })
    if (await notice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) {
      await notice.click()
      await page.waitForFunction(() => document.querySelectorAll('[class*="_mask_"]').length === 0, undefined, { timeout: 20_000 }).catch(() => {})
    }
    // Adopt the workspace the session belongs to, so its sessions are listed.
    await page.evaluate(async path => {
      await fetch('/api/workspace.create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'p', method: 'workspace.create', payload: { path } }),
      })
    }, dshRoot)
    await page.reload({ waitUntil: 'domcontentloaded' })
    if (await notice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) {
      await notice.click()
      await page.waitForFunction(() => document.querySelectorAll('[class*="_mask_"]').length === 0, undefined, { timeout: 20_000 }).catch(() => {})
    }

    // Click the stored session in the sidebar. Its row is labelled by the
    // session title, which DSH derives from the first prompt.
    const rows = await page.getByRole('treeitem').allInnerTexts().catch(() => [])
    console.log(`   sidebar rows: ${JSON.stringify(rows.map(r => r.replace(/\s+/gu, ' ').slice(0, 60)))}`)
    const buttons = await page.locator('[class*="session"], [data-session-id]').allInnerTexts().catch(() => [])
    console.log(`   session-ish : ${JSON.stringify(buttons.map(r => r.replace(/\s+/gu, ' ').slice(0, 60)).slice(0, 8))}`)
    // Pick the row by index instead of a locator filter: the tree nests, so a
    // filtered locator can match the parent (or nothing) while the row is
    // plainly there in the text dump.
    const all = page.getByRole('treeitem')
    const index = rows.findIndex(t => /\b(now|\d+\s*(min|hour|day|sec))/iu.test(t) && !/New Session/iu.test(t))
    const listed = index >= 0
    if (listed) await all.nth(index).click({ timeout: 20_000 }).catch(error => console.log(`   click failed: ${String(error).slice(0, 120)}`))
    // Wait for the session's own words rather than a fixed pause.
    await page.waitForFunction(
      needle => document.body.innerText.includes(needle),
      'single word', { timeout: 20_000 },
    ).catch(() => {})

    const screen = (await page.locator('body').innerText()).replace(/\s+/gu, ' ')
    const loaded = screen.includes('single word') || /\bready\b/iu.test(screen)
    const complained = /unknown to this harness|refusing to interpret|not marked ignorable|unsupported/iu.test(screen + serverLog)
    await browser.close()
    web.kill('SIGTERM')
    await new Promise(done => setTimeout(done, 800))

    console.log(`${label}`)
    console.log(`   session row listed : ${listed}`)
    console.log(`   its text on screen : ${loaded}`)
    console.log(`   refusal reported   : ${complained}`)
    const line = (screen + '\n' + serverLog).split('\n').find(l => /unknown to this harness|refusing to interpret|not marked ignorable/iu.test(l))
    if (line !== undefined) console.log(`   → ${line.trim().slice(0, 260)}`)
    console.log(`   screen: ${screen.slice(0, 200)}\n`)
    return loaded
  }

  const a = await attempt('A untouched')
  const b = await attempt('B + our own event type', {})
  const c = await attempt('C + same, ignorable:true', { ignorable: true })
  console.log(`VERDICT  A=${a ? 'opens' : 'BROKEN'}  B=${b ? 'opens' : 'BROKEN'}  C=${c ? 'opens' : 'BROKEN'}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
