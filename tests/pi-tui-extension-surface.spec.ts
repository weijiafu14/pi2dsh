import { describe, expect, it, vi } from 'vitest'
import { PiComponentRelay } from '../src/pi-component-relay.js'
import {
  PiTuiExtensionSurfaceAdapter,
  type PiTuiExtensionServiceLike,
  type PiTuiUnstableFacadeLike,
} from '../src/pi-tui-extension-surface.js'

describe('transport-neutral Pi component relay', () => {
  it('keeps the component Host-side and exchanges only frame/input/lifecycle data', async () => {
    const inputs: string[] = []
    const revisions: number[] = []
    const dispose = vi.fn()
    let done: ((value: string) => void) | undefined
    const relay = new PiComponentRelay<string>((tui, _theme, _keys, finish) => {
      done = finish
      return {
        render: width => [`relay:${width}`],
        handleInput(data) {
          inputs.push(data)
          tui.requestRender()
        },
        dispose,
      }
    }, {}, {})

    relay.onInvalidate(revision => revisions.push(revision))
    expect(await relay.ready).toBe(true)
    expect(relay.frame({ sessionId: relay.sessionId, width: 79.8 })).toMatchObject({
      sessionId: relay.sessionId,
      width: 79,
      lines: ['relay:79'],
    })
    relay.input({ sessionId: relay.sessionId, data: '\x1b[B' })
    expect(inputs).toEqual(['\x1b[B'])
    expect(revisions.length).toBeGreaterThanOrEqual(2)

    done?.('saved')
    await expect(relay.result).resolves.toBe('saved')
    expect(dispose).toHaveBeenCalledOnce()
    expect(relay.active).toBe(false)
  })
})

function createExtensionHarness() {
  const registrations = new Map<string, {
    value: unknown
    replace(value: unknown): void
    dispose(): void
  }>()
  let mounted: {
    render(width: number): string[]
    handleInput?(raw: string): void
    dispose?(): void
  } | undefined
  const lease = {
    id: 'lease-1',
    active: true,
    focused: false,
    focus: vi.fn(),
    blur: vi.fn(),
    invalidate: vi.fn(),
    close: vi.fn(() => { mounted?.dispose?.() }),
    hide: vi.fn(),
    show: vi.fn(),
  }
  const service = {
    api: () => ({
      apiVersion: 1,
      hostVersion: '0.3.4',
      capabilities: new Set(['slot.chrome.footer.status', 'unstable.surface.handle']),
      deprecations: new Map(),
    }),
    register(_slot: string, spec: { id: string }, value: unknown) {
      const handle = {
        value,
        replace(next: unknown) { handle.value = next },
        dispose() { registrations.delete(spec.id) },
        invalidate() {},
        id: spec.id,
      }
      registrations.set(spec.id, handle)
      return handle
    },
  } as unknown as PiTuiExtensionServiceLike
  const unstable = {
    surface: {
      handle: {
        surfaceId: 'surface-1',
        generation: 1,
        width: 100,
        height: 40,
        requestRender() {},
        mountComponent(component: typeof mounted) {
          mounted = component
          return lease
        },
      },
    },
  } as unknown as PiTuiUnstableFacadeLike
  return { service, unstable, registrations, mounted: () => mounted, lease }
}

describe('dsh-pi-tui public surface backend', () => {
  it('mounts every Pi custom component through the same raw public seam', async () => {
    const harness = createExtensionHarness()
    const adapter = new PiTuiExtensionSurfaceAdapter(
      harness.service,
      harness.unstable,
      new Set(['login', 'tasks']),
      '@scope/any-pi-package',
    )
    const inputs: string[] = []
    let done: ((value: string) => void) | undefined
    const result = adapter.custom<string>((tui, _theme, _keys, finish) => {
      done = finish
      return {
        render: width => [`manager:${width}`],
        handleInput(data) {
          inputs.push(data)
          tui.requestRender()
        },
      }
    }, {}, {})
    await vi.waitFor(() => expect(harness.mounted()).toBeDefined())

    expect(adapter.nativeCommands.has('login')).toBe(true)
    expect(harness.mounted()?.render(92)).toEqual(['manager:92'])
    harness.mounted()?.handleInput?.('\r')
    expect(inputs).toEqual(['\r'])
    expect(harness.lease.invalidate).toHaveBeenCalled()
    expect(harness.lease.focus).toHaveBeenCalledOnce()

    done?.('closed')
    await expect(result).resolves.toBe('closed')
    expect(harness.lease.close).toHaveBeenCalled()
  })

  it('projects keyed status only into the declared footer slot', () => {
    const harness = createExtensionHarness()
    const adapter = new PiTuiExtensionSurfaceAdapter(
      harness.service,
      harness.unstable,
      new Set(),
      'pi-mcp-adapter',
    )
    adapter.setStatus('mcp', 'Connecting')
    const [id, handle] = [...harness.registrations.entries()][0]!
    expect(id).toContain('pi-mcp-adapter-mcp')
    expect(handle.value).toMatchObject({ spans: [{ text: 'Connecting' }] })

    adapter.setStatus('mcp', 'Connected')
    expect(handle.value).toMatchObject({ spans: [{ text: 'Connected' }] })
    adapter.setStatus('mcp', undefined)
    expect(harness.registrations.size).toBe(0)
  })
})
