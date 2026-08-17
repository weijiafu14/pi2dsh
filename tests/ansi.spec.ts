// SGR parsing for the browser half.
//
// The sample in the first test is not invented: it is what `pi-powerline-footer`
// (a real npm package) put into a widget on a real DSH web instance, where it
// rendered as literal escape text until this existed.
import { describe, expect, it } from 'vitest'
import { ansi256, hasAnsi, parseAnsi } from '../src/ansi.js'

const ESC = ''

describe('ANSI in what real packages draw', () => {
  it('parses the powerline footer a real package produced', () => {
    const sample = `${ESC}[38;2;215;135;175m DeepSeek-V4-Flash${ESC}[0m ${ESC}[38;5;244m|${ESC}[0m think:off`
    const runs = parseAnsi(sample)

    expect(runs.map(run => run.text).join('')).toBe(' DeepSeek-V4-Flash | think:off')
    // Truecolor and 256-colour in one line, which is what powerline prompts do.
    expect(runs[0]).toEqual({ text: ' DeepSeek-V4-Flash', style: { color: 'rgb(215, 135, 175)' } })
    expect(runs.find(run => run.text === '|')?.style.color).toBe('rgb(128, 128, 128)')
    // After a reset the run carries no styling at all.
    expect(runs.at(-1)).toEqual({ text: ' think:off', style: {} })
  })

  it('leaves text without escapes as one plain run', () => {
    expect(hasAnsi('plain status')).toBe(false)
    expect(parseAnsi('plain status')).toEqual([{ text: 'plain status', style: {} }])
  })

  it('drops the escapes themselves rather than printing them', () => {
    // The defect this fixes: an unparsed escape is not invisible, it is visible
    // garbage. Nothing in the output may contain the escape character.
    const runs = parseAnsi(`${ESC}[1m${ESC}[31mred bold${ESC}[0m done`)
    expect(runs.map(run => run.text).join('')).toBe('red bold done')
    expect(runs.some(run => run.text.includes(ESC))).toBe(false)
    expect(runs[0]?.style).toEqual({ fontWeight: 'bold', color: '#cd3131' })
  })

  it('handles the base, bright, background and attribute codes', () => {
    expect(parseAnsi(`${ESC}[92mbright`)[0]?.style).toEqual({ color: '#23d18b' })
    expect(parseAnsi(`${ESC}[44mon blue`)[0]?.style).toEqual({ backgroundColor: '#2472c8' })
    expect(parseAnsi(`${ESC}[2mdim`)[0]?.style).toEqual({ opacity: '0.7' })
    expect(parseAnsi(`${ESC}[3;4mfancy`)[0]?.style).toEqual({ fontStyle: 'italic', textDecoration: 'underline' })
  })

  it('clears one channel without clearing the other', () => {
    // 39/49 are default-foreground / default-background, not a full reset.
    const runs = parseAnsi(`${ESC}[31m${ESC}[44mboth${ESC}[39mbackground only`)
    expect(runs[0]?.style).toEqual({ color: '#cd3131', backgroundColor: '#2472c8' })
    expect(runs[1]?.style).toEqual({ backgroundColor: '#2472c8' })
  })

  it('treats a bare ESC[m as a reset', () => {
    const runs = parseAnsi(`${ESC}[31mred${ESC}[mplain`)
    expect(runs[1]).toEqual({ text: 'plain', style: {} })
  })

  it('ignores a truncated extended-colour sequence instead of mangling the rest', () => {
    // `38;5` with no index: not enough to name a colour, and the text after it
    // still has to come through.
    const runs = parseAnsi(`${ESC}[38;5mtext`)
    expect(runs.map(run => run.text).join('')).toBe('text')
  })

  it('resolves the 256-colour palette by region', () => {
    expect(ansi256(1)).toBe('#cd3131')
    expect(ansi256(9)).toBe('#f14c4c')
    // Cube corner: index 231 is white (5,5,5).
    expect(ansi256(231)).toBe('rgb(255, 255, 255)')
    // Greyscale ramp.
    expect(ansi256(232)).toBe('rgb(8, 8, 8)')
    expect(ansi256(255)).toBe('rgb(238, 238, 238)')
  })
})
