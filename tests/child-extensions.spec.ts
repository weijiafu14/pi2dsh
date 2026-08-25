import { afterEach, describe, expect, it } from 'vitest'
import { DefaultResourceLoader, providePiExtensionDiscovery } from '../src/compat/pi-coding-agent.js'
import { runtimeInternals, type ChildExtensionCatalog } from '../src/runtime.js'

// Real Pi loads a child's extension set at createAgentSession, filtered by
// the CREATOR's resource loader — its own code applies noExtensions and
// extensionsOverride. These tests pin the two halves of that translation:
// the loader shim presents the host's installed packages as the
// "default-discovered extensions" (so the creator's filter runs on real
// paths), and the runtime maps the surviving entries back to package names.

const CATALOG_ENTRIES = [
  { path: '/profile/node_modules/@remnic/plugin-pi/dist/index.js' },
  { path: '/profile/node_modules/pi-mcp-adapter/dist/index.js' },
]

afterEach(() => {
  providePiExtensionDiscovery([])
})

describe('DefaultResourceLoader extension discovery (installed packages as the default set)', () => {
  it('serves the provided catalog by default and honours noExtensions', () => {
    providePiExtensionDiscovery(CATALOG_ENTRIES)
    expect((new DefaultResourceLoader().getExtensions().extensions as Array<{ path: string }>).map(entry => entry.path))
      .toEqual(CATALOG_ENTRIES.map(entry => entry.path))
    expect(new DefaultResourceLoader({ noExtensions: true }).getExtensions().extensions).toEqual([])
  })

  it('runs the creator\'s extensionsOverride over the real base — the filter code decides', () => {
    providePiExtensionDiscovery(CATALOG_ENTRIES)
    // The exact shape pi-subagents passes: a function filtering base.extensions.
    const loader = new DefaultResourceLoader({
      extensionsOverride: (base: { extensions: Array<{ path: string }>, errors: unknown[] }) => ({
        ...base,
        extensions: base.extensions.filter(entry => entry.path.includes('mcp')),
      }),
    })
    expect((loader.getExtensions().extensions as Array<{ path: string }>).map(entry => entry.path))
      .toEqual(['/profile/node_modules/pi-mcp-adapter/dist/index.js'])
  })

  it('serves each entry\'s tools as a LIVE map once the child resolver attaches — late registrations count', () => {
    providePiExtensionDiscovery(CATALOG_ENTRIES)
    const loader = new DefaultResourceLoader()
    // Before the child mount attaches a resolver, entries carry an empty map
    // (pi-subagents reads .keys() unconditionally — undefined would throw).
    const before = loader.getExtensions().extensions as Array<{ tools: Map<string, unknown> }>
    expect([...before[0]!.tools.keys()]).toEqual([])

    const ledger = new Map<string, unknown>([['probe_touch', {}]])
    loader.attachChildToolResolver(path => (path.includes('mcp') ? ledger : undefined))
    const after = loader.getExtensions().extensions as Array<{ path: string, tools: ReadonlyMap<string, unknown> }>
    expect([...after.find(e => e.path.includes('mcp'))!.tools.keys()]).toEqual(['probe_touch'])
    // A tool registered AFTER the read appears on the next read: the map is
    // the instance's live ledger, not a snapshot.
    ledger.set('late_tool', {})
    const again = loader.getExtensions().extensions as Array<{ path: string, tools: ReadonlyMap<string, unknown> }>
    expect([...again.find(e => e.path.includes('mcp'))!.tools.keys()]).toEqual(['probe_touch', 'late_tool'])
  })

  it('reports path-loaded extensions as per-entry errors instead of pretending to load them', () => {
    const result = new DefaultResourceLoader({ additionalExtensionPaths: ['/home/me/my-ext.ts'] }).getExtensions()
    expect(result.errors).toHaveLength(1)
    expect(JSON.stringify(result.errors[0])).toContain('dsh plugin add')
  })
})

describe('resolveChildExtensionPackages (loader entries → installed package names)', () => {
  const catalog: ChildExtensionCatalog = {
    packageByEntryPath: new Map([
      ['/profile/node_modules/@remnic/plugin-pi/dist/index.js', '@remnic/plugin-pi'],
      ['/profile/node_modules/pi-mcp-adapter/dist/index.js', 'pi-mcp-adapter'],
    ]),
    mount: async () => [],
  }
  const resolve = runtimeInternals.resolveChildExtensionPackages

  it('no loader means Pi\'s default: the full discovered set', () => {
    expect(resolve(undefined, catalog)).toEqual({
      names: ['@remnic/plugin-pi', 'pi-mcp-adapter'],
      failures: [],
    })
  })

  it('a creator loader\'s surviving entries decide, and noExtensions empties the set', () => {
    providePiExtensionDiscovery([...catalog.packageByEntryPath.keys()].map(path => ({ path })))
    const narrowed = new DefaultResourceLoader({
      extensionsOverride: (base: { extensions: Array<{ path: string }>, errors: unknown[] }) => ({
        ...base,
        extensions: base.extensions.filter(entry => entry.path.includes('mcp')),
      }),
    })
    expect(resolve(narrowed, catalog).names).toEqual(['pi-mcp-adapter'])
    expect(resolve(new DefaultResourceLoader({ noExtensions: true }), catalog)).toEqual({ names: [], failures: [] })
  })

  it('an entry outside the catalog becomes a failure, never a silent drop or a fake load', () => {
    const { names, failures } = resolve(
      { getExtensions: () => ({ extensions: [{ path: '/somewhere/else/ext.js' }] }) },
      catalog,
    )
    expect(names).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]!.name).toBe('/somewhere/else/ext.js')
  })

  it('a throwing getExtensions is contained as a failure', () => {
    const { names, failures } = resolve(
      { getExtensions: () => { throw new Error('loader broke') } },
      catalog,
    )
    expect(names).toEqual([])
    expect(failures[0]!.error).toContain('loader broke')
  })
})
