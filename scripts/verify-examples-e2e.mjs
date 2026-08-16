#!/usr/bin/env node
// Regression for the shipped examples, on the real dsh CLI.
//
// Every example under `examples/` claims a capability to the reader. This
// script re-runs the ones that can run headlessly, using the exact packages
// and commands their READMEs tell a user to install — so a behaviour change
// that breaks an example fails here rather than in someone's terminal.
//
//   gateway-compat   the example's own Pi provider against a REAL upstream,
//                    through the example's recording proxy — which forwards
//                    every request and streams the real response back. The
//                    proxy is not a stand-in endpoint; it only writes down
//                    what was sent, which is the only way to check that a
//                    compat declaration reached the wire. Nothing is mocked.
//   vision-bridge    the real @kassing/pi-vision from npm against a live
//                    model and the example's own test image (needs
//                    DEEPSEEK_API_KEY and network).
//   side-conversation  boots the web profile with the real pi-btw and drives
//                    the browser the way the README does; the capture script
//                    asserts the property the example claims — the side
//                    answer never lands in the main conversation.
//
// Usage: node scripts/verify-examples-e2e.mjs [outfile]
//        DEEPSEEK_API_KEY=… to include the live half; without it that half
//        is SKIPPED and reported as skipped, never as passed.
//
// The credential is read from the environment only and asserted absent from
// every captured artifact before anything is written.

import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
  ? resolve(projectRoot, '..', 'deepseek-harness')
  : resolve(process.env.PI2DSH_DSH_ROOT)
const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
const outputPath = resolve(process.argv[2] ?? 'community/examples-e2e.json')
const apiKey = process.env.DEEPSEEK_API_KEY

async function filesBelow(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(path))
    else if (entry.isFile()) output.push(path)
  }
  return output
}

/** A throwaway DSH home with a pnpm shim, the way the other e2e scripts build one. */
async function makeHome(scratch, extraEnv = {}) {
  const home = join(scratch, 'dsh-home')
  const shimDir = join(scratch, 'bin')
  await mkdir(shimDir, { recursive: true })
  const pnpmShim = join(shimDir, 'pnpm')
  await writeFile(pnpmShim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(pnpmShim, 0o755)
  const env = {
    ...process.env,
    DSH_HOME: home,
    PATH: `${shimDir}:${process.env.PATH ?? ''}`,
    CI: '1',
    NO_COLOR: '1',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_PERMISSION_MODE: 'danger-full-access',
    npm_config_registry: 'https://registry.npmjs.org',
    PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
    ...extraEnv,
  }
  const runDsh = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args], {
    cwd: dshRoot,
    env,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return { home, env, runDsh }
}

/** Point the profile's session log somewhere this script can read it. */
async function useJsonlSessions(home, profile) {
  await writeFile(join(home, `profiles/${profile}/cordis.patch.yml`), [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'))
}

/**
 * Route the profile's default model, the way the example's README does — the
 * CLI has no --model flag; the selection is settings.
 */
async function useDefaultModel(home, provider, model) {
  await writeFile(join(home, 'settings.yaml'), [
    'agent-default-model:',
    `  provider: ${provider}`,
    `  model: ${model}`,
    '',
  ].join('\n'))
}

const results = {}

// ---------------------------------------------------------------------------
// examples/gateway-compat — offline, and the example's whole point is the wire
// ---------------------------------------------------------------------------
async function runGatewayCompat() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.gatewayCompat = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-gateway-'))
  const recordPath = join(scratch, 'requests.jsonl')
  let endpoint
  try {
    await stat(dshBin)
    // The example's recording proxy, in front of the REAL upstream. The port
    // must be free: a leftover listener from an earlier run would answer this
    // one while logging somewhere else, which reads as "the gateway was never
    // called" — the exact false failure this check exists to prevent.
    const port = Number(process.env.PROBE_PORT ?? 4599)
    const alreadyUp = await fetch(`http://127.0.0.1:${port}/v1/models`).then(() => true).catch(() => false)
    if (alreadyUp) {
      throw new Error(
        `port ${port} is already serving — a leftover proxy would answer this run and log elsewhere.`
        + ' Stop it (pkill -f recording-proxy.mjs) or set PROBE_PORT.',
      )
    }
    endpoint = spawn('node', [join(projectRoot, 'examples/gateway-compat/probe/recording-proxy.mjs')], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PROXY_PORT: String(port),
        PROXY_LOG: recordPath,
        PROXY_UPSTREAM: process.env.PROXY_UPSTREAM ?? 'https://api.deepseek.com',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let endpointLog = ''
    endpoint.stdout.on('data', chunk => { endpointLog += String(chunk) })
    endpoint.stderr.on('data', chunk => { endpointLog += String(chunk) })
    endpoint.on('exit', code => { endpointLog += `\nrecording proxy exited with ${code}` })
    // Wait for OUR proxy to accept connections rather than sleeping a guess.
    const deadline = Date.now() + 20_000
    for (;;) {
      if (endpoint.exitCode !== null) throw new Error(`recording proxy died on startup:\n${endpointLog}`)
      const up = await fetch(`http://127.0.0.1:${port}/v1/models`).then(() => true).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`recording proxy never came up:\n${endpointLog}`)
      await new Promise(done => setTimeout(done, 200))
    }

    const { home, runDsh } = await makeHome(scratch, { PROBE_BASE_URL: `http://127.0.0.1:${port}/v1` })
    // Exactly what the README tells the reader to install.
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${projectRoot}`])
    await runDsh(['plugin', '--profile', 'headless', 'add',
      `file:${join(projectRoot, 'examples/gateway-compat/probe/pi-probe-provider')}`])
    await useJsonlSessions(home, 'headless')
    await useDefaultModel(home, 'probe', 'deepseek-chat')

    const run = await runDsh(['--profile', 'headless', 'Reply with exactly: gateway-compat-ok'])
    const recorded = (await readFile(recordPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    // Completion requests only: the readiness probe above is a /models GET and
    // the endpoint logs every request it sees.
    const completions = recorded.filter(entry => entry.roles !== null)
    assert(completions.length > 0,
      `the gateway received ${recorded.length} request(s) but no completion:\n${run.stdout}\n${run.stderr}`)
    const first = completions[0]

    // The three compat quirks the example exists to demonstrate. DSH's own
    // settings path cannot express any of them; the Pi provider declares them.
    assert(!first.roles.includes('developer'),
      `supportsDeveloperRole:false was ignored — the request used a developer role: ${JSON.stringify(first.roles)}`)
    assert.equal(first.maxTokensField, 'max_completion_tokens',
      `the declared maxTokensField was ignored (saw ${first.maxTokensField})`)
    assert.equal(first.store, null, 'supportsStore:false was ignored — `store` was sent')
    // No effort was selected, so nothing should be on the wire: sending the
    // 'off' level as a string reads as truthy on this API and switches
    // thinking ON — the inversion the provider path was fixed for.
    assert.equal(first.reasoningEffort, null,
      `an unselected reasoning effort reached the wire as ${JSON.stringify(first.reasoningEffort)}`)
    // And the real model really answered through the compat-declared route —
    // recording the request proves nothing if the turn never completed.
    assert.match(`${run.stdout}`, /gateway-compat-ok/iu,
      `the turn did not complete through the declared route:\n${run.stdout}\n${run.stderr}`)

    results.gatewayCompat = {
      status: 'passed',
      requests: completions.length,
      roles: first.roles,
      maxTokensField: first.maxTokensField,
      store: first.store,
      reasoningEffort: first.reasoningEffort,
      bodyKeys: first.bodyKeys,
      previews: first.previews,
    }
  } finally {
    endpoint?.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/vision-bridge — the real npm plugin, a real image, a live model
// ---------------------------------------------------------------------------
async function runVisionBridge() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.visionBridge = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-vision-'))
  try {
    const { home, runDsh } = await makeHome(scratch)
    const installed = await runDsh(['plugin', '--profile', 'headless', 'add', `file:${projectRoot}`])
    const installedVision = await runDsh(['plugin', '--profile', 'headless', 'add', '@kassing/pi-vision'])
    await useJsonlSessions(home, 'headless')

    const image = join(projectRoot, 'examples/vision-bridge/test-images/solid-green.png')
    await stat(image)
    // The README's own command, verbatim in shape.
    const run = await runDsh(['--profile', 'headless',
      `What solid color fills the image at ${image} ? Answer with just the color name.`])

    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    assert.equal(sessionFiles.length, 1, `expected one session log, found ${sessionFiles.length}`)
    const rawLog = await readFile(sessionFiles[0], 'utf8')
    const captured = `${installed.stdout}${installed.stderr}${installedVision.stdout}${installedVision.stderr}${run.stdout}${run.stderr}${rawLog}`
    assert(!captured.includes(apiKey), 'credential appeared in captured test artifacts')

    const answer = `${run.stdout}\n${rawLog}`.toLowerCase()
    assert(answer.includes('green'),
      `the vision bridge did not identify the image; model said: ${run.stdout.slice(0, 400)}`)
    results.visionBridge = { status: 'passed', image: 'solid-green.png', answeredGreen: true }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/side-conversation — the web surface, driven exactly as a user does
// ---------------------------------------------------------------------------
async function runSideConversation() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.sideConversation = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  // The capture script needs a browser; this package deliberately does not
  // depend on one, so it borrows the DSH checkout's playwright.
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-side-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    await runDsh(['plugin', '--profile', 'web', 'add', `file:${projectRoot}`])
    await runDsh(['plugin', '--profile', 'web', 'add', 'pi-btw'])
    await useJsonlSessions(home, 'web')

    const port = Number(process.env.SIDE_PORT ?? 5187)
    web = spawn('node', ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)], {
      cwd: dshRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      const up = await fetch(url).then(() => true).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    // The capture script IS the assertion: it drives a main-thread question
    // and then `/btw`, and fails if the side answer reaches the main thread.
    const shots = join(scratch, 'shots')
    await execFile('node', [join(projectRoot, 'docs/posting-kit/capture-screenshots.mjs'), shots, '--url', url], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the capture run produced no screenshots')
    results.sideConversation = { status: 'passed', screenshots: captured.sort() }
  } finally {
    web?.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/custom-gateways — a HOST-configured route, seen from the Pi side
// ---------------------------------------------------------------------------
async function runCustomGateways() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.customGateways = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-custom-'))
  try {
    // The example's claim is that ONE DSH settings entry produces one model
    // directory both worlds read. gateway-compat proves the direction where a
    // Pi package registers the route; this proves the other one — the host
    // configures it and a Pi package's modelRegistry sees the same entry.
    // A Pi package that reports what its modelRegistry can see.
    const source = join(scratch, 'pi-registry-probe')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: 'pi-registry-probe', version: '0.0.0', type: 'module', pi: { extensions: ['index.mjs'] },
    }))
    await writeFile(join(source, 'index.mjs'), [
      'export default function (pi) {',
      "  pi.registerTool({",
      "    name: 'pi_registry_probe',",
      "    description: 'Report the models this package can see.',",
      "    parameters: { type: 'object', properties: {} },",
      '    execute: async (_id, _args, _signal, _update, ctx) => {',
      '      const models = ctx.modelRegistry.getModels()',
      "      return { content: [{ type: 'text', text: JSON.stringify(models.map(m => ({",
      '        provider: m.provider, id: m.id, api: m.api, contextWindow: m.contextWindow,',
      '      }))) }] }',
      '    },',
      '  })',
      '}',
    ].join('\n'))

    const { home, runDsh } = await makeHome(scratch)
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${projectRoot}`])
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${source}`])
    await useJsonlSessions(home, 'headless')
    // The README's own settings shape, pointed at the local endpoint.
    await writeFile(join(home, 'settings.yaml'), [
      'llm-pi-ai:',
      '  providers:',
      '    my-gateway:',
      '      displayName: My Gateway',
      '      api: openai-completions',
      '      baseURL: https://api.deepseek.com/v1',
      '      apiKeyEnv: DEEPSEEK_API_KEY',
      '      models:',
      '        - id: deepseek-chat',
      '          name: Gateway Model',
      '          contextWindow: 131072',
      '',
    ].join('\n'))
    // No agent-default-model here on purpose. The turn runs on the profile's
    // own default route (a real model, from DEEPSEEK_API_KEY in the
    // environment), because the probe tool has to actually be CALLED for its
    // answer to exist — and the fake endpoint standing in for the gateway
    // answers a fixed line and can emit no tool call at all. What the example
    // claims is narrower and is what this checks: a route only DSH settings
    // declare is visible to a mounted Pi package's modelRegistry.

    const run = await runDsh(['--profile', 'headless', 'call the pi_registry_probe tool once and repeat its output'])
    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    assert.equal(sessionFiles.length, 1, `expected one session log, found ${sessionFiles.length}`)
    const records = (await readFile(sessionFiles[0], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    const result = records.find(record => record.type === 'tool/result'
      && JSON.stringify(record.data).includes('my-gateway'))
    assert(result !== undefined,
      `the host-configured route never reached the package's modelRegistry:\n${run.stdout}\n${run.stderr}`)
    const seen = JSON.parse(JSON.stringify(result.data).match(/\[\{[^\]]*\}\]/)?.[0] ?? '[]')
    const entry = (Array.isArray(seen) ? seen : []).find(model => model.provider === 'my-gateway')
    assert(entry !== undefined, `modelRegistry saw ${JSON.stringify(seen)}`)
    // The Pi-shaped fields survive the round trip, which is the example's point.
    assert.equal(entry.id, 'deepseek-chat')
    assert.equal(entry.contextWindow, 131072)
    results.customGateways = { status: 'passed', seenByPackage: entry }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

// ONLY=<name> runs a single example, for iterating on one without paying for
// the npm installs and browser runs of the others.
const only = process.env.ONLY
const failures = []
for (const [name, run] of [
  ['gateway-compat', runGatewayCompat],
  ['vision-bridge', runVisionBridge],
  ['side-conversation', runSideConversation],
  ['custom-gateways', runCustomGateways],
]) {
  if (only !== undefined && only !== name) continue
  try {
    await run()
    const status = results[Object.keys(results).at(-1)]?.status ?? 'passed'
    console.log(`[examples-e2e] ${name}: ${status}`)
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`[examples-e2e] ${name}: FAILED — ${error instanceof Error ? error.message : String(error)}`)
  }
}

// side-conversation and custom-gateways drive the web surface, so they are not
// asserted here. Naming them keeps this file honest about its own coverage.


await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  pi2dshCommit: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim(),
  dshCommit: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: dshRoot })).stdout.trim(),
  results,
}, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`[examples-e2e] ${failures.length} example(s) regressed:\n${failures.map(item => `  - ${item}`).join('\n')}`)
  process.exit(1)
}
console.log(`[examples-e2e] evidence → ${outputPath}`)
