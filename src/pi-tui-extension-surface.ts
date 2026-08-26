// Optional dsh-pi-tui presentation backend.
//
// This module consumes only the package's public extension entry points. It
// knows no Pi consumer package names: MCP managers, subagent managers and any
// other `ctx.ui.custom` consumer all travel through the same component relay.

import { PiComponentRelay } from './pi-component-relay.js'
import type {
  PiCustomFactory,
  PiCustomOptions,
  TerminalSurfaceAdapter,
  TuiSurfaceContext,
} from './tui-surfaces.js'

interface FooterSegment {
  spans: Array<{ text: string, tone?: string }>
  minWidth?: number
  importance?: number
}

interface RegistrationHandleLike<T> {
  replace(value: T): void
  dispose(): void
}

export interface PiTuiExtensionServiceLike {
  api(): {
    apiVersion: number
    capabilities: ReadonlySet<string>
  }
  register<T>(slot: string, spec: {
    id: string
    order?: number
    description?: string
  }, contribution: T): RegistrationHandleLike<T>
}

interface UnstableMountLeaseLike {
  readonly active: boolean
  focus(): void
  invalidate(): void
  close(): void
}

export interface PiTuiUnstableFacadeLike {
  surface: {
    readonly handle: {
      mountComponent(component: {
        render(width: number): string[]
        handleInput?(data: string): void
        dispose?(): void
      }, options?: Record<string, unknown>): UnstableMountLeaseLike
    }
  }
}

interface PiTuiPublicModule {
  LOCAL_COMMANDS: ReadonlySet<string>
}

interface PiTuiUnstableModule {
  UNSTABLE_API_LEVEL: number
  unstable(service: PiTuiExtensionServiceLike): PiTuiUnstableFacadeLike
}

function service(ctx: TuiSurfaceContext): PiTuiExtensionServiceLike | undefined {
  try {
    return ctx.get('piTuiExtensions', false) as PiTuiExtensionServiceLike | undefined
  } catch {
    return undefined
  }
}

function statusId(packageName: string, instanceKey: string | undefined, key: string): string {
  const token = `${packageName}${instanceKey === undefined ? '' : `-${instanceKey}`}-${key}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `pi2dsh-status-${token || 'entry'}`
}

function overlayOptions(options: PiCustomOptions | undefined): Record<string, unknown> | undefined {
  const raw = typeof options?.overlayOptions === 'function'
    ? options.overlayOptions()
    : options?.overlayOptions
  return raw === undefined ? undefined : { ...raw }
}

/** dsh-pi-tui backend over the public `piTuiExtensions` service. */
export class PiTuiExtensionSurfaceAdapter implements TerminalSurfaceAdapter {
  readonly kind = 'piTuiExtensions'
  readonly nativeCommands: ReadonlySet<string>

  private readonly statusHandles = new Map<string, RegistrationHandleLike<FooterSegment>>()
  private readonly mounts = new Set<{ relay: PiComponentRelay, lease?: UnstableMountLeaseLike }>()
  private disposed = false

  constructor(
    private readonly extensionService: PiTuiExtensionServiceLike,
    private readonly unstableFacade: PiTuiUnstableFacadeLike,
    nativeCommands: ReadonlySet<string>,
    private readonly packageName: string,
    private readonly instanceKey?: string,
  ) {
    this.nativeCommands = new Set(nativeCommands)
  }

  get available(): boolean {
    if (this.disposed) return false
    try {
      return this.extensionService.api().capabilities.has('unstable.surface.handle')
    } catch {
      return false
    }
  }

  setStatus(key: string, text: unknown): void {
    if (this.disposed) return
    const id = statusId(this.packageName, this.instanceKey, key)
    const previous = this.statusHandles.get(id)
    if (text === undefined) {
      previous?.dispose()
      this.statusHandles.delete(id)
      return
    }
    const value: FooterSegment = {
      spans: [{ text: String(text), tone: 'textDim' }],
      minWidth: 4,
      importance: 50,
    }
    if (previous !== undefined) {
      previous.replace(value)
      return
    }
    if (!this.extensionService.api().capabilities.has('slot.chrome.footer.status')) return
    this.statusHandles.set(id, this.extensionService.register<FooterSegment>(
      'chrome.footer.status',
      { id, order: 500, description: `Pi status ${key} from ${this.packageName}` },
      value,
    ))
  }

  async custom<T>(
    factory: PiCustomFactory<T>,
    theme: unknown,
    keybindings: unknown,
    options?: PiCustomOptions,
  ): Promise<T | undefined> {
    if (!this.available) return undefined
    for (const active of [...this.mounts]) active.relay.close(undefined)

    const relay = new PiComponentRelay(factory, theme, keybindings, options)
    const record: { relay: PiComponentRelay<T>, lease?: UnstableMountLeaseLike } = { relay }
    this.mounts.add(record as { relay: PiComponentRelay, lease?: UnstableMountLeaseLike })
    try {
      if (!await relay.ready || !relay.active) return await relay.result
      if (this.disposed) {
        relay.close(undefined)
        return await relay.result
      }
      // Read the CURRENT handle at mount time. The public facade follows the
      // active surface generation; retaining an earlier handle would mount on
      // a stale terminal after fullscreen/restart transitions.
      const handle = this.unstableFacade.surface.handle
      const lease = handle.mountComponent({
        render: width => relay.frame({ sessionId: relay.sessionId, width }).lines,
        handleInput: data => relay.input({ sessionId: relay.sessionId, data }),
        dispose: () => relay.close(undefined),
      }, overlayOptions(options))
      record.lease = lease
      const offInvalidate = relay.onInvalidate(() => lease.invalidate())
      const release = (): void => {
        offInvalidate()
        lease.close()
      }
      void relay.result.then(release, release)
      if (!lease.active) relay.close(undefined)
      lease.focus()
      return await relay.result
    } catch (error) {
      relay.fail(error)
      throw error
    } finally {
      this.mounts.delete(record as { relay: PiComponentRelay, lease?: UnstableMountLeaseLike })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const handle of this.statusHandles.values()) handle.dispose()
    this.statusHandles.clear()
    for (const active of this.mounts) {
      active.relay.close(undefined)
      active.lease?.close()
    }
    this.mounts.clear()
  }
}

/**
 * Build the optional backend from published public entry points.
 * Returns undefined when the service is absent or cannot provide the exact
 * raw-component capability; callers then keep the existing dsh-TUI/Web path.
 */
export async function createPiTuiExtensionSurfaceAdapter(
  ctx: TuiSurfaceContext,
  packageName: string,
  instanceKey?: string,
): Promise<PiTuiExtensionSurfaceAdapter | undefined> {
  const extensionService = service(ctx)
  if (extensionService === undefined) return undefined
  const api = extensionService.api()
  if (api.apiVersion !== 1 || !api.capabilities.has('unstable.surface.handle')) {
    ctx.logger?.warn(`pi2dsh: piTuiExtensions cannot host Pi components (api=${api.apiVersion}, raw surface=${api.capabilities.has('unstable.surface.handle')})`)
    return undefined
  }
  try {
    // Variable specifiers keep the optional peer out of the engine's static
    // import graph. Both are documented package exports; no repository or
    // private implementation path is consumed.
    const hostEntry = '@xmoon76/dsh-pi-tui'
    const unstableEntry = '@xmoon76/dsh-pi-tui/extensions/unstable'
    const [hostModule, unstableModule] = await Promise.all([
      import(hostEntry) as Promise<PiTuiPublicModule>,
      import(unstableEntry) as Promise<PiTuiUnstableModule>,
    ])
    if (unstableModule.UNSTABLE_API_LEVEL !== 1) {
      ctx.logger?.warn(`pi2dsh: unsupported dsh-pi-tui unstable API level ${unstableModule.UNSTABLE_API_LEVEL}`)
      return undefined
    }
    return new PiTuiExtensionSurfaceAdapter(
      extensionService,
      unstableModule.unstable(extensionService),
      hostModule.LOCAL_COMMANDS,
      packageName,
      instanceKey,
    )
  } catch (error) {
    ctx.logger?.warn(`pi2dsh: could not attach the public piTuiExtensions backend: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
