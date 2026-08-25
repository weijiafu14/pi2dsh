// dsh-x's browser half = the engine's browser half + the suite's own product
// UI. The host serves ONE client bundle per client-declaring package in the
// profile, and under the suite install shape only dsh-x is visible there —
// so this entry composes both at build time (a source-level import, same
// repository) into the single bundle the loader receives under id "dsh-x".
import { apply as engineApply, inject as engineInject } from '../../src/client.js'
import { registerMcpTab } from './mcp-tab.js'

export const inject = engineInject

export function apply(ctx: Parameters<typeof engineApply>[0]): void {
  engineApply(ctx)
  registerMcpTab(ctx as never)
}
