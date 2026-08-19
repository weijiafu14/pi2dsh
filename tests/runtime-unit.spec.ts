import { describe, expect, it } from 'vitest'
import { normalizeToolSchema, runtimeInternals } from '../src/runtime.js'

describe('compatibility runtime primitives', () => {
  it('selects only the verified tool from the known image package', () => {
    expect(runtimeInternals.isKnownImageTool('@crazygit/pi-codex-image-gen', 'codex_generate_image')).toBe(true)
    expect(runtimeInternals.isKnownImageTool('@crazygit/pi-codex-image-gen', 'read')).toBe(false)
    expect(runtimeInternals.isKnownImageTool('some-other-package', 'codex_generate_image')).toBe(false)
  })

  it('normalizes the supported JSON Schema subset and reports dropped constraints', () => {
    const result = normalizeToolSchema({
      type: 'object',
      properties: {
        value: { type: 'string', minLength: 2 },
        choice: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
      required: ['value'],
      additionalProperties: false,
    })
    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        value: { type: 'string' },
        choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
      required: ['value'],
      additionalProperties: false,
    })
    expect(result.warnings.join('\n')).toContain('minLength')
    expect(result.warnings.join('\n')).toContain('anyOf')
  })

  it('rejects non-object tool parameter roots', () => {
    expect(() => normalizeToolSchema({ type: 'string' })).toThrow('object-root')
  })

  it('widens unsupported schema shapes explicitly while retaining safe annotations', () => {
    const result = normalizeToolSchema({
      type: 'object',
      properties: {
        invalid: { type: ['string', 'null'] },
        malformed: null,
        list: { type: 'array', items: { type: 'integer', const: 2, enum: [1, 2, {}, null] } },
      },
      additionalProperties: { type: 'string' },
      title: 'Fixture',
      description: 'Fixture schema',
      default: { list: [2] },
      examples: [{ list: [1] }],
    })
    expect(result.schema).toMatchObject({
      type: 'object',
      properties: {
        invalid: {},
        malformed: {},
        list: { type: 'array', items: { type: 'integer', const: 2, enum: [1, 2, null] } },
      },
      additionalProperties: true,
      title: 'Fixture',
      description: 'Fixture schema',
      default: { list: [2] },
      examples: [{ list: [1] }],
    })
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported type'),
      expect.stringContaining('non-object schema'),
      expect.stringContaining('widened to true'),
    ]))
  })

  it('expands Pi prompt arguments, quoted values, defaults, and slices', () => {
    const text = [
      '---',
      'description: fixture',
      '---',
      '$1|$2|$@|${3:-fallback}|${@:2:2}',
    ].join('\n')
    expect(runtimeInternals.expandPrompt(text, 'alpha "two words"'))
      .toBe('alpha|two words|alpha two words|fallback|two words')
  })

  it('matches Pi prompt frontmatter trimming, line-ending normalization, and literal argument substitution', () => {
    const text = '---\r\ndescription: fixture\r\n---\r\n\r\n  $1 $2  \r\n'
    expect(runtimeInternals.expandPrompt(text, "'$@' '$1'"))
      .toBe('$@ $1')
    expect(runtimeInternals.expandPrompt('  $1  \r\n', 'value'))
      .toBe('  value  \n')
  })

  it('degrades Pi image tool output explicitly instead of leaking base64 into DSH text', () => {
    expect(runtimeInternals.normalizeToolResult({
      content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
      details: { ok: true },
    })).toEqual({
      content: [{ type: 'text', text: '[Pi tool returned image/png; binary image output requires a native DSH attachment adapter]' }],
      details: { ok: true },
    })
  })

  it('preserves Pi tool error state across the DSH INOUT boundary', () => {
    expect(runtimeInternals.normalizeToolResult({
      content: [{ type: 'text', text: 'failed safely' }],
      isError: true,
    })).toEqual({
      content: [{ type: 'text', text: 'failed safely' }],
      details: null,
      isError: true,
    })
  })

  it('normalizes primitive, circular, and control-bearing Pi tool results without leaking objects', () => {
    expect(runtimeInternals.normalizeToolResult('plain')).toEqual({
      content: [{ type: 'text', text: 'plain' }],
      details: null,
    })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(runtimeInternals.normalizeToolResult({
      content: null,
      details: circular,
      usage: { tokens: 2 },
      terminate: true,
    })).toEqual({
      content: [{ type: 'text', text: '' }],
      details: '[object Object]',
      usage: { tokens: 2 },
      terminate: true,
    })
    expect(runtimeInternals.textBlocks([
      { type: 'text', text: 3 },
      { type: 'unknown', value: 1 },
      'literal',
    ])).toEqual([
      { type: 'text', text: '3' },
      { type: 'text', text: '[object Object]' },
      { type: 'text', text: 'literal' },
    ])
  })
})

describe('choosing a provider to log in to', () => {
  const offered = ['openai-codex', 'anthropic', 'github-copilot', 'kimi-coding', 'litellm']
  const { resolveOfferedChoice } = runtimeInternals as unknown as {
    resolveOfferedChoice(answer: string, offered: readonly string[]): string | undefined
  }

  it('takes the name the picker offered', () => {
    expect(resolveOfferedChoice('litellm', offered)).toBe('litellm')
  })

  it('takes the row number a person reads off the dialog', () => {
    // The picker also has a free-text box, and "1" is what someone types when
    // the screen shows "1  openai-codex". Passing that through as a provider
    // name produced `unknown OAuth provider "1"` on a real login attempt.
    expect(resolveOfferedChoice('1', offered)).toBe('openai-codex')
    expect(resolveOfferedChoice('5', offered)).toBe('litellm')
  })

  it('takes a differently-cased name', () => {
    expect(resolveOfferedChoice('LiteLLM', offered)).toBe('litellm')
  })

  it('refuses a position outside the list and anything unrecognised', () => {
    // Still fails loud: the caller reports the answer with the full list.
    expect(resolveOfferedChoice('0', offered)).toBeUndefined()
    expect(resolveOfferedChoice('6', offered)).toBeUndefined()
    expect(resolveOfferedChoice('no-such-gateway', offered)).toBeUndefined()
  })
})

describe('only one login may be in flight', () => {
  const { supersedeActiveLogin } = runtimeInternals as unknown as {
    supersedeActiveLogin(state: { shared: { activeLogin?: unknown } }): Promise<string | undefined>
  }

  /** A state holding one in-flight login, with the flow's own resolve exposed. */
  function inFlight(name: string, published: string[] = []) {
    let release = (): void => {}
    const finished = new Promise<void>(resolve => { release = resolve })
    const controller = new AbortController()
    const state = { shared: { activeLogin: { providerName: name, controller, finished, published } } }
    // A flow that ends when cancelled, as a real one does (its ui question is
    // aborted, the flow throws, loginPiProvider's finally runs).
    controller.signal.addEventListener('abort', () => { release() }, { once: true })
    return { state, controller }
  }

  it('does nothing when no login is running', async () => {
    const state = { shared: {} }
    expect(await supersedeActiveLogin(state)).toBeUndefined()
  })

  it('cancels the running login and waits for it to release the callback port', async () => {
    // Interactive flows bind a FIXED local port (codex: 1455). Pi's flow, on
    // finding it taken, silently degrades to a listener that never receives a
    // code — so the second login hands the user an address whose callback
    // lands on the FIRST flow's listener and is rejected as a state mismatch,
    // with both dialogs left waiting. Starting the new flow is only safe once
    // the old one has actually let go.
    const { state, controller } = inFlight('OpenAI Codex')
    expect(await supersedeActiveLogin(state)).toBe('OpenAI Codex')
    expect(controller.signal.aborted).toBe(true)
    expect(state.shared.activeLogin).toBeUndefined()
  })

  it('refuses to start a new flow when the old one will not let go', async () => {
    // A flow that ignores its cancellation still owns the port. Reporting that
    // beats starting a login whose callback would silently go nowhere.
    const finished = new Promise<void>(() => {})
    const state = {
      shared: {
        activeLogin: {
          providerName: 'OpenAI Codex',
          controller: new AbortController(),
          finished,
          published: [],
        },
      },
    }
    await expect(supersedeActiveLogin(state)).rejects.toThrow(/still shutting down/u)
  }, 10_000)

})
