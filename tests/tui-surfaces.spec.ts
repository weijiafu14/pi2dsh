// dsh-TUI public-surface contract for real Pi terminal components. The MCP
// adapter is exercised end to end separately; these tests lock the generic
// render/input/lifecycle seam it consumes.
import { describe, expect, it, vi } from 'vitest'
import {
  TuiSurfaceAdapter,
  commandNameForDshTui,
  mountTuiSurfaceAdapter,
  tuiSurfaceInternals,
  type TuiSurfaceContext,
} from '../src/tui-surfaces.js'

type UnknownRecord = Record<string, unknown>

function createHarness() {
  let descriptor: UnknownRecord | undefined
  let opened: string | undefined
  let closeCount = 0
  let sceneDisposed = false
  const statusWrites: Array<{ key: string, text: string | undefined }> = []
  const statusDisposals: string[] = []
  const scenes = {
    register(value: UnknownRecord) {
      descriptor = value
      return () => { sceneDisposed = true }
    },
    open(id: string) {
      opened = id
      return true
    },
    close() {
      closeCount += 1
      opened = undefined
    },
  }
  const status = {
    set(key: string, text: string | undefined) {
      statusWrites.push({ key, text })
      return () => { statusDisposals.push(key) }
    },
  }
  const ctx: TuiSurfaceContext = {
    get(name) {
      if (name === 'tuiScenes') return scenes
      if (name === 'tuiStatus') return status
      return undefined
    },
  }
  return {
    ctx,
    descriptor: () => descriptor,
    opened: () => opened,
    closeCount: () => closeCount,
    sceneDisposed: () => sceneDisposed,
    statusWrites,
    statusDisposals,
  }
}

async function settleFactory(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('dsh-TUI surface adapter', () => {
  it('renders a real Pi component, forwards raw terminal bytes, and resolves only when done closes it', async () => {
    const harness = createHarness()
    const adapter = new TuiSurfaceAdapter(harness.ctx, 'pi-mcp-adapter')
    const inputs: string[] = []
    const dispose = vi.fn()
    let done: ((value: string) => void) | undefined
    let renders = 0

    const result = adapter.custom<string>((tui, theme, keybindings, finish) => {
      expect(theme).toEqual({ name: 'theme' })
      expect(keybindings).toEqual({ name: 'keys' })
      done = finish
      return {
        render(width) {
          renders += 1
          return [`MCP width=${width}`]
        },
        handleInput(data) {
          inputs.push(data)
          tui.requestRender()
        },
        invalidate: vi.fn(),
        dispose,
      }
    }, { name: 'theme' }, { name: 'keys' }, { overlay: true, overlayOptions: { width: 82 } })

    await settleFactory()
    expect(harness.opened()).toBe(adapter.sceneId)
    expect(adapter.render(120)).toEqual(['MCP width=82'])
    adapter.handleInput('\x1b[B')
    expect(inputs).toEqual(['\x1b[B'])
    expect(renders).toBe(1)

    done?.('saved')
    await expect(result).resolves.toBe('saved')
    expect(harness.opened()).toBeUndefined()
    expect(harness.closeCount()).toBe(1)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('uses the host React/ui scene and forwards the keypress sequence rather than a parsed key name', async () => {
    const harness = createHarness()
    const adapter = new TuiSurfaceAdapter(harness.ctx, '@scope/mcp-ui')
    const received: string[] = []
    let finish: ((value: undefined) => void) | undefined
    const result = adapter.custom<undefined>((_tui, _theme, _keys, done) => {
      finish = done
      return {
        render: width => [`\x1b[32mgreen at ${width}\x1b[0m`],
        handleInput: data => received.push(data),
      }
    }, {}, {})
    await settleFactory()

    let inputHandler: ((input: string, key: UnknownRecord, event?: UnknownRecord) => void) | undefined
    let cleanup: (() => void) | undefined
    const React = {
      createElement: (type: unknown, props: UnknownRecord | null = null, ...children: unknown[]) => ({ type, props, children }),
      useEffect(effect: () => void | (() => void)) {
        cleanup = effect() ?? undefined
      },
      useSyncExternalStore(_subscribe: unknown, getSnapshot: () => number) {
        return getSnapshot()
      },
    }
    const ui = {
      Box: 'Box',
      Text: 'Text',
      Ansi: 'Ansi',
      useInput(handler: typeof inputHandler) { inputHandler = handler },
      useTerminalSize: () => ({ columns: 100, rows: 40 }),
    }
    const component = harness.descriptor()?.component as ((props: UnknownRecord) => UnknownRecord)
    const tree = component({ React, ui, close: () => {} })
    expect(tree.type).toBe('Box')
    expect((tree.children as UnknownRecord[])[0]?.type).toBe('Ansi')
    expect((tree.children as UnknownRecord[])[0]?.children).toEqual(['\x1b[32mgreen at 98\x1b[0m'])

    inputHandler?.('', { downArrow: true }, { keypress: { sequence: '\x1b[B' } })
    expect(received).toEqual(['\x1b[B'])
    finish?.(undefined)
    await result
    cleanup?.()
  })

  it('projects keyed Pi status into dsh-TUI and disposes stale writes', () => {
    const harness = createHarness()
    const adapter = new TuiSurfaceAdapter(harness.ctx, '@scope/pi-mcp-adapter')

    adapter.setStatus('mcp-auth', 'Authenticating…')
    adapter.setStatus('mcp-auth', 'Connected')
    adapter.setStatus('mcp-auth', undefined)

    expect(harness.statusWrites).toEqual([
      { key: 'pi2dsh:scope-pi-mcp-adapter:mcp-auth', text: 'Authenticating…' },
      { key: 'pi2dsh:scope-pi-mcp-adapter:mcp-auth', text: 'Connected' },
    ])
    expect(harness.statusDisposals).toEqual([
      'pi2dsh:scope-pi-mcp-adapter:mcp-auth',
      'pi2dsh:scope-pi-mcp-adapter:mcp-auth',
    ])
  })

  it('cancels an active component and releases scene/status resources on unload', async () => {
    const harness = createHarness()
    const adapter = new TuiSurfaceAdapter(harness.ctx, 'pi-mcp-adapter')
    const componentDispose = vi.fn()
    const result = adapter.custom(() => ({ render: () => ['open'], dispose: componentDispose }), {}, {})
    await settleFactory()
    adapter.setStatus('mcp', '1 server')

    adapter.dispose()

    await expect(result).resolves.toBeUndefined()
    expect(componentDispose).toHaveBeenCalledOnce()
    expect(harness.sceneDisposed()).toBe(true)
    expect(harness.statusDisposals).toContain('pi2dsh:pi-mcp-adapter:mcp')
    expect(adapter.available).toBe(false)
  })

  it('tracks the optional service through a Cordis-style injected child activation', () => {
    const harness = createHarness()
    let published: TuiSurfaceAdapter | undefined
    let release: (() => void) | undefined
    const parent: TuiSurfaceContext = {
      get: () => undefined,
      inject(services, callback) {
        expect(services).toEqual(['tuiScenes'])
        callback({
          ...harness.ctx,
          effect(register) { release = register() },
        })
      },
    }

    mountTuiSurfaceAdapter(parent, 'pi-mcp-adapter', value => { published = value })
    expect(published?.available).toBe(true)
    release?.()
    expect(published).toBeUndefined()
  })

  it('registers immediately on the owning activation when the scene service already exists', () => {
    const harness = createHarness()
    let injected = false
    let published: TuiSurfaceAdapter | undefined
    const owner: TuiSurfaceContext = {
      get: harness.ctx.get,
      effect(register) { register() },
      inject() { injected = true },
    }

    mountTuiSurfaceAdapter(owner, 'pi-mcp-adapter', value => { published = value }, 'agent-b')

    expect(injected).toBe(false)
    expect(published?.available).toBe(true)
    expect(published?.sceneId).toBe('pi2dsh-pi-mcp-adapter-agent-b-custom')
  })
})

describe('dsh-TUI interop policy', () => {
  it('keeps dsh-TUI native /mcp and exposes the Pi manager as /pi-mcp only on that surface', () => {
    expect(commandNameForDshTui('mcp', true)).toBe('pi-mcp')
    expect(commandNameForDshTui('mcp', false)).toBe('mcp')
    expect(commandNameForDshTui('other', true)).toBe('other')
  })

  it('reconstructs Pi raw key bytes when the host event has no sequence', () => {
    expect(tuiSurfaceInternals.rawTerminalInput('', { return: true })).toBe('\r')
    expect(tuiSurfaceInternals.rawTerminalInput('', { escape: true })).toBe('\x1b')
    expect(tuiSurfaceInternals.rawTerminalInput('c', { ctrl: true })).toBe('\x03')
    expect(tuiSurfaceInternals.rawTerminalInput('', { leftArrow: true })).toBe('\x1b[D')
  })
})
