// ctx.modelRegistry's registration surface — Pi 0.84.1 model-registry.ts:
// registerProvider (both overloads), unregisterProvider,
// getRegisteredProviderConfig, getRegisteredNativeProvider,
// getRegisteredProviderIds.
//
// Why this exists: three of those methods were missing, and
// pi-background-tasks 2.6 calls getRegisteredNativeProvider from a
// session_start handler — the TypeError failed the package's agent mount, so
// all of its tools vanished for the agent while the boot log still said
// "loaded 11 tools". The fixture below runs the same snapshot / install /
// restore protocol that package runs, against the real projection.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { applyPiPackage } from '../src/runtime.js'
import type { GeneratedRuntimeManifest } from '../src/types.js'

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const EXTENSION = [
  'export default function probe(pi: any) {',
  "  pi.registerTool({ name: 'registry_probe_tool', description: 'proves the package stayed mounted', parameters: { type: 'object', properties: {} }, async execute() { return { content: [{ type: 'text', text: 'ok' }] } } })",
  "  pi.on('session_start', (_event: any, ctx: any) => {",
  '    const r = ctx.modelRegistry',
  '    const out: any = {}',
  "    out.methods = ['registerProvider', 'unregisterProvider', 'getRegisteredProviderConfig', 'getRegisteredNativeProvider', 'getRegisteredProviderIds'].filter(name => typeof r[name] !== 'function')",
  // Legacy (name, config) form: lands in the legacy ledger only.
  "    const legacy = { baseUrl: 'https://legacy.invalid/v1', api: 'openai-completions', apiKey: 'PROBE_KEY', models: [] }",
  "    out.before = { config: r.getRegisteredProviderConfig('probe-legacy'), native: r.getRegisteredNativeProvider('probe-legacy') }",
  "    r.registerProvider('probe-legacy', legacy)",
  "    const token = r.getRegisteredProviderConfig('probe-legacy')",
  "    out.legacy = { configSet: token !== undefined, stableIdentity: token === r.getRegisteredProviderConfig('probe-legacy'), native: r.getRegisteredNativeProvider('probe-legacy'), listed: r.getRegisteredProviderIds().includes('probe-legacy') }",
  // Native pi-ai Provider object: lands in the native ledger only.
  "    const native = { id: 'probe-native', name: 'Probe Native', models: [] }",
  '    r.registerProvider(native)',
  "    out.native = { sameObject: r.getRegisteredNativeProvider('probe-native') === native, config: r.getRegisteredProviderConfig('probe-native'), listed: r.getRegisteredProviderIds().includes('probe-native') }",
  // The two ledgers replace each other for one id, as in Pi's ModelRuntime.
  "    r.registerProvider('probe-native', legacy)",
  "    out.replaced = { native: r.getRegisteredNativeProvider('probe-native'), configSet: r.getRegisteredProviderConfig('probe-native') !== undefined }",
  // pi.registerProvider and the registry are one runtime.
  "    pi.registerProvider('probe-via-pi', legacy)",
  "    out.viaPi = r.getRegisteredProviderIds().includes('probe-via-pi')",
  "    try { r.registerProvider('probe-no-config'); out.noConfig = 'accepted' } catch (error: any) { out.noConfig = String(error.message) }",
  "    for (const id of ['probe-legacy', 'probe-native', 'probe-via-pi']) r.unregisterProvider(id)",
  "    out.after = { ids: r.getRegisteredProviderIds().filter((id: string) => id.startsWith('probe-')), config: r.getRegisteredProviderConfig('probe-legacy'), native: r.getRegisteredNativeProvider('probe-native') }",
  '    ;(globalThis as any).__registryProbe = out',
  '  })',
  '}',
].join('\n')

describe('ctx.modelRegistry registration surface', () => {
  it('implements Pi\'s two provider ledgers on the same path as pi.registerProvider, and the package stays mounted', async () => {
    const bundle = await mkdtemp(join(tmpdir(), 'pi2dsh-registry-'))
    cleanup.push(bundle)
    await mkdir(join(bundle, 'extensions'), { recursive: true })
    await writeFile(join(bundle, 'extensions/probe.ts'), EXTENSION)
    const manifest: GeneratedRuntimeManifest = {
      schemaVersion: 1,
      package: { name: '@pi2dsh-fixtures/registry-probe', version: '0.0.0', source: 'fixture' },
      extensions: ['extensions/probe.ts'],
      skillDirs: [],
      prompts: [],
    }
    const plugin: Plugin.Object = {
      name: 'pi2dsh:test-registry',
      inject: ['tools', 'systemPrompt', 'commands'],
      async apply(ctx) {
        await applyPiPackage(ctx, { rootUrl: pathToFileURL(`${bundle}/`), manifest })
      },
    }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    const mounted = await ctx.plugin(plugin)
    delete (globalThis as Record<string, unknown>).__registryProbe

    const typed = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      agents: { register(agent: Record<string, unknown>): () => void }
      tools: { schemas(agent: unknown): Array<{ name: string }> }
      emit(name: string, payload: Record<string, unknown>): void
    }
    const session = typed.sessions.create(SessionId('pi2dsh-registry'), { meta: { createdAt: Date.now(), cwd: bundle } })
    const agent = { id: session.id, session, options: {}, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    typed.agents.register(agent)
    typed.emit('agent/session-start', { agent, source: 'fresh' })
    const deadline = Date.now() + 5000
    while ((globalThis as Record<string, unknown>).__registryProbe === undefined && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const probe = (globalThis as Record<string, unknown>).__registryProbe as Record<string, unknown>
    expect(probe, 'session_start handler never completed — it threw before reporting').toBeDefined()
    expect(probe.methods).toEqual([])
    expect(probe.before).toEqual({ config: undefined, native: undefined })
    expect(probe.legacy).toEqual({ configSet: true, stableIdentity: true, native: undefined, listed: true })
    expect(probe.native).toEqual({ sameObject: true, config: undefined, listed: true })
    expect(probe.replaced).toEqual({ native: undefined, configSet: true })
    expect(probe.viaPi).toBe(true)
    expect(probe.noConfig).toBe('Provider config is required when registering by name')
    expect(probe.after).toEqual({ ids: [], config: undefined, native: undefined })
    // The regression's user-visible half: the package's tool is offered to this agent.
    expect(typed.tools.schemas(agent).map(tool => tool.name)).toContain('registry_probe_tool')
    await mounted.dispose()
  })
})

// Found by the same real-package run: once the tools were back, the headless
// process ended with "fatal load failure". At exit the host kills the running
// job, the package sends its completion notice with pi.sendMessage (declared
// void in Pi, so never awaited), and the agent it targets is already gone.
describe('an unawaited pi.sendMessage that cannot be delivered', () => {
  it('is reported as a warning and never becomes an unhandled rejection', async () => {
    const bundle = await mkdtemp(join(tmpdir(), 'pi2dsh-late-send-'))
    cleanup.push(bundle)
    await mkdir(join(bundle, 'extensions'), { recursive: true })
    await writeFile(join(bundle, 'extensions/late.ts'), [
      'export default function late(pi: any) {',
      "  pi.on('session_start', () => { (globalThis as any).__lateSend = () => { pi.sendMessage({ customType: 'late', content: 'job finished', display: true }, { triggerTurn: true, deliverAs: 'followUp' }) } })",
      '}',
    ].join('\n'))
    const manifest: GeneratedRuntimeManifest = {
      schemaVersion: 1,
      package: { name: '@pi2dsh-fixtures/late-send', version: '0.0.0', source: 'fixture' },
      extensions: ['extensions/late.ts'],
      skillDirs: [],
      prompts: [],
    }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    const mounted = await ctx.plugin({
      name: 'pi2dsh:test-late-send',
      inject: ['tools', 'systemPrompt', 'commands'],
      async apply(inner) { await applyPiPackage(inner, { rootUrl: pathToFileURL(`${bundle}/`), manifest }) },
    } satisfies Plugin.Object)
    const typed = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      agents: { register(agent: Record<string, unknown>): () => void }
      emit(name: string, payload: Record<string, unknown>): void
    }
    const session = typed.sessions.create(SessionId('pi2dsh-late-send'), { meta: { createdAt: Date.now(), cwd: bundle } })
    // The shape DSH's loop answers with once the agent's inbox is torn down.
    const gone = () => { throw new Error('cannot read inbox state: its projection registration is not active') }
    const agent = { id: session.id, session, options: {}, steer: gone, inject: gone, followup: gone, whenIdle: () => Promise.resolve() }
    typed.agents.register(agent)
    delete (globalThis as Record<string, unknown>).__lateSend
    typed.emit('agent/session-start', { agent, source: 'fresh' })
    const deadline = Date.now() + 5000
    while ((globalThis as Record<string, unknown>).__lateSend === undefined && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      ;((globalThis as Record<string, unknown>).__lateSend as () => void)()
      await new Promise(resolve => setTimeout(resolve, 150))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
    await mounted.dispose()
  })
})
