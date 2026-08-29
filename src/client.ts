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
//                                         pills, the transient title pill and
//                                         package widgets (pill ⇄ floating
//                                         card, the work-x window form)
//   conversation.session.header.utilities a package's header text
//   conversation.input.dock               the invisible composer bridge only
//   conversation.composer.dock            working chrome (message, indicator,
//                                         hidden-thinking label) and footer
//
// Widgets deliberately do NOT take an in-column seat. The first form — a strip
// glued above the composer — was the projection form all over again: it could
// not be dismissed, the host clipped it, and the composer's slot kit hands the
// LAST session's id to the new-session screen, so a fresh "describe what you
// want to build" view wore the previous session's diagnostics. The overlay
// path reads the framework's current-session selector, which is empty on that
// screen, so the leak is structural gone, not styled over.
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
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { hasAnsi, parseAnsi } from './ansi.js'
import { parseDiagnosticsWidget, type DiagnosticsView } from './diagnostics-model.js'

interface SlotRegistration { name: string, id?: string, key?: string, order?: number, label?: string, select?: (...args: unknown[]) => unknown }
interface SlotScope {
  slots: {
    inject(name: string, apply: () => unknown): void
    register(registration: SlotRegistration, component: unknown): () => void
  }
  effect?(apply: () => (() => void) | void, label?: string): void
}
interface TriggerCandidate { name: string, description?: string }
interface TriggerSource {
  trigger: '@' | '/'
  name: string
  order?: number
  candidates(session: unknown, req: { query: string, signal: AbortSignal }): Promise<readonly TriggerCandidate[]>
  onPick(pick: { candidate: TriggerCandidate }): { text: string } | undefined
}
interface ClientContext {
  inject(services: string[], apply: (scope: SlotScope & {
    inputTriggers?: { registerSource(source: TriggerSource): () => void }
  }) => void): void
  effect?(apply: () => (() => void) | void, label?: string): void
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
interface DraftRequest { text: string, rev: number }

interface BrowserState {
  threads: PanelThread[]
  surfaces: SurfaceView[]
  entries: RenderedEntry[]
  draft?: DraftRequest
}

interface NativeImageAttachment {
  attachmentId: string
  mediaType: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}
interface ToolContentBlock {
  type?: string
  text?: string
  attachment?: NativeImageAttachment
}
interface PiToolCallBlock {
  kind?: string
  name?: string
  argsRaw?: string
  call?: { name?: string, argsRaw?: string } | null
  content?: readonly ToolContentBlock[]
  isError?: boolean
}
interface PiImageToolViewProps {
  toolName: string
  block: PiToolCallBlock
  sessionId?: string
}

/** Services this half needs before it can take a seat. */
export const inject = ['slots', 'inputTriggers']

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
          ...(payload.draft === undefined ? {} : { draft: payload.draft }),
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
    // The host's design tokens live on <body> (light/dark both), so a fixed
    // element inherits the real theme; the fallbacks are a neutral light
    // card, never a hard-coded dark one.
    position: 'fixed', right: '20px', bottom: '108px', zIndex: 40,
    width: '340px', maxHeight: '48vh', display: 'flex', flexDirection: 'column',
    pointerEvents: 'auto', overflow: 'hidden',
    borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)',
    color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv2, 0 12px 32px rgba(0,0,0,0.16))',
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
    // 112px clears both the host's bottom stats row AND the suite's side-chat
    // dot (right:20, bottom:64, 38px tall) — at bottom:56 the pills sat under
    // the dot, and on a phone the two collided visibly (2026-08-28 mobile
    // screenshot). This bundle only ships through dsh-work-x, so the dot is
    // always there to clear. Deliberately NOT portaled to <body>: the slot's
    // stacking context sits below the host's right workbench, so an open
    // sidebar covers these chips — correct, because the sidebar (Problems
    // tab) IS the expanded surface the chips abbreviate.
    position: 'fixed', right: '20px', bottom: '112px', zIndex: 39,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px',
    pointerEvents: 'none', maxWidth: 'calc(100vw - 40px)',
  },
  pill: {
    pointerEvents: 'auto', padding: '5px 10px', borderRadius: '999px',
    background: 'var(--dsw-alias-bg-layer-2, #fff)',
    color: 'inherit',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    boxShadow: 'var(--dsw-shadow-lv1, 0 2px 8px rgba(0,0,0,0.08))',
    font: '500 11px/1.4 system-ui, sans-serif', whiteSpace: 'pre-wrap',
    // The stack hugs the right edge; without a cap a long status line walks
    // off the left of a phone screen (the "LSP Active: …" pill did).
    maxWidth: 'calc(100vw - 48px)', overflowWrap: 'anywhere',
  },
  // A widget's collapsed presence: the same pill, but interactive.
  widgetPill: {
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '7px',
    textAlign: 'left',
  },
  // A widget's expanded presence: the suite's floating-window chrome (the
  // side-chat card's tokens and radii), living inside the pill stack so it
  // grows upward away from the dot instead of fighting it for the corner.
  widgetCard: {
    pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
    width: 'min(380px, calc(100vw - 40px))', maxHeight: '44vh', overflow: 'hidden',
    borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv2, 0 12px 32px rgba(0,0,0,0.16))',
    font: '400 12.5px/1.5 system-ui, -apple-system, sans-serif', textAlign: 'left',
  },
  widgetCardHeader: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px',
    borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))',
    font: '600 12.5px/1.4 system-ui, sans-serif',
  },
  widgetCardBody: {
    padding: '10px 12px', overflowY: 'auto', overflowX: 'auto',
    display: 'flex', flexDirection: 'column', gap: '6px',
  },
  // Terminal-drawn widget bodies keep their alignment: pre, scroll sideways.
  cardMono: { font: monospace, whiteSpace: 'pre', minWidth: 0 },
  inline: { font: monospace, whiteSpace: 'pre-wrap', opacity: 0.85 },
  // The diagnostics card interior: a recognized diagnostics widget renders as
  // product rows (system font, chips, severity dots) instead of projected
  // terminal text — the side-chat bar, applied to the dock.
  diagBadge: {
    padding: '1px 7px', borderRadius: '999px',
    background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))',
    font: '600 10.5px/1.6 system-ui, sans-serif', opacity: 0.85,
  },
  diagFile: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    font: '500 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '1px 8px', borderRadius: '6px',
    background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))',
  },
  diagRow: {
    display: 'flex', alignItems: 'baseline', gap: '8px',
    font: '400 12.5px/1.5 system-ui, -apple-system, sans-serif',
  },
  diagDot: {
    width: '7px', height: '7px', borderRadius: '999px', flex: 'none',
    alignSelf: 'center',
  },
  diagLoc: {
    font: '500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    opacity: 0.6, flex: 'none',
  },
  diagRule: { font: '400 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', opacity: 0.55, flex: 'none' },
  diagMessage: { minWidth: 0, overflowWrap: 'anywhere' },
  // In-column text seats (header utilities, working chrome, custom entries)
  // sit in a card of the host's own visual language, never bare monospace
  // floated over the page. Wide readouts scroll inside the card.
  strip: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    margin: '4px 0', padding: '8px 12px', overflowX: 'auto',
    borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
  },
  imageTool: {
    margin: '4px 0', overflow: 'hidden', borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
    color: 'inherit', font: '400 12px/1.5 system-ui, sans-serif',
  },
  imageToolToggle: {
    width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px 10px', cursor: 'pointer', border: 'none', background: 'transparent',
    color: 'inherit', textAlign: 'left', font: '500 12px/1.5 system-ui, sans-serif',
  },
  imageToolStatus: { color: '#2FBC44', fontSize: '10px' },
  imageToolSummary: { opacity: 0.62, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  imageToolBody: {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 10px 10px',
    borderTop: '1px solid rgba(120,120,130,0.14)',
  },
  imageToolText: { margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: 0.82 },
  imageGrid: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  imageFrame: {
    display: 'block', maxWidth: 'min(320px, 100%)', maxHeight: '320px',
    borderRadius: '8px', objectFit: 'contain', background: 'rgba(0,0,0,0.08)',
  },
  imageError: { padding: '12px', color: '#F63218' },
  // The Models-page login card (alpha provider-card seat).
  loginArea: {
    display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0 0', padding: '8px 10px',
    borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.02))',
    font: '400 12px/1.5 system-ui, sans-serif',
  },
  loginRow: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' },
  loginButton: {
    cursor: 'pointer', padding: '3px 10px', borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.15))',
    background: 'transparent', color: 'inherit', font: '500 12px/1.5 system-ui, sans-serif',
  },
  loginStatus: { opacity: 0.75 },
  loginNotice: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: 0.85 },
  loginCode: {
    font: '600 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing: '0.08em', userSelect: 'all',
  },
  loginInput: {
    flex: 1, minWidth: '120px', padding: '4px 8px', borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.15))',
    background: 'transparent', color: 'inherit', font: 'inherit',
  },
} as const

/** Pull one image through DSH's own session-authorized attachment RPC. */
function AuthorizedToolImage({ sessionId, attachment }: {
  sessionId: string
  attachment: NativeImageAttachment
}) {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    void (async () => {
      try {
        const response = await fetch('/api/session.attachment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            type: 'client-request',
            rpcId: `pi2dsh-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            method: 'session.attachment',
            payload: { sessionId, attachmentId: attachment.attachmentId },
          }),
        })
        const envelope = await response.json() as {
          result?: { ok?: boolean, value?: { data?: string, attachment?: NativeImageAttachment } }
        }
        const data = envelope.result?.ok === true ? envelope.result.value?.data : undefined
        if (!response.ok || typeof data !== 'string') throw new Error('attachment unavailable')
        const binary = atob(data)
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mediaType }))
        if (!controller.signal.aborted) setUrl(objectUrl)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    })()
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [sessionId, attachment.attachmentId, attachment.mediaType])
  if (failed) return createElement('div', { style: styles.imageError }, 'Image attachment could not be loaded.')
  if (url === undefined) return createElement('div', { style: styles.imageToolText }, 'Loading image…')
  return createElement('img', {
    src: url,
    alt: attachment.name ?? 'Image returned by Pi tool',
    style: styles.imageFrame,
    'data-pi2dsh': 'tool-image',
  })
}

function firstArgumentSummary(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const preferred = parsed.prompt ?? parsed.description
    if (typeof preferred === 'string') return preferred
    const first = Object.values(parsed).find(value => typeof value === 'string')
    return typeof first === 'string' ? first : ''
  } catch {
    return raw
  }
}

/** Browser row shared by the explicitly supported Pi image tools. */
function PiImageToolView({ toolName, block, sessionId }: PiImageToolViewProps) {
  const [expanded, setExpanded] = useState(true)
  const settled = block.kind === 'tool-result'
  const argsRaw = settled ? block.call?.argsRaw ?? '' : block.argsRaw ?? ''
  const content = settled && Array.isArray(block.content) ? block.content : []
  const images = content.flatMap(item => item.type === 'image' && item.attachment !== undefined ? [item.attachment] : [])
  const text = content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
  const summary = firstArgumentSummary(argsRaw)
  return createElement('div', {
    style: styles.imageTool,
    'data-pi2dsh': 'image-tool-result',
    'data-tool': toolName,
  },
  createElement('button', {
    type: 'button', style: styles.imageToolToggle,
    'aria-expanded': expanded,
    onClick: () => setExpanded(value => !value),
  },
  createElement('span', { style: styles.imageToolStatus }, block.isError === true ? '●' : settled ? '●' : '◌'),
  createElement('span', null, toolName),
  summary === '' ? null : createElement('span', { style: styles.imageToolSummary }, `· ${summary}`)),
  !expanded ? null : createElement('div', { style: styles.imageToolBody },
    text === '' ? null : createElement('div', { style: styles.imageToolText }, text),
    sessionId === undefined || images.length === 0
      ? null
      : createElement('div', { style: styles.imageGrid },
        ...images.map(attachment => createElement(AuthorizedToolImage, {
          key: attachment.attachmentId, sessionId, attachment,
        })),
      ),
  ))
}

/**
 * Register the image row under exact tool names published at package mount.
 * Only known image tools appear in that list, so text-only and native tools
 * retain DSH's existing cards.
 */
function installImageToolViews(scope: SlotScope): void {
  const installed = new Set<string>()
  const start = () => {
    let live = true
    const sync = async () => {
      try {
        const response = await fetch('/pi2dsh/image-tool-names')
        if (!response.ok || !live) return
        const payload = await response.json() as { names?: unknown }
        if (!Array.isArray(payload.names)) return
        for (const value of payload.names) {
          if (typeof value !== 'string' || value === '' || installed.has(value)) continue
          installed.add(value)
          scope.slots.inject('tool.call.toolview', () => scope.slots.register({
            name: 'tool.call.toolview', key: value,
          }, PiImageToolView))
        }
      } catch {
        // A missed poll only delays richer presentation; the durable result and
        // DSH's generic fallback remain visible.
      }
    }
    void sync()
    const timer = window.setInterval(() => { void sync() }, POLL_MS)
    return () => { live = false; window.clearInterval(timer) }
  }
  if (scope.effect !== undefined) scope.effect(start, 'pi2dsh: image tool views')
  else start()
}

/**
 * The frame-wide seat: the side-conversation panel, plus whatever packages
 * pinned frame-wide — transient title and Pi's status entries, as pills.
 * @param props - the global standard kit every root slot component receives.
 */

/** A product layer (dsh-work-x) that ships its own side-chat window turns
 *  the engine's plain thread panel off; pills and the rest stay. */
let renderSideThreads = true

function OverlaySurfaces({ useSessions }: { useSessions: SessionsHook }) {
  const session = useSessions(state => state.current)
  const { threads, surfaces } = useBrowserState(session)
  const [dismissed, setDismissed] = useState<string[]>([])

  const shown = (renderSideThreads ? threads : []).filter(thread => !dismissed.includes(thread.id))
  const pills = [
    ...valuesFor(surfaces, 'title').map(entry => ({ ...entry, key: 'title' })),
    ...statusesFor(surfaces),
  ]
  const widgets = widgetsFor(surfaces)
  if (shown.length === 0 && pills.length === 0 && widgets.length === 0) return null
  return createElement('div', null,
    pills.length === 0 && widgets.length === 0 ? null : createElement('div', { style: styles.pillStack, 'data-pi2dsh': 'pills' },
      // Widgets first in DOM = top of the bottom-anchored stack, so an open
      // card grows upward, away from the dot and the host's stats row.
      ...widgets.map(entry => createElement(WidgetUnit,
        { key: `w-${entry.owner}-${entry.key}`, owner: entry.owner, text: entry.text })),
      ...pills.map((pill, index) => createElement('div',
        { key: `${pill.owner}-${pill.key}-${index}`, style: styles.pill, title: pill.owner },
        ansiText(pill.text))),
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
/**
 * Render text that may carry ANSI colour into styled spans.
 *
 * Parsing lives in ./ansi.js so it can be tested without a DOM; this half
 * only turns runs into elements. Text with no escapes returns as a plain
 * string, so the common case adds no wrappers.
 * @param text - the seat text, possibly with SGR escapes.
 * @returns react children.
 */
function ansiText(text: string): ReactNode {
  if (!hasAnsi(text)) return text
  return parseAnsi(text).map((run, index) => {
    if (run.href !== undefined) {
      // OSC 8 hyperlink: the label is the content, the target is metadata.
      // http(s) targets become real links; anything else (file:// above all —
      // browsers refuse those anchors anyway) shows the label with the full
      // target in the tooltip, which is what a terminal link degrades to.
      return /^https?:\/\//u.test(run.href)
        ? createElement('a', {
          key: `ansi-${index}`, href: run.href, target: '_blank', rel: 'noreferrer',
          style: { ...run.style, color: run.style.color ?? 'inherit' },
        }, run.text)
        : createElement('span', {
          key: `ansi-${index}`, title: run.href,
          style: { textDecoration: 'underline dotted', textUnderlineOffset: '2px', ...run.style },
        }, run.text)
    }
    return Object.keys(run.style).length === 0
      ? run.text
      : createElement('span', { key: `ansi-${index}`, style: run.style }, run.text)
  })
}

/**
 * A recognized diagnostics widget's rows — file chips, severity dots,
 * locations, messages. The recognizer is structural (see diagnostics-model.ts);
 * anything it declines stays on the mono projection, so recognition can only
 * upgrade presentation. The title/badge live in the widget card's own header.
 * Exported: the suite's Problems sidebar tab renders the same rows at full
 * width (same composed bundle, same source of truth for the row shape).
 */
export function DiagnosticsRows({ view }: { view: DiagnosticsView }): ReactNode {
  return createElement('div', { 'data-pi2dsh': 'diagnostics', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    ...view.files.flatMap((file, fileIndex) => [
      createElement('div', { key: `f-${fileIndex}` },
        createElement('span', { style: styles.diagFile, title: file.target },
          file.label,
          file.badge === undefined ? null : createElement('span', { style: { opacity: 0.55 } }, file.badge))),
      ...file.rows.map((row, rowIndex) => createElement('div', { key: `r-${fileIndex}-${rowIndex}`, style: styles.diagRow },
        createElement('span', { style: { ...styles.diagDot, background: row.markerColor ?? '#d4373f' } }),
        createElement('span', { style: styles.diagLoc, title: row.target },
          `L${row.line}${row.column === undefined ? '' : `:${row.column}`}`),
        row.ruleId === undefined ? null : createElement('span', { style: styles.diagRule }, row.ruleId),
        createElement('span', { style: styles.diagMessage }, row.message))),
    ]),
  )
}

/**
 * One widget, in the suite's floating form.
 *
 * A single line is ambient status (a powerline, an LSP readout) and renders
 * as a pill outright. Anything taller is content and starts as a labelled,
 * badged pill too — collapsed on purpose: a tool's results are already
 * narrated in the conversation, so the widget is the ambient copy, and an
 * ambient surface earns attention with a badge, not by popping a window
 * (the side-chat window auto-opens because its content arrives nowhere
 * else). Clicking the pill opens the floating card — side-chat chrome —
 * and × collapses it back. All of it lives in the overlay pill stack,
 * never in the conversation column.
 */
function WidgetUnit({ owner, text: raw }: { owner: string, text: string }): ReactNode {
  // A status line often arrives with a trailing newline; that must not
  // promote it from ambient pill to content card.
  const text = raw.replace(/\s+$/u, '')
  const diagnostics = parseDiagnosticsWidget(text)
  const multiline = diagnostics !== undefined || text.includes('\n')
  const [open, setOpen] = useState(false)
  if (text === '') return null
  if (!multiline) {
    return createElement('div', { style: styles.pill, title: owner, 'data-pi2dsh': 'widget' },
      ansiText(text))
  }
  const title = diagnostics?.title ?? owner
  const badge = diagnostics?.badge
  if (!open) {
    return createElement('button', {
      type: 'button', style: { ...styles.pill, ...styles.widgetPill }, title: 'Show details',
      'data-pi2dsh': 'widget', 'data-state': 'collapsed',
      onClick: () => setOpen(true),
    },
    createElement('span', undefined, title),
    badge === undefined ? null : createElement('span', { style: styles.diagBadge }, badge))
  }
  return createElement('div', { style: styles.widgetCard, 'data-pi2dsh': 'widget', 'data-state': 'open' },
    createElement('div', { style: styles.widgetCardHeader },
      createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
      badge === undefined ? null : createElement('span', { style: styles.diagBadge }, badge),
      createElement('button', {
        style: styles.close, title: 'Collapse',
        onClick: () => setOpen(false),
      }, '×')),
    createElement('div', { style: styles.widgetCardBody },
      ...(diagnostics !== undefined
        ? [createElement(DiagnosticsRows, { key: 'rows', view: diagnostics })]
        : text.split('\n').map((line, index) =>
          createElement('div', { key: index, style: styles.cardMono }, ansiText(line))))),
  )
}

/** What `/pi2dsh/login-state` serves: the OAuth providers and the one flow. */
interface LoginStatePayload {
  providers?: Array<{ id?: unknown, name?: unknown, signedIn?: unknown }>
  flow?: {
    provider?: unknown
    notices?: Array<{ message?: unknown, code?: unknown }>
    question?: { id?: unknown, kind?: unknown, title?: unknown, placeholder?: unknown, options?: unknown }
    done?: { ok?: unknown, summary?: unknown }
  }
}

// One login-state poller shared by every provider card on the settings page —
// same economy as the browser-state watcher above.
const loginReaders = new Set<(payload: LoginStatePayload) => void>()
let loginLatest: LoginStatePayload | undefined
let loginTimer: number | undefined

function watchLogin(notify: (payload: LoginStatePayload) => void): () => void {
  loginReaders.add(notify)
  if (loginLatest !== undefined) notify(loginLatest)
  if (loginTimer === undefined) {
    const poll = async () => {
      try {
        const response = await fetch('/pi2dsh/login-state')
        if (!response.ok) return
        loginLatest = await response.json() as LoginStatePayload
        for (const reader of loginReaders) reader(loginLatest)
      } catch {
        // A dropped poll keeps the last view; see the browser-state watcher.
      }
    }
    void poll()
    loginTimer = window.setInterval(() => { void poll() }, 2000)
  }
  return () => {
    loginReaders.delete(notify)
    if (loginReaders.size > 0 || loginTimer === undefined) return
    window.clearInterval(loginTimer)
    loginTimer = undefined
    loginLatest = undefined
  }
}

function useLoginState(): LoginStatePayload | undefined {
  const [payload, setPayload] = useState<LoginStatePayload | undefined>(loginLatest)
  useEffect(() => watchLogin(setPayload), [])
  return payload
}

function postLoginAction(action: string, provider: string, value = ''): void {
  void fetch('/pi2dsh/login-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, provider, value }),
  }).catch(() => {
    // The next poll shows whatever actually happened; a lost POST is retried
    // by the human, who is looking at the card.
  })
}

/** Render a notice string with its URLs clickable (the spine's short links). */
function linkified(text: string): ReactNode[] {
  return text.split(/(https?:\/\/\S+)/u).map((part, index) =>
    /^https?:\/\//u.test(part)
      ? createElement('a', { key: index, href: part, target: '_blank', rel: 'noreferrer' }, part)
      : part)
}

/**
 * One provider's sign-in controls: status, the sign-in/out button, and the
 * live flow (notices, device code, questions, outcome). Shared by the per-row
 * card and the footer directory.
 */
function LoginControls({ id, state }: { id: string, state: LoginStatePayload }): ReactNode {
  const [draft, setDraft] = useState('')
  const me = (state.providers ?? []).find(entry => entry.id === id)
  if (me === undefined) return null
  const signedIn = me.signedIn === true
  const name = typeof me.name === 'string' ? me.name : id
  const flow = state.flow !== undefined && state.flow.provider === id ? state.flow : undefined
  const question = flow?.question
  const done = flow?.done
  const running = flow !== undefined && done === undefined
  return createElement('div', { 'data-pi2dsh': 'login-card', style: styles.loginArea },
    createElement('div', { style: styles.loginRow },
      createElement('span', { style: styles.loginStatus },
        signedIn ? `Signed in to ${name} (pi2dsh)` : `Sign in to ${name} with its own login (pi2dsh)`),
      running
        ? createElement('button', {
          type: 'button', style: styles.loginButton,
          onClick: () => postLoginAction('cancel', id),
        }, 'Cancel')
        : createElement('button', {
          type: 'button', style: styles.loginButton,
          onClick: () => postLoginAction(signedIn ? 'signout' : 'begin', id),
        }, signedIn ? 'Sign out' : 'Sign in')),
    ...(flow === undefined ? [] : (flow.notices ?? []).map((notice, index) =>
      createElement('div', { key: `n-${index}`, style: styles.loginNotice },
        ...linkified(String(notice.message ?? '')),
        notice.code === undefined ? null : createElement('div', { style: styles.loginCode }, String(notice.code))))),
    question === undefined ? null : createElement('div', { style: styles.loginRow },
      question.kind === 'select'
        ? createElement('span', undefined,
          createElement('div', { style: styles.loginNotice }, String(question.title ?? '')),
          ...(Array.isArray(question.options) ? question.options : []).map((option, index) =>
            createElement('button', {
              key: `o-${index}`, type: 'button', style: { ...styles.loginButton, margin: '2px 4px 0 0' },
              onClick: () => postLoginAction('answer', id, String(option)),
            }, String(option))))
        : createElement('span', { style: { display: 'flex', gap: '6px', flex: 1, alignItems: 'center' } },
          createElement('span', { style: styles.loginNotice }, String(question.title ?? '')),
          createElement('input', {
            style: styles.loginInput, value: draft,
            placeholder: typeof question.placeholder === 'string' ? question.placeholder : '',
            onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
          }),
          createElement('button', {
            type: 'button', style: styles.loginButton,
            onClick: () => { postLoginAction('answer', id, draft); setDraft('') },
          }, 'OK'))),
    done === undefined ? null : createElement('div', { style: styles.loginRow },
      createElement('span', { style: { ...styles.loginNotice, ...(done.ok === true ? {} : { color: '#F63218' }) } },
        String(done.summary ?? '')),
      createElement('button', {
        type: 'button', style: styles.loginButton,
        onClick: () => postLoginAction('dismiss', id),
      }, 'Dismiss')),
  )
}

/**
 * Per-row extras on the Models page's provider cards, keyed 'llm-pi-ai': a
 * logged-in Pi provider whose credential yields an api key rides an official
 * llm-pi-ai profile, so its ROW carries the family namespace, and this entry
 * puts the bridge's sign-in state on that row. Rows outside the bridge's
 * OAuth ledger render nothing. (Bridge-TRANSPORT routes never get a row at
 * all — the page lists only configured declarations, verified live on
 * 0.1.2-alpha.1 — which is why the sign-in DIRECTORY lives in the footer
 * below, not here.)
 */
function ProviderCardLogin(props: { provider?: { provider?: unknown } }): ReactNode {
  const state = useLoginState()
  const id = props.provider?.provider
  if (typeof id !== 'string' || state === undefined) return null
  return createElement(LoginControls, { id, state })
}

/**
 * The bridge's sign-in directory on the Models page footer: every OAuth
 * provider the engine knows (builtins and package-registered alike), each
 * with the same controls the per-row card shows. This is the seat that works
 * BEFORE any login exists — the moment a user actually needs it.
 */
function LoginFooter(): ReactNode {
  const state = useLoginState()
  if (state === undefined || (state.providers ?? []).length === 0) return null
  return createElement('div', { 'data-pi2dsh': 'login-footer' },
    createElement('div', { style: { ...styles.loginStatus, margin: '12px 0 0', font: '500 12px/1.5 system-ui, sans-serif' } },
      'Pi provider sign-in (pi2dsh)'),
    ...(state.providers ?? []).map(provider =>
      typeof provider.id === 'string'
        ? createElement(LoginControls, { key: provider.id, id: provider.id, state })
        : null))
}

function textSeat(marker: string, valueKeys: readonly SurfaceKey[]) {
  return function TextSeat({ sessionId }: { sessionId?: string }) {
    const { surfaces } = useBrowserState(sessionId)
    const values = valueKeys.flatMap(key => valuesFor(surfaces, key))
    if (values.length === 0) return null
    return createElement('div', { 'data-pi2dsh': marker, style: styles.strip },
      ...values.map((entry, index) => createElement('div',
        { key: `v-${entry.owner}-${index}`, style: styles.inline, title: entry.owner }, ansiText(entry.text))),
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
      { key: entry.id, style: styles.inline, title: `${entry.package ?? 'pi'} · ${entry.customType}` },
      ansiText(entry.text))),
  )
}

/**
 * The composer half of Pi's editor calls.
 *
 * `inputActions` is part of the session standard kit — every session-scoped
 * slot component receives it — so a package's `setEditorText`/`pasteToEditor`
 * reaches the real composer instead of a buffer nobody reads. The traffic is
 * two-way on purpose: the live draft is reported back so a package's
 * `getEditorText` reads what the user actually has, not only its own last
 * write.
 * @param props - the session standard kit (state hook plus input actions).
 * @returns nothing rendered; this seat exists for the effects.
 */
function ComposerBridge(
  { sessionId, useInput, inputActions }: {
    sessionId?: string
    useInput?: <T>(select: (state: { draft: string }) => T) => T
    inputActions?: { setDraft(text: string): void }
  },
) {
  const { draft } = useBrowserState(sessionId)
  const live = useInput === undefined ? '' : useInput(state => state.draft)
  const [appliedRev, setAppliedRev] = useState(0)

  // Apply a pending write exactly once per revision: a package retrying the
  // same text is a new request, and re-applying an old one would fight the
  // user's own typing.
  useEffect(() => {
    if (draft === undefined || inputActions === undefined) return
    if (draft.rev <= appliedRev) return
    setAppliedRev(draft.rev)
    inputActions.setDraft(draft.text)
  }, [draft?.rev, draft?.text, inputActions, appliedRev])

  // Report what the composer holds, so the server-side read is the truth.
  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    void fetch('/pi2dsh/editor-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, draft: live }),
    }).catch(() => {
      // The composer is the browser's; a dropped report only means the
      // server-side read is one keystroke stale.
    })
  }, [sessionId, live])

  return null
}

/**
 * Client plugin body: take the seats this package draws into.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext, options?: { sideThreads?: boolean }): void {
  if (options?.sideThreads === false) renderSideThreads = false
  // Pi's autocomplete providers, offered under DSH's own trigger menu. The
  // labels a package returns are the menu rows; picking one inserts the value
  // the provider chose, which is what its own applyCompletion would have done
  // with the token.
  ctx.inject(['inputTriggers'], (scope) => {
    const triggers = scope.inputTriggers
    if (triggers === undefined) return
    // Values are carried on the candidate name, which is what a pick returns.
    triggers.registerSource({
      trigger: '@',
      name: 'pi2dsh',
      order: 50,
      candidates: async (_session, req) => {
        try {
          const response = await fetch(
            `/pi2dsh/completions?trigger=${encodeURIComponent('@')}&query=${encodeURIComponent(req.query)}`,
            { signal: req.signal },
          )
          if (!response.ok) return []
          const payload = await response.json() as { items?: Array<{ value: string, label: string, description?: string }> }
          return (payload.items ?? []).map(item => ({
            name: item.value,
            ...(item.description === undefined ? {} : { description: item.description }),
          }))
        } catch {
          // An aborted or failed lookup contributes no rows; the other sources
          // in the menu are unaffected.
          return []
        }
      },
      onPick: pick => ({ text: pick.candidate.name }),
    })
  })
  ctx.inject(['slots'], (scope) => {
    installImageToolViews(scope)
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'pi2dsh-overlay', order: 1,
    }, OverlaySurfaces))
    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities', id: 'pi2dsh-header', order: 1,
    }, textSeat('header', ['header'])))
    // Widgets have NO in-column seat: they float in the overlay pill stack
    // (see WidgetUnit). The dock strip form died 2026-08-28 — see the header
    // comment for the three ways it failed.
    // Working chrome is a live ambient readout — the band under the composer
    // card, where DSH's own stats line sits. Footer lands here too: it is the
    // bottom band of the conversation, the same seat the terminal's bottom
    // line would take.
    scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
      name: 'conversation.chat.turnTail', id: 'pi2dsh-entries', order: 1,
      select: () => ({}),
    }, EntryStrip))
    // A seat that renders nothing: it exists because the session standard kit
    // it receives is the only public write path to the composer.
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'pi2dsh-composer-bridge', order: 2,
    }, ComposerBridge))
    scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
      name: 'conversation.composer.dock', id: 'pi2dsh-working', order: 1,
    }, textSeat('working', ['footer', 'workingMessage', 'workingIndicator', 'hiddenThinkingLabel'])))
    // The Models settings page's seats (0.1.2 line): the per-row extension
    // area for llm-pi-ai family rows (logged-in Pi providers ride official
    // llm-pi-ai profiles), and the footer for the bridge's own sign-in
    // directory (the page renders only CONFIGURED rows, so a signed-out
    // provider has no row to hang a card on — verified live on alpha.1).
    // On hosts without these seats (rc lines) the names are never declared,
    // so the callbacks never run: graceful absence, not a version probe.
    scope.slots.inject('settings.models.provider-card', () => scope.slots.register({
      name: 'settings.models.provider-card', key: 'llm-pi-ai',
    }, ProviderCardLogin))
    scope.slots.inject('settings.models.footer', () => scope.slots.register({
      name: 'settings.models.footer', id: 'pi2dsh-login', order: 100, label: 'Pi provider sign-in',
    }, LoginFooter))
  })
}
