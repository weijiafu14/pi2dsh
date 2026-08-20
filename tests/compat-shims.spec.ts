import { describe, expect, it } from 'vitest'
import { streamSimpleOpenAIResponses, StringEnum } from '../src/compat/pi-ai.js'
import {
  createExtensionRuntime,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  formatSize,
  getAgentDir,
  getMarkdownTheme,
  truncateHead,
} from '../src/compat/pi-coding-agent.js'
import {
  Container,
  CURSOR_MARKER,
  decodeKittyPrintable,
  Editor,
  fuzzyFilter,
  Key,
  matchesKey,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '../src/compat/pi-tui.js'

describe('dependency-light Pi host shims', () => {
  it('preserves defineTool identity and bounded head truncation', () => {
    const tool = { name: 'fixture' }
    expect(defineTool(tool)).toBe(tool)
    expect(DEFAULT_MAX_LINES).toBe(2000)
    expect(DEFAULT_MAX_BYTES).toBe(50 * 1024)
    expect(formatSize(1536)).toBe('1.5KB')
    expect(formatSize(20)).toBe('20B')
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0MB')
    expect(getAgentDir()).toContain('pi2dsh/agent')
    const previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = '/fixture/pi-agent'
    expect(getAgentDir()).toBe('/fixture/pi-agent')
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    expect(truncateHead('one\ntwo\nthree', { maxLines: 2, maxBytes: 100 })).toMatchObject({
      content: 'one\ntwo',
      truncated: true,
      truncatedBy: 'lines',
      totalLines: 3,
      outputLines: 2,
    })
    expect(truncateHead('oversized', { maxLines: 10, maxBytes: 3 })).toMatchObject({
      content: '',
      truncated: true,
      truncatedBy: 'bytes',
      firstLineExceedsLimit: true,
    })
    expect(truncateHead('short')).toMatchObject({ content: 'short', truncated: false })
    expect(truncateHead('one\ntoolong\nthree', { maxLines: 10, maxBytes: 5 })).toMatchObject({
      content: 'one',
      truncatedBy: 'bytes',
    })
    const theme = getMarkdownTheme()
    expect((theme.heading as (text: string) => string)('title')).toBe('title')
    expect((theme.highlightCode as (text: string) => string[])('a\nb')).toEqual(['a', 'b'])
  })

  it('loads plain-text TUI components and preserves vendored Pi text/key semantics', () => {
    const container = new Container()
    const text = new Text('abcdef', 0, 1)
    text.setText('abcdef')
    text.invalidate()
    container.addChild(text)
    container.addChild(new Spacer(2))
    container.invalidate()
    container.removeChild(text)
    container.addChild(text)
    expect(container.render(3)).toEqual(['', '', '', 'abc', 'def', ''])
    container.clear()
    container.addChild(new Text('abcdef', 0, 0))
    expect(container.render(3)).toEqual(['abc', 'def'])
    const editor = new Editor()
    editor.setText('new')
    expect(editor.getText()).toBe('new')
    editor.handleInput('!')
    expect(editor.getText()).toBe('new!')
    // Vendored Pi truncation appends the ellipsis and resets ANSI state.
    expect(truncateToWidth('abcd', 2, '')).toBe('ab\x1b[0m')
    expect(truncateToWidth('abcd', 0)).toBe('')
    expect(wrapTextWithAnsi('abcde', 2)).toEqual(['ab', 'cd', 'e'])
    expect(wrapTextWithAnsi('', 2)).toEqual([''])
    // Pi's Key map is a constant table of key names; combos are literal KeyIds.
    expect(Key.pageUp).toBe('pageUp')
    expect(Key.escape).toBe('escape')
    expect(matchesKey('x', 'x')).toBe(true)
    expect(matchesKey('\x0b', 'ctrl+k')).toBe(true)
    expect(decodeKittyPrintable('x')).toBeUndefined()
    expect(fuzzyFilter([{ name: 'alpha' }, { name: 'beta' }], 'al', item => item.name)).toEqual([{ name: 'alpha' }])
    expect(fuzzyFilter([{ name: 'alpha' }, { name: 'beta' }], '', item => item.name)).toHaveLength(2)
  })

  it('measures terminal width with Pi fidelity: CJK, ANSI, and the cursor marker', () => {
    expect(visibleWidth('中文a')).toBe(5)
    expect(visibleWidth('\x1b[31mred\x1b[0m')).toBe(3)
    expect(visibleWidth(CURSOR_MARKER)).toBe(0)
    expect(visibleWidth('naïve')).toBe(5)
  })

  it('builds provider-neutral flat string enums without loading Pi provider SDKs', () => {
    expect(StringEnum(['small', 'large'] as const, { description: 'Size', default: 'small' })).toEqual({
      type: 'string',
      enum: ['small', 'large'],
      description: 'Size',
      default: 'small',
    })
  })

  it('exports the real Responses simple transport under the legacy provider-package name', () => {
    // pi-grok imports this historical root symbol. Pi 0.84 names the same
    // implementation `streamSimple` on the protocol subpath; the host shim
    // keeps the package-facing ABI stable.
    expect(streamSimpleOpenAIResponses).toBeTypeOf('function')
  })

  // Extensions that assemble their own ResourceLoader-shaped getExtensions()
  // result (pi-btw's BTW overlay) call createExtensionRuntime(); an absent
  // export threw "createExtensionRuntime is not a function" at command time.
  describe('createExtensionRuntime (pre-bind extension runtime)', () => {
    it('returns a runtime with Pi\'s pre-bind state shape', () => {
      const runtime = createExtensionRuntime()
      expect(runtime.flagValues).toBeInstanceOf(Map)
      expect(runtime.pendingProviderRegistrations).toEqual([])
      expect(runtime.pendingNativeProviderRegistrations).toEqual([])
    })

    it('queues provider registrations pre-bind and drops them on unregister', () => {
      const runtime = createExtensionRuntime()
      ;(runtime.registerProvider as (n: string, c: unknown, p?: string) => void)('acme', { baseUrl: 'x' }, '/ext')
      expect(runtime.pendingProviderRegistrations).toEqual([{ name: 'acme', config: { baseUrl: 'x' }, extensionPath: '/ext' }])
      ;(runtime.unregisterProvider as (n: string) => void)('acme')
      expect(runtime.pendingProviderRegistrations).toEqual([])
    })

    it('throws from action methods until the host runner binds real implementations', () => {
      const runtime = createExtensionRuntime()
      expect(() => (runtime.sendMessage as () => void)()).toThrowError(/not initialized/u)
      expect(() => (runtime.getActiveTools as () => void)()).toThrowError(/not initialized/u)
    })

    it('untracks an event-bus subscription on invalidate', () => {
      const runtime = createExtensionRuntime()
      let unsubscribed = false
      ;(runtime.trackEventBusSubscription as (u: () => void) => void)(() => { unsubscribed = true })
      ;(runtime.invalidate as (m?: string) => void)('session replaced')
      expect(unsubscribed).toBe(true)
      expect(() => (runtime.assertActive as () => void)()).toThrowError(/session replaced/u)
    })
  })
})

// Four surfaces whose hand-written stand-ins diverged from Pi in ways a
// package cannot detect: a shell picked from $SHELL where Pi is bash-only,
// head-truncation where Pi keeps the tail, a diff renderer with a different
// signature, and an image encoder that returned its input unencoded. The
// first three now re-export the vendored Pi implementations; the fourth
// honours Pi's ResizedImage contract.
describe('Pi utility surfaces served by the vendored implementations', () => {
  it('resizeImage encodes to base64 and reports true dimensions, per Pi\'s contract', async () => {
    const { resizeImage } = await import('../src/compat/pi-coding-agent.js')
    // A 1x1 PNG: the smallest real header that carries dimensions.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const resized = await resizeImage(new Uint8Array(png), 'image/png')
    expect(resized).not.toBeNull()
    // Pi's field set, in full — a caller reads every one of these.
    expect(resized).toMatchObject({
      mimeType: 'image/png',
      originalWidth: 1,
      originalHeight: 1,
      width: 1,
      height: 1,
      // Honest: this bridge has no codec, so it never claims to have resized.
      wasResized: false,
    })
    // The payload must be base64 the caller can hand to a model, not raw bytes.
    expect(Buffer.from(resized!.data, 'base64').subarray(0, 4)).toEqual(png.subarray(0, 4))
  })

  it('resizeImage answers null rather than exceeding the caller\'s byte budget', async () => {
    const { resizeImage } = await import('../src/compat/pi-coding-agent.js')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    expect(await resizeImage(new Uint8Array(png), 'image/png', { maxBytes: 8 })).toBeNull()
    // An unsupported type is also a null, never a throw.
    expect(await resizeImage(new Uint8Array(png), 'image/tiff')).toBeNull()
  })

  it('convertToPng passes PNG through and answers null otherwise, as Pi does on failure', async () => {
    const { convertToPng } = await import('../src/compat/pi-coding-agent.js')
    expect(await convertToPng('AAAA', 'image/png')).toEqual({ data: 'AAAA', mimeType: 'image/png' })
    expect(await convertToPng('AAAA', 'image/jpeg')).toBeNull()
  })

  it('getShellConfig is bash-only on unix, as Pi is — never the user\'s $SHELL', async () => {
    const { getShellConfig } = await import('../src/compat/pi-coding-agent.js')
    const config = getShellConfig()
    if (process.platform === 'win32') {
      expect(config.shell.toLowerCase()).toContain('cmd')
    } else {
      // The bug this pins: a zsh login shell must not end up running bash
      // command strings written by Pi packages.
      expect(config.shell).not.toContain('zsh')
      expect(config.shell).toMatch(/bash|sh$/u)
    }
  })

  it('truncateToVisualLines keeps the TAIL, which is what a log preview needs', async () => {
    const { truncateToVisualLines } = await import('../src/compat/pi-coding-agent.js')
    const text = ['first', 'second', 'third', 'fourth', 'LAST'].join('\n')
    const result = truncateToVisualLines(text, 2, 80)
    // Showing the head of a build log shows the banner, not the failure.
    expect(result.visualLines).toContain('LAST')
    expect(result.visualLines).not.toContain('first')
  })

  it('renderDiff takes Pi\'s single diff-text argument and returns a string', async () => {
    const { renderDiff } = await import('../src/compat/pi-coding-agent.js')
    const rendered = renderDiff('--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n', {})
    expect(typeof rendered).toBe('string')
    expect(rendered).toContain('new')
  })
})
