// The suite's background-tasks surfaces: the product faces of
// pi-background-tasks on the web.
//
// Two seats, one data path:
//   - TasksChip (conversation.composer.dock, stock) — a small clickable chip
//     in the host's own status row beside the composer, present only while
//     tasks exist; click opens the panel. No free-floating circles: the host
//     lays the row out, we never hand-stack coordinates.
//   - TasksSidebarTab (betterSidebar, optional) — the same list as a sidebar
//     tab when the community sidebar is installed.
//
// Reads the suite's /dsh-x/tasks-state route (the package's own durable task
// snapshots, plus a pid liveness probe). The one write — kill — runs the
// package's own `/kill <id>` command through /pi2dsh/pi-command, so its
// escalation and cleanup semantics hold; nothing is reimplemented.
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TaskView {
  id: string
  name?: string
  command: string
  status: string
  alive: boolean
  startTime?: number
  endTime?: number
  exitCode?: number | null
  bytesWritten?: number
  output?: string
}

interface SidebarTabScope { sessionId: string }
interface BetterSidebarService {
  registerTab(descriptor: {
    id: string
    title: string
    component: (props: { scope: SidebarTabScope, visible: boolean }) => ReactNode
  }): () => void
}
export interface TasksUiContext {
  inject(services: string[], apply: (scope: { betterSidebar?: BetterSidebarService }) => void): void
}

const TASKS_PACKAGE = 'pi-background-tasks'

const ui = {
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '2px 10px', borderRadius: '999px', cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
    background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06))', color: 'inherit',
    font: '500 11.5px/1.6 system-ui, -apple-system, sans-serif',
  },
  pulse: {
    width: '8px', height: '8px', borderRadius: '999px', background: '#2FBC44',
  },
  panel: {
    position: 'fixed', right: '20px', bottom: '120px', zIndex: 55,
    width: 'min(420px, 92vw)', maxHeight: '60vh', display: 'flex', flexDirection: 'column',
    pointerEvents: 'auto', overflow: 'hidden', borderRadius: '14px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv3, 0 16px 40px rgba(0,0,0,0.18))',
    font: '400 12.5px/1.5 system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
    borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))',
    font: '600 12.5px/1.4 system-ui, sans-serif',
  },
  headerButton: {
    cursor: 'pointer', opacity: 0.55, background: 'none', border: 'none',
    color: 'inherit', font: 'inherit', padding: '2px 4px',
  },
  body: { overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  tabRoot: {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
    font: '400 12.5px/1.5 system-ui, -apple-system, sans-serif', color: 'inherit',
  },
  card: {
    border: '1px solid rgba(120,120,130,0.25)', borderRadius: '10px', padding: '8px 10px',
    display: 'flex', flexDirection: 'column', gap: '5px',
    background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.03))',
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  name: { font: '600 12.5px/1.4 system-ui, sans-serif', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: {
    fontSize: '10.5px', padding: '1px 7px', borderRadius: '999px',
    border: '1px solid rgba(120,120,130,0.35)', opacity: 0.85,
  },
  badgeLive: { borderColor: 'rgba(47,188,68,0.6)', color: '#2FBC44' },
  command: { font: '400 11px/1.5 ui-monospace, monospace', opacity: 0.7, wordBreak: 'break-all' as const },
  meta: { fontSize: '11px', opacity: 0.6 },
  kill: {
    cursor: 'pointer', border: '1px solid rgba(246,50,24,0.4)', color: '#F63218',
    borderRadius: '7px', padding: '2px 9px', background: 'transparent',
    font: '500 11px/1.5 system-ui, sans-serif',
  },
  outputBox: {
    font: '400 11px/1.5 ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' as const,
    background: 'rgba(127,127,127,0.09)', borderRadius: '8px', padding: '8px',
    maxHeight: '180px', overflowY: 'auto',
  },
  note: { fontSize: '11.5px', padding: '5px 9px', borderRadius: '8px', background: 'rgba(40,159,234,0.12)' },
  empty: { padding: '12px 6px', opacity: 0.6, fontSize: '12px', lineHeight: 1.7 },
} as const

const RUNNING = (task: TaskView): boolean => task.status === 'running' && task.alive

function since(start?: number, end?: number): string {
  if (typeof start !== 'number') return ''
  const seconds = Math.max(0, Math.round(((end ?? Date.now()) - start) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`
}

function useTasks(session: string, active: boolean, watching: string | undefined): TaskView[] {
  const [tasks, setTasks] = useState<TaskView[]>([])
  useEffect(() => {
    if (session === '' || !active) return
    let live = true
    const pull = async () => {
      try {
        const query = watching === undefined ? '' : `&output=${encodeURIComponent(watching)}`
        const response = await fetch(`/dsh-x/tasks-state?session=${encodeURIComponent(session)}${query}`)
        if (!live || !response.ok) return
        const payload = await response.json() as { tasks?: TaskView[] }
        setTasks(payload.tasks ?? [])
      } catch { /* transient poll failure: the next tick retries */ }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 2500)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [session, active, watching])
  return tasks
}

/** The task list + live output + kill — shared by the dock panel and the sidebar tab. */
function TasksListBody({ session, active }: { session: string, active: boolean }): ReactNode {
  const [watching, setWatching] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const tasks = useTasks(session, active, watching)

  const kill = (task: TaskView): void => {
    setNote(undefined)
    void fetch('/pi2dsh/pi-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, package: TASKS_PACKAGE, command: 'kill', args: task.id }),
    }).then(async (response) => {
      const payload = await response.json() as { error?: string, notice?: string }
      setNote(response.ok ? (payload.notice ?? `kill requested for ${task.id}`) : (payload.error ?? 'kill failed'))
    }).catch(error => setNote(String(error)))
  }

  return createElement('div', { style: { display: 'contents' } },
    note === undefined ? null : createElement('div', { style: ui.note, 'data-dsh-x': 'tasks-note' }, note),
    tasks.length === 0 ? createElement('div', { style: ui.empty },
      'No background tasks in this workspace. Ask the agent to run something long with bg_run, or use /bg — the list fills in on its own.') : null,
    ...tasks.map(task => createElement('div', { key: task.id, style: ui.card, 'data-dsh-x': 'tasks-card' },
      createElement('div', { style: ui.cardHead },
        createElement('span', { style: ui.name }, task.name ?? task.id),
        createElement('span', {
          style: { ...ui.badge, ...(RUNNING(task) ? ui.badgeLive : {}) },
          'data-dsh-x': 'tasks-status',
        }, RUNNING(task) ? 'running' : task.status === 'running' ? 'stale' : task.status),
        RUNNING(task) ? createElement('button', { style: ui.kill, 'data-dsh-x': 'tasks-kill', onClick: () => kill(task) }, 'Kill') : null,
      ),
      createElement('div', { style: ui.command }, task.command),
      createElement('div', { style: ui.meta },
        `${task.id} · ${since(task.startTime, task.endTime)}`
        + (typeof task.exitCode === 'number' ? ` · exit ${task.exitCode}` : '')
        + (typeof task.bytesWritten === 'number' ? ` · ${task.bytesWritten}B output` : '')),
      createElement('button', {
        style: { ...ui.headerButton, alignSelf: 'flex-start', opacity: 0.75, padding: 0 },
        'data-dsh-x': 'tasks-output-toggle',
        onClick: () => setWatching(watching === task.id ? undefined : task.id),
      }, watching === task.id ? 'hide output' : 'show output'),
      watching === task.id && task.output !== undefined
        ? createElement('div', { style: ui.outputBox, 'data-dsh-x': 'tasks-output' }, task.output.length > 0 ? task.output : '(no output yet)')
        : null,
    )),
  )
}

/**
 * The chip in the host's composer status row: present only while tasks
 * exist, click for the panel. Receives the session standard kit.
 */
export function TasksChip({ sessionId }: { sessionId?: string }): ReactNode {
  const session = sessionId ?? ''
  const [openPanel, setOpenPanel] = useState(false)
  const tasks = useTasks(session, session !== '', undefined)

  if (session === '' || tasks.length === 0) return null
  const running = tasks.filter(RUNNING)

  return createElement('span', { style: { display: 'inline-flex' } },
    createElement('button', {
      style: ui.chip,
      title: 'Background tasks — click for live output and controls',
      'data-dsh-x': 'tasks-chip',
      onClick: () => setOpenPanel(open => !open),
    },
      running.length > 0 ? createElement('span', { style: ui.pulse }) : null,
      running.length > 0 ? `${running.length} task${running.length > 1 ? 's' : ''} running` : `${tasks.length} task${tasks.length > 1 ? 's' : ''}`,
    ),
    openPanel ? createPortal(createElement('div', { style: ui.panel, 'data-dsh-x': 'tasks-panel' },
      createElement('div', { style: ui.header },
        createElement('span', { style: { flex: 1 } }, 'Background tasks'),
        createElement('button', { style: ui.headerButton, title: 'Close', onClick: () => setOpenPanel(false) }, '×'),
      ),
      createElement('div', { style: ui.body },
        createElement(TasksListBody, { session, active: true }),
      ),
    ), document.body) : null,
  )
}

/** The same list as a sidebar tab (needs the optional dsh-better-sidebar). */
function TasksSidebarTab({ scope, visible }: { scope: SidebarTabScope, visible: boolean }): ReactNode {
  return createElement('div', { style: ui.tabRoot, 'data-dsh-x': 'tasks-tab', 'data-session': scope.sessionId ?? '(none)' },
    createElement(TasksListBody, { session: scope.sessionId ?? '', active: visible }),
  )
}

/** Seat the sidebar tab wherever the community sidebar is installed. */
export function registerTasksSeats(ctx: TasksUiContext): void {
  ctx.inject(['betterSidebar'], (scope) => {
    scope.betterSidebar?.registerTab({
      id: 'dsh-work-x:tasks',
      // Not "Tasks": the sidebar's own built-in Tasks page (subagents) owns
      // that name in the "+" menu, and a colliding title made ours
      // unreachable (2026-08-30, caught by the sidebar E2E).
      title: 'Jobs',
      component: TasksSidebarTab,
    })
  })
}
