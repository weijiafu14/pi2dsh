// Pi's standard custom-model registry: ~/.pi/agent/models.json (redirected under
// DSH's home by the vendored getAgentDir). The file is loaded and composed with
// vendored Pi sources — ModelConfig (schema + parse), applyModelsJson /
// applyModelOverride (config → Model projection) and resolve-config-value
// ($ENV interpolation, !command execution) — so user-defined providers appear
// in modelRegistry.find() and resolve credentials with Pi's exact semantics.
// This is the configuration channel pi-vision-tool and the wider custom-model
// plugin family document for their users.
import { join } from 'node:path'
import { getAgentDir } from './compat/vendor/pi-config-shim.js'
import { ModelConfig, type ModelsJsonProvider } from './compat/vendor/pi-model-config.js'
import { applyModelOverride, applyModelsJson } from './compat/vendor/pi-models-compose.js'
import {
  isCommandConfigValue,
  isConfigValueConfigured,
  getConfigValueEnvVarNames,
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} from './compat/vendor/pi-resolve-config-value.js'

type UnknownRecord = Record<string, unknown>

export interface ModelsJsonSnapshot {
  models: UnknownRecord[]
  providers: Map<string, ModelsJsonProvider>
  errors: string[]
}

export type ResolvedModelsJsonAuth =
  | { ok: true; apiKey?: string; headers?: Record<string, string> }
  | { ok: false; error: string }

export function modelsJsonPath(): string {
  return join(getAgentDir(), 'models.json')
}

const emptySnapshot = (): ModelsJsonSnapshot => ({ models: [], providers: new Map(), errors: [] })

/**
 * One load of models.json projected to Pi Model objects. Mirrors Pi's
 * composeModelProvider composition order: base (builtin) models →
 * applyModelsJson upserts → modelOverrides as the topmost user-config layer.
 * A provider that fails composition contributes an error and is skipped —
 * the same per-entry isolation the rest of the bridge applies to extensions.
 */
export async function loadModelsJsonSnapshot(
  baseProviderOf?: (providerId: string) => Promise<UnknownRecord | undefined>,
): Promise<ModelsJsonSnapshot> {
  const snapshot = emptySnapshot()
  const config = await ModelConfig.load(modelsJsonPath())
  const loadError = config.getError()
  if (loadError !== undefined) {
    snapshot.errors.push(loadError)
    return snapshot
  }
  for (const providerId of config.getProviderIds()) {
    const providerConfig = config.getProvider(providerId)
    if (providerConfig === undefined) continue
    try {
      const base = await baseProviderOf?.(providerId)
      const baseModels = typeof (base as { getModels?: unknown } | undefined)?.getModels === 'function'
        ? (base as { getModels(): UnknownRecord[] }).getModels()
        : []
      const composed = applyModelsJson(providerId, baseModels, providerConfig).map(model => {
        const override = providerConfig.modelOverrides?.[String((model as UnknownRecord).id)]
        return override ? applyModelOverride(model, override) : model
      })
      snapshot.models.push(...(composed as UnknownRecord[]))
      snapshot.providers.set(providerId, providerConfig)
    } catch (error) {
      snapshot.errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return snapshot
}

/**
 * Pi's configured-auth answer for a models.json provider, following
 * composeApiKeyAuth.resolve + withConfiguredAuth and the registry's
 * translation of their failures:
 * - a configured apiKey resolves through $ENV/!command or fails loudly with
 *   the resolver's message;
 * - authHeader folds the resolved key into an Authorization header and,
 *   without a key, becomes Pi's "No API key found" answer;
 * - a provider with neither key nor authHeader answers with its resolved
 *   headers only (the registry's compatibility path).
 */
export function resolveModelsJsonAuth(providerId: string, provider: ModelsJsonProvider): ResolvedModelsJsonAuth {
  try {
    const headers = resolveHeadersOrThrow(provider.headers, `provider "${providerId}"`)
    const rawKey = provider.apiKey
    if (rawKey === undefined) {
      if (provider.authHeader ?? false) return { ok: false, error: `No API key found for "${providerId}"` }
      return { ok: true, ...(headers === undefined ? {} : { headers }) }
    }
    const apiKey = resolveConfigValueOrThrow(rawKey, `API key for provider "${providerId}"`)
    const merged = (provider.authHeader ?? false)
      ? { ...headers, Authorization: `Bearer ${apiKey}` }
      : headers
    return { ok: true, apiKey, ...(merged === undefined ? {} : { headers: merged }) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Pi's withConfiguredAuth layered over an auth resolved by another family
 * (an extension-registered provider or a builtin): models.json headers
 * override the resolved ones, and authHeader folds the resolved key into
 * an Authorization header — failing loudly without one, as Pi does.
 */
export function applyModelsJsonConfiguredAuth(
  providerId: string,
  provider: ModelsJsonProvider,
  auth: { apiKey?: string; headers?: Record<string, string> },
): { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string } {
  try {
    const configured = resolveHeadersOrThrow(provider.headers, `provider "${providerId}"`)
    let headers = auth.headers || configured ? { ...auth.headers, ...configured } : undefined
    if (provider.authHeader ?? false) {
      if (auth.apiKey === undefined) return { ok: false, error: `No API key found for "${providerId}"` }
      headers = { ...headers, Authorization: `Bearer ${auth.apiKey}` }
    }
    return {
      ok: true,
      ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
      ...(headers === undefined ? {} : { headers }),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Pi's configured-check (not liveness) for a models.json provider — the
 * configuredRequestAuthStatus semantics: a literal or !command key counts as
 * configured, a templated key counts only when its env vars are present, and
 * a provider without an apiKey defers to the other credential families.
 */
export function modelsJsonAuthConfigured(provider: ModelsJsonProvider): boolean | undefined {
  const value = provider.apiKey
  if (value === undefined) return undefined
  if (isCommandConfigValue(value)) return true
  if (getConfigValueEnvVarNames(value).length > 0) return isConfigValueConfigured(value)
  return true
}
