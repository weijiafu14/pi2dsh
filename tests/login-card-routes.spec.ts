// The Models-page login card's wire contract, locked at the seam the browser
// really calls: the engine's own /pi2dsh/login-state and /pi2dsh/login-action
// routes, mounted through the real runtime, driving the SAME login spine as
// /login against a real package-registered OAuth provider. The card is only a
// poll/answer surface; everything asserted here is what any client of these
// routes can rely on.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { applyPiPackage } from '../src/runtime.js'
import { manifestForInstalled } from '../src/host.js'
import { resolvePiPackage } from '../src/source.js'

type Json = Record<string, unknown>
interface RouteHandler { (req: Json, res: Json): Promise<void> }

let scratch: string
let handler: RouteHandler

async function get(path: string): Promise<{ status: number, body: Json }> {
  let body = ''
  let status = 0
  await handler(
    { method: 'GET', url: path },
    { writeHead: (code: number) => { status = code }, end: (chunk?: string) => { body = chunk ?? '' } } as unknown as Json,
  )
  return { status, body: body === '' ? {} : JSON.parse(body) as Json }
}

async function post(path: string, payload: Json): Promise<{ status: number, body: Json }> {
  const raw = JSON.stringify(payload)
  let body = ''
  let status = 0
  await handler(
    {
      method: 'POST',
      url: path,
      on(event: string, listen: (chunk?: unknown) => void) {
        if (event === 'data') listen(Buffer.from(raw))
        if (event === 'end') listen()
      },
    },
    { writeHead: (code: number) => { status = code }, end: (chunk?: string) => { body = chunk ?? '' } } as unknown as Json,
  )
  return { status, body: body === '' ? {} : JSON.parse(body) as Json }
}

interface FlowView {
  provider?: string
  notices?: Array<{ message?: string, code?: string }>
  question?: { id?: number, kind?: string, title?: string, options?: string[] }
  done?: { ok?: boolean, summary?: string }
}

async function flowWhere(predicate: (flow: FlowView) => boolean): Promise<FlowView> {
  for (let waited = 0; waited < 200; waited++) {
    const { body } = await get('/pi2dsh/login-state')
    const flow = body.flow as FlowView | undefined
    if (flow !== undefined && predicate(flow)) return flow
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const { body } = await get('/pi2dsh/login-state')
  throw new Error(`the login flow never reached the expected state; last: ${JSON.stringify(body.flow)}`)
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-login-card-'))
  // Sandbox the agent dir so the credential store (auth.json) lands in the
  // scratch, never in the developer's real Pi config.
  process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent')
  await mkdir(join(scratch, 'agent'), { recursive: true })

  const pkgDir = join(scratch, 'pi-fixture')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
    name: 'pi-login-card-fixture', version: '0.0.0', type: 'module', pi: { extensions: ['index.mjs'] },
  }))
  // A provider whose login drives every callback surface the card must carry:
  // an authorize URL, a device code, a typed prompt, and a select.
  await writeFile(join(pkgDir, 'index.mjs'), [
    'export default function extension(pi) {',
    "  pi.registerProvider('card-example', {",
    "    baseUrl: 'https://api.example.invalid',",
    '    oauth: {',
    "      name: 'Card Example (OAuth)',",
    '      async login(callbacks) {',
    "        callbacks.onAuth({ url: 'https://auth.example.invalid/authorize' })",
    "        callbacks.onDeviceCode({ userCode: 'WXYZ-7788', verificationUri: 'https://auth.example.invalid/device' })",
    "        const typed = await callbacks.onPrompt({ message: 'Paste code' })",
    "        const picked = await callbacks.onSelect({ message: 'Pick account', options: [{ id: 'acct-1', label: 'Work' }] })",
    "        if (typed !== 'pasted-code' || picked !== 'acct-1') throw new Error('unexpected answers: ' + typed + '/' + picked)",
    "        return { access: 'tok-access', refresh: 'tok-refresh', expires: Date.now() + 3600000 }",
    '      },',
    '      refreshToken: async credential => credential,',
    '      getApiKey: credential => credential.access,',
    '    },',
    '  })',
    '}',
  ].join('\n'))
  const pkg = await resolvePiPackage(pkgDir)
  let manifest
  try {
    manifest = await manifestForInstalled(pkg)
  } finally {
    await pkg.dispose()
  }

  const ctx = new Context()
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('webServer', {
    register(route: { handler: RouteHandler }) {
      handler = route.handler
      return () => {}
    },
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  const mount: Plugin.Object = {
    name: 'pi2dsh:login-card-fixture',
    inject: ['tools', 'systemPrompt', 'commands'],
    async apply(inner) {
      await applyPiPackage(inner, { rootUrl: pathToFileURL(`${pkgDir}/`), manifest, config: { browserPresentation: true } })
    },
  }
  await ctx.plugin(mount)
})

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR
  await rm(scratch, { recursive: true, force: true })
})

describe('the login card routes', () => {
  it('lists the OAuth provider signed out, with no flow', async () => {
    const { status, body } = await get('/pi2dsh/login-state')
    expect(status).toBe(200)
    const providers = body.providers as Json[]
    const me = providers.find(provider => provider.id === 'card-example')
    expect(me).toMatchObject({ name: 'Card Example (OAuth)', signedIn: false })
    expect(body.flow).toBeUndefined()
  })

  it('runs a begin → notices → answer → answer → done flow over the wire, and the credential lands in the store', async () => {
    const begin = await post('/pi2dsh/login-action', { action: 'begin', provider: 'card-example' })
    expect(begin.status).toBe(200)
    expect(begin.body.started).toBe('card-example')

    // The authorize URL and the device code arrive as notices BEFORE the flow
    // finishes — the whole reason the card polls instead of waiting for the
    // command notice at the end.
    const asked = await flowWhere(flow => flow.question?.kind === 'input')
    const noticeText = JSON.stringify(asked.notices)
    expect(noticeText).toContain('https://auth.example.invalid/authorize')
    expect(noticeText).toContain('WXYZ-7788')
    expect(asked.question?.title).toBe('Paste code')

    const typed = await post('/pi2dsh/login-action', { action: 'answer', provider: 'card-example', value: 'pasted-code' })
    expect(typed.status).toBe(200)

    const selecting = await flowWhere(flow => flow.question?.kind === 'select')
    expect(selecting.question?.title).toBe('Pick account')
    expect(selecting.question?.options).toContain('Work')
    await post('/pi2dsh/login-action', { action: 'answer', provider: 'card-example', value: 'Work' })

    const finished = await flowWhere(flow => flow.done !== undefined)
    expect(finished.done?.ok).toBe(true)
    expect(finished.done?.summary).toContain('Logged in to Card Example (OAuth)')

    const state = await get('/pi2dsh/login-state')
    const me = (state.body.providers as Json[]).find(provider => provider.id === 'card-example')
    expect(me).toMatchObject({ signedIn: true })
    const onDisk = JSON.parse(await readFile(join(scratch, 'agent', 'auth.json'), 'utf8')) as Json
    expect(onDisk['card-example']).toMatchObject({ type: 'oauth', access: 'tok-access' })

    // Dismiss clears the flow record; the sign-in itself stays.
    await post('/pi2dsh/login-action', { action: 'dismiss', provider: 'card-example' })
    const after = await get('/pi2dsh/login-state')
    expect(after.body.flow).toBeUndefined()
  })

  it('sign-out drops the stored login', async () => {
    const { status, body } = await post('/pi2dsh/login-action', { action: 'signout', provider: 'card-example' })
    expect(status).toBe(200)
    expect(body.signedOut).toBe('card-example')
    const state = await get('/pi2dsh/login-state')
    const me = (state.body.providers as Json[]).find(provider => provider.id === 'card-example')
    expect(me).toMatchObject({ signedIn: false })
    const onDisk = JSON.parse(await readFile(join(scratch, 'agent', 'auth.json'), 'utf8')) as Json
    expect(onDisk['card-example']).toBeUndefined()
  })

  it('refuses an unknown provider and an unknown action loudly', async () => {
    const unknown = await post('/pi2dsh/login-action', { action: 'begin', provider: 'nope' })
    expect(unknown.status).toBe(400)
    expect(String(unknown.body.error)).toContain('unknown OAuth provider')
    const action = await post('/pi2dsh/login-action', { action: 'frobnicate', provider: 'card-example' })
    expect(action.status).toBe(400)
    expect(String(action.body.error)).toContain('unknown login action')
    const noAnswer = await post('/pi2dsh/login-action', { action: 'answer', provider: 'card-example', value: 'x' })
    expect(noAnswer.status).toBe(400)
    expect(String(noAnswer.body.error)).toContain('no login question')
  })

  it('cancel supersedes the in-flight flow and reports it on the record', async () => {
    await post('/pi2dsh/login-action', { action: 'begin', provider: 'card-example' })
    await flowWhere(flow => flow.question !== undefined)
    const cancelled = await post('/pi2dsh/login-action', { action: 'cancel', provider: 'card-example' })
    expect(cancelled.status).toBe(200)
    const finished = await flowWhere(flow => flow.done !== undefined)
    expect(finished.done?.ok).toBe(false)
    await post('/pi2dsh/login-action', { action: 'dismiss', provider: 'card-example' })
  })
})
