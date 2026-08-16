// The side-conversation panel's server half.
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
// Nothing here knows about pi-btw. A thread is tracked because a Pi package
// opened a child session, whatever the package.
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
export class SidePanelRegistry {
  readonly #byParent = new Map<string, Map<string, TrackedThread>>()

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
}

interface WebServerLike {
  register(route: { kind: string, path: string, handler: (req: UnknownRecord, res: UnknownRecord) => Promise<void> }): () => void
}

/**
 * Serve the panel's own read route on the host's web server.
 *
 * One prefix, one GET: the client half polls it for the session it is showing.
 * A composition with no web server (the CLI profile) simply has no panel, which
 * is the correct outcome rather than an error — the side conversation itself
 * still runs, and the host's subagent catalog still lists it.
 * @param ctx - the mounting context.
 * @param registry - live thread registry to read from.
 * @returns whether the route was registered.
 */
export function registerSidePanelRoute(ctx: Context, registry: SidePanelRegistry): boolean {
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
      if (url.pathname !== '/pi2dsh/side-panel') {
        response.writeHead(404)
        response.end()
        return
      }
      const session = url.searchParams.get('session') ?? ''
      const body = JSON.stringify({ threads: session === '' ? [] : registry.snapshot(session) })
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        // The panel polls; a cached answer would freeze the thread mid-turn.
        'cache-control': 'no-store',
      })
      response.end(method === 'HEAD' ? undefined : body)
    },
  }), 'pi2dsh: side-panel route')
  return true
}
