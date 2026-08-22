// DSH authorization-seam projection contract (0.1.1 line): a Pi package's
// OAuth-capable provider appears on DSH's native sign-in surface as an
// official authorization flow; running it executes the package's OWN login,
// commits the record witness the seam demands, and the official sign-out
// (deleteRecord) is mirrored back into the bridge's Pi-format store. All on
// the real AuthorizationService and the real local credentials store — the
// only fixture code is the package's own oauth.login implementation, which
// is the plugin's contract, not the host's.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AuthorizationService, { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { apply } from '../src/engine.js'

const cleanup: string[] = []
let savedHome: string | undefined

beforeEach(() => { savedHome = process.env.DSH_HOME })
afterEach(async () => {
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function makeProfile(dependencies: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi2dsh-authz-profile-'))
  cleanup.push(root)
  await writeFile(join(root, 'cordis.yml'), '- name: dsh-base\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'profile', dependencies, dsh: { profile: { bundles: [] } },
  }, null, 2))
  await mkdir(join(root, 'node_modules'), { recursive: true })
  return root
}

async function installOAuthFixture(root: string, packageName: string, providerId: string): Promise<void> {
  const dir = join(root, 'node_modules', packageName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: packageName, version: '1.0.0', pi: { extensions: ['extension.ts'] },
  }, null, 2))
  await writeFile(join(dir, 'extension.ts'), [
    'export default function extension(pi: any) {',
    `  pi.registerProvider(${JSON.stringify(providerId)}, {`,
    `    name: 'Fixture Gateway',`,
    "    baseUrl: 'https://gw.example/v1',",
    '    oauth: {',
    "      name: 'Fixture Gateway',",
    // The package's own login: resolves a credential immediately, the way a
    // provider whose flow needs no human step would. This is plugin code.
    "      login: async () => ({ type: 'oauth', access: 'fixture-access-token', refresh: 'fixture-refresh', expires: Date.now() + 3_600_000 }),",
    '    },',
    '  })',
    '}',
  ].join('\n'))
}

async function buildHost(root: string): Promise<Context> {
  const home = await mkdtemp(join(tmpdir(), 'pi2dsh-authz-home-'))
  cleanup.push(home)
  process.env.DSH_HOME = home
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt as never, { includeHarnessIdentity: false } as never)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(LlmRuntime as never, {} as never)
  await ctx.plugin(LocalCredentials as never, { path: join(home, 'credentials.yaml') } as never)
  await ctx.plugin(AuthorizationService as never, {} as never)
  ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
  await apply(ctx, {})
  await new Promise(resolve => setTimeout(resolve, 50))
  return ctx
}

type AuthzFace = {
  authorization: {
    list(): ReadonlyArray<{ key: unknown, label: string, methods: ReadonlyArray<{ id: string }> }>
    registerFlow(flow: Record<string, unknown>): () => void
    begin(request: Record<string, unknown>): Promise<{ status: string }>
  }
  credentials: {
    readRecord(key: unknown): Promise<Record<string, unknown> | undefined>
    deleteRecord(key: unknown): Promise<void>
  }
}

const declineInteraction = {
  notify: () => {},
  prompt: () => Promise.reject(new AuthorizationDeclinedError()),
}

describe('DSH authorization-seam projection', () => {
  it('a package OAuth provider joins the native sign-in surface, signs in, and mirrors sign-out', async () => {
    const root = await makeProfile({ 'pi-authz-gw': '1.0.0' })
    await installOAuthFixture(root, 'pi-authz-gw', 'authz-gw')
    const ctx = await buildHost(root) as unknown as AuthzFace

    // Projection: the provider is on the official surface, under our scope.
    const entry = ctx.authorization.list().find(candidate => String(candidate.key) === 'pi2dsh/authz-gw')
    expect(entry).toBeDefined()
    expect(entry?.methods.map(method => method.id)).toContain('oauth')

    // Sign in through the OFFICIAL seam: the package's own login runs, the
    // commit witness lands, and the outcome is authorized.
    const key = credentialKey('pi2dsh', 'authz-gw')
    const outcome = await ctx.authorization.begin({ key, interaction: declineInteraction })
    expect(outcome.status).toBe('authorized')
    const record = await ctx.credentials.readRecord(key)
    expect(record).toMatchObject({ kind: 'grant' })

    // The credential really landed in the bridge's Pi-format store.
    const authPath = join(process.env.DSH_HOME as string, 'pi2dsh', 'agent', 'auth.json')
    expect(existsSync(authPath)).toBe(true)
    const auth = JSON.parse(await readFile(authPath, 'utf8')) as Record<string, unknown>
    expect(auth['authz-gw']).toMatchObject({ access: 'fixture-access-token' })

    // The official sign-out mirrors into the Pi store.
    await ctx.credentials.deleteRecord(key)
    for (let tick = 0; tick < 50; tick += 1) {
      const now = JSON.parse(await readFile(authPath, 'utf8')) as Record<string, unknown>
      if (now['authz-gw'] === undefined) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const after = JSON.parse(await readFile(authPath, 'utf8')) as Record<string, unknown>
    expect(after['authz-gw']).toBeUndefined()
  })

  it('coexists with another scope\'s flow for the same id — scopes are the namespace', async () => {
    const root = await makeProfile({ 'pi-authz-taken': '1.0.0' })
    await installOAuthFixture(root, 'pi-authz-taken', 'taken-gw')
    const home = await mkdtemp(join(tmpdir(), 'pi2dsh-authz-home-'))
    cleanup.push(home)
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt as never, { includeHarnessIdentity: false } as never)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    await ctx.plugin(LocalCredentials as never, { path: join(home, 'credentials.yaml') } as never)
    await ctx.plugin(AuthorizationService as never, {} as never)
    // Another flow for the SAME id under a different scope — exactly what the
    // official llm-pi-ai catalog does in a real composition. Its credential
    // space is its own; ours must still appear, or the routes the bridge
    // serves would be unreachable from the native sign-in surface.
    const face = ctx as unknown as AuthzFace
    face.authorization.registerFlow({
      key: credentialKey('other-scope', 'taken-gw'),
      label: 'Existing',
      methods: [{ id: 'api-key', label: 'API key' }],
      run: async () => { throw new Error('never run in this test') },
    })
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
    await apply(ctx as never, {})
    await new Promise(resolve => setTimeout(resolve, 50))

    const entries = face.authorization.list().filter(candidate => String(candidate.key).endsWith('/taken-gw'))
    expect(entries.map(entry => String(entry.key)).sort()).toEqual(['other-scope/taken-gw', 'pi2dsh/taken-gw'])
    const ours = entries.find(entry => String(entry.key) === 'pi2dsh/taken-gw')
    expect(ours?.label).toBe('Fixture Gateway (pi2dsh)')
  })

  it('projects flows even when the authorization service is composed AFTER the engine', async () => {
    // The stock 0.1.1 compositions ship dsh-authorization without composing
    // it: the service can join the composition at any time (a profile patch,
    // a later host release). The projection must attach then, not only when
    // the service happened to mount first.
    const root = await makeProfile({ 'pi-authz-late': '1.0.0' })
    await installOAuthFixture(root, 'pi-authz-late', 'late-gw')
    const home = await mkdtemp(join(tmpdir(), 'pi2dsh-authz-home-'))
    cleanup.push(home)
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt as never, { includeHarnessIdentity: false } as never)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    await ctx.plugin(LocalCredentials as never, { path: join(home, 'credentials.yaml') } as never)
    ;(ctx as unknown as { baseUrl: string }).baseUrl = `file://${root}/cordis.yml`
    await apply(ctx as never, {})
    await new Promise(resolve => setTimeout(resolve, 50))

    // Only now does the service arrive.
    await ctx.plugin(AuthorizationService as never, {} as never)
    await new Promise(resolve => setTimeout(resolve, 100))

    const face = ctx as unknown as AuthzFace
    const keys = face.authorization.list().map(entry => String(entry.key))
    expect(keys).toContain('pi2dsh/late-gw')
    // And a late-arrived surface can sign in the same way.
    const key = credentialKey('pi2dsh', 'late-gw')
    const outcome = await face.authorization.begin({ key, interaction: declineInteraction })
    expect(outcome.status).toBe('authorized')
  })
})
