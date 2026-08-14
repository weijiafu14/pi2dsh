// The compatibility matrix is a promise about the ABI: every host-import rule
// that is not an explicit-failure stub must correspond to a real export of the
// compat shims, or a community package holding that import would crash at
// load time while the report claims otherwise.
import { describe, expect, it } from 'vitest'
import { HOST_IMPORT_RULES } from '../src/compatibility.js'
import * as piCodingAgent from '../src/compat/pi-coding-agent.js'
import * as piTui from '../src/compat/pi-tui.js'
import * as piAi from '../src/compat/pi-ai.js'

const SHIMS: Record<string, Record<string, unknown>> = {
  'pi-coding-agent': piCodingAgent as Record<string, unknown>,
  'pi-tui': piTui as Record<string, unknown>,
  'pi-ai': piAi as Record<string, unknown>,
}

// Type-only exports have no runtime binding; everything else must exist.
const TYPE_ONLY = new Set([
  'pi-tui:FuzzyMatch', 'pi-tui:KeyId', 'pi-tui:KeyEventType',
])

describe('ABI contract: matrix rules match real shim exports', () => {
  for (const [family, rules] of Object.entries(HOST_IMPORT_RULES)) {
    const shim = SHIMS[family]
    it(`every ${family} rule maps to a live export`, () => {
      expect(shim).toBeDefined()
      const missing: string[] = []
      for (const name of Object.keys(rules)) {
        if (TYPE_ONLY.has(`${family}:${name}`)) continue
        if (!(name in shim!)) missing.push(name)
      }
      expect(missing).toEqual([])
    })
  }

  it('explicit-failure stubs really fail with the documented message', async () => {
    // createAgentSession is async: outside a mounted pi2dsh runtime (which
    // installs the real DSH-agent-backed factory) it rejects explicitly.
    await expect((piCodingAgent as unknown as Record<string, () => Promise<unknown>>).createAgentSession!())
      .rejects.toThrowError(/native DSH port|DSH mapping|DSH-native|mounted pi2dsh runtime/u)
    // DefaultResourceLoader graduated to a real headless class; the stub
    // mechanism itself is still contract-tested through DefaultPackageManager.
    expect(() => new (piCodingAgent as unknown as { DefaultPackageManager: new () => unknown }).DefaultPackageManager()).toThrowError()
    expect(new (piCodingAgent as unknown as { DefaultResourceLoader: new () => { getSkills(): { skills: unknown[] } } }).DefaultResourceLoader().getSkills().skills).toEqual([])
  })

  it('vendored width math matches Pi observable behavior', () => {
    expect(piTui.visibleWidth('中文')).toBe(4)
    expect(piTui.visibleWidth('\t')).toBe(3)
    expect(piTui.visibleWidth('🎉')).toBe(2)
    expect(piTui.stripTerminalSequences('\x1b[31mx\x1b[0m')).toBe('x')
  })
})
