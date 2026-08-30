#!/usr/bin/env node
// #4213 verification: a tool whose `parameters` is a bare property table
// (no {type:"object"} wrapper) — the shape the OP's diagnosis blames — on
// three real setups against the real DeepSeek endpoint. No mocks anywhere:
// the strict validator that produces the failure is the live endpoint's own.
//
//   A  stock DSH + a cordis plugin registering the malformed tool
//      → expectation under test: the turn fails at ingress (400), the model
//        never answers, and nothing names the culprit tool.
//   B  stock DSH, same home shape, no plugin — control
//      → the same turn answers; isolates the schema as the only variable.
//   C  DSH + pi2dsh + a Pi extension registering the SAME malformed shape
//      → the bridge refuses the tool at registration time with a named
//        error (normalizeToolSchema: object-root required) and the turn
//        still answers — the failure moves from "every request dies with a
//        cryptic 400" to "this one tool is rejected, loudly, at mount".
//
// Usage: DEEPSEEK_API_KEY=… node scripts/verify-malformed-tool-schema.mjs [out.json]
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createE2eHarness, filesBelow } from './lib/e2e-harness.mjs'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
  ? resolve(projectRoot, '..', 'deepseek-harness')
  : resolve(process.env.PI2DSH_DSH_ROOT)
const directDshBin = process.env.PI2DSH_DSH_BIN === undefined ? undefined : resolve(process.env.PI2DSH_DSH_BIN)
const dshBin = directDshBin ?? join(dshRoot, 'apps/cli/src/bin.ts')
const dshCwd = resolve(process.env.PI2DSH_DSH_CWD ?? dshRoot)
const { makeHome, useJsonlSessions } = createE2eHarness({ dshRoot, directDshBin, dshBin, dshCwd })

const apiKey = process.env.DEEPSEEK_API_KEY
assert(apiKey, 'DEEPSEEK_API_KEY is required — the whole point is the real strict endpoint')
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`
const outputPath = resolve(process.argv[2] ?? 'community/malformed-tool-schema-e2e.json')

const PROMPT = 'What is 2+2? Answer with just the number.'

// The malformed shape from the OP's diagnosis: a bare property table.
const BARE_TABLE = `{ city: { type: 'string', description: 'The city name' } }`

async function writeCordisFixture(dir) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'malformed-probe',
    version: '0.0.1',
    type: 'module',
    main: 'index.js',
    keywords: ['dsh-plugin'],
    exports: { '.': './index.js', './cordis.patch.yml': './cordis.patch.yml', './package.json': './package.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(join(dir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: malformed-probe',
    '      name: malformed-probe',
    '',
  ].join('\n'))
  // The registration mirrors the official @deepseek-ai/dsh-mcp-client shape
  // exactly (lib/index.js syncTools/createOutput): a valid `output`
  // declaration, and `parameters` passed VERBATIM — which is what carries a
  // sloppy MCP server's bare property table into the model request.
  await writeFile(join(dir, 'index.js'), [
    `export const name = 'malformed-probe'`,
    `export const inject = ['tools']`,
    `export function apply(ctx) {`,
    `  ctx.tools.register({`,
    `    name: 'weather_probe',`,
    `    description: 'Get the weather for a city',`,
    `    parameters: ${BARE_TABLE},`,
    `    output: {`,
    `      schema: {`,
    `        type: 'object',`,
    `        properties: { content: { type: 'array', items: {} } },`,
    `        required: ['content'],`,
    `        additionalProperties: false,`,
    `      },`,
    `      render(_args, value) { return [{ type: 'text', text: 'sunny' }] },`,
    `    },`,
    `    execute: async () => ({ content: [{ type: 'text', text: 'sunny' }] }),`,
    `  })`,
    `}`,
    '',
  ].join('\n'))
}

async function writePiFixture(dir, { withHealthyEntry = false } = {}) {
  await mkdir(dir, { recursive: true })
  const entries = withHealthyEntry ? ['./bad.js', './good.js'] : ['./bad.js']
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'pi-malformed-probe',
    version: '0.0.1',
    type: 'module',
    main: 'bad.js',
    pi: { extensions: entries },
  }, null, 2))
  await writeFile(join(dir, 'bad.js'), [
    `export default function activate(pi) {`,
    `  pi.registerTool({`,
    `    name: 'weather_probe',`,
    `    label: 'Weather probe',`,
    `    description: 'Get the weather for a city',`,
    `    parameters: ${BARE_TABLE},`,
    `    async execute() { return { content: [{ type: 'text', text: 'sunny' }] } },`,
    `  })`,
    `}`,
    '',
  ].join('\n'))
  if (withHealthyEntry) {
    await writeFile(join(dir, 'good.js'), [
      `export default function activate(pi) {`,
      `  pi.registerTool({`,
      `    name: 'healthy_probe',`,
      `    label: 'Healthy probe',`,
      `    description: 'A correctly-shaped tool',`,
      `    parameters: { type: 'object', properties: { note: { type: 'string' } } },`,
      `    async execute() { return { content: [{ type: 'text', text: 'ok' }] } },`,
      `  })`,
      `}`,
      '',
    ].join('\n'))
  }
}

const answered = records => records
  .filter(record => record.type === 'assistant/message')
  .flatMap(record => record.data?.message?.content ?? [])
  .filter(block => block.type === 'text')
  .map(block => String(block.text ?? ''))
  .join('\n')

async function sessionLog(home) {
  const files = await filesBelow(join(home, 'sessions'))
    .then(all => all.filter(path => path.endsWith('/session.jsonl')))
    .catch(() => [])
  if (files.length === 0) return []
  const raw = await readFile(files[files.length - 1], 'utf8')
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

const results = {}
const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-malformed-'))
try {
  // --- A: stock DSH + malformed cordis tool -------------------------------
  {
    const { home, runDsh } = await makeHome(join(scratch, 'a'))
    const fixture = join(scratch, 'a-fixture')
    await writeCordisFixture(fixture)
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${fixture}`])
    await useJsonlSessions(home, 'headless')
    let failure
    let stdout = ''
    try {
      const run = await runDsh(['--profile', 'headless', PROMPT])
      stdout = `${run.stdout}\n${run.stderr}`
    } catch (error) {
      failure = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${String(error)}`
    }
    const records = await sessionLog(home)
    const answer = answered(records)
    results.stockWithMalformedTool = {
      turnFailed: failure !== undefined,
      modelAnswered: answer.includes('4'),
      errorExcerpt: (failure ?? stdout).replace(apiKey, '[KEY]').slice(0, 1200),
      namesCulpritTool: (failure ?? stdout).includes('weather_probe'),
    }
  }

  // --- B: control — same turn, no plugin at all ---------------------------
  {
    const { home, runDsh } = await makeHome(join(scratch, 'b'))
    // `plugin add` of a no-op is not needed; the profile initializes on first run.
    await useJsonlSessions(home, 'headless').catch(() => {})
    const run = await runDsh(['--profile', 'headless', PROMPT])
    await useJsonlSessions(home, 'headless').catch(() => {})
    const records = await sessionLog(home)
    const answer = answered(records)
    results.control = {
      modelAnswered: answer.includes('4') || run.stdout.includes('4'),
    }
  }

  // --- C: pi2dsh + Pi extension with the SAME malformed shape (only pkg) --
  {
    const { home, runDsh } = await makeHome(join(scratch, 'c'))
    const fixture = join(scratch, 'c-fixture')
    await writePiFixture(fixture)
    await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${fixture}`])
    await useJsonlSessions(home, 'headless')
    let combined
    let failed = false
    try {
      const run = await runDsh(['--profile', 'headless', PROMPT])
      combined = `${run.stdout}\n${run.stderr}`
    } catch (error) {
      failed = true
      combined = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    }
    combined = combined.replace(apiKey, '[KEY]')
    const records = await sessionLog(home)
    results.bridgeOnlyMalformedPackage = {
      bootRefused: failed,
      modelAnswered: answered(records).includes('4'),
      refusedLoudly: combined.includes('object-root TypeBox schema'),
      namesCulpritPackage: combined.includes('pi-malformed-probe'),
      logExcerpt: combined.split('\n').filter(line => /object-root|malformed-probe|first failure/iu.test(line)).slice(0, 4).join('\n').slice(0, 600),
    }
  }

  // --- C2: same malformed entry NEXT TO a healthy entry — partial failure -
  {
    const { home, runDsh } = await makeHome(join(scratch, 'c2'))
    const fixture = join(scratch, 'c2-fixture')
    await writePiFixture(fixture, { withHealthyEntry: true })
    await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${fixture}`])
    await useJsonlSessions(home, 'headless')
    let combined
    let failed = false
    try {
      const run = await runDsh(['--profile', 'headless', PROMPT])
      combined = `${run.stdout}\n${run.stderr}`
    } catch (error) {
      failed = true
      combined = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    }
    combined = combined.replace(apiKey, '[KEY]')
    const records = await sessionLog(home)
    results.bridgeMalformedBesideHealthy = {
      bootRefused: failed,
      modelAnswered: answered(records).includes('4'),
      malformedEntryNamed: combined.includes('object-root TypeBox schema'),
      logExcerpt: combined.split('\n').filter(line => /object-root|malformed-probe|loaded pi-malformed/iu.test(line)).slice(0, 5).join('\n').slice(0, 600),
    }
  }

  await writeFile(outputPath, JSON.stringify({ capturedAt: 'run-local', results }, null, 2))
  console.log(JSON.stringify(results, null, 1))
} finally {
  if (process.env.PI2DSH_KEEP_SCRATCH === '1') console.error(`kept scratch: ${scratch}`)
  else await rm(scratch, { recursive: true, force: true })
}
