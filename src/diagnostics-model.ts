// Structural recognition of diagnostics-shaped widgets, kept apart from the
// browser half so it can be tested without a DOM.
//
// Why this exists: a language-feedback package (pi-lens is the live example)
// publishes its per-file findings as a TUI widget — lines of link-wrapped
// file/line anchors plus a message. Rendering that as monospace text in the
// web dock was the projection form the work-x session already rejected for
// the side chat ("正是被否掉的投影形态"); the product bar is a native card.
// The recognizer is STRUCTURAL — a line whose OSC 8 link target carries a
// `#L<line>[:<col>]` anchor is a diagnostic row — never a package-name test,
// so any package publishing the same shape gets the same card.
import { parseAnsi, type AnsiRun } from './ansi.js'

/** One recognized diagnostic row. */
export interface DiagnosticRow {
  /** Short label the package linked (usually the line anchor, e.g. `L6`). */
  label: string
  /** The full link target, for tooltips (file path + anchor). */
  target: string
  /** 1-based line, from the `#L` anchor. */
  line: number
  /** 1-based column when the anchor carries one. */
  column?: number
  /** Rule identifier when the row names one (e.g. `typescript:2322`). */
  ruleId?: string
  /** Human message, stripped of the marker/label/rule tokens. */
  message: string
  /** CSS colour of the row's severity marker, when the package styled one. */
  markerColor?: string
}

/** One file grouping inside a diagnostics widget. */
export interface DiagnosticFile {
  /** The file label the package linked (usually the basename). */
  label: string
  /** Full link target for the tooltip. */
  target?: string
  /** Trailing count badge on the file row (e.g. `1E`), verbatim. */
  badge?: string
  rows: DiagnosticRow[]
}

/** A diagnostics widget, recognized and structured. */
export interface DiagnosticsView {
  /** Header text before any link rows (usually the package's own label). */
  title?: string
  /** Count badges from the header (e.g. `1E`), verbatim. */
  badge?: string
  files: DiagnosticFile[]
}

const LINE_ANCHOR = /#L(\d+)(?::(\d+))?$/u
const RULE_TOKEN = /^[\w.-]+:[\w.-]+$/u

/** Non-link text of a line's runs, joined. */
function plainText(runs: AnsiRun[]): string {
  return runs.filter(run => run.href === undefined).map(run => run.text).join('')
}

/** First marker colour (a styled bullet) on the line, if any. */
function markerColor(runs: AnsiRun[]): string | undefined {
  const marker = runs.find(run => run.href === undefined && run.style.color !== undefined && /[●○•▲■]/u.test(run.text))
  return marker?.style.color
}

/**
 * Recognize a diagnostics-shaped widget.
 *
 * @param text - the widget's rendered text, escapes included.
 * @returns the structured view, or undefined when the shape does not match —
 *   the caller falls back to the plain text projection, so a mis-recognition
 *   can only ever upgrade presentation, never lose content.
 */
export function parseDiagnosticsWidget(text: string): DiagnosticsView | undefined {
  const lines = text.split('\n')
  const view: DiagnosticsView = { files: [] }
  let sawAnchor = false
  let current: DiagnosticFile | undefined
  for (const line of lines) {
    const runs = parseAnsi(line)
    const linked = runs.filter(run => run.href !== undefined)
    if (linked.length === 0) {
      // Header territory (before any link) — anything after rows that is not
      // linked is noise this shape does not model; bail to the text fallback.
      if (view.files.length > 0) {
        if (line.trim().length === 0) continue
        return undefined
      }
      const flat = plainText(runs).trim()
      if (flat.length === 0) continue
      if (view.title !== undefined) return undefined
      const badge = /(\d+[EWIH](?:\s+\d+[EWIH])*)\s*$/u.exec(flat)?.[1]
      view.title = (badge === undefined ? flat : flat.slice(0, flat.lastIndexOf(badge))).replace(/[●○•]/gu, '').trim()
      if (badge !== undefined) view.badge = badge
      continue
    }
    const link = linked[0] as AnsiRun & { href: string }
    const anchor = LINE_ANCHOR.exec(link.href)
    if (anchor === null) {
      // A file row: link with no line anchor.
      const flat = plainText(runs).replace(/[●○•]/gu, '').trim()
      current = {
        label: link.text.trim(),
        target: link.href,
        ...(flat.length > 0 ? { badge: flat } : {}),
        rows: [],
      }
      view.files.push(current)
      continue
    }
    sawAnchor = true
    const rest = runs.slice(runs.indexOf(link) + 1)
    const restText = plainText(rest).trim()
    const tokens = restText.split(/\s+/u)
    const ruleId = tokens.find(token => RULE_TOKEN.test(token))
    const message = (ruleId === undefined ? restText : restText.replace(ruleId, '')).trim()
    const marker = markerColor(runs)
    const row: DiagnosticRow = {
      label: link.text.trim(),
      target: link.href,
      line: Number(anchor[1]),
      ...(anchor[2] === undefined ? {} : { column: Number(anchor[2]) }),
      ...(ruleId === undefined ? {} : { ruleId }),
      message,
      ...(marker === undefined ? {} : { markerColor: marker }),
    }
    if (current === undefined) {
      current = { label: link.text.trim(), target: link.href, rows: [] }
      view.files.push(current)
    }
    current.rows.push(row)
  }
  if (!sawAnchor || view.files.length === 0) return undefined
  return view
}
