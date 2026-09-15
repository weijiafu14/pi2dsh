import { describe, expect, it } from 'vitest'
import { readSessionEvents } from '../src/session-events.js'

describe('DSH history across host generations', () => {
  it('reads modern snapshots even when legacy history would be stale', () => {
    const current = [{ type: 'user/message', seq: 2, data: { content: [] } }]
    const session = { current, events: [], snapshotEvents() { return this.current } }
    expect(readSessionEvents(session)).toBe(current)
    session.current = [...current, { type: 'assistant/message', seq: 3, data: { content: [] } }]
    expect(readSessionEvents(session)).toHaveLength(2)
  })

  it('keeps array and receiver-bound method history working on older hosts', () => {
    const events = [{ type: 'turn/start', seq: 0 }]
    expect(readSessionEvents({ events })).toBe(events)
    const methodSession = { log: events, events() { return this.log } }
    expect(readSessionEvents(methodSession)).toBe(events)
  })

  it('distinguishes no active session from an unreadable real session', () => {
    expect(readSessionEvents(undefined)).toEqual([])
    expect(() => readSessionEvents({})).toThrow('no supported synchronous history reader')
    expect(() => readSessionEvents({ snapshotEvents: () => undefined, events: [] }))
      .toThrow('no supported synchronous history reader')
  })
})
