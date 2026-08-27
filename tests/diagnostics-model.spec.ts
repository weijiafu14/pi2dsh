// The diagnostics recognizer, against pi-lens's REAL captured widget shape
// (the 2026-08-27 web run whose raw form was the ]8;;file:///… dump). The
// recognizer is structural — link + #L anchor — so these strings are evidence
// of shape, not a package contract.
import { describe, expect, it } from 'vitest'
import { parseDiagnosticsWidget } from '../src/diagnostics-model.js'

const ESC = String.fromCharCode(27)
const link = (target: string, label: string) => `${ESC}]8;;${target}${ESC}\\${label}${ESC}]8;;${ESC}\\`
const FILE = 'file:///tmp/p/sample-project/src/ledger.ts'

describe('parseDiagnosticsWidget', () => {
  it('recognizes the captured pi-lens shape: header, file row, anchored row', () => {
    const text = [
      'pi-lens  ●1E',
      `  ● ${link(FILE, 'ledger.ts')} 1E`,
      `  ● ${link(`${FILE}#L6:9`, 'L6')} typescript:2322  Type 'string' is not assignable to type 'number'.`,
    ].join('\n')
    const view = parseDiagnosticsWidget(text)
    expect(view).toBeDefined()
    expect(view?.title).toBe('pi-lens')
    expect(view?.badge).toBe('1E')
    expect(view?.files).toHaveLength(1)
    const file = view!.files[0]!
    expect(file.label).toBe('ledger.ts')
    expect(file.target).toBe(FILE)
    expect(file.badge).toBe('1E')
    expect(file.rows).toHaveLength(1)
    expect(file.rows[0]).toMatchObject({
      label: 'L6', line: 6, column: 9,
      ruleId: 'typescript:2322',
      message: "Type 'string' is not assignable to type 'number'.",
      target: `${FILE}#L6:9`,
    })
  })

  it('keeps the severity marker colour when the package styled one', () => {
    const red = `${ESC}[31m●${ESC}[0m`
    const text = [
      'pi-lens  ●1E',
      `  ${red} ${link(`${FILE}#L6`, 'L6')} typescript:2322  boom`,
    ].join('\n')
    const row = parseDiagnosticsWidget(text)?.files[0]?.rows[0]
    expect(row?.markerColor).toBe('#cd3131')
    expect(row?.column).toBeUndefined()
  })

  it('declines shapes that are not diagnostics, so text projection stays', () => {
    // A powerline-style status widget: styled text, no links at all.
    expect(parseDiagnosticsWidget('model deepseek | ctx 32k | main')).toBeUndefined()
    // Links without line anchors (a link list) are not diagnostics either.
    expect(parseDiagnosticsWidget(`docs: ${link('https://example.test', 'guide')}`)).toBeUndefined()
    // Multi-line plain widget.
    expect(parseDiagnosticsWidget('- one\n- two')).toBeUndefined()
  })

  it('declines when prose follows the rows (shape this model does not know)', () => {
    const text = [
      'pi-lens',
      `  ● ${link(`${FILE}#L6`, 'L6')} some message`,
      'unstructured trailing prose',
    ].join('\n')
    expect(parseDiagnosticsWidget(text)).toBeUndefined()
  })
})
