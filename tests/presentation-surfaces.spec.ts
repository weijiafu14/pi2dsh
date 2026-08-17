// One test per Pi presentation surface, locked at the seam the browser half
// actually reads.
//
// Why per surface, and why here rather than only in browser-surfaces.spec.ts:
// those tests drive `BrowserSurfaces` directly, so they lock the store and say
// nothing about whether `ctx.ui.setTitle(...)` — what a Pi package really calls
// — reaches it. Ten surfaces shipped connected with no test naming them, and
// the only thing standing behind them was a person clicking through a browser
// once. A surface named in src/compatibility.ts should fail a test when its
// path breaks, which is what these do: a real Pi extension, mounted through
// applyPiPackage into a real DSH context, calling the real Pi method, read back
// through the real HTTP route.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

// One command per surface: a command is how a Pi package reaches ctx.ui with a
// live agent, and zero-argument commands keep the claiming rules out of it
// (an argued command needs an `input` descriptor — tested elsewhere).
const EXTENSION = `
export default function (pi) {
  pi.registerMessageRenderer('probe-msg', message => ({
    render: () => ['message drawn by the package'],
  }))
  pi.registerEntryRenderer('probe-note', entry => ({
    render: () => ['entry: ' + (entry.data?.note ?? '')],
  }))
  const command = (name, handler) => pi.registerCommand(name, { description: name, handler })

  command('s-title', async (args, ctx) => { ctx.ui.setTitle('a title') })
  command('s-status', async (args, ctx) => { ctx.ui.setStatus('k', 'a status') })
  command('s-status-clear', async (args, ctx) => { ctx.ui.setStatus('k', undefined) })
  command('s-widget', async (args, ctx) => { ctx.ui.setWidget('w', ['line one', 'line two']) })
  command('s-widget-factory', async (args, ctx) => {
    ctx.ui.setWidget('w2', () => ({ render: width => ['width=' + width] }))
  })
  command('s-header', async (args, ctx) => { ctx.ui.setHeader(() => ({ render: () => ['a header'] })) })
  command('s-footer', async (args, ctx) => { ctx.ui.setFooter(() => ({ render: () => ['a footer'] })) })
  command('s-working-message', async (args, ctx) => { ctx.ui.setWorkingMessage('still thinking') })
  command('s-working-indicator', async (args, ctx) => { ctx.ui.setWorkingIndicator({ frames: ['a', 'b'] }) })
  command('s-working-hide', async (args, ctx) => { ctx.ui.setWorkingVisible(false) })
  command('s-thinking-label', async (args, ctx) => { ctx.ui.setHiddenThinkingLabel('hidden reasoning') })
  command('s-editor', async (args, ctx) => { ctx.ui.setEditorText('written by the package') })
  command('s-paste', async (args, ctx) => { ctx.ui.pasteToEditor(' + pasted') })
  command('s-read-editor', async (args, ctx) => { pi.setStatusForTest?.(); ctx.ui.setStatus('read', ctx.ui.getEditorText()) })
  command('s-entry', async (args, ctx) => { pi.appendEntry('probe-note', { note: 'from the package' }) })
  command('s-message', async (args, ctx) => {
    pi.sendMessage({ role: 'custom', customType: 'probe-msg', content: 'raw' })
  })
  const report = (ctx, key, value) => ctx.ui.setStatus(key, JSON.stringify(value))

  command('s-state', async (args, ctx) => {
    report(ctx, 'state', {
      isIdle: ctx.isIdle(),
      isProjectTrusted: ctx.isProjectTrusted(),
      hasPendingMessages: ctx.hasPendingMessages(),
      getContextUsage: ctx.getContextUsage() ?? null,
      scopedModels: ctx.scopedModels,
      getSystemPromptOptions: ctx.getSystemPromptOptions(),
    })
  })
  command('s-wait-idle', async (args, ctx) => {
    await ctx.waitForIdle()
    report(ctx, 'waited', true)
  })
  command('s-auth', async (args, ctx) => {
    report(ctx, 'auth', {
      unknown: ctx.modelRegistry.hasConfiguredAuth({ provider: 'no-such-provider' }),
      empty: ctx.modelRegistry.hasConfiguredAuth({}),
    })
  })
  command('s-registry', async (args, ctx) => {
    report(ctx, 'registry', { isArray: Array.isArray(ctx.modelRegistry.getAll()) })
  })
  command('s-terminal', async (args, ctx) => {
    const off = ctx.ui.onTerminalInput(() => {})
    report(ctx, 'terminal', { returns: typeof off })
    off()
  })
  command('s-editor-component', async (args, ctx) => {
    const factory = () => ({ render: () => ['x'] })
    ctx.ui.setEditorComponent(factory)
    report(ctx, 'editorComponent', { readBack: ctx.ui.getEditorComponent() === factory })
  })
  command('s-theme', async (args, ctx) => {
    const all = ctx.ui.getAllThemes()
    report(ctx, 'theme', {
      count: all.length,
      known: ctx.ui.getTheme(all[0].name) !== undefined,
      unknown: ctx.ui.getTheme('no-such-theme') === undefined,
      setKnown: ctx.ui.setTheme(all[0].name),
      setUnknown: ctx.ui.setTheme('no-such-theme'),
    })
  })
  command('s-tools-expanded', async (args, ctx) => {
    const before = ctx.ui.getToolsExpanded()
    ctx.ui.setToolsExpanded(true)
    report(ctx, 'toolsExpanded', { before, after: ctx.ui.getToolsExpanded() })
  })

  command('s-complete', async (args, ctx) => {
    ctx.ui.addAutocompleteProvider(current => ({
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const before = (lines[cursorLine] ?? '').slice(0, cursorCol)
        const at = before.lastIndexOf('@')
        if (at === -1) return current.getSuggestions(lines, cursorLine, cursorCol, options)
        const query = before.slice(at + 1)
        const all = [
          { value: 'alpha', label: 'alpha', description: 'first' },
          { value: 'beta', label: 'beta', description: 'second' },
        ]
        const items = all.filter(item => item.value.startsWith(query))
        return items.length === 0 ? null : { items, prefix: before.slice(at) }
      },
      applyCompletion: (...rest) => current.applyCompletion(...rest),
    }))
  })
}
`

type Json = Record<string, unknown>
interface RouteHandler {
  (req: Json, res: Json): Promise<void>
}

let scratch: string
let ctx: Context
let handler: RouteHandler
let agent: Json
const SESSION = 'pi2dsh-surfaces'

/** GET the bridge's own route, the way the browser half does. */
async function get(path: string): Promise<Json> {
  let body = ''
  let status = 0
  await handler(
    { method: 'GET', url: path },
    {
      writeHead: (code: number) => { status = code },
      end: (chunk?: string) => { body = chunk ?? '' },
    } as unknown as Json,
  )
  expect(status).toBe(200)
  return JSON.parse(body) as Json
}

/** POST what the user has typed, the way the browser half reports it. */
async function reportDraft(draft: string): Promise<void> {
  const payload = JSON.stringify({ session: SESSION, draft })
  await handler(
    {
      method: 'POST',
      url: '/pi2dsh/editor-draft',
      on(event: string, listen: (chunk?: unknown) => void) {
        if (event === 'data') listen(Buffer.from(payload))
        if (event === 'end') listen()
      },
    },
    { writeHead: () => {}, end: () => {} } as unknown as Json,
  )
}

/** Run one of the fixture's commands, as a user picking it from the palette. */
async function run(name: string): Promise<void> {
  const outcome = await ctx.commands.execute(agent as never, `/${name}`, new AbortController().signal)
  // A command that did not claim would silently do nothing and every assertion
  // below would read as "the surface is broken", which is the wrong diagnosis.
  expect(outcome, `/${name} was not claimed by the Pi package`).toBeDefined()
}

/** The one package's surface view for this session. */
async function view(): Promise<Json> {
  const state = await get(`/pi2dsh/browser-state?session=${SESSION}`)
  const surfaces = state.surfaces as Json[]
  return surfaces[0] ?? { values: {}, statuses: {}, widgets: {} }
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-surfaces-'))
  const pkgDir = join(scratch, 'pi-surface-fixture')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
    name: 'pi-surface-fixture', version: '0.0.0', type: 'module', pi: { extensions: ['index.mjs'] },
  }))
  await writeFile(join(pkgDir, 'index.mjs'), EXTENSION)

  const pkg = await resolvePiPackage(pkgDir)
  let manifest
  try {
    manifest = await manifestForInstalled(pkg)
  } finally {
    await pkg.dispose()
  }

  ctx = new Context()
  // The bridge registers its route on the host's web server when there is one.
  // Capturing it here is what makes these assertions read the same bytes the
  // browser half fetches, rather than an internal object.
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('webServer', {
    register(route: { handler: RouteHandler }) {
      handler = route.handler
      return () => {}
    },
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)

  const mount: Plugin.Object = {
    name: 'pi2dsh:surfaces-fixture',
    inject: ['tools', 'systemPrompt', 'commands'],
    async apply(inner) {
      await applyPiPackage(inner, { rootUrl: pathToFileURL(`${pkgDir}/`), manifest })
    },
  }
  await ctx.plugin(mount)

  const session = ctx.sessions.create(SessionId(SESSION), { meta: { createdAt: Date.now(), cwd: scratch } })
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
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe('the route exists at all', () => {
  it('registers on the host web server and answers an unknown session with empty state', async () => {
    expect(handler, 'the bridge registered no route on the host web server').toBeTypeOf('function')
    expect(await get('/pi2dsh/browser-state?session=nobody')).toEqual({ threads: [], surfaces: [], entries: [] })
  })
})

describe('session chrome', () => {
  it('setTitle publishes the title', async () => {
    await run('s-title')
    expect((await view()).values).toMatchObject({ title: 'a title' })
  })

  it('setStatus publishes a keyed status, and undefined clears that key', async () => {
    await run('s-status')
    expect((await view()).statuses).toMatchObject({ k: 'a status' })
    await run('s-status-clear')
    expect((await view()).statuses).not.toHaveProperty('k')
  })

  it('setWidget publishes a keyed widget, joining the lines Pi transmits', async () => {
    await run('s-widget')
    expect((await view()).widgets).toMatchObject({ w: 'line one\nline two' })
  })

  it('setWidget accepts a component factory and renders it at a width', async () => {
    await run('s-widget-factory')
    // The factory contract is `render(width)`, so a rendered widget proves the
    // width was passed rather than the factory being stored unevaluated.
    expect(String((await view()).widgets && ((await view()).widgets as Json).w2)).toMatch(/^width=\d+$/u)
  })

  it('setHeader renders its factory into the header surface', async () => {
    await run('s-header')
    expect((await view()).values).toMatchObject({ header: 'a header' })
  })

  it('setFooter renders its factory into the footer surface', async () => {
    await run('s-footer')
    expect((await view()).values).toMatchObject({ footer: 'a footer' })
  })
})

describe('working chrome', () => {
  it('setWorkingMessage publishes the message', async () => {
    await run('s-working-message')
    expect((await view()).values).toMatchObject({ workingMessage: 'still thinking' })
  })

  it('setWorkingIndicator publishes the frames it was given', async () => {
    await run('s-working-indicator')
    expect((await view()).values).toMatchObject({ workingIndicator: 'ab' })
  })

  it('setHiddenThinkingLabel publishes the label', async () => {
    await run('s-thinking-label')
    expect((await view()).values).toMatchObject({ hiddenThinkingLabel: 'hidden reasoning' })
  })

  it('setWorkingVisible(false) hides the working chrome without clearing it', async () => {
    await run('s-working-hide')
    const seen = await view()
    expect(seen.workingVisible).toBe(false)
    // Still present, so turning it back on does not need the package to resend.
    expect(seen.values).toMatchObject({ workingMessage: 'still thinking' })
  })
})

describe('the composer', () => {
  it('setEditorText asks the browser half to replace the draft', async () => {
    await run('s-editor')
    const state = await get(`/pi2dsh/browser-state?session=${SESSION}`)
    expect(state.draft).toMatchObject({ text: 'written by the package' })
  })

  it('pasteToEditor appends to what the package last wrote', async () => {
    await run('s-paste')
    const state = await get(`/pi2dsh/browser-state?session=${SESSION}`)
    expect(state.draft).toMatchObject({ text: 'written by the package + pasted' })
  })

  it('getEditorText reads what the USER typed, not only the package\'s last write', async () => {
    // The whole point of the browser half reporting the draft back: a package
    // that reads the composer must see the human's edit, or every
    // "act on what is typed" plugin acts on a stale string.
    await reportDraft('typed by the human')
    await run('s-read-editor')
    expect((await view()).statuses).toMatchObject({ read: 'typed by the human' })
  })
})

describe('content the package draws itself', () => {
  it('appendEntry reaches the turn tail through the package\'s own entry renderer', async () => {
    await run('s-entry')
    const state = await get(`/pi2dsh/browser-state?session=${SESSION}`)
    expect((state.entries as Json[]).map(entry => entry.text)).toContain('entry: from the package')
  })

  it('a custom message reaches the turn tail through the package\'s own message renderer', async () => {
    await run('s-message')
    const state = await get(`/pi2dsh/browser-state?session=${SESSION}`)
    expect((state.entries as Json[]).map(entry => entry.text)).toContain('message drawn by the package')
  })
})

/** Read one JSON-reported status back out of the route. */
async function reported(key: string): Promise<Json> {
  const statuses = (await view()).statuses as Record<string, string | undefined>
  const raw = statuses[key]
  expect(raw, `the command reported no "${key}" status`).toBeTypeOf('string')
  return JSON.parse(raw as string) as Json
}

describe('what a package can read about the session it is in', () => {
  it('reports idle, trust, queued messages, context usage, scoped models and prompt options', async () => {
    await run('s-state')
    expect(await reported('state')).toEqual({
      // A command runs outside a turn, so Pi's "is the agent idle" is true.
      isIdle: true,
      // DSH has no project-trust prompt; claiming trust would be a lie.
      isProjectTrusted: false,
      // The agent's durable inbox is empty in this fixture. This one used to be
      // hardcoded false, which told every package the queue never fills.
      hasPendingMessages: false,
      // No live turn, so there is no usage to report — undefined over a guess.
      getContextUsage: null,
      // Empty means "not restricted". Handing back the whole catalog said the
      // opposite: that the session is restricted to every model.
      scopedModels: [],
      getSystemPromptOptions: {},
    })
  })

  it('waitForIdle resolves against the live agent rather than hanging', async () => {
    await run('s-wait-idle')
    expect(await reported('waited')).toBe(true)
  })

  it('hasConfiguredAuth answers false for a provider no route declares', async () => {
    await run('s-auth')
    // A configuration check, like Pi's: an unknown provider is not configured,
    // and a model with no provider cannot be.
    expect(await reported('auth')).toEqual({ unknown: false, empty: false })
  })

  it('modelRegistry.getAll returns a list, not undefined, with no models configured', async () => {
    await run('s-registry')
    expect(await reported('registry')).toEqual({ isArray: true })
  })
})

// These are declined on purpose. A test still belongs here: the declining is a
// decision, and it should break loudly if someone changes it by accident
// rather than silently changing what packages observe.
describe('surfaces this bridge deliberately does not connect', () => {
  it('onTerminalInput accepts the subscription and hands back a disposer', async () => {
    // DSH has no raw-terminal seam (no setRawMode anywhere), so nothing will
    // ever fire — but Pi's contract is that the return value is callable, and
    // a package that calls the disposer must not crash.
    await run('s-terminal')
    expect(await reported('terminal')).toEqual({ returns: 'function' })
  })

  it('setEditorComponent stores the factory and reads back identical', async () => {
    // Mounting a Pi TUI editor component in a browser is the same class of
    // problem as ui.custom; the factory is kept so getEditorComponent is
    // honest, and nothing renders it.
    await run('s-editor-component')
    expect(await reported('editorComponent')).toEqual({ readBack: true })
  })

  it('the theme family answers about the one headless theme, and refuses others', async () => {
    await run('s-theme')
    expect(await reported('theme')).toMatchObject({
      count: 1,
      known: true,
      unknown: true,
      setKnown: { success: true },
      // Refused with a reason rather than a fabricated success.
      setUnknown: { success: false, error: expect.stringContaining('single theme') },
    })
  })

  it('setToolsExpanded round-trips the flag it was given', async () => {
    await run('s-tools-expanded')
    expect(await reported('toolsExpanded')).toEqual({ before: false, after: true })
  })
})

describe('autocomplete', () => {
  it('addAutocompleteProvider serves the package\'s own @-mentions', async () => {
    await run('s-complete')
    const menu = await get('/pi2dsh/completions?trigger=%40&query=')
    expect((menu.items as Json[]).map(item => item.value)).toEqual(expect.arrayContaining(['alpha', 'beta']))
  })

  it('the query narrows the menu, so the package filters rather than the shell', async () => {
    const menu = await get('/pi2dsh/completions?trigger=%40&query=al')
    expect((menu.items as Json[]).map(item => item.value)).toEqual(['alpha'])
  })
})
