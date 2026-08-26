// The suite's side-chat window: the product face of pi-btw's side
// conversations, in the form the mainstream assistants give this feature —
// a floating chat card (Claude Code's "Side chat", Codex's floating thread),
// not a read-only transcript.
//
// Every submission RUNS pi-btw's own slash command through the engine's
// /pi2dsh/pi-command route ("/btw <text>", "--save", "/btw:inject"), so the
// package's session reuse, model fallback and save semantics all hold —
// nothing is reimplemented, no message is forged. The thread view reads the
// engine's /pi2dsh/browser-state, the same data its plain panel drew.
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ThreadMessage { role: string, text: string }
interface ThreadView {
  id: string
  label: string
  package?: string
  running: boolean
  messages: ThreadMessage[]
}

type SessionsHook = <T>(selector: (state: { current: string }) => T) => T

const SIDE_PACKAGE = 'pi-btw'

const ui = {
  window: {
    position: 'fixed', right: '20px', bottom: '108px', zIndex: 55,
    width: '360px', maxHeight: '56vh', display: 'flex', flexDirection: 'column',
    pointerEvents: 'auto', overflow: 'hidden',
    borderRadius: '14px', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)',
    color: 'inherit',
    boxShadow: 'var(--dsw-shadow-lv3, 0 16px 40px rgba(0,0,0,0.18))',
    font: '400 13px/1.55 system-ui, -apple-system, sans-serif',
  },
  windowMax: {
    right: '20px', bottom: '20px', top: '64px', width: 'min(560px, 90vw)', maxHeight: 'none',
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
  body: {
    padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column',
    gap: '10px', flex: 1, minHeight: '80px',
  },
  bubbleUser: {
    alignSelf: 'flex-end', maxWidth: '85%', padding: '7px 11px',
    borderRadius: '12px 12px 4px 12px',
    background: 'var(--dsw-alias-interactive-bg-active, rgba(0,0,0,0.06))',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start', maxWidth: '92%',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  emptyNote: {
    padding: '14px 6px', opacity: 0.6, fontSize: '12.5px', lineHeight: 1.7,
  },
  working: { opacity: 0.55, fontSize: '12px', fontStyle: 'italic' },
  noteError: {
    fontSize: '12px', padding: '6px 10px', borderRadius: '8px',
    background: 'rgba(246,50,24,0.1)', color: '#F63218',
  },
  noteInfo: {
    fontSize: '12px', padding: '6px 10px', borderRadius: '8px',
    background: 'rgba(40,159,234,0.12)',
  },
  footer: {
    borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))',
    padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px',
  },
  inputRow: { display: 'flex', gap: '6px', alignItems: 'flex-end' },
  input: {
    flex: 1, resize: 'none', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
    borderRadius: '10px', padding: '7px 10px', font: 'inherit', color: 'inherit',
    background: 'transparent', outline: 'none', maxHeight: '96px',
  },
  send: {
    cursor: 'pointer', border: 'none', borderRadius: '10px', padding: '7px 12px',
    background: 'var(--dsw-alias-button-primary-fill, #1869F5)', color: '#fff',
    font: '500 12.5px/1.3 system-ui, sans-serif',
  },
  actionRow: {
    display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', opacity: 0.75,
  },
  actionButton: {
    cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
    borderRadius: '999px', padding: '2px 10px', background: 'transparent',
    color: 'inherit', font: '500 11px/1.5 system-ui, sans-serif',
  },
  saveLabel: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none' },
  dot: {
    position: 'fixed', right: '20px', bottom: '64px', zIndex: 55,
    width: '38px', height: '38px', borderRadius: '999px', pointerEvents: 'auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)',
    boxShadow: 'var(--dsw-shadow-lv2, 0 6px 20px rgba(0,0,0,0.14))',
    fontSize: '17px',
  },
} as const

async function runSideCommand(
  session: string,
  packageName: string,
  command: string,
  args: string,
): Promise<{ ok: boolean, detail?: string }> {
  try {
    const response = await fetch('/pi2dsh/pi-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, package: packageName, command, args }),
    })
    const payload = await response.json() as { error?: string, notice?: string }
    if (!response.ok) return { ok: false, detail: payload.error ?? 'the command failed' }
    return { ok: true, ...(payload.notice === undefined ? {} : { detail: payload.notice }) }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
}

/** The suite's floating side-chat window over the active session. */
export function SideChatWindow({ useSessions }: { useSessions: SessionsHook }): ReactNode {
  const session = useSessions(state => state.current) ?? ''
  const [threads, setThreads] = useState<ThreadView[]>([])
  const [mode, setMode] = useState<'dot' | 'panel' | 'max'>('dot')
  const [opened, setOpened] = useState(false)
  const [draft, setDraft] = useState('')
  const [save, setSave] = useState(false)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<{ text: string, tone: 'info' | 'error' } | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const seenCount = useRef(0)

  useEffect(() => {
    if (session === '') return
    let live = true
    const pull = async () => {
      try {
        const response = await fetch(`/pi2dsh/browser-state?session=${encodeURIComponent(session)}`)
        if (!live || !response.ok) return
        const payload = await response.json() as { threads?: ThreadView[] }
        setThreads(payload.threads ?? [])
      } catch { /* transient poll failure: the next tick retries */ }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 2000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [session])

  const thread = threads.length > 0 ? threads[threads.length - 1] : undefined
  const messages = thread?.messages ?? []

  // A fresh answer clears the pending state and auto-opens a closed window
  // ONCE per new content (the arrival is the point of the feature).
  useEffect(() => {
    if (messages.length > seenCount.current) {
      seenCount.current = messages.length
      setPending(false)
      if (!opened) {
        setMode('panel')
        setOpened(true)
      }
    }
  }, [messages.length, opened])
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [messages.length, pending])

  if (session === '') return null

  // Portal to <body>: the shell.overlay slot lives in a z-index:20 stacking
  // context, below the sidebar's fixed column — nothing inside it can float
  // above the sidebar, whatever its own z-index says.
  if (mode === 'dot') {
    return createPortal(createElement('button', {
      style: ui.dot,
      title: 'Side chat — ask without touching the main thread',
      'data-dsh-x': 'side-chat-dot',
      onClick: () => {
        setMode('panel')
        setOpened(true)
      },
    }, '💬'), document.body)
  }

  const submit = (): void => {
    const text = draft.trim()
    if (text.length === 0 || pending) return
    setDraft('')
    setNote(undefined)
    setPending(true)
    void runSideCommand(session, thread?.package ?? SIDE_PACKAGE, 'btw', save ? `${text} --save` : text)
      .then((result) => {
        if (!result.ok) {
          setPending(false)
          setNote({ text: result.detail ?? 'the command failed', tone: 'error' })
        }
      })
  }

  return createPortal(createElement('div', {
    style: { ...ui.window, ...(mode === 'max' ? ui.windowMax : {}) },
    'data-dsh-x': 'side-chat',
  },
    createElement('div', { style: ui.header },
      createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        'Side chat'),
      thread === undefined ? null : createElement('button', {
        style: ui.headerButton,
        title: 'Summarize this side thread and inject the summary into the main agent',
        'data-dsh-x': 'side-chat-inject',
        onClick: () => {
          setNote(undefined)
          void runSideCommand(session, thread.package ?? SIDE_PACKAGE, 'btw:inject', '')
            .then(result => setNote(result.ok ? { text: 'summary injected into the main conversation', tone: 'info' } : { text: result.detail ?? 'inject failed', tone: 'error' }))
        },
      }, '⤴ Inject'),
      createElement('button', {
        style: ui.headerButton,
        title: mode === 'max' ? 'Shrink' : 'Expand',
        onClick: () => setMode(mode === 'max' ? 'panel' : 'max'),
      }, mode === 'max' ? '⤡' : '⤢'),
      createElement('button', {
        style: ui.headerButton, title: 'Close',
        onClick: () => setMode('dot'),
      }, '×'),
    ),
    createElement('div', { style: ui.body, ref: bodyRef },
      messages.length === 0 && !pending ? createElement('div', { style: ui.emptyNote },
        'Ask a quick question without touching the main thread. The side chat sees the main conversation\'s context; answers stay here unless you save or inject them.') : null,
      ...messages.map((message, index) => createElement('div', {
        key: index,
        style: message.role === 'user' ? ui.bubbleUser : ui.bubbleAssistant,
      }, message.text)),
      pending || thread?.running === true
        ? createElement('div', { style: ui.working }, 'Answering…')
        : null,
      note === undefined ? null : createElement('div', { style: note.tone === 'error' ? ui.noteError : ui.noteInfo, 'data-dsh-x': 'side-chat-note' }, note.text),
    ),
    createElement('div', { style: ui.footer },
      createElement('div', { style: ui.inputRow },
        createElement('textarea', {
          style: ui.input,
          rows: 1,
          placeholder: 'Ask a quick question…',
          value: draft,
          'data-dsh-x': 'side-chat-input',
          onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
          onKeyDown: (event: { key: string, shiftKey: boolean, preventDefault(): void }) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          },
        }),
        createElement('button', { style: ui.send, onClick: submit, 'data-dsh-x': 'side-chat-send' }, 'Send'),
      ),
      createElement('div', { style: ui.actionRow },
        createElement('label', { style: ui.saveLabel },
          createElement('input', {
            type: 'checkbox',
            checked: save,
            onChange: (event: { target: { checked: boolean } }) => setSave(event.target.checked),
          }),
          'also save into the main conversation'),
      ),
    ),
  ), document.body)
}
