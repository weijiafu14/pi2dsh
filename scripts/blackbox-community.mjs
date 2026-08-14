#!/usr/bin/env node
// Black-box verification for the community corpus: convert every non-fatal
// package and LOAD it inside a real DSH runtime composition. Static analysis
// screens; this run certifies. Output per package:
//   - loaded:      the bundle mounted; registration surface recorded
//   - load-failed: the error message is a concrete ABI gap to fix
//   - fatal:       conversion refused (supply-chain/closure findings)
// Usage: node scripts/blackbox-community.mjs [output.json] [--only name,name]
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
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

const corpus = JSON.parse(await readFile(join(projectRoot, 'community/corpus.json'), 'utf8'))
const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-blackbox-'))
const workspace = join(scratch, 'workspace')
await mkdir(workspace, { recursive: true })

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
  ctx.emit('agent/disposed', { agent })
  await delay(30)
  await fiber.dispose()
  return { tools, commands, skills }
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
      await execFile('corepack', ['pnpm@11.7.0', 'install', '--ignore-scripts', '--prod'], {
        cwd: bundleDir,
        env: {
          ...process.env, CI: '1',
          npm_config_registry: 'https://registry.npmjs.org',
          PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
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
const value = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method: 'convert + real DSH runtime load (Cordis composition with official service plugins); registration surfaces recorded; failures classified as ABI gaps',
  counts,
  gapHistogram: gaps,
  results,
}
await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`)
console.log(JSON.stringify(counts))
console.log(outputPath)
if (process.env.PI2DSH_KEEP_TEST_ARTIFACTS !== '1') await rm(scratch, { recursive: true, force: true })
