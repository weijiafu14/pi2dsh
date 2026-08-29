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
import type { PiCustomComponent, PiCustomFactory, PiCustomOptions, PiTuiDriver } from './tui-surfaces.js'

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

/** Executes one Pi command by its Pi-side name; resolves the notices text. */
export type PiCommandRunner = (command: string, args: string) => Promise<string | undefined>

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
  /** Last time a browser client touched the /pi2dsh route (ms epoch). */
  lastClientContactMs?: number

  readonly #byParent = new Map<string, Map<string, TrackedThread>>()
  readonly #commandRunners = new Map<string, Map<string, PiCommandRunner>>()
  // session -> package -> what that package put on screen
  readonly #surfaces = new Map<string, Map<string, SurfaceView>>()
  /**
   * Retained components from `(tui, theme) => Component` factories, keyed by
   * their slot (session + package + widget key). Retained because the driver
   * handed to the factory must stay LIVE: requestRender re-renders this
   * component into its slot for as long as the package holds the handle.
   * Replacing or clearing the slot disposes the previous component.
   */
  readonly #factoryComponents = new Map<string, { render?: (width: number) => unknown, dispose?: () => void }>()
  // package -> its custom-entry renderer, pulled per request
  readonly #entrySources = new Map<string, EntrySource>()
  // session -> the composer text a package asked for, and the live text the
  // browser last reported. Pi's editor calls are two-way: setEditorText writes,
  // getEditorText reads what the user actually has.
  readonly #draftRequests = new Map<string, DraftRequest>()
  readonly #liveDrafts = new Map<string, string>()
  readonly #completionSources = new Map<string, CompletionSource>()
  // A keyed DSH tool view has to be registered under the exact wire name.
  // The runtime adds only tools from explicitly supported image packages at
  // package mount, before any call executes; every other tool keeps DSH's own
  // row unchanged.
  readonly #imageToolNames = new Set<string>()

  /** Register one known image tool's exact DSH wire name. */
  registerImageTool(name: string): void {
    if (name.length > 0) this.#imageToolNames.add(name)
  }

  /** Exact wire names needing the generic Pi image-result browser view. */
  imageToolNames(): string[] {
    return [...this.#imageToolNames]
  }

  // ---- Pi's full-screen custom UI, on the browser overlay -----------------
  // The terminal composition seats `ui.custom` in dsh-TUI's scene service; a
  // browser composition has no scenes, but the component contract is the same
  // small terminal protocol (`render(width)` -> ANSI lines, `handleInput(raw)`),
  // and the client half already paints ANSI. One scene at a time, exactly like
  // a terminal: opening a new one finishes the previous run.
  #scene: {
    package: string
    component: PiCustomComponent | undefined
    options: PiCustomOptions | undefined
    resolve(value: unknown): void
    reject(error: unknown): void
  } | undefined

  #sceneRevision = 0
  #sceneWidth = 100

  openScene<T>(
    packageName: string,
    factory: PiCustomFactory<T>,
    theme: unknown,
    keybindings: unknown,
    options?: PiCustomOptions,
  ): Promise<T | undefined> {
    this.#finishScene(undefined)
    return new Promise<T | undefined>((resolve, reject) => {
      const run = {
        package: packageName,
        component: undefined as PiCustomComponent | undefined,
        options,
        resolve: resolve as (value: unknown) => void,
        reject,
      }
      this.#scene = run
      const driver: PiTuiDriver = { requestRender: () => this.#invalidateScene() }
      const done = (value: T): void => {
        if (this.#scene !== run) return
        this.#finishScene(value)
      }
      void Promise.resolve()
        .then(() => factory(driver, theme, keybindings, done))
        .then(component => {
          if (this.#scene !== run) {
            component.dispose?.()
            return
          }
          if (typeof component?.render !== 'function') {
            this.#scene = undefined
            this.#invalidateScene()
            // Console AND the caller: a package may swallow the rejection, and
            // a scene that silently never opens is undiagnosable from the UI.
            console.warn(`[pi2dsh] web scene for ${packageName}: component lacks render(width)`)
            reject(new TypeError('Pi custom component must implement render(width)'))
            return
          }
          run.component = component
          this.#invalidateScene()
        }, error => {
          if (this.#scene !== run) return
          this.#scene = undefined
          this.#invalidateScene()
          console.warn(`[pi2dsh] web scene for ${packageName}: component factory failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
          reject(error)
        })
    })
  }

  /** What the browser paints: the live component's frame, or a closed marker. */
  sceneSnapshot(): { open: boolean, package?: string, revision: number, lines?: string[] } {
    const scene = this.#scene
    if (scene?.component === undefined) return { open: false, revision: this.#sceneRevision }
    const raw = typeof scene.options?.overlayOptions === 'function'
      ? scene.options.overlayOptions()
      : scene.options?.overlayOptions
    const requested = (raw as UnknownRecord | undefined)?.width
    const width = typeof requested === 'number' && Number.isFinite(requested) && requested > 0
      ? Math.min(this.#sceneWidth, Math.floor(requested))
      : this.#sceneWidth
    let lines: string[]
    try {
      lines = scene.component.render(width)
    } catch (error) {
      // A component that cannot draw cannot be interacted with either: fail
      // the run loudly to its Pi caller rather than freezing an empty overlay.
      const failed = this.#scene
      this.#scene = undefined
      this.#invalidateScene()
      console.warn(`[pi2dsh] web scene for ${scene.package}: render(width) failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      failed?.reject(error)
      return { open: false, revision: this.#sceneRevision }
    }
    return { open: true, package: scene.package, revision: this.#sceneRevision, lines }
  }

  /** Raw terminal input from the browser keyboard, verbatim into the component. */
  sceneInput(sequence: string, width?: number): void {
    if (typeof width === 'number' && Number.isFinite(width)) {
      this.#sceneWidth = Math.max(20, Math.min(400, Math.floor(width)))
    }
    const component = this.#scene?.component
    if (component === undefined || sequence.length === 0) return
    component.handleInput?.(sequence)
    component.invalidate?.()
    this.#invalidateScene()
  }

  /** The browser dismissed the overlay: resolve the Pi caller with undefined. */
  closeScene(): void {
    this.#finishScene(undefined)
  }

  #finishScene(value: unknown): void {
    const scene = this.#scene
    if (scene === undefined) return
    this.#scene = undefined
    scene.component?.dispose?.()
    this.#invalidateScene()
    scene.resolve(value)
  }

  #invalidateScene(): void {
    this.#sceneRevision += 1
  }

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
   * Register the executor for one package's Pi commands on one session, so
   * product UI (a side-chat window's input, its action buttons) can run the
   * package's OWN command handlers — the same code path the composer takes.
   * Generic by construction: the runner closure carries the package runtime;
   * this registry only routes (session, package) to it.
   * @param sessionId - the root session the package is mounted for.
   * @param packageName - the Pi package owning the commands.
   * @param runner - executes one registered Pi command by its Pi name.
   * @returns a disposer that unregisters the runner.
   */
  registerCommandRunner(sessionId: string, packageName: string, runner: PiCommandRunner): () => void {
    const runners = this.#commandRunners.get(sessionId) ?? new Map<string, PiCommandRunner>()
    runners.set(packageName, runner)
    this.#commandRunners.set(sessionId, runners)
    return () => {
      const live = this.#commandRunners.get(sessionId)
      if (live === undefined) return
      if (live.get(packageName) === runner) live.delete(packageName)
      if (live.size === 0) this.#commandRunners.delete(sessionId)
    }
  }

  /** The registered runner for (session, package), when one is mounted. */
  commandRunner(sessionId: string, packageName: string): PiCommandRunner | undefined {
    return this.#commandRunners.get(sessionId)?.get(packageName)
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
  setWidget(sessionId: string, packageName: string | undefined, key: string, content: unknown, theme?: unknown): void {
    if (sessionId.length === 0) return
    const view = this.#view(sessionId, packageName)
    // Pi's setWidget is overloaded: lines, or a `(tui, theme) => Component`
    // factory. Both are rendered here, through the same projection the header
    // and footer use — a component's contract is `render(width): string[]`, so
    // there is text to show and nothing has to be invented.
    //
    // Pi's own rpc mode drops the factory form, but that host also drops
    // setFooter and setHeader entirely, and this bridge renders those; matching
    // rpc mode HERE and exceeding it THERE was the inconsistency. Worse, the
    // old rule deleted on any non-array: a package that set lines and later
    // updated with a factory had its widget silently disappear.
    const slot = `${sessionId} ${packageName ?? 'pi'} ${key}`
    this.#factoryComponents.get(slot)?.dispose?.()
    this.#factoryComponents.delete(slot)
    if (typeof content === 'function') {
      // The factory receives a REAL tui handle whose requestRender re-renders
      // the retained component into this widget slot — Pi's own contract.
      // Passing undefined and relying on the call-site try/catch was NOT a
      // safe degradation: a factory retains the handle in a closure and calls
      // it later, far outside any catch, taking that turn's tool call down
      // with it (pi-lens's lsp_diagnostics on the web surface, 2026-08-27).
      this.#mountFactory(slot, content as (tui: unknown, theme: unknown) => unknown, theme, text => {
        const live = this.#view(sessionId, packageName)
        if (text === undefined) delete live.widgets[key]
        else live.widgets[key] = text
      })
      return
    }
    const text = surfaceText(content, theme)
    if (text === undefined) delete view.widgets[key]
    else view.widgets[key] = text
  }

  /**
   * Mount one `(tui, theme) => Component` factory: run it with a live driver,
   * render the retained component now, and re-render it into the same slot on
   * every requestRender. A factory or render that throws leaves the slot
   * empty — the package's own bug stays its own — but a RETAINED handle keeps
   * working for the component's lifetime.
   * @param slot - identity for the retained component (dispose-on-replace).
   * @param factory - the package's factory, exactly as passed to setWidget.
   * @param theme - the bridge's headless theme.
   * @param store - writes rendered text (or undefined to clear) into the slot.
   */
  #mountFactory(slot: string, factory: (tui: unknown, theme: unknown) => unknown, theme: unknown, store: (text: string | undefined) => void): void {
    let component: { render?: (width: number) => unknown, dispose?: () => void } | undefined
    const render = (): void => {
      if (component === undefined) return
      // A handle outlives its component: a package can keep calling
      // requestRender after its widget was replaced or cleared. A stale
      // handle must be inert, not resurrect the disposed component's output.
      if (this.#factoryComponents.get(slot) !== component) return
      store(surfaceText(component, theme))
    }
    const driver = { requestRender: () => { render() } }
    try {
      component = factory(driver, theme) as typeof component
    } catch {
      store(undefined)
      return
    }
    if (component === null || typeof component?.render !== 'function') {
      store(undefined)
      return
    }
    this.#factoryComponents.set(slot, component)
    render()
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
   * Register one package's custom-entry renderer.
   *
   * Pulled rather than pushed: a renderer's output depends on the session being
   * looked at, and the package registers once at mount for every session it
   * will ever be asked about.
   * @param packageName - owning Pi package.
   * @param source - called with the session id the browser is showing.
   * @returns a disposer that unregisters the source.
   */
  trackEntries(packageName: string, source: EntrySource): () => void {
    this.#entrySources.set(packageName, source)
    return () => { this.#entrySources.delete(packageName) }
  }

  /**
   * Custom entries every package renders for one session, in package order.
   * @param sessionId - session the browser is showing.
   * @returns rendered entries; a renderer that throws contributes nothing.
   */
  entries(sessionId: string): RenderedEntry[] {
    const out: RenderedEntry[] = []
    for (const [packageName, source] of this.#entrySources) {
      try {
        for (const entry of source(sessionId)) out.push({ ...entry, package: packageName })
      } catch {
        // A renderer is the package's own code; one that throws leaves the
        // conversation intact instead of taking the request down.
      }
    }
    return out
  }

  /**
   * Ask the browser to put text in the composer.
   *
   * A revision rather than a flag: the seat applies a request once, and the
   * next call — even with identical text — is a new request rather than a
   * no-op, which is what a package retrying a paste means.
   * @param sessionId - session whose composer to write.
   * @param text - the full next draft.
   */
  requestDraft(sessionId: string, text: string): void {
    if (sessionId.length === 0) return
    const current = this.#draftRequests.get(sessionId)
    this.#draftRequests.set(sessionId, { text, rev: (current?.rev ?? 0) + 1 })
    // Optimistic: a package that writes and immediately reads sees its own
    // write, exactly as it would in Pi, without waiting for a browser round
    // trip that may never come (a CLI session has no browser at all).
    this.#liveDrafts.set(sessionId, text)
  }

  /**
   * The pending composer write for one session, if any.
   * @param sessionId - session the browser is showing.
   * @returns the request, or undefined when nothing is pending.
   */
  draftRequest(sessionId: string): DraftRequest | undefined {
    return this.#draftRequests.get(sessionId)
  }

  /**
   * Record what the composer actually holds, as reported by the browser.
   * @param sessionId - session the report is about.
   * @param text - the live draft.
   */
  reportDraft(sessionId: string, text: string): void {
    if (sessionId.length === 0) return
    this.#liveDrafts.set(sessionId, text)
  }

  /**
   * The composer text for one session.
   * @param sessionId - session to read.
   * @returns the browser's last report, or the last requested text.
   */
  liveDraft(sessionId: string): string {
    return this.#liveDrafts.get(sessionId) ?? ''
  }

  /**
   * Register one package's completion provider.
   * @param packageName - owning Pi package.
   * @param source - asked with the trigger character and the typed query.
   * @returns a disposer that unregisters the source.
   */
  trackCompletions(packageName: string, source: CompletionSource): () => void {
    this.#completionSources.set(packageName, source)
    return () => { this.#completionSources.delete(packageName) }
  }

  /**
   * Completions every package offers for one trigger token.
   * @param trigger - the trigger character the menu opened on.
   * @param query - what the user has typed after it.
   * @returns candidates in package order; a provider that throws contributes none.
   */
  async completions(trigger: string, query: string): Promise<CompletionItem[]> {
    const out: CompletionItem[] = []
    for (const source of this.#completionSources.values()) {
      try {
        out.push(...await source(trigger, query))
      } catch {
        // A provider is the package's own code; its failure must not empty the
        // menu for every other package.
      }
    }
    return out
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

/** One custom entry a package rendered for the conversation. */
export interface RenderedEntry {
  id: string
  customType: string
  package?: string
  text: string
}

/** One pending composer write, with the revision the browser acknowledges. */
export interface DraftRequest {
  text: string
  rev: number
}

/** One completion a Pi provider offered for a trigger token. */
export interface CompletionItem {
  value: string
  label: string
  description?: string
}

/** A package's completion provider, asked with the token the user is typing. */
export type CompletionSource = (trigger: string, query: string) => Promise<CompletionItem[]>

/** A package's renderer, pulled at snapshot time for the session on screen. */
export type EntrySource = (sessionId: string) => RenderedEntry[]

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
/**
 * Short, clickable stand-ins for the authorization URLs a login flow announces.
 *
 * An OAuth authorize URL is 400 characters of query string. Putting it in a
 * dialog produces six wrapped lines with the question buried under them, and a
 * link that long is unusable even when the surface makes it clickable. These
 * are the short links shown instead; hitting one redirects to the real address.
 */
const pendingAuthorizations = new Map<string, string>()

/**
 * Publish a short link for one authorization URL.
 * @param url - the address the flow wants the user to open.
 * @returns the path to show, or undefined when the URL is not http(s).
 */
export function publishAuthorization(url: string): string | undefined {
  if (!/^https?:\/\//u.test(url)) return undefined
  const token = Math.random().toString(36).slice(2, 10)
  pendingAuthorizations.set(token, url)
  // One login at a time in practice; keep the map from growing without bound.
  if (pendingAuthorizations.size > 8) {
    const oldest = pendingAuthorizations.keys().next().value
    if (oldest !== undefined) pendingAuthorizations.delete(oldest)
  }
  return `/pi2dsh/authorize/${token}`
}

/**
 * Retire a published link when its flow is over.
 *
 * A finished (or superseded) flow's address still resolves at the provider, and
 * following it produces a callback the flow that is now listening cannot match
 * — the provider answers "State mismatch", which reads like a bug in the login
 * rather than a link that has expired. Saying so is the honest answer.
 * @param path - what {@link publishAuthorization} returned.
 */
export function revokeAuthorization(path: string): void {
  pendingAuthorizations.delete(path.slice('/pi2dsh/authorize/'.length))
}

/**
 * Structured data the runtime can serve to product-layer UI (dsh-x's MCP tab).
 * The registry stays generic: these are injected by the runtime, which owns
 * the semantics (session cwd, the MCP config layers, the write discipline).
 */
export interface BrowserSurfaceHooks {
  mcpState?(session: string): Promise<unknown>
  mcpAction?(session: string, server: string, disabled: boolean, scope: 'project' | 'global'): Promise<unknown>
  /** The Models-page login card's read face: OAuth providers + the one in-flight flow. */
  loginState?(): Promise<unknown>
  /** The card's writes: begin/answer/cancel/dismiss/signout, all host-level. */
  loginAction?(action: string, provider: string, value: string): Promise<unknown>
}

export function registerBrowserSurfaceRoute(ctx: Context, registry: BrowserSurfaces, hooks?: BrowserSurfaceHooks): boolean {
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
      const url = new URL(String(req.url ?? '/'), 'http://pi2dsh.invalid')
      // Any request through this prefix is a live browser client talking to
      // the presentation layer. hasUI's 0.1.2-line answer reads this stamp:
      // question answerers there are per-connected-client waterfall relays,
      // so "a browser is polling us" is the signal we actually own.
      registry.lastClientContactMs = Date.now()
      // The one write the browser half performs: reporting what the user has
      // actually typed, so a package's getEditorText reads the composer rather
      // than only its own last write.
      if (method === 'POST' && url.pathname === '/pi2dsh/editor-draft') {
        const chunks: Buffer[] = []
        const body = await new Promise<string>((settle) => {
          const stream = req as unknown as { on(event: string, handler: (chunk?: unknown) => void): void }
          stream.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
          stream.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
        })
        try {
          const payload = JSON.parse(body || '{}') as { session?: unknown, draft?: unknown }
          if (typeof payload.session === 'string' && typeof payload.draft === 'string') {
            registry.reportDraft(payload.session, payload.draft)
          }
        } catch {
          // A malformed report changes nothing; the composer is still the
          // browser's, and the next report supersedes this one.
        }
        response.writeHead(204)
        response.end()
        return
      }
      // The MCP tab's structured faces, when the runtime provided them: the
      // configured-server view and the disable/enable toggle.
      if (url.pathname === '/pi2dsh/mcp-state' && (method === 'GET' || method === 'HEAD')) {
        if (hooks?.mcpState === undefined) {
          response.writeHead(404)
          response.end()
          return
        }
        const body = JSON.stringify(await hooks.mcpState(url.searchParams.get('session') ?? ''))
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(method === 'HEAD' ? undefined : body)
        return
      }
      if (url.pathname === '/pi2dsh/mcp-action' && method === 'POST') {
        if (hooks?.mcpAction === undefined) {
          response.writeHead(404)
          response.end()
          return
        }
        const chunks: Buffer[] = []
        const raw = await new Promise<string>((settle) => {
          const stream = req as unknown as { on(event: string, handler: (chunk?: unknown) => void): void }
          stream.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
          stream.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
        })
        let outcome: unknown
        try {
          const payload = JSON.parse(raw || '{}') as { session?: unknown, server?: unknown, disabled?: unknown, scope?: unknown }
          if (typeof payload.session !== 'string' || typeof payload.server !== 'string' || typeof payload.disabled !== 'boolean') {
            throw new TypeError('mcp-action needs { session, server, disabled }')
          }
          const scope = payload.scope === 'global' ? 'global' : 'project'
          outcome = await hooks.mcpAction(payload.session, payload.server, payload.disabled, scope)
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(outcome ?? { ok: true }))
        return
      }
      // The Models-page login card's faces (alpha `settings.models.provider-card`
      // seat): same hook pattern as the MCP tab — the runtime owns login
      // semantics (the /login spine), this layer only carries bytes.
      if (url.pathname === '/pi2dsh/login-state' && (method === 'GET' || method === 'HEAD')) {
        if (hooks?.loginState === undefined) {
          response.writeHead(404)
          response.end()
          return
        }
        const body = JSON.stringify(await hooks.loginState())
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(method === 'HEAD' ? undefined : body)
        return
      }
      if (url.pathname === '/pi2dsh/login-action' && method === 'POST') {
        if (hooks?.loginAction === undefined) {
          response.writeHead(404)
          response.end()
          return
        }
        const chunks: Buffer[] = []
        const raw = await new Promise<string>((settle) => {
          const stream = req as unknown as { on(event: string, handler: (chunk?: unknown) => void): void }
          stream.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
          stream.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
        })
        let outcome: unknown
        try {
          const payload = JSON.parse(raw || '{}') as { action?: unknown, provider?: unknown, value?: unknown }
          if (typeof payload.action !== 'string') throw new TypeError('login-action needs { action }')
          outcome = await hooks.loginAction(
            payload.action,
            typeof payload.provider === 'string' ? payload.provider : '',
            typeof payload.value === 'string' ? payload.value : '',
          )
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(outcome ?? { ok: true }))
        return
      }
      // Product UI running a Pi package's own command (a side-chat window's
      // input is "/btw <text>" by other means): routed to the runner the
      // package's runtime registered for this session, so the exact handler
      // the composer would call runs — flags, session reuse, model fallback
      // and all. No handler is reimplemented here.
      if (url.pathname === '/pi2dsh/pi-command' && method === 'POST') {
        const chunks: Buffer[] = []
        const raw = await new Promise<string>((settle) => {
          const stream = req as unknown as { on(event: string, handler: (chunk?: unknown) => void): void }
          stream.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
          stream.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
        })
        try {
          const payload = JSON.parse(raw || '{}') as { session?: unknown, package?: unknown, command?: unknown, args?: unknown }
          if (typeof payload.session !== 'string' || typeof payload.package !== 'string' || typeof payload.command !== 'string') {
            throw new TypeError('pi-command needs { session, package, command }')
          }
          const runner = registry.commandRunner(payload.session, payload.package)
          if (runner === undefined) {
            response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
            response.end(JSON.stringify({ error: `no ${payload.package} command runner mounted for this session` }))
            return
          }
          const notice = await runner(payload.command, typeof payload.args === 'string' ? payload.args : '')
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: true, ...(notice === undefined ? {} : { notice }) }))
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
        return
      }
      // The scene overlay's two writes: raw keyboard input into the live Pi
      // component, and the user dismissing the overlay (resolves the Pi
      // caller with undefined, exactly like closing a terminal scene).
      if (method === 'POST' && (url.pathname === '/pi2dsh/scene-input' || url.pathname === '/pi2dsh/scene-close')) {
        const chunks: Buffer[] = []
        const body = await new Promise<string>((settle) => {
          const stream = req as unknown as { on(event: string, handler: (chunk?: unknown) => void): void }
          stream.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
          stream.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
        })
        if (url.pathname === '/pi2dsh/scene-close') {
          registry.closeScene()
        } else {
          try {
            const payload = JSON.parse(body || '{}') as { sequence?: unknown, width?: unknown }
            if (typeof payload.sequence === 'string') {
              registry.sceneInput(payload.sequence, typeof payload.width === 'number' ? payload.width : undefined)
            }
          } catch {
            // A malformed key event changes nothing; the next one supersedes it.
          }
        }
        response.writeHead(204)
        response.end()
        return
      }
      if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405)
        response.end()
        return
      }
      if (url.pathname.startsWith('/pi2dsh/authorize/')) {
        const target = pendingAuthorizations.get(url.pathname.slice('/pi2dsh/authorize/'.length))
        if (target === undefined) {
          response.writeHead(404)
          response.end('this login link has expired')
          return
        }
        response.writeHead(302, { location: target, 'cache-control': 'no-store' })
        response.end()
        return
      }
      if (url.pathname === '/pi2dsh/completions') {
        const items = await registry.completions(
          url.searchParams.get('trigger') ?? '@',
          url.searchParams.get('query') ?? '',
        )
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ items }))
        return
      }
      if (url.pathname === '/pi2dsh/image-tool-names') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(method === 'HEAD' ? undefined : JSON.stringify({ names: registry.imageToolNames() }))
        return
      }
      if (url.pathname !== '/pi2dsh/browser-state') {
        response.writeHead(404)
        response.end()
        return
      }
      const session = url.searchParams.get('session') ?? ''
      const body = JSON.stringify(session === ''
        ? { threads: [], surfaces: [], entries: [], scene: registry.sceneSnapshot() }
        : {
          threads: registry.snapshot(session),
          surfaces: registry.surfaces(session),
          entries: registry.entries(session),
          scene: registry.sceneSnapshot(),
          ...(registry.draftRequest(session) === undefined ? {} : { draft: registry.draftRequest(session) }),
        })
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
