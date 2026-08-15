// Model Runtime Bridge contracts: the Pi model surface (catalog, current
// model, designated-model calls) running on a REAL @deepseek-ai/dsh-llm
// runtime with a mock adapter — the same registration path a production
// adapter uses. No pi2dsh-private seams are exercised.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ModelCatalog, llmOf, piRequestToDshMessages, streamViaDshLlm } from '../src/model-bridge.js'

class FixtureAdapter extends LlmAdapter {
  lastOptions: Record<string, unknown> | undefined

  override providerInfo(provider: string) {
    return { id: provider, name: `Fixture ${provider}` }
  }

  override async listModels(provider: string) {
    return [
      { provider, id: 'fx-mini', name: 'Fixture Mini', inputModalities: ['text'] as const },
      { provider, id: 'fx-vision', name: 'Fixture Vision', inputModalities: ['text', 'image'] as const },
    ]
  }

  override async resolveModel(provider: string, model: string) {
    return {
      provider, id: model, name: `Fixture ${model}`,
      context: { contextWindow: 64000 },
      defaultMaxTokens: 4096,
      reasoning: { efforts: [{ id: 'high', name: 'High' }] },
    } as never
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options as unknown as Record<string, unknown>
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hello ' }
    yield { type: 'text-delta', index: 0, text: 'world' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello world' } }
    yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 5, cacheReadTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function llmContext() {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime as never, {} as never)
  const adapter = new FixtureAdapter()
  ;(ctx as unknown as { llm: { registerAdapter(providers: string[], adapter: unknown): unknown } })
    .llm.registerAdapter(['fixture'], adapter)
  return { ctx, adapter }
}

describe('model runtime bridge', () => {
  it('projects the DSH llm directory as Pi Model objects with exact-route metadata', async () => {
    const { ctx } = await llmContext()
    const llm = llmOf(ctx)
    expect(llm).toBeDefined()
    const catalog = new ModelCatalog(llm)
    await catalog.refresh()

    const all = catalog.all()
    expect(all.map(model => `${model.provider}/${model.id}`)).toEqual(['fixture/fx-mini', 'fixture/fx-vision'])
    expect(all[1]).toMatchObject({ name: 'Fixture Vision', api: 'faux', input: ['text', 'image'] })

    const resolved = await catalog.resolve('fixture', 'fx-mini')
    expect(resolved).toMatchObject({ contextWindow: 64000, maxTokens: 4096, reasoning: true })
    // resolve() caches; find() serves the enriched entry afterwards.
    expect(catalog.find('fixture', 'fx-mini')).toMatchObject({ contextWindow: 64000 })
  })

  it('runs a designated-model pi-ai call on ctx.llm.stream with faithful two-way conversion', async () => {
    const { ctx, adapter } = await llmContext()
    const llm = llmOf(ctx)!
    const stream = streamViaDshLlm(llm, {
      model: { id: 'fx-mini', provider: 'fixture' },
      context: {
        systemPrompt: 'be terse',
        messages: [
          { role: 'user', content: 'say hello' },
          { role: 'assistant', content: [{ type: 'text', text: 'earlier reply' }] },
          { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'tool says hi' }], isError: false },
        ],
      },
      options: { maxTokens: 128, temperature: 0.2 },
    })

    const events: Array<Record<string, unknown>> = []
    for await (const event of stream as AsyncIterable<Record<string, unknown>>) events.push(event)

    // Pi event vocabulary out of DSH chunks.
    expect(events.map(event => event.type)).toEqual(['start', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done'])
    const done = events.at(-1) as { message: { content: Array<{ text: string }>, usage: Record<string, number>, stopReason: string } }
    expect(done.message.content[0]?.text).toBe('hello world')
    expect(done.message.stopReason).toBe('stop')
    // Disjoint DSH counts arrive as Pi usage fields verbatim.
    expect(done.message.usage).toMatchObject({ input: 11, output: 5, cacheRead: 2 })
    expect(await (stream as { result(): Promise<unknown> }).result()).toBe(done.message)

    // The adapter saw a fully-translated DSH request: system slot, tool-result
    // message, explicit route.
    expect(adapter.lastOptions).toMatchObject({ provider: 'fixture', model: 'fx-mini', system: 'be terse', maxTokens: 128, temperature: 0.2 })
    const messages = adapter.lastOptions?.messages as Array<Record<string, unknown>>
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ role: 'user', source: { kind: 'user' } })
    expect(messages[1]).toMatchObject({ role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fx-mini' } })
    expect(messages[2]).toMatchObject({ role: 'user', source: { kind: 'tool', callId: 'call-1' } })
    expect((messages[2]?.content as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'tool-result', toolCallId: 'call-1' })
  })

  it('surfaces adapter failures as Pi error events, never fabricated completions', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    class FailingAdapter extends LlmAdapter {
      override providerInfo(provider: string) { return { id: provider, name: provider } }
      override async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom from provider', code: 'TEST' } } }
      }
    }
    ;(ctx as unknown as { llm: { registerAdapter(providers: string[], adapter: unknown): unknown } })
      .llm.registerAdapter(['failing'], new FailingAdapter())
    const stream = streamViaDshLlm(llmOf(ctx)!, {
      model: { id: 'x', provider: 'failing' },
      context: { messages: [{ role: 'user', content: 'hi' }] },
    })
    const events: Array<Record<string, unknown>> = []
    for await (const event of stream as AsyncIterable<Record<string, unknown>>) events.push(event)
    const last = events.at(-1) as { type: string, error: Error }
    expect(last.type).toBe('error')
    expect(String(last.error.message)).toContain('boom from provider')
  })

  it('keeps Pi image inputs explicit instead of silently dropping them', () => {
    const { messages } = piRequestToDshMessages({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', mimeType: 'image/png', data: 'zzz' }] }],
    })
    const blocks = messages[0]?.content as Array<Record<string, unknown>>
    expect(blocks).toHaveLength(2)
    expect(String(blocks[1]?.text)).toContain('image omitted by pi2dsh')
  })

  it('degrades to the empty catalog without a mounted llm service', async () => {
    const bare = new Context()
    expect(llmOf(bare)).toBeUndefined()
    const catalog = new ModelCatalog(undefined)
    await catalog.refresh()
    expect(catalog.all()).toEqual([])
    expect(catalog.find('any', 'thing')).toBeUndefined()
    expect(await catalog.resolve('any', 'thing')).toBeUndefined()
  })
})
