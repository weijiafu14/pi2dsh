// The suite's native MCP tab, seated in dsh-better-sidebar when it is
// installed (optional injection — without the sidebar nothing mounts and
// nothing breaks). This is PRODUCT UI, deliberately not the engine's ANSI
// scene projection: real buttons over structured data.
//
// Data honesty: the tab shows the CONFIGURED layer — the MCP ecosystem's own
// layered config files, read server-side by the engine's /pi2dsh/mcp-state
// route. Secret values never reach the browser (env/header key NAMES only).
// The toggle persists exactly what pi-mcp-adapter's own /mcp disable writes:
// the `disabled` flag in the project-local override layer.
import { createElement, useEffect, useState, type ReactNode } from 'react'

type UnknownRecord = Record<string, unknown>

interface McpServerView {
  name: string
  transport: string
  target: string
  disabled: boolean
  sourcePath: string
  envKeys: string[]
  headerKeys: string[]
}

interface McpStateView {
  cwd: string
  sources: string[]
  servers: McpServerView[]
}

interface SidebarTabScope {
  sessionId: string
}

interface BetterSidebarService {
  registerTab(descriptor: {
    id: string
    title: string
    component: (props: { scope: SidebarTabScope, visible: boolean }) => ReactNode
  }): () => void
}

interface McpTabContext {
  inject(services: string[], apply: (scope: { betterSidebar: BetterSidebarService }) => void): void
}

const ui = {
  root: {
    display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
    font: '400 13px/1.5 system-ui, -apple-system, sans-serif',
    color: 'var(--dsh-color-text, #1b1b1b)',
  },
  headline: { font: '600 13px/1.4 system-ui, sans-serif', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  sub: { opacity: 0.65, fontSize: '12px' },
  card: {
    border: '1px solid rgba(120,120,130,0.25)', borderRadius: '10px', padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: '6px',
    background: 'var(--dsh-color-bg-elevated, rgba(127,127,127,0.04))',
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  name: { font: '600 13px/1.4 ui-monospace, monospace' },
  badge: {
    fontSize: '10.5px', padding: '1px 7px', borderRadius: '999px',
    border: '1px solid rgba(120,120,130,0.35)', opacity: 0.8,
  },
  target: { font: '400 11.5px/1.5 ui-monospace, monospace', opacity: 0.75, wordBreak: 'break-all' as const },
  meta: { fontSize: '11px', opacity: 0.6 },
  toggle: {
    marginLeft: 'auto', fontSize: '12px', padding: '3px 10px', borderRadius: '7px',
    border: '1px solid rgba(120,120,130,0.4)', background: 'transparent',
    color: 'inherit', cursor: 'pointer',
  },
  note: { fontSize: '12px', padding: '6px 10px', borderRadius: '8px', background: 'rgba(40,159,234,0.12)' },
  empty: { padding: '14px', borderRadius: '10px', border: '1px dashed rgba(120,120,130,0.4)', fontSize: '12.5px', lineHeight: 1.7 },
  code: { font: '500 11.5px/1.5 ui-monospace, monospace', background: 'rgba(127,127,127,0.12)', padding: '1px 5px', borderRadius: '4px' },
}

function McpTab({ scope, visible }: { scope: SidebarTabScope, visible: boolean }): ReactNode {
  const [state, setState] = useState<McpStateView | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!visible) return
    let live = true
    const pull = async () => {
      try {
        const response = await fetch(`/pi2dsh/mcp-state?session=${encodeURIComponent(scope.sessionId ?? '')}`)
        if (!live) return
        if (!response.ok) {
          setFailed(true)
          return
        }
        setState(await response.json() as McpStateView)
        setFailed(false)
      } catch {
        if (live) setFailed(true)
      }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 4000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [visible, scope.sessionId])

  const toggle = async (server: McpServerView) => {
    try {
      const response = await fetch('/pi2dsh/mcp-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: scope.sessionId ?? '', server: server.name, disabled: !server.disabled }),
      })
      const payload = await response.json() as UnknownRecord
      if (!response.ok) {
        setNote(String(payload.error ?? 'the toggle failed'))
        return
      }
      setNote(`${server.name} ${server.disabled ? 'enabled' : 'disabled'} — ${String(payload.note ?? '')}`)
      setState(current => current === undefined ? current : {
        ...current,
        servers: current.servers.map(entry => entry.name === server.name ? { ...entry, disabled: !server.disabled } : entry),
      })
    } catch (error) {
      setNote(String(error))
    }
  }

  if (failed && state === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-tab' },
      createElement('div', { style: ui.empty }, 'The MCP state route is not answering — is the pi2dsh engine mounted in this profile?'))
  }
  if (state === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-tab' },
      createElement('div', { style: ui.sub }, 'Loading MCP configuration…'))
  }
  return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-tab' },
    createElement('div', { style: ui.headline },
      createElement('span', null, 'MCP servers'),
      createElement('span', { style: ui.sub }, `${state.servers.length} configured`),
    ),
    note === undefined ? null : createElement('div', { style: ui.note, 'data-dsh-x': 'mcp-note' }, note),
    state.servers.length === 0
      ? createElement('div', { style: ui.empty },
          'No MCP servers configured yet. Add one to ',
          createElement('span', { style: ui.code }, '.mcp.json'),
          ' in your workspace (the same format Claude Code and Cursor read):',
          createElement('pre', { style: { ...ui.code, display: 'block', padding: '8px', marginTop: '6px', whiteSpace: 'pre' } },
            '{\n  "mcpServers": {\n    "everything": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-everything"]\n    }\n  }\n}'),
          'New sessions pick it up automatically. For discovery, OAuth and per-tool controls, run ',
          createElement('span', { style: ui.code }, '/mcp'),
          ' in the composer.')
      : state.servers.map(server => createElement('div', { key: server.name, style: { ...ui.card, opacity: server.disabled ? 0.55 : 1 }, 'data-dsh-x': 'mcp-server' },
          createElement('div', { style: ui.cardHead },
            createElement('span', { style: ui.name }, server.name),
            createElement('span', { style: ui.badge }, server.transport),
            server.disabled ? createElement('span', { style: ui.badge }, 'disabled') : null,
            createElement('button', {
              style: ui.toggle,
              title: server.disabled ? 'Enable this server' : 'Disable this server',
              onClick: () => { void toggle(server) },
            }, server.disabled ? 'Enable' : 'Disable'),
          ),
          createElement('div', { style: ui.target }, server.target),
          createElement('div', { style: ui.meta },
            `from ${server.sourcePath.split('/').slice(-2).join('/')}`
            + (server.envKeys.length > 0 ? ` · env: ${server.envKeys.join(', ')}` : '')
            + (server.headerKeys.length > 0 ? ` · headers: ${server.headerKeys.join(', ')}` : '')),
        )),
    createElement('div', { style: ui.meta },
      `layers: ${state.sources.length === 0 ? 'none found' : state.sources.map(source => source.split('/').slice(-2).join('/')).join(' → ')}`),
  )
}

/** Seat the tab in better-sidebar when (and only when) it is composed. */
export function registerMcpTab(ctx: McpTabContext): void {
  ctx.inject(['betterSidebar'], (scope) => {
    scope.betterSidebar.registerTab({
      id: 'dsh-x:mcp',
      title: 'MCP',
      component: McpTab,
    })
  })
}
