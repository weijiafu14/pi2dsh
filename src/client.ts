// pi2dsh's browser half.
//
// DSH is two halves — a cordis server the rest of this package plugs into, and
// a browser shell with its own plugin surface. A package joins the second by
// declaring `dsh.client` and exporting `./client` as a closure-factory bundle
// (`window.__ModuleLoader__.load({ id, factory })`), which the host's
// client-modules scan resolves for ANY installed package. Two things are easy
// to get wrong and silent when wrong: the package must also export
// `./package.json` (the scan resolves the manifest by subpath, and the throw is
// swallowed into "never a client row"), and the bundle needs `module`/`exports`
// declared inside the factory closure.
//
// What it draws, and where:
//
//   shell.overlay                         side-conversation panel, status
//                                         pills and the transient title pill
//   conversation.session.header.utilities a package's header text
//   conversation.input.dock               a package's widgets (string arrays)
//   conversation.composer.dock            working chrome (message, indicator,
//                                         hidden-thinking label) and footer
//
// Those are the host's own seats (verified against the DSH web shell's slot
// declarations). Pi packages drive them through Pi's UI methods; the server
// half records what each package put on screen for a session, and this half
// draws it. A Pi TUI component arrives already rendered to text — a browser
// cannot mount one, and its own `render(width)` output is the honest
// projection.
//
// Where the data comes from: this package's own route
// (`/pi2dsh/browser-state`), not DSH's typed Remote system — that is a
// first-party generated contract, and an out-of-tree plugin talking to its own
// UI should carry its own channel.
//
// Types are declared locally: the client packages resolve through the loader's
// module table at runtime and are not dependencies of this package.
import { createElement, useEffect, useState } from 'react'

interface SlotRegistration { name: string, id: string, order?: number, select?: (...args: unknown[]) => unknown }
interface SlotScope {
  slots: {
    inject(name: string, apply: () => unknown): void
    register(registration: SlotRegistration, component: unknown): () => void
  }
}
interface ClientContext {
  inject(services: string[], apply: (scope: SlotScope) => void): void
}

/** The framework's global session-list selector hook, narrowed to what is read. */
type SessionsHook = <T>(select: (state: { current?: string }) => T) => T

interface PanelMessage { role: string, text: string }
interface PanelThread {
  id: string
  label: string
  package?: string
  running: boolean
  messages: PanelMessage[]
}
type SurfaceKey =
  | 'workingMessage' | 'workingIndicator' | 'hiddenThinkingLabel'
  | 'title' | 'header' | 'footer'
interface SurfaceView {
  package?: string
  values: Partial<Record<SurfaceKey, string>>
  statuses: Record<string, string>
  widgets: Record<string, string>
  workingVisible: boolean
}
interface RenderedEntry { id: string, customType: string, package?: string, text: string }
interface BrowserState { threads: PanelThread[], surfaces: SurfaceView[], entries: RenderedEntry[] }

/** Services this half needs before it can take a seat. */
export const inject = ['slots']

const POLL_MS = 1000
const EMPTY: BrowserState = { threads: [], surfaces: [], entries: [] }

/**
 * One poller per session, shared by every seat this package takes.
 *
 * Four components read the same payload; four independent timers would be four
 * requests a second for one answer.
 */
const subscribers = new Map<string, Set<(state: BrowserState) => void>>()
const latest = new Map<string, BrowserState>()
const timers = new Map<string, number>()

/**
 * Subscribe to one session's browser state.
 * @param session - session id to poll for.
 * @param notify - called with each payload, and immediately with the last one.
 * @returns an unsubscribe function that stops the timer with the last reader.
 */
function watch(session: string, notify: (state: BrowserState) => void): () => void {
  const readers = subscribers.get(session) ?? new Set()
  readers.add(notify)
  subscribers.set(session, readers)
  const cached = latest.get(session)
  if (cached !== undefined) notify(cached)
  if (!timers.has(session)) {
    const poll = async () => {
      try {
        const response = await fetch(`/pi2dsh/browser-state?session=${encodeURIComponent(session)}`)
        if (!response.ok) return
        const payload = await response.json() as Partial<BrowserState>
        const state: BrowserState = {
          threads: Array.isArray(payload.threads) ? payload.threads : [],
          surfaces: Array.isArray(payload.surfaces) ? payload.surfaces : [],
          entries: Array.isArray(payload.entries) ? payload.entries : [],
        }
        latest.set(session, state)
        for (const reader of subscribers.get(session) ?? []) reader(state)
      } catch {
        // A dropped poll leaves the last view up: these surfaces mirror live
        // state, and blanking them on one failed request reads as "the plugin
        // stopped", which is a worse lie than a stale value.
      }
    }
    void poll()
    timers.set(session, window.setInterval(() => { void poll() }, POLL_MS))
  }
  return () => {
    const live = subscribers.get(session)
    if (live === undefined) return
    live.delete(notify)
    if (live.size > 0) return
    subscribers.delete(session)
    const timer = timers.get(session)
    if (timer !== undefined) window.clearInterval(timer)
    timers.delete(session)
    latest.delete(session)
  }
}

/**
 * React binding for {@link watch}.
 * @param session - session id, or undefined while none is selected.
 * @returns the latest payload for that session.
 */
function useBrowserState(session: string | undefined): BrowserState {
  const [state, setState] = useState<BrowserState>(EMPTY)
  useEffect(() => {
    if (session === undefined || session === '') { setState(EMPTY); return }
    return watch(session, setState)
  }, [session])
  return state
}

/** The working keys Pi's setWorkingVisible gates: hidden while hidden. */
const WORKING_KEYS: readonly SurfaceKey[] = ['workingMessage', 'workingIndicator', 'hiddenThinkingLabel']

/** Every value packages have set for one simple surface, in package order. */
function valuesFor(surfaces: SurfaceView[], key: SurfaceKey): Array<{ owner: string, text: string }> {
  const out: Array<{ owner: string, text: string }> = []
  for (const surface of surfaces) {
    if (WORKING_KEYS.includes(key) && !surface.workingVisible) continue
    const text = surface.values[key]
    if (text !== undefined) out.push({ owner: surface.package ?? 'pi', text })
  }
  return out
}

/** Every status entry, package by package, then key, in registration order. */
function statusesFor(surfaces: SurfaceView[]): Array<{ owner: string, key: string, text: string }> {
  const out: Array<{ owner: string, key: string, text: string }> = []
  for (const surface of surfaces) {
    for (const [key, text] of Object.entries(surface.statuses)) {
      out.push({ owner: surface.package ?? 'pi', key, text })
    }
  }
  return out
}

/** Every widget, package by package, then key, in registration order. */
function widgetsFor(surfaces: SurfaceView[]): Array<{ owner: string, key: string, text: string }> {
  const out: Array<{ owner: string, key: string, text: string }> = []
  for (const surface of surfaces) {
    for (const [key, text] of Object.entries(surface.widgets)) {
      out.push({ owner: surface.package ?? 'pi', key, text })
    }
  }
  return out
}

const monospace = '400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace'
const styles = {
  panel: {
    position: 'fixed', right: '20px', bottom: '108px', zIndex: 40,
    width: '340px', maxHeight: '48vh', display: 'flex', flexDirection: 'column',
    pointerEvents: 'auto', overflow: 'hidden',
    borderRadius: '12px', border: '1px solid rgba(120,120,130,0.28)',
    background: 'var(--dsh-color-bg-elevated, rgba(24,24,27,0.96))',
    color: 'var(--dsh-color-text, #fafafa)',
    boxShadow: '0 12px 32px rgba(0,0,0,0.32)',
    font: '400 13px/1.55 system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '8px', padding: '10px 12px', borderBottom: '1px solid rgba(120,120,130,0.22)',
    fontWeight: 500, fontSize: '12px', letterSpacing: '0.01em',
  },
  badge: { opacity: 0.6, fontWeight: 400 },
  body: { padding: '10px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' },
  role: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55 },
  text: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  close: { cursor: 'pointer', opacity: 0.55, background: 'none', border: 'none', color: 'inherit', font: 'inherit' },
  pillStack: {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: 39,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px',
    pointerEvents: 'none',
  },
  pill: {
    pointerEvents: 'auto', padding: '5px 10px', borderRadius: '999px',
    background: 'var(--dsh-color-bg-elevated, rgba(24,24,27,0.92))',
    color: 'var(--dsh-color-text, #fafafa)',
    border: '1px solid rgba(120,120,130,0.28)',
    font: '500 11px/1.4 system-ui, sans-serif', whiteSpace: 'pre-wrap',
  },
  inline: { font: monospace, whiteSpace: 'pre-wrap', opacity: 0.85 },
  strip: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 2px' },
} as const

/**
 * The frame-wide seat: the side-conversation panel, plus whatever packages
 * pinned frame-wide — transient title and Pi's status entries, as pills.
 * @param props - the global standard kit every root slot component receives.
 */
function OverlaySurfaces({ useSessions }: { useSessions: SessionsHook }) {
  const session = useSessions(state => state.current)
  const { threads, surfaces } = useBrowserState(session)
  const [dismissed, setDismissed] = useState<string[]>([])

  const shown = threads.filter(thread => !dismissed.includes(thread.id))
  const pills = [
    ...valuesFor(surfaces, 'title').map(entry => ({ ...entry, key: 'title' })),
    ...statusesFor(surfaces),
  ]
  if (shown.length === 0 && pills.length === 0) return null
  return createElement('div', null,
    pills.length === 0 ? null : createElement('div', { style: styles.pillStack, 'data-pi2dsh': 'pills' },
      ...pills.map((pill, index) => createElement('div',
        { key: `${pill.owner}-${pill.key}-${index}`, style: styles.pill, title: pill.owner }, pill.text)),
    ),
    shown.length === 0 ? null : createElement('div', { 'data-pi2dsh': 'side-panel', style: styles.panel },
      ...shown.map(thread => createElement('div', { key: thread.id, style: { display: 'contents' } },
        createElement('div', { style: styles.header },
          createElement('span', null, thread.label),
          createElement('span', { style: styles.badge }, thread.running ? 'running' : `${thread.messages.length} msg`),
          createElement('button', {
            style: styles.close,
            title: 'Hide',
            onClick: () => setDismissed(list => [...list, thread.id]),
          }, '×'),
        ),
        createElement('div', { style: styles.body },
          ...thread.messages.map((message, index) => createElement('div', { key: index },
            createElement('div', { style: styles.role }, message.role),
            createElement('div', { style: styles.text }, message.text),
          )),
        ),
      )),
    ),
  )
}

/**
 * One session-scoped seat rendering a set of surfaces as text.
 * @param marker - the data-pi2dsh value, so an e2e run can address the seat.
 * @param valueKeys - which simple value surfaces this seat shows.
 * @param opts - whether the seat also shows widgets (keyed string arrays).
 * @returns a slot component.
 */
function textSeat(
  marker: string,
  valueKeys: readonly SurfaceKey[],
  opts: { widgets?: boolean } = {},
) {
  return function TextSeat({ sessionId }: { sessionId?: string }) {
    const { surfaces } = useBrowserState(sessionId)
    const entries: Array<{ owner: string, text: string }> = [
      ...valueKeys.flatMap(key => valuesFor(surfaces, key)),
      ...(opts.widgets === true ? widgetsFor(surfaces) : []),
    ]
    if (entries.length === 0) return null
    return createElement('div', { 'data-pi2dsh': marker, style: styles.strip },
      ...entries.map((entry, index) => createElement('div',
        { key: `${entry.owner}-${index}`, style: styles.inline, title: entry.owner }, entry.text)),
    )
  }
}

/**
 * Custom entries a package appended and renders itself.
 *
 * They live in pi2dsh's sidecar, not DSH's durable log — the host has no
 * channel for event types declared outside the harness — so the host's own
 * conversation view cannot show them. This seat is where a package's own
 * entries become visible, drawn by the package's registered renderer.
 * @param props - the session standard kit.
 * @returns the entry strip, or null when the package appended none.
 */
function EntryStrip({ sessionId }: { sessionId?: string }) {
  const { entries } = useBrowserState(sessionId)
  if (entries.length === 0) return null
  return createElement('div', { 'data-pi2dsh': 'entries', style: styles.strip },
    ...entries.map(entry => createElement('div',
      { key: entry.id, style: styles.inline, title: `${entry.package ?? 'pi'} · ${entry.customType}` }, entry.text)),
  )
}

/**
 * Client plugin body: take the seats this package draws into.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['slots'], (scope) => {
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'pi2dsh-overlay', order: 1,
    }, OverlaySurfaces))
    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities', id: 'pi2dsh-header', order: 1,
    }, textSeat('header', ['header'])))
    // A widget is a strip of lines of its own; the dock above the composer is
    // the seat DSH reserves for exactly that shape.
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'pi2dsh-dock', order: 1,
    }, textSeat('dock', [], { widgets: true })))
    // Working chrome is a live ambient readout — the band under the composer
    // card, where DSH's own stats line sits. Footer lands here too: it is the
    // bottom band of the conversation, the same seat the terminal's bottom
    // line would take.
    scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
      name: 'conversation.chat.turnTail', id: 'pi2dsh-entries', order: 1,
      select: () => ({}),
    }, EntryStrip))
    scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
      name: 'conversation.composer.dock', id: 'pi2dsh-working', order: 1,
    }, textSeat('working', ['footer', 'workingMessage', 'workingIndicator', 'hiddenThinkingLabel'])))
  })
}
