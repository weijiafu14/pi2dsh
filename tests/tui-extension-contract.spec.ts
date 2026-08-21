// Public Pi API -> real DSH command runtime -> dsh-TUI service contract.
// This closes the gap a module-only scene test cannot: ctx.mode/hasUI,
// ctx.ui.custom, ctx.ui.setStatus and /mcp command avoidance all travel
// through applyPiPackage exactly as an installed extension sees them.
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { applyPiPackage } from '../src/runtime.js'
import { manifestForInstalled } from '../src/host.js'
import { resolvePiPackage } from '../src/source.js'

type UnknownRecord = Record<string, unknown>

const extensionSource = (loadingMarker: string): string => String.raw`
import { writeFile } from 'node:fs/promises'
await writeFile(${JSON.stringify(loadingMarker)}, 'loading')
await new Promise(resolve => setTimeout(resolve, 50))

export default function (pi) {
  let sessionStarts = 0
  let sessionActive = false
  const lifecycle = []
  pi.on('session_start', async (event) => {
    await new Promise(resolve => setTimeout(resolve, 30))
    sessionStarts += 1
    sessionActive = true
    lifecycle.push('start:' + event.reason)
  })
  pi.on('session_shutdown', async (event) => {
    sessionActive = false
    lifecycle.push('shutdown:' + event.reason)
  })
  pi.registerTool({
    name: 'mcp-start-probe',
    label: 'MCP start probe',
    description: 'Return how many Pi sessions initialized this extension.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return {
        content: [{ type: 'text', text: 'starts=' + sessionStarts + ' active=' + sessionActive + ' last=' + lifecycle.slice(-2).join(',') }],
        details: {},
      }
    },
  })
  pi.registerCommand('reload-mcp', {
    description: 'Reload the extension',
    async handler(_args, ctx) {
      await ctx.reload()
      ctx.ui.notify('reloaded')
    },
  })
  const mcpCommand = {
    description: 'Open the extension MCP manager',
    async handler(_args, ctx) {
      ctx.ui.setStatus('mcp', 'ready')
      const result = await ctx.ui.custom((tui, _theme, _keybindings, done) => ({
        render(width) {
          return ['MCP_MANAGER width=' + width + ' mode=' + ctx.mode + ' hasUI=' + ctx.hasUI + ' starts=' + sessionStarts]
        },
        handleInput(data) {
          if (data === '\r') done('MCP_OK')
          else tui.requestRender()
        },
        invalidate() {},
      }), { overlay: true, overlayOptions: { width: 82 } })
      ctx.ui.setStatus('mcp', undefined)
      ctx.ui.notify('closed:' + result)
    },
  }
  pi.registerCommand('mcp', mcpCommand)
  pi.registerCommand('pi-mcp', mcpCommand)
}
`

let scratch: string
let ctx: Context
let agent: UnknownRecord
let scene: UnknownRecord | undefined
let inputHandler: ((input: string, key: UnknownRecord, event?: UnknownRecord) => void) | undefined
let opened: string | undefined
const statusWrites: Array<{ key: string, text: string | undefined }> = []

function emitAgentStart(target: UnknownRecord, source: 'fresh' | 'resume'): void {
  ;(ctx as unknown as { emit(name: string, payload: UnknownRecord): void })
    .emit('agent/session-start', { agent: target, source })
}

function emitAgentDisposed(target: UnknownRecord): void {
  ;(ctx as unknown as { emit(name: string, payload: UnknownRecord): void })
    .emit('agent/disposed', { agent: target })
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-tui-contract-'))
  const pkgDir = join(scratch, 'pi-mcp-contract')
  const loadingMarker = join(scratch, 'extension-loading')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
    name: 'pi-mcp-contract', version: '0.0.0', type: 'module', pi: { extensions: ['index.mjs'] },
  }))
  await writeFile(join(pkgDir, 'index.mjs'), extensionSource(loadingMarker))
  const pkg = await resolvePiPackage(pkgDir)
  let manifest
  try {
    manifest = await manifestForInstalled(pkg)
  } finally {
    await pkg.dispose()
  }

  ctx = new Context()
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('tuiScenes', {
    register(descriptor: UnknownRecord) {
      scene = descriptor
      return () => { scene = undefined }
    },
    open(id: string) {
      opened = id
      return true
    },
    close() { opened = undefined },
  })
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('tuiStatus', {
    set(key: string, text: string | undefined) {
      statusWrites.push({ key, text })
      return () => {}
    },
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)

  const mount: Plugin.Object = {
    name: 'pi2dsh:tui-contract',
    inject: ['tools', 'systemPrompt', 'commands', 'tuiScenes'],
    async apply(inner) {
      await applyPiPackage(inner, { rootUrl: pathToFileURL(`${pkgDir}/`), manifest })
    },
  }
  const session = ctx.sessions.create(SessionId('pi2dsh-tui-contract'), { meta: { createdAt: Date.now(), cwd: scratch } })
  agent = {
    id: session.id,
    session,
    options: {},
    inbox: {},
    status: 'idle',
    inject() {},
    steer() {},
    followup() {},
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent as never) }, {
    inject: ['tools', 'systemPrompt'],
  }))

  // Reproduce dsh-TUI's ordering exactly: its agent announces the session
  // while the Pi extension entry is still in an async import. The bridge must
  // retain this start until the entry has registered its handler.
  const mounting = ctx.plugin(mount)
  for (let index = 0; index < 100; index += 1) {
    try {
      await access(loadingMarker)
      break
    } catch {
      await delay(2)
    }
  }
  await access(loadingMarker)
  emitAgentStart(agent, 'fresh')
  await mounting
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe('Pi custom UI on dsh-TUI', () => {
  it('keeps native /mcp free and runs the extension panel under /pi-mcp', async () => {
    expect(ctx.commands.find(agent as never, 'mcp')).toBeUndefined()
    expect(ctx.commands.find(agent as never, 'pi-mcp')).toBeDefined()
    expect(ctx.commands.find(agent as never, 'pi-mcp-2')).toBeUndefined()

    // Reload replaces the extension instance and therefore its handler
    // ledger. The new instance must receive exactly one replayed start; the
    // later duplicate DSH lifecycle announcement must not increment it.
    const reload = await ctx.commands.execute(agent as never, '/reload-mcp', [], new AbortController().signal)
    expect(reload?.result.text).toBe('reloaded')
    emitAgentStart(agent, 'resume')
    await Promise.resolve()

    const execution = ctx.commands.execute(agent as never, '/pi-mcp', [], new AbortController().signal)
    for (let index = 0; index < 20 && opened === undefined; index += 1) await Promise.resolve()
    expect(opened).toBe('pi2dsh-pi-mcp-contract-custom')
    expect(scene).toBeDefined()

    let cleanup: (() => void) | undefined
    const React = {
      createElement: (type: unknown, props: UnknownRecord | null = null, ...children: unknown[]) => ({ type, props, children }),
      useEffect(effect: () => void | (() => void)) { cleanup = effect() ?? undefined },
      useSyncExternalStore(_subscribe: unknown, getSnapshot: () => number) { return getSnapshot() },
    }
    const ui = {
      Box: 'Box',
      Text: 'Text',
      Ansi: 'Ansi',
      useInput(handler: typeof inputHandler) { inputHandler = handler },
      useTerminalSize: () => ({ columns: 120, rows: 40 }),
    }
    const tree = (scene?.component as (props: UnknownRecord) => UnknownRecord)({ React, ui, close: () => {} })
    const line = ((tree.children as UnknownRecord[])[0]?.children as unknown[])[0]
    expect(line).toBe('MCP_MANAGER width=82 mode=tui hasUI=true starts=1')

    inputHandler?.('', { return: true }, { keypress: { sequence: '\r' } })
    const outcome = await execution
    expect(outcome?.result.text).toBe('closed:MCP_OK')
    expect(opened).toBeUndefined()
    expect(statusWrites).toEqual([
      { key: 'pi2dsh:pi-mcp-contract:mcp', text: 'ready' },
    ])
    cleanup?.()
  })

  it('waits for an already in-flight session_start before an immediate Pi command', async () => {
    const session = ctx.sessions.create(SessionId('pi2dsh-tui-immediate-command'), {
      meta: { createdAt: Date.now(), cwd: scratch },
    })
    const immediateAgent: UnknownRecord = {
      id: session.id,
      session,
      options: {},
      inbox: {},
      status: 'idle',
      inject() {},
      steer() {},
      followup() {},
      whenIdle: () => Promise.resolve(),
    }
    emitAgentStart(immediateAgent, 'fresh')
    const execution = ctx.commands.execute(
      immediateAgent as never,
      '/pi-mcp',
      [],
      new AbortController().signal,
    )
    for (let index = 0; index < 100 && opened === undefined; index += 1) await delay(2)
    expect(opened).toBe('pi2dsh-pi-mcp-contract-custom')

    let cleanup: (() => void) | undefined
    const React = {
      createElement: (type: unknown, props: UnknownRecord | null = null, ...children: unknown[]) => ({ type, props, children }),
      useEffect(effect: () => void | (() => void)) { cleanup = effect() ?? undefined },
      useSyncExternalStore(_subscribe: unknown, getSnapshot: () => number) { return getSnapshot() },
    }
    const ui = {
      Box: 'Box',
      Text: 'Text',
      Ansi: 'Ansi',
      useInput(handler: typeof inputHandler) { inputHandler = handler },
      useTerminalSize: () => ({ columns: 120, rows: 40 }),
    }
    const tree = (scene?.component as (props: UnknownRecord) => UnknownRecord)({ React, ui, close: () => {} })
    const line = ((tree.children as UnknownRecord[])[0]?.children as unknown[])[0]
    expect(line).toContain('starts=2')

    inputHandler?.('', { return: true }, { keypress: { sequence: '\r' } })
    await execution
    cleanup?.()
  })

  it('starts a replacement TUI session before its first Pi tool call', async () => {
    const session = ctx.sessions.create(SessionId('pi2dsh-tui-immediate-tool'), {
      meta: { createdAt: Date.now(), cwd: scratch },
    })
    const immediateAgent: UnknownRecord = {
      id: session.id,
      session,
      options: {},
      inbox: {},
      status: 'idle',
      inject() {},
      steer() {},
      followup() {},
      whenIdle: () => Promise.resolve(),
    }

    // dsh-TUI /new can expose the replacement Agent to tools before the
    // optional DSH agent/session-start announcement. Pi still promises its
    // session_start handlers have completed before any tool executes.
    const result = await ctx.tools.execute({
      agent: immediateAgent as never,
      signal: new AbortController().signal,
      callId: 'tui-immediate-tool' as never,
      name: 'mcp-start-probe',
      arguments: {},
    })
    expect(result.isError).toBe(false)
    expect((result.content[0] as { text: string }).text).toContain('active=true')
  })

  it('ignores a stale disposal after dsh-TUI has replaced the foreground Agent', async () => {
    const makeAgent = (id: string): UnknownRecord => {
      const session = ctx.sessions.create(SessionId(id), {
        meta: { createdAt: Date.now(), cwd: scratch },
      })
      return {
        id: session.id,
        session,
        options: {},
        inbox: {},
        status: 'idle',
        inject() {},
        steer() {},
        followup() {},
        whenIdle: () => Promise.resolve(),
      }
    }
    const previous = makeAgent('pi2dsh-tui-replaced-previous')
    const replacement = makeAgent('pi2dsh-tui-replaced-current')
    const executeProbe = (target: UnknownRecord, callId: string) => ctx.tools.execute({
      agent: target as never,
      signal: new AbortController().signal,
      callId: callId as never,
      name: 'mcp-start-probe',
      arguments: {},
    })

    await executeProbe(previous, 'previous-first-call')
    const replacementStart = await executeProbe(replacement, 'replacement-first-call')
    expect((replacementStart.content[0] as { text: string }).text).toContain('last=shutdown:new,start:new')
    emitAgentDisposed(previous)
    await delay(10)

    const afterStaleDispose = await executeProbe(replacement, 'replacement-after-stale-dispose')
    expect(afterStaleDispose.isError).toBe(false)
    expect((afterStaleDispose.content[0] as { text: string }).text).toContain('active=true')
  })
})
