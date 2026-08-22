// Upstream host-scenario contracts. pi-mcp-adapter's own suite tests its
// host stand-ins for scenarios that only bite when the HOST's shape differs
// from stock Pi ("host TypeBox shim omits Unsafe", "TypeBox internal markers
// leak into registered schemas"). pi2dsh IS that host — the compat shim
// supplies typebox and the bridge normalizes registered tool schemas — so
// these scenarios are pinned here against our real surfaces. The checklist
// procedure lives in docs/mcp-compatibility.md.
import { describe, expect, it } from 'vitest'
import { Type } from '../src/compat/pi-ai.js'
import { normalizeToolSchema } from '../src/runtime.js'

describe('host TypeBox surface (pi-mcp-adapter checklist)', () => {
  it('the compat shim supplies a complete Type including Unsafe', () => {
    // Upstream carries a degraded path for hosts whose TypeBox shim lacks
    // Type.Unsafe. Our shim re-exports the real typebox, so packages must
    // never be pushed onto that degraded path — Unsafe stays available.
    expect(typeof Type.Unsafe).toBe('function')
    expect(typeof Type.Object).toBe('function')
    expect(typeof Type.Optional).toBe('function')
  })

  it('schemas built with the shim normalize into plain JSON with no internal markers', () => {
    const schema = Type.Object({
      count: Type.Number(),
      mode: Type.Optional(Type.Union([Type.Literal('fast'), Type.Literal('slow')])),
      raw: Type.Unsafe<string>({ type: 'string', format: 'custom-mcp-format' }),
    })
    const { schema: normalized, warnings } = normalizeToolSchema(schema)
    expect(normalized.type).toBe('object')
    // No symbol-keyed internal markers anywhere in the tree, and the whole
    // schema survives a JSON round-trip unchanged — what DSH ToolRuntime
    // stores is exactly what a wire consumer would see.
    const assertClean = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return
      expect(Object.getOwnPropertySymbols(node)).toEqual([])
      for (const value of Object.values(node)) {
        expect(typeof value).not.toBe('function')
        assertClean(value)
      }
    }
    assertClean(normalized)
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized)
    // The bridge keeps only the JSON Schema subset DSH actually enforces.
    // Constraints outside that subset (here Unsafe's `format`) are DROPPED,
    // and the contract is that every drop is announced — never silent — so
    // a package author can see exactly which constraint stopped being
    // enforced when their schema crossed the host boundary.
    const properties = normalized.properties as Record<string, Record<string, unknown>>
    expect(properties.raw).toMatchObject({ type: 'string' })
    expect(properties.raw).not.toHaveProperty('format')
    expect(warnings.some(w => w.includes('properties.raw.format'))).toBe(true)
  })

  it('a non-object root fails loud instead of registering a broken tool', () => {
    expect(() => normalizeToolSchema(Type.String())).toThrow(/object-root/u)
  })
})
