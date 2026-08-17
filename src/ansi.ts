// SGR (ANSI colour) parsing, kept apart from the browser half so it can be
// tested without a DOM or React.
//
// Why this exists at all: Pi components draw for a terminal, and real packages
// put SGR codes straight into the strings they hand setWidget/setStatus — a
// powerline footer is nothing but colour. The first real plugin mounted in
// these seats rendered as literal `ESC[38;2;215;135;175m` on screen, because a
// text projection that ignores escapes shows them. The browser can paint the
// colour the package asked for, so it does.

/** The 8 base ANSI colours, in SGR order, as CSS. */
const BASE = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
] as const
/** Their bright variants (SGR 90-97 / 100-107). */
const BRIGHT = [
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
] as const

/** Style a run of text carries. Keys are CSS properties, ready for React. */
export interface AnsiStyle {
  color?: string
  backgroundColor?: string
  fontWeight?: string
  fontStyle?: string
  textDecoration?: string
  opacity?: string
}

/** One run of text with the style in force when it was written. */
export interface AnsiRun {
  text: string
  style: AnsiStyle
}

/**
 * Resolve one xterm-256 index to CSS.
 * @param index - the palette index (0-255).
 * @returns a CSS colour.
 */
export function ansi256(index: number): string {
  if (index < 8) return BASE[index] as string
  if (index < 16) return BRIGHT[index - 8] as string
  if (index < 232) {
    // The 6x6x6 cube: each axis steps 0, 95, 135, 175, 215, 255.
    const step = (value: number) => (value === 0 ? 0 : value * 40 + 55)
    const rest = index - 16
    return `rgb(${step(Math.floor(rest / 36))}, ${step(Math.floor(rest / 6) % 6)}, ${step(rest % 6)})`
  }
  const grey = (index - 232) * 10 + 8
  return `rgb(${grey}, ${grey}, ${grey})`
}

// Written as an escape rather than a literal ESC byte: an invisible control
// character in source is the kind of thing an editor silently eats.
const SGR = String.raw`\[([0-9;]*)m`

/**
 * Split text into styled runs.
 *
 * Unrecognised escapes are dropped rather than printed — a code this does not
 * model is still not something a reader should see as text. Text with no
 * escapes comes back as a single unstyled run, so callers need no special case.
 * @param text - possibly carrying SGR escapes.
 * @returns the runs, in order; empty only for empty input.
 */
export function parseAnsi(text: string): AnsiRun[] {
  const pattern = new RegExp(SGR, 'gu')
  const runs: AnsiRun[] = []
  let style: AnsiStyle = {}
  let at = 0
  const push = (piece: string) => {
    if (piece.length > 0) runs.push({ text: piece, style: { ...style } })
  }
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    push(text.slice(at, match.index))
    at = match.index + match[0].length
    const codes = (match[1] ?? '').split(';').filter(part => part !== '').map(Number)
    // A bare `ESC[m` is a reset, same as `ESC[0m`.
    if (codes.length === 0) style = {}
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index] as number
      if (code === 0) style = {}
      else if (code === 1) style.fontWeight = 'bold'
      else if (code === 2) style.opacity = '0.7'
      else if (code === 3) style.fontStyle = 'italic'
      else if (code === 4) style.textDecoration = 'underline'
      else if (code === 39) delete style.color
      else if (code === 49) delete style.backgroundColor
      else if (code >= 30 && code <= 37) style.color = BASE[code - 30] as string
      else if (code >= 90 && code <= 97) style.color = BRIGHT[code - 90] as string
      else if (code >= 40 && code <= 47) style.backgroundColor = BASE[code - 40] as string
      else if (code >= 100 && code <= 107) style.backgroundColor = BRIGHT[code - 100] as string
      else if (code === 38 || code === 48) {
        // Extended colour, in one of two forms: `5;N` (256) or `2;r;g;b`.
        const property = code === 38 ? 'color' : 'backgroundColor'
        const kind = codes[index + 1]
        if (kind === 5 && codes.length > index + 2) {
          style[property] = ansi256(codes[index + 2] as number)
          index += 2
        } else if (kind === 2 && codes.length > index + 4) {
          style[property] = `rgb(${codes[index + 2]}, ${codes[index + 3]}, ${codes[index + 4]})`
          index += 4
        }
      }
    }
  }
  push(text.slice(at))
  return runs
}

/**
 * Whether text carries any SGR escape.
 * @param text - the text to check.
 * @returns true when at least one escape is present.
 */
export function hasAnsi(text: string): boolean {
  return new RegExp(SGR, 'u').test(text)
}
