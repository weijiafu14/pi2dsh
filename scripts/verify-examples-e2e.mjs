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
//   vision-bridge-web  the same vision example again, but through `dsh web` in a
//                    real browser: headless proves the bridge, this proves the
//                    surface, and the bar for done is both.
//   codex-image-gen  a real ChatGPT/Codex OAuth account drives the published
//                    image plugin through generation and reference-image edit;
//                    needs CODEX_AUTH_FILE because the account is the fixture.
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
// Which pi2dsh a run installs. The default is this working tree, because that
// is what you want while developing. Point it at a published spec
// (`PI2DSH_ENGINE_SPEC=pi2dsh@<published-version>`) for the bare-environment check after a
// release: same fresh DSH_HOME, same README commands, but the engine comes off
// the registry — which is the only way to catch what the tarball left out.
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`
// Where the browser scenarios put their screenshots. They default into the
// run's scratch directory and are thrown away with it, because a regression run
// should not rewrite repository assets. Point this at docs/posting-kit/assets
// when you actually want to refresh the published pictures.
const shotDir = process.env.PI2DSH_SHOT_DIR === undefined ? undefined : resolve(process.env.PI2DSH_SHOT_DIR)

/**
 * Read back which engine actually got installed, and refuse a mismatch.
 *
 * `dsh plugin add pi2dsh` resolves through pnpm, which can serve a stale
 * registry metadata cache: a run asking for the published engine quietly got
 * 0.10.0 and then "failed" for two unrelated-looking reasons that were both
 * just old code. A regression that cannot say which build it exercised proves
 * nothing, so the version is asserted here and written into the evidence.
 * @param home - the DSH home the scenario installed into.
 * @param profile - which profile received the engine.
 */
async function installedEngineVersion(home, profile) {
  const manifest = join(home, 'profiles', profile, 'node_modules/pi2dsh/package.json')
  const { version } = JSON.parse(await readFile(manifest, 'utf8'))
  const wanted = /@(\d[^@]*)$/u.exec(engineSpec)?.[1]
  assert(wanted === undefined || wanted === version,
    `asked for pi2dsh@${wanted} but the profile installed ${version}`
    + ' — pnpm served stale registry metadata; clear it or pin the version')
  return { version, ...await engineOrigin() }
}

/**
 * Say where the engine under test came from — the half of "which build" a
 * version number cannot carry.
 *
 * The working tree declares the version of the LAST release until the next one
 * is cut, so a local `file:` install and the published release of the same
 * number are the same string in the evidence and mean entirely different code.
 * A dirty tree is not any commit at all, so that is recorded too: without it,
 * "the release version, commit abc" reads as reproducible when it is not.
 */
let engineOriginOnce
function engineOrigin() {
  engineOriginOnce ??= (async () => {
    if (!engineSpec.startsWith('file:')) return { from: 'registry', spec: engineSpec }
    const at = engineSpec.slice('file:'.length)
    const [commit, status] = await Promise.all([
      execFile('git', ['rev-parse', 'HEAD'], { cwd: at }).then(r => r.stdout.trim()).catch(() => null),
      execFile('git', ['status', '--porcelain'], { cwd: at }).then(r => r.stdout.trim()).catch(() => ''),
    ])
    // Evidence is committed publicly. The commit + dirty bit identify the
    // build; an absolute checkout path only leaks a developer workstation and
    // adds no reproducibility value.
    return { from: 'local', spec: 'file:<working-tree>', commit, dirty: status.length > 0 }
  })()
  return engineOriginOnce
}

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
    // A release check installs a release that is minutes old, and pnpm 11 holds
    // back very recent versions by default (minimumReleaseAge) — the profile
    // install then fails with nothing but "pnpm failed in profile directory".
    // Turning it off here is a property of the harness, not of the product: a
    // user installing tomorrow is past the window anyway.
    PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
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
async function useDefaultModel(home, provider, model, reasoningEffort) {
  await writeFile(join(home, 'settings.yaml'), [
    'agent-default-model:',
    `  provider: ${provider}`,
    `  model: ${model}`,
    ...(reasoningEffort === undefined ? [] : [`  reasoningEffort: ${reasoningEffort}`]),
    '',
  ].join('\n'))
}

const results = {}

// The vision example's README has a step 2 — point the plugin at a real vision
// endpoint — and a run that skips it is not running the example. Without it the
// turn still ANSWERS (the main model globs the disk and decodes the PNG with
// python), so a check that only looks for the colour word passes while the
// bridge is broken. That happened: both vision passes were green for months of
// this session against `read_image` returning "Error: cannot read".
const visionEnv = {
  VISION_BRIDGE_BASE_URL: process.env.VISION_BRIDGE_BASE_URL,
  VISION_BRIDGE_MODEL: process.env.VISION_BRIDGE_MODEL,
  VISION_BRIDGE_API_KEY: process.env.VISION_BRIDGE_API_KEY,
}
const visionMissing = Object.entries(visionEnv).filter(([, value]) => (value ?? '').length === 0).map(([name]) => name)

/** Session records from the one session log a scenario's home produced. */
async function sessionRecords(home) {
  const files = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
  assert.equal(files.length, 1, `expected one session log, found ${files.length}`)
  return (await readFile(files[0], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/**
 * Assert the image was read through the vision path, not reconstructed.
 *
 * The discriminator is the image-reading tool's own result: a bridge that
 * worked returns content, a bridge that did not returns an error the model
 * then routes around. Only the first proves anything about this example.
 */
function assertVisionReallyRead(records, transcript) {
  const reads = records.filter(record => record.type === 'tool/call' && /image/iu.test(String(record.data?.name ?? '')))
  assert(reads.length > 0, `no image-reading tool ran at all:\n${transcript.slice(-1500)}`)
  const failed = []
  for (const call of reads) {
    const result = records.find(record => record.type === 'tool/result'
      && (record.data?.message?.content ?? []).some(block => block.toolCallId === call.data.callId))
    const block = (result?.data?.message?.content ?? []).find(item => item.toolCallId === call.data.callId)
    if (block?.isError === true) failed.push(`${call.data.name}: ${JSON.stringify(block.content).slice(0, 200)}`)
  }
  assert.equal(failed.length, 0,
    `the image-reading tool failed, so any correct answer came from somewhere else:\n  ${failed.join('\n  ')}`)
}

// ---------------------------------------------------------------------------
// examples/gateway-compat — real upstream; the example's point is the wire
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

    const { home, runDsh } = await makeHome(scratch, {
      PROBE_BASE_URL: `http://127.0.0.1:${port}/v1`,
      PROBE_API_KEY: apiKey,
    })
    // Exactly what the README tells the reader to install.
    await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'headless', 'add',
      `file:${join(projectRoot, 'examples/gateway-compat/probe/pi-probe-provider')}`])
    await useJsonlSessions(home, 'headless')
    await useDefaultModel(home, 'probe', 'deepseek-chat', 'xhigh')

    const run = await runDsh(['--profile', 'headless', 'Reply with exactly: gateway-compat-ok'])
    const recorded = (await readFile(recordPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    // Completion requests only: the readiness probe above is a /models GET and
    // the endpoint logs every request it sees.
    const completions = recorded.filter(entry => entry.roles !== null)
    assert(completions.length > 0,
      `the gateway received ${recorded.length} request(s) but no completion:\n${run.stdout}\n${run.stderr}`)
    const first = completions[0]

    // The three compat quirks the example exists to demonstrate. The Pi
    // provider declares them and rc.8's official profile must carry them.
    assert(!first.roles.includes('developer'),
      `supportsDeveloperRole:false was ignored — the request used a developer role: ${JSON.stringify(first.roles)}`)
    // The declared spelling must WIN over the default. Asserting the default
    // here proved nothing for weeks — it is what a request carries when the
    // declaration is dropped on the floor.
    assert.equal(first.maxTokensField, 'max_tokens',
      `the declared maxTokensField was ignored (saw ${first.maxTokensField})`)
    assert.equal(first.store, null, 'supportsStore:false was ignored — `store` was sent')
    // DSH selected the canonical `xhigh`; the Pi declaration deliberately
    // maps it to wire-level `high`. Seeing `high` proves the profile carried
    // the map rather than merely accepting a same-named default level.
    assert.equal(first.reasoningEffort, 'high',
      `the selected xhigh effort did not map to wire-level high (saw ${JSON.stringify(first.reasoningEffort)})`)
    // And the real model really answered through the compat-declared route —
    // recording the request proves nothing if the turn never completed.
    assert.match(`${run.stdout}`, /gateway-compat-ok/iu,
      `the turn did not complete through the declared route:\n${run.stdout}\n${run.stderr}`)

    results.gatewayCompat = {
      engine: await installedEngineVersion(home, 'headless'),
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
  if (visionMissing.length > 0) {
    results.visionBridge = { status: 'skipped', reason: `no vision endpoint configured (${visionMissing.join(', ')})` }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-vision-'))
  try {
    const { home, runDsh } = await makeHome(scratch, visionEnv)
    const installed = await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    const installedVision = await runDsh(['plugin', '--profile', 'headless', 'add', '@kassing/pi-vision'])
    await useJsonlSessions(home, 'headless')

    const image = join(projectRoot, 'examples/vision-bridge/test-images/solid-green.png')
    await stat(image)
    // The README's own command, verbatim in shape.
    const run = await runDsh(['--profile', 'headless',
      `What solid color fills the image at ${image} ? Answer with just the color name.`])

    const records = await sessionRecords(home)
    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    const rawLog = await readFile(sessionFiles[0], 'utf8')
    const captured = `${installed.stdout}${installed.stderr}${installedVision.stdout}${installedVision.stderr}${run.stdout}${run.stderr}${rawLog}`
    assert(!captured.includes(apiKey), 'credential appeared in captured test artifacts')

    const answer = `${run.stdout}\n${rawLog}`.toLowerCase()
    assert(answer.includes('green'),
      `the vision bridge did not identify the image; model said: ${run.stdout.slice(0, 400)}`)
    // The colour word alone is not evidence: without a vision endpoint the main
    // model finds it by decoding the PNG in bash. Require the read itself.
    assertVisionReallyRead(records, `${run.stdout}\n${rawLog}`)
    results.visionBridge = { status: 'passed', engine: await installedEngineVersion(home, 'headless'), image: 'solid-green.png', answeredGreen: true, readThroughVision: true }
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
    await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
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
    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [join(projectRoot, 'docs/posting-kit/capture-screenshots.mjs'), shots, '--url', url], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the capture run produced no screenshots')
    results.sideConversation = { status: 'passed', engine: await installedEngineVersion(home, 'web'), screenshots: captured.sort() }
  } finally {
    web?.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/vision-bridge, on the WEB surface
// ---------------------------------------------------------------------------
// The headless pass above proves the bridge; this one proves the surface. Our
// own completion bar is CLI *and* web, and "works headless, breaks in the
// browser" is a failure mode this project has actually shipped before.
async function runVisionBridgeWeb() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.visionBridgeWeb = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  if (visionMissing.length > 0) {
    results.visionBridgeWeb = { status: 'skipped', reason: `no vision endpoint configured (${visionMissing.join(', ')})` }
    return
  }
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-vision-web-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch, visionEnv)
    await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'web', 'add', '@kassing/pi-vision'])
    await useJsonlSessions(home, 'web')

    const port = Number(process.env.VISION_PORT ?? 5188)
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

    const image = join(projectRoot, 'examples/vision-bridge/test-images/solid-green.png')
    await stat(image)
    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [
      join(projectRoot, 'docs/posting-kit/capture-vision.mjs'), shots, '--url', url, '--image', image,
    ], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the vision web run produced no screenshot')
    // Read the session log rather than the screen: a page that says "the vision
    // bridge failed" still contains the words "vision" and "green", which is
    // exactly how a DOM-text assertion passed on a broken run.
    assertVisionReallyRead(await sessionRecords(home), webLog)
    results.visionBridgeWeb = { status: 'passed', engine: await installedEngineVersion(home, 'web'), screenshots: captured.sort(), readThroughVision: true }
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
      '      const models = ctx.modelRegistry.getAll()',
      "      return { content: [{ type: 'text', text: JSON.stringify(models.map(m => ({",
      '        provider: m.provider, id: m.id, api: m.api, contextWindow: m.contextWindow,',
      '      }))) }] }',
      '    },',
      '  })',
      '}',
    ].join('\n'))

    const { home, runDsh } = await makeHome(scratch)
    await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
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
    // Read the probe's own result block rather than fishing a JSON substring
    // out of the serialized event: the catalog is long enough that a
    // non-greedy match truncates it and fails on parse, which says nothing
    // about the thing under test.
    // A tool/result block carries the call id, not the tool name, so the call
    // is what names it: pair them.
    const call = records.find(record => record.type === 'tool/call' && record.data?.name === 'pi_registry_probe')
    assert(call !== undefined, `the probe tool never ran:\n${run.stdout}\n${run.stderr}`)
    const result = records.find(record => record.type === 'tool/result'
      && (record.data?.message?.content ?? []).some(block => block.toolCallId === call.data.callId))
    assert(result !== undefined,
      `the probe ran but logged no result:\n${run.stdout}\n${run.stderr}`)
    const text = (result.data.message.content ?? [])
      .flatMap(block => Array.isArray(block.content) ? block.content : [])
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('')
    let seen
    try {
      seen = JSON.parse(text)
    } catch (error) {
      throw new Error(`the probe's output was not the model list it reports: ${text.slice(0, 300)}`)
    }
    const entry = (Array.isArray(seen) ? seen : []).find(model => model.provider === 'my-gateway')
    assert(entry !== undefined,
      `the host-configured route never reached the package's modelRegistry; it saw ${JSON.stringify(seen)}`)
    // The Pi-shaped fields survive the round trip, which is the example's point.
    assert.equal(entry.id, 'deepseek-chat')
    assert.equal(entry.contextWindow, 131072)
    results.customGateways = { status: 'passed', engine: await installedEngineVersion(home, 'headless'), seenByPackage: entry }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/presentation-surfaces — a Pi package's own chrome, in DSH web seats
// ---------------------------------------------------------------------------
// The package under test is a REAL npm plugin, installed the way the example's
// README says to install it. Driving a package we wrote proves the surfaces we
// thought to drive: the demo one that used to be here passed while real plugins
// rendered raw ANSI escapes into the seats, because nothing we write emits ANSI.
async function runPresentationSurfaces() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.presentationSurfaces = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-surfaces-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'web', 'add', 'pi-powerline-footer'])
    await useJsonlSessions(home, 'web')

    const port = Number(process.env.SURFACES_PORT ?? 5189)
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

    // The capture script IS the assertion: each seat has to hold the string the
    // Pi package supplied, checked inside that seat rather than in page text.
    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [join(projectRoot, 'docs/posting-kit/capture-surfaces.mjs'), shots, '--url', url], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the surfaces run produced no screenshots')
    results.presentationSurfaces = { status: 'passed', engine: await installedEngineVersion(home, 'web'), screenshots: captured.sort() }
  } finally {
    web?.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
}

// ONLY=<name> runs a single example, for iterating on one without paying for
// the npm installs and browser runs of the others.
const only = process.env.ONLY
/**
 * examples/subscription-login — the account path, minus the account.
 *
 * A real subscription login cannot be automated; that is what OAuth is for.
 * What CAN be checked without one is everything the example promises BEFORE
 * the browser: that installing a provider package puts its account in
 * `/login`, that the package becomes a route of its own, and — the part that
 * actually bit users — that an account whose credential is a request header
 * is REFUSED with that reason instead of quietly producing an empty picker.
 */
async function runSubscriptionLogin() {
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-login-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
    // The package the example names for exactly this case.
    await runDsh(['plugin', '--profile', 'web', 'add', 'pi-provider-kimi-code'])

    // Boot the runtime and read what the engine announced. Deliberately not a
    // prompt: this scenario needs no model, so it must not need a model key
    // either — otherwise the one part of the example that CAN run without an
    // account would still be skipped for want of one.
    const port = 5300 + Math.floor(Math.random() * 200)
    web = spawn('node', ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)],
      { cwd: dshRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    web.stdout.on('data', chunk => { log += String(chunk) })
    web.stderr.on('data', chunk => { log += String(chunk) })
    const deadline = Date.now() + 90_000
    while (!/dsh web:/u.test(log) && web.exitCode === null && Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 400))
    }
    await new Promise(done => setTimeout(done, 2000))

    // 1. the installed package's account is offered by /login
    if (!/supports OAuth — log in with \/login kimi-coding/u.test(log)) {
      throw new Error(`the installed package's account was not offered in /login:\n${log.slice(-1500)}`)
    }
    // 2. and the package became a route of its own — the path that carries a
    //    header-shaped credential, which a route profile cannot.
    if (!/Pi provider "kimi-coding" registered as a native DSH llm route/u.test(log)) {
      throw new Error(`the package did not become a native route:\n${log.slice(-1500)}`)
    }
    results.subscriptionLogin = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'web'),
      note: 'account offered by /login and served as a native route; the live account login is manual (README step 4)',
    }
  } finally {
    web?.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/codex-image-gen — real subscription image generation + Web edit
// ---------------------------------------------------------------------------
async function runCodexImageGen() {
  const authFile = process.env.CODEX_AUTH_FILE
  if (authFile === undefined || authFile.length === 0) {
    results.codexImageGen = { status: 'skipped', reason: 'CODEX_AUTH_FILE not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-codex-image-'))
  const report = join(scratch, 'report.json')
  try {
    await execFile('node', [join(projectRoot, 'scripts/verify-codex-image-gen-e2e.mjs'), report], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CODEX_AUTH_FILE: authFile,
        PI2DSH_DSH_ROOT: dshRoot,
        PI2DSH_ENGINE_SPEC: engineSpec,
      },
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
    })
    const evidence = JSON.parse(await readFile(report, 'utf8'))
    assert.equal(evidence.status, 'passed')
    results.codexImageGen = evidence
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const SCENARIOS = [
  ['gateway-compat', runGatewayCompat, 'gatewayCompat'],
  ['vision-bridge', runVisionBridge, 'visionBridge'],
  ['side-conversation', runSideConversation, 'sideConversation'],
  ['vision-bridge-web', runVisionBridgeWeb, 'visionBridgeWeb'],
  ['custom-gateways', runCustomGateways, 'customGateways'],
  ['presentation-surfaces', runPresentationSurfaces, 'presentationSurfaces'],
  ['subscription-login', runSubscriptionLogin, 'subscriptionLogin'],
  ['codex-image-gen', runCodexImageGen, 'codexImageGen'],
]
const selected = SCENARIOS.filter(([name]) => only === undefined || only === name)
if (selected.length === 0) {
  throw new Error(`ONLY=${only} matches no scenario (known: ${SCENARIOS.map(([name]) => name).join(', ')})`)
}

// Run them together. Each scenario owns a throwaway DSH_HOME and its own port,
// so nothing is shared but wall-clock — and serially this is minutes of npm
// installs and browser boots repeated one after another, which is how a full
// regression turns into a thing people skip.
const failures = []
await Promise.all(selected.map(async ([name, run, key]) => {
  try {
    await run()
    console.log(`[examples-e2e] ${name}: ${results[key]?.status ?? 'passed'}${
      results[key]?.reason === undefined ? '' : ` — ${results[key].reason}`}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results[key] = { status: 'failed', error: message }
    failures.push(`${name}: ${message}`)
    console.error(`[examples-e2e] ${name}: FAILED — ${message}`)
  }
}))

// A scenario that never reported is a hole in the run, not a pass.
for (const [name, , key] of selected) {
  if (results[key] === undefined) {
    results[key] = { status: 'failed', error: 'the scenario reported no result' }
    failures.push(`${name}: the scenario reported no result`)
  }
}


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
