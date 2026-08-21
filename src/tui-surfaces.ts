// Pi terminal components -> dsh-TUI's public plugin surfaces.
//
// This module deliberately knows neither MCP nor any Pi package name. A Pi
// custom component is already a small terminal protocol (`render(width)`,
// `handleInput(raw)`, `dispose()`); dsh-TUI's public `tuiScenes` seam supplies
// the missing screen ownership and raw-key lifecycle. The package keeps its
// own state and behavior while the bridge translates only the host surface.

type UnknownRecord = Record<string, unknown>

export interface PiCustomComponent {
  render(width: number): string[]
  invalidate?(): void
  handleInput?(data: string): void
  dispose?(): void
}

export interface PiTuiDriver {
  requestRender(): void
}

export interface PiCustomOptions {
  overlay?: boolean
  overlayOptions?: UnknownRecord | (() => UnknownRecord)
}

export type PiCustomFactory<T> = (
  tui: PiTuiDriver,
  theme: unknown,
  keybindings: unknown,
  done: (result: T) => void,
) => PiCustomComponent | Promise<PiCustomComponent>

interface TuiScenePropsLike {
  React: {
    createElement(type: unknown, props?: UnknownRecord | null, ...children: unknown[]): unknown
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void
    useSyncExternalStore(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => number,
      getServerSnapshot?: () => number,
    ): number
  }
  ui: {
    Box: unknown
    Text: unknown
    Ansi?: unknown
    useInput(handler: (input: string, key: UnknownRecord, event?: UnknownRecord) => void): void
    useTerminalSize(): { columns: number; rows: number }
  }
  close(): void
}

interface TuiSceneService {
  register(descriptor: {
    id: string
    title?: string
    component: (props: TuiScenePropsLike) => unknown
  }): () => void
  open(id: string): boolean
  close(): void
}

interface TuiStatusService {
  set(key: string, text: string | undefined): (() => void) | void
}

export interface TuiSurfaceContext {
  get(name: string, required?: boolean): unknown
  effect?(callback: () => (() => void)): unknown
  inject?(services: string[], callback: (ctx: TuiSurfaceContext) => void): unknown
  logger?: { warn(message: string): void }
}

interface ActiveCustom<T = unknown> {
  component?: PiCustomComponent
  options: PiCustomOptions | undefined
  resolve(value: T | undefined): void
  reject(error: unknown): void
}

function service<T>(ctx: TuiSurfaceContext, name: string): T | undefined {
  try {
    return ctx.get(name, false) as T | undefined
  } catch {
    return undefined
  }
}

function surfaceToken(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (normalized.length === 0) return 'entry'
  return /^[a-z]/u.test(normalized) ? normalized : `k-${normalized}`
}

function sceneIdFor(packageName: string): string {
  return `pi2dsh-${surfaceToken(packageName)}-custom`
}

function statusKeyFor(packageName: string, key: string): string {
  return `pi2dsh:${surfaceToken(packageName)}:${surfaceToken(key)}`
}

function rawTerminalInput(input: string, key: UnknownRecord, event?: UnknownRecord): string {
  const keypress = event?.keypress as UnknownRecord | undefined
  if (typeof keypress?.sequence === 'string' && keypress.sequence.length > 0) return keypress.sequence
  if (key.return === true) return '\r'
  if (key.escape === true) return '\x1b'
  if (key.tab === true) return '\t'
  if (key.backspace === true) return '\x7f'
  if (key.upArrow === true) return '\x1b[A'
  if (key.downArrow === true) return '\x1b[B'
  if (key.rightArrow === true) return '\x1b[C'
  if (key.leftArrow === true) return '\x1b[D'
  if (key.ctrl === true && input.length === 1) {
    const code = input.toLowerCase().charCodeAt(0)
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96)
  }
  return input
}

function preferredWidth(options: PiCustomOptions | undefined): number | undefined {
  const raw = typeof options?.overlayOptions === 'function'
    ? options.overlayOptions()
    : options?.overlayOptions
  const width = raw?.width
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? Math.floor(width) : undefined
}

/**
 * One package-scoped Pi custom-surface host backed by one dsh-TUI scene.
 * The MCP adapter is a consumer, not a special case: every component using
 * the public Pi component protocol follows the same path.
 */
export class TuiSurfaceAdapter {
  readonly sceneId: string

  private readonly scenes: TuiSceneService
  private readonly status: TuiStatusService | undefined
  private readonly statusDisposers = new Map<string, () => void>()
  private readonly listeners = new Set<() => void>()
  private readonly unregisterScene: () => void
  private revision = 0
  private active: ActiveCustom | undefined
  private disposed = false

  constructor(
    ctx: TuiSurfaceContext,
    private readonly packageName: string,
    private readonly instanceKey?: string,
  ) {
    const scenes = service<TuiSceneService>(ctx, 'tuiScenes')
    if (scenes === undefined) throw new Error('pi2dsh: dsh-TUI scene service is unavailable')
    this.scenes = scenes
    this.status = service<TuiStatusService>(ctx, 'tuiStatus')
    this.sceneId = sceneIdFor(instanceKey === undefined ? packageName : `${packageName}-${instanceKey}`)
    this.unregisterScene = scenes.register({
      id: this.sceneId,
      title: `${packageName} custom panel`,
      component: props => this.scene(props),
    })
  }

  get available(): boolean {
    return !this.disposed
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): number {
    return this.revision
  }

  setStatus(key: string, text: unknown): void {
    if (this.disposed || this.status === undefined) return
    const dshKey = statusKeyFor(
      this.instanceKey === undefined ? this.packageName : `${this.packageName}-${this.instanceKey}`,
      key,
    )
    this.statusDisposers.get(dshKey)?.()
    this.statusDisposers.delete(dshKey)
    if (text === undefined) return
    const dispose = this.status.set(dshKey, String(text))
    if (typeof dispose === 'function') this.statusDisposers.set(dshKey, dispose)
  }

  custom<T>(
    factory: PiCustomFactory<T>,
    theme: unknown,
    keybindings: unknown,
    options?: PiCustomOptions,
  ): Promise<T | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    this.finish(undefined)
    return new Promise<T | undefined>((resolve, reject) => {
      const run: ActiveCustom<T> = { options, resolve, reject }
      this.active = run as ActiveCustom
      const driver: PiTuiDriver = { requestRender: () => this.invalidate() }
      const done = (value: T): void => this.finishFor(run, value)
      void Promise.resolve()
        .then(() => factory(driver, theme, keybindings, done))
        .then(component => {
          if (this.active !== run) {
            component.dispose?.()
            return
          }
          if (typeof component?.render !== 'function') {
            this.failFor(run, new TypeError('Pi custom component must implement render(width)'))
            return
          }
          run.component = component
          this.invalidate()
          if (!this.scenes.open(this.sceneId)) this.finishFor(run, undefined)
        }, error => this.failFor(run, error))
    })
  }

  render(width: number): string[] {
    const active = this.active
    if (active?.component === undefined) return []
    const available = Math.max(12, Math.floor(width) - 2)
    const requested = preferredWidth(active.options)
    return active.component.render(requested === undefined ? available : Math.min(available, requested))
  }

  handleInput(data: string): void {
    const component = this.active?.component
    if (component === undefined) return
    component.handleInput?.(data)
    component.invalidate?.()
    this.invalidate()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.finish(undefined)
    for (const dispose of this.statusDisposers.values()) dispose()
    this.statusDisposers.clear()
    this.unregisterScene()
    this.listeners.clear()
  }

  private invalidate(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  private finish(value: unknown): void {
    const active = this.active
    if (active !== undefined) this.finishFor(active, value)
  }

  private finishFor<T>(run: ActiveCustom<T>, value: T | undefined, closeScene = true): void {
    if (this.active !== run) return
    this.active = undefined
    run.component?.dispose?.()
    if (closeScene) this.scenes.close()
    this.invalidate()
    run.resolve(value)
  }

  private failFor<T>(run: ActiveCustom<T>, error: unknown): void {
    if (this.active !== run) return
    this.active = undefined
    run.component?.dispose?.()
    this.scenes.close()
    this.invalidate()
    run.reject(error)
  }

  private scene(props: TuiScenePropsLike): unknown {
    const { React, ui } = props
    React.useSyncExternalStore(
      listener => this.subscribe(listener),
      () => this.snapshot(),
      () => this.snapshot(),
    )
    React.useEffect(() => () => {
      const active = this.active
      if (active !== undefined) this.finishFor(active, undefined, false)
    }, [])
    ui.useInput((input, key, event) => this.handleInput(rawTerminalInput(input, key, event)))
    const { columns } = ui.useTerminalSize()
    const lines = this.render(columns)
    const Line = ui.Ansi ?? ui.Text
    return React.createElement(
      ui.Box,
      { flexDirection: 'column', width: '100%', paddingX: 1 },
      ...lines.map((line, index) => React.createElement(Line, { key: index }, line)),
    )
  }
}

/**
 * Attach lazily to dsh-TUI. Cordis reloads this child fiber whenever the
 * service implementation changes, so a TUI update cannot leave a stale scene
 * proxy in the bridge.
 */
export function mountTuiSurfaceAdapter(
  ctx: TuiSurfaceContext,
  packageName: string,
  publish: (adapter: TuiSurfaceAdapter | undefined) => void,
  instanceKey?: string,
): void {
  const attach = (surfaceCtx: TuiSurfaceContext): void => {
    const adapter = new TuiSurfaceAdapter(surfaceCtx, packageName, instanceKey)
    publish(adapter)
    surfaceCtx.effect?.(() => () => {
      adapter.dispose()
      publish(undefined)
    })
  }
  // Agent setup runs after the Loader tree is settled, so the service is
  // already present. Register on the Agent's own activation: dsh-TUI binds a
  // scene's authority to the activation that registered it, and the command
  // opening the scene is registered by that same activation. Creating an
  // extra ctx.inject child here gives registration and open different owners.
  if (service<TuiSceneService>(ctx, 'tuiScenes') !== undefined) {
    attach(ctx)
    return
  }
  // Legacy root mounts may start before dsh-TUI. Track the optional service
  // there so it can attach when the surface appears later.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tuiScenes'], attach)
    return
  }
}

/**
 * dsh-TUI handles `/mcp` locally before it asks DSH's command registry. Until
 * it exposes a reserved-command seam, keep its native status command and make
 * an installed Pi MCP manager reachable as `/pi-mcp`.
 */
export function commandNameForDshTui(name: string, tuiAvailable: boolean): string {
  return tuiAvailable && name === 'mcp' ? 'pi-mcp' : name
}

export const tuiSurfaceInternals = {
  rawTerminalInput,
  sceneIdFor,
  statusKeyFor,
}
