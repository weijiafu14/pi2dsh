// Transport-neutral relay for Pi custom terminal components.
//
// The Pi component object stays on the Host side. A presentation seat only
// exchanges serializable render/input/lifecycle messages. Today the
// dsh-pi-tui adapter calls this relay in-process; the same contract can later
// travel over DSH's client wire without moving callbacks or component objects
// across the Server/Client boundary.

import type {
  PiCustomComponent,
  PiCustomFactory,
  PiCustomOptions,
  PiTuiDriver,
} from './tui-surfaces.js'

export interface PiComponentFrameRequest {
  sessionId: string
  width: number
}

export interface PiComponentFrame {
  sessionId: string
  revision: number
  width: number
  lines: string[]
}

export interface PiComponentInput {
  sessionId: string
  data: string
}

let relaySerial = 0

function relayId(): string {
  relaySerial += 1
  return `pi2dsh-custom-${relaySerial}`
}

/**
 * One Host-owned Pi component session expressed as data messages.
 *
 * The result value never crosses the presentation boundary: Pi's own `done`
 * callback completes it on the Host. Frames and input are deliberately plain
 * data so the presentation transport can change independently.
 */
export class PiComponentRelay<T = unknown> {
  readonly sessionId = relayId()
  readonly options: PiCustomOptions | undefined
  readonly ready: Promise<boolean>
  readonly result: Promise<T | undefined>

  private component: PiCustomComponent | undefined
  private readonly invalidations = new Set<(revision: number) => void>()
  private resolveResult!: (value: T | undefined) => void
  private rejectResult!: (error: unknown) => void
  private revision = 0
  private closed = false

  constructor(
    factory: PiCustomFactory<T>,
    theme: unknown,
    keybindings: unknown,
    options?: PiCustomOptions,
  ) {
    this.options = options
    this.result = new Promise<T | undefined>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    const driver: PiTuiDriver = { requestRender: () => this.invalidate() }
    const done = (value: T): void => this.close(value)
    this.ready = Promise.resolve()
      .then(() => factory(driver, theme, keybindings, done))
      .then(component => {
        if (this.closed) {
          component.dispose?.()
          return false
        }
        if (typeof component?.render !== 'function') {
          throw new TypeError('Pi custom component must implement render(width)')
        }
        this.component = component
        this.invalidate()
        return true
      })
      .catch(error => {
        this.fail(error)
        return false
      })
  }

  get active(): boolean {
    return !this.closed
  }

  onInvalidate(listener: (revision: number) => void): () => void {
    this.invalidations.add(listener)
    return () => this.invalidations.delete(listener)
  }

  frame(request: PiComponentFrameRequest): PiComponentFrame {
    if (request.sessionId !== this.sessionId) throw new Error('stale Pi component render session')
    const width = Math.max(1, Math.floor(request.width))
    return {
      sessionId: this.sessionId,
      revision: this.revision,
      width,
      lines: this.component?.render(width) ?? [],
    }
  }

  input(message: PiComponentInput): void {
    if (message.sessionId !== this.sessionId || this.closed) return
    this.component?.handleInput?.(message.data)
  }

  invalidate(): void {
    if (this.closed) return
    this.revision += 1
    for (const listener of this.invalidations) listener(this.revision)
  }

  close(value?: T): void {
    if (this.closed) return
    this.closed = true
    const component = this.component
    this.component = undefined
    component?.dispose?.()
    this.invalidations.clear()
    this.resolveResult(value)
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.closed = true
    const component = this.component
    this.component = undefined
    component?.dispose?.()
    this.invalidations.clear()
    this.rejectResult(error)
  }
}

