import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { InMemoryCredentialStore } from './compat/vendor/pi-ai-credential-store.js'
import { resolveProviderAuth } from './compat/vendor/pi-ai-auth-resolve.js'
import { adaptOAuth } from './compat/vendor/pi-oauth-adapt.js'
import { openBrowser } from './compat/vendor/pi-open-browser.js'

type UnknownRecord = Record<string, unknown>

// The interactive OAuth host seam, four layers with one owner each:
//   L1 protocol   — the package's own oauth.login/refreshToken/getApiKey code
//                   runs verbatim (device-code, auth-code, rotation). The
//                   bridge implements zero protocol.
//   L2 interaction— Pi's official adaptOAuth (vendored) turns the package's
//                   callbacks into prompt/notify events; this file routes
//                   those onto the Pi ui surface, which pi2dsh already maps
//                   to DSH userQuestions with real waits.
//   L3 credentials— Pi's auth.json contract: one file keyed by provider id,
//                   0600, atomic replace, per-provider serialized writes
//                   (the vendored InMemoryCredentialStore chain), refresh via
//                   Pi's vendored double-checked-lock resolver.
//   L4 routing    — resolveOAuthApiKey yields the request key for dsh-llm's
//                   one-shot credential seam; tokens never enter DSH settings.

export class FileCredentialStore extends InMemoryCredentialStore {
  readonly #path: string

  constructor(path: string) {
    super()
    this.#path = path
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, UnknownRecord>
      for (const [providerId, credential] of Object.entries(data)) {
        ;(this as unknown as { credentials: Map<string, unknown> }).credentials.set(providerId, credential)
      }
    } catch {
      // Missing or unreadable auth.json starts empty, exactly like Pi.
    }
  }

  get path(): string {
    return this.#path
  }

  async #persist(): Promise<void> {
    const credentials = (this as unknown as { credentials: Map<string, unknown> }).credentials
    const data = Object.fromEntries(credentials)
    await mkdir(dirname(this.#path), { recursive: true })
    // Atomic replace so a crash mid-write never truncates the store; 0600 so
    // tokens stay owner-readable only. Same contract Pi's file store keeps.
    const temp = `${this.#path}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9).toString(36)}`
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.#path)
  }

  override modify(providerId: string, fn: (current: unknown) => unknown, options?: UnknownRecord): Promise<unknown> {
    // The vendored per-provider chain already serializes writers; persisting
    // inside the chained task keeps disk order identical to memory order.
    return super.modify(providerId, async (current: unknown) => {
      const next = await fn(current)
      if (next !== undefined) {
        const credentials = (this as unknown as { credentials: Map<string, unknown> }).credentials
        credentials.set(providerId, next)
        await this.#persist()
      }
      return next
    }, options)
  }

  override delete(providerId: string, options?: UnknownRecord): Promise<void> {
    return super.delete(providerId, options).then(() => this.#persist()) as Promise<void>
  }
}

export interface OAuthUiSurface {
  /**
   * @param signal cancels THIS question when another path in the flow answers
   *   first — the browser callback beating the paste box. Optional because
   *   Pi's own ui.input takes two arguments; the bridge's accepts a third.
   */
  input(title: unknown, placeholder?: unknown, signal?: AbortSignal): Promise<string | undefined>
  select(title: unknown, options: unknown[], signal?: AbortSignal): Promise<string | undefined>
  notify(message: unknown): void
}

interface OAuthPromptEvent {
  type: 'text' | 'manual_code' | 'select'
  message: string
  placeholder?: string
  options?: Array<{ id: string, label: string }>
  /** Cancels THIS question when another path in the flow answers first. */
  signal?: AbortSignal
}

interface OAuthNotifyEvent {
  type: 'auth_url' | 'device_code' | 'progress'
  url?: string
  instructions?: string
  userCode?: string
  verificationUri?: string
  message?: string
}

// The pi-ai interaction surface ({prompt, notify, signal}) over the Pi ui
// surface pi2dsh already maps to DSH userQuestions.
/**
 * Hand a URL to the platform browser, never letting the attempt break login.
 * @param url - the address the flow announced, when it announced one.
 */
function openIfPossible(url: string | undefined): void {
  if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) return
  try {
    openBrowser(url)
  } catch {
    // Best effort by design: the URL is in the prompt either way, and a host
    // with no desktop session (a container, a remote box) must still be able to
    // finish the login by pasting the code.
  }
}

export function oauthInteraction(ui: OAuthUiSurface, signal?: AbortSignal): {
  prompt(prompt: OAuthPromptEvent): Promise<string | undefined>
  notify(event: OAuthNotifyEvent): void
  signal: AbortSignal
} {
  // Pi hosts always hand flows a live signal; flows attach abort listeners
  // unconditionally, so an absent caller signal becomes a never-aborting one.
  const effectiveSignal = signal ?? new AbortController().signal
  // Where the user has to GO to authorize, held until the next prompt.
  //
  // The flow announces the authorization URL through notify() and then blocks
  // on prompt() for the code. A notice is a command notice on DSH: it reaches
  // the user when the command ENDS — and this command cannot end until the user
  // acts on the notice. So the address was delivered after it was needed, and
  // the dialog on screen showed only the redirect URI (localhost/auth/callback),
  // which does nothing when clicked. Carrying it into the prompt puts it where
  // the user is already looking.
  let pending: string | undefined
  /**
   * Hand the announced address to the prompt as its DETAIL, not its title.
   *
   * An authorization URL is 400 characters of query string. Prepending it to
   * the question turned the dialog into a wall of wrapped text with the actual
   * question buried underneath; `detail` is the slot DSH renders supporting
   * text in.
   * @param placeholder - the flow's own placeholder, kept when it supplied one.
   */
  const takePending = (placeholder: unknown): string | undefined => {
    const carried = pending
    pending = undefined
    if (carried === undefined) return placeholder === undefined ? undefined : String(placeholder)
    return placeholder === undefined ? carried : `${carried}\n\n${String(placeholder)}`
  }
  return {
    signal: effectiveSignal,
    async prompt(prompt) {
      if (prompt.type === 'select') {
        const options = prompt.options ?? []
        pending = undefined
        const picked = await ui.select(prompt.message, options.map(option => option.label))
        return options.find(option => option.label === picked)?.id ?? picked
      }
      // The flow's per-prompt signal: it cancels this box when another path
      // wins the race (the local callback receiving the code).
      return ui.input(prompt.message, takePending(prompt.placeholder), prompt.signal)
    },
    notify(event) {
      if (event.type === 'auth_url') {
        const text = `Open this URL to authorize: ${event.url}${event.instructions !== undefined ? `\n${event.instructions}` : ''}`
        pending = text
        ui.notify(text)
        // Open it, the way Pi's own login dialog does. The flows themselves
        // print "A browser window should open" — that sentence is Pi telling
        // the user what the HOST is about to do, and a host that does not do it
        // leaves a wrapped, unclickable URL and no way to authorize.
        openIfPossible(event.url)
      } else if (event.type === 'device_code') {
        const text = `Visit ${event.verificationUri} and enter code ${event.userCode}`
        pending = text
        ui.notify(text)
        openIfPossible(event.verificationUri)
      } else if (event.message !== undefined) {
        ui.notify(event.message)
      }
    },
  }
}

function oauthConfigOf(providerConfig: UnknownRecord | undefined): UnknownRecord | undefined {
  // Extension-generation configs carry oauth at the top level; pi-ai
  // createProvider() objects carry it under auth.oauth. Pi accepts both.
  const oauth = providerConfig?.oauth
    ?? (providerConfig?.auth as UnknownRecord | undefined)?.oauth
  return typeof oauth === 'object' && oauth !== null && typeof (oauth as UnknownRecord).login === 'function'
    ? oauth as UnknownRecord
    : undefined
}

// Pi accepts both oauth generations: pi-ai native flows carry toAuth and take
// the interaction surface directly; extension configs carry getApiKey and go
// through Pi's adaptOAuth (vendored). Same acceptance here.
function oauthAdapterOf(oauthConfig: UnknownRecord): {
  login(interaction: unknown): Promise<UnknownRecord>
  refresh(credential: unknown, signal?: AbortSignal): Promise<UnknownRecord>
  toAuth(credential: unknown): Promise<UnknownRecord>
} {
  if (typeof oauthConfig.toAuth === 'function') {
    return oauthConfig as never
  }
  return adaptOAuth(oauthConfig) as never
}

export function providerSupportsOAuth(providerConfig: UnknownRecord | undefined): boolean {
  return oauthConfigOf(providerConfig) !== undefined
}

// Pi models.login semantics: find the provider's oauth surface, run the
// package's own login through the vendored adapter, persist through the
// store's serialized modify.
export async function loginPiProvider(options: {
  providerId: string
  providerName?: string
  providerConfig: UnknownRecord
  store: FileCredentialStore
  ui: OAuthUiSurface
  signal?: AbortSignal
}): Promise<UnknownRecord> {
  const oauthConfig = oauthConfigOf(options.providerConfig)
  if (oauthConfig === undefined) {
    throw new Error(`${options.providerName ?? options.providerId} does not support oauth login`)
  }
  const adapter = oauthAdapterOf(oauthConfig)
  // The flow's own signal, so a question still on screen when the login ends
  // gets cancelled. The browser half of an OAuth login finishes at the local
  // callback, not at the paste box — leaving that box open after the flow has
  // resolved (or failed, as a region-blocked token exchange does) strands the
  // user in front of a dialog that can no longer do anything.
  const done = new AbortController()
  if (options.signal !== undefined) {
    if (options.signal.aborted) done.abort()
    else options.signal.addEventListener('abort', () => done.abort(), { once: true })
  }
  try {
    const credential = await adapter.login(oauthInteraction(options.ui, done.signal))
    await options.store.modify(options.providerId, async () => credential)
    return credential
  } finally {
    done.abort()
  }
}

// Pi's resolveProviderAuth over the stored credential: five-minute expiry
// window, double-checked-lock refresh through the package's own refreshToken,
// rotated credential persisted before release, key derived by the package's
// own getApiKey. Returns undefined when nothing is stored.
export async function resolveOAuthApiKey(options: {
  providerId: string
  providerName?: string
  providerConfig: UnknownRecord
  store: FileCredentialStore
  signal?: AbortSignal
}): Promise<string | undefined> {
  const oauthConfig = oauthConfigOf(options.providerConfig)
  if (oauthConfig === undefined) return undefined
  const provider = {
    id: options.providerId,
    name: options.providerName ?? options.providerId,
    auth: { oauth: oauthAdapterOf(oauthConfig) },
  }
  const resolved = await resolveProviderAuth(
    provider,
    options.store,
    { env: async () => undefined },
    options.signal !== undefined ? { signal: options.signal } : undefined,
  ) as { auth?: { apiKey?: string } } | undefined
  return resolved?.auth?.apiKey
}

export async function storedOAuthCredential(store: FileCredentialStore, providerId: string): Promise<UnknownRecord | undefined> {
  const stored = await store.read(providerId, undefined) as UnknownRecord | undefined
  return stored?.type === 'oauth' ? stored : undefined
}

// Pi's FULL getProviderAuth precedence over the vendored resolver — stored
// OAuth (double-checked-lock refresh), then stored api_key, then the
// provider's own auth.apiKey ambient resolution (its resolve() reads env vars
// and probes credential files through the auth context). The package's
// resolve code runs verbatim; the bridge supplies only the context.
export async function resolvePiProviderAuth(options: {
  providerId: string
  providerName?: string
  providerConfig: UnknownRecord
  store: FileCredentialStore
  signal?: AbortSignal
}): Promise<{ auth?: UnknownRecord, source?: string } | undefined> {
  const oauthConfig = oauthConfigOf(options.providerConfig)
  const declaredApiKey = (options.providerConfig.auth as UnknownRecord | undefined)?.apiKey
  if (oauthConfig === undefined && declaredApiKey === undefined) return undefined
  const auth: UnknownRecord = {}
  if (oauthConfig !== undefined) auth.oauth = oauthAdapterOf(oauthConfig)
  if (declaredApiKey !== undefined) auth.apiKey = declaredApiKey
  const provider = { id: options.providerId, name: options.providerName ?? options.providerId, auth }
  return await resolveProviderAuth(
    provider,
    options.store,
    {
      env: async (name: string) => process.env[name],
      fileExists: async (path: string) => existsSync(path),
    },
    options.signal !== undefined ? { signal: options.signal } : undefined,
  ) as { auth?: UnknownRecord, source?: string } | undefined
}
