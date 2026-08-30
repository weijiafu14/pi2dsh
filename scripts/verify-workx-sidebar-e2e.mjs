#!/usr/bin/env node
// The sidebar half of the suite's Memory/Tasks surfaces: with the community
// dsh-better-sidebar installed, the suite's Memory and Tasks tabs must appear
// in the per-session right sidebar and carry the same live data as their
// stock seats. Per the 2026-08-30 visual standard, each tab is opened,
// asserted against store-only content, and screenshotted for human eyes.
//
// Usage: DEEPSEEK_API_KEY=… node scripts/verify-workx-sidebar-e2e.mjs [out.json]
import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createE2eHarness } from './lib/e2e-harness.mjs'
import { stageSuiteTarball } from './lib/suite-tarball.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
  ? resolve(projectRoot, '..', 'deepseek-harness')
  : resolve(process.env.PI2DSH_DSH_ROOT)
const directDshBin = process.env.PI2DSH_DSH_BIN === undefined ? undefined : resolve(process.env.PI2DSH_DSH_BIN)
const dshBin = directDshBin ?? join(dshRoot, 'apps/cli/src/bin.ts')
const dshCwd = resolve(process.env.PI2DSH_DSH_CWD ?? dshRoot)
const { makeHome, useJsonlSessions } = createE2eHarness({ dshRoot, directDshBin, dshBin, dshCwd })

const apiKey = process.env.DEEPSEEK_API_KEY
assert(apiKey, 'DEEPSEEK_API_KEY is required')
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`
const outputPath = resolve(process.argv[2] ?? 'community/workx-sidebar-e2e.json')
const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-workx-sb-'))
let web
try {
  const { home, env, runDsh } = await makeHome(scratch)
  const tarball = await stageSuiteTarball(projectRoot, engineSpec, scratch, env)
  await runDsh(['plugin', '--profile', 'web', 'add', tarball])
  await runDsh(['plugin', '--profile', 'web', 'add', 'dsh-better-sidebar'])
  await useJsonlSessions(home, 'web')
  const workspace = join(scratch, 'workspace')
  await mkdir(workspace, { recursive: true })

  const port = Number(process.env.WORKX_SB_PORT ?? 5197)
  web = spawn(
    directDshBin === undefined ? 'node' : directDshBin,
    directDshBin === undefined
      ? ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)]
      : ['--profile', 'web', '--port', String(port)],
    { cwd: dshCwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let webLog = ''
  web.stdout.on('data', chunk => { webLog += String(chunk) })
  web.stderr.on('data', chunk => { webLog += String(chunk) })
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 90_000
  for (;;) {
    if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
    const up = await fetch(url).then(r => r.ok || r.status === 401).catch(() => false)
    if (up) break
    if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
    await new Promise(done => setTimeout(done, 500))
  }
  const token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(webLog)
  const authed = token === null ? url : `${url}/?token=${token[1]}`

  const CODEWORD = `BOREAL-${Math.floor(1000 + Math.random() * 9000)}`
  const shots = join(scratch, 'shots')
  await execFile('node', [
    join(projectRoot, 'docs/posting-kit/capture-workx-sidebar.mjs'), shots,
    '--url', authed, '--codeword', CODEWORD,
  ], {
    cwd: projectRoot,
    env: { ...env, PLAYWRIGHT_FROM: playwrightFrom, CAPTURE_WORKSPACE: workspace },
    timeout: 420_000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch(error => { console.log(String(error.stdout ?? ''), String(error.stderr ?? '')); throw error })

  const taken = (await readdir(shots)).sort()
  for (const required of ['01-sidebar-memory.png', '02-sidebar-tasks.png']) {
    assert(taken.includes(required), `missing ${required} — got ${JSON.stringify(taken)}`)
  }
  await writeFile(outputPath, JSON.stringify({ results: { workXSidebar: { status: 'passed', screenshots: taken } } }, null, 2))
  console.log(`[workx-sidebar] passed — shots kept at ${shots}`)
  console.log(`[workx-sidebar] evidence → ${outputPath}`)
} finally {
  web?.kill('SIGTERM')
  if (process.env.PI2DSH_KEEP_SCRATCH === '1') console.error(`kept scratch: ${scratch}`)
  else await rm(scratch, { recursive: true, force: true })
}
