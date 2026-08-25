// The structured MCP faces behind dsh-x's native tab, locked at the seam the
// browser really calls: the engine's own route, mounted through the real
// runtime against a real session whose cwd carries a real .mcp.json.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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
const SESSION = 'dshx-mcp-tab'

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

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-mcp-tab-'))
  // A real workspace-level MCP config, secrets included — the route must
  // serve the shape WITHOUT the secret values.
  await writeFile(join(scratch, '.mcp.json'), JSON.stringify({
    mcpServers: {
      everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], env: { API_TOKEN: 'super-secret-value' } },
      remote: { url: 'https://mcp.example.invalid/sse', headers: { Authorization: 'Bearer hidden' } },
    },
  }))

  const pkgDir = join(scratch, 'pi-fixture')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
    name: 'pi-mcp-tab-fixture', version: '0.0.0', type: 'module', pi: { extensions: ['index.mjs'] },
  }))
  await writeFile(join(pkgDir, 'index.mjs'), 'export default function () {}\n')
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
    name: 'pi2dsh:mcp-tab-fixture',
    inject: ['tools', 'systemPrompt', 'commands'],
    async apply(inner) {
      await applyPiPackage(inner, { rootUrl: pathToFileURL(`${pkgDir}/`), manifest })
    },
  }
  await ctx.plugin(mount)
  ctx.sessions.create(SessionId(SESSION), { meta: { createdAt: Date.now(), cwd: scratch } })
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe('the MCP tab routes', () => {
  it('serves the configured servers for the session cwd, with key NAMES but never secret values', async () => {
    const { status, body } = await get(`/pi2dsh/mcp-state?session=${SESSION}`)
    expect(status).toBe(200)
    const servers = body.servers as Json[]
    expect(servers.map(server => server.name).sort()).toEqual(['everything', 'remote'])
    const everything = servers.find(server => server.name === 'everything') as Json
    expect(everything.transport).toBe('stdio')
    expect(everything.target).toContain('server-everything')
    expect(everything.envKeys).toEqual(['API_TOKEN'])
    const remote = servers.find(server => server.name === 'remote') as Json
    expect(remote.headerKeys).toEqual(['Authorization'])
    // The whole payload, as the browser receives it, never carries a secret.
    const wire = JSON.stringify(body)
    expect(wire).not.toContain('super-secret-value')
    expect(wire).not.toContain('Bearer hidden')
  })

  it('persists a disable into the project-local override layer — the same file and shape the adapter itself writes', async () => {
    const { status, body } = await post('/pi2dsh/mcp-action', { session: SESSION, server: 'everything', disabled: true })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    const override = JSON.parse(await readFile(join(scratch, '.pi', 'mcp.json'), 'utf8')) as Json
    expect((override.mcpServers as Json).everything).toEqual({ disabled: true })
    // The layered read now reports the server disabled; its definition stays
    // in the source file untouched.
    const state = await get(`/pi2dsh/mcp-state?session=${SESSION}`)
    const everything = (state.body.servers as Json[]).find(server => server.name === 'everything') as Json
    expect(everything.disabled).toBe(true)
    const source = JSON.parse(await readFile(join(scratch, '.mcp.json'), 'utf8')) as Json
    expect(((source.mcpServers as Json).everything as Json).disabled).toBeUndefined()
  })

  it('re-enabling flips only the override flag back', async () => {
    await post('/pi2dsh/mcp-action', { session: SESSION, server: 'everything', disabled: false })
    const state = await get(`/pi2dsh/mcp-state?session=${SESSION}`)
    const everything = (state.body.servers as Json[]).find(server => server.name === 'everything') as Json
    expect(everything.disabled).toBe(false)
  })

  it('refuses an unknown server and a malformed body without touching disk', async () => {
    const unknown = await post('/pi2dsh/mcp-action', { session: SESSION, server: 'nope', disabled: true })
    expect(unknown.status).toBe(400)
    const malformed = await post('/pi2dsh/mcp-action', { session: SESSION })
    expect(malformed.status).toBe(400)
  })
})
