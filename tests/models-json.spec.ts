// models.json contract tests — Pi's standard custom-model registry running on
// the bridge: vendored loading/composition semantics, credential resolution
// ($ENV interpolation, !command, authHeader, headers-only), and the registry
// surface (find / getApiKeyAndHeaders / getError) inside a real DSH runtime.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime, { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import {
  applyModelsJsonConfiguredAuth,
  loadModelsJsonSnapshot,
  modelsJsonAuthConfigured,
  modelsJsonPath,
  resolveModelsJsonAuth,
} from '../src/models-json.js'
import { applyPiPackage } from '../src/runtime.js'
import type { GeneratedRuntimeManifest } from '../src/types.js'

const KEY_ENV = 'PI2DSH_TEST_VISION_KEY'
let agentDir: string
let savedAgentDir: string | undefined
const cleanup: string[] = []

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), 'pi2dsh-models-json-'))
  cleanup.push(agentDir)
  savedAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agentDir
})

afterEach(async () => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir
  delete process.env[KEY_ENV]
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function writeModelsJson(content: unknown): Promise<void> {
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  await writeFile(join(agentDir, 'models.json'), body)
}

const jdcloudProviders = {
  providers: {
    jdcloud: {
      name: 'JDCloud AI Gateway',
      baseUrl: 'http://gateway.example/v1',
      apiKey: `$${KEY_ENV}`,
      api: 'openai-completions',
      models: [
        { id: 'gpt-5', input: ['text', 'image'] as ('text' | 'image')[] },
      ],
    },
  },
}

describe('models.json loading and composition', () => {
  it('resolves the file inside the Pi agent dir', () => {
    expect(modelsJsonPath()).toBe(join(agentDir, 'models.json'))
  })

  it('projects providers into Pi Model objects with Pi defaults applied', async () => {
    await writeModelsJson(jdcloudProviders)
    const snapshot = await loadModelsJsonSnapshot()
    expect(snapshot.errors).toEqual([])
    expect(snapshot.providers.get('jdcloud')?.name).toBe('JDCloud AI Gateway')
    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.models[0]).toMatchObject({
      id: 'gpt-5',
      name: 'gpt-5',
      provider: 'jdcloud',
      api: 'openai-completions',
      baseUrl: 'http://gateway.example/v1',
      input: ['text', 'image'],
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })
  })

  it('parses Pi-style // comments and trailing commas', async () => {
    await writeModelsJson([
      '{',
      '  // gateway definition',
      '  "providers": {',
      '    "jdcloud": {',
      '      "baseUrl": "http://gateway.example/v1",',
      '      "api": "openai-completions",',
      '      "models": [{ "id": "gpt-5" },],',
      '    },',
      '  },',
      '}',
    ].join('\n'))
    const snapshot = await loadModelsJsonSnapshot()
    expect(snapshot.errors).toEqual([])
    expect(snapshot.models[0]).toMatchObject({ id: 'gpt-5', input: ['text'] })
  })

  it('answers an empty snapshot for a missing file', async () => {
    const snapshot = await loadModelsJsonSnapshot()
    expect(snapshot).toMatchObject({ models: [], errors: [] })
    expect(snapshot.providers.size).toBe(0)
  })

  it('surfaces schema violations as errors instead of throwing', async () => {
    await writeModelsJson({ providers: { bad: { baseUrl: 'http://x', models: [{ id: '' }] } } })
    const snapshot = await loadModelsJsonSnapshot()
    expect(snapshot.models).toEqual([])
    expect(snapshot.errors.join('\n')).toContain('Invalid models.json schema')
  })

  it('isolates a provider that fails composition and keeps the healthy ones', async () => {
    await writeModelsJson({
      providers: {
        broken: { api: 'openai-completions', models: [{ id: 'x' }] },
        jdcloud: jdcloudProviders.providers.jdcloud,
      },
    })
    const snapshot = await loadModelsJsonSnapshot()
    expect(snapshot.errors.join('\n')).toContain('"baseUrl" is required')
    expect(snapshot.providers.has('broken')).toBe(false)
    expect(snapshot.models.map(model => model.id)).toEqual(['gpt-5'])
  })

  it('applies modelOverrides as the topmost user-config layer', async () => {
    await writeModelsJson({
      providers: {
        jdcloud: {
          baseUrl: 'http://gateway.example/v1',
          api: 'openai-completions',
          models: [{ id: 'gpt-5' }],
          modelOverrides: { 'gpt-5': { name: 'Vision GPT-5', input: ['text', 'image'] } },
        },
      },
    })
    const snapshot = await loadModelsJsonSnapshot()
    expect(snapshot.errors).toEqual([])
    expect(snapshot.models[0]).toMatchObject({ id: 'gpt-5', name: 'Vision GPT-5', input: ['text', 'image'] })
  })

  it('classifies an override-only provider declaring image input as a companion, not a provider', async () => {
    await writeModelsJson({
      providers: {
        // Only modelOverrides, no baseUrl/models/apiKey → image-admission companion.
        deepseek: { modelOverrides: { 'deepseek-chat': { input: ['text', 'image'] }, 'deepseek-reasoner': { contextWindow: 64000 } } },
        // Full provider definitions keep their normal path even with image overrides.
        jdcloud: {
          ...jdcloudProviders.providers.jdcloud,
          modelOverrides: { 'gpt-5': { input: ['text', 'image'] } },
        },
        // Override-only WITHOUT image input is Pi's plain builtin-override path.
        basefam: { modelOverrides: { inherited: { contextWindow: 9000 } } },
      },
    })
    const snapshot = await loadModelsJsonSnapshot(async providerId => providerId === 'basefam'
      ? {
          getModels: () => [{
            id: 'inherited', name: 'Inherited', api: 'openai-completions', provider: 'basefam',
            baseUrl: 'http://base.example/v1', reasoning: false, input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
          }],
        }
      : undefined)
    expect(snapshot.errors).toEqual([])
    expect([...snapshot.companions.keys()]).toEqual(['deepseek'])
    expect([...snapshot.companions.get('deepseek') ?? []]).toEqual(['deepseek-chat'])
    expect(snapshot.providers.has('deepseek')).toBe(false)
    expect(snapshot.providers.has('jdcloud')).toBe(true)
    expect(snapshot.models.find(model => model.provider === 'basefam')).toMatchObject({ contextWindow: 9000 })
  })

  it('upserts over a base provider catalog when one exists for the id', async () => {
    await writeModelsJson({
      providers: {
        basefam: {
          baseUrl: 'http://override.example/v1',
          models: [{ id: 'extra', api: 'openai-completions' }],
        },
      },
    })
    const snapshot = await loadModelsJsonSnapshot(async providerId => providerId === 'basefam'
      ? {
          getModels: () => [{
            id: 'inherited', name: 'Inherited', api: 'openai-completions', provider: 'basefam',
            baseUrl: 'http://base.example/v1', reasoning: false, input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
          }],
        }
      : undefined)
    expect(snapshot.errors).toEqual([])
    const byId = new Map(snapshot.models.map(model => [model.id, model]))
    expect(byId.get('inherited')).toMatchObject({ baseUrl: 'http://override.example/v1' })
    expect(byId.get('extra')).toMatchObject({ baseUrl: 'http://override.example/v1', provider: 'basefam' })
  })
})

describe('models.json credential resolution', () => {
  const provider = jdcloudProviders.providers.jdcloud

  it('interpolates $ENV keys and answers ok', () => {
    process.env[KEY_ENV] = 'k-live-value'
    expect(resolveModelsJsonAuth('jdcloud', provider)).toEqual({ ok: true, apiKey: 'k-live-value' })
  })

  it('fails loudly with the resolver message when the env var is missing', () => {
    const resolved = resolveModelsJsonAuth('jdcloud', provider)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.error).toContain(`environment variable: ${KEY_ENV}`)
  })

  it('passes literal keys through and executes !command keys', () => {
    expect(resolveModelsJsonAuth('p', { ...provider, apiKey: 'literal-key' }))
      .toEqual({ ok: true, apiKey: 'literal-key' })
    expect(resolveModelsJsonAuth('p', { ...provider, apiKey: '!echo command-key' }))
      .toEqual({ ok: true, apiKey: 'command-key' })
  })

  it('folds the resolved key into Authorization when authHeader is set', () => {
    process.env[KEY_ENV] = 'k-header'
    const resolved = resolveModelsJsonAuth('jdcloud', { ...provider, authHeader: true, headers: { 'X-Route': 'vision' } })
    expect(resolved).toEqual({
      ok: true,
      apiKey: 'k-header',
      headers: { 'X-Route': 'vision', Authorization: 'Bearer k-header' },
    })
  })

  it("answers Pi's No-API-key error for authHeader without a key", () => {
    const resolved = resolveModelsJsonAuth('jdcloud', { baseUrl: 'http://x', authHeader: true })
    expect(resolved).toEqual({ ok: false, error: 'No API key found for "jdcloud"' })
  })

  it('answers headers-only providers through the compatibility path', () => {
    process.env[KEY_ENV] = 'k-header-only'
    const resolved = resolveModelsJsonAuth('proxy', {
      baseUrl: 'http://x',
      headers: { 'X-Auth': `$${KEY_ENV}` },
    })
    expect(resolved).toEqual({ ok: true, headers: { 'X-Auth': 'k-header-only' } })
  })

  it('layers configured headers and authHeader over another family through applyModelsJsonConfiguredAuth', () => {
    const layered = applyModelsJsonConfiguredAuth('jdcloud', { baseUrl: 'http://x', headers: { 'X-Extra': 'on' }, authHeader: true }, {
      apiKey: 'from-builtin',
      headers: { 'X-Base': 'kept' },
    })
    expect(layered).toEqual({
      ok: true,
      apiKey: 'from-builtin',
      headers: { 'X-Base': 'kept', 'X-Extra': 'on', Authorization: 'Bearer from-builtin' },
    })
    expect(applyModelsJsonConfiguredAuth('jdcloud', { baseUrl: 'http://x', authHeader: true }, {}))
      .toEqual({ ok: false, error: 'No API key found for "jdcloud"' })
  })

  it("mirrors Pi's configured-status semantics", () => {
    expect(modelsJsonAuthConfigured({ baseUrl: 'http://x' })).toBeUndefined()
    expect(modelsJsonAuthConfigured({ baseUrl: 'http://x', apiKey: 'literal' })).toBe(true)
    expect(modelsJsonAuthConfigured({ baseUrl: 'http://x', apiKey: '!echo k' })).toBe(true)
    expect(modelsJsonAuthConfigured({ baseUrl: 'http://x', apiKey: `$${KEY_ENV}` })).toBe(false)
    process.env[KEY_ENV] = 'present'
    expect(modelsJsonAuthConfigured({ baseUrl: 'http://x', apiKey: `$${KEY_ENV}` })).toBe(true)
  })
})

describe('image-admission companion routes in the real DSH runtime', () => {
  it('registers <route>-vision for override-only image declarations, admits images, and forwards text-only', async () => {
    await writeModelsJson({
      providers: {
        // fixture is a DSH-owned text-only route → companion expected.
        fixture: { modelOverrides: { 'fx-mini': { input: ['text', 'image'] } } },
        // ghost has no llm route → the companion must be skipped, not ghost-registered.
        ghost: { modelOverrides: { g1: { input: ['text', 'image'] } } },
      },
    })

    const bundle = await mkdtemp(join(tmpdir(), 'pi2dsh-companion-bundle-'))
    cleanup.push(bundle)
    await mkdir(join(bundle, 'extensions'), { recursive: true })
    await writeFile(join(bundle, 'extensions/probe.ts'), [
      "export default function probe(pi: any) {",
      "  pi.registerTool({",
      "    name: 'companion_probe',",
      "    label: 'Companion probe',",
      "    description: 'Reads the registry and ctx.model the way a vision extension does.',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute(_toolCallId: unknown, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: any) {",
      "      const entries = ctx.modelRegistry.getAll().map((m: any) => ({ provider: m.provider, id: m.id, input: m.input }))",
      "      return { content: [{ type: 'text', text: JSON.stringify({ entries, current: ctx.model }) }] }",
      "    },",
      "  })",
      "}",
    ].join('\n'))
    const manifest: GeneratedRuntimeManifest = {
      schemaVersion: 1,
      package: { name: '@pi2dsh-fixtures/companion-probe', version: '0.0.0', source: 'fixture' },
      extensions: ['extensions/probe.ts'],
      skillDirs: [],
      prompts: [],
    }

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime as never, {} as never)
    const received: GenerateOptions[] = []
    class TextOnlyAdapter extends LlmAdapter {
      override providerInfo(id: string) { return { id, name: `Fixture ${id}` } }
      override async listModels(id: string) {
        return [
          { provider: id, id: 'fx-mini', name: 'Fixture Mini', inputModalities: ['text'] as const },
          { provider: id, id: 'fx-side', name: 'Fixture Side', inputModalities: ['text'] as const },
        ]
      }
      override async resolveModel(id: string, model: string) {
        return { provider: id, id: model, name: `Fixture ${model}`, inputModalities: ['text'] } as never
      }
      override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        received.push(options)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'routed through dsh' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'routed through dsh' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const llm = (ctx as unknown as {
      llm: {
        registerAdapter(providers: string[], adapter: unknown): unknown
        listProviders(): Array<{ id: string, name: string }>
        listModels(provider: string): Promise<Array<Record<string, unknown>>>
        stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>>
      }
    }).llm
    llm.registerAdapter(['fixture'], new TextOnlyAdapter())
    await ctx.plugin({
      name: 'pi2dsh:test-companion',
      inject: ['tools', 'systemPrompt', 'commands', 'skills'],
      async apply(pluginCtx) {
        await applyPiPackage(pluginCtx, { rootUrl: pathToFileURL(`${bundle}/`), manifest })
      },
    } satisfies Plugin.Object)
    await new Promise(resolve => setTimeout(resolve, 25))

    // Directory face: the companion route exists, names its origin, lists
    // ONLY the declared models, and admits images for them.
    const providers = llm.listProviders()
    expect(providers.map(provider => provider.id)).toContain('fixture-vision')
    expect(providers.map(provider => provider.id)).not.toContain('ghost-vision')
    expect(providers.find(provider => provider.id === 'fixture-vision')?.name).toBe('Fixture fixture + Vision Bridge')
    const companionModels = await llm.listModels('fixture-vision')
    expect(companionModels.map(model => model.id)).toEqual(['fx-mini'])
    expect(companionModels[0]?.inputModalities).toEqual(['text', 'image'])

    // Call face: image blocks (top-level and nested in tool results) leave as
    // explicit text notices, and the original route serves the stream.
    const chunks: Array<Record<string, unknown>> = []
    for await (const chunk of llm.stream({
      provider: 'fixture-vision',
      model: 'fx-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what color is this?' },
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 } },
          ],
          source: { kind: 'user' },
        },
        {
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: 'tc-1',
            content: [{ type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }],
          }],
          source: { kind: 'tool', callId: 'tc-1' },
        },
      ],
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(received).toHaveLength(1)
    const forwarded = received[0] as unknown as { messages: Array<{ content: Array<Record<string, unknown>> }> }
    const flatten = (blocks: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      blocks.flatMap(block => [block, ...(Array.isArray(block.content) ? flatten(block.content as never) : [])])
    const allBlocks = forwarded.messages.flatMap(message => flatten(message.content))
    expect(allBlocks.some(block => block.type === 'image')).toBe(false)
    expect(allBlocks.filter(block => block.type === 'text' && String(block.text).includes('[image attachment omitted'))).toHaveLength(2)
    expect(allBlocks.some(block => block.type === 'text' && block.text === 'what color is this?')).toBe(true)

    // Pi projection: the companion entry is in the registry with image input,
    // while ctx.model for a companion selection reports the ORIGINAL route —
    // the truth a vision extension's activation check needs.
    const typedCtx = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      agents: { register(agent: Record<string, unknown>): () => void }
      tools: { execute(request: Record<string, unknown>): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> }
    }
    const session = typedCtx.sessions.create(SessionId('pi2dsh-companion'), {
      meta: { createdAt: Date.now(), cwd: bundle },
    })
    const agent = {
      id: session.id, session,
      options: { provider: 'fixture-vision', model: 'fx-mini' },
      steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve(),
    }
    typedCtx.agents.register(agent)
    const result = await typedCtx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('companion-probe'),
      name: 'companion_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(result.isError ?? false).toBe(false)
    const probe = JSON.parse(result.content[0]?.text ?? '{}') as {
      entries: Array<{ provider: string, id: string, input: string[] }>
      current?: { provider: string, id: string, input: string[] }
    }
    expect(probe.entries.find(entry => entry.provider === 'fixture-vision' && entry.id === 'fx-mini')?.input)
      .toEqual(['text', 'image'])
    expect(probe.current).toMatchObject({ provider: 'fixture', id: 'fx-mini', input: ['text'] })
  })

  it('carries a materialized file path in the omission notice so path-taking tools can reach the image', async () => {
    const { imageAdmissionCompanionAdapter } = await import('../src/provider-adapter.js')
    const received: Array<Record<string, unknown>> = []
    const llm = {
      listProviders: () => [{ id: 'fixture', name: 'Fixture fixture' }],
      listModels: async () => [],
      resolveModelInfo: async () => ({}),
      async *stream(options: Record<string, unknown>) {
        received.push(options)
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const adapter = imageAdmissionCompanionAdapter({
      originalId: 'fixture',
      imageModels: new Set(['fx-mini']),
      llm: llm as never,
      materializeImage: async attachment => `/tmp/pi2dsh-attached-images/${String(attachment.attachmentId)}.png`,
    }) as { stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>> }
    for await (const _chunk of adapter.stream({
      provider: 'fixture-vision',
      model: 'fx-mini',
      messages: [{
        role: 'user',
        content: [{ type: 'image', attachment: { attachmentId: 'att-9', mediaType: 'image/png' } }],
        source: { kind: 'user' },
      }],
    })) void _chunk
    const forwarded = received[0] as { messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(forwarded.messages[0]?.content[0]).toEqual({
      type: 'text',
      text: '[image attached at /tmp/pi2dsh-attached-images/att-9.png — the selected model reads text only; use an image-capable tool to view it]',
    })
  })
})

describe('models.json in the real DSH runtime registry', () => {
  it('exposes user-defined models through find/getAll and resolves their credentials', async () => {
    await writeModelsJson(jdcloudProviders)
    process.env[KEY_ENV] = 'k-runtime-e2e'

    const bundle = await mkdtemp(join(tmpdir(), 'pi2dsh-models-json-bundle-'))
    cleanup.push(bundle)
    await mkdir(join(bundle, 'extensions'), { recursive: true })
    await writeFile(join(bundle, 'extensions/probe.ts'), [
      "export default function probe(pi: any) {",
      "  pi.registerTool({",
      "    name: 'mj_probe',",
      "    label: 'Models.json probe',",
      "    description: 'Reads the model registry the way pi-vision-tool does.',",
      "    parameters: { type: 'object', properties: {}, additionalProperties: false },",
      "    async execute(_toolCallId: unknown, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: any) {",
      "      const model = ctx.modelRegistry.find('jdcloud', 'gpt-5')",
      "      const auth = model === undefined ? undefined : await ctx.modelRegistry.getApiKeyAndHeaders(model)",
      "      const ids = ctx.modelRegistry.getAll().map((entry: any) => `${entry.provider}/${entry.id}`)",
      "      const error = ctx.modelRegistry.getError()",
      "      // A DSH-owned route's model, called through Pi's standard provider",
      "      // stream surface and registry.complete — the bridge must route both",
      "      // through the DSH llm service.",
      "      const fixture = ctx.modelRegistry.find('fixture', 'fx-mini')",
      "      const fixtureProvider = ctx.modelRegistry.getProvider('fixture')",
      "      const llmContext = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() }] }",
      "      let streamedText = ''",
      "      if (fixture !== undefined && typeof fixtureProvider?.streamSimple === 'function') {",
      "        for await (const ev of fixtureProvider.streamSimple(fixture, llmContext, {})) {",
      "          if (ev.type === 'done') streamedText = (ev.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')",
      "        }",
      "      }",
      "      const completed = fixture === undefined ? undefined : await ctx.modelRegistry.complete(fixture, llmContext)",
      "      const completedText = (completed?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')",
      "      return { content: [{ type: 'text', text: JSON.stringify({ model, auth, ids, error, streamedText, completedText }) }] }",
      "    },",
      "  })",
      "}",
    ].join('\n'))
    const manifest: GeneratedRuntimeManifest = {
      schemaVersion: 1,
      package: { name: '@pi2dsh-fixtures/models-json-probe', version: '0.0.0', source: 'fixture' },
      extensions: ['extensions/probe.ts'],
      skillDirs: [],
      prompts: [],
    }

    const plugin: Plugin.Object = {
      name: 'pi2dsh:test-models-json',
      inject: ['tools', 'systemPrompt', 'commands', 'skills'],
      async apply(ctx) {
        await applyPiPackage(ctx, { rootUrl: pathToFileURL(`${bundle}/`), manifest })
      },
    }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)
    // The single-directory contract: models.json providers register as DSH
    // llm routes, and the Pi registry projects that one directory. A
    // DSH-owned fixture route stands in for deployment adapters so the test
    // proves packages call THOSE models through the bridge too.
    await ctx.plugin(LlmRuntime as never, {} as never)
    class FixtureAdapter extends LlmAdapter {
      override providerInfo(id: string) { return { id, name: `Fixture ${id}` } }
      override async listModels(id: string) {
        return [{ provider: id, id: 'fx-mini', name: 'Fixture Mini', inputModalities: ['text'] as const }]
      }
      override async resolveModel(id: string, model: string) {
        return { provider: id, id: model, name: `Fixture ${model}` } as never
      }
      override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'routed through dsh' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'routed through dsh' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ;(ctx as unknown as { llm: { registerAdapter(providers: string[], adapter: unknown): unknown } })
      .llm.registerAdapter(['fixture'], new FixtureAdapter())
    await ctx.plugin(plugin)
    await new Promise(resolve => setTimeout(resolve, 25))

    const typedCtx = ctx as unknown as {
      sessions: { create(id: unknown, options: Record<string, unknown>): { id: unknown } }
      agents: { register(agent: Record<string, unknown>): () => void }
      tools: { execute(request: Record<string, unknown>): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> }
    }
    const session = typedCtx.sessions.create(SessionId('pi2dsh-models-json'), {
      meta: { createdAt: Date.now(), cwd: bundle },
    })
    const agent = { id: session.id, session, steer() {}, inject() {}, followup() {}, whenIdle: () => Promise.resolve() }
    typedCtx.agents.register(agent)

    const result = await typedCtx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('mj-probe'),
      name: 'mj_probe',
      arguments: {},
      agent: agent as never,
    })
    expect(result.isError ?? false).toBe(false)
    const text = result.content[0]?.text ?? '{}'
    const probe = JSON.parse(text) as {
      model?: Record<string, unknown>
      auth?: { ok: boolean; apiKey?: string }
      ids: string[]
      error?: string
      streamedText?: string
      completedText?: string
    }
    expect(probe.error).toBeUndefined()
    expect(probe.ids).toContain('jdcloud/gpt-5')
    // A DSH-owned route's model answers through Pi's standard call surfaces —
    // provider.streamSimple and registry.complete both run the DSH llm route.
    expect(probe.ids).toContain('fixture/fx-mini')
    expect(probe.streamedText).toBe('routed through dsh')
    expect(probe.completedText).toBe('routed through dsh')
    // The projection is an EXACT Pi Model even though the DSH directory sits
    // in between: the wire api and baseUrl survive the round trip.
    expect(probe.model).toMatchObject({
      provider: 'jdcloud',
      id: 'gpt-5',
      api: 'openai-completions',
      baseUrl: 'http://gateway.example/v1',
      input: ['text', 'image'],
    })
    expect(probe.auth).toEqual({ ok: true, apiKey: 'k-runtime-e2e' })
  })
})
