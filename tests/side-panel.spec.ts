// Side-panel contracts: what the panel's own route publishes about a Pi
// package's side conversation. The registry and the route are the public seam
// between this package's two halves, so they are tested directly rather than
// through a browser — the browser half is covered end to end by
// examples/side-conversation.
import { describe, expect, it } from 'vitest'
import { SEED_CARRIER_TAG } from '../src/subagent-bridge.js'
import { SidePanelRegistry } from '../src/side-panel.js'

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
    const registry = new SidePanelRegistry()
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
    const registry = new SidePanelRegistry()
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
    const registry = new SidePanelRegistry()
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
