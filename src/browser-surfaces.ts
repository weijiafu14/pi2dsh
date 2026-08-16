// The browser half's server side: everything pi2dsh puts on DSH's web surface.
//
// Pi packages that open a side conversation (pi-btw's `/btw`, and anything
// else built on `createAgentSession`) get a real DSH child session — visible in
// the host's own subagent catalog, resumable, continuable. What DSH has no seat
// for is the SHAPE those packages present in Pi: a focused panel floating over
// the main conversation, so the side thread is readable without leaving the
// thread you were in.
//
// DSH's browser half does have a seat for exactly that (`shell.overlay`), so
// the panel is drawn by this package's own client half. Its data does NOT ride
// DSH's typed Remote system — that is a first-party, code-generated contract —
// but this package's own route, which is the honest way for an out-of-tree
// plugin to talk to its own UI.
//
// Two kinds of state live here, both keyed by the session they belong to:
//
//   threads   — side conversations a Pi package opened (the floating panel)
//   surfaces  — Pi's presentation calls (status, widget, header, footer, title,
//               working/thinking chrome). Pi hands these a string or one of its
//               own components; a component renders to plain text lines through
//               the bridge's headless pi-tui shims, which is what a browser can
//               actually show.
//
// Nothing here knows about any particular package. A thread is tracked because
// a Pi package opened a child session; a surface is recorded because a package
// called a Pi UI method — whatever the package.
import type { Context } from '@deepseek-ai/cordis'
import { SEED_CARRIER_TAG, type PiBridgedAgentSession } from './subagent-bridge.js'

type UnknownRecord = Record<string, unknown>

/** One side thread as the panel renders it. */
export interface PanelThreadView {
  /** The child session's id, stable for the life of the thread. */
  id: string
  /** Human label, already the one DSH's catalog shows. */
  label: string
  /** Pi package that opened it, when known. */
  package?: string
  /** Whether the child is mid-turn. */
  running: boolean
  messages: Array<{ role: string, text: string }>
}

interface TrackedThread {
  id: string
  label: string
  package: string | undefined
  session: PiBridgedAgentSession
}

/** Flatten one Pi message's content to the text a panel row shows. */
function messageText(message: UnknownRecord): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as UnknownRecord[]) {
    // Thinking stays out: the panel is the conversation, not the reasoning
    // trace, and Pi's own side-conversation UI shows the same.
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'toolCall' && typeof block.name === 'string') parts.push(`[tool: ${block.name}]`)
  }
  return parts.join('\n')
}

/**
 * Live side threads, keyed by the parent session they belong to.
 *
 * Host-level (one per engine instance, like the provider directory): the panel
 * is one surface, however many Pi packages contribute threads to it.
 */
export class BrowserSurfaces {
  readonly #byParent = new Map<string, Map<string, TrackedThread>>()
  // session -> package -> what that package put on screen
  readonly #surfaces = new Map<string, Map<string, SurfaceView>>()

  /**
   * Track one child session under its parent.
   * @param parentSessionId - the session the panel floats over.
   * @param thread - the child's identity and live session object.
   * @returns a disposer that removes the thread from the panel.
   */
  track(parentSessionId: string, thread: TrackedThread): () => void {
    const threads = this.#byParent.get(parentSessionId) ?? new Map<string, TrackedThread>()
    threads.set(thread.id, thread)
    this.#byParent.set(parentSessionId, threads)
    return () => {
      const live = this.#byParent.get(parentSessionId)
      if (live === undefined) return
      live.delete(thread.id)
      if (live.size === 0) this.#byParent.delete(parentSessionId)
    }
  }

  /**
   * The panel's view of one parent session.
   * @param parentSessionId - session the browser is currently showing.
   * @returns every side thread opened under it, oldest first.
   */
  snapshot(parentSessionId: string): PanelThreadView[] {
    const threads = this.#byParent.get(parentSessionId)
    if (threads === undefined) return []
    return [...threads.values()].map(thread => ({
      id: thread.id,
      label: thread.label,
      ...(thread.package === undefined ? {} : { package: thread.package }),
      running: (thread.session as unknown as { isStreaming?: boolean }).isStreaming === true,
      // Seeded entries are the context the package handed the child (pi-btw
      // starts its thread with the main conversation), not the side exchange.
      // Showing them would make the panel a copy of the main thread.
      messages: thread.session.messages
        .filter(message => !thread.session.isCarriedContext(message as UnknownRecord))
        .map(message => ({ role: String((message as UnknownRecord).role ?? ''), text: messageText(message as UnknownRecord) }))
        // The bridge also re-materializes the seed as ONE durable carrier
        // message before the first prompt, so it is a real entry the WeakSet
        // cannot know about — recognised here by the envelope the bridge owns.
        .filter(entry => !entry.text.startsWith(`<${SEED_CARRIER_TAG}>`))
        .filter(entry => entry.text.length > 0),
    }))
  }

  /**
   * Pi's `setStatus(key, text)`: one keyed status entry in the status bar.
   * The key is the entry's identity; passing undefined removes that entry,
   * exactly like Pi clears one status.
   * @param sessionId - session the calling agent belongs to.
   * @param packageName - Pi package making the call, when known.
   * @param key - the status entry's key.
   * @param text - the text to show, or undefined to remove the entry.
   */
  setStatus(sessionId: string, packageName: string | undefined, key: string, text: unknown): void {
    if (sessionId.length === 0) return
    const view = this.#view(sessionId, packageName)
    const rendered = text === undefined || text === null ? undefined : String(text)
    if (rendered === undefined || rendered.length === 0) delete view.statuses[key]
    else view.statuses[key] = rendered
  }

  /**
   * Pi's `setWidget(key, content)`: one keyed widget. Only string arrays are
   * recorded — anything else is ignored exactly like Pi's own rpc mode, where
   * widgets are transmitted to a host as lines and factory content needs TUI
   * access the host never provides.
   * @param sessionId - session the calling agent belongs to.
   * @param packageName - Pi package making the call, when known.
   * @param key - the widget's key.
   * @param content - the widget's lines, or undefined to remove the widget.
   */
  setWidget(sessionId: string, packageName: string | undefined, key: string, content: unknown): void {
    if (sessionId.length === 0) return
    const view = this.#view(sessionId, packageName)
    if (content === undefined || !Array.isArray(content)) delete view.widgets[key]
    else view.widgets[key] = content.map(String).join('\n')
  }

  /**
   * Record one simple presentation call (working chrome, title, header,
   * footer). The value is a string, a Pi component, a working-indicator
   * options object, or a header/footer factory; each renders to text here so
   * the browser half never runs Pi code.
   * @param sessionId - session the calling agent belongs to.
   * @param packageName - Pi package making the call, when known.
   * @param key - which surface.
   * @param value - the value the package passed; undefined clears it.
   * @param theme - the bridge's headless theme, for factories that style with it.
   */
  setSurface(
    sessionId: string,
    packageName: string | undefined,
    key: SurfaceKey,
    value: unknown,
    theme?: unknown,
  ): void {
    if (sessionId.length === 0) return
    const view = this.#view(sessionId, packageName)
    const text = surfaceText(value, theme)
    if (text === undefined) delete view.values[key]
    else view.values[key] = text
  }

  /**
   * Pi's `setWorkingVisible`: hide the working chrome without forgetting it.
   * @param sessionId - session the calling agent belongs to.
   * @param packageName - Pi package making the call, when known.
   * @param visible - whether the working chrome should show.
   */
  setWorkingVisible(sessionId: string, packageName: string | undefined, visible: boolean): void {
    if (sessionId.length === 0) return
    this.#view(sessionId, packageName).workingVisible = visible
  }

  /**
   * What packages have put on screen for one session.
   * @param sessionId - session the browser is showing.
   * @returns one entry per package that has driven a surface, empties dropped.
   */
  surfaces(sessionId: string): SurfaceView[] {
    const bySession = this.#surfaces.get(sessionId)
    if (bySession === undefined) return []
    return [...bySession.values()].filter(view => viewHasContent(view))
  }

  /** Get-or-create one package's view for a session. */
  #view(sessionId: string, packageName: string | undefined): SurfaceView {
    const owner = packageName ?? 'pi'
    const bySession = this.#surfaces.get(sessionId) ?? new Map<string, SurfaceView>()
    let view = bySession.get(owner)
    if (view === undefined) {
      view = {
        ...(packageName === undefined ? {} : { package: packageName }),
        values: {},
        statuses: {},
        widgets: {},
        workingVisible: true,
      }
      bySession.set(owner, view)
      this.#surfaces.set(sessionId, bySession)
    }
    return view
  }
}

/** Whether a view still carries something to show. */
function viewHasContent(view: SurfaceView): boolean {
  return Object.keys(view.values).length > 0
    || Object.keys(view.statuses).length > 0
    || Object.keys(view.widgets).length > 0
}

/**
 * Presentation slots a Pi package can drive, in DSH's browser shell. The
 * keyed surfaces (status, widget) live on {@link SurfaceView.statuses} and
 * {@link SurfaceView.widgets}; the simple ones live in `values`.
 */
export type SurfaceKey =
  | 'workingMessage' | 'workingIndicator' | 'hiddenThinkingLabel'
  | 'title' | 'header' | 'footer'

/** One package's presentation state for one session. */
export interface SurfaceView {
  package?: string
  /** Simple string surfaces: working chrome, transient title, header, footer. */
  values: Partial<Record<SurfaceKey, string>>
  /** Pi's `setStatus` entries, keyed by the entry key. */
  statuses: Record<string, string>
  /** Pi's `setWidget` entries, keyed by the widget key. */
  widgets: Record<string, string>
  /** Pi's setWorkingVisible: false hides the working chrome without clearing it. */
  workingVisible: boolean
}

/**
 * Render whatever Pi handed a presentation call into displayable text.
 *
 * Pi's UI methods accept a string, a string array (widget lines), one of its
 * components (`render(width): string[]`), a working-indicator options object
 * (`{ frames?: string[] }`), or a header/footer factory
 * (`(tui, theme) => Component`). Every shape is projected to text here — the
 * pi-tui shims honour `render(width)` headlessly, and a factory is called with
 * the bridge's headless theme (and no TUI, which Pi's own rpc mode never
 * provides either); anything that cannot render leaves the surface empty
 * rather than faking output.
 * @param value - the value the package passed.
 * @param theme - the bridge's headless theme, for factories that style with it.
 * @returns the text to show, or undefined to clear the surface.
 */
export function surfaceText(value: unknown, theme?: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.length === 0 ? undefined : value
  if (Array.isArray(value)) {
    // A widget's lines: the exact shape Pi's rpc mode transmits to a host.
    const text = value.map(String).join('\n').trimEnd()
    return text.length === 0 ? undefined : text
  }
  const record = value as { render?: (width: number) => unknown; frames?: unknown }
  if (typeof record.render === 'function') {
    try {
      const lines = record.render(80)
      const text = (Array.isArray(lines) ? lines : [lines]).map(line => String(line)).join('\n').trimEnd()
      return text.length === 0 ? undefined : text
    } catch {
      // A component that throws while rendering is the package's own bug; the
      // surface simply stays empty rather than taking the turn down with it.
      return undefined
    }
  }
  if (Array.isArray(record.frames)) {
    // WorkingIndicatorOptions: frames animate in Pi; a browser shows the
    // honest static projection of the package's own frames. An empty array
    // hides the indicator, exactly as Pi defines it.
    const text = record.frames.map(String).join('').trimEnd()
    return text.length === 0 ? undefined : text
  }
  if (typeof value === 'function') {
    // A header/footer factory: `(tui, theme) => Component`. Called without a
    // TUI — factories that need one degrade to an empty surface, matching
    // Pi's rpc mode, where no factory runs at all.
    try {
      return surfaceText((value as (tui: unknown, theme: unknown) => unknown)(undefined, theme), theme)
    } catch {
      return undefined
    }
  }
  const text = String(value)
  return text.length === 0 || text === '[object Object]' ? undefined : text
}

interface WebServerLike {
  register(route: { kind: string, path: string, handler: (req: UnknownRecord, res: UnknownRecord) => Promise<void> }): () => void
}

/**
 * Serve the browser half's own read route on the host's web server.
 *
 * One prefix, one GET, one payload: the client half polls it for the session
 * it is showing and gets every surface at once.
 * A composition with no web server (the CLI profile) simply has no panel, which
 * is the correct outcome rather than an error — the side conversation itself
 * still runs, and the host's subagent catalog still lists it.
 * @param ctx - the mounting context.
 * @param registry - live thread registry to read from.
 * @returns whether the route was registered.
 */
export function registerBrowserSurfaceRoute(ctx: Context, registry: BrowserSurfaces): boolean {
  const web = (ctx as unknown as { get(name: string): unknown }).get('webServer') as WebServerLike | undefined
  if (web === undefined || typeof web.register !== 'function') return false
  ctx.effect(() => web.register({
    kind: 'prefix',
    path: '/pi2dsh',
    handler: async (req: UnknownRecord, res: UnknownRecord) => {
      const response = res as unknown as {
        writeHead(status: number, headers?: Record<string, string>): void
        end(body?: string): void
      }
      const method = String(req.method ?? 'GET')
      if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405)
        response.end()
        return
      }
      const url = new URL(String(req.url ?? '/'), 'http://pi2dsh.invalid')
      if (url.pathname !== '/pi2dsh/browser-state') {
        response.writeHead(404)
        response.end()
        return
      }
      const session = url.searchParams.get('session') ?? ''
      const body = JSON.stringify(session === ''
        ? { threads: [], surfaces: [] }
        : { threads: registry.snapshot(session), surfaces: registry.surfaces(session) })
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        // The panel polls; a cached answer would freeze the thread mid-turn.
        'cache-control': 'no-store',
      })
      response.end(method === 'HEAD' ? undefined : body)
    },
  }), 'pi2dsh: browser-state route')
  return true
}
