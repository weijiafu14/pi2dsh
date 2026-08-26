// The suite's native MCP UI, in the two seats where each scope belongs:
//
//   settings.section  — the GLOBAL view (cross-project config layers), the
//                       place users expect "manage MCP for my machine".
//                       Toggles write the agent-dir global layer.
//   better-sidebar tab — the SESSION view: the merged configuration this
//                       session actually runs with, grouped by layer, which
//                       answers "why does this session (not) have server X".
//                       Toggles write the project-local override only.
//
// Both are PRODUCT UI over structured data — deliberately not the engine's
// ANSI scene projection. Data honesty: the engine's /pi2dsh/mcp-state route
// reads the MCP ecosystem's own layered config files server-side; secret
// values never reach the browser (env/header key NAMES only). Toggles
// persist ONLY the `disabled` flag — the project scope writes the exact file
// pi-mcp-adapter's own /mcp disable writes.
import { createElement, useEffect, useState, type ReactNode } from 'react'

type UnknownRecord = Record<string, unknown>

interface McpServerView {
  name: string
  transport: string
  target: string
  disabled: boolean
  sourcePath: string
  layer: 'global' | 'project'
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

interface SlotRegistration { name: string, id?: string, order?: number, label?: () => string }
export interface McpUiContext {
  inject(services: string[], apply: (scope: {
    betterSidebar?: BetterSidebarService
    slots?: {
      inject(name: string, apply: () => unknown): void
      register(registration: SlotRegistration, component: unknown): () => void
    }
  }) => void): void
}

const ui = {
  root: {
    display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
    font: '400 13px/1.5 system-ui, -apple-system, sans-serif',
    color: 'inherit',
  },
  headline: { font: '600 13px/1.4 system-ui, sans-serif', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  group: { font: '600 11px/1.4 system-ui, sans-serif', opacity: 0.55, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginTop: '4px' },
  sub: { opacity: 0.65, fontSize: '12px' },
  card: {
    border: '1px solid rgba(120,120,130,0.25)', borderRadius: '10px', padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: '6px',
    background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.04))',
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

function useMcpState(session: string, active: boolean): {
  state: McpStateView | undefined
  failed: boolean
  patch: (update: (current: McpStateView) => McpStateView) => void
} {
  const [state, setState] = useState<McpStateView | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!active) return
    let live = true
    const pull = async () => {
      try {
        const response = await fetch(`/pi2dsh/mcp-state?session=${encodeURIComponent(session)}`)
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
  }, [active, session])
  return { state, failed, patch: update => setState(current => current === undefined ? current : update(current)) }
}

function serverCard(
  server: McpServerView,
  onToggle: (server: McpServerView) => void,
  toggleTitle: string,
): ReactNode {
  return createElement('div', { key: server.name, style: { ...ui.card, opacity: server.disabled ? 0.55 : 1 }, 'data-dsh-x': 'mcp-server' },
    createElement('div', { style: ui.cardHead },
      createElement('span', { style: ui.name }, server.name),
      createElement('span', { style: ui.badge }, server.transport),
      server.disabled ? createElement('span', { style: ui.badge }, 'disabled') : null,
      createElement('button', {
        style: ui.toggle,
        title: toggleTitle,
        onClick: () => onToggle(server),
      }, server.disabled ? 'Enable' : 'Disable'),
    ),
    createElement('div', { style: ui.target }, server.target),
    createElement('div', { style: ui.meta },
      `from ${server.sourcePath.split('/').slice(-2).join('/')}`
      + (server.envKeys.length > 0 ? ` · env: ${server.envKeys.join(', ')}` : '')
      + (server.headerKeys.length > 0 ? ` · headers: ${server.headerKeys.join(', ')}` : '')),
  )
}

function emptyGuide(): ReactNode {
  return createElement('div', { style: ui.empty },
    'No MCP servers configured yet. Add one to ',
    createElement('span', { style: ui.code }, '.mcp.json'),
    ' in your workspace, or globally to ',
    createElement('span', { style: ui.code }, '~/.config/mcp/mcp.json'),
    ' (the same format Claude Code and Cursor read):',
    createElement('pre', { style: { ...ui.code, display: 'block', padding: '8px', marginTop: '6px', whiteSpace: 'pre' } },
      '{\n  "mcpServers": {\n    "everything": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-everything"]\n    }\n  }\n}'),
    'New sessions pick it up automatically. For discovery, OAuth and per-tool controls, run ',
    createElement('span', { style: ui.code }, '/mcp'),
    ' in the composer.')
}

function useToggle(
  session: string,
  scope: 'project' | 'global',
  patch: (update: (current: McpStateView) => McpStateView) => void,
): { note: string | undefined, toggle: (server: McpServerView) => void } {
  const [note, setNote] = useState<string | undefined>(undefined)
  const toggle = (server: McpServerView): void => {
    void (async () => {
      try {
        const response = await fetch('/pi2dsh/mcp-action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session, server: server.name, disabled: !server.disabled, scope }),
        })
        const payload = await response.json() as UnknownRecord
        if (!response.ok) {
          setNote(String(payload.error ?? 'the toggle failed'))
          return
        }
        setNote(`${server.name} ${server.disabled ? 'enabled' : 'disabled'} (${scope}) — ${String(payload.note ?? '')}`)
        patch(current => ({
          ...current,
          servers: current.servers.map(entry => entry.name === server.name ? { ...entry, disabled: !server.disabled } : entry),
        }))
      } catch (error) {
        setNote(String(error))
      }
    })()
  }
  return { note, toggle }
}

/** The SESSION view: this session's merged config, grouped by layer. */
function SessionMcpTab({ scope, visible }: { scope: SidebarTabScope, visible: boolean }): ReactNode {
  const session = scope.sessionId ?? ''
  const { state, failed, patch } = useMcpState(session, visible)
  const { note, toggle } = useToggle(session, 'project', patch)

  if (failed && state === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-tab' },
      createElement('div', { style: ui.empty }, 'The MCP state route is not answering — is the pi2dsh engine mounted in this profile?'))
  }
  if (state === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-tab' },
      createElement('div', { style: ui.sub }, 'Loading MCP configuration…'))
  }
  const groups: Array<['project' | 'global', string]> = [['project', 'This project'], ['global', 'Global (all projects)']]
  return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-tab' },
    createElement('div', { style: ui.headline },
      createElement('span', null, 'MCP servers · this session'),
      createElement('span', { style: ui.sub }, `${state.servers.length} configured`),
    ),
    note === undefined ? null : createElement('div', { style: ui.note, 'data-dsh-x': 'mcp-note' }, note),
    state.servers.length === 0 ? emptyGuide() : groups.map(([layer, title]) => {
      const members = state.servers.filter(server => server.layer === layer)
      if (members.length === 0) return null
      return createElement('div', { key: layer, style: { display: 'contents' } },
        createElement('div', { style: ui.group }, title),
        // Session-side toggles always write the project override: smallest
        // blast radius ("disable for this project"), and for a global server
        // the project layer is exactly the per-project opt-out the adapter
        // documents. Machine-wide toggles live in Settings → MCP.
        ...members.map(server => serverCard(server, toggle,
          server.disabled ? 'Enable for this project' : 'Disable for this project')),
      )
    }),
    createElement('div', { style: ui.meta },
      `layers: ${state.sources.length === 0 ? 'none found' : state.sources.map(source => source.split('/').slice(-2).join('/')).join(' → ')}`),
  )
}

/** The GLOBAL view (Settings → MCP): cross-project layers only. */
function SettingsMcpSection(): ReactNode {
  const { state, failed, patch } = useMcpState('', true)
  const { note, toggle } = useToggle('', 'global', patch)

  if (failed && state === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-settings' },
      createElement('div', { style: ui.empty }, 'The MCP state route is not answering — is the pi2dsh engine mounted in this profile?'))
  }
  if (state === undefined) {
    return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-settings' },
      createElement('div', { style: ui.sub }, 'Loading MCP configuration…'))
  }
  const globals = state.servers.filter(server => server.layer === 'global')
  return createElement('div', { style: ui.root, 'data-dsh-x': 'mcp-settings' },
    createElement('div', { style: ui.headline },
      createElement('span', null, 'MCP servers · global'),
      createElement('span', { style: ui.sub }, `${globals.length} configured`),
    ),
    createElement('div', { style: ui.sub },
      'Cross-project servers from your machine-level config layers. Project-level servers live in each workspace\'s .mcp.json and show up in the session sidebar.'),
    note === undefined ? null : createElement('div', { style: ui.note, 'data-dsh-x': 'mcp-note' }, note),
    globals.length === 0 ? emptyGuide() : globals.map(server => serverCard(server, toggle,
      server.disabled ? 'Enable everywhere' : 'Disable everywhere')),
    createElement('div', { style: ui.meta },
      `layers: ${state.sources.length === 0 ? 'none found' : state.sources.map(source => source.split('/').slice(-2).join('/')).join(' → ')}`),
  )
}

/** Seat both views: the sidebar tab (optional) and the Settings section. */
export function registerMcpTab(ctx: McpUiContext): void {
  ctx.inject(['betterSidebar'], (scope) => {
    scope.betterSidebar?.registerTab({
      id: 'dsh-work-x:mcp',
      title: 'MCP',
      component: SessionMcpTab,
    })
  })
  // The Settings seat is the host's own (stock dsh-client-ui-settings-models
  // registers the same way); it renders the section when the user picks the
  // nav entry. Only cross-project servers show here.
  ctx.inject(['slots'], (scope) => {
    const slots = scope.slots
    if (slots === undefined) return
    slots.inject('settings.section', () => slots.register({
      name: 'settings.section', id: 'dsh-work-x-mcp', order: 60, label: () => 'MCP',
    }, SettingsMcpSection))
  })
}
