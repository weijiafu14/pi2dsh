#!/usr/bin/env node
// Real end-to-end proof for @crazygit/pi-codex-image-gen on DeepSeek Harness.
//
// The scenario deliberately uses the package as published. It installs the
// package through `dsh plugin add`, lets a real Codex model choose and execute
// its tool, and verifies the resulting DSH-native image attachment in the
// durable session log. Generation runs in the headless profile; reference-image
// editing runs in the web profile so the package's upload approval crosses the
// real ctx.ui.confirm -> DSH userQuestions -> browser round trip.
//
// Authentication is copied into the throwaway DSH_HOME from a Codex login file
// for this run only. Values are never printed or written to the report, and the
// entire temporary home is removed in finally.

import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = resolve(process.env.PI2DSH_DSH_ROOT ?? join(projectRoot, '..', 'deepseek-harness'))
const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
const engineSpec = process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`
const imagePluginSpec = process.env.PI2DSH_CODEX_IMAGE_PLUGIN_SPEC ?? '@crazygit/pi-codex-image-gen@0.2.2'
const codexAuthFile = resolve(process.env.CODEX_AUTH_FILE ?? join(homedir(), '.codex', 'auth.json'))
const artifactDir = process.env.PI2DSH_CODEX_IMAGE_ARTIFACT_DIR === undefined
  ? undefined
  : resolve(process.env.PI2DSH_CODEX_IMAGE_ARTIFACT_DIR)
const reportPath = resolve(process.argv[2] ?? join(projectRoot, '.artifacts', 'codex-image-gen-e2e.json'))
const referenceImage = resolve(
  process.env.PI2DSH_CODEX_IMAGE_REFERENCE
    ?? join(projectRoot, 'examples', 'vision-bridge', 'test-images', 'solid-blue.png'),
)
const model = process.env.PI2DSH_CODEX_MODEL ?? 'gpt-5.6-sol'

function jwtExpiry(token) {
  const encoded = token.split('.')[1]
  assert(encoded, 'Codex access token is not a JWT')
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  assert.equal(typeof payload.exp, 'number', 'Codex access token has no numeric exp claim')
  return payload.exp * 1000
}

async function seedCodexLogin(home) {
  const source = JSON.parse(await readFile(codexAuthFile, 'utf8'))
  const tokens = source.tokens
  assert(tokens && typeof tokens === 'object', 'Codex auth file has no tokens object')
  assert.equal(typeof tokens.access_token, 'string', 'Codex auth file has no access_token')
  assert.equal(typeof tokens.refresh_token, 'string', 'Codex auth file has no refresh_token')
  assert.equal(typeof tokens.account_id, 'string', 'Codex auth file has no account_id')
  const target = join(home, 'pi2dsh', 'agent', 'auth.json')
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, `${JSON.stringify({
    'openai-codex': {
      type: 'oauth',
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: jwtExpiry(tokens.access_token),
      accountId: tokens.account_id,
    },
  })}\n`, { mode: 0o600 })
  await chmod(target, 0o600)
}

async function filesBelow(directory) {
  const output = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return output
    throw error
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(path))
    else if (entry.isFile()) output.push(path)
  }
  return output
}

async function allSessionRecords(root) {
  const files = (await filesBelow(root)).filter(path => path.endsWith('/session.jsonl'))
  const records = []
  for (const path of files) {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean)
    records.push(...lines.map(line => JSON.parse(line)))
  }
  return records
}

function toolResultEvidence(records, expectedEdit) {
  const call = records.find(record => record.type === 'tool/call'
    && record.data?.name === 'codex_generate_image')
  assert(call, 'the real DSH loop never called codex_generate_image')
  const resultEvent = records.find(record => record.type === 'tool/result'
    && (record.data?.message?.content ?? []).some(block => block.type === 'tool-result'
      && block.toolCallId === call.data.callId))
  assert(resultEvent, 'codex_generate_image produced no durable tool/result event')
  const result = resultEvent.data.message.content.find(block => block.type === 'tool-result'
    && block.toolCallId === call.data.callId)
  assert.equal(result.isError, false, `codex_generate_image failed: ${JSON.stringify(result.content).slice(0, 1200)}`)
  const text = result.content.find(block => block.type === 'text')?.text ?? ''
  assert.match(text, expectedEdit ? /^Edited PNG with gpt-image-2/u : /^Generated PNG with gpt-image-2/u)
  const image = result.content.find(block => block.type === 'image')
  assert(image?.attachment?.attachmentId, 'tool result did not become a native DSH image attachment')
  const args = typeof call.data.arguments === 'string'
    ? JSON.parse(call.data.arguments)
    : call.data.arguments ?? {}
  if (expectedEdit) {
    assert.deepEqual(args.referencedImagePaths, [referenceImage],
      'the edit turn did not pass the requested reference image to the tool')
  } else {
    assert.equal(args.referencedImagePaths, undefined,
      'the generation turn unexpectedly used a reference image')
  }
  return { call, result, image }
}

function childRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

async function stopChild(child) {
  if (!childRunning(child)) return 'clean'
  const exit = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exit.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
  ])
  if (!stopped && childRunning(child)) {
    child.kill('SIGKILL')
    await exit
  }
  return 'terminated-after-durable-turn'
}

async function runHeadlessTurn({ env, prompt, sessionsRoot }) {
  const child = spawn('node', ['--import', 'tsx/esm', dshBin, '--profile', 'headless', prompt], {
    cwd: dshRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  const deadline = Date.now() + 480_000
  try {
    while (Date.now() < deadline) {
      const records = await allSessionRecords(sessionsRoot)
      const turnEnd = records.findLast(record => record.type === 'turn/end')
      const done = turnEnd?.data?.reason?.kind === 'completed'
        && records.some(record => record.type === 'tool/call'
          && record.data?.name === 'codex_generate_image')
        && /IMAGE_GENERATION_DONE/u.test(output)
      if (done) {
        // The turn is already durable. Proxy-aware Node fetch can leave a
        // keep-alive socket behind after the one-shot CLI has printed its
        // answer, so process lifetime is not used as completion evidence.
        await new Promise(resolve => setTimeout(resolve, 500))
        const shutdown = await stopChild(child)
        return { output, records, shutdown }
      }
      if (!childRunning(child)) {
        throw new Error(`headless DSH exited before a completed durable turn:\n${output.slice(-2500)}`)
      }
      await new Promise(resolve => setTimeout(resolve, 400))
    }
    throw new Error(`headless DSH timed out before a completed durable turn:\n${output.slice(-2500)}`)
  } finally {
    if (childRunning(child)) await stopChild(child)
  }
}

async function waitForCompletedTurn(sessionsRoot, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const records = await allSessionRecords(sessionsRoot)
    const turnEnd = records.findLast(record => record.type === 'turn/end')
    if (turnEnd?.data?.reason?.kind === 'completed') return records
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error(`no completed turn/end appeared under ${sessionsRoot}`)
}

async function validateStoredPng(home, evidence, label) {
  const id = String(evidence.image.attachment.attachmentId)
  const match = /^sha256:([a-f0-9]{64})$/u.exec(id)
  assert(match, `invalid native attachment id: ${id}`)
  const digest = match[1]
  const object = join(home, 'attachments', 'v1', 'objects', digest.slice(0, 2), digest)
  const bytes = await readFile(object)
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'attachment is not PNG')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'attachment bytes do not match their DSH id')
  assert(bytes.byteLength > 10_000, 'real image response is implausibly small')
  let copied
  if (artifactDir !== undefined) {
    await mkdir(artifactDir, { recursive: true })
    copied = join(artifactDir, `${label}.png`)
    await copyFile(object, copied)
  }
  return {
    sha256: digest,
    bytes: bytes.byteLength,
    width: evidence.image.attachment.width,
    height: evidence.image.attachment.height,
    copied,
  }
}

async function waitForWeb(child, logRef) {
  const deadline = Date.now() + 120_000
  while (!/dsh web:/u.test(logRef.value) && child.exitCode === null && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 400))
  }
  if (child.exitCode !== null || !/dsh web:/u.test(logRef.value)) {
    throw new Error(`DSH web did not start:\n${logRef.value.slice(-2500)}`)
  }
}

async function dismissNotice(page) {
  const notice = page.getByRole('button', { name: 'Continue' })
  const shown = await notice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
  if (!shown) return
  await notice.click()
  await page.waitForFunction(() => document.querySelectorAll('[class*="_mask_"]').length === 0,
    undefined, { timeout: 20_000 })
}

async function connectWorkspace(page) {
  const response = await page.evaluate(async path => {
    const result = await fetch('/api/workspace.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'codex-image-e2e-workspace',
        method: 'workspace.create',
        payload: { path },
      }),
    })
    return { status: result.status, body: await result.text() }
  }, projectRoot)
  assert.equal(response.status, 200, `workspace.create returned ${response.status}: ${response.body.slice(0, 300)}`)
}

async function typeAndSend(page, text) {
  const composer = page.getByRole('textbox').last()
  await composer.click()
  await composer.fill(text)
  assert.equal(await composer.inputValue(), text)
  await page.getByRole('button', { name: 'Send message' }).click()
}

async function main() {
  await stat(dshBin)
  await stat(referenceImage)
  await stat(codexAuthFile)
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-codex-image-'))
  const home = join(scratch, 'dsh-home')
  const shimDir = join(scratch, 'bin')
  let web
  try {
    await mkdir(shimDir, { recursive: true })
    const pnpmShim = join(shimDir, 'pnpm')
    await writeFile(pnpmShim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
    await chmod(pnpmShim, 0o755)
    await seedCodexLogin(home)
    const env = {
      ...process.env,
      DSH_HOME: home,
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
      CI: '1',
      NO_COLOR: '1',
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
      NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1',
      npm_config_registry: 'https://registry.npmjs.org',
      PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
      PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
    }
    const runDsh = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args], {
      cwd: dshRoot,
      env,
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
    })

    for (const profile of ['headless', 'web']) {
      await runDsh(['plugin', '--profile', profile, 'add', engineSpec])
      await runDsh(['plugin', '--profile', profile, 'add', imagePluginSpec])
      await writeFile(join(home, 'profiles', profile, 'cordis.patch.yml'), [
        '- id: session-persistence-jsonl',
        '  config:',
        `    root: !!js dshHomePath('sessions-${profile}')`,
        '    compression: none',
        '',
      ].join('\n'))
    }
    await writeFile(join(home, 'settings.yaml'), [
      'agent-default-model:',
      '  provider: openai-codex',
      `  model: ${model}`,
      'llm-pi-ai:',
      '  providers:',
      '    openai-codex:',
      '      displayName: OpenAI (ChatGPT Plus/Pro)',
      '      apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX',
      '',
    ].join('\n'))

    const generationPrompt = [
      'Use codex_generate_image exactly once.',
      'Generate a minimal square app icon: white uppercase letters DSH centered on a vivid cobalt-blue background, no other text.',
      'Use save="none", size="1024x1024", and quality="low".',
      'Do not use any other tool. After the tool succeeds, reply with exactly IMAGE_GENERATION_DONE.',
    ].join(' ')
    const generated = await runHeadlessTurn({
      env,
      prompt: generationPrompt,
      sessionsRoot: join(home, 'sessions-headless'),
    })
    const generationRecords = generated.records
    const generationEvidence = toolResultEvidence(generationRecords, false)
    const generationImage = await validateStoredPng(home, generationEvidence, 'codex-generated')

    const port = 5450 + Math.floor(Math.random() * 300)
    const logRef = { value: '' }
    web = spawn('node', ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)], {
      cwd: dshRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    web.stdout.on('data', chunk => { logRef.value += String(chunk) })
    web.stderr.on('data', chunk => { logRef.value += String(chunk) })
    await waitForWeb(web, logRef)

    const require = createRequire(join(dshRoot, 'apps', 'web', 'package.json'))
    const { chromium } = require('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, locale: 'en-US' })
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' })
      await dismissNotice(page)
      await connectWorkspace(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await dismissNotice(page)
      await page.getByRole('button', { name: 'New session' }).first().click({ timeout: 60_000 })

      const editPrompt = [
        'Use codex_generate_image exactly once to edit the local reference image at',
        `${referenceImage}.`,
        'Pass referencedImagePaths as an array containing exactly that absolute path.',
        'Turn it into a vivid orange square with one centered white five-point star and no text.',
        'Use save="none", size="1024x1024", and quality="low".',
        'Do not use any other tool. After the tool succeeds, reply with exactly IMAGE_EDIT_DONE.',
      ].join(' ')
      await typeAndSend(page, editPrompt)

      const question = page.locator('[data-question-key]')
      await question.waitFor({ timeout: 180_000 })
      await question.getByText(/Upload 1 local image to Codex\?/u).waitFor({ timeout: 30_000 })
      await question.getByText(referenceImage, { exact: false }).waitFor({ timeout: 30_000 })
      if (artifactDir !== undefined) {
        await mkdir(artifactDir, { recursive: true })
        await page.screenshot({ path: join(artifactDir, 'codex-image-edit-approval.png'), fullPage: true })
      }
      await question.getByRole('radio', { name: 'Yes' }).click()
      await question.getByRole('button', { name: /submit/iu }).click()
      await question.waitFor({ state: 'detached', timeout: 60_000 })
      await page.getByText('IMAGE_EDIT_DONE', { exact: true }).waitFor({ timeout: 420_000 })
      // A successful server attachment is not enough: package mount must have
      // pre-registered this verified image tool's keyed DSH tool-view seat, and
      // the browser must read the image through DSH's authorized attachment RPC
      // and draw the actual pixels. This is the user-visible half of the contract.
      await page.locator('[data-pi2dsh="image-tool-result"][data-tool="codex_generate_image"]')
        .waitFor({ state: 'visible', timeout: 60_000 })
      await page.locator('img[data-pi2dsh="tool-image"]')
        .waitFor({ state: 'visible', timeout: 60_000 })
      // Final text can paint a frame before turn/end commits. Do not kill the
      // Web host in that gap: the durable completion boundary and the restored
      // send button are both part of a finished user workflow.
      await page.getByRole('button', { name: 'Send message' })
        .waitFor({ state: 'visible', timeout: 60_000 })
      await waitForCompletedTurn(join(home, 'sessions-web'))
      if (artifactDir !== undefined) {
        await page.screenshot({ path: join(artifactDir, 'codex-image-edit-result.png'), fullPage: true })
      }
    } finally {
      await browser.close()
    }

    web.kill('SIGTERM')
    await new Promise(done => web.once('exit', done))
    web = undefined
    const editRecords = await allSessionRecords(join(home, 'sessions-web'))
    assert.equal(editRecords.findLast(record => record.type === 'turn/end')?.data?.reason?.kind, 'completed')
    const editEvidence = toolResultEvidence(editRecords, true)
    const editedImage = await validateStoredPng(home, editEvidence, 'codex-edited')
    const referenceBytes = await readFile(referenceImage)
    assert.notEqual(editedImage.sha256, createHash('sha256').update(referenceBytes).digest('hex'),
      'edited image is byte-identical to its reference')

    const installed = JSON.parse(await readFile(
      join(home, 'profiles', 'web', 'node_modules', '@crazygit', 'pi-codex-image-gen', 'package.json'),
      'utf8',
    ))
    const engine = JSON.parse(await readFile(join(home, 'profiles', 'web', 'node_modules', 'pi2dsh', 'package.json'), 'utf8'))
    const report = {
      schemaVersion: 1,
      status: 'passed',
      engine: { name: engine.name, version: engine.version, spec: engineSpec },
      plugin: { name: installed.name, version: installed.version, spec: imagePluginSpec },
      model: { provider: 'openai-codex', id: model, auth: 'oauth' },
      generation: {
        surface: 'headless',
        tool: 'codex_generate_image',
        processShutdown: generated.shutdown,
        image: generationImage,
      },
      edit: {
        surface: 'web',
        tool: 'codex_generate_image',
        approval: 'DSH userQuestions -> Yes',
        referenceCount: 1,
        image: editedImage,
      },
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`[codex-image-e2e] PASS: real OAuth -> CLI generation -> native DSH attachment -> Web approval -> reference edit -> native DSH attachment`)
    console.log(`[codex-image-e2e] evidence -> ${reportPath}`)
  } finally {
    web?.kill('SIGTERM')
    if (process.env.PI2DSH_KEEP_TEST_ARTIFACTS !== '1') await rm(scratch, { recursive: true, force: true })
    else console.log(`[codex-image-e2e] kept temporary DSH home at ${scratch}`)
  }
}

await main()
