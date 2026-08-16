// Provider adapter contracts: a Pi package's provider (its OWN transport)
// serves a real DSH llm route through the public registerAdapter seam — the
// loop-facing half of "model division of labor". Verified against a real
// LlmRuntime, full round trip: DSH GenerateOptions → Pi request context →
// the package's stream events → DSH chunks.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { registerPiProviderRoute } from '../src/provider-adapter.js'
import { dshRequestToPiContext, piEventsToDshChunks } from '../src/model-bridge.js'

type UnknownRecord = Record<string, unknown>

function piFixtureProvider() {
  const calls: Array<{ model: UnknownRecord, context: UnknownRecord, options: UnknownRecord }> = []
  const provider = {
    id: 'pifix',
    name: 'Pi Fixture Gateway',
    getModels: () => [{ id: 'pifix-1', name: 'Pi Fixture One', provider: 'pifix', contextWindow: 32000 }],
    async *stream(model: UnknownRecord, context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord> {
      calls.push({ model, context, options })
      yield { type: 'start', partial: {} }
      yield { type: 'text_start', contentIndex: 0 }
      yield { type: 'text_delta', contentIndex: 0, delta: 'pi says ' }
      yield { type: 'text_delta', contentIndex: 0, delta: 'hi' }
      yield { type: 'text_end', contentIndex: 0, content: 'pi says hi' }
      yield {
        type: 'done',
        reason: 'stop',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'pi says hi' }],
          usage: { input: 9, output: 3, cacheRead: 1 },
          stopReason: 'stop',
        },
      }
    },
  }
  return { provider, calls }
}

describe('Pi provider as a DSH llm route', () => {
  it('registers the package transport as a route and streams a full round trip', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as { llm: { registerAdapter(providers: string[], adapter: unknown): () => void, listProviders(): Array<{ id: string }>, listModels(p: string): Promise<UnknownRecord[]>, stream(o: UnknownRecord): AsyncIterable<UnknownRecord> } }).llm

    const { provider, calls } = piFixtureProvider()
    const dispose = registerPiProviderRoute({
      llm,
      providerId: 'pifix',
      provider: provider as never,
      host: {
        resolveAuth: async () => ({ auth: { apiKey: 'pi-key-77', baseUrl: 'https://gw.example/v1' } }),
        warn: () => {},
      },
    })
    expect(dispose).toBeTypeOf('function')

    // The route is a first-class llm citizen: directory and models list.
    expect(llm.listProviders().map(entry => entry.id)).toContain('pifix')
    expect(await llm.listModels('pifix')).toMatchObject([{ provider: 'pifix', id: 'pifix-1', name: 'Pi Fixture One' }])

    // A DSH-native call routes through the PACKAGE's own transport.
    const chunks: UnknownRecord[] = []
    for await (const chunk of llm.stream({
      provider: 'pifix',
      model: 'pifix-1',
      system: 'be nice',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello there' }], source: { kind: 'user' } },
        {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c9', content: [{ type: 'text', text: 'tool output' }], isError: false }],
          source: { kind: 'tool', callId: 'c9' },
        },
      ],
      maxTokens: 99,
    })) chunks.push(chunk)

    // The package saw a faithful Pi request: system prompt slot, toolResult
    // message, its own model entry, and the resolved credential.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toMatchObject({ id: 'pifix-1' })
    expect(calls[0]?.context).toMatchObject({ systemPrompt: 'be nice' })
    const piMessages = calls[0]?.context.messages as UnknownRecord[]
    expect(piMessages[0]).toMatchObject({ role: 'user' })
    expect(piMessages[1]).toMatchObject({ role: 'toolResult', toolCallId: 'c9', isError: false })
    expect(calls[0]?.options).toMatchObject({ apiKey: 'pi-key-77', baseUrl: 'https://gw.example/v1', maxTokens: 99 })

    // And DSH consumers received canonical chunks with disjoint usage.
    const types = chunks.map(chunk => chunk.type)
    expect(types).toEqual(['block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish'])
    expect(chunks[4]).toMatchObject({ usage: { inputTokens: 9, outputTokens: 3, cacheReadTokens: 1 } })
    expect(chunks[5]).toMatchObject({ reason: { kind: 'stop' } })

    dispose?.()
    expect(llm.listProviders().map(entry => entry.id)).not.toContain('pifix')
  })

  it('keeps the existing route on a name conflict instead of clobbering it', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as { llm: { registerAdapter(providers: string[], adapter: unknown): () => void, listProviders(): Array<{ id: string }> } }).llm
    const { provider } = piFixtureProvider()
    llm.registerAdapter(['pifix'], {
      providerInfo: (id: string) => ({ id, name: 'deployment-owned' }),
      providerRetryPolicy: () => undefined,
      listModels: async () => [],
      resolveModel: async (id: string, model: string) => ({ provider: id, id: model, name: model }),
      async *stream(): AsyncIterable<UnknownRecord> { yield { type: 'finish', reason: { kind: 'stop' } } },
    })

    const warnings: string[] = []
    const dispose = registerPiProviderRoute({
      llm,
      providerId: 'pifix',
      provider: provider as never,
      host: { resolveAuth: async () => undefined, warn: message => warnings.push(message) },
    })
    expect(dispose).toBeUndefined()
    expect(warnings.join('\n')).toContain('existing route keeps the name')
  })

  it('translates aborts and package errors into terminal DSH chunks, never fabricated finishes', async () => {
    async function* erroring(): AsyncIterable<UnknownRecord> {
      yield { type: 'text_start', contentIndex: 0 }
      yield { type: 'error', reason: 'error', error: new Error('gateway melted') }
    }
    const chunks: UnknownRecord[] = []
    for await (const chunk of piEventsToDshChunks(erroring())) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { message: 'gateway melted' } } })

    async function* truncated(): AsyncIterable<UnknownRecord> {
      yield { type: 'text_start', contentIndex: 0 }
    }
    const tail: UnknownRecord[] = []
    for await (const chunk of piEventsToDshChunks(truncated())) tail.push(chunk)
    expect(tail.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  })

  it('round-trips assistant tool-call history through the reverse conversion', () => {
    const context = dshRequestToPiContext({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'thinking hard' },
            { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"a.txt"}' },
          ],
          source: { kind: 'model', provider: 'pifix', model: 'pifix-1' },
        },
      ],
    })
    const assistant = (context.messages as UnknownRecord[])[0] as { content: UnknownRecord[] }
    expect(assistant.content[0]).toMatchObject({ type: 'thinking', thinking: 'thinking hard' })
    expect(assistant.content[1]).toMatchObject({ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.txt' } })
  })

  // Reasoning is where the two vocabularies differ: Pi carries a boolean plus
  // a thinkingLevelMap, DSH asks for selectable efforts. Without translating,
  // a package-registered route offers NO effort and every reasoning request is
  // rejected with UNSUPPORTED_REASONING_EFFORT — which is exactly what private
  // gateways need, since their compat quirks only show up under reasoning.
  it('projects Pi reasoning levels into DSH selectable efforts, and omits them for non-reasoning models', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const provider = {
      id: 'reason',
      name: 'Reasoning Gateway',
      getModels: () => [
        // Every level except the two that must be declared explicitly.
        { id: 'plain-reasoner', provider: 'reason', reasoning: true },
        // null marks a level unsupported; xhigh/max count only when present.
        {
          id: 'narrow-reasoner',
          provider: 'reason',
          reasoning: true,
          thinkingLevelMap: { minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xh' },
        },
        { id: 'no-reasoner', provider: 'reason', reasoning: false },
      ],
      async *stream(): AsyncIterable<UnknownRecord> { yield { type: 'done', reason: 'stop', message: {} } },
    }
    const llm = (ctx as unknown as {
      llm: {
        registerAdapter(providers: string[], adapter: unknown): () => void
        listModels(p: string): Promise<UnknownRecord[]>
        resolveModelInfo(p: string, m: string): Promise<UnknownRecord>
      }
    }).llm
    registerPiProviderRoute({
      llm,
      providerId: 'reason',
      provider: provider as never,
      host: { resolveAuth: async () => ({ auth: {} }), warn: () => {} },
    })

    // `reasoning` is a resolved-model field in DSH's contract, so the exact
    // route resolve is where it must appear — that is what the loop consults
    // before a request.
    const effortsOf = async (id: string): Promise<string[]> => {
      const resolved = await llm.resolveModelInfo('reason', id) as UnknownRecord
      const reasoning = resolved.reasoning as { efforts?: Array<{ id: string }> } | undefined
      return (reasoning?.efforts ?? []).map(effort => effort.id)
    }

    // No map: every standard level, plus off; xhigh/max stay out until declared.
    expect(await effortsOf('plain-reasoner')).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    // Mapped: minimal removed by null, xhigh admitted because it is declared.
    expect(await effortsOf('narrow-reasoner')).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    // A non-reasoning model must carry no reasoning field at all, rather than
    // an empty one that would read as "reasoning, with nothing selectable".
    const plain = await llm.resolveModelInfo('reason', 'no-reasoner') as UnknownRecord
    expect(plain.reasoning).toBeUndefined()

    // Efforts carry display names, as DSH's own adapter provides.
    const resolved = await llm.resolveModelInfo('reason', 'narrow-reasoner') as UnknownRecord
    const resolvedEfforts = (resolved.reasoning as { efforts: Array<{ id: string, name: string }> }).efforts
    expect(resolvedEfforts[0]).toMatchObject({ id: 'off', name: 'Off' })
  })

  // Offering efforts is only half the contract: the picked one has to reach
  // the package's request, or the selector is decorative.
  it('passes the selected reasoning effort down to the package request', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as {
      llm: {
        registerAdapter(providers: string[], adapter: unknown): () => void
        stream(o: UnknownRecord): AsyncIterable<UnknownRecord>
      }
    }).llm
    const seen: UnknownRecord[] = []
    const provider = {
      id: 'effort',
      name: 'Effort Gateway',
      getModels: () => [{ id: 'e1', provider: 'effort', reasoning: true }],
      async *stream(_model: UnknownRecord, _context: UnknownRecord, options: UnknownRecord): AsyncIterable<UnknownRecord> {
        seen.push(options)
        yield { type: 'done', reason: 'stop', message: { role: 'assistant', content: [] } }
      },
    }
    registerPiProviderRoute({
      llm,
      providerId: 'effort',
      provider: provider as never,
      host: { resolveAuth: async () => ({ auth: {} }), warn: () => {} },
    })

    for await (const _chunk of llm.stream({
      provider: 'effort',
      model: 'e1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      reasoningEffort: 'high',
    })) { /* drain */ }

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ reasoningEffort: 'high' })
  })
})
