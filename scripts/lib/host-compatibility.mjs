import assert from 'node:assert/strict'

// Public compatibility may include several independently validated hosts.
// The installed test graph must still use ONE exact host, never a union.
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

export function assertHostCompatibility(manifest) {
  const expected = manifest.devDependencies?.['@deepseek-ai/dsh-agent']
  assert(typeof expected === 'string' && EXACT_VERSION.test(expected), 'test host must be an exact version')
  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
  assert(peers.length > 0, 'no DSH compatibility declaration')
  let canonical
  for (const [name, range] of peers) {
    assert(typeof range === 'string', `${name}: expected an exact-version allowlist`)
    const versions = range.split('||').map(value => value.trim())
    assert(versions.every(version => EXACT_VERSION.test(version)), `${name}: only explicit validated versions are allowed`)
    assert.equal(new Set(versions).size, versions.length, `${name}: duplicate host version`)
    assert(versions.includes(expected), `${name}: test host ${expected} is not supported`)
    const normalized = [...versions].sort().join(' || ')
    canonical ??= normalized
    assert.equal(normalized, canonical, `${name}: inconsistent DSH compatibility declaration`)
  }
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, expected, `${name}: test dependencies must share one exact host`)
  }
  return expected
}
