import { describe, expect, it } from 'vitest'
// @ts-expect-error shared E2E helper is JavaScript
import { incompatibleHostPeers, assertHostCompatibility } from '../scripts/lib/host-compatibility.mjs'

describe('upstream terminal compatibility preflight', () => {
  it('does not treat an ordinary lower bound as opt-in to a future alpha', () => {
    expect(incompatibleHostPeers({ peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.2.1-rc.2' } }, '0.2.2-alpha.2')).toHaveLength(1)
  })
  it('accepts explicit alpha support and ignores non-host peers', () => {
    expect(incompatibleHostPeers({ peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.2-alpha.2', react: '^19' } }, '0.2.2-alpha.2')).toEqual([])
  })

  it('refuses a floating Cordis prerelease compatibility promise', () => {
    const manifest = {
      devDependencies: { '@deepseek-ai/dsh-agent': '0.2.2-alpha.3', '@deepseek-ai/cordis': '4.0.6-alpha.2' },
      peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.2-alpha.3', '@deepseek-ai/cordis': '~4.0.6-alpha.2' },
    }
    expect(() => assertHostCompatibility(manifest)).toThrow('tested exact version')
    manifest.peerDependencies['@deepseek-ai/cordis'] = '4.0.6-alpha.2'
    expect(assertHostCompatibility(manifest)).toBe('0.2.2-alpha.3')
  })
})
