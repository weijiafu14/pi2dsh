// The suite's memory manager: the product face of pi-hermes-memory — a
// floating window (dot → panel, dismissible, session-scoped) listing pinned
// standing rules and project / global / user memories, with search and pin
// management.
//
// Two seats, one data path:
//   - SettingsMemorySection (settings.section, stock) — a full Memory page
//     in Settings, where ChatGPT and Claude also put memory management. Pin
//     writes go through /pi2dsh/pi-command with an empty session — the
//     engine routes that to any session where the package is mounted (the
//     command's effect is global state either way).
//   - MemorySidebarTab (betterSidebar, optional) — the same panel as a
//     sidebar tab when the community sidebar is installed.
//
// Reads the suite's /dsh-x/memory-state route (the package's own Markdown
// files — MEMORY.md / USER.md / STANDING.md / projects-memory — read-only).
// The pin writes run the package's own `/memory-pin` command through
// /pi2dsh/pi-command: STANDING.md keeps exactly one writer besides the
// user's editor, which is the package's own anti-injection design.
import { createElement, useEffect, useState, type ReactNode } from 'react'

interface MemoryEntry { text: string, created?: string, last?: string }
interface MemoryStateView {
  global: MemoryEntry[]
  user: MemoryEntry[]
  standing: string[]
  standingBudget: { entries: number, maxEntries: number, chars: number, maxChars: number }
  projects: Record<string, MemoryEntry[]>
}

interface SidebarTabScope { sessionId: string }
interface BetterSidebarService {
  registerTab(descriptor: {
    id: string
    title: string
    component: (props: { scope: SidebarTabScope, visible: boolean }) => ReactNode
  }): () => void
}
export interface MemoryUiContext {
  inject(services: string[], apply: (scope: { betterSidebar?: BetterSidebarService }) => void): void
}

const MEMORY_PACKAGE = 'pi-hermes-memory'

const ui = {
  body: { overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '9px' },
  sub: { opacity: 0.65, fontSize: '12px' },
  group: { font: '600 11px/1.4 system-ui, sans-serif', opacity: 0.55, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginTop: '4px' },
  search: {
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))', borderRadius: '8px',
    padding: '6px 10px', font: 'inherit', color: 'inherit', background: 'transparent', outline: 'none',
  },
  entry: {
    border: '1px solid rgba(120,120,130,0.22)', borderRadius: '9px', padding: '7px 10px',
    display: 'flex', flexDirection: 'column', gap: '3px',
    background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.03))',
  },
  entryText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' as const, fontSize: '12.5px' },
  entryMeta: { fontSize: '10.5px', opacity: 0.55 },
  pinRow: { display: 'flex', alignItems: 'flex-start', gap: '8px' },
  pinRemove: {
    cursor: 'pointer', border: '1px solid rgba(246,50,24,0.35)', color: '#F63218',
    borderRadius: '7px', padding: '1px 8px', background: 'transparent',
    font: '500 10.5px/1.5 system-ui, sans-serif', flexShrink: 0,
  },
  pinAddRow: { display: 'flex', gap: '6px' },
  pinAddButton: {
    cursor: 'pointer', border: 'none', borderRadius: '8px', padding: '6px 11px',
    background: 'var(--dsw-alias-button-primary-fill, #1869F5)', color: '#fff',
    font: '500 12px/1.3 system-ui, sans-serif', flexShrink: 0,
  },
  note: { fontSize: '12px', padding: '6px 10px', borderRadius: '8px', background: 'rgba(40,159,234,0.12)' },
  noteError: { fontSize: '12px', padding: '6px 10px', borderRadius: '8px', background: 'rgba(246,50,24,0.1)', color: '#F63218' },
  empty: { padding: '12px', borderRadius: '10px', border: '1px dashed rgba(120,120,130,0.4)', fontSize: '12.5px', lineHeight: 1.7 },
  budget: { fontSize: '10.5px', opacity: 0.55 },
} as const

async function runMemoryCommand(session: string, command: string, args: string): Promise<{ ok: boolean, detail?: string }> {
  try {
    const response = await fetch('/pi2dsh/pi-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, package: MEMORY_PACKAGE, command, args }),
    })
    const payload = await response.json() as { error?: string, notice?: string }
    if (!response.ok) return { ok: false, detail: payload.error ?? 'the command failed' }
    return { ok: true, ...(payload.notice === undefined ? {} : { detail: payload.notice }) }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
}

function matches(query: string, text: string): boolean {
  return query.length === 0 || text.toLowerCase().includes(query.toLowerCase())
}

function entryCard(entry: MemoryEntry, key: string): ReactNode {
  return createElement('div', { key, style: ui.entry, 'data-dsh-x': 'memory-entry' },
    createElement('div', { style: ui.entryText }, entry.text),
    entry.created === undefined ? null : createElement('div', { style: ui.entryMeta },
      `created ${entry.created}` + (entry.last !== undefined && entry.last !== entry.created ? ` · updated ${entry.last}` : '')),
  )
}

/** The panel content — fetch, pins, search, groups — shared by both seats. */
function MemoryPanelBody({ session, active }: { session: string, active: boolean }): ReactNode {
  const [state, setState] = useState<MemoryStateView | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [pinDraft, setPinDraft] = useState('')
  const [note, setNote] = useState<{ text: string, tone: 'info' | 'error' } | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!active) return
    let live = true
    const pull = async () => {
      try {
        const response = await fetch('/dsh-x/memory-state')
        if (!live) return
        if (!response.ok) {
          setFailed(true)
          return
        }
        setState(await response.json() as MemoryStateView)
        setFailed(false)
      } catch {
        if (live) setFailed(true)
      }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 5000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [active, generation])

  if (failed && state === undefined) {
    return createElement('div', { style: ui.empty }, 'The memory route is not answering — is the dsh-work-x suite mounted in this profile?')
  }
  if (state === undefined) {
    return createElement('div', { style: ui.sub }, 'Loading memory…')
  }

  const afterWrite = (result: { ok: boolean, detail?: string }, fallback: string): void => {
    setNote(result.ok ? { text: result.detail ?? fallback, tone: 'info' } : { text: result.detail ?? 'the command failed', tone: 'error' })
    setGeneration(value => value + 1)
  }
  const removePin = (position: number): void => {
    void runMemoryCommand(session, 'memory-pin', `remove ${position}`).then(result => afterWrite(result, 'pin removed'))
  }
  const addPin = (): void => {
    const text = pinDraft.trim()
    if (text.length === 0) return
    setPinDraft('')
    void runMemoryCommand(session, 'memory-pin', text).then(result => afterWrite(result, 'pinned'))
  }

  const total = state.global.length + state.user.length
    + Object.values(state.projects).reduce((sum, entries) => sum + entries.length, 0)
  const groups: Array<[string, MemoryEntry[]]> = [
    ...Object.entries(state.projects).map(([name, entries]): [string, MemoryEntry[]] => [`Project · ${name}`, entries]),
    ['Global', state.global],
    ['About you', state.user],
  ]

  return createElement('div', { style: { display: 'contents' } },
    createElement('div', { style: ui.sub, 'data-dsh-x': 'memory-counts' },
      `${total} memories · ${state.standing.length} pinned`),
    note === undefined ? null : createElement('div', { style: note.tone === 'error' ? ui.noteError : ui.note, 'data-dsh-x': 'memory-note' }, note.text),
    createElement('div', { style: ui.group }, 'Pinned rules (every session, every turn)'),
    ...state.standing.map((text, index) => createElement('div', { key: `pin-${index}`, style: { ...ui.entry, flexDirection: 'row', ...ui.pinRow }, 'data-dsh-x': 'memory-pin' },
      createElement('div', { style: { ...ui.entryText, flex: 1 } }, `${index + 1}. ${text}`),
      createElement('button', { style: ui.pinRemove, 'data-dsh-x': 'memory-pin-remove', onClick: () => removePin(index + 1) }, 'Unpin'),
    )),
    createElement('div', { style: ui.pinAddRow },
      createElement('input', {
        style: { ...ui.search, flex: 1 },
        placeholder: 'Pin a rule that must always hold…',
        value: pinDraft,
        'data-dsh-x': 'memory-pin-input',
        onChange: (event: { target: { value: string } }) => setPinDraft(event.target.value),
        onKeyDown: (event: { key: string, preventDefault(): void }) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addPin()
          }
        },
      }),
      createElement('button', { style: ui.pinAddButton, 'data-dsh-x': 'memory-pin-add', onClick: addPin }, 'Pin'),
    ),
    createElement('div', { style: ui.budget },
      `${state.standingBudget.entries}/${state.standingBudget.maxEntries} pins · ${state.standingBudget.chars}/${state.standingBudget.maxChars} chars — pins are injected into every turn, so the budget is deliberately hard`),
    total === 0 ? createElement('div', { style: ui.empty },
      'No durable memories yet. Ask the agent to remember something ("remember that …") — its memory tools write here, and the background review distills lessons on its own.') : null,
    total > 0 ? createElement('input', {
      style: ui.search,
      placeholder: 'Search memories…',
      value: query,
      'data-dsh-x': 'memory-search',
      onChange: (event: { target: { value: string } }) => setQuery(event.target.value),
    }) : null,
    ...groups.flatMap(([title, entries]) => {
      const visibleEntries = entries.filter(entry => matches(query, entry.text))
      if (visibleEntries.length === 0) return []
      return [
        createElement('div', { key: `g-${title}`, style: ui.group }, title),
        ...visibleEntries.map((entry, index) => entryCard(entry, `${title}-${index}`)),
      ]
    }),
    total > 0 ? createElement('div', { style: ui.sub },
      "Read-only list — edits and deletions go through the agent's own memory tools or the /memory-* commands, so the package's store and its search index never drift apart.") : null,
  )
}

/** The Settings page: full memory management, always reachable. */
export function SettingsMemorySection(): ReactNode {
  return createElement('div', { style: { ...ui.body, overflowY: 'visible' }, 'data-dsh-x': 'memory-tab' },
    createElement('div', { style: { font: '600 13px/1.4 system-ui, sans-serif' } }, 'Memory'),
    createElement('div', { style: ui.sub },
      'What the agent durably remembers across sessions, and the rules pinned into every turn.'),
    createElement(MemoryPanelBody, { session: '', active: true }),
  )
}

/** The same panel as a sidebar tab (needs the optional dsh-better-sidebar). */
function MemorySidebarTab({ scope, visible }: { scope: SidebarTabScope, visible: boolean }): ReactNode {
  return createElement('div', { style: { ...ui.body, overflowY: 'visible' }, 'data-dsh-x': 'memory-tab' },
    createElement(MemoryPanelBody, { session: scope.sessionId ?? '', active: visible }),
  )
}

/** Seat the sidebar tab wherever the community sidebar is installed. */
export function registerMemorySeats(ctx: MemoryUiContext): void {
  ctx.inject(['betterSidebar'], (scope) => {
    scope.betterSidebar?.registerTab({
      id: 'dsh-work-x:memory',
      title: 'Memory',
      component: MemorySidebarTab,
    })
  })
}
