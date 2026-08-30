// dsh-x's browser half = the engine's browser half + the suite's own product
// UI. The host serves ONE client bundle per client-declaring package in the
// profile, and under the suite install shape only dsh-x is visible there —
// so this entry composes both at build time (a source-level import, same
// repository) into the single bundle the loader receives under id "dsh-x".
import { apply as engineApply, inject as engineInject } from '../../src/client.js'
import { registerDiagnosticsTab } from './diagnostics-tab.js'
import { registerMcpTab } from './mcp-tab.js'
import { SettingsMemorySection, registerMemorySeats } from './memory-tab.js'
import { SideChatWindow } from './side-chat.js'
import { TasksChip, registerTasksSeats } from './tasks-dock.js'

export const inject = engineInject

export function apply(ctx: Parameters<typeof engineApply>[0]): void {
  // The suite ships its own side-chat window (a real chat card over pi-btw's
  // commands), so the engine's plain read-only thread panel steps aside.
  engineApply(ctx, { sideThreads: false })
  registerMcpTab(ctx as never)
  registerMemorySeats(ctx as never)
  registerTasksSeats(ctx as never)
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
    // The tasks chip rides the host's own composer status row (the same row
    // the packages' working/footer text lives in) — the host lays it out.
    slots.inject('conversation.composer.dock', () => slots.register({
      name: 'conversation.composer.dock', id: 'dsh-work-x-tasks', order: 2,
    }, TasksChip))
    // Memory management is a Settings page, like every mainstream assistant.
    slots.inject('settings.section', () => slots.register({
      name: 'settings.section', id: 'dsh-work-x-memory', order: 61, label: () => 'Memory',
    }, SettingsMemorySection))
  })
}
