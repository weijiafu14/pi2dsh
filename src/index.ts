// Engine surface: `dsh plugin add pi2dsh` resolves this entry as a cordis
// plugin (named exports, no default — a default export would make the
// loader discard the function-plugin namespace).
export { apply, inject, name, discoverProfilePiPackages, findProfileRoot, type EngineConfig } from './engine.js'

// The CLI-only analysis surface loads lazily: its static-analysis dependency
// (the 23 MB typescript compiler, an optional peer) must never be pulled
// into a profile that installs the ENGINE. The dynamic import below keeps
// the analyzer in its own chunk, off the engine's load path.
import type { CompatibilityReport, ResolvedPiPackage } from './types.js'

/**
 * Static compatibility analysis of one resolved Pi package (CLI `inspect`).
 * @param pkg - the resolved package.
 * @returns the compatibility report.
 */
export async function analyzePackage(pkg: ResolvedPiPackage): Promise<CompatibilityReport> {
  const { analyzePackage: run } = await import('./analyzer.js')
  return run(pkg)
}

export {
  API_RULES,
  CONTEXT_RULES,
  EVENT_RULES,
  HOST_IMPORT_RULES,
  PI_AI_PACKAGES,
  PI_CODING_AGENT_PACKAGES,
  PI_TUI_PACKAGES,
  UI_CONTEXT_RULES,
  ruleForApi,
  ruleForContextProperty,
  ruleForEvent,
  ruleForHostImport,
  ruleForUiContextProperty,
} from './compatibility.js'
export { applyPiHost, manifestForInstalled } from './host.js'
export { collectPiMcpServers, convertPiMcpConfig, renderMcpPatch } from './mcp-config.js'
export { resolvePiPackage } from './source.js'
export type * from './types.js'
