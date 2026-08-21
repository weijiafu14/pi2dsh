// Provider ledger contract: the shared host ledger follows Pi's layered
// composition (model-runtime.ts registerProvider/recomposeProvider and
// provider-composer.ts applyExtension at the pinned upstream 0.84.1):
// builtin base + package overlays, defined fields win, undefined fields
// expose the base, an overlay without models keeps the base models rebased
// onto its gateway, and re-registration merges defined fields over the
// package's previous registration.
import { describe, expect, it } from 'vitest'
import { mergeProviderRegistration, overlayProviderConfig } from '../src/runtime.js'

describe('provider layered composition (Pi contract)', () => {
  const builtin = {
    name: 'Kimi (builtin)',
    baseUrl: 'https://builtin.example',
    oauth: { name: 'Kimi OAuth', login: async () => ({ type: 'oauth' }) },
  }

  it('a partial overlay keeps the builtin base for fields it does not define', () => {
    const composed = overlayProviderConfig(builtin, { baseUrl: 'https://gw.example' })
    expect(composed.baseUrl).toBe('https://gw.example')
    expect(composed.name).toBe('Kimi (builtin)')
    // The decisive field: overriding only the endpoint must NOT discard the
    // builtin OAuth flow (the old wholesale-supersede ledger did).
    expect(composed.oauth).toBe(builtin.oauth)
  })

  it('explicitly undefined overlay fields expose the base, defined ones win', () => {
    const composed = overlayProviderConfig(builtin, { name: undefined, baseUrl: 'https://gw.example' })
    expect(composed.name).toBe('Kimi (builtin)')
    expect(composed.baseUrl).toBe('https://gw.example')
  })

  it('an overlay with its own model list replaces the base list outright', () => {
    const base = { ...builtin, models: [{ id: 'base-model', baseUrl: 'https://builtin.example' }] }
    const composed = overlayProviderConfig(base, { models: [{ id: 'pkg-model' }] })
    expect(composed.models).toEqual([{ id: 'pkg-model' }])
  })

  it('an overlay without models keeps the base models rebased onto its gateway', () => {
    const base = { ...builtin, models: [{ id: 'base-model', baseUrl: 'https://builtin.example' }] }
    const composed = overlayProviderConfig(base, { baseUrl: 'https://gw.example' })
    expect(composed.models).toEqual([{ id: 'base-model', baseUrl: 'https://gw.example' }])
  })

  it('re-registration merges defined fields over the previous registration', () => {
    const first = mergeProviderRegistration(undefined, { baseUrl: 'https://one.example', api: 'openai-completions' })
    const second = mergeProviderRegistration(first, { baseUrl: 'https://two.example', name: undefined })
    expect(second.baseUrl).toBe('https://two.example')
    expect(second.api).toBe('openai-completions')
    expect('name' in second).toBe(false)
  })
})
