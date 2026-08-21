#!/usr/bin/env node
// pi-mcp-adapter through the real pi2dsh Host ABI and real DSH runtimes.
//
// This is intentionally broader than an MCP echo smoke test. It exercises
// every plugin surface whose behavior can change when Pi is hosted by DSH:
// lifecycle, custom TUI, commands/prompts, dynamic/direct tool registration,
// stdio + Streamable HTTP + legacy SSE, proxy discovery/calls, mcpScript,
// resources, images/attachments, structured output, MCP Apps/browser opening,
// approval, elicitation, sampling through DSH llm, cancellation, reconnect,
// and session restart.
// Protocol-internal branches that do not touch the Host ABI (OAuth storage,
// Unix sockets, legacy negotiation, cache recovery, output guards, MCP Apps)
// remain covered by pi-mcp-adapter's own version-matched upstream suites.
//
//   PI2DSH_MCP_ADAPTER_ROOT=/path/to/node_modules/pi-mcp-adapter \
//     node scripts/verify-tui-mcp-tool-e2e.mjs

import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const EVERYTHING_PACKAGE = '@modelcontextprotocol/server-everything@2026.8.18'
const UI_APP_SERVER = fileURLToPath(new URL('./mcp-e2e/ui-app-server.mjs', import.meta.url))
const configuredAdapterRoot = process.env.PI2DSH_MCP_ADAPTER_ROOT
if (!configuredAdapterRoot) {
  throw new Error('PI2DSH_MCP_ADAPTER_ROOT must point to an installed pi-mcp-adapter package')
}
const adapterRoot = isAbsolute(configuredAdapterRoot)
  ? configuredAdapterRoot
  : resolve(process.cwd(), configuredAdapterRoot)
const engineRoot = resolve(process.env.PI2DSH_ENGINE_ROOT ?? new URL('..', import.meta.url).pathname)
const [{ manifestForInstalled, resolvePiPackage }, { applyPiPackage }] = await Promise.all([
  import(pathToFileURL(join(engineRoot, 'dist/index.mjs')).href),
  import(pathToFileURL(join(engineRoot, 'dist/runtime.mjs')).href),
])

function invariant(value, message) {
  if (!value) throw new Error(message)
}

function textOf(result) {
  return (result?.content ?? []).map(block => block.type === 'text' ? block.text : '').join('\n')
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  await new Promise(resolveClose => server.close(resolveClose))
  invariant(address && typeof address === 'object', 'failed to allocate a local MCP test port')
  return address.port
}

async function startEverythingTransport(mode, port) {
  const child = spawn('npx', ['-y', EVERYTHING_PACKAGE, mode], {
    detached: process.platform !== 'win32',
    env: { ...process.env, PORT: String(port), NO_PROXY: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = chunk => { output += chunk.toString() }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${mode} MCP server did not start:\n${output}`)), 60_000)
    timeout.unref?.()
    const inspect = () => {
      if (/listening on port|server is running on port/iu.test(output)) {
        clearTimeout(timeout)
        resolveReady()
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      if (!/listening on port|server is running on port/iu.test(output)) {
        clearTimeout(timeout)
        reject(new Error(`${mode} MCP server exited ${code}:\n${output}`))
      }
    })
  })
  return {
    output: () => output,
    stop() {
      if (child.exitCode !== null || child.pid === undefined) return
      try {
        if (process.platform === 'win32') child.kill('SIGTERM')
        else process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    },
  }
}

class SamplingFixtureAdapter extends LlmAdapter {
  requests = []

  providerInfo(provider) {
    return { id: provider, name: 'MCP Sampling Fixture' }
  }

  async listModels(provider) {
    return [{ provider, id: 'sample-model', name: 'MCP Sample Model', inputModalities: ['text'] }]
  }

  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: 'MCP Sample Model',
      context: { contextWindow: 16_384 },
      defaultMaxTokens: 1024,
    }
  }

  async *stream(options) {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'MCP_SAMPLE_OK' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'MCP_SAMPLE_OK' } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-tui-mcp-full-'))
const agentDir = join(scratch, 'pi-agent')
const dshHome = join(scratch, 'dsh-home')
const browserCapture = join(scratch, 'browser-url.txt')
const browserFixture = join(scratch, 'browser-capture.mjs')
const stdioMarker = `PI2DSH_MCP_STDIO_${Date.now()}`
const httpMarker = `PI2DSH_MCP_HTTP_${Date.now()}`
const sseMarker = `PI2DSH_MCP_SSE_${Date.now()}`
process.env.PI_CODING_AGENT_DIR = agentDir
process.env.BROWSER = browserFixture
process.env.PI2DSH_BROWSER_CAPTURE = browserCapture

let streamable
let legacySse
let packageFiber
let scopeFiber
let scene
let opened
let inputHandler
let panelSceneId
let renderCleanup
const approvalQuestions = []
const elicitationQuestions = []
const followups = []
const samplingAdapter = new SamplingFixtureAdapter()
const ctx = new Context()

ctx.provide('tuiScenes', {
  register(descriptor) {
    scene = descriptor
    return () => { scene = undefined }
  },
  open(id) {
    opened = id
    return true
  },
  close() { opened = undefined },
})
ctx.provide('tuiStatus', { set() { return () => {} } })
ctx.provide('userQuestions', {
  async ask(request) {
    const question = request.questions[0]
    const labels = (question.options ?? []).map(option => String(option.label))
    const title = String(question.question ?? '')
    const answer = { id: question.id }
    if (labels.includes('Allow for session')) {
      approvalQuestions.push({ title, labels })
      answer.selected = ['Allow for session']
    } else {
      elicitationQuestions.push({ title, labels })
      if (labels.includes('Continue')) answer.selected = ['Continue']
      else if (labels.includes('Submit')) answer.selected = ['Submit']
      else if (labels.includes('Use default')) answer.selected = ['Use default']
      else if (labels.includes('Omit')) answer.selected = ['Omit']
      else if (labels.includes('Enter value')) answer.selected = ['Enter value']
      else if (labels.length > 0) answer.selected = [labels[0]]
      else answer.custom = 'Ada Lovelace'
    }
    return { answers: [answer] }
  },
})
ctx.provide('settings', {
  get(namespace) {
    return namespace === 'mcp-sampling-fixture' ? { apiKeyEnv: 'MCP_SAMPLING_FIXTURE_KEY' } : undefined
  },
})
ctx.provide('credentials', {
  async resolve(reference) {
    return reference === 'MCP_SAMPLING_FIXTURE_KEY' ? { value: 'fixture-secret' } : undefined
  },
})

try {
  const [httpPort, ssePort] = await Promise.all([freePort(), freePort()])
  ;[streamable, legacySse] = await Promise.all([
    startEverythingTransport('streamableHttp', httpPort),
    startEverythingTransport('sse', ssePort),
  ])

  await mkdir(agentDir, { recursive: true })
  await writeFile(browserFixture, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.PI2DSH_BROWSER_CAPTURE, process.argv[2] ?? '')\n`)
  await chmod(browserFixture, 0o755)
  await writeFile(join(agentDir, 'mcp.json'), `${JSON.stringify({
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', EVERYTHING_PACKAGE],
        directTools: [
          'echo',
          'get-sum',
          'get-tiny-image',
          'get-structured-content',
          'trigger-elicitation-request',
          'trigger-sampling-request',
          'read_architecture_md',
        ],
        approveTools: ['get-sum'],
      },
      streamable: {
        url: `http://127.0.0.1:${httpPort}/mcp`,
        auth: false,
        httpTransport: 'streamable-http',
      },
      legacySse: {
        url: `http://127.0.0.1:${ssePort}/sse`,
        auth: false,
        httpTransport: 'sse',
      },
      uiapp: {
        command: process.execPath,
        args: [UI_APP_SERVER],
      },
    },
    settings: {
      approveTools: false,
      sampling: true,
      samplingAutoApprove: true,
      elicitation: true,
    },
  }, null, 2)}\n`)

  const pkg = await resolvePiPackage(adapterRoot)
  let manifest
  try {
    manifest = await manifestForInstalled(pkg)
  } finally {
    await pkg.dispose()
  }

  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalAttachmentStore, { dshHome })
  ctx.llm.registerAdapter(['mcp-sampling-fixture'], samplingAdapter)
  ctx.llm.registerConfigurableProviders([{
    provider: 'mcp-sampling-fixture',
    displayName: 'MCP Sampling Fixture',
    settingsNs: 'mcp-sampling-fixture',
    settingsPath: [],
  }])

  const session = ctx.sessions.create(SessionId('pi2dsh-tui-mcp-full-e2e'), {
    meta: { createdAt: Date.now(), cwd: scratch },
  })
  let agent = {
    id: session.id,
    session,
    options: { provider: 'mcp-sampling-fixture', model: 'sample-model' },
    inbox: {},
    status: 'idle',
    inject(message) { followups.push({ delivery: 'inject', message }) },
    steer(message) { followups.push({ delivery: 'steer', message }) },
    followup(message) { followups.push({ delivery: 'followup', message }) },
    whenIdle: () => Promise.resolve(),
  }
  scopeFiber = await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, {
    inject: ['tools', 'systemPrompt'],
  }))

  packageFiber = await ctx.plugin({
    name: 'pi2dsh:tui-mcp-full-e2e',
    inject: ['tools', 'systemPrompt', 'commands', 'skills', 'tuiScenes', 'llm', 'attachments'],
    async apply(inner) {
      await applyPiPackage(inner, { rootUrl: pathToFileURL(`${adapterRoot}/`), manifest })
    },
  })
  ctx.emit('agent/session-start', { agent, source: 'fresh' })

  let callSequence = 0
  const executeTool = async (name, arguments_, signal = new AbortController().signal) => {
    const result = await ctx.tools.execute({
      signal,
      agent,
      callId: CallId(`tui-mcp-full-${++callSequence}`),
      name,
      arguments: arguments_,
    })
    return result
  }
  const executeOk = async (name, arguments_, signal) => {
    const result = await executeTool(name, arguments_, signal)
    invariant(result.isError !== true, `${name} failed: ${JSON.stringify(result.content)}`)
    return result
  }
  const executeMcp = arguments_ => executeOk('mcp', arguments_)

  // The Pi manager is a real custom component hosted by the public dsh-TUI
  // scene service. dsh-TUI's own /mcp remains separate; Pi owns /pi-mcp.
  const panelExecution = ctx.commands.execute(agent, '/pi-mcp', [], new AbortController().signal)
  for (let index = 0; index < 400 && opened === undefined; index += 1) await delay(25)
  invariant(opened !== undefined && scene !== undefined, 'real /pi-mcp manager did not open a dsh-TUI scene')
  panelSceneId = opened

  const React = {
    createElement: (type, props = null, ...children) => ({ type, props, children }),
    useEffect(effect) { renderCleanup = effect() ?? undefined },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
  }
  const ui = {
    Box: 'Box', Text: 'Text', Ansi: 'Ansi',
    useInput(handler) { inputHandler = handler },
    useTerminalSize: () => ({ columns: 120, rows: 40 }),
  }
  let panelText = ''
  for (let index = 0; index < 400; index += 1) {
    const tree = scene.component({ React, ui, close() {} })
    panelText = tree.children.map(child => child.children?.[0] ?? '').join('\n')
    if (panelText.includes('MCP Servers') && panelText.includes('everything') && panelText.includes('streamable')) break
    await delay(25)
  }
  invariant(
    panelText.includes('MCP Servers') && panelText.includes('everything') && panelText.includes('streamable'),
    `real /pi-mcp scene did not render configured servers:\n${panelText}`,
  )
  inputHandler?.('', { escape: true }, { keypress: { sequence: '\x1b' } })
  await panelExecution
  renderCleanup?.()

  // stdio plus the complete proxy discovery/call surface.
  const connected = await executeMcp({ connect: 'everything' })
  invariant(textOf(connected).includes('everything_echo'), `stdio connect did not return refreshed metadata: ${textOf(connected)}`)
  const search = await executeMcp({ search: 'tiny image', server: 'everything' })
  invariant(textOf(search).includes('get-tiny-image'), `MCP search missed get-tiny-image: ${textOf(search)}`)
  const described = await executeMcp({ describe: 'everything_echo' })
  invariant(textOf(described).includes('message'), `MCP describe missed echo schema: ${textOf(described)}`)
  const instructions = await executeMcp({ instructions: 'everything' })
  invariant(textOf(instructions).length > 20, `MCP server instructions were empty: ${textOf(instructions)}`)
  const echoed = await executeMcp({ tool: 'everything_echo', args: { message: stdioMarker } })
  invariant(textOf(echoed).includes(stdioMarker), `stdio echo did not round-trip ${stdioMarker}: ${textOf(echoed)}`)

  // Direct tools and resources appear only after the first metadata refresh;
  // this proves live registration crosses Pi's registry into DSH ToolRuntime.
  const expectedDirectTools = [
    'everything_echo',
    'everything_get-sum',
    'everything_get-tiny-image',
    'everything_get-structured-content',
    'everything_trigger-elicitation-request',
    'everything_trigger-sampling-request',
    'everything_read_architecture_md',
  ]
  let directToolNames = []
  for (let index = 0; index < 400; index += 1) {
    directToolNames = ctx.tools.schemas(agent).map(tool => tool.name)
    if (expectedDirectTools.every(name => directToolNames.includes(name))) break
    await delay(25)
  }
  invariant(
    expectedDirectTools.every(name => directToolNames.includes(name)),
    `direct MCP tools did not hot-register in DSH: ${JSON.stringify(directToolNames)}`,
  )
  const directEcho = await executeOk('everything_echo', { message: `${stdioMarker}_DIRECT` })
  invariant(textOf(directEcho).includes(`${stdioMarker}_DIRECT`), 'direct echo failed through DSH ToolRuntime')

  // Approval is handled by DSH's user-question seam, then cached for session.
  const approvedSum = await executeMcp({ tool: 'everything_get-sum', args: { a: 19, b: 23 } })
  invariant(textOf(approvedSum).includes('42'), `approved MCP tool returned wrong sum: ${textOf(approvedSum)}`)
  invariant(approvalQuestions.length === 1, `expected one MCP approval question, got ${approvalQuestions.length}`)
  const cachedApprovalSum = await executeOk('everything_get-sum', { a: 19, b: 23 })
  invariant(textOf(cachedApprovalSum).includes('42'), 'session-approved direct MCP tool failed')
  invariant(approvalQuestions.length === 1, 'session approval was not reused by the direct-tool path')

  // Structured output and image bytes survive both plugin transforms and DSH
  // normalization. The image lands in the real local attachment store.
  const structured = await executeOk('everything_get-structured-content', { location: 'Chicago' })
  invariant(textOf(structured).includes('Light rain / drizzle'), `structured MCP result was lost: ${textOf(structured)}`)
  const image = await executeOk('everything_get-tiny-image', {})
  const imageBlock = image.content.find(block => block.type === 'image')
  invariant(imageBlock?.attachment !== undefined, `MCP image did not become a DSH attachment: ${JSON.stringify(image.content)}`)
  const storedImage = await ctx.attachments.readImage(imageBlock.attachment)
  invariant(storedImage.data.byteLength > 100 && storedImage.ref.mediaType === 'image/png', 'stored MCP image bytes are invalid')

  const resource = await executeOk('everything_read_architecture_md', {})
  invariant(textOf(resource).toLowerCase().includes('architecture'), `MCP resource tool did not return the document: ${textOf(resource)}`)

  // MCP Apps is a user-visible host path, not merely a package-internal unit
  // branch. A real MCP server advertises a UI resource, the adapter fetches it,
  // starts its authenticated local AppBridge host, then opens the URL through
  // Pi exec -> DSH subprocess. The capture executable replaces only the OS
  // browser application; fetching the emitted URL proves the real HTML host.
  await executeMcp({ connect: 'uiapp' })
  const appResult = await executeMcp({ tool: 'uiapp_open_dashboard', args: { title: 'DSH MCP App E2E' } })
  invariant(textOf(appResult).includes('Opened dashboard: DSH MCP App E2E'), `MCP App tool failed: ${textOf(appResult)}`)
  let appUrl = ''
  for (let index = 0; index < 200; index += 1) {
    appUrl = await readFile(browserCapture, 'utf8').catch(() => '')
    if (appUrl.startsWith('http://')) break
    await delay(25)
  }
  invariant(appUrl.startsWith('http://'), `MCP App did not open through the DSH subprocess bridge: ${appUrl}`)
  const appHostHtml = await fetch(appUrl).then(response => {
    invariant(response.ok, `MCP App host returned HTTP ${response.status}`)
    return response.text()
  })
  invariant(appHostHtml.includes('id="mcp-app"') && appHostHtml.includes('PostMessageTransport'), 'MCP App host did not serve its AppBridge shell')
  const resourceToken = /const UI_RESOURCE_TOKEN = ("(?:[^"\\]|\\.)*");/u.exec(appHostHtml)?.[1]
  invariant(resourceToken !== undefined, 'MCP App host did not publish its scoped UI resource token')
  const appResourceUrl = new URL('/ui-app', appUrl)
  appResourceUrl.searchParams.set('resource', JSON.parse(resourceToken))
  const appHtml = await fetch(appResourceUrl).then(response => {
    invariant(response.ok, `MCP App resource returned HTTP ${response.status}`)
    return response.text()
  })
  invariant(appHtml.includes('PI2DSH_MCP_APP_HTML_OK'), 'MCP App host did not serve the MCP UI resource HTML')

  // Prompt metadata becomes a DSH slash command and sends the actual prompt
  // into the same agent, not a notification-only approximation.
  const promptName = 'mcp__everything__simple-prompt'
  invariant(ctx.commands.list(agent).some(command => command.name === promptName), `MCP prompt command /${promptName} was not registered`)
  const followupCount = followups.length
  const promptExecution = await ctx.commands.execute(agent, `/${promptName}`, [], new AbortController().signal)
  invariant(promptExecution?.result?.kind !== 'error', `MCP prompt command failed: ${JSON.stringify(promptExecution)}`)
  invariant(followups.length > followupCount && JSON.stringify(followups.at(-1)).includes('simple prompt without arguments'), 'MCP prompt did not enter the DSH agent')

  // mcpScript is the plugin's real sandboxed orchestration tool; both calls
  // still traverse approval/output/transport policy inside the adapter.
  const scripted = await executeOk('mcpScript', {
    code: `const echoed = await tools.call("everything_echo", { message: ${JSON.stringify(`${stdioMarker}_SCRIPT`)} });\nconst summed = await tools.call("everything_get-sum", { a: 20, b: 22 });\nemit({ echoed, summed });\nreturn { done: true };`,
  })
  invariant(textOf(scripted).includes(`${stdioMarker}_SCRIPT`) && textOf(scripted).includes('42'), `mcpScript lost call results: ${textOf(scripted)}`)

  // The official server sends a real form-mode elicitation request back over
  // the MCP connection. The answers are collected through DSH UI primitives.
  const elicited = await executeOk('everything_trigger-elicitation-request', {})
  invariant(textOf(elicited).includes('Ada Lovelace') && textOf(elicited).includes('"action": "accept"'), `MCP elicitation failed: ${textOf(elicited)}`)
  invariant(elicitationQuestions.length >= 3, 'MCP elicitation did not traverse the DSH question surface')

  // Sampling makes the opposite-direction MCP request, resolves the current
  // model and credential through pi2dsh, and calls the real DSH llm runtime.
  const sampled = await executeOk('everything_trigger-sampling-request', {
    prompt: 'Return the MCP fixture marker',
    maxTokens: 32,
  })
  invariant(textOf(sampled).includes('MCP_SAMPLE_OK'), `MCP sampling response was lost: ${textOf(sampled)}`)
  invariant(samplingAdapter.requests.length === 1, `MCP sampling did not make exactly one DSH model call: ${samplingAdapter.requests.length}`)
  invariant(JSON.stringify(samplingAdapter.requests[0]).includes('Return the MCP fixture marker'), 'MCP sampling prompt did not reach the DSH adapter')

  // Cancellation must leave the DSH call quickly rather than waiting for the
  // five-second server operation to finish.
  const abortController = new AbortController()
  const abortStarted = Date.now()
  const abortedCall = executeTool('mcp', {
    tool: 'everything_trigger-long-running-operation',
    args: { duration: 5, steps: 5 },
  }, abortController.signal).then(result => ({ result }), error => ({ error }))
  setTimeout(() => abortController.abort(new Error('MCP_E2E_ABORT')), 100).unref?.()
  const aborted = await abortedCall
  const abortElapsedMs = Date.now() - abortStarted
  invariant(abortElapsedMs < 2_000, `MCP cancellation took ${abortElapsedMs}ms`)
  invariant(aborted.error !== undefined || aborted.result?.isError === true, `MCP cancellation reported success: ${JSON.stringify(aborted)}`)

  // Both HTTP transports are real external server processes; no SDK client or
  // network call is stubbed here.
  await executeMcp({ connect: 'streamable' })
  const httpEcho = await executeMcp({ tool: 'streamable_echo', args: { message: httpMarker } })
  invariant(textOf(httpEcho).includes(httpMarker), `Streamable HTTP echo failed: ${textOf(httpEcho)}\n${streamable.output()}`)
  await executeMcp({ connect: 'legacySse' })
  const sseEcho = await executeMcp({ tool: 'legacySse_echo', args: { message: sseMarker } })
  invariant(textOf(sseEcho).includes(sseMarker), `legacy SSE echo failed: ${textOf(sseEcho)}\n${legacySse.output()}`)

  // Command-driven reconnect and the real Pi session shutdown/start pair both
  // rebuild the adapter, then an immediate DSH tool call waits for readiness.
  const reconnect = await ctx.commands.execute(agent, '/pi-mcp reconnect everything', [], new AbortController().signal)
  invariant(reconnect?.result?.kind !== 'error', `MCP reconnect command failed: ${JSON.stringify(reconnect)}`)
  const afterReconnect = await executeMcp({ tool: 'everything_echo', args: { message: `${stdioMarker}_RECONNECT` } })
  invariant(textOf(afterReconnect).includes(`${stdioMarker}_RECONNECT`), 'MCP call failed after reconnect')

  const retiredAgent = agent
  ctx.emit('agent/disposed', { agent: retiredAgent })
  await delay(250)
  agent = {
    ...retiredAgent,
    inbox: {},
    status: 'idle',
  }
  ctx.emit('agent/session-start', { agent, source: 'resume' })
  const afterRestart = await executeMcp({ tool: 'everything_echo', args: { message: `${stdioMarker}_RESTART` } })
  invariant(textOf(afterRestart).includes(`${stdioMarker}_RESTART`), 'MCP call failed after Pi session restart')

  // Give the resumed runtime its real shutdown event as well. This assertion
  // is indirect but hard: the stdio child would keep Node alive if the new
  // manager did not own and close it.
  ctx.emit('agent/disposed', { agent })
  await delay(250)

  console.log(JSON.stringify({
    verdict: 'pass',
    engine: engineRoot === resolve(new URL('..', import.meta.url).pathname) ? 'working-tree' : 'installed-profile',
    package: `${manifest.package.name}@${manifest.package.version}`,
    tui: { command: '/pi-mcp', scene: panelSceneId, nativeCommandPreserved: '/mcp' },
    transports: {
      stdio: { server: EVERYTHING_PACKAGE, marker: stdioMarker },
      streamableHttp: { marker: httpMarker },
      legacySse: { marker: sseMarker },
    },
    discovery: ['search', 'describe', 'instructions'],
    tools: {
      proxy: true,
      direct: expectedDirectTools,
      script: true,
      approvalQuestions: approvalQuestions.length,
    },
    content: {
      structured: true,
      imageAttachmentBytes: storedImage.data.byteLength,
      resource: 'everything_read_architecture_md',
      prompt: `/${promptName}`,
      mcpApp: { browserOpened: true, htmlMarker: true },
    },
    callbacks: {
      elicitationQuestions: elicitationQuestions.length,
      samplingCalls: samplingAdapter.requests.length,
    },
    lifecycle: { cancellationMs: abortElapsedMs, reconnect: true, sessionRestart: true },
  }, null, 2))
} finally {
  renderCleanup?.()
  await packageFiber?.dispose()
  await scopeFiber?.dispose()
  await ctx.fiber.dispose()
  streamable?.stop()
  legacySse?.stop()
  await rm(scratch, { recursive: true, force: true })
}
