import { describe, expect, it } from 'vitest'
import { StringEnum } from '../src/compat/pi-ai.js'
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
