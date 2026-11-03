import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { uiPromptChanged, withUiPrompt } from '../src/ui-prompt-lifecycle.js'

describe('Pi UI prompt lifetime', () => {
  it('shares one start/end pair across overlapping prompts in an Agent', async () => {
    const bus = new EventEmitter()
    const events: unknown[] = []
    bus.on(uiPromptChanged, event => events.push(event))
    let finishFirst!: () => void
    let finishSecond!: () => void
    const first = withUiPrompt(bus, 'input', 'First', () => new Promise<void>(done => { finishFirst = done }))
    const second = withUiPrompt(bus, 'select', 'Second', () => new Promise<void>(done => { finishSecond = done }))
    await Promise.resolve()
    expect(events).toEqual([{ type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'input', title: 'First' }])
    finishFirst(); await first
    expect(events).toHaveLength(1)
    finishSecond(); await second
    expect(events.at(-1)).toEqual({ type: 'ui_prompt_end', reason: 'ui_prompt', kind: 'input', title: 'First' })
  })

  it('closes failed prompts and does not mix Agent lifetimes', async () => {
    const a = new EventEmitter(), b = new EventEmitter()
    const aEvents: unknown[] = [], bEvents: unknown[] = []
    a.on(uiPromptChanged, event => aEvents.push(event))
    b.on(uiPromptChanged, event => bEvents.push(event))
    await expect(withUiPrompt(a, 'confirm', 'Fail', async () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
    expect(aEvents).toHaveLength(2)
    expect(bEvents).toHaveLength(0)
    expect(await withUiPrompt(b, 'input', undefined, async () => 'answer')).toBe('answer')
    expect(bEvents).toHaveLength(2)
  })
})
