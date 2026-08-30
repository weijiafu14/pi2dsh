// The suite's memory manager: the product face of pi-hermes-memory — a
// floating window (dot → panel, dismissible, session-scoped) listing pinned
// standing rules and project / global / user memories, with search and pin
// management. Seated in shell.overlay: the overlay standard kit carries the
// sessions hook, and the ACTIVE session is what makes the package's command
// runner reachable for the pin writes. (The sidebar-tab seat was rejected:
// `betterSidebar` is a third-party service no stock composition provides.)
//
// Reads the suite's /dsh-x/memory-state route (the package's own Markdown
// files — MEMORY.md / USER.md / STANDING.md / projects-memory — read-only).
// The pin writes run the package's own `/memory-pin` command through
// /pi2dsh/pi-command: STANDING.md keeps exactly one writer besides the
// user's editor, which is the package's own anti-injection design.
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOnStage } from '../../src/client.js'

interface MemoryEntry { text: string, created?: string, last?: string }
interface MemoryStateView {
  global: MemoryEntry[]
  user: MemoryEntry[]
  standing: string[]
  standingBudget: { entries: number, maxEntries: number, chars: number, maxChars: number }
  projects: Record<string, MemoryEntry[]>
}

type SessionsHook = <T>(selector: (state: { current: string }) => T) => T

const MEMORY_PACKAGE = 'pi-hermes-memory'

const ui = {
  dot: {
    position: 'fixed', right: '20px', bottom: '196px', zIndex: 55,
    width: '38px', height: '38px', borderRadius: '999px', pointerEvents: 'auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv2, 0 6px 20px rgba(0,0,0,0.14))',
    fontSize: '17px',
  },
  panel: {
    position: 'fixed', right: '20px', bottom: '196px', zIndex: 56,
    width: 'min(420px, 92vw)', maxHeight: '62vh', display: 'flex', flexDirection: 'column',
    pointerEvents: 'auto', overflow: 'hidden', borderRadius: '14px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv3, 0 16px 40px rgba(0,0,0,0.18))',
    font: '400 13px/1.5 system-ui, -apple-system, sans-serif',
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

/** The floating memory window over the active session. */
export function MemoryWindow({ useSessions }: { useSessions: SessionsHook }): ReactNode {
  const session = useOnStage(useSessions as never)
  const [openPanel, setOpenPanel] = useState(false)
  const [state, setState] = useState<MemoryStateView | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [pinDraft, setPinDraft] = useState('')
  const [note, setNote] = useState<{ text: string, tone: 'info' | 'error' } | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!openPanel) return
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
  }, [openPanel, generation])

  if (session === '') return null

  if (!openPanel) {
    return createPortal(createElement('button', {
      style: ui.dot,
      title: 'Memory — what the agent remembers across sessions',
      'data-dsh-x': 'memory-dot',
      onClick: () => setOpenPanel(true),
    }, '🧠'), document.body)
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

  let body: ReactNode
  if (failed && state === undefined) {
    body = createElement('div', { style: ui.empty }, 'The memory route is not answering — is the dsh-work-x suite mounted in this profile?')
  } else if (state === undefined) {
    body = createElement('div', { style: ui.sub }, 'Loading memory…')
  } else {
    const total = state.global.length + state.user.length
      + Object.values(state.projects).reduce((sum, entries) => sum + entries.length, 0)
    const groups: Array<[string, MemoryEntry[]]> = [
      ...Object.entries(state.projects).map(([name, entries]): [string, MemoryEntry[]] => [`Project · ${name}`, entries]),
      ['Global', state.global],
      ['About you', state.user],
    ]
    body = createElement('div', { style: { display: 'contents' } },
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
        'Read-only list — edits and deletions go through the agent\'s own memory tools or the /memory-* commands, so the package\'s store and its search index never drift apart.') : null,
    )
  }

  return createPortal(createElement('div', { style: ui.panel, 'data-dsh-x': 'memory-tab' },
    createElement('div', { style: ui.header },
      createElement('span', { style: { flex: 1 } }, 'Memory'),
      state === undefined ? null : createElement('span', { style: ui.sub },
        `${state.global.length + state.user.length + Object.values(state.projects).reduce((sum, entries) => sum + entries.length, 0)} memories · ${state.standing.length} pinned`),
      createElement('button', { style: ui.headerButton, title: 'Close', onClick: () => setOpenPanel(false) }, '×'),
    ),
    createElement('div', { style: ui.body }, body),
  ), document.body)
}
