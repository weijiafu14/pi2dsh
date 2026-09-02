#!/usr/bin/env node
// pi-code (Claude Code configuration for Pi) on the DSH web app, user path only:
// a fresh DSH_HOME, `dsh plugin add` of the engine and the real npm package, a
// workspace that ships a `.claude/` tree, a real model. The browser answers
// pi-code's "Trust this project?" question (DSH's native user-questions
// dialog); every functional assertion is read from the session log, never from
// page text:
//   - settings.json `env`      → the bash tool's own result carries the codeword
//   - PreToolUse hook (Bash)   → the hook's marker file exists on disk
//   - CLAUDE.md `@import`      → the imported codeword sits in request/header.system
//   - .claude/skills           → the skill's description is in DSH's skill catalog message
// Screenshots (question dialog, answered turns) are for human eyes.
//
// Usage: DEEPSEEK_API_KEY=… node scripts/verify-pi-code-web-e2e.mjs [out.json]
import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createE2eHarness } from './lib/e2e-harness.mjs'

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
const piCodeSpec = process.env.PI_CODE_SPEC ?? 'pi-code'
const outputPath = resolve(process.argv[2] ?? 'community/pi-code-web-e2e.json')
const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')

const scratch = await realpath(await mkdtemp(join(tmpdir(), 'pi2dsh-picode-web-')))
let web
try {
  const { home, env, runDsh } = await makeHome(scratch)
  await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
  await runDsh(['plugin', '--profile', 'web', 'add', piCodeSpec])
  await useJsonlSessions(home, 'web')
  const installed = JSON.parse(await readFile(join(home, 'profiles/web/node_modules/pi-code/package.json'), 'utf8'))
  console.log(`[pi-code-web] pi-code@${installed.version}`)

  // The workspace: Claude-shaped configuration only. Each codeword lives
  // solely where the feature under test reads it.
  const CW = () => Math.floor(1000 + Math.random() * 9000)
  const ENV_CW = `ENVPROBE-${CW()}`
  const IMPORT_CW = `IMPORTPROBE-${CW()}`
  const HOOK_MARK = join(scratch, `hook-fired-${CW()}`)
  const project = join(scratch, 'workspace')
  await mkdir(join(project, '.claude', 'skills', 'demo-skill'), { recursive: true })
  await mkdir(join(project, 'notes'), { recursive: true })
  await writeFile(join(project, '.git'), '')
  await writeFile(join(project, 'CLAUDE.md'), '# Probe project\n\n@notes/imported.md\n')
  await writeFile(join(project, 'notes', 'imported.md'), `The secret import codeword is ${IMPORT_CW}. When asked for the import codeword, reply with it verbatim.\n`)
  await writeFile(join(project, '.claude', 'settings.json'), JSON.stringify({
    env: { PI_CODE_PROBE: ENV_CW },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `touch ${HOOK_MARK}` }] }] },
  }, null, 2))
  await mkdir(join(project, '.claude', 'commands'), { recursive: true })
  await writeFile(join(project, '.claude', 'commands', 'greet.md'), '---\ndescription: greet probe\n---\nReply with exactly the text GREET-COMMAND-OK and nothing else.\n')
  await writeFile(join(project, '.claude', 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: A probe skill that explains the demo protocol\n---\nWhen invoked, reply with exactly SKILL-DEMO-OK.\n')

  const port = Number(process.env.PI_CODE_WEB_PORT ?? 5199)
  const portFree = await fetch(`http://127.0.0.1:${port}`).then(() => false).catch(() => true)
  if (!portFree) throw new Error(`port ${port} is already serving — kill the leftover dsh web first (lsof -ti :${port} | xargs kill)`)
  web = spawn(
    directDshBin === undefined ? 'node' : directDshBin,
    directDshBin === undefined
      ? ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port), '--no-open']
      : ['--profile', 'web', '--port', String(port), '--no-open'],
    { cwd: dshCwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let webLog = ''
  web.stdout.on('data', chunk => { webLog += String(chunk) })
  web.stderr.on('data', chunk => { webLog += String(chunk) })
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 90_000
  for (;;) {
    if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog.slice(-4000)}`)
    const up = await fetch(url).then(r => r.ok || r.status === 401).catch(() => false)
    if (up) break
    if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog.slice(-4000)}`)
    await new Promise(done => setTimeout(done, 500))
  }
  const gated = await fetch(url).then(response => response.status === 401).catch(() => false)
  const tokenDeadline = Date.now() + (gated ? 90_000 : 0)
  let authed = url
  for (;;) {
    const token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(webLog)
    if (token !== null) { authed = `${url}/?token=${token[1]}`; break }
    if (web.exitCode !== null) throw new Error(`dsh web died after opening its port:\n${webLog.slice(-4000)}`)
    if (Date.now() > tokenDeadline) {
      if (gated) throw new Error(`dsh web answers 401 but printed no ?token= url:\n${webLog.slice(-4000)}`)
      break
    }
    await new Promise(done => setTimeout(done, 500))
  }

  const shots = join(scratch, 'shots')
  await execFile('node', [
    join(projectRoot, 'docs/posting-kit/capture-pi-code-web.mjs'), shots,
    '--url', authed, '--env-codeword', ENV_CW, '--import-codeword', IMPORT_CW,
  ], {
    cwd: projectRoot,
    env: { ...env, PLAYWRIGHT_FROM: playwrightFrom, CAPTURE_WORKSPACE: project },
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch(error => { console.log(String(error.stdout ?? ''), String(error.stderr ?? '')); throw error })

  // Evidence: the session log(s) this home produced.
  const files = []
  const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.name === 'session.jsonl') files.push(path) } }
  await walk(join(home, 'sessions'))
  const records = []
  for (const file of files.sort()) records.push(...(await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)))

  const envSeen = records.some(r => r.type === 'tool/result' && JSON.stringify(r.data?.message?.content ?? '').includes(ENV_CW))
  const hookFired = existsSync(HOOK_MARK)
  const importCarrier = records.filter(r => r.type === 'request/header' && String(r.data?.header?.system ?? '').includes(IMPORT_CW))
  const skillCarrier = records.filter(r => r.type === 'user/message' && r.data?.source?.kind !== 'user' && JSON.stringify(r.data).includes('A probe skill that explains the demo protocol'))
  const trustAsked = records.some(r => JSON.stringify(r).includes('Trust this project'))
  // The command body exists only in .claude/commands/greet.md; the expansion enters the
  // conversation as a plugin-sourced message (or a command/run record), never as user text.
  const commandCarrier = records.filter(r => (r.type === 'user/message' && r.data?.source?.kind !== 'user' && JSON.stringify(r.data).includes('GREET-COMMAND-OK'))
    || (r.type === 'command/run' && JSON.stringify(r.data).includes('greet')))
  const results = {
    piCodeVersion: installed.version,
    settingsEnv: { pass: envSeen, codeword: ENV_CW },
    preToolUseHook: { pass: hookFired, marker: HOOK_MARK },
    claudeMdImport: { pass: importCarrier.length > 0, codeword: IMPORT_CW },
    claudeSkillsDiscovered: { pass: skillCarrier.length > 0 },
    commandsUserPath: { pass: commandCarrier.length > 0, carriers: commandCarrier.map(r => r.type) },
    trustQuestionInLog: trustAsked,
    sessions: files.length,
  }
  for (const [name, entry] of Object.entries(results)) if (typeof entry === 'object' && 'pass' in entry) console.log(`[pi-code-web] ${name} → ${entry.pass ? 'PASS' : 'FAIL'}`)
  const taken = (await readdir(shots)).sort()
  for (const required of ['01-trust-question.png', '02-env-answered.png', '03-import-answered.png', '04-slash-command.png']) {
    assert(taken.includes(required), `missing ${required} — got ${JSON.stringify(taken)}`)
  }
  const passed = envSeen && hookFired && importCarrier.length > 0 && skillCarrier.length > 0 && commandCarrier.length > 0
  await writeFile(outputPath, JSON.stringify({ results: { piCodeWeb: { status: passed ? 'passed' : 'failed', ...results, screenshots: taken, scratch } } }, null, 2))
  console.log(`[pi-code-web] ${passed ? 'passed' : 'FAILED'} — shots at ${shots}; evidence → ${outputPath}`)
  if (!passed) process.exitCode = 1
} finally {
  web?.kill('SIGTERM')
  if (process.env.PI2DSH_KEEP_SCRATCH === '1' || process.exitCode === 1) console.error(`kept scratch: ${scratch}`)
  else {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await rm(scratch, { recursive: true, force: true }); break } catch (error) {
        if (attempt === 3) console.error(`[pi-code-web] scratch cleanup left ${scratch}: ${String(error)}`)
        else await new Promise(done => setTimeout(done, 700))
      }
    }
  }
}
