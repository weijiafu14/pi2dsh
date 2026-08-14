#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { symlink } from 'node:fs/promises'
import { generateBundle, generateHostBundle, resolvePiPackage } from '../dist/index.mjs'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const bundleArgument = process.argv[2]
const generateBundles = bundleArgument === undefined || bundleArgument === '--generate'
const outputPath = process.argv[3] === undefined ? undefined : resolve(process.argv[3])

const candidates = [
  { directory: 'pi-lsp', package: '@narumitw/pi-lsp', specifier: '@narumitw/pi-lsp@0.49.4', expectedTools: ['lsp_diagnostics', 'lsp_fix'] },
  { directory: 'pi-ask-user', package: 'pi-ask-user', specifier: 'pi-ask-user@0.14.0', expectedTools: ['ask_user'] },
  { directory: 'rpiv-web-tools', package: '@juicesharp/rpiv-web-tools', specifier: '@juicesharp/rpiv-web-tools@2.4.0', expectedTools: ['web_search', 'web_fetch'] },
  { directory: 'pi-image-gen', package: '@amaster.ai/pi-image-gen', specifier: '@amaster.ai/pi-image-gen@0.1.8', expectedTools: ['image_generate'] },
]

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-community-runtime-'))
const bundleRoot = generateBundles ? join(scratch, 'bundles') : resolve(bundleArgument)
const configDir = join(scratch, 'pi-agent')
const workspace = join(scratch, 'workspace')
await mkdir(configDir, { recursive: true })
await mkdir(workspace, { recursive: true })

if (generateBundles) {
  for (const candidate of candidates) {
    const pkg = await resolvePiPackage(candidate.specifier)
    const outDir = join(bundleRoot, candidate.directory)
    try {
      await generateBundle(pkg, {
        outDir,
      })
    } finally {
      await pkg.dispose()
    }
    await execFile('corepack', ['pnpm@11.7.0', 'install', '--ignore-scripts'], {
      cwd: outDir,
      env: {
        ...process.env,
        CI: '1',
        npm_config_registry: 'https://registry.npmjs.org',
        PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
      },
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  }
}

const previousEnvironment = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER,
  SEARXNG_URL: process.env.SEARXNG_URL,
}

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX8AAAAASUVORK5CYII='
const httpServer = createServer((request, response) => {
  if (request.url?.startsWith('/search')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      results: [{ title: 'pi2dsh fixture result', url: 'https://example.test/result', content: 'PI2DSH_SEARCH_OK' }],
    }))
    return
  }
  if (request.url === '/page') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<html><head><title>Fixture page</title></head><body><h1>PI2DSH_FETCH_OK</h1></body></html>')
    return
  }
  if (request.url === '/v1/images/generations' && request.method === 'POST') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: tinyPng, revised_prompt: 'PI2DSH_IMAGE_OK' }] }))
    return
  }
  response.writeHead(404)
  response.end('not found')
})

await new Promise((resolveListen, reject) => {
  httpServer.once('error', reject)
  httpServer.listen(0, '127.0.0.1', resolveListen)
})
const address = httpServer.address()
assert(address !== null && typeof address === 'object')
const baseUrl = `http://127.0.0.1:${address.port}`

const fakeLspPath = join(scratch, 'fake-lsp.mjs')
await writeFile(fakeLspPath, `
let buffer = Buffer.alloc(0)
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body)
}
function handle(message) {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { diagnosticProvider: {}, codeActionProvider: { resolveProvider: false } } } })
  } else if (message.method === 'textDocument/diagnostic') {
    send({ jsonrpc: '2.0', id: message.id, result: { items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, source: 'fixture', message: 'PI2DSH_LSP_OK' }] } })
  } else if (message.method === 'textDocument/codeAction') {
    send({ jsonrpc: '2.0', id: message.id, result: [] })
  } else if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: null })
  } else if (message.method === 'exit') {
    process.exit(0)
  }
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const separator = buffer.indexOf('\\r\\n\\r\\n')
    if (separator < 0) break
    const header = buffer.subarray(0, separator).toString()
    const length = Number(/Content-Length:\\s*(\\d+)/i.exec(header)?.[1] ?? 0)
    const start = separator + 4
    if (buffer.length < start + length) break
    const message = JSON.parse(buffer.subarray(start, start + length).toString())
    buffer = buffer.subarray(start + length)
    handle(message)
  }
})
`)
await writeFile(join(configDir, 'pi-lsp.json'), `${JSON.stringify({
  timeout: 5000,
  servers: {
    fixture: { command: [process.execPath, fakeLspPath], extensions: ['.fixture'] },
  },
}, null, 2)}\n`)
await writeFile(join(configDir, 'settings.json'), `${JSON.stringify({
  'pi-image-gen': {
    defaultModel: 'fixture-model',
    outputDir: 'generated-images',
    customProviders: {
      fixture: {
        api: 'openai',
        baseUrl,
        apiKey: 'local-test-key',
        models: [{ id: 'fixture-model' }],
      },
    },
  },
}, null, 2)}\n`)
await writeFile(join(workspace, 'sample.fixture'), 'fixture source\n')
process.env.PI_CODING_AGENT_DIR = configDir
process.env.WEB_SEARCH_PROVIDER = 'searxng'
process.env.SEARXNG_URL = baseUrl

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

async function loadHarness(candidate) {
  const bundle = join(bundleRoot, candidate.directory)
  await stat(join(bundle, 'index.js'))
  const packageJson = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(bundle, 'pi2dsh.manifest.json'), 'utf8'))
  assert.equal(manifest.package.name, candidate.package)
  const generated = await import(`${pathToFileURL(join(bundle, 'index.js')).href}?verify=${Date.now()}-${candidate.directory}`)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(generated)
  const session = ctx.sessions.create(SessionId(`pi2dsh-${candidate.directory}`), {
    meta: { createdAt: Date.now(), cwd: workspace },
  })
  const agent = {
    id: session.id,
    session,
    steer() {},
    whenIdle: () => Promise.resolve(),
  }
  ctx.emit('agent/session-start', { agent, source: 'fresh' })
  await delay(250)
  const assembly = await ctx.systemPrompt.assemble()
  const tools = assembly.tools.map(tool => tool.name)
  for (const tool of candidate.expectedTools) assert(tools.includes(tool), `${candidate.package} did not register ${tool}`)
  return { ctx, fiber, agent, packageJson, manifest, tools }
}

const signal = new AbortController().signal
const runtimeResults = []

async function execute(harness, name, args) {
  return harness.ctx.tools.execute({
    signal,
    agent: harness.agent,
    callId: CallId(`community-${name}-${Date.now()}`),
    name,
    arguments: args,
  })
}

try {
  for (const candidate of candidates) {
    const harness = await loadHarness(candidate)
    const checks = []
    if (candidate.directory === 'pi-lsp') {
      const result = await execute(harness, 'lsp_diagnostics', {
        root: workspace,
        paths: ['sample.fixture'],
        server: 'fixture',
      })
      assert.equal(result.isError, false)
      assert.match(result.content[0].text, /PI2DSH_LSP_OK/u)
      const fix = await execute(harness, 'lsp_fix', {
        root: workspace,
        path: 'sample.fixture',
        server: 'fixture',
      })
      assert.equal(fix.isError, false, JSON.stringify(fix))
      assert.match(fix.content[0].text, /left unchanged sample\.fixture/u)
      checks.push('spawned a fixture LSP server and executed diagnostics plus fix through DSH')
    } else if (candidate.directory === 'pi-ask-user') {
      const result = await execute(harness, 'ask_user', { question: 'Choose?', options: ['A', 'B'] })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /Ask requires interactive mode/u)
      const skills = await harness.ctx.skills.list({ cwd: workspace, signal })
      assert(skills.some(skill => skill.name === 'ask-user'))
      checks.push('registered ask_user and returned its explicit headless fallback; copied ask-user skill')
    } else if (candidate.directory === 'rpiv-web-tools') {
      const search = await execute(harness, 'web_search', { query: 'bridge fixture', max_results: 3 })
      assert.equal(search.isError, false, JSON.stringify(search))
      assert.match(search.content[0].text, /PI2DSH_SEARCH_OK/u)
      const fetch = await execute(harness, 'web_fetch', { url: 'https://example.com/' })
      assert.equal(fetch.isError, false, JSON.stringify(fetch))
      assert.match(fetch.content[0].text, /Example Domain/u)
      checks.push('executed web_search through fixture SearXNG and web_fetch against example.com')
    } else if (candidate.directory === 'pi-image-gen') {
      const result = await execute(harness, 'image_generate', { prompt: 'one pixel', filename: 'fixture' })
      assert.equal(result.isError, false)
      assert.match(result.content[0].text, /fixture\.png/u)
      const imagePath = result.meta?.images?.[0]?.path
      assert.equal(typeof imagePath, 'string', JSON.stringify(result))
      assert(resolve(imagePath).startsWith(`${resolve(workspace)}/`), `image escaped workspace: ${imagePath}`)
      const bytes = await readFile(imagePath)
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      const skills = await harness.ctx.skills.list({ cwd: workspace, signal })
      assert(skills.some(skill => skill.name === 'image-gen'))
      checks.push('called a local OpenAI-compatible image endpoint, materialized PNG output, and copied image-gen skill')
    }
    runtimeResults.push({
      package: `${harness.manifest.package.name}@${harness.manifest.package.version}`,
      generatedPackage: harness.packageJson.name,
      registeredTools: harness.tools.filter(name => candidate.expectedTools.includes(name)),
      checks,
      status: 'passed',
    })
    harness.ctx.emit('agent/disposed', { agent: harness.agent })
    await delay(50)
    await harness.fiber.dispose()
  }

  const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
    ? resolve(projectRoot, '..', 'deepseek-harness')
    : resolve(process.env.PI2DSH_DSH_ROOT)
  await stat(join(dshRoot, 'apps/cli/src/bin.ts'))
  const managerHome = join(scratch, 'dsh-home')
  const shimDir = join(scratch, 'bin')
  await mkdir(shimDir, { recursive: true })
  const shim = join(shimDir, 'pnpm')
  await writeFile(shim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(shim, 0o755)
  const managerEnv = {
    ...process.env,
    DSH_HOME: managerHome,
    PATH: `${shimDir}:${process.env.PATH ?? ''}`,
    CI: '1',
    NO_COLOR: '1',
    npm_config_registry: 'https://registry.npmjs.org',
    PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
  }
  async function runDsh(args) {
    return execFile('node', ['--import', 'tsx/esm', join(dshRoot, 'apps/cli/src/bin.ts'), ...args], {
      cwd: dshRoot,
      env: managerEnv,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  }
  const managerResults = []
  for (const candidate of candidates) {
    const bundle = join(bundleRoot, candidate.directory)
    const packageJson = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'))
    await runDsh(['plugin', '--profile', 'headless', 'add', `file:${bundle}`])
    const dump = await runDsh(['--profile', 'headless', '--dump-config'])
    assert.match(dump.stdout, new RegExp(`# == ${packageJson.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`))
    managerResults.push({ package: packageJson.name, install: 'passed', activation: 'passed' })
  }
  for (const item of [...managerResults].reverse()) {
    await runDsh(['plugin', '--profile', 'headless', 'remove', item.package])
    item.remove = 'passed'
  }
  const profile = JSON.parse(await readFile(join(managerHome, 'profiles/headless/package.json'), 'utf8'))
  for (const item of managerResults) {
    assert.equal(profile.dependencies?.[item.package], undefined)
    assert.equal(profile.dsh?.profile?.bundles?.includes(item.package) ?? false, false)
  }

  // --- Host-bundle end-to-end: ONE bundle mounting several unmodified Pi
  // packages as npm dependencies, through the official plugin manager and a
  // real runtime composition.
  const hostDir = join(scratch, 'host-bundle')
  const hostPackages = ['@juicesharp/rpiv-web-tools@2.4.0', 'pi-simplify@0.2.3']
  await generateHostBundle({ outDir: hostDir, packages: hostPackages, bundleName: 'dsh-pi-host-e2e' })
  await execFile('corepack', ['pnpm@11.7.0', 'install', '--ignore-scripts', '--prod'], {
    cwd: hostDir,
    env: managerEnv,
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  await runDsh(['plugin', '--profile', 'headless', 'add', `file:${hostDir}`])
  const hostDump = await runDsh(['--profile', 'headless', '--dump-config'])
  assert.match(hostDump.stdout, /dsh-pi-host-e2e/u)
  await runDsh(['plugin', '--profile', 'headless', 'remove', 'dsh-pi-host-e2e'])
  // Mount in-process: peers resolve through symlinks like a real profile's
  // hoisted install.
  // pnpm's hoisted install may already provide some @deepseek-ai packages
  // (skill-filesystem's tree); fill remaining peers PER PACKAGE — a
  // directory-level link would silently shadow nothing when the directory
  // already exists, leaving dsh-llm and friends unresolvable.
  const peerScopeSource = join(projectRoot, 'node_modules/@deepseek-ai')
  const peerScopeTarget = join(hostDir, 'node_modules/@deepseek-ai')
  await mkdir(peerScopeTarget, { recursive: true })
  for (const peer of await readdir(peerScopeSource)) {
    await symlink(join(peerScopeSource, peer), join(peerScopeTarget, peer), 'dir')
      .catch(error => { if (error.code !== 'EEXIST') throw error })
  }
  await symlink(join(projectRoot, 'node_modules/typebox'), join(hostDir, 'node_modules/typebox'), 'dir')
    .catch(error => { if (error.code !== 'EEXIST') throw error })
  const hostModule = await import(`${pathToFileURL(join(hostDir, 'index.js')).href}?host=${Date.now()}`)
  const hostCtx = new Context()
  await hostCtx.plugin(SessionStore)
  await hostCtx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await hostCtx.plugin(ToolRuntime)
  await hostCtx.plugin(CommandRuntime)
  await hostCtx.plugin(SkillRegistry)
  const hostFiber = await hostCtx.plugin(hostModule)
  const hostAssembly = await hostCtx.systemPrompt.assemble()
  const hostTools = hostAssembly.tools.map(tool => tool.name)
  assert(hostTools.includes('web_search'), `host bundle missing web_search; got ${hostTools.join(', ')}`)
  assert(hostTools.includes('web_fetch'), `host bundle missing web_fetch; got ${hostTools.join(', ')}`)
  await hostFiber.dispose()
  const hostResult = {
    bundle: 'dsh-pi-host-e2e',
    packages: hostPackages,
    install: 'passed',
    activation: 'passed',
    remove: 'passed',
    mountedTools: hostTools.filter(name => ['web_search', 'web_fetch'].includes(name)),
    status: 'passed',
  }

  const dshCommit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: dshRoot })).stdout.trim()
  const value = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dshCommit,
    runtimePackaging: 'embedded',
    runtime: runtimeResults,
    officialPluginManager: managerResults,
    hostBundle: hostResult,
    counts: {
      runtimePassed: runtimeResults.length,
      installActivateRemovePassed: managerResults.length,
      hostBundlePassed: 1,
    },
  }
  if (outputPath !== undefined) await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`)
  console.log(JSON.stringify(value, null, 2))
} finally {
  await new Promise(resolveClose => httpServer.close(resolveClose))
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (process.env.PI2DSH_KEEP_TEST_ARTIFACTS !== '1') await rm(scratch, { recursive: true, force: true })
}
