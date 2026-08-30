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
//   alibaba-token-plan  the published engine plus the unmodified Alibaba Pi
//                    provider against a real Plan subscription: cold-start
//                    dynamic model, tool loop, restart and secret scan.
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
//   tui-mcp          installs the real dsh-TUI + pi-mcp-adapter combination,
//                    then verifies the complete host-influenced matrix: TUI,
//                    lifecycle, three transports, discovery, direct/proxy/
//                    scripted calls, resources/prompts/images, approval,
//                    MCP Apps, elicitation, sampling, cancellation and restart.
//
// Usage: node scripts/verify-examples-e2e.mjs [outfile]
//        DEEPSEEK_API_KEY=… to include the live half; without it that half
//        is SKIPPED and reported as skipped, never as passed.
//
// The credential is read from the environment only and asserted absent from
// every captured artifact before anything is written.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { stageSuiteTarball } from './lib/suite-tarball.mjs'
import { createE2eHarness, filesBelow, seedCodexLogin } from './lib/e2e-harness.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
  ? resolve(projectRoot, '..', 'deepseek-harness')
  : resolve(process.env.PI2DSH_DSH_ROOT)
const directDshBin = process.env.PI2DSH_DSH_BIN === undefined
  ? undefined
  : resolve(process.env.PI2DSH_DSH_BIN)
const dshBin = directDshBin ?? join(dshRoot, 'apps/cli/src/bin.ts')
const dshCwd = resolve(process.env.PI2DSH_DSH_CWD ?? dshRoot)
const { makeHome, useJsonlSessions, useDefaultModel, sessionRecords } = createE2eHarness({ dshRoot, directDshBin, dshBin, dshCwd })
const outputPath = resolve(process.argv[2] ?? 'community/examples-e2e.json')
const apiKey = process.env.DEEPSEEK_API_KEY
const alibabaTokenPlanKey = process.env.ALIBABA_TOKEN_PLAN_API_KEY
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
async function installedEngineVersion(home, profile, via) {
  // Direct installs put the engine at the profile root; a suite install (via
  // dsh-work-x) makes it a TRANSITIVE dependency, which pnpm's isolated
  // layout keeps out of the root — resolve it from the suite package instead.
  // The suite entry at the profile root is a pnpm symlink; the engine lives
  // beside the suite's REAL directory in .pnpm, so anchor at the realpath.
  const manifest = via === undefined
    ? join(home, 'profiles', profile, 'node_modules/pi2dsh/package.json')
    : createRequire(await realpath(join(home, 'profiles', profile, 'node_modules', via, 'package.json')))
        .resolve('pi2dsh/package.json')
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
    const source = await stat(at)
    if (!source.isDirectory()) {
      const sha256 = createHash('sha256').update(await readFile(at)).digest('hex')
      return { from: 'local-tarball', spec: 'file:<tarball>', sha256 }
    }
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


/**
 * Boot the web surface the same way runDsh runs the CLI. With a direct bin
 * (PI2DSH_DSH_BIN) the process must run WITHOUT the tsx loader and outside the
 * checkout: `--import tsx/esm` with cwd inside a DSH source tree lets that
 * tree's tsconfig paths hijack `@deepseek-ai/*` resolution into its workspace
 * sources — the run then tests the checkout's branch, not the installed CLI.
 */
function spawnWeb(port, env) {
  return spawn(
    directDshBin === undefined ? 'node' : directDshBin,
    directDshBin === undefined
      ? ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)]
      : ['--profile', 'web', '--port', String(port)],
    { cwd: dshCwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
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
const registryVision = {
  provider: process.env.VISION_BRIDGE_REGISTRY_PROVIDER,
  model: process.env.VISION_BRIDGE_REGISTRY_MODEL,
  authFile: process.env.CODEX_AUTH_FILE,
}
const registryVisionMissing = Object.entries(registryVision)
  .filter(([, value]) => (value ?? '').length === 0)
  .map(([name]) => name)
const hasOpenAiVision = visionMissing.length === 0
const hasRegistryVision = registryVisionMissing.length === 0

/** Configure the plugin's Pi-registry mode inside an isolated OS home. */
async function prepareRegistryVision(scratch, home, env) {
  if (!hasRegistryVision) return
  const userHome = join(scratch, 'user-home')
  const configDirectory = join(userHome, '.pi', 'agent')
  await mkdir(configDirectory, { recursive: true })
  await writeFile(join(configDirectory, 'vision-bridge.json'), `${JSON.stringify({
    enabled: true,
    forceVisionBridge: true,
    vision: {
      active: 'e2e-registry',
      models: [{
        name: 'e2e-registry',
        type: 'pi-registry',
        registryProvider: registryVision.provider,
        registryModel: registryVision.model,
      }],
    },
  })}\n`)
  await seedCodexLogin(home, registryVision.authFile)
  // @kassing/pi-vision resolves its global config with os.homedir(). Keep the
  // real developer home entirely out of this disposable run.
  env.HOME = userHome
}



/**
 * Assert the image was read through the vision path, not reconstructed.
 *
 * @kassing/pi-vision ships TWO paths, and the example exercises whichever the
 * configuration selects (README "the vision plugin"):
 *   - COMPANION: when a vision route is configured, the image-admission
 *     companion analyzes the image itself and INJECTS the analysis as a
 *     `[图片视觉分析结果（外部视觉模型）] …` message, replacing the image
 *     reference in the original turn. No tool runs; the model just reads the
 *     injection.
 *   - TOOL: when unconfigured, the companion drops a path placeholder and the
 *     model reaches the image through an image-reading tool.
 * Both are the bridge genuinely working. The discriminator against a FALSE
 * green (the main model decoding the PNG itself, which happened for months) is
 * per path: the tool path needs a non-error tool result; the companion path
 * needs the injected analysis AND proof the model could not have read the
 * image on its own — the image reference was stripped from the turn and the
 * model made zero tool calls, so pixels never reached it.
 */
const VISION_COMPANION_PREFIX = '[图片视觉分析结果（外部视觉模型）]'
const VISION_PATH_STRIPPED = '图片文件已由外部视觉模型分析'

function assertVisionReallyRead(records, transcript) {
  const userBlocks = records
    .filter(record => record.type === 'user/message')
    .flatMap(record => Array.isArray(record.data?.content) ? record.data.content : [])
    .filter(block => block.type === 'text')
    .map(block => String(block.text ?? ''))
  const bridgeFailure = userBlocks.find(text => /Vision understanding failed:|视觉理解失败/u.test(text))
  assert(bridgeFailure === undefined,
    `the vision plugin reported its own failure: ${String(bridgeFailure).slice(0, 1000)}`)

  const reads = records.filter(record => record.type === 'tool/call' && /image/iu.test(String(record.data?.name ?? '')))
  // Companion path: the analysis was injected and the image was stripped from
  // the turn, so the model had no path to decode it itself.
  const injected = userBlocks.some(text => text.includes(VISION_COMPANION_PREFIX))
  const stripped = userBlocks.some(text => text.includes(VISION_PATH_STRIPPED))
  if (injected && reads.length === 0) {
    assert(stripped,
      `the vision analysis was injected but the image reference was not stripped — the model may have read the file directly:\n${transcript.slice(-1500)}`)
    const anyTool = records.some(record => record.type === 'tool/call')
    assert(!anyTool,
      `a tool ran on the companion path, so the answer's provenance is not the vision injection alone:\n${transcript.slice(-1500)}`)
    return
  }

  // Tool path: an image tool ran; require its result was not an error.
  assert(reads.length > 0,
    `neither the vision companion injected an analysis nor an image tool ran:\n${transcript.slice(-1500)}`)
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
// examples/alibaba-token-plan — published engine + real Plan + full tool loop
// ---------------------------------------------------------------------------
async function runAlibabaTokenPlan() {
  if (alibabaTokenPlanKey === undefined || alibabaTokenPlanKey.length === 0) {
    results.alibabaTokenPlan = { status: 'skipped', reason: 'ALIBABA_TOKEN_PLAN_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-alibaba-plan-'))
  try {
    const { home, runDsh } = await makeHome(scratch, {
      ALIBABA_TOKEN_PLAN_API_KEY: alibabaTokenPlanKey,
    })
    const installedEngine = await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    const installedProvider = await runDsh([
      'plugin', '--profile', 'headless', 'add', 'pi-provider-alibaba@1.0.1',
    ])
    const installedProbe = await runDsh([
      'plugin', '--profile', 'headless', 'add',
      `file:${join(projectRoot, 'examples/alibaba-token-plan/probe-tool')}`,
    ])
    await useJsonlSessions(home, 'headless')
    await useDefaultModel(home, 'alibaba-token-cn', 'deepseek-v4-pro')

    const runOnce = marker => runDsh([
      '--profile', 'headless',
      `Call alibaba_plan_probe exactly once with {"value":"${marker}"}, then reply with exactly the tool result.`,
    ])
    const first = await runOnce('REGISTRY_FIRST_USE_OK')
    const restarted = await runOnce('REGISTRY_RESTART_OK')
    assert.match(first.stdout, /ALIBABA_PLAN_PROBE:REGISTRY_FIRST_USE_OK/u,
      `first-use Plan turn did not complete:\n${first.stdout}\n${first.stderr}`)
    assert.match(restarted.stdout, /ALIBABA_PLAN_PROBE:REGISTRY_RESTART_OK/u,
      `restarted Plan turn did not complete:\n${restarted.stdout}\n${restarted.stderr}`)

    const sessionFiles = (await filesBelow(join(home, 'sessions')))
      .filter(path => path.endsWith('/session.jsonl'))
    assert.equal(sessionFiles.length, 2, `expected two durable Plan sessions, found ${sessionFiles.length}`)
    const rawLogs = await Promise.all(sessionFiles.map(path => readFile(path, 'utf8')))
    const records = rawLogs.flatMap(raw => raw.split('\n').filter(Boolean).map(line => JSON.parse(line)))
    const headers = records.filter(record => record.type === 'request/header')
    assert(headers.length >= 4, `expected two model steps in each Plan turn, saw ${headers.length} requests`)
    for (const header of headers) {
      assert.equal(header.data?.header?.config?.provider, 'alibaba-token-cn')
      assert.equal(header.data?.header?.config?.model, 'deepseek-v4-pro')
    }
    const calls = records.filter(record => record.type === 'tool/call'
      && record.data?.name === 'alibaba_plan_probe')
    const toolResults = records.filter(record => record.type === 'tool/result'
      && JSON.stringify(record.data).includes('ALIBABA_PLAN_PROBE:'))
    assert.equal(calls.length, 2, `expected two real Plan tool calls, saw ${calls.length}`)
    assert.equal(toolResults.length, 2, `expected two paired Plan tool results, saw ${toolResults.length}`)
    for (const call of calls) assert(String(call.data?.callId ?? '').length > 0, 'Plan tool call lost callId')

    const captured = [
      installedEngine.stdout, installedEngine.stderr,
      installedProvider.stdout, installedProvider.stderr,
      installedProbe.stdout, installedProbe.stderr,
      first.stdout, first.stderr, restarted.stdout, restarted.stderr,
      ...rawLogs,
    ].join('\n')
    assert(!captured.includes(alibabaTokenPlanKey), 'Plan credential appeared in captured evidence')
    const persistedMatches = []
    for (const path of await filesBelow(home)) {
      if ((await readFile(path)).includes(Buffer.from(alibabaTokenPlanKey))) persistedMatches.push(path)
    }
    assert.deepEqual(persistedMatches, [], `Plan credential persisted in ${persistedMatches.join(', ')}`)

    results.alibabaTokenPlan = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      providerPackage: 'pi-provider-alibaba@1.0.1',
      route: 'alibaba-token-cn',
      model: 'deepseek-v4-pro',
      sessions: sessionFiles.length,
      requests: headers.length,
      toolCalls: calls.length,
      persistedCredentialFiles: persistedMatches.length,
    }
  } finally {
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
  if (!hasOpenAiVision && !hasRegistryVision) {
    results.visionBridge = { status: 'skipped', reason: 'no complete OpenAI-compatible or Pi-registry vision model configured' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-vision-'))
  try {
    const { home, env, runDsh } = await makeHome(scratch, hasOpenAiVision ? visionEnv : {})
    const installed = await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    const installedVision = await runDsh(['plugin', '--profile', 'headless', 'add', '@kassing/pi-vision'])
    await prepareRegistryVision(scratch, home, env)
    await useJsonlSessions(home, 'headless')

    const image = join(projectRoot, 'examples/vision-bridge/test-images/solid-green.png')
    await stat(image)
    // The README's own command, verbatim in shape.
    const run = await runDsh(['--profile', 'headless',
      `What solid color fills the image at ${image} ? Answer with just the color name. `
      + 'If the vision-bridge message reports a failure, answer VISION_BRIDGE_FAILED without using tools.'])

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
    results.visionBridge = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      image: 'solid-green.png',
      answeredGreen: true,
      readThroughVision: true,
      visionRoute: hasRegistryVision ? `${registryVision.provider}/${registryVision.model}` : 'openai-compatible',
    }
  } finally {
    if (process.env.PI2DSH_KEEP_SCRATCH === '1') {
      console.error(`[examples-e2e] kept vision scratch for diagnosis: ${scratch}`)
    } else {
      await rm(scratch, { recursive: true, force: true })
    }
  }
}

// ---------------------------------------------------------------------------
// examples/persistent-memory — pi-hermes-memory across two REAL sessions
// ---------------------------------------------------------------------------
async function runPersistentMemory() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.persistentMemory = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-memory-'))
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    const installed = await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    const installedMemory = await runDsh(['plugin', '--profile', 'headless', 'add', 'pi-hermes-memory'])
    await useJsonlSessions(home, 'headless')

    // The falsifiable design: the codeword exists ONLY in session A's user
    // message. A fresh home means session B can answer it only if the plugin
    // really persisted it — there is no other channel.
    const CODEWORD = 'ZEPHYR-7741'
    const runA = await runDsh(['--profile', 'headless',
      `Remember this durable project fact for future sessions: my project codename is ${CODEWORD}. `
      + 'Save it to persistent memory now, then confirm in one short sentence.'])
    const runB = await runDsh(['--profile', 'headless',
      'What is my project codename? Answer with just the codename. '
      + 'If you genuinely have no memory of one, answer NO-MEMORY.'])

    const files = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl')).sort()
    assert.equal(files.length, 2, `expected two session logs, found ${files.length}:\n  ${files.join('\n  ')}`)
    const load = async file => (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    const logs = [await load(files[0]), await load(files[1])]
    // Identify B as the session whose user message does NOT carry the codeword.
    const userText = records => records
      .filter(record => record.type === 'user/message')
      .flatMap(record => Array.isArray(record.data?.content) ? record.data.content : [])
      .map(block => String(block.text ?? '')).join('\n')
    const aIndex = logs.findIndex(records => userText(records).includes(CODEWORD))
    assert(aIndex !== -1, 'no session carries the memorize prompt at all')
    const a = logs[aIndex]
    const b = logs[1 - aIndex]
    assert(!userText(b).includes(CODEWORD), 'both sessions carry the codeword in user input — the design is broken')

    // Session A: the plugin's own write tool ran and did not error.
    const writes = a.filter(record => record.type === 'tool/call' && /^memory_(add|replace)$/u.test(String(record.data?.name ?? '')))
    assert(writes.length > 0, `session A never called the memory write tool:\n${JSON.stringify(a.filter(r => r.type === 'tool/call').map(r => r.data?.name))}`)
    for (const call of writes) {
      const result = a.find(record => record.type === 'tool/result'
        && (record.data?.message?.content ?? []).some(block => block.toolCallId === call.data.callId))
      const block = (result?.data?.message?.content ?? []).find(item => item.toolCallId === call.data.callId)
      assert(block?.isError !== true, `memory write failed: ${JSON.stringify(block?.content).slice(0, 300)}`)
    }

    // Session B: the recall really happened, and the codeword's only possible
    // source is the plugin's store (injection or memory tool result).
    const bAnswer = b
      .filter(record => record.type === 'assistant/message')
      .flatMap(record => record.data?.message?.content ?? [])
      .filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n')
    assert(bAnswer.includes(CODEWORD),
      `session B did not recall the codename; it said: ${bAnswer.slice(0, 300) || runB.stdout.slice(-300)}`)

    const captured = `${installed.stdout}${installed.stderr}${installedMemory.stdout}${installedMemory.stderr}${runA.stdout}${runA.stderr}${runB.stdout}${runB.stderr}`
    assert(!captured.includes(apiKey), 'credential appeared in captured test artifacts')

    results.persistentMemory = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      wroteVia: writes.map(call => call.data.name),
      recalledAcrossSessions: true,
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/background-tasks — pi-background-tasks: start a long shell job,
// then read its output MID-RUN in the same turn (the live-tracking property)
// ---------------------------------------------------------------------------
async function runBackgroundTasks() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.backgroundTasks = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-bgtasks-'))
  try {
    const { home, runDsh } = await makeHome(scratch)
    const installed = await runDsh(['plugin', '--profile', 'headless', 'add', engineSpec])
    const installedBg = await runDsh(['plugin', '--profile', 'headless', 'add', 'pi-background-tasks'])
    await useJsonlSessions(home, 'headless')

    // The falsifiable design: the job ticks once per second for 60s, far
    // longer than the turn. A non-error bg_logs result that contains early
    // ticks but NOT the final tick can only mean the output of a job that is
    // STILL RUNNING was read — the live-tracking property itself. If the
    // package cannot start jobs, or cannot expose output before completion,
    // one of these assertions fails; nothing else can fake them.
    const run = await runDsh(['--profile', 'headless',
      'Use the bg_run tool to start a background shell job named ticker that runs exactly this command: '
      + "sh -c 'for i in $(seq 1 60); do echo tick $i; sleep 1; done'. "
      + 'Immediately after it starts, call the bg_logs tool for that task and show me the raw output lines it returned. '
      + 'Do not wait for the job to finish and do not kill it.'])

    const files = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    assert.equal(files.length, 1, `expected one session log, found ${files.length}`)
    const records = (await readFile(files[0], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))

    const resultFor = call => {
      const record = records.find(item => item.type === 'tool/result'
        && (item.data?.message?.content ?? []).some(block => block.toolCallId === call.data.callId))
      return (record?.data?.message?.content ?? []).find(block => block.toolCallId === call.data.callId)
    }
    const textOf = block => JSON.stringify(block?.content ?? '')

    const starts = records.filter(record => record.type === 'tool/call' && record.data?.name === 'bg_run')
    assert(starts.length > 0, `bg_run was never called; tools called: ${JSON.stringify(records.filter(r => r.type === 'tool/call').map(r => r.data?.name))}`)
    const startBlock = resultFor(starts[0])
    assert(startBlock !== undefined && startBlock.isError !== true,
      `bg_run failed: ${textOf(startBlock).slice(0, 300)}`)

    const peeks = records.filter(record => record.type === 'tool/call' && record.data?.name === 'bg_logs')
    assert(peeks.length > 0, 'bg_logs was never called — no mid-run output read happened')
    const peekTexts = peeks.map(call => resultFor(call)).filter(block => block !== undefined && block.isError !== true).map(textOf)
    assert(peekTexts.length > 0, `every bg_logs call errored: ${peeks.map(call => textOf(resultFor(call))).join(' | ').slice(0, 400)}`)
    const withTicks = peekTexts.filter(text => /tick(\\n| )?\d+|tick\s*\d+/u.test(text) || text.includes('tick'))
    assert(withTicks.length > 0, `bg_logs returned no tick output: ${peekTexts.join(' | ').slice(0, 400)}`)
    assert(!withTicks.some(text => text.includes('tick 60')),
      'bg_logs already contains the final tick — the job finished before the read, which does not prove live tracking')

    const captured = `${installed.stdout}${installed.stderr}${installedBg.stdout}${installedBg.stderr}${run.stdout}${run.stderr}`
    assert(!captured.includes(apiKey), 'credential appeared in captured test artifacts')

    results.backgroundTasks = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      bgRunCalls: starts.length,
      bgLogsMidRunReads: withTicks.length,
    }
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
  // The web presentation is the dsh-work-x suite's (2026-08-27): the engine
  // alone no longer projects a side panel, and the suite bundles pi-btw plus
  // its own real side-chat window. The example's install line IS the suite.
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-side-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    const tarball = await stageSuiteTarball(projectRoot, engineSpec, scratch, env)
    await runDsh(['plugin', '--profile', 'web', 'add', tarball])
    await useJsonlSessions(home, 'web')

    const port = Number(process.env.SIDE_PORT ?? 5187)
    web = spawnWeb(port, env)
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      const up = await fetch(url).then(
        // 200 = rc lines; 401 = the 0.1.2 launch-token gate answering an
        // uncookied index read from OUR just-spawned server — up and guarding.
        // Anything else (the leaked-zombie 400 of 2026-08-28) is NOT ready.
        response => response.ok || response.status === 401,
      ).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    // Drive one `/btw` line the way a user types it; the durable assertions
    // below read the session logs, never the page (the page legitimately
    // shows the answer — in the side surfaces — so page text proves nothing).
    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [join(projectRoot, 'docs/posting-kit/capture-side-chat.mjs'), shots, '--url', authedUrl(url, webLog)], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the side-conversation run produced no screenshot')

    // The example's core claim, asserted structurally: bridge-minted side
    // sessions carry the pi2dsh-sub- id prefix. The ANSWER (Herbert) must
    // appear in a side session's log and in NO main-session log — the
    // question line itself (`/btw who wrote…`) lives in the main log, which
    // is exactly why the answer word, not the question, is the discriminator.
    const logs = []
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.name.endsWith('.jsonl')) logs.push({ path, text: await readFile(path, 'utf8') })
      }
    }
    await walk(join(home, 'sessions'))
    assert(logs.length > 0, 'no session logs were written at all')
    const side = logs.filter(log => log.path.includes('pi2dsh-sub-'))
    const main = logs.filter(log => !log.path.includes('pi2dsh-sub-'))
    assert(side.some(log => /herbert/iu.test(log.text)),
      `no side session log contains the answer (side logs: ${side.length})`)
    const leaked = main.filter(log => /herbert/iu.test(log.text))
    assert(leaked.length === 0,
      `the side answer leaked into a main session log: ${leaked.map(log => log.path).join(', ')}`)

    results.sideConversation = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'web', 'dsh-work-x'),
      install: 'dsh-work-x suite (bundles pi-btw)',
      sideAnswerIsolated: true,
      screenshots: captured.sort(),
    }
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
  if (!hasOpenAiVision && !hasRegistryVision) {
    results.visionBridgeWeb = { status: 'skipped', reason: 'no complete OpenAI-compatible or Pi-registry vision model configured' }
    return
  }
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-vision-web-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch, hasOpenAiVision ? visionEnv : {})
    await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'web', 'add', '@kassing/pi-vision'])
    await prepareRegistryVision(scratch, home, env)
    await useJsonlSessions(home, 'web')

    const port = Number(process.env.VISION_PORT ?? 5188)
    web = spawnWeb(port, env)
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      const up = await fetch(url).then(
        // 200 = rc lines; 401 = the 0.1.2 launch-token gate answering an
        // uncookied index read from OUR just-spawned server — up and guarding.
        // Anything else (the leaked-zombie 400 of 2026-08-28) is NOT ready.
        response => response.ok || response.status === 401,
      ).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    const image = join(projectRoot, 'examples/vision-bridge/test-images/solid-green.png')
    await stat(image)
    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [
      join(projectRoot, 'docs/posting-kit/capture-vision.mjs'), shots, '--url', authedUrl(url, webLog), '--image', image,
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
    results.visionBridgeWeb = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'web'),
      screenshots: captured.sort(),
      readThroughVision: true,
      visionRoute: hasRegistryVision ? `${registryVision.provider}/${registryVision.model}` : 'openai-compatible',
    }
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
      'agent-default-model:',
      '  provider: my-gateway',
      '  model: deepseek-chat',
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
    // The same configured route must do BOTH jobs the README promises: drive
    // the real agent turn and appear in the mounted Pi package's registry.
    // Running the probe on some other default model would prove only catalog
    // projection, not that `my-gateway` can actually serve a conversation.
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
    const request = records.find(record => record.type === 'request/header')
    assert.equal(request?.data?.header?.config?.provider, 'my-gateway',
      `the probe turn did not actually use the configured route: ${JSON.stringify(request?.data?.header?.config)}`)
    assert.equal(request?.data?.header?.config?.model, 'deepseek-chat')
    assert.match(`${run.stdout}`, /my-gateway/u,
      `the real gateway-backed turn did not complete with the probe output:\n${run.stdout}\n${run.stderr}`)
    results.customGateways = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      seenByPackage: entry,
      requestedThroughGateway: true,
    }
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
    // Web presentation is the dsh-work-x suite's (2026-08-27): the engine
    // alone projects nothing into the browser, so the example installs the
    // suite and adds the status-line package on top.
    const tarball = await stageSuiteTarball(projectRoot, engineSpec, scratch, env)
    await runDsh(['plugin', '--profile', 'web', 'add', tarball])
    await runDsh(['plugin', '--profile', 'web', 'add', 'pi-powerline-footer'])
    await useJsonlSessions(home, 'web')

    const port = Number(process.env.SURFACES_PORT ?? 5189)
    web = spawnWeb(port, env)
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      const up = await fetch(url).then(
        // 200 = rc lines; 401 = the 0.1.2 launch-token gate answering an
        // uncookied index read from OUR just-spawned server — up and guarding.
        // Anything else (the leaked-zombie 400 of 2026-08-28) is NOT ready.
        response => response.ok || response.status === 401,
      ).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    // The capture script IS the assertion: each seat has to hold the string the
    // Pi package supplied, checked inside that seat rather than in page text.
    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [join(projectRoot, 'docs/posting-kit/capture-surfaces.mjs'), shots, '--url', authedUrl(url, webLog)], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the surfaces run produced no screenshots')
    results.presentationSurfaces = { status: 'passed', engine: await installedEngineVersion(home, 'web', 'dsh-work-x'), install: 'dsh-work-x suite + pi-powerline-footer', screenshots: captured.sort() }
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
  const authFile = process.env.CODEX_AUTH_FILE
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    await runDsh(['plugin', '--profile', 'web', 'add', engineSpec])
    // The package the example names for exactly this case.
    await runDsh(['plugin', '--profile', 'web', 'add', 'pi-provider-kimi-code'])
    if (authFile !== undefined && authFile.length > 0) await seedCodexLogin(home, authFile)

    // Boot the runtime and read what the engine announced. Deliberately not a
    // prompt: this scenario needs no model, so it must not need a model key
    // either — otherwise the one part of the example that CAN run without an
    // account would still be skipped for want of one.
    const port = 5300 + Math.floor(Math.random() * 200)
    web = spawnWeb(port, env)
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
    let accountBacked
    if (authFile !== undefined && authFile.length > 0) {
      const shots = join(scratch, 'provider-shots')
      await execFile('node', [
        join(projectRoot, 'docs/posting-kit/capture-providers.mjs'),
        shots,
        '--url', `http://127.0.0.1:${port}`,
      ], {
        cwd: projectRoot,
        env: {
          ...env,
          PLAYWRIGHT_FROM: process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web'),
          CAPTURE_WORKSPACE: projectRoot,
        },
        timeout: 240_000,
        maxBuffer: 16 * 1024 * 1024,
      })
      accountBacked = {
        provider: 'openai-codex',
        loginDialog: true,
        modelPicker: true,
        screenshots: (await readdir(shots)).sort(),
      }
    }
    results.subscriptionLogin = {
      status: accountBacked === undefined ? 'partial' : 'passed',
      engine: await installedEngineVersion(home, 'web'),
      ...(accountBacked === undefined ? {
        note: 'pre-login discovery and native route passed; set CODEX_AUTH_FILE to verify the post-login model picker',
      } : { accountBacked }),
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

// ---------------------------------------------------------------------------
// examples/tui-mcp — clean installed profile + complete host-influenced MCP matrix
// ---------------------------------------------------------------------------
async function runTuiMcp() {
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-tui-mcp-'))
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    // Pinned: dsh-TUI 0.9.1/0.9.2 (2026-08-25) declare release-range deps
    // (>=0.1.1) that match no published rc of the DSH core line — they are
    // uninstallable upstream bugs; 0.9.0 is the last installable version.
    await runDsh(['plugin', '--profile', 'dsh-tui', 'add', process.env.PI2DSH_TUI_SPEC ?? '@deepseek-harness-tui/dsh-tui@0.9.0'])
    await runDsh(['plugin', '--profile', 'dsh-tui', 'add', engineSpec])
    await runDsh(['plugin', '--profile', 'dsh-tui', 'add', 'pi-mcp-adapter'])
    const profileRoot = join(home, 'profiles', 'dsh-tui')
    const profile = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'))
    const piMcpManifest = JSON.parse(await readFile(join(profileRoot, 'node_modules', 'pi-mcp-adapter', 'package.json'), 'utf8'))
    assert(profile.dsh?.profile?.bundles?.includes('@deepseek-harness-tui/dsh-tui'),
      'the installed profile did not retain the dsh-TUI surface bundle')
    assert(profile.dsh?.profile?.bundles?.includes('pi2dsh'),
      'the installed profile did not retain the pi2dsh engine bundle')

    // The real DSH loader injects bundle peers from the host composition. This
    // verifier imports the installed engine directly so it can drive an exact
    // fake of dsh-TUI's public services without starting a second terminal;
    // give that standalone Node import the same peer packages. These links are
    // test scaffolding only and live inside the throwaway profile.
    const engineRoot = join(profileRoot, 'node_modules', 'pi2dsh')
    const engineManifest = JSON.parse(await readFile(join(engineRoot, 'package.json'), 'utf8'))
    const peers = new Set([
      ...Object.keys(engineManifest.peerDependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/')),
      // Bundled entry chunks import these host services directly even though
      // they are not part of the plugin's public peer type surface.
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-llm-pi-ai',
    ])
    for (const peer of peers) {
      const source = join(projectRoot, 'node_modules', peer)
      const target = join(profileRoot, 'node_modules', peer)
      await stat(source)
      const targetExists = await stat(target).then(() => true, () => false)
      if (targetExists) continue
      await mkdir(resolve(target, '..'), { recursive: true })
      await symlink(source, target, 'dir')
    }

    const run = await execFile('node', [join(projectRoot, 'scripts/verify-tui-mcp-tool-e2e.mjs')], {
      cwd: projectRoot,
      env: {
        ...env,
        PI2DSH_ENGINE_ROOT: engineRoot,
        PI2DSH_MCP_ADAPTER_ROOT: join(profileRoot, 'node_modules', 'pi-mcp-adapter'),
      },
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    assert.match(run.stdout, /"verdict": "pass"/u, `the MCP verifier did not pass:\n${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /"streamableHttp"/u, 'the verifier did not execute the real Streamable HTTP transport')
    assert.match(run.stdout, /"legacySse"/u, 'the verifier did not execute the real legacy SSE transport')
    assert.match(run.stdout, /"samplingCalls": 1/u, 'the verifier did not route MCP sampling through DSH llm')
    assert.match(run.stdout, /"mcpApp"/u, 'the verifier did not serve an MCP App through the adapter UI host')
    assert.match(run.stdout, /"sessionRestart": true/u, 'the verifier did not survive a real Pi session restart')
    results.tuiMcp = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'dsh-tui'),
      profile: 'dsh-tui',
      piPackage: 'pi-mcp-adapter',
      piPackageVersion: piMcpManifest.version,
      command: '/pi-mcp',
      nativeCommandPreserved: '/mcp',
      mcpServer: '@modelcontextprotocol/server-everything',
      transports: ['stdio', 'streamable-http', 'sse'],
      capabilities: [
        'manager', 'discovery', 'proxy', 'direct-tools', 'mcpScript',
        'resources', 'prompts', 'images', 'structured-content', 'mcp-app-ui', 'approval',
        'elicitation', 'sampling', 'cancellation', 'reconnect', 'session-restart',
      ],
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}


/**
 * examples/subagents — the pi-subagents lifecycle, delegated to its own
 * real-machine harness (scripts/verify-subagents-lifecycle-e2e.mjs): steer,
 * resume, stop and cross-restart reopen on the stock CLI, the stock package
 * and a real model. That script owns its skip logic (no DeepSeek credential
 * -> skipped) and its own evidence file; this wrapper folds the verdict into
 * the examples evidence so the example regresses with the rest.
 */
async function runSubagents() {
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-subagents-'))
  const evidence = join(scratch, 'subagents.json')
  let output = ''
  await new Promise(done => {
    const child = spawn(process.execPath, [
      resolve(projectRoot, 'scripts', 'verify-subagents-lifecycle-e2e.mjs'), evidence,
    ], {
      cwd: projectRoot,
      // The harness reads PI2DSH_ENGINE_SPEC itself; a file: spec means the
      // working tree, which is also its own default.
      env: { ...process.env, ...(engineSpec.startsWith('file:') ? {} : { PI2DSH_ENGINE_SPEC: engineSpec }) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.stderr.on('data', chunk => { output += String(chunk) })
    child.on('exit', () => done(undefined))
    child.on('error', () => done(undefined))
  })
  let verdict
  try {
    verdict = JSON.parse(await readFile(evidence, 'utf8'))
  } catch {
    results.subagents = { status: 'failed', error: `the lifecycle harness left no evidence; tail: ${output.slice(-600)}` }
    return
  }
  const scenarios = verdict.scenarios ?? {}
  if (verdict.status === 'skipped') {
    results.subagents = { status: 'skipped', reason: scenarios.all?.reason ?? 'lifecycle harness skipped' }
    return
  }
  const digest = Object.fromEntries(Object.entries(scenarios)
    .filter(([, value]) => value !== null && typeof value === 'object' && typeof value.status === 'string')
    .map(([name, value]) => [name, value.status]))
  results.subagents = {
    status: verdict.status === 'passed' ? 'passed' : 'failed',
    engine: scenarios.stack?.engineVersion,
    cli: scenarios.stack?.cliVersion,
    scenarios: digest,
    ...(verdict.status === 'passed' ? {} : { error: Object.entries(scenarios)
      .flatMap(([name, value]) => (Array.isArray(value?.problems) && value.problems.length > 0
        ? [`${name}: ${value.problems.join('; ')}`] : []))
      .join(' | ') || 'see the lifecycle evidence file' }),
  }
}

// ---------------------------------------------------------------------------
// dsh-x — the capability suite: ONE `dsh plugin add` carries the engine and
// its pinned Pi packages, and the web composer really offers their commands.
// ---------------------------------------------------------------------------

/**
 * Stage the dsh-work-x suite as a real tarball with its engine dependency
 * pointed at THIS run's engine (local tree or release spec). A tarball
 * install is the shape an npm user gets — pnpm links path installs back to
 * their source directory, where the suite's dependencies are unresolvable.
 * @param scratch - scenario scratch directory.
 * @param env - environment for npm pack.
 * @returns absolute tarball path, installable with `dsh plugin add`.
 */

/**
 * The url a BROWSER should open for this server. The 0.1.2 line prints a
 * one-time launch token into the server log and answers uncookied index
 * reads with 401; opening the printed `?token=` url once exchanges it for
 * the session cookie. rc lines print no token and the url passes through.
 * @param url - the bare origin url.
 * @param webLog - captured server stdout+stderr so far.
 * @returns the url for the capture's page.goto().
 */
function authedUrl(url, webLog) {
  const token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(webLog)
  return token === null ? url : `${url}/?token=${token[1]}`
}


async function runDshX() {
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-dshx-'))
  let web
  try {
    const { home, env, runDsh } = await makeHome(scratch)
    const tarball = await stageSuiteTarball(projectRoot, engineSpec, scratch, env)
    // The ONLY install a dsh-x user runs.
    await runDsh(['plugin', '--profile', 'web', 'add', tarball])
    // Side-chat's durable assertions read the session log; the host renders
    // plugin-sourced messages collapsed, so the page is the wrong layer.
    await useJsonlSessions(home, 'web')
    const profileManifest = JSON.parse(await readFile(join(home, 'profiles/web/package.json'), 'utf8'))
    const bundles = profileManifest.dsh?.profile?.bundles ?? []
    assert(bundles.includes('dsh-work-x'), `dsh-work-x missing from the profile's bundle layers: ${JSON.stringify(bundles)}`)

    // 5193: unique among the parallel scenarios (5187 side-conversation,
    // 5188 vision-web, 5189 presentation-surfaces) — sharing 5189 made the
    // surfaces capture drive THIS scenario's web and fail both.
    const port = Number(process.env.DSHX_PORT ?? 5193)
    web = spawnWeb(port, env)
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 90_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      if (await fetch(url).then(() => true).catch(() => false)) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    // The suite's own patch mounted the engine, the engine expanded the suite
    // manifest to all four members, and companions stayed off (v1 surface).
    const mountDeadline = Date.now() + 60_000
    while (!/preparing 4 Pi package\(s\)/u.test(webLog) && Date.now() < mountDeadline) {
      await new Promise(done => setTimeout(done, 500))
    }
    assert(/preparing 4 Pi package\(s\)/u.test(webLog), `the engine never prepared the 4 suite packages:\n${webLog.slice(-2000)}`)
    for (const name of ['pi-mcp-adapter', '@tintinweb/pi-subagents', 'pi-btw', '@crazygit/pi-codex-image-gen']) {
      assert(webLog.includes(name), `suite member ${name} is missing from the engine mount line`)
    }
    assert(!/companion route/u.test(webLog), 'vision companions must stay OFF under dsh-x, but a companion route registered')
    assert(!/failed to mount/u.test(webLog), `a suite member failed to mount:\n${webLog.split('\n').filter(line => /failed to mount/u.test(line)).join('\n')}`)

    // The falsifiable web check: each member's command offered by the popover.
    const probe = await execFile('node', [join(projectRoot, 'scripts/dsh-x-web-probe.mjs'), join(scratch, 'shots'), '--url', authedUrl(url, webLog)], {
      cwd: projectRoot,
      env: { ...env, PLAYWRIGHT_FROM: playwrightFrom },
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? ''), String(error.stderr ?? '')); throw error })
    // Which spelling each surface mounted IS part of the evidence: original
    // names on the web (no reserved-name list there) vs pi- fallbacks.
    const mountedLine = /popover: (\{.*\})/u.exec(String(probe.stdout))?.[1]

    // The side-chat window's DURABLE halves, from the MAIN session's log —
    // the layer the standards demand for content assertions. The probe
    // already held the in-window halves (answers arrive, nothing leaks).
    let sideChat = 'skipped: no model credential'
    if (!String(probe.stdout).includes('side-chat: SKIPPED')) {
      const sessionFiles = []
      const walk = async (dir) => {
        for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) await walk(path)
          else if (entry.name.endsWith('.jsonl')) sessionFiles.push(path)
        }
      }
      await walk(join(home, 'sessions'))
      let mainLog
      for (const file of sessionFiles) {
        const text = await readFile(file, 'utf8')
        if (text.includes('Reply with exactly one word: ok') && text.includes('"piCustomType":"btw-note"')) {
          mainLog = text
          break
        }
      }
      assert(mainLog !== undefined, `no main-session log carries the saved btw note (searched ${sessionFiles.length} logs)`)
      // --save: the note is a durable main-session message with the answer.
      assert(/btw-note/u.test(mainLog) && /Arrakis/u.test(mainLog),
        'the --save note (Q/A with Arrakis) is missing from the main session log')
      // Inject: pi-btw's summary hand-off reached the main session.
      assert(/side conversation I had for additional context/u.test(mainLog),
        "the injected side-thread summary is missing from the main session log")
      sideChat = 'answers in-window; inject + --save verified in the main session log'
    }

    results.dshX = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'web', 'dsh-work-x'),
      suite: ['pi-mcp-adapter', '@tintinweb/pi-subagents', 'pi-btw', '@crazygit/pi-codex-image-gen'],
      sideChat,
      ...(mountedLine === undefined ? {} : { commands: JSON.parse(mountedLine) }),
    }
  } finally {
    web?.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// examples/code-navigation — @ff-labs/pi-fff + pi-lens on a real project
// ---------------------------------------------------------------------------
// Two planted ground truths make the assertions falsifiable: the marker string
// exists ONLY in notes/spec.md (a search result naming it proves a real
// content search ran — the model cannot guess it from file names), and
// src/ledger.ts carries exactly one type error whose TS2322 wording only a
// real language server produces. Both are asserted from the TOOL RESULTS in
// the session log, never from the model's prose — a broken tool with a model
// that routes around it (bash grep, reading the file) must FAIL here.

/**
 * Remove a scenario scratch tree, tolerating stragglers: pi-lens keeps
 * language-server children writing into its home for a beat after the dsh
 * process is killed, and a concurrent write turns rm into ENOTEMPTY. Cleanup
 * failure is logged, never thrown — a passed scenario must not regress on
 * scratch removal.
 * @param scratch - the scenario directory to remove.
 * @param label - scenario name for the diagnostic.
 */
async function removeScratch(scratch, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(scratch, { recursive: true, force: true })
      return
    } catch {
      await new Promise(done => setTimeout(done, 700))
    }
  }
  try {
    await rm(scratch, { recursive: true, force: true })
  } catch (error) {
    console.error(`[examples-e2e] ${label}: scratch cleanup left ${scratch}: ${String(error)}`)
  }
}

// The README's own prompt, shared by both lanes verbatim.
const CODE_NAV_PROMPT = 'Two tasks in this project: '
  + '1) Use the ffgrep tool to find which file mentions FROSTBITE-7741 and report the file path. '
  + '2) Use the lsp_diagnostics tool on src/ledger.ts and report every error it returns. '
  + 'Do not use bash or any other tool for these two tasks.'

/**
 * Shared rig for both code-navigation lanes: isolated HOME, engine + the two
 * packages installed into `profile` the way the README says, native halves
 * probed, jsonl sessions on, and the sample project staged with its local
 * typescript. Returns everything a lane needs to drive a turn and assert.
 */
async function prepareCodeNavigation(scratch, profile) {
  // pi-lens keeps a managed toolchain under ~/.pi-lens and pi-fff keeps its
  // index caches under the user home; an isolated HOME keeps a regression
  // run from writing into the operator's real home directory.
  const userHome = join(scratch, 'user-home')
  await mkdir(userHome, { recursive: true })
  // PI_LENS_DISABLE_LSP_INSTALL is pi-lens's own switch for its toolchain
  // AUTO-INSTALL only — servers already present still spawn. The primary
  // TypeScript server comes from the sample project's local install (step 2),
  // so diagnostics stay real; without this, every run re-downloads the
  // auxiliary scanners (typos-lsp, opengrep) from GitHub into the fresh
  // isolated HOME and a slow network stalls the web lane's settle window.
  // A user run without the switch just downloads them once on first use.
  const { home, env, runDsh } = await makeHome(scratch, { HOME: userHome, PI_LENS_DISABLE_LSP_INSTALL: '1' })
  const installedEngine = await runDsh(['plugin', '--profile', profile, 'add', engineSpec])
  // pi-lens depends on @ast-grep/cli, whose install script pnpm blocks — the
  // add fails with ERR_PNPM_IGNORED_BUILDS and leaves a partial tree
  // (verified on a stock rc.2 CLI). The README walks the user through
  // `pnpm approve-builds`; this fixture writes the same approval into the
  // profile's pnpm-workspace.yaml, which is what approve-builds does.
  const workspaceFile = join(home, `profiles/${profile}/pnpm-workspace.yaml`)
  await writeFile(workspaceFile, (await readFile(workspaceFile, 'utf8'))
    .replace('allowBuilds:\n', 'allowBuilds:\n  "@ast-grep/cli": true\n'))
  // The README's own install line: both packages in one add.
  const installedNav = await runDsh(['plugin', '--profile', profile, 'add', '@ff-labs/pi-fff', 'pi-lens'])
  // Mount preconditions: the native halves both packages load at runtime.
  // A partial install (the failure mode above) leaves these unresolvable.
  // realpath first — pnpm's isolated layout links node_modules/<pkg> into
  // .pnpm, and a literal-path require walks up past the real dependency dir.
  for (const [pkg, dep] of [['pi-lens', '@ast-grep/napi'], ['@ff-labs/pi-fff', '@ff-labs/fff-node']]) {
    const real = await realpath(join(home, `profiles/${profile}/node_modules`, pkg))
    createRequire(join(real, 'noop.js'))(dep)
  }
  await useJsonlSessions(home, profile)

  // The README's step 2: stage the sample project and install its local
  // typescript, which is what pi-lens's language-server discovery finds.
  const sampleDir = join(scratch, 'sample-project')
  await execFile('cp', ['-R', join(projectRoot, 'examples/code-navigation/sample-project'), sampleDir])
  await execFile('npm', ['install', '--no-fund', '--no-audit'], { cwd: sampleDir, env, timeout: 300_000 })
  return { home, env, sampleDir, installLog: `${installedEngine.stdout}${installedEngine.stderr}${installedNav.stdout}${installedNav.stderr}` }
}

/**
 * The falsifiable core, shared by both lanes and asserted from the session
 * log only: the marker file exists nowhere but notes/spec.md (a search result
 * naming it proves a real content search), and ledger.ts carries exactly one
 * TS2322 whose wording only a real language server produces. A broken tool
 * with a model that routes around it (bash grep, reading the file) fails here.
 * @param records - parsed session.jsonl records.
 * @param transcript - lane output for failure context.
 */
function assertCodeNavigation(records, transcript) {
  // Every {call, result-block} pair for one tool name. Kept as pairs: a
  // per-file tool's RESULT text has no file name in it — the file lives in
  // the call's arguments — so file-scoped assertions must join both sides.
  const resultsFor = name => records
    .filter(record => record.type === 'tool/call' && record.data?.name === name)
    .map(call => {
      const result = records.find(record => record.type === 'tool/result'
        && (record.data?.message?.content ?? []).some(block => block.toolCallId === call.data.callId))
      return { call, block: (result?.data?.message?.content ?? []).find(block => block.toolCallId === call.data.callId) }
    })
    .filter(pair => pair.block !== undefined)

  // 1. The search: a real ffgrep result that NAMES the only file carrying
  //    the marker. fffind cannot substitute (the marker is content, not a
  //    file name), and a bash detour leaves no ffgrep result at all.
  const searches = resultsFor('ffgrep')
  assert(searches.length > 0, `no ffgrep tool result in the session log; the model answered some other way:\n${transcript.slice(0, 600)}`)
  const searchHit = searches.find(({ block }) => block.isError !== true && /spec\.md/u.test(JSON.stringify(block.content)))
  assert(searchHit !== undefined, `ffgrep ran but never returned notes/spec.md:\n${JSON.stringify(searches.map(pair => pair.block)).slice(0, 800)}`)

  // 2. The diagnostics: a real language-server result reporting the planted
  //    TS2322. The file association lives in the CALL's arguments (the
  //    result text is per-file and names no path); degraded syntax-only
  //    checking (no local typescript) reports zero type errors and fails.
  const diagnostics = resultsFor('lsp_diagnostics')
  assert(diagnostics.length > 0, `no lsp_diagnostics tool result in the session log:\n${transcript.slice(0, 600)}`)
  const diagnosticHit = diagnostics.find(({ call, block }) => block.isError !== true
    && /ledger\.ts/u.test(JSON.stringify(call.data?.arguments ?? ''))
    && /2322|not assignable/iu.test(JSON.stringify(block.content)))
  assert(diagnosticHit !== undefined, `lsp_diagnostics ran but never reported the planted type error for ledger.ts:\n${
    JSON.stringify(diagnostics.map(({ call, block }) => ({ arguments: call.data?.arguments, result: block.content }))).slice(0, 900)}`)
}

async function runCodeNavigation() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.codeNavigation = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-codenav-'))
  try {
    const { home, env, sampleDir, installLog } = await prepareCodeNavigation(scratch, 'headless')

    // The turn must run with the sample project as its working directory —
    // fffind/ffgrep and pi-lens search the session cwd, exactly as the README
    // tells the user to `cd sample-project` first. runDsh pins cwd to the CLI
    // directory, so this scenario carries its own runner. cwd-changing lanes
    // REQUIRE the stock npm CLI (PI2DSH_DSH_BIN): the checkout fallback's
    // `--import tsx/esm` resolves tsx from the cwd, and a scratch project
    // directory has no tsx (mcp-at-scale proved this 2026-08-28).
    const runDshIn = (cwd, args) => execFile(
      directDshBin === undefined ? 'node' : directDshBin,
      directDshBin === undefined ? ['--import', 'tsx/esm', dshBin, ...args] : args,
      { cwd, env, timeout: 420_000, maxBuffer: 16 * 1024 * 1024 },
    )
    const run = await runDshIn(sampleDir, ['--profile', 'headless', CODE_NAV_PROMPT])

    const records = await sessionRecords(home)
    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    const rawLog = await readFile(sessionFiles[0], 'utf8')
    assert(!`${installLog}${run.stdout}${run.stderr}${rawLog}`.includes(apiKey), 'credential appeared in captured test artifacts')

    assertCodeNavigation(records, run.stdout)
    results.codeNavigation = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      packages: ['@ff-labs/pi-fff', 'pi-lens'],
      search: 'ffgrep -> notes/spec.md',
      diagnostics: 'lsp_diagnostics -> TS2322 on src/ledger.ts',
    }
  } finally {
    if (process.env.PI2DSH_KEEP_SCRATCH === '1') {
      console.error(`[examples-e2e] kept code-navigation scratch for diagnosis: ${scratch}`)
    } else {
      await removeScratch(scratch, 'code-navigation')
    }
  }
}

// ---------------------------------------------------------------------------
// examples/code-navigation, on the WEB surface
// ---------------------------------------------------------------------------
// The headless pass proves the tools; this proves the surface. The browser
// lane adopts the staged sample project as the session's workspace through
// the host's own workspace.create RPC (what the in-app picker calls), sends
// the same README prompt, and asserts the same two tool results from the
// session log — the screen text is only a smoke check inside the capture.
async function runCodeNavigationWeb() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.codeNavigationWeb = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-codenav-web-'))
  let web
  try {
    const { home, env, sampleDir, installLog } = await prepareCodeNavigation(scratch, 'web')

    const port = Number(process.env.CODENAV_PORT ?? 5190)
    web = spawnWeb(port, env)
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      const up = await fetch(url).then(
        // 200 = rc lines; 401 = the 0.1.2 launch-token gate answering an
        // uncookied index read from OUR just-spawned server — up and guarding.
        // Anything else (the leaked-zombie 400 of 2026-08-28) is NOT ready.
        response => response.ok || response.status === 401,
      ).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [
      join(projectRoot, 'docs/posting-kit/capture-codenav.mjs'), shots, '--url', authedUrl(url, webLog),
    ], {
      cwd: projectRoot,
      // The isolated HOME belongs to the dsh server process (pi-lens caches);
      // the capture process needs the operator's real HOME back, or
      // playwright looks for its browsers in the empty scratch cache.
      env: { ...env, ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }), PLAYWRIGHT_FROM: playwrightFrom, CAPTURE_WORKSPACE: sampleDir },
      timeout: 420_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the code-navigation web run produced no screenshot')

    const records = await sessionRecords(home)
    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    const rawLog = await readFile(sessionFiles[0], 'utf8')
    assert(!`${installLog}${webLog}${rawLog}`.includes(apiKey), 'credential appeared in captured test artifacts')

    assertCodeNavigation(records, webLog)
    results.codeNavigationWeb = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'web'),
      packages: ['@ff-labs/pi-fff', 'pi-lens'],
      screenshots: captured.sort(),
      search: 'ffgrep -> notes/spec.md',
      diagnostics: 'lsp_diagnostics -> TS2322 on src/ledger.ts',
    }
  } finally {
    web?.kill('SIGTERM')
    if (process.env.PI2DSH_KEEP_SCRATCH === '1') {
      console.error(`[examples-e2e] kept code-navigation-web scratch for diagnosis: ${scratch}`)
    } else {
      await removeScratch(scratch, 'code-navigation-web')
    }
  }
}

// ---------------------------------------------------------------------------
// examples/mcp-at-scale — many tools behind one proxy, plus a real timeout
// ---------------------------------------------------------------------------
// The server is REAL (official @modelcontextprotocol/sdk over stdio, 51
// tools); the client is the unmodified npm pi-mcp-adapter. Three claims, all
// falsifiable from the session log:
//   bounded surface — the engine mounts the adapter's 2 meta-tools and the
//     log proves no tool_NNN ever became a DSH tool call;
//   discovery at scale — an `mcp` TOOL RESULT carries the launch marker,
//     which exists only in tool_037's live response (never in any file);
//   timeout budget — an `mcpScript` call on the ~120 s slow_task with
//     timeoutMs 5000 fails structurally, the follow-up tool_001 call still
//     answers, and the whole turn ends far below the tool's real duration.

const MCP_SCALE_PROMPT_DISCOVERY = 'Use the mcp tool to list the tools of the many-tools server, '
  + 'find the one that returns the launch marker, call it, and report the marker verbatim. '
  + 'Use only the mcp tool.'
const MCP_SCALE_PROMPT_TIMEOUT = 'Use the mcpScript tool with timeoutMs 5000 to call the slow_task tool '
  + 'of the many-tools server and tell me exactly what happened. Then use the mcp tool to call tool_001 '
  + 'and report its reply. Use only the mcp and mcpScript tools.'
const MCP_SCALE_MARKER = 'LAUNCH-MARKER-7741-ZEBRA'

async function prepareMcpAtScale(scratch, profile) {
  const { home, env, runDsh } = await makeHome(scratch)
  const installedEngine = await runDsh(['plugin', '--profile', profile, 'add', engineSpec])
  const installedAdapter = await runDsh(['plugin', '--profile', profile, 'add', 'pi-mcp-adapter'])
  await useJsonlSessions(home, profile)

  // The README's workspace: the example directory itself, whose .mcp.json
  // declares the stdio server; its dependencies install like the README says.
  const missionDir = join(scratch, 'mission')
  await execFile('cp', ['-R', join(projectRoot, 'examples/mcp-at-scale'), missionDir])
  await execFile('npm', ['install', '--no-fund', '--no-audit'], { cwd: join(missionDir, 'server'), env, timeout: 300_000 })
  return { home, env, missionDir, installLog: `${installedEngine.stdout}${installedEngine.stderr}${installedAdapter.stdout}${installedAdapter.stderr}` }
}

/** {call, result-block} pairs for one tool name (same join as code-nav). */
function toolPairs(records, name) {
  return records
    .filter(record => record.type === 'tool/call' && record.data?.name === name)
    .map(call => {
      const result = records.find(record => record.type === 'tool/result'
        && (record.data?.message?.content ?? []).some(block => block.toolCallId === call.data.callId))
      return { call, block: (result?.data?.message?.content ?? []).find(block => block.toolCallId === call.data.callId) }
    })
    .filter(pair => pair.block !== undefined)
}

function assertMcpScaleDiscovery(records, transcript) {
  // Bounded surface, from the session log itself: every tool call in the
  // run is one of the adapter's two meta-tools. This is one assertion doing
  // both halves — the positive results below can only have flowed through
  // the proxy, and none of the 50 server tools ever became a first-class
  // DSH call. (The engine's "loaded pi-mcp-adapter: 2 tools" mount line is
  // asserted in the web lane's server log; the one-shot headless CLI does
  // not surface engine mount summaries in captured output.)
  const names = [...new Set(records.filter(record => record.type === 'tool/call').map(record => record.data?.name).filter(Boolean))]
  assert(names.length > 0, `no tool calls at all in the session log:\n${transcript.slice(0, 600)}`)
  // The boundary is about the SERVER's tools, not the model's use of DSH
  // natives (it read the adapter's shipped skill via DSH's own `skill` tool
  // in a real run — legitimate, and no part of the flood the claim is
  // about). None of the 51 server tools may appear as a first-class call.
  const leaked = names.filter(name => /^tool_\d{3}$/u.test(name) || name === 'slow_task')
  assert(leaked.length === 0, `server tools leaked into DSH's registry as first-class calls: ${leaked.join(', ')}`)

  // Discovery: the marker must appear in an mcp TOOL RESULT — it exists only
  // in tool_037's live response, so a model detour (bash, guessing) cannot
  // produce it there.
  const proxied = toolPairs(records, 'mcp')
  assert(proxied.length > 0, `no mcp tool result in the session log; the model answered some other way:\n${transcript.slice(0, 600)}`)
  const markerHit = proxied.find(({ block }) => block.isError !== true && JSON.stringify(block.content).includes(MCP_SCALE_MARKER))
  assert(markerHit !== undefined, `the mcp proxy never returned the launch marker:\n${JSON.stringify(proxied.map(pair => pair.block)).slice(0, 800)}`)
}

function assertMcpScaleTimeout(records, elapsedMs, transcript) {
  const scripted = toolPairs(records, 'mcpScript')
  assert(scripted.length > 0, `no mcpScript tool result in the session log:\n${transcript.slice(0, 600)}`)
  const slowHit = scripted.find(({ call }) => {
    const args = JSON.stringify(call.data?.arguments ?? '')
    return /slow_task/u.test(args) && /timeoutMs/u.test(args)
  })
  assert(slowHit !== undefined, `mcpScript never targeted slow_task with a timeoutMs budget:\n${
    JSON.stringify(scripted.map(({ call }) => call.data?.arguments)).slice(0, 800)}`)
  const slowText = JSON.stringify(slowHit.block.content ?? '') + JSON.stringify(slowHit.block.isError ?? '')
  assert(/timeout|timed out|abort/iu.test(slowText) || slowHit.block.isError === true,
    `the slow_task call did not fail structurally on the budget:\n${slowText.slice(0, 600)}`)

  // Life after the timeout: the follow-up proxied call must really answer.
  const proxied = toolPairs(records, 'mcp')
  const followUp = proxied.find(({ block }) => block.isError !== true && /tool_001 reporting in/u.test(JSON.stringify(block.content)))
  assert(followUp !== undefined, `after the timeout, tool_001 never answered — session or server wedged:\n${
    JSON.stringify(proxied.map(pair => pair.block)).slice(0, 800)}`)

  // The budget must actually cut the wait: the tool takes ~120 s for real,
  // so a turn that honored the 5 s budget ends far below that.
  assert(elapsedMs < 110_000, `the timeout turn took ${Math.round(elapsedMs / 1000)}s — the ~120s tool was awaited, not budgeted`)
}

async function runMcpAtScale() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.mcpAtScale = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-mcpscale-'))
  try {
    const { home, env, missionDir, installLog } = await prepareMcpAtScale(scratch, 'headless')
    const runDshIn = (cwd, args) => execFile(
      directDshBin === undefined ? 'node' : directDshBin,
      directDshBin === undefined ? ['--import', 'tsx/esm', dshBin, ...args] : args,
      { cwd, env, timeout: 420_000, maxBuffer: 16 * 1024 * 1024 },
    )
    const discovery = await runDshIn(missionDir, ['--profile', 'headless', MCP_SCALE_PROMPT_DISCOVERY])
    const timeoutStart = Date.now()
    const budget = await runDshIn(missionDir, ['--profile', 'headless', MCP_SCALE_PROMPT_TIMEOUT])
    const elapsedMs = Date.now() - timeoutStart

    const records = await sessionRecords(home, { expect: 2 })
    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    const rawLog = (await Promise.all(sessionFiles.map(path => readFile(path, 'utf8')))).join('\n')
    assert(!`${installLog}${discovery.stdout}${discovery.stderr}${budget.stdout}${budget.stderr}${rawLog}`.includes(apiKey),
      'credential appeared in captured test artifacts')

    assertMcpScaleDiscovery(records, discovery.stdout)
    assertMcpScaleTimeout(records, elapsedMs, budget.stdout)
    results.mcpAtScale = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'headless'),
      packages: ['pi-mcp-adapter'],
      server: 'many-tools (official MCP SDK, 51 tools, stdio)',
      discovery: `mcp proxy -> tool_037 -> ${MCP_SCALE_MARKER}`,
      timeout: `mcpScript timeoutMs 5000 on ~120s slow_task; turn ended in ${Math.round(elapsedMs / 1000)}s; tool_001 answered after`,
    }
  } finally {
    if (process.env.PI2DSH_KEEP_SCRATCH === '1') {
      console.error(`[examples-e2e] kept mcp-at-scale scratch for diagnosis: ${scratch}`)
    } else {
      await removeScratch(scratch, 'mcp-at-scale')
    }
  }
}

async function runMcpAtScaleWeb() {
  if (apiKey === undefined || apiKey.length === 0) {
    results.mcpAtScaleWeb = { status: 'skipped', reason: 'DEEPSEEK_API_KEY not set' }
    return
  }
  const playwrightFrom = process.env.PLAYWRIGHT_FROM ?? join(dshRoot, 'apps/web')
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-ex-mcpscale-web-'))
  let web
  try {
    const { home, env, missionDir, installLog } = await prepareMcpAtScale(scratch, 'web')
    const port = Number(process.env.MCPSCALE_PORT ?? 5191)
    web = spawnWeb(port, env)
    let webLog = ''
    web.stdout.on('data', chunk => { webLog += String(chunk) })
    web.stderr.on('data', chunk => { webLog += String(chunk) })
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (web.exitCode !== null) throw new Error(`dsh web exited on startup:\n${webLog}`)
      const up = await fetch(url).then(
        // 200 = rc lines; 401 = the 0.1.2 launch-token gate answering an
        // uncookied index read from OUR just-spawned server — up and guarding.
        // Anything else (the leaked-zombie 400 of 2026-08-28) is NOT ready.
        response => response.ok || response.status === 401,
      ).catch(() => false)
      if (up) break
      if (Date.now() > deadline) throw new Error(`dsh web never came up:\n${webLog}`)
      await new Promise(done => setTimeout(done, 500))
    }

    const shots = shotDir ?? join(scratch, 'shots')
    await execFile('node', [
      join(projectRoot, 'docs/posting-kit/capture-mcp-scale.mjs'), shots, '--url', authedUrl(url, webLog),
    ], {
      cwd: projectRoot,
      env: { ...env, ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }), PLAYWRIGHT_FROM: playwrightFrom, CAPTURE_WORKSPACE: missionDir },
      timeout: 420_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch(error => { console.log(String(error.stdout ?? '')); throw error })
    const captured = await readdir(shots)
    assert(captured.length > 0, 'the mcp-at-scale web run produced no screenshot')

    const records = await sessionRecords(home)
    const sessionFiles = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl'))
    const rawLog = (await Promise.all(sessionFiles.map(path => readFile(path, 'utf8')))).join('\n')
    assert(!`${installLog}${webLog}${rawLog}`.includes(apiKey), 'credential appeared in captured test artifacts')

    assertMcpScaleDiscovery(records, webLog)
    // The registry half of the bounded-surface claim: the web server's log
    // carries the engine's mount summary.
    assert(/loaded pi-mcp-adapter: 2 tools/u.test(webLog),
      `the adapter did not mount exactly its 2 meta-tools:\n${webLog.slice(-600)}`)
    results.mcpAtScaleWeb = {
      status: 'passed',
      engine: await installedEngineVersion(home, 'web'),
      packages: ['pi-mcp-adapter'],
      screenshots: captured.sort(),
      discovery: `mcp proxy -> tool_037 -> ${MCP_SCALE_MARKER}`,
    }
  } finally {
    web?.kill('SIGTERM')
    if (process.env.PI2DSH_KEEP_SCRATCH === '1') {
      console.error(`[examples-e2e] kept mcp-at-scale-web scratch for diagnosis: ${scratch}`)
    } else {
      await removeScratch(scratch, 'mcp-at-scale-web')
    }
  }
}

const SCENARIOS = [
  ['gateway-compat', runGatewayCompat, 'gatewayCompat'],
  ['alibaba-token-plan', runAlibabaTokenPlan, 'alibabaTokenPlan'],
  ['vision-bridge', runVisionBridge, 'visionBridge'],
  ['persistent-memory', runPersistentMemory, 'persistentMemory'],
  ['background-tasks', runBackgroundTasks, 'backgroundTasks'],
  ['side-conversation', runSideConversation, 'sideConversation'],
  ['vision-bridge-web', runVisionBridgeWeb, 'visionBridgeWeb'],
  ['custom-gateways', runCustomGateways, 'customGateways'],
  ['presentation-surfaces', runPresentationSurfaces, 'presentationSurfaces'],
  ['subscription-login', runSubscriptionLogin, 'subscriptionLogin'],
  ['codex-image-gen', runCodexImageGen, 'codexImageGen'],
  ['tui-mcp', runTuiMcp, 'tuiMcp'],
  ['subagents', runSubagents, 'subagents'],
  ['dsh-x', runDshX, 'dshX'],
  ['code-navigation', runCodeNavigation, 'codeNavigation'],
  ['code-navigation-web', runCodeNavigationWeb, 'codeNavigationWeb'],
  ['mcp-at-scale', runMcpAtScale, 'mcpAtScale'],
  ['mcp-at-scale-web', runMcpAtScaleWeb, 'mcpAtScaleWeb'],
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


// A targeted retry updates only that scenario. Replacing the whole evidence
// document here used to erase every unrelated result and made a one-case
// diagnostic look like the project had only ever tested one example.
let outputResults = results
if (only !== undefined) {
  try {
    const existing = JSON.parse(await readFile(outputPath, 'utf8'))
    if (existing?.results && typeof existing.results === 'object') {
      outputResults = { ...existing.results, ...results }
    }
  } catch {
    // A new or invalid output path simply starts a fresh targeted report.
  }
}

await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  pi2dshCommit: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim(),
  // Evidence must answer "which build was this" — with a direct stock CLI the
  // checkout commit is NOT what ran; read the installed CLI package instead.
  dshCommit: directDshBin !== undefined
    ? `npm:@deepseek-ai/dsh@${JSON.parse(await readFile(resolve(dshCwd, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version}`
    : (await execFile('git', ['rev-parse', 'HEAD'], { cwd: dshRoot })).stdout.trim(),
  results: outputResults,
}, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`[examples-e2e] ${failures.length} example(s) regressed:\n${failures.map(item => `  - ${item}`).join('\n')}`)
  process.exit(1)
}
console.log(`[examples-e2e] evidence → ${outputPath}`)
