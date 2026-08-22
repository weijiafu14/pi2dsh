import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, type CredentialInfo, type CredentialKey, type CredentialRecord, type CredentialRecordEntry, type CredentialRecordInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { FileCredentialStore, oauthCredentialRef, providerIdOfOAuthRef, providerSupportsOAuth, resolveOAuthApiKey, storedOAuthCredential } from './oauth-bridge.js'
import { builtinProviders } from './compat/pi-ai.js'
import { getAgentDir } from './compat/pi-coding-agent.js'

type UnknownRecord = Record<string, unknown>

// L4 of the OAuth host seam: a standard dsh-credentials provider that serves
// Pi OAuth tokens to DSH's native LLM request path. A route configured as
// `apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX` resolves per request through this
// provider — Pi's double-checked-lock refresh runs on every resolution, so a
// rotated token reaches the next model call with no restart, exactly the
// per-operation semantics the credentials seam demands. Every other reference
// falls through to the process environment, so one provider instance serves a
// whole composition.
//
// Reference convention: PI2DSH_OAUTH_<PROVIDER_ID> where the provider id is
// upper-cased with `-` as `_` (openai-codex → PI2DSH_OAUTH_OPENAI_CODEX).
// The helpers live in oauth-bridge (see the note there); re-exported here so
// this module's public surface is unchanged.

export { oauthCredentialRef } from './oauth-bridge.js'
const providerIdOfRef = providerIdOfOAuthRef

export interface PiOAuthCredentialProviderOptions {
  /** Path to the Pi-format auth.json; defaults to `$agentDir/auth.json`. */
  authPath?: string
  /** Additional provider configs (id → config with an oauth block), e.g. from packages that registered providers. */
  providers?: ReadonlyMap<string, UnknownRecord>
}

export class PiOAuthCredentialProvider extends CredentialProvider {
  private readonly oauthStore: FileCredentialStore
  private readonly extraProviders: ReadonlyMap<string, UnknownRecord>

  constructor(ctx: Context, options: PiOAuthCredentialProviderOptions = {}) {
    super(ctx)
    this.oauthStore = new FileCredentialStore(options.authPath ?? join(getAgentDir(), 'auth.json'))
    this.extraProviders = options.providers ?? new Map()
  }

  private oauthConfigFor(providerId: string): UnknownRecord | undefined {
    const registered = this.extraProviders.get(providerId)
    if (providerSupportsOAuth(registered)) return registered
    const builtin = builtinProviders().find(provider => provider.id === providerId)
    if (builtin === undefined) return undefined
    return { name: builtin.name, baseUrl: builtin.baseUrl, oauth: builtin.auth.oauth }
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const providerId = providerIdOfRef(String(ref))
    if (providerId === undefined) {
      const value = process.env[String(ref)]
      return value !== undefined && value.length > 0 ? { value, source: 'env' } : undefined
    }
    const config = this.oauthConfigFor(providerId)
    if (config === undefined) return undefined
    const value = await resolveOAuthApiKey({
      providerId,
      providerName: typeof config.name === 'string' ? config.name : providerId,
      providerConfig: config,
      store: this.oauthStore,
    })
    return value !== undefined && value.length > 0 ? { value, source: 'pi-oauth' } : undefined
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const providerId = providerIdOfRef(String(ref))
    if (providerId === undefined) {
      const value = process.env[String(ref)]
      return { configured: value !== undefined && value.length > 0, ...(value ? { source: 'env' } : {}), writable: false }
    }
    const stored = await storedOAuthCredential(this.oauthStore, providerId)
    return { configured: stored !== undefined, ...(stored !== undefined ? { source: 'pi-oauth' } : {}), writable: false }
  }

  async set(ref: CredentialRef, _value: string): Promise<void> {
    throw new Error(`credential ${String(ref)} is read-only here: OAuth tokens are managed by /login, environment values by the shell`)
  }

  async unset(ref: CredentialRef): Promise<void> {
    const providerId = providerIdOfRef(String(ref))
    if (providerId === undefined) {
      throw new Error(`credential ${String(ref)} is read-only here: environment values are managed by the shell`)
    }
    // Logging out is a legitimate unset: drop the stored token.
    await this.oauthStore.delete(providerId, undefined)
  }

  // ---- credential records (0.1.1-line abstract members) --------------------
  // The record space projects the SAME Pi-format store: a `pi2dsh/<provider>`
  // key answers for that provider's stored OAuth login. Grant payloads never
  // carry the token itself — resolution stays per-request through resolve().
  // On the rc.8 line the base class has no record members and these concrete
  // methods are simply extra.

  private recordProviderId(key: unknown): string | undefined {
    const value = String(key)
    return value.startsWith('pi2dsh/') ? value.slice('pi2dsh/'.length) : undefined
  }

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    const providerId = this.recordProviderId(key)
    if (providerId === undefined) return undefined
    const stored = await storedOAuthCredential(this.oauthStore, providerId)
    if (stored === undefined) return undefined
    return { kind: 'grant', payload: { provider: providerId, managedBy: 'pi2dsh' } }
  }

  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = await this.readRecord(key)
    return { configured: record !== undefined, ...(record === undefined ? {} : { kind: 'grant' as const }), writable: true }
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    const entries: CredentialRecordEntry[] = []
    const seen = new Set<string>()
    const ids = [...this.extraProviders.keys(), ...builtinProviders().map(provider => provider.id)]
    for (const providerId of ids) {
      if (seen.has(providerId)) continue
      seen.add(providerId)
      if (await storedOAuthCredential(this.oauthStore, providerId) !== undefined) {
        entries.push({ key: `pi2dsh/${providerId}` as CredentialKey, kind: 'grant' })
      }
    }
    return entries
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const providerId = this.recordProviderId(key)
    if (providerId === undefined) throw new Error(`credential record ${String(key)} is not managed by this provider`)
    const next = await mutate(await this.readRecord(key))
    if (next === undefined) {
      await this.oauthStore.delete(providerId, undefined)
    }
    // A written grant is a registration witness; the token itself is managed
    // by the login flow through the Pi store, so there is nothing to persist
    // beyond what the flow already committed.
    ;(this as unknown as { notifyRecordUpdated?(key: unknown): void }).notifyRecordUpdated?.(key)
    return next
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    const providerId = this.recordProviderId(key)
    if (providerId === undefined) return
    await this.oauthStore.delete(providerId, undefined)
    ;(this as unknown as { notifyRecordUpdated?(key: unknown): void }).notifyRecordUpdated?.(key)
  }
}

export const name = 'pi2dsh-credentials-oauth'

export function apply(ctx: Context, config: PiOAuthCredentialProviderOptions = {}): void {
  // The Service constructor registers itself as ctx.credentials.
  void new PiOAuthCredentialProvider(ctx, config)
}
