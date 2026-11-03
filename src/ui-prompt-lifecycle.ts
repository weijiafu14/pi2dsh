import type { EventEmitter } from 'node:events'
export const uiPromptChanged = Symbol('pi2dsh.uiPromptChanged')
const prompts = new WeakMap<EventEmitter, { depth: number, active?: { kind: string, title?: string } }>()

/** Pi 1.4 runner semantics: one start/end pair around overlapping blocking prompts. */
export function withUiPrompt<T>(bus: EventEmitter, kind: string, title: string | undefined, run: () => Promise<T>): Promise<T> {
  let state = prompts.get(bus)
  if (state === undefined) { state = { depth: 0 }; prompts.set(bus, state) }
  const current = state
  if (current.depth++ === 0) {
    current.active = { kind, ...(title ? { title } : {}) }
    const event = { type: 'ui_prompt_start', reason: 'ui_prompt', ...current.active }
    queueMicrotask(() => bus.emit(uiPromptChanged, event))
  }
  const finish = (): void => {
    if (--current.depth > 0) return
    current.depth = 0
    const event = { type: 'ui_prompt_end', reason: 'ui_prompt', ...current.active }
    delete current.active
    queueMicrotask(() => bus.emit(uiPromptChanged, event))
  }
  try { return run().finally(finish) } catch (error) { finish(); throw error }
}
