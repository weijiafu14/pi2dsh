// Public session-log access across DSH generations. Newer hosts expose an
// immutable snapshot instead of the old events property; never treat that
// API change as an empty conversation.
export function readSessionEvents(session: unknown): readonly Record<string, unknown>[] {
  if (typeof session !== 'object' || session === null) return []
  const value = session as { snapshotEvents?: unknown; events?: unknown }
  const events = typeof value.snapshotEvents === 'function'
    ? value.snapshotEvents.call(session)
    : typeof value.events === 'function' ? value.events.call(session) : value.events
  if (!Array.isArray(events)) throw new Error('pi2dsh: the DSH session exposes no supported synchronous history reader')
  return events as readonly Record<string, unknown>[]
}

/** Host-authored context is not a human turn; relay messages intentionally are. */
export function isPiUserMessage(data: Record<string, unknown>): boolean {
  const source = data.source as { kind?: string; form?: string } | undefined
  return source?.kind === undefined || source.kind === 'user' || source.form === 'relay'
}

/** The existing native descriptor convention for Pi in-memory side sessions. */
export function isPiEphemeralSession(session: unknown): boolean {
  return readSessionEvents(session).some(event => {
    const data = event.data as { provider?: string; label?: string } | undefined
    return event.type === 'subagent/descriptor' && data?.provider === 'pi2dsh' && data.label?.startsWith('Side: ') === true
  })
}
