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
  return {
    notices,
    prompts,
    ui: {
      async input(title: unknown) {
        prompts.push(String(title))
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
    const { ui, notices, prompts } = collectingUi()
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
    expect(prompts[0]).toContain('Paste code')
    expect(prompts[0]).toContain('ABCD-1234')
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
    return {
      notices,
      prompts,
      ui: {
        notify: (message: unknown) => { notices.push(String(message)) },
        input: async (title: unknown) => { prompts.push(String(title)); return 'the-code' },
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
    expect(seen.prompts[0]).toContain('https://auth.example.com/authorize?x=1')
    expect(seen.prompts[0]).toContain('Paste the code here:')
  })

  it('carries a device code the same way', async () => {
    const seen = surface()
    const flow = oauthInteraction(seen.ui as never)
    flow.notify({ type: 'device_code', verificationUri: 'https://example.com/device', userCode: 'WXYZ-1234' } as never)
    await flow.prompt({ type: 'text', message: 'Waiting…' } as never)

    expect(seen.prompts[0]).toContain('https://example.com/device')
    expect(seen.prompts[0]).toContain('WXYZ-1234')
  })

  it('carries it once, not onto every later prompt', async () => {
    const seen = surface()
    const flow = oauthInteraction(seen.ui as never)
    flow.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize' } as never)
    await flow.prompt({ type: 'manual_code', message: 'First:' } as never)
    await flow.prompt({ type: 'manual_code', message: 'Second:' } as never)

    expect(seen.prompts[1]).toBe('Second:')
  })
})
