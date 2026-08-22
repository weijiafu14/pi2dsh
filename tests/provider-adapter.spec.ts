// Provider adapter contracts: a Pi package's provider (its OWN transport)
// serves a real DSH llm route through the public registerAdapter seam — the
// loop-facing half of "model division of labor". Verified against a real
// LlmRuntime, full round trip: DSH GenerateOptions → Pi request context →
// the package's stream events → DSH chunks.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { registerPiProviderRoute } from '../src/provider-adapter.js'
import { dshRequestToPiContext, piEventsToDshChunks } from '../src/model-bridge.js'

type UnknownRecord = Record<string, unknown>

/**
 * A Pi provider fixture. Real Pi providers carry BOTH entry points — the
 * portable `streamSimple` and the per-API `stream` — so the fixture does too,
 * and records which one the bridge chose. `legacy: true` drops `streamSimple`
 * to stand in for a package that hand-rolls a provider object.
 */
function piFixtureProvider(options: { legacy?: boolean, model?: UnknownRecord } = {}) {
  const calls: Array<{ entry: 'streamSimple' | 'stream', model: UnknownRecord, context: UnknownRecord, options: UnknownRecord }> = []
  const model = options.model ?? { id: 'pifix-1', name: 'Pi Fixture One', provider: 'pifix', contextWindow: 32000 }
  async function* run(entry: 'streamSimple' | 'stream', m: UnknownRecord, context: UnknownRecord, opts: UnknownRecord): AsyncIterable<UnknownRecord> {
    calls.push({ entry, model: m, context, options: opts })
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
  }
  const provider: UnknownRecord = {
    id: 'pifix',
    name: 'Pi Fixture Gateway',
    getModels: () => [model],
    stream: (m: UnknownRecord, c: UnknownRecord, o: UnknownRecord) => run('stream', m, c, o),
  }
  if (options.legacy !== true) {
    provider.streamSimple = (m: UnknownRecord, c: UnknownRecord, o: UnknownRecord) => run('streamSimple', m, c, o)
  }
  return { provider, calls }
}

/** Drive one request through a registered route and hand back what the provider saw. */
async function requestThrough(
  fixture: ReturnType<typeof piFixtureProvider>,
  request: UnknownRecord = {},
): Promise<{ options: UnknownRecord, entry: string, warnings: string[] }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime as never, {} as never)
  const llm = (ctx as unknown as { llm: { stream(o: UnknownRecord): AsyncIterable<UnknownRecord> } }).llm
  const warnings: string[] = []
  registerPiProviderRoute({
    llm: llm as never,
    providerId: 'pifix',
    provider: fixture.provider as never,
    host: { resolveAuth: async () => undefined, warn: message => warnings.push(message) },
  })
  for await (const _ of llm.stream({
    provider: 'pifix',
    model: 'pifix-1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }],
    ...request,
  })) { /* drained: the assertions are on what the provider was handed */ }
  const call = fixture.calls[0]
  return { options: call?.options ?? {}, entry: call?.entry ?? 'none', warnings }
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

  it('waits for dynamic discovery when first use names a model absent at startup', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as { llm: { stream(o: UnknownRecord): AsyncIterable<UnknownRecord> } }).llm
    const models: UnknownRecord[] = []
    const seen: UnknownRecord[] = []
    let discoveries = 0
    const provider = {
      id: 'dynamic',
      getModels: () => models,
      async *streamSimple(model: UnknownRecord): AsyncIterable<UnknownRecord> {
        seen.push(model)
        yield { type: 'start', partial: {} }
        yield { type: 'done', reason: 'stop', message: { role: 'assistant', content: [] } }
      },
    }
    registerPiProviderRoute({
      llm: llm as never,
      providerId: 'dynamic',
      provider,
      host: {
        resolveAuth: async () => ({ auth: {} }),
        ensureModel: async id => {
          discoveries += 1
          models.push({ id, provider: 'dynamic', api: 'openai-completions', baseUrl: 'https://dynamic.example/v1' })
        },
        warn: () => {},
      },
    })

    for await (const _chunk of llm.stream({
      provider: 'dynamic',
      model: 'late-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) { /* drain */ }

    expect(discoveries).toBe(1)
    expect(seen).toEqual([expect.objectContaining({
      id: 'late-model',
      api: 'openai-completions',
      baseUrl: 'https://dynamic.example/v1',
    })])
  })

  it('hands a package-owned transport the real pre-fetch payload waterfall', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as { llm: { stream(o: UnknownRecord): AsyncIterable<UnknownRecord> } }).llm
    const seen: UnknownRecord[] = []
    const provider: UnknownRecord = {
      id: 'payload-fixture',
      name: 'Payload Fixture',
      models: [{ id: 'payload-1', name: 'Payload One', provider: 'payload-fixture' }],
      async *streamSimple(_model: UnknownRecord, _context: UnknownRecord, options: UnknownRecord) {
        const onPayload = options.onPayload as ((payload: UnknownRecord) => Promise<UnknownRecord>) | undefined
        seen.push(await onPayload!({ model: 'payload-1', input: 'before' }))
        yield { type: 'start', partial: {} }
        yield { type: 'text_start', contentIndex: 0 }
        yield { type: 'text_delta', contentIndex: 0, delta: 'ok' }
        yield { type: 'text_end', contentIndex: 0, content: 'ok' }
        yield {
          type: 'done', reason: 'stop',
          message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: {}, stopReason: 'stop' },
        }
      },
    }
    const hookCalls: UnknownRecord[] = []
    registerPiProviderRoute({
      llm: llm as never,
      providerId: 'payload-fixture',
      provider: provider as never,
      host: {
        resolveAuth: async () => ({ auth: { apiKey: 'fixture-key' } }),
        warn: () => {},
        async beforeProviderRequest(payload, request) {
          hookCalls.push({ payload, request })
          return { ...payload, sanitized: true }
        },
      },
    })
    for await (const _ of llm.stream({
      provider: 'payload-fixture',
      model: 'payload-1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }],
    })) { /* drain */ }

    expect(seen).toEqual([{ model: 'payload-1', input: 'before', sanitized: true }])
    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0]).toMatchObject({
      payload: { model: 'payload-1', input: 'before' },
      request: { provider: 'payload-fixture', model: { id: 'payload-1' } },
    })
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

  // A route only accepts an effort its resolved model declares, so these carry
  // a reasoning model — which doubles as proof the effort projection reaches
  // DSH's own validation rather than merely being emitted.
  const reasoningModel = { id: 'pifix-1', name: 'Pi Fixture One', provider: 'pifix', contextWindow: 32000, reasoning: true }

  it('prefers the portable entry point, where a reasoning level reaches every API', async () => {
    const seen = await requestThrough(piFixtureProvider({ model: reasoningModel }), { reasoningEffort: 'high' })
    expect(seen.entry).toBe('streamSimple')
    // `reasoningEffort` is an option only the two OpenAI-family APIs read; the
    // portable name is what an anthropic or google route would also honour.
    expect(seen.options).toMatchObject({ reasoning: 'high' })
    expect(seen.options).not.toHaveProperty('reasoningEffort')
  })

  it('sends the "off" effort as absence, never as the string', async () => {
    // Pi lists `off` for every reasoning model, so it is a level the user can
    // actually pick — and the string is truthy on the OpenAI-compatible path,
    // which would switch thinking ON for the choice that means switch it off.
    const seen = await requestThrough(piFixtureProvider({ model: reasoningModel }), { reasoningEffort: 'off' })
    expect(seen.options).not.toHaveProperty('reasoning')
    expect(seen.options).not.toHaveProperty('reasoningEffort')
  })

  it('falls back to the per-API entry point for a provider that hand-rolls one', async () => {
    const seen = await requestThrough(piFixtureProvider({ legacy: true, model: reasoningModel }), { reasoningEffort: 'low' })
    expect(seen.entry).toBe('stream')
    // That entry point takes per-API options, so the level is spelled its way.
    expect(seen.options).toMatchObject({ reasoningEffort: 'low' })
    expect(seen.options).not.toHaveProperty('reasoning')

    const off = await requestThrough(piFixtureProvider({ legacy: true, model: reasoningModel }), { reasoningEffort: 'off' })
    expect(off.options).not.toHaveProperty('reasoningEffort')
  })

  // A Pi provider is reached through the DSH llm seam, where image bytes live
  // in the attachment service and the block carries only a reference. The
  // conversion had no image branch at all, so the block vanished and the model
  // was asked about a picture it never received.
  const imageRequest = {
    messages: [{
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 } },
      ],
    }],
  }
  const PIXEL = 'iVBORw0KGgo='

  it('reads an image through the attachment service into the block Pi expects', async () => {
    const fixture = piFixtureProvider({
      model: { id: 'pifix-1', name: 'Pi Fixture One', provider: 'pifix', contextWindow: 32000, input: ['text', 'image'] },
    })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as { llm: { stream(o: UnknownRecord): AsyncIterable<UnknownRecord> } }).llm
    registerPiProviderRoute({
      llm: llm as never,
      providerId: 'pifix',
      provider: fixture.provider as never,
      host: {
        resolveAuth: async () => undefined,
        warn: () => {},
        resolveAttachments: () => ({ readImage: async () => ({ data: Buffer.from(PIXEL, 'base64'), ref: { mediaType: 'image/png' } }) }),
      },
    })
    for await (const _ of llm.stream({ provider: 'pifix', model: 'pifix-1', ...imageRequest })) { /* drained */ }
    const sent = (fixture.calls[0]?.context.messages as UnknownRecord[])[0]
    expect(sent?.content).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image', data: PIXEL, mimeType: 'image/png' },
    ])
  })

  it('never silently drops an image: the bridge refuses, or the host explicitly degrades', async () => {
    // The invariant across host generations is "the model is never asked
    // about a picture it silently did not receive". Who upholds it moved:
    // on 0.1.0-rc.8 dispatch reaches the adapter untouched and the BRIDGE
    // refuses with UNSUPPORTED_CONTENT before the provider is asked; on the
    // 0.1.1 line (detectable by the LlmAdapter base class gaining
    // prepareCall) the HOST's dispatch resolves the modality mismatch first,
    // replacing the image block with an explicit "[image omitted …]" notice
    // — a visible degradation, not a silent drop, so the host policy wins.
    const hostResolvesModalities = typeof (LlmAdapter as unknown as { prototype?: { prepareCall?: unknown } }).prototype?.prepareCall === 'function'
    const run = async (model: UnknownRecord): Promise<{ last: UnknownRecord | undefined; calls: Array<{ context: UnknownRecord }> }> => {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime as never, {} as never)
      const llm = (ctx as unknown as { llm: { stream(o: UnknownRecord): AsyncIterable<UnknownRecord> } }).llm
      const fixture = piFixtureProvider({ model })
      registerPiProviderRoute({
        llm: llm as never,
        providerId: 'pifix',
        provider: fixture.provider as never,
        host: { resolveAuth: async () => undefined, warn: () => {} },
      })
      const chunks: UnknownRecord[] = []
      for await (const chunk of llm.stream({ provider: 'pifix', model: 'pifix-1', ...imageRequest })) chunks.push(chunk)
      return { last: chunks.at(-1), calls: fixture.calls as never }
    }

    // A model that never declared image input…
    const textOnly = await run({ id: 'pifix-1', provider: 'pifix', contextWindow: 32000, input: ['text'] })
    if (hostResolvesModalities) {
      // …reaches the provider WITH an explicit omission notice in place of
      // the image — visible degradation, never a silent drop.
      expect(textOnly.calls).toHaveLength(1)
      const sent = (textOnly.calls[0]?.context.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0]
      expect(sent?.content.some(block => block.type === 'text' && block.text?.includes('[image omitted') === true)).toBe(true)
      expect(textOnly.last).toMatchObject({ reason: { kind: 'stop' } })
    } else {
      // …is refused by the bridge before the provider is asked anything.
      expect(textOnly.calls).toHaveLength(0)
      expect(textOnly.last)
        .toMatchObject({ reason: { kind: 'error', failure: { code: 'UNSUPPORTED_CONTENT', message: /image input/ } } })
    }

    // A vision model with no attachment service to read the bytes from is
    // refused by the bridge on every generation — the host keeps the image
    // block for a capable model, and the bytes are simply unreachable.
    const vision = await run({ id: 'pifix-1', provider: 'pifix', contextWindow: 32000, input: ['text', 'image'] })
    expect(vision.calls).toHaveLength(0)
    expect(vision.last)
      .toMatchObject({ reason: { kind: 'error', failure: { code: 'UNSUPPORTED_CONTENT', message: /attachment service/ } } })
  })

  it('forwards the session identity Pi providers use for cache affinity and routing', async () => {
    const seen = await requestThrough(piFixtureProvider(), { sessionId: 'sess-1234' })
    expect(seen.options).toMatchObject({ sessionId: 'sess-1234' })
  })

  it('says so when a request carries stop sequences Pi cannot model', async () => {
    const seen = await requestThrough(piFixtureProvider(), { stop: ['\n\n'] })
    expect(seen.warnings.join('\n')).toContain('stop sequences')
    // Silence is the failure mode being prevented: the request still runs, but
    // the model will not halt on them and the operator is told exactly that.
    expect(seen.entry).toBe('streamSimple')
  })

  // Pi delivers a failure as a terminal EVENT whose payload is an
  // AssistantMessage — not a thrown Error, and not an Error object. Reading it
  // as one produced "[object Object]" as the user-facing failure text.
  const piErrorEvent = (errorMessage: string, extra: UnknownRecord = {}): UnknownRecord => ({
    type: 'error',
    reason: 'error',
    error: {
      role: 'assistant', content: [], model: 'fixture-model',
      stopReason: 'error', errorMessage,
      usage: { input: 12, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...extra,
    },
  })

  async function collect(events: AsyncIterable<UnknownRecord>, contextWindow?: number): Promise<UnknownRecord[]> {
    const chunks: UnknownRecord[] = []
    for await (const chunk of piEventsToDshChunks(events, contextWindow)) chunks.push(chunk)
    return chunks
  }

  it('reads the failure text off the assistant message Pi puts on its error event', async () => {
    async function* erroring(): AsyncIterable<UnknownRecord> {
      yield { type: 'text_start', contentIndex: 0 }
      yield piErrorEvent('gateway melted')
    }
    const chunks = await collect(erroring())
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'gateway melted' } },
    })
    // The usage the failed turn did consume is still reported, so a failure
    // does not silently drop tokens the user was billed for.
    expect(chunks.at(-2)).toMatchObject({ type: 'usage', usage: { inputTokens: 12 } })
  })

  // The whole point of classifying: four of these codes are in DSH's default
  // retryable set, so getting them wrong means a Pi provider's rate limit is
  // never retried. A bridge-invented code matches nothing.
  it.each([
    ['429 Too Many Requests', 'RATE_LIMIT'],
    ['503 upstream unavailable', 'SERVER'],
    ['request timed out after 60s', 'TIMEOUT'],
    ['terminated', 'TRANSPORT'],
    ['stream ended before message_stop', 'TRANSPORT'],
    ['401 Unauthorized', 'AUTH'],
  ])('classifies %j as %s so DSH retry policy can match it', async (text, code) => {
    async function* erroring(): AsyncIterable<UnknownRecord> { yield piErrorEvent(text) }
    const chunks = await collect(erroring())
    expect(chunks.at(-1)).toMatchObject({ reason: { failure: { code } } })
  })

  it('maps a provider overflow error and a silent overflow to the same harness code', async () => {
    async function* stated(): AsyncIterable<UnknownRecord> {
      yield piErrorEvent('prompt is too long: 213462 tokens > 200000 maximum')
    }
    expect((await collect(stated())).at(-1))
      .toMatchObject({ reason: { failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } })

    // The provider that accepts an oversized request and answers normally says
    // nothing to match on; only usage against the model's capacity shows it.
    async function* silent(): AsyncIterable<UnknownRecord> {
      yield { type: 'text_start', contentIndex: 0 }
      yield {
        type: 'done',
        message: {
          content: [{ type: 'text', text: 'hi' }], model: 'fixture-model', stopReason: 'stop',
          usage: { input: 900, output: 5, cacheRead: 200, cacheWrite: 0 },
        },
      }
    }
    expect((await collect(silent(), 1000)).at(-1))
      .toMatchObject({ reason: { failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } })
  })

  it('reports an aborted stream as aborted, not as an error', async () => {
    async function* aborted(): AsyncIterable<UnknownRecord> {
      yield {
        type: 'error',
        reason: 'aborted',
        error: { stopReason: 'aborted', content: [], usage: { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 } },
      }
    }
    expect((await collect(aborted())).at(-1)).toMatchObject({ reason: { kind: 'aborted' } })
  })

  it('refuses a stream that ended without a terminal event', async () => {
    async function* truncated(): AsyncIterable<UnknownRecord> {
      yield { type: 'text_start', contentIndex: 0 }
    }
    await expect(collect(truncated())).rejects.toMatchObject({ code: 'STREAM_CLOSED' })
  })

  it('carries the tool call identity Pi states only on the partial message', async () => {
    const partial = { content: [{ type: 'toolCall', id: 'call-7', name: 'read', arguments: {} }] }
    async function* calling(): AsyncIterable<UnknownRecord> {
      yield { type: 'toolcall_start', contentIndex: 0, partial }
      yield { type: 'toolcall_delta', contentIndex: 0, delta: '{"path"', partial }
      yield { type: 'toolcall_delta', contentIndex: 0, delta: ':"a.txt"}', partial }
      yield {
        type: 'done',
        message: { content: partial.content, stopReason: 'toolUse', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
      }
    }
    const deltas = (await collect(calling())).filter(chunk => chunk.type === 'tool-call-delta')
    expect(deltas).toHaveLength(2)
    // An empty id makes a delta unattributable to its call downstream.
    for (const delta of deltas) expect(delta).toMatchObject({ id: 'call-7', name: 'read' })
  })

  it('omits cache counts the provider reported as zero rather than as absent', async () => {
    async function* done(): AsyncIterable<UnknownRecord> {
      yield { type: 'text_start', contentIndex: 0 }
      yield {
        type: 'done',
        message: {
          content: [{ type: 'text', text: 'x' }], stopReason: 'stop',
          usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 7 },
        },
      }
    }
    const usage = (await collect(done())).find(chunk => chunk.type === 'usage')
    expect(usage).toEqual({ type: 'usage', usage: { inputTokens: 5, outputTokens: 2, cacheWriteTokens: 7 } })
  })

  it('names the tool a result belongs to, which DSH states only on the call', async () => {
    const context = await dshRequestToPiContext({
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', id: 'c9', name: 'bash', arguments: '{}' }] },
        {
          role: 'user',
          source: { kind: 'tool' },
          content: [{ toolCallId: 'c9', content: [{ type: 'text', text: 'ok' }], isError: false }],
        },
      ],
    })
    const messages = context.messages as UnknownRecord[]
    expect(messages.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: 'c9', toolName: 'bash' })
  })

  it('round-trips assistant tool-call history through the reverse conversion', async () => {
    const context = await dshRequestToPiContext({
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

  // A capability the catalog advertises but the resolve omits is worse than
  // one that is missing everywhere: the host consults the resolve before a
  // request, so the model silently degrades exactly when it is used.
  it('reports declared input modalities on BOTH the listing and the resolve', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime as never, {} as never)
    const llm = (ctx as unknown as {
      llm: {
        registerAdapter(providers: string[], adapter: unknown): () => void
        listModels(p: string): Promise<UnknownRecord[]>
        resolveModelInfo(p: string, m: string): Promise<UnknownRecord>
      }
    }).llm
    const provider = {
      id: 'modal',
      name: 'Modal Gateway',
      getModels: () => [
        { id: 'sees', provider: 'modal', input: ['text', 'image'] },
        { id: 'reads', provider: 'modal', input: ['text'] },
      ],
      async *stream(): AsyncIterable<UnknownRecord> { yield { type: 'done', reason: 'stop', message: {} } },
    }
    registerPiProviderRoute({
      llm,
      providerId: 'modal',
      provider: provider as never,
      host: { resolveAuth: async () => ({ auth: {} }), warn: () => {} },
    })

    const listed = await llm.listModels('modal')
    expect(listed.find(model => model.id === 'sees')).toMatchObject({ inputModalities: ['text', 'image'] })

    const resolvedVision = await llm.resolveModelInfo('modal', 'sees')
    expect(resolvedVision).toMatchObject({ inputModalities: ['text', 'image'] })
    const resolvedText = await llm.resolveModelInfo('modal', 'reads')
    expect(resolvedText).toMatchObject({ inputModalities: ['text'] })
  })
})
