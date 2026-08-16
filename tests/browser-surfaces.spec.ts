// Browser-half contracts: what the bridge's own route publishes about a Pi
// package's side conversation and its presentation surfaces. The registry and
// the route are the public seam between this package's two halves, so they are
// tested directly rather than through a browser — the browser half is covered
// end to end by examples/side-conversation and examples/presentation-surfaces.
import { describe, expect, it } from 'vitest'
import { SEED_CARRIER_TAG } from '../src/subagent-bridge.js'
import { BrowserSurfaces, surfaceText } from '../src/browser-surfaces.js'

type UnknownRecord = Record<string, unknown>

/**
 * A stand-in for one bridged child session, carrying the two things the panel
 * reads: the live transcript and which entries are carried context.
 */
function fakeThreadSession(messages: UnknownRecord[], carried: UnknownRecord[] = []) {
  const set = new WeakSet(carried)
  return {
    messages,
    isCarriedContext: (message: UnknownRecord) => set.has(message),
  } as never
}

const text = (value: string): UnknownRecord[] => [{ type: 'text', text: value }]

describe('side panel registry', () => {
  it('publishes one thread per side conversation, keyed by the parent session', () => {
    const registry = new BrowserSurfaces()
    const session = fakeThreadSession([
      { role: 'user', content: text('who wrote Dune?') },
      { role: 'assistant', content: text('Frank Herbert') },
    ])
    const dispose = registry.track('parent-1', {
      id: 'child-1', label: 'pi-btw side conversation', package: 'pi-btw', session,
    })

    expect(registry.snapshot('parent-2')).toEqual([])
    const [thread] = registry.snapshot('parent-1')
    expect(thread).toMatchObject({ id: 'child-1', label: 'pi-btw side conversation', package: 'pi-btw' })
    expect(thread?.messages).toEqual([
      { role: 'user', text: 'who wrote Dune?' },
      { role: 'assistant', text: 'Frank Herbert' },
    ])

    // A finished thread leaves the panel when its owner disposes it.
    dispose()
    expect(registry.snapshot('parent-1')).toEqual([])
  })

  it('shows the exchange, not the context a thread was started with', () => {
    // Both kinds of carried context reach the child transcript for real: the
    // package seeds the parent's messages, and the host injects runtime
    // snapshots. Showing either would make the panel a copy of the main thread.
    const seeded = { role: 'user', content: text('[user]: earlier main-thread question') }
    const snapshot = { role: 'user', content: text('Current runtime context. This snapshot supersedes…') }
    const carrier = { role: 'user', content: text(`<${SEED_CARRIER_TAG}>\n[user]: earlier\n</${SEED_CARRIER_TAG}>`) }
    const registry = new BrowserSurfaces()
    registry.track('parent-1', {
      id: 'child-1',
      label: 'side conversation',
      package: undefined,
      session: fakeThreadSession(
        [seeded, snapshot, carrier, { role: 'user', content: text('the side question') },
          { role: 'assistant', content: text('the side answer') }],
        [seeded, snapshot],
      ),
    })

    expect(registry.snapshot('parent-1')[0]?.messages).toEqual([
      { role: 'user', text: 'the side question' },
      { role: 'assistant', text: 'the side answer' },
    ])
  })

  it('renders tool calls as a marker and drops empty entries', () => {
    const registry = new BrowserSurfaces()
    registry.track('parent-1', {
      id: 'child-1',
      label: 'side conversation',
      package: undefined,
      session: fakeThreadSession([
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal' }] },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'read_file' }] },
        { role: 'user', content: 'a plain string body' },
      ]),
    })

    // Reasoning is not conversation; a thinking-only entry disappears entirely.
    expect(registry.snapshot('parent-1')[0]?.messages).toEqual([
      { role: 'assistant', text: '[tool: read_file]' },
      { role: 'user', text: 'a plain string body' },
    ])
  })
})

describe('presentation surfaces', () => {
  it('records setStatus keyed entries per session and package, and clears by key', () => {
    const registry = new BrowserSurfaces()
    registry.setStatus('session-1', 'pi-btw', 'model', 'gpt-4o')
    registry.setStatus('session-1', 'pi-btw', 'branch', 'main')
    registry.setStatus('session-1', 'other-pkg', 'model', 'claude')

    expect(registry.surfaces('session-1')).toEqual([
      { package: 'pi-btw', statuses: { model: 'gpt-4o', branch: 'main' }, values: {}, widgets: {}, workingVisible: true },
      { package: 'other-pkg', statuses: { model: 'claude' }, values: {}, widgets: {}, workingVisible: true },
    ])
    expect(registry.surfaces('session-2')).toEqual([])

    // Passing undefined removes exactly that entry, Pi's own clear shape.
    registry.setStatus('session-1', 'pi-btw', 'model', undefined)
    expect(registry.surfaces('session-1')[0]).toMatchObject({ statuses: { branch: 'main' } })
  })

  it('records setWidget string arrays, ignores non-array content, and clears by key', () => {
    const registry = new BrowserSurfaces()
    registry.setWidget('session-1', 'pi-demo', 'plan-todos', ['- one', '- two'])
    registry.setWidget('session-1', 'pi-demo', 'ignored', 'not an array')

    expect(registry.surfaces('session-1')[0]?.widgets).toEqual({ 'plan-todos': '- one\n- two' })

    registry.setWidget('session-1', 'pi-demo', 'plan-todos', undefined)
    expect(registry.surfaces('session-1')).toEqual([])
  })

  it('records simple value surfaces, clearing on undefined', () => {
    const registry = new BrowserSurfaces()
    registry.setSurface('session-1', 'pi-demo', 'title', 'pi-demo on DSH')
    registry.setSurface('session-1', 'pi-demo', 'workingMessage', 'Thinking deeply...')
    registry.setSurface('session-1', 'pi-demo', 'hiddenThinkingLabel', 'Pondering...')

    expect(registry.surfaces('session-1')[0]?.values).toEqual({
      title: 'pi-demo on DSH',
      workingMessage: 'Thinking deeply...',
      hiddenThinkingLabel: 'Pondering...',
    })

    registry.setSurface('session-1', 'pi-demo', 'workingMessage', undefined)
    expect(registry.surfaces('session-1')[0]?.values.workingMessage).toBeUndefined()
  })

  it('setWorkingVisible hides the working chrome without clearing it', () => {
    const registry = new BrowserSurfaces()
    registry.setSurface('session-1', 'pi-demo', 'workingMessage', 'Thinking deeply...')
    registry.setWorkingVisible('session-1', 'pi-demo', false)

    const [view] = registry.surfaces('session-1')
    expect(view?.workingVisible).toBe(false)
    expect(view?.values.workingMessage).toBe('Thinking deeply...')

    registry.setWorkingVisible('session-1', 'pi-demo', true)
    expect(registry.surfaces('session-1')[0]?.workingVisible).toBe(true)
  })

  it('drops calls made outside any session', () => {
    const registry = new BrowserSurfaces()
    registry.setStatus('', 'pi-demo', 'model', 'gpt-4o')
    registry.setSurface('', 'pi-demo', 'title', 'nowhere')
    registry.setWorkingVisible('', 'pi-demo', false)
    expect(registry.surfaces('session-1')).toEqual([])
  })

  it('one package keeps one view across every surface it drives', () => {
    const registry = new BrowserSurfaces()
    registry.setStatus('session-1', 'pi-demo', 'model', 'gpt-4o')
    registry.setSurface('session-1', 'pi-demo', 'title', 'pi-demo on DSH')
    registry.setWidget('session-1', 'pi-demo', 'w', ['line'])
    registry.setWorkingVisible('session-1', 'pi-demo', false)

    expect(registry.surfaces('session-1')).toHaveLength(1)
    const [view] = registry.surfaces('session-1')
    expect(view).toMatchObject({
      package: 'pi-demo',
      statuses: { model: 'gpt-4o' },
      widgets: { w: 'line' },
      values: { title: 'pi-demo on DSH' },
      workingVisible: false,
    })
  })
})

describe('surfaceText', () => {
  const theme = { fg: (_color: string, text: string) => text, dim: (text: string) => text }

  it('projects strings, lines, components, frames and factories to text', () => {
    expect(surfaceText('hello')).toBe('hello')
    expect(surfaceText(['line one', 'line two'])).toBe('line one\nline two')
    expect(surfaceText({ render: (width: number) => [`w${width}`, 'row'] })).toBe('w80\nrow')
    expect(surfaceText({ frames: ['⠋', '⠙'] })).toBe('⠋⠙')
    expect(surfaceText({ frames: [] })).toBeUndefined()
    expect(surfaceText(() => ({ render: () => ['from factory'] }), theme)).toBe('from factory')
    expect(surfaceText(
      (_tui: unknown, t: { fg: (color: string, text: string) => string }) =>
        ({ render: () => [t.fg('accent', 'styled')] }),
      theme,
    )).toBe('styled')
  })

  it('clears on undefined and rejects unrenderable values', () => {
    expect(surfaceText(undefined)).toBeUndefined()
    expect(surfaceText(null)).toBeUndefined()
    expect(surfaceText('')).toBeUndefined()
    expect(surfaceText({})).toBeUndefined()
    expect(surfaceText({ render: () => { throw new Error('boom') } })).toBeUndefined()
    // A factory that needs a TUI (not provided) degrades to empty, matching
    // Pi's rpc mode where no factory runs at all.
    const needsTui = (tui: { createText(text: string): unknown }) => tui.createText('needs tui')
    expect(surfaceText(needsTui, theme)).toBeUndefined()
  })
})
