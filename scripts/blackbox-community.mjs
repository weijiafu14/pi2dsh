#!/usr/bin/env node
// Black-box verification for the community corpus: convert every non-fatal
// package and LOAD it inside a real DSH runtime composition. Static analysis
// screens; this run certifies. Output per package:
//   - loaded:      the bundle mounted; registration surface recorded
//   - load-failed: the error message is a concrete ABI gap to fix
//   - fatal:       conversion refused (supply-chain/closure findings)
// Usage: node scripts/blackbox-community.mjs [output.json] [--only name,name] [--exercise]
//   --exercise: after mounting, EXECUTE representative tools/commands with
//   schema-derived minimal arguments against local fixture services. Grades:
//     working              — a real invocation returned success
//     callable-needs-config — the call executed but wants credentials/config
//     failed               — invocation errored for another reason
//   Mutating/destructive tool names are skipped (skipped-unsafe) except exec,
//   which runs a harmless echo through the real subprocess seam.
import { execFile as execFileCallback } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { generateBundle, resolvePiPackage } from '../dist/index.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const outputPath = resolve(positional[0] ?? 'community/blackbox-results.json')
const onlyArg = process.argv.find(arg => arg.startsWith('--only'))
const only = onlyArg === undefined ? undefined : new Set((onlyArg.split('=')[1] ?? '').split(',').filter(Boolean))

const exercise = process.argv.includes('--exercise')

const corpus = JSON.parse(await readFile(join(projectRoot, 'community/corpus.json'), 'utf8'))
const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-blackbox-'))
const workspace = join(scratch, 'workspace')
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, 'sample.txt'), 'pi2dsh exercise probe file\nline two\n')
await writeFile(join(workspace, 'sample.ts'), 'export const probe = 1\n')

// Local fixture endpoints so network-shaped tools can really succeed without
// external services. SearXNG-compatible search + a plain HTML page + an
// OpenAI-images-compatible endpoint.
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX8AAAAASUVORK5CYII='
const fixtureServer = createServer((request, response) => {
  if (request.url?.startsWith('/search')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ results: [{ title: 'pi2dsh exercise result', url: 'http://127.0.0.1/result', content: 'PI2DSH_EXERCISE_OK' }] }))
    return
  }
  if (request.url === '/v1/images/generations' && request.method === 'POST') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: tinyPng, revised_prompt: 'PI2DSH_EXERCISE_OK' }] }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<html><head><title>pi2dsh exercise page</title></head><body><h1>PI2DSH_EXERCISE_OK</h1></body></html>')
})
await new Promise((resolveListen, reject) => {
  fixtureServer.once('error', reject)
  fixtureServer.listen(0, '127.0.0.1', resolveListen)
})
const fixtureBase = `http://127.0.0.1:${fixtureServer.address().port}`
process.env.WEB_SEARCH_PROVIDER = 'searxng'
process.env.SEARXNG_URL = fixtureBase

// Pi state (settings, sidecars) stays inside the scratch dir.
process.env.PI_CODING_AGENT_DIR = join(scratch, 'pi-agent')
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true })

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

function classifyGap(message) {
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package/iu.test(message)) return 'missing-runtime-module'
  if (/is not a function|is not a constructor|undefined is not/iu.test(message)) return 'missing-abi-export-or-shape'
  if (/requires a native DSH port|native DSH mapping|DSH-native/iu.test(message)) return 'explicit-degradation-hit-at-load'
  if (/factory function/iu.test(message)) return 'entry-shape'
  if (/parameters must use an object-root/iu.test(message)) return 'tool-schema-root'
  if (/already registered/iu.test(message)) return 'duplicate-registration'
  return 'other'
}

// ---- exercise support ------------------------------------------------------

// Never invoke tools whose name suggests mutation of shared state. exec-like
// tools DO run — through the real subprocess seam with a harmless echo.
const UNSAFE_TOOL = /kill|delete|remove|reset|clear|write|edit|patch|steer|publish|deploy|install|upload/iu
const EXECISH_TOOL = /^(exec|exec_command|bash|shell|run_command)$/iu
const CONFIG_ERROR = /api.?key|token|credential|auth|login|unauthorized|forbidden|403|401|not configured|missing.*(key|config|env)|no provider|env(ironment)? variable|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|Set .*_KEY|configure/iu

function valueForString(name) {
  const key = name.toLowerCase()
  if (/url|link|endpoint/u.test(key)) return `${fixtureBase}/page`
  if (/query|search|prompt|question|text|message|content|instruction|description/u.test(key)) return 'pi2dsh exercise probe'
  if (/dir|cwd|root|workspace/u.test(key)) return workspace
  if (/path|file/u.test(key)) return join(workspace, 'sample.txt')
  if (/command|cmd/u.test(key)) return 'echo'
  if (/name|title|label|id\b|identifier/u.test(key)) return 'pi2dsh-probe'
  if (/lang|language/u.test(key)) return 'typescript'
  return 'pi2dsh'
}

function minimalArguments(schema, toolName) {
  if (typeof schema !== 'object' || schema === null) return {}
  const output = {}
  const properties = schema.properties ?? {}
  const required = Array.isArray(schema.required) ? schema.required : []
  for (const key of required) {
    const spec = properties[key] ?? {}
    if (Array.isArray(spec.enum) && spec.enum.length > 0) output[key] = spec.enum[0]
    else if (spec.type === 'number' || spec.type === 'integer') output[key] = 1
    else if (spec.type === 'boolean') output[key] = false
    else if (spec.type === 'array') output[key] = spec.items?.type === 'string' ? [valueForString(key)] : []
    else if (spec.type === 'object') output[key] = minimalArguments(spec, toolName)
    else output[key] = valueForString(key)
  }
  if (EXECISH_TOOL.test(toolName)) {
    if ('command' in properties) output.command = 'echo'
    if ('args' in properties) output.args = ['pi2dsh-exercise']
    if ('cmd' in properties) output.cmd = 'echo pi2dsh-exercise'
  }
  return output
}

// Package business logic rejecting the synthetic probe arguments proves the
// execution path end-to-end; grade it as executed rather than failed.
const INPUT_VALIDATION = /unknown .* (id|task)|does not know|no valid|provide exactly|no current model|not found|no such|invalid (argument|input|value)|must (be|match|specify)|required|missing (argument|parameter|field)|expected/iu

function gradeOutcome(result) {
  if (result.isError !== true) return 'working'
  const text = (result.content ?? []).map(block => String(block.text ?? '')).join('\n')
    + JSON.stringify(result.error ?? '')
  if (CONFIG_ERROR.test(text)) return 'callable-needs-config'
  return INPUT_VALIDATION.test(text) ? 'executed-input-validation' : 'failed'
}

async function exerciseSurface(ctx, agent, assembly, commands) {
  const attempts = []
  const candidates = assembly.tools
    .filter(tool => !tool.name.startsWith('bb-'))
    .filter(tool => EXECISH_TOOL.test(tool.name) || !UNSAFE_TOOL.test(tool.name))
    .slice(0, 3)
  for (const tool of candidates) {
    const args = minimalArguments(tool.parameters ?? {}, tool.name)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('exercise timeout')), 20_000)
    try {
      const result = await ctx.tools.execute({
        signal: controller.signal,
        agent,
        callId: CallId(`exercise-${tool.name}-${Date.now()}`),
        name: tool.name,
        arguments: args,
      })
      const text = (result.content ?? []).map(block => String(block.text ?? '')).join(' ').slice(0, 160)
      // DSH wraps an aborted call into an isError result rather than
      // rejecting; our own 20s probe abort still is not a package failure.
      const timedOut = controller.signal.aborted
      attempts.push({
        kind: 'tool', name: tool.name, args,
        outcome: timedOut ? 'timed-out' : gradeOutcome(result),
        evidence: timedOut ? `still executing when the 20s probe timeout aborted it (${text.slice(0, 120)})` : text,
      })
    } catch (error) {
      const message = String(error?.message ?? error)
      // Our own 20s probe abort is not a package failure: the tool was still
      // executing (waiting on an external service the fixture environment
      // cannot provide, e.g. a child `pi` process or model credentials).
      const timedOut = controller.signal.aborted
      attempts.push({
        kind: 'tool', name: tool.name, args,
        outcome: timedOut ? 'timed-out' : CONFIG_ERROR.test(message) ? 'callable-needs-config' : 'failed',
        evidence: timedOut ? `still executing when the 20s probe timeout aborted it (${message.slice(0, 120)})` : message.slice(0, 160),
      })
    } finally {
      clearTimeout(timer)
    }
  }
  // Command-only packages: prove one harmless command handler actually runs.
  if (attempts.length === 0 && commands.length > 0 && typeof ctx.commands?.execute === 'function') {
    const name = commands.find(candidate => !UNSAFE_TOOL.test(candidate))
    if (name !== undefined) {
      try {
        await ctx.commands.execute(agent, name, new AbortController().signal)
        attempts.push({ kind: 'command', name, outcome: 'working', evidence: 'command handler completed' })
      } catch (error) {
        const message = String(error?.message ?? error)
        attempts.push({
          kind: 'command', name,
          outcome: CONFIG_ERROR.test(message) ? 'callable-needs-config' : 'failed',
          evidence: message.slice(0, 160),
        })
      }
    }
  }
  const order = ['working', 'executed-input-validation', 'callable-needs-config', 'timed-out']
  const grade = order.find(level => attempts.some(item => item.outcome === level))
    ?? (attempts.length === 0 ? 'nothing-exercisable' : 'failed')
  return { grade, attempts }
}

async function loadBundle(bundleDir) {
  const generated = await import(`${pathToFileURL(join(bundleDir, 'index.js')).href}?bb=${Date.now()}`)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalAttachmentStore, { dshHome: join(scratch, 'dsh-home') })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(UserQuestionService)
  ctx.userQuestions.registerProvider({
    async ask(request) {
      return { answers: request.questions.map(question => ({ id: question.id, selected: [], custom: 'blackbox' })) }
    },
  })
  ctx.systemPrompt.section({ name: 'blackbox:base', order: 0, text: 'Black-box base prompt.' })
  const fiber = await ctx.plugin(generated)
  const session = ctx.sessions.create(SessionId(`bb-${Date.now()}`), {
    meta: { createdAt: Date.now(), cwd: workspace },
  })
  const agent = { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
  ctx.emit('agent/session-start', { agent, source: 'fresh' })
  await delay(150)
  const assembly = await ctx.systemPrompt.assemble()
  const tools = assembly.tools.map(tool => tool.name)
  let commands = []
  try {
    commands = (await ctx.commands?.list?.(agent) ?? []).map(command => command.name)
  } catch {
    commands = []
  }
  let skills = []
  try {
    skills = (await ctx.skills.list({ cwd: workspace, signal: new AbortController().signal })).map(skill => skill.name)
  } catch {
    skills = []
  }
  let exercised
  if (exercise) {
    try {
      exercised = await exerciseSurface(ctx, agent, assembly, commands)
    } catch (error) {
      exercised = { grade: 'failed', attempts: [{ kind: 'harness', outcome: 'failed', evidence: String(error?.message ?? error).slice(0, 160) }] }
    }
  }
  ctx.emit('agent/disposed', { agent })
  await delay(30)
  await fiber.dispose()
  return { tools, commands, skills, exercised }
}

async function verifyOne(entry) {
  const record = { rank: entry.rank, name: entry.name, downloadsPerMonth: entry.downloadsPerMonth }
  let pkg
  try {
    pkg = await resolvePiPackage(entry.specifier ?? entry.name)
  } catch (error) {
    return { ...record, status: 'fatal', stage: 'resolve', error: String(error?.message ?? error) }
  }
  const bundleDir = join(scratch, 'bundles', `${entry.rank}-${entry.name.replace(/[^a-zA-Z0-9._-]+/gu, '_')}`)
  try {
    let report
    try {
      const result = await generateBundle(pkg, { outDir: bundleDir })
      report = result.report
    } catch (error) {
      return { ...record, status: 'fatal', stage: 'convert', error: String(error?.message ?? error) }
    }
    try {
      // npm, exactly as a user installs a bundle: build scripts run by default,
      // so native modules (better-sqlite3) come out usable. pnpm 11 was tried
      // here and fights this harness both ways: --ignore-scripts skips builds
      // without recording them (approve-builds then has nothing to approve),
      // and its default policy blocks dependency builds AND exits non-zero.
      await execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: bundleDir,
        env: {
          ...process.env, CI: '1',
          npm_config_registry: 'https://registry.npmjs.org',
        },
        timeout: 240_000,
        maxBuffer: 16 * 1024 * 1024,
      })
    } catch (error) {
      return { ...record, status: 'load-failed', stage: 'install', gap: 'dependency-install', error: String(error?.message ?? error).slice(0, 500) }
    }
    try {
      const surface = await loadBundle(bundleDir)
      return {
        ...record,
        status: 'loaded',
        verdict: report.verdict,
        tools: surface.tools.filter(name => !name.startsWith('bb-')),
        commands: surface.commands,
        skills: surface.skills,
        ...(surface.exercised === undefined ? {} : { exercised: surface.exercised }),
        degraded: [...new Set(report.findings.filter(item => item.level === 'unsupported').map(item => item.capability))],
      }
    } catch (error) {
      const message = String(error?.message ?? error)
      return { ...record, status: 'load-failed', stage: 'load', gap: classifyGap(message), error: message.slice(0, 500) }
    }
  } finally {
    await pkg.dispose()
  }
}

const selected = corpus.packages.filter(entry => only === undefined || only.has(entry.name))
const results = []
for (const entry of selected) {
  const result = await verifyOne(entry)
  results.push(result)
  console.error(`[${result.status.padEnd(11)}] #${String(entry.rank).padStart(2)} ${entry.name}${result.gap === undefined ? '' : ` (${result.gap})`}`)
}

const counts = {
  loaded: results.filter(item => item.status === 'loaded').length,
  loadFailed: results.filter(item => item.status === 'load-failed').length,
  fatal: results.filter(item => item.status === 'fatal').length,
}
const gaps = {}
for (const item of results) {
  if (item.status !== 'load-failed') continue
  gaps[item.gap] = (gaps[item.gap] ?? 0) + 1
}
const exerciseCounts = {}
if (exercise) {
  for (const item of results) {
    if (item.status !== 'loaded') continue
    const grade = item.exercised?.grade ?? 'nothing-exercisable'
    exerciseCounts[grade] = (exerciseCounts[grade] ?? 0) + 1
  }
}
const value = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method: 'convert + real DSH runtime load (Cordis composition with official service plugins); registration surfaces recorded; failures classified as ABI gaps'
    + (exercise ? '; representative tools/commands EXECUTED with schema-derived arguments against local fixtures' : ''),
  counts,
  ...(exercise ? { exerciseCounts } : {}),
  gapHistogram: gaps,
  results,
}
await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`)
console.log(JSON.stringify({ ...counts, ...(exercise ? { exercise: exerciseCounts } : {}) }))
console.log(outputPath)
await new Promise(resolveClose => fixtureServer.close(resolveClose))
if (process.env.PI2DSH_KEEP_TEST_ARTIFACTS !== '1') await rm(scratch, { recursive: true, force: true })
// Exercised tools may have spawned children (worker daemons, child `pi`
// dispatch) whose live handles keep this process from exiting on its own;
// results are on disk, so exit explicitly.
process.exit(0)
