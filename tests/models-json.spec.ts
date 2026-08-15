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
import { CallId } from '@deepseek-ai/dsh-llm'
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
      "      return { content: [{ type: 'text', text: JSON.stringify({ model, auth, ids, error }) }] }",
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
    }
    expect(probe.error).toBeUndefined()
    expect(probe.ids).toContain('jdcloud/gpt-5')
    expect(probe.model).toMatchObject({
      provider: 'jdcloud',
      id: 'gpt-5',
      baseUrl: 'http://gateway.example/v1',
      input: ['text', 'image'],
    })
    expect(probe.auth).toEqual({ ok: true, apiKey: 'k-runtime-e2e' })
  })
})
