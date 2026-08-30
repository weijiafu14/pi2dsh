// dsh-x's browser half = the engine's browser half + the suite's own product
// UI. The host serves ONE client bundle per client-declaring package in the
// profile, and under the suite install shape only dsh-x is visible there —
// so this entry composes both at build time (a source-level import, same
// repository) into the single bundle the loader receives under id "dsh-x".
import { apply as engineApply, inject as engineInject } from '../../src/client.js'
import { registerDiagnosticsTab } from './diagnostics-tab.js'
import { registerMcpTab } from './mcp-tab.js'
import { MemoryWindow } from './memory-tab.js'
import { SideChatWindow } from './side-chat.js'
import { TasksDock } from './tasks-dock.js'

export const inject = engineInject

export function apply(ctx: Parameters<typeof engineApply>[0]): void {
  // The suite ships its own side-chat window (a real chat card over pi-btw's
  // commands), so the engine's plain read-only thread panel steps aside.
  engineApply(ctx, { sideThreads: false })
  registerMcpTab(ctx as never)
  registerDiagnosticsTab(ctx as never)
  ;(ctx as unknown as {
    inject(services: string[], apply: (scope: {
      slots?: {
        inject(name: string, apply: () => unknown): void
        register(registration: Record<string, unknown>, component: unknown): () => void
      }
    }) => void): void
  }).inject(['slots'], (scope) => {
    const slots = scope.slots
    if (slots === undefined) return
    slots.inject('shell.overlay', () => slots.register({
      name: 'shell.overlay', id: 'dsh-work-x-side-chat', order: 3,
    }, SideChatWindow))
    slots.inject('shell.overlay', () => slots.register({
      name: 'shell.overlay', id: 'dsh-work-x-tasks-dock', order: 4,
    }, TasksDock))
    slots.inject('shell.overlay', () => slots.register({
      name: 'shell.overlay', id: 'dsh-work-x-memory', order: 5,
    }, MemoryWindow))
  })
}
