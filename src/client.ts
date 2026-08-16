// pi2dsh's browser half: the side-conversation panel.
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
// What it draws: `shell.overlay` is the host's own seat for a frame-wide
// surface of your own — click-through by default, entries opt back in. Pi
// packages that open a side conversation present it as a focused panel over the
// main thread; DSH gives the thread a real child session, and this gives it
// that shape.
//
// Where the data comes from: this package's own route (`/pi2dsh/side-panel`),
// not DSH's typed Remote system — that is a first-party generated contract, and
// an out-of-tree plugin talking to its own UI should carry its own channel.
//
// Types are declared locally: the client packages resolve through the loader's
// module table at runtime and are not dependencies of this package.
import { createElement, useEffect, useState } from 'react'

interface SlotRegistration { name: string, id: string, order?: number }
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

/** Services this half needs before it can take a seat. */
export const inject = ['slots']

const POLL_MS = 1000


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
} as const

/**
 * The panel: one card per live side thread of the session on screen.
 *
 * The current session comes from the framework's own global seat
 * (`useSessions().current`), not from the address bar — the app keeps the open
 * conversation in its state, so the URL never names it.
 * @param props - the global standard kit every root slot component receives.
 */
function SidePanel({ useSessions }: { useSessions: SessionsHook }) {
  const session = useSessions(state => state.current)
  const [threads, setThreads] = useState<PanelThread[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    const poll = async () => {
      if (session === undefined || session === '') { if (alive) setThreads([]); return }
      try {
        const response = await fetch(`/pi2dsh/side-panel?session=${encodeURIComponent(session)}`)
        if (!response.ok) return
        const payload = await response.json() as { threads?: PanelThread[] }
        if (alive) setThreads(Array.isArray(payload.threads) ? payload.threads : [])
      } catch {
        // A poll that fails leaves the last view up: the panel is a mirror of
        // a live thread, and blanking it on one dropped request reads as "the
        // side conversation ended".
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [session])

  const shown = threads.filter(thread => !dismissed.includes(thread.id))
  if (shown.length === 0) return null
  return createElement('div', { 'data-pi2dsh': 'side-panel', style: styles.panel },
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
  )
}

/**
 * Client plugin body: take the frame-wide overlay seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['slots'], (scope) => {
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'pi2dsh-side-panel', order: 1,
    }, SidePanel))
  })
}
