import { describe, expect, it } from 'vitest'
import { assertHostCompatibility } from '../scripts/lib/host-compatibility.mjs'

const manifest = (host = '0.2.1-rc.3', range = '0.2.1-rc.2 || 0.2.1-rc.3') => ({
  devDependencies: { '@deepseek-ai/dsh-agent': host, '@deepseek-ai/dsh-tools': host },
  peerDependencies: { '@deepseek-ai/dsh-tools': range, '@deepseek-ai/dsh-session': range },
})

describe('validated host allowlist vs exact test graph', () => {
  it.each(['0.2.1-rc.2', '0.2.1-rc.3'])('allows testing %s without rejecting the other validated host', host => {
    expect(assertHostCompatibility(manifest(host))).toBe(host)
  })
  it.each(['^0.2.1-rc.2', '>=0.2.1-rc.2', '*', '0.2.1-rc.2 ||'])('rejects unbounded or malformed declaration %s', range => {
    expect(() => assertHostCompatibility(manifest('0.2.1-rc.2', range))).toThrow()
  })
  it('rejects an unvalidated test host', () => {
    expect(() => assertHostCompatibility(manifest('0.2.1-rc.4'))).toThrow('not supported')
  })
  it('rejects inconsistent peer declarations', () => {
    const value = manifest()
    value.peerDependencies['@deepseek-ai/dsh-session'] = '0.2.1-rc.3'
    expect(() => assertHostCompatibility(value)).toThrow('inconsistent')
  })
  it('rejects mixed development hosts', () => {
    const value = manifest()
    value.devDependencies['@deepseek-ai/dsh-tools'] = '0.2.1-rc.2'
    expect(() => assertHostCompatibility(value)).toThrow('one exact host')
  })
  it('rejects a range in development dependencies', () => {
    expect(() => assertHostCompatibility(manifest('0.2.1-rc.2 || 0.2.1-rc.3'))).toThrow('exact version')
  })
  it('rejects duplicate versions', () => {
    expect(() => assertHostCompatibility(manifest('0.2.1-rc.2', '0.2.1-rc.2 || 0.2.1-rc.2'))).toThrow('duplicate')
  })
})
