// The suite's background-tasks dock: the product face of pi-background-tasks
// on the web — a floating pill that exists only while tasks exist, expanding
// into a list with live output and a kill control.
//
// Reads the suite's /dsh-x/tasks-state route (the package's own durable task
// snapshots, plus a pid liveness probe). The one write — kill — runs the
// package's own `/kill <id>` command through /pi2dsh/pi-command, so its
// escalation and cleanup semantics hold; nothing is reimplemented.
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOnStage } from '../../src/client.js'

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

type SessionsHook = <T>(selector: (state: { current: string }) => T) => T

const TASKS_PACKAGE = 'pi-background-tasks'

const ui = {
  pill: {
    position: 'fixed', right: '20px', bottom: '152px', zIndex: 55,
    height: '38px', borderRadius: '999px', pointerEvents: 'auto',
    display: 'flex', alignItems: 'center', gap: '7px', padding: '0 14px',
    cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv2, 0 6px 20px rgba(0,0,0,0.14))',
    font: '500 12px/1.4 system-ui, -apple-system, sans-serif',
  },
  pulse: {
    width: '8px', height: '8px', borderRadius: '999px', background: '#2FBC44',
  },
  panel: {
    position: 'fixed', right: '20px', bottom: '152px', zIndex: 55,
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

/** Floating dock over the active session; renders nothing when no tasks exist. */
export function TasksDock({ useSessions }: { useSessions: SessionsHook }): ReactNode {
  const session = useOnStage(useSessions as never)
  const [tasks, setTasks] = useState<TaskView[]>([])
  const [openPanel, setOpenPanel] = useState(false)
  const [watching, setWatching] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (session === '') return
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
  }, [session, watching])

  if (session === '' || tasks.length === 0) return null
  const running = tasks.filter(RUNNING)

  if (!openPanel) {
    return createPortal(createElement('button', {
      style: ui.pill,
      title: 'Background tasks',
      'data-dsh-x': 'tasks-pill',
      onClick: () => setOpenPanel(true),
    },
      running.length > 0 ? createElement('span', { style: ui.pulse }) : null,
      running.length > 0 ? `${running.length} task${running.length > 1 ? 's' : ''} running` : `${tasks.length} task${tasks.length > 1 ? 's' : ''}`,
    ), document.body)
  }

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

  return createPortal(createElement('div', { style: ui.panel, 'data-dsh-x': 'tasks-panel' },
    createElement('div', { style: ui.header },
      createElement('span', { style: { flex: 1 } }, 'Background tasks'),
      createElement('button', { style: ui.headerButton, title: 'Close', onClick: () => setOpenPanel(false) }, '×'),
    ),
    createElement('div', { style: ui.body },
      note === undefined ? null : createElement('div', { style: ui.note, 'data-dsh-x': 'tasks-note' }, note),
      tasks.length === 0 ? createElement('div', { style: ui.empty }, 'No background tasks in this workspace.') : null,
      ...tasks.map(task => createElement('div', { key: task.id, style: ui.card, 'data-dsh-x': 'tasks-card' },
        createElement('div', { style: ui.cardHead },
          createElement('span', { style: ui.name }, task.name ?? task.id),
          createElement('span', {
            style: { ...ui.badge, ...(RUNNING(task) ? ui.badgeLive : {}) },
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
    ),
  ), document.body)
}
