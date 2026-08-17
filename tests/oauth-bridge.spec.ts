import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileCredentialStore,
  loginPiProvider,
  oauthInteraction,
  providerSupportsOAuth,
  resolveOAuthApiKey,
  resolvePiProviderAuth,
} from '../src/oauth-bridge.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempAuthPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi2dsh-oauth-'))
  cleanup.push(dir)
  return join(dir, 'auth.json')
}

function collectingUi(answers: Record<string, string> = {}) {
  const notices: string[] = []
  const prompts: string[] = []
  const details: string[] = []
  return {
    notices,
    prompts,
    details,
    ui: {
      async input(title: unknown, detail?: unknown) {
        prompts.push(String(title))
        details.push(detail === undefined ? '' : String(detail))
        return answers[String(title)] ?? 'typed-answer'
      },
      async select(title: unknown, options: unknown[]) {
        prompts.push(String(title))
        return String(options[0])
      },
      notify(message: unknown) {
        notices.push(String(message))
      },
    },
  }
}

describe('interactive OAuth host seam', () => {
  it('persists credentials atomically in Pi auth.json format with owner-only permissions', async () => {
    const path = await tempAuthPath()
    const store = new FileCredentialStore(path)
    await store.modify('kimi-coding', async () => ({ type: 'oauth', access: 'a1', refresh: 'r1', expires: Date.now() + 3_600_000 }))

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, { access: string }>
    expect(onDisk['kimi-coding']?.access).toBe('a1')
    expect(((await stat(path)).mode & 0o777)).toBe(0o600)

    // A fresh store instance reads the same file — Pi-format interop.
    const reopened = new FileCredentialStore(path)
    expect(((await reopened.read('kimi-coding', undefined)) as { refresh: string }).refresh).toBe('r1')

    await store.delete('kimi-coding', undefined)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({})
  })

  it('runs a package login end-to-end: callbacks reach DSH-mapped ui, credential lands in the store', async () => {
    const path = await tempAuthPath()
    const store = new FileCredentialStore(path)
    const { ui, notices, prompts, details } = collectingUi()
    const seenCallbacks: string[] = []

    const providerConfig = {
      baseUrl: 'https://api.example.test',
      oauth: {
        name: 'Example (OAuth)',
        async login(callbacks: {
          onAuth(info: { url: string }): void
          onDeviceCode(info: { userCode: string, verificationUri: string }): void
          onPrompt(prompt: { message: string }): Promise<string>
          onSelect(prompt: { message: string, options: Array<{ id: string, label: string }> }): Promise<string | undefined>
        }) {
          // The package's own protocol flow, driving every callback surface.
          callbacks.onAuth({ url: 'https://auth.example.test/authorize' })
          callbacks.onDeviceCode({ userCode: 'ABCD-1234', verificationUri: 'https://auth.example.test/device' })
          seenCallbacks.push(`prompt:${await callbacks.onPrompt({ message: 'Paste code' })}`)
          seenCallbacks.push(`select:${await callbacks.onSelect({ message: 'Pick account', options: [{ id: 'acct-1', label: 'Work' }] })}`)
          return { access: 'tok-access', refresh: 'tok-refresh', expires: Date.now() + 3_600_000 }
        },
        refreshToken: async (credential: unknown) => credential,
        getApiKey: (credential: { access: string }) => credential.access,
      },
    }

    expect(providerSupportsOAuth(providerConfig)).toBe(true)
    const credential = await loginPiProvider({
      providerId: 'example', providerConfig, store, ui,
    })
    expect(credential.type).toBe('oauth')
    expect(seenCallbacks).toEqual(['prompt:typed-answer', 'select:acct-1'])
    expect(notices.some(notice => notice.includes('https://auth.example.test/authorize'))).toBe(true)
    expect(notices.some(notice => notice.includes('ABCD-1234'))).toBe(true)
    // The first prompt now CARRIES the address the flow announced. It used to
    // be the bare question, and the announcement went out as a command notice —
    // which DSH delivers when the command ends, while this command is blocked
    // waiting for the user to act on it. The user saw only the redirect URI.
    // The question stays the question; the announced address rides in the
    // DETAIL slot. Prepending 400 characters of authorization URL to the title
    // buried the actual question under wrapped text.
    expect(prompts[0]).toBe('Paste code')
    expect(details[0]).toContain('ABCD-1234')
    expect(prompts[1]).toBe('Pick account')

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, { type: string, access: string }>
    expect(onDisk.example).toMatchObject({ type: 'oauth', access: 'tok-access' })
  })

  it('resolves a fresh key directly and refreshes an expiring token through the package, persisting the rotation', async () => {
    const path = await tempAuthPath()
    const store = new FileCredentialStore(path)
    let refreshes = 0
    const providerConfig = {
      baseUrl: 'https://api.example.test',
      oauth: {
        name: 'Example (OAuth)',
        login: async () => ({ access: 'never', refresh: 'never', expires: 0 }),
        refreshToken: async (credential: { refresh: string }) => {
          refreshes += 1
          return { access: `rotated-${credential.refresh}`, refresh: 'r2', expires: Date.now() + 3_600_000 }
        },
        getApiKey: (credential: { access: string }) => credential.access,
      },
    }

    // Fresh token: no refresh, key comes straight from the package's getApiKey.
    await store.modify('example', async () => ({ type: 'oauth', access: 'fresh', refresh: 'r1', expires: Date.now() + 3_600_000 }))
    expect(await resolveOAuthApiKey({ providerId: 'example', providerConfig, store })).toBe('fresh')
    expect(refreshes).toBe(0)

    // Expiring token (inside Pi's five-minute window): the vendored
    // double-checked-lock refresh runs the package's refreshToken once and
    // persists the rotated credential.
    await store.modify('example', async () => ({ type: 'oauth', access: 'stale', refresh: 'r1', expires: Date.now() + 60_000 }))
    expect(await resolveOAuthApiKey({ providerId: 'example', providerConfig, store })).toBe('rotated-r1')
    expect(refreshes).toBe(1)
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, { access: string, refresh: string }>
    expect(onDisk.example).toMatchObject({ access: 'rotated-r1', refresh: 'r2' })

    // No stored credential → undefined, never a fabricated key.
    await store.delete('example', undefined)
    expect(await resolveOAuthApiKey({ providerId: 'example', providerConfig, store })).toBeUndefined()
  })

  it('maps interaction events without leaking secrets into notifications', async () => {
    const { ui, notices } = collectingUi()
    const interaction = oauthInteraction(ui)
    interaction.notify({ type: 'progress', message: 'Waiting for authorization…' })
    interaction.notify({ type: 'device_code', userCode: 'WXYZ-7777', verificationUri: 'https://x.test/device' })
    expect(notices).toEqual(['Waiting for authorization…', 'Visit https://x.test/device and enter code WXYZ-7777'])
    expect(await interaction.prompt({ type: 'manual_code', message: 'Paste the authorization code' })).toBe('typed-answer')
  })

  it('resolves pi-ai provider objects through the FULL Pi auth chain, not OAuth only', async () => {
    const path = await tempAuthPath()
    const store = new FileCredentialStore(path)
    // A pi-ai createProvider()-shaped object: auth.apiKey owns ambient
    // resolution — its resolve() runs the PACKAGE's logic against the auth
    // context the host supplies (env access), exactly like pi-provider-litellm.
    const providerConfig = {
      id: 'gateway',
      name: 'Gateway (display name)',
      auth: {
        apiKey: {
          async resolve({ ctx, credential }: { ctx: { env(name: string): Promise<string | undefined> }, credential?: { key?: string } }) {
            if (credential?.key !== undefined) return { auth: { apiKey: credential.key }, source: 'stored credential' }
            const key = await ctx.env('PI2DSH_TEST_GATEWAY_KEY')
            return key === undefined || key === '' ? undefined : { auth: { apiKey: key }, source: 'env' }
          },
        },
      },
    }

    // Ambient env: the package's own resolve() sees process.env through the context.
    process.env.PI2DSH_TEST_GATEWAY_KEY = 'env-key-1'
    try {
      const viaEnv = await resolvePiProviderAuth({ providerId: 'gateway', providerConfig, store }) as { auth: { apiKey: string }, source: string }
      expect(viaEnv).toMatchObject({ auth: { apiKey: 'env-key-1' }, source: 'env' })
    } finally {
      delete process.env.PI2DSH_TEST_GATEWAY_KEY
    }

    // A stored api_key credential wins over ambient env — Pi's precedence.
    await store.modify('gateway', async () => ({ type: 'api_key', key: 'stored-key-9' }))
    const viaStore = await resolvePiProviderAuth({ providerId: 'gateway', providerConfig, store }) as { auth: { apiKey: string }, source: string }
    expect(viaStore).toMatchObject({ auth: { apiKey: 'stored-key-9' }, source: 'stored credential' })

    // Nothing stored, nothing ambient → undefined, never a fabricated key.
    await store.delete('gateway', undefined)
    expect(await resolvePiProviderAuth({ providerId: 'gateway', providerConfig, store })).toBeUndefined()

    // auth.oauth nested inside a pi-ai provider object is recognized too.
    expect(providerSupportsOAuth({ auth: { oauth: { login: () => ({}), getApiKey: () => 'k' } } })).toBe(true)
  })
})

describe('where the user is told to go', () => {
  /** Record what each surface was asked to show. */
  function surface() {
    const notices: string[] = []
    const prompts: string[] = []
    const details: string[] = []
    return {
      notices,
      prompts,
      details,
      ui: {
        notify: (message: unknown) => { notices.push(String(message)) },
        input: async (title: unknown, detail?: unknown) => { prompts.push(String(title)); details.push(detail === undefined ? '' : String(detail)); return 'the-code' },
        select: async (title: unknown, options: unknown[]) => { prompts.push(String(title)); return String(options[0]) },
      },
    }
  }

  it('carries the authorization URL into the next prompt', async () => {
    // The flow announces the URL and then blocks asking for the code. A notice
    // is delivered when the COMMAND ends, and the command cannot end until the
    // user has visited that URL — so the address arrived after it was needed
    // and the dialog showed only the redirect URI, which does nothing when
    // clicked. It has to be in the prompt the user is looking at.
    const seen = surface()
    const flow = oauthInteraction(seen.ui as never)
    flow.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize?x=1' } as never)
    const answer = await flow.prompt({ type: 'manual_code', message: 'Paste the code here:' } as never)

    expect(answer).toBe('the-code')
    expect(seen.prompts[0]).toBe('Paste the code here:')
    expect(seen.details[0]).toContain('https://auth.example.com/authorize?x=1')
  })

  it('gives the dialog something to click instead of a wall of URL', async () => {
    // The detail slot is rendered as markdown by the host (QuestionComposer →
    // MarkdownText), and its link renderer emits a real anchor with
    // target="_blank". So the address belongs in there as a LINK: one short
    // line the user clicks. Pasting the raw 400-character authorize URL made
    // the dialog a block of wrapped text with nothing clickable in it.
    const seen = surface()
    const long = 'https://auth.example.com/authorize?client_id=abc&scope=openid+profile+email&state=0123456789abcdef&code_challenge=Zm9vYmFyYmF6cXV4&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback'
    const flow = oauthInteraction(seen.ui as never, undefined, url => `http://127.0.0.1:5210/pi2dsh/authorize/${url.length.toString(36)}`)
    flow.notify({ type: 'auth_url', url: long, instructions: 'Then paste the code below.' } as never)
    // codex hands its prompt a placeholder too — the redirect URI. GFM
    // autolinks a bare URL, so keeping it here would draw a SECOND clickable
    // address under the real one that does nothing when clicked.
    await flow.prompt({ type: 'manual_code', message: 'Paste the code here:', placeholder: 'http://localhost:1455/auth/callback' } as never)

    // A markdown link whose label is words, not the address.
    expect(seen.details[0]).toMatch(/^\[Open the login page\]\(http:\/\/127\.0\.0\.1:5210\/pi2dsh\/authorize\/\w+\)/u)
    // And the wall is actually gone — not merely joined by a shorter twin.
    expect(seen.details[0]).not.toContain(long)
    expect(seen.details[0]).toContain('Then paste the code below.')
    expect(seen.details[0]).not.toContain('localhost:1455')
    // The notice is plain text (no markdown pass there), so it keeps the
    // address readable rather than showing bracket syntax.
    expect(seen.notices[0]).toContain('http://127.0.0.1:5210/pi2dsh/authorize/')
    expect(seen.notices[0]).not.toContain('](')
  })

  it('still hands over the real URL when there is nowhere to shorten it', async () => {
    // No web server in the composition (the CLI profile): the link is still a
    // link — the label is short even when the href is not.
    const seen = surface()
    const flow = oauthInteraction(seen.ui as never)
    flow.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize?x=1' } as never)
    await flow.prompt({ type: 'manual_code', message: 'Paste the code here:' } as never)

    expect(seen.details[0]).toBe('[Open the login page](https://auth.example.com/authorize?x=1)')
  })

  it('carries a device code the same way', async () => {
    const seen = surface()
    const flow = oauthInteraction(seen.ui as never)
    flow.notify({
      type: 'device_code',
      verificationUri: 'https://example.com/device',
      userCode: 'WXYZ-1234',
      expiresInSeconds: 900,
    } as never)
    await flow.prompt({ type: 'text', message: 'Waiting…' } as never)

    expect(seen.details[0]).toContain('https://example.com/device')
    expect(seen.details[0]).toContain('WXYZ-1234')
    // The code is on a clock; a user who does not know that walks away from it.
    expect(seen.details[0]).toContain('15 min')
  })

  it('carries it once, not onto every later prompt', async () => {
    const seen = surface()
    const flow = oauthInteraction(seen.ui as never)
    flow.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize' } as never)
    await flow.prompt({ type: 'manual_code', message: 'First:' } as never)
    await flow.prompt({ type: 'manual_code', message: 'Second:' } as never)

    expect(seen.prompts[1]).toBe('Second:')
    expect(seen.details[1]).toBe('')
  })
})

describe('the dialog after the login is over', () => {
  it('cancels a question still on screen when the flow ends', async () => {
    // The browser half of an OAuth login finishes at the local callback, not at
    // the paste box. A real attempt ended with the provider refusing the token
    // exchange (region-blocked) and left the "paste the authorization code"
    // dialog sitting there, unable to do anything.
    let seenSignal: AbortSignal | undefined
    const providerConfig = {
      name: 'Example',
      auth: {
        oauth: {
          async login(interaction: { signal: AbortSignal }) {
            seenSignal = interaction.signal
            throw new Error('token exchange failed (403)')
          },
        },
      },
    }
    const store = new (await import('../src/oauth-bridge.js')).FileCredentialStore(
      join(await mkdtemp(join(tmpdir(), 'pi2dsh-oauth-')), 'auth.json'),
    )
    await expect(loginPiProvider({
      providerId: 'example',
      providerConfig: providerConfig as never,
      store,
      ui: { input: async () => undefined, select: async () => undefined, notify: () => {} } as never,
    })).rejects.toThrow(/token exchange failed/u)

    expect(seenSignal?.aborted, 'the flow ended but its questions were never cancelled').toBe(true)
  })
})

describe('the race a login actually runs', () => {
  it('passes the prompt\'s own signal through, so the box closes when the callback wins', async () => {
    // pi-ai's codex flow opens the "paste the code" box and races it against a
    // local callback server, handing that box its OWN abort signal and firing
    // it when the browser callback wins. Dropping that signal is what left the
    // box on screen after the user had already finished logging in.
    let received: AbortSignal | undefined
    const ui = {
      input: async (_title: unknown, _detail: unknown, signal?: unknown) => {
        received = signal as AbortSignal | undefined
        return undefined
      },
      select: async () => undefined,
      notify: () => {},
    }
    const perPrompt = new AbortController()
    const flow = oauthInteraction(ui as never)
    await flow.prompt({
      type: 'manual_code',
      message: 'Paste the code',
      signal: perPrompt.signal,
    } as never)

    expect(received, 'the prompt signal never reached the question').toBe(perPrompt.signal)
  })
})
