/**
 * Vendored verbatim from `@earendil-works/pi-coding-agent@0.84.2`
 * (`dist/core/extensions/loader.js` `createExtensionRuntime`).
 *
 * A pure state-container factory with no host dependency. Action methods start
 * as `notInitialized` stubs that the host runner replaces on bind; the pre-bind
 * logic (stale guard, event-bus subscription tracking, queued provider
 * registrations) is real. Extensions such as pi-btw construct one when they
 * assemble a ResourceLoader-shaped `getExtensions()` result, so the symbol must
 * exist and behave exactly as Pi's — an absent export throws
 * "createExtensionRuntime is not a function" the moment such an extension runs.
 */

type Unsubscribe = () => void

interface RuntimeState {
  staleMessage?: string
}

/** The extension runtime Pi hands to loaded extensions in its pre-bind shape. */
export interface ExtensionRuntime {
  [key: string]: unknown
  flagValues: Map<string, boolean | string>
  pendingProviderRegistrations: Array<{ name: string, config: unknown, extensionPath: string }>
  pendingNativeProviderRegistrations: Array<{ provider: { id: string }, extensionPath: string }>
}

/**
 * Build a fresh pre-bind extension runtime. Registration methods
 * (`registerProvider`, `trackEventBusSubscription`) work immediately; action
 * methods (`sendMessage`, `getActiveTools`, …) throw until the host runner
 * binds real implementations.
 * @returns the runtime state container consumed by Pi's extension loader.
 */
export function createExtensionRuntime(): ExtensionRuntime {
  const notInitialized = (): never => {
    throw new Error('Extension runtime not initialized. Action methods cannot be called during extension loading.')
  }
  const state: RuntimeState = {}
  const eventBusUnsubscribers = new Set<Unsubscribe>()
  const assertActive = (): void => {
    if (state.staleMessage) {
      throw new Error(state.staleMessage)
    }
  }
  const runtime: ExtensionRuntime = {
    sendMessage: notInitialized,
    sendUserMessage: notInitialized,
    appendEntry: notInitialized,
    setSessionName: notInitialized,
    getSessionName: notInitialized,
    setLabel: notInitialized,
    getActiveTools: notInitialized,
    getAllTools: notInitialized,
    setActiveTools: notInitialized,
    // registerTool() is valid during extension load; refresh is only needed post-bind.
    refreshTools: () => {},
    getCommands: notInitialized,
    setModel: () => Promise.reject(new Error('Extension runtime not initialized')),
    getThinkingLevel: notInitialized,
    setThinkingLevel: notInitialized,
    flagValues: new Map<string, boolean | string>(),
    pendingProviderRegistrations: [],
    pendingNativeProviderRegistrations: [],
    assertActive,
    invalidate: (message?: string) => {
      if (state.staleMessage) return
      state.staleMessage = message
        ?? 'This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().'
      for (const unsubscribe of eventBusUnsubscribers) unsubscribe()
      eventBusUnsubscribers.clear()
    },
    trackEventBusSubscription: (unsubscribe: Unsubscribe): Unsubscribe => {
      let active = true
      const trackedUnsubscribe = (): void => {
        if (!active) return
        active = false
        eventBusUnsubscribers.delete(trackedUnsubscribe)
        unsubscribe()
      }
      eventBusUnsubscribers.add(trackedUnsubscribe)
      return trackedUnsubscribe
    },
    // Pre-bind: queue registrations so the host runner can flush them once the
    // model registry is available; a bound runner replaces both with direct calls.
    registerProvider: (name: string, config: unknown, extensionPath = '<unknown>') => {
      runtime.pendingProviderRegistrations.push({ name, config, extensionPath })
    },
    registerNativeProvider: (provider: { id: string }, extensionPath = '<unknown>') => {
      runtime.pendingNativeProviderRegistrations.push({ provider, extensionPath })
    },
    unregisterProvider: (name: string) => {
      runtime.pendingProviderRegistrations = runtime.pendingProviderRegistrations.filter(r => r.name !== name)
      runtime.pendingNativeProviderRegistrations = runtime.pendingNativeProviderRegistrations.filter(r => r.provider.id !== name)
    },
  }
  return runtime
}
