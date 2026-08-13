import { describe, expect, it } from 'vitest'
import { StringEnum } from '../src/compat/pi-ai.js'
import {
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
  decodeKittyPrintable,
  Editor,
  fuzzyFilter,
  Key,
  matchesKey,
  Spacer,
  Text,
  truncateToWidth,
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

  it('loads plain-text TUI components without pretending to provide interactivity', () => {
    const container = new Container()
    const text = new Text('abcdef', 0, 1)
    text.setText('abcdef')
    text.invalidate()
    container.addChild(text)
    container.addChild(new Spacer(2))
    container.invalidate()
    container.removeChild(text)
    container.addChild(text)
    expect(container.render(3)).toEqual(['', '', '', 'abc', ''])
    container.clear()
    container.addChild(new Text('abcdef', 0, 0))
    expect(container.render(3)).toEqual(['abc'])
    const editor = new Editor('old')
    editor.setText('new')
    editor.handleInput('ignored')
    expect(editor.getText()).toBe('new')
    expect(truncateToWidth('abcd', 2)).toBe('ab')
    expect(truncateToWidth('abcd', 0)).toBe('')
    expect(wrapTextWithAnsi('abcde', 2)).toEqual(['ab', 'cd', 'e'])
    expect(wrapTextWithAnsi('', 2)).toEqual([''])
    expect(wrapTextWithAnsi('x', 0)).toEqual([''])
    expect(Key.ctrl('k')).toBe('ctrl+k')
    expect(Key.shift('tab')).toBe('shift+tab')
    expect(Key.alt('x')).toBe('alt+x')
    expect(Key.ctrlShiftAlt('x')).toBe('ctrl+shift+alt+x')
    expect(Key.pageUp).toBe('pageUp')
    expect(matchesKey('x', 'x')).toBe(true)
    expect(matchesKey('x', ['a', 'x'])).toBe(true)
    expect(decodeKittyPrintable('x')).toBe('x')
    expect(fuzzyFilter(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('builds provider-neutral flat string enums without loading Pi provider SDKs', () => {
    expect(StringEnum(['small', 'large'] as const, { description: 'Size', default: 'small' })).toEqual({
      type: 'string',
      enum: ['small', 'large'],
      description: 'Size',
      default: 'small',
    })
  })
})
