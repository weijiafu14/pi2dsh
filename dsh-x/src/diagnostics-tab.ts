// The suite's Problems tab: the VOLUME home for diagnostics-shaped widget
// content. The corner pill is the ambient count and the floating card a
// quick glance, but a real diagnostics run is many files × many rows, and
// that scale belongs in the sidebar — scrollable, persistent, session-scoped
// by the sidebar itself. Same seat as the MCP tab (dsh-better-sidebar's
// registerTab service); no sidebar package in the profile → no tab, and
// nothing else changes.
//
// Data honesty: the rows are what the Pi package drew on its own widget,
// read from the engine's /pi2dsh/browser-state and structurally recognized
// (diagnostics-model.ts). Nothing is fetched from language servers directly
// and nothing is reformatted beyond the recognizer's parse.
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { DiagnosticsRows } from '../../src/client.js'
import { parseDiagnosticsWidget, type DiagnosticsView } from '../../src/diagnostics-model.js'

interface SurfaceView { package?: string, widgets?: Record<string, string> }
interface SidebarTabScope { sessionId: string }
interface BetterSidebarService {
  registerTab(descriptor: {
    id: string
    title: string
    component: (props: { scope: SidebarTabScope, visible: boolean }) => ReactNode
  }): () => void
}
export interface DiagnosticsUiContext {
  inject(services: string[], apply: (scope: { betterSidebar?: BetterSidebarService }) => void): void
}

const ui = {
  root: {
    display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
    font: '400 13px/1.5 system-ui, -apple-system, sans-serif', color: 'inherit',
  },
  headline: { font: '600 13px/1.4 system-ui, sans-serif', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  sub: { opacity: 0.65, fontSize: '12px' },
  ownerRow: {
    display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px',
    font: '600 11px/1.4 system-ui, sans-serif', opacity: 0.7,
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  ownerBadge: {
    fontSize: '10.5px', padding: '1px 7px', borderRadius: '999px',
    border: '1px solid rgba(120,120,130,0.35)', opacity: 0.85, letterSpacing: 'normal',
  },
  empty: { padding: '14px', borderRadius: '10px', border: '1px dashed rgba(120,120,130,0.4)', fontSize: '12.5px', lineHeight: 1.7 },
} as const

interface OwnedDiagnostics { owner: string, key: string, view: DiagnosticsView }

/** Poll this session's diagnostics-shaped widgets, only while the tab shows. */
function useDiagnostics(session: string, active: boolean): OwnedDiagnostics[] | undefined {
  const [views, setViews] = useState<OwnedDiagnostics[] | undefined>(undefined)
  useEffect(() => {
    if (!active || session === '') return
    let live = true
    const pull = async () => {
      try {
        const response = await fetch(`/pi2dsh/browser-state?session=${encodeURIComponent(session)}`)
        if (!live || !response.ok) return
        const payload = await response.json() as { surfaces?: SurfaceView[] }
        const found: OwnedDiagnostics[] = []
        for (const surface of payload.surfaces ?? []) {
          for (const [key, text] of Object.entries(surface.widgets ?? {})) {
            if (typeof text !== 'string') continue
            const view = parseDiagnosticsWidget(text.replace(/\s+$/u, ''))
            if (view !== undefined) found.push({ owner: surface.package ?? 'pi', key, view })
          }
        }
        setViews(found)
      } catch { /* transient poll failure: the next tick retries */ }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 2000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [session, active])
  return views
}

/** The session's diagnostics, grouped by the package that reported them. */
function ProblemsTab({ scope, visible }: { scope: SidebarTabScope, visible: boolean }): ReactNode {
  const session = scope.sessionId ?? ''
  const views = useDiagnostics(session, visible)
  if (views === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'problems-tab' },
      createElement('div', { style: ui.sub }, 'Loading diagnostics…'))
  }
  const files = views.reduce((sum, entry) => sum + entry.view.files.length, 0)
  return createElement('div', { style: ui.root, 'data-dsh-x': 'problems-tab' },
    createElement('div', { style: ui.headline },
      createElement('span', null, 'Problems · this session'),
      createElement('span', { style: ui.sub }, files === 0 ? 'none reported' : `${files} file${files === 1 ? '' : 's'}`),
    ),
    views.length === 0
      ? createElement('div', { style: ui.empty },
        'No diagnostics reported yet. When a plugin runs its code checks (for example an LSP diagnostics tool), its findings appear here for this session.')
      : views.map(entry => createElement('div', { key: `${entry.owner}-${entry.key}`, style: { display: 'contents' } },
        createElement('div', { style: ui.ownerRow },
          createElement('span', null, entry.view.title ?? entry.owner),
          entry.view.badge === undefined ? null : createElement('span', { style: ui.ownerBadge }, entry.view.badge)),
        createElement(DiagnosticsRows, { view: entry.view }),
      )),
  )
}

/** Seat the Problems tab beside the MCP tab, when a sidebar is composed. */
export function registerDiagnosticsTab(ctx: DiagnosticsUiContext): void {
  ctx.inject(['betterSidebar'], (scope) => {
    scope.betterSidebar?.registerTab({
      id: 'dsh-work-x:problems',
      title: 'Problems',
      component: ProblemsTab,
    })
  })
}
