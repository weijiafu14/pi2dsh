import type { CompatibilityLevel } from './types.js'

interface Rule {
  level: CompatibilityLevel
  detail: string
}

const rule = (level: CompatibilityLevel, detail: string): Rule => ({ level, detail })

export const PI_CODING_AGENT_PACKAGES = Object.freeze([
  '@earendil-works/pi-coding-agent',
  '@mariozechner/pi-coding-agent',
] as const)

export const PI_TUI_PACKAGES = Object.freeze([
  '@earendil-works/pi-tui',
  '@mariozechner/pi-tui',
] as const)

export const PI_AI_PACKAGES = Object.freeze([
  '@earendil-works/pi-ai',
  '@mariozechner/pi-ai',
] as const)

export const HOST_IMPORT_RULES: Readonly<Record<string, Readonly<Record<string, Rule>>>> = Object.freeze({
  'pi-coding-agent': Object.freeze({
    defineTool: rule('full', 'The Pi defineTool helper is preserved as an identity helper.'),
    CONFIG_DIR_NAME: rule('partial', 'The conventional config directory name is preserved, while DSH owns the actual profile layout.'),
    DEFAULT_MAX_LINES: rule('full', 'The Pi default line limit is preserved.'),
    DEFAULT_MAX_BYTES: rule('full', 'The Pi default byte limit is preserved.'),
    getAgentDir: rule('partial', 'Redirected to an isolated DSH-owned pi2dsh directory instead of Pi global state.'),
    formatSize: rule('partial', 'Provided by a dependency-light formatting shim for headless output.'),
    truncateHead: rule('partial', 'Provided by a bounded head-truncation shim; detailed Pi presentation metadata may differ.'),
    getMarkdownTheme: rule('partial', 'Returns a plain-text headless theme; Pi terminal styling is intentionally discarded.'),
  }),
  'pi-tui': Object.freeze({
    Text: rule('partial', 'Provided as a plain-text headless component; terminal styling and input are unavailable.'),
    Spacer: rule('partial', 'Provided as a plain-text headless component.'),
    Container: rule('partial', 'Provided as a plain-text headless component; terminal rendering hooks are unavailable.'),
    Markdown: rule('partial', 'Provided as a plain-text headless component; terminal markdown styling is unavailable.'),
    Editor: rule('partial', 'Provided only for extension loading and plain text; interactive editing is unavailable.'),
    SelectList: rule('partial', 'Provided only for extension loading; interactive selection is unavailable.'),
    CURSOR_MARKER: rule('partial', 'Mapped to an empty marker because DSH owns cursor presentation.'),
    Key: rule('partial', 'Provides symbolic key names only; DSH does not expose Pi terminal input.'),
    matchesKey: rule('partial', 'Supports literal comparison only; Pi terminal key decoding is unavailable.'),
    decodeKittyPrintable: rule('partial', 'Passes text through because DSH does not expose the Kitty keyboard protocol.'),
    truncateToWidth: rule('partial', 'Provides Unicode code-point truncation without Pi ANSI/cell-width fidelity.'),
    wrapTextWithAnsi: rule('partial', 'Provides plain-text wrapping without Pi ANSI/cell-width fidelity.'),
    fuzzyFilter: rule('partial', 'Preserves the candidate list but does not emulate Pi TUI fuzzy ranking.'),
  }),
  'pi-ai': Object.freeze({
    StringEnum: rule('full', 'Preserves Pi flat string-enum JSON Schema generation without loading provider SDKs.'),
  }),
})

export const CONTEXT_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  cwd: rule('full', 'Mapped to the active DSH agent session working directory.'),
  signal: rule('full', 'Mapped to the active DSH cancellation signal when one is available.'),
  hasUI: rule('full', 'Reports false because the bridge targets DSH headless/Web surfaces rather than the Pi terminal UI.'),
  mode: rule('partial', 'Reports rpc mode so Pi extensions can choose their documented headless fallback.'),
  isIdle: rule('partial', 'Command contexts report idle; tool/lifecycle contexts conservatively report non-idle.'),
  isProjectTrusted: rule('partial', 'Fails closed as untrusted because DSH does not expose Pi project-trust state.'),
  hasPendingMessages: rule('partial', 'Conservatively reports no Pi-specific pending-message queue.'),
  getContextUsage: rule('partial', 'Returns no Pi token-usage projection.'),
  getSystemPrompt: rule('full', 'Returns the system prompt currently assembled by the bridge.'),
  getSystemPromptOptions: rule('partial', 'Returns an empty Pi option projection in command contexts.'),
  waitForIdle: rule('partial', 'Mapped to the DSH agent idle boundary when available.'),
  sessionManager: rule('partial', 'Exposes a read-only empty Pi session projection; DSH durable events remain authoritative.'),
  modelRegistry: rule('partial', 'Exposes no Pi provider registry because DSH owns model adapters.'),
  model: rule('partial', 'No Pi model object is projected from the DSH adapter.'),
  scopedModels: rule('partial', 'No Pi scoped-model list is projected from DSH configuration.'),
  thinkingLevel: rule('partial', 'No Pi thinking-level value is projected from DSH configuration.'),
  abort: rule('unsupported', 'Pi agent abort requires an explicit native DSH control integration.'),
  shutdown: rule('unsupported', 'A migrated package may not shut down the DSH host.'),
  compact: rule('unsupported', 'Pi compaction control requires a native DSH compaction plugin.'),
})

export const UI_CONTEXT_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  notify: rule('full', 'Captured as a command result when applicable and emitted through DSH logging.'),
  setStatus: rule('partial', 'Accepted as a no-op because DSH owns status presentation.'),
  setWidget: rule('partial', 'Accepted as a no-op because Pi terminal widgets cannot render in DSH.'),
  select: rule('partial', 'Unavailable in the bridge; extensions must follow their hasUI/rpc fallback or the call fails explicitly.'),
  confirm: rule('partial', 'Unavailable in the bridge; extensions must follow their hasUI/rpc fallback or the call fails explicitly.'),
  input: rule('partial', 'Unavailable in the bridge; extensions must follow their hasUI/rpc fallback or the call fails explicitly.'),
  custom: rule('partial', 'Pi custom TUI components cannot render; guarded rpc/headless fallbacks may still run.'),
  onTerminalInput: rule('partial', 'Raw terminal input is absent; feature-detected listeners remain disabled.'),
})

export const API_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  registerTool: {
    level: 'partial',
    detail: 'Registered as a native DSH tool. The enforced JSON Schema subset is preserved; unsupported constraints, binary image results, and Pi-only error details are explicitly degraded.',
  },
  registerCommand: {
    level: 'partial',
    detail: 'Registered in ctx.commands; ui.notify becomes the result, while interactive Pi TUI methods fail explicitly in headless DSH.',
  },
  registerShortcut: {
    level: 'unsupported',
    detail: 'Pi terminal keyboard shortcuts have no cross-surface DSH equivalent.',
  },
  registerFlag: {
    level: 'partial',
    detail: 'The declared default is available through getFlag; Pi process flags cannot be added to the DSH launcher.',
  },
  getFlag: {
    level: 'partial',
    detail: 'Returns the migrated flag default because DSH cannot register the original Pi CLI flag.',
  },
  registerProvider: {
    level: 'unsupported',
    detail: 'Provider and OAuth registration require a native DSH LLM adapter and credential integration.',
  },
  unregisterProvider: {
    level: 'unsupported',
    detail: 'Provider lifecycle is owned by native DSH LLM adapters.',
  },
  registerMessageRenderer: {
    level: 'unsupported',
    detail: 'Pi TUI renderers cannot run in DSH Web/headless surfaces.',
  },
  registerEntryRenderer: {
    level: 'unsupported',
    detail: 'Pi TUI entry renderers cannot run in DSH Web/headless surfaces.',
  },
  registerMarkdownTransformer: {
    level: 'unsupported',
    detail: 'Display-only Pi TUI markdown transforms have no model-neutral DSH equivalent.',
  },
  sendMessage: {
    level: 'unsupported',
    detail: 'Pi custom-message persistence and delivery modes do not match DSH durable message sources.',
  },
  sendUserMessage: {
    level: 'unsupported',
    detail: 'Programmatic steering must be ported explicitly to DSH agent APIs.',
  },
  appendEntry: {
    level: 'unsupported',
    detail: 'Custom Pi session entries require a native DSH session-event schema and projection.',
  },
  setSessionName: {
    level: 'unsupported',
    detail: 'Pi session display metadata has no verified DSH mutation seam.',
  },
  getSessionName: {
    level: 'unsupported',
    detail: 'Pi session display metadata has no verified DSH projection.',
  },
  setLabel: {
    level: 'unsupported',
    detail: 'Pi entry labels have no verified DSH session-event projection.',
  },
  exec: {
    level: 'unsupported',
    detail: 'Shell execution must be ported to an explicit DSH tool or sandbox capability; the bridge never spawns it implicitly.',
  },
  getActiveTools: {
    level: 'partial',
    detail: 'Returns tools registered by this migrated Pi package, not every tool visible in the DSH scope.',
  },
  getAllTools: {
    level: 'partial',
    detail: 'Returns metadata for tools registered by this migrated Pi package, without native DSH tools or Pi prompt guidelines.',
  },
  setActiveTools: {
    level: 'unsupported',
    detail: 'Dynamic Pi tool activation does not map to DSH scoped tool presentation without a native policy plugin.',
  },
  getCommands: {
    level: 'partial',
    detail: 'Returns commands registered by this migrated Pi package, not every command visible in the DSH scope.',
  },
  setModel: {
    level: 'unsupported',
    detail: 'Model selection is owned by DSH agent/session configuration.',
  },
  getThinkingLevel: {
    level: 'unsupported',
    detail: 'The bridge cannot project the active DSH model reasoning configuration into Pi thinking levels.',
  },
  setThinkingLevel: {
    level: 'unsupported',
    detail: 'Thinking selection is owned by DSH agent/session configuration.',
  },
  events: {
    level: 'full',
    detail: 'Package-local Pi extension event-bus emit/on semantics are preserved for migrated extensions in the same bundle.',
  },
})

export const EVENT_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  session_start: { level: 'full', detail: 'Mapped to agent/session-start.' },
  session_shutdown: { level: 'full', detail: 'Mapped to agent disposal and plugin teardown with duplicate suppression.' },
  session_info_changed: { level: 'unsupported', detail: 'Pi session display metadata changes have no verified DSH event equivalent.' },
  agent_start: { level: 'full', detail: 'Mapped to the DSH turn/start boundary.' },
  agent_settled: { level: 'full', detail: 'Mapped to the DSH turn/end boundary.' },
  turn_start: { level: 'full', detail: 'Mapped from durable turn/start events.' },
  tool_execution_start: { level: 'full', detail: 'Mapped from durable tool/call events.' },
  tool_execution_end: { level: 'full', detail: 'Mapped from finalized tools/result events.' },
  tool_call: {
    level: 'partial',
    detail: 'Blocking is supported. Argument mutation and Pi terminate-on-block are rejected rather than silently ignored.',
  },
  tool_result: {
    level: 'partial',
    detail: 'Text replacement and success-to-error blocking are supported; arbitrary details and error recovery are not.',
  },
  before_agent_start: {
    level: 'partial',
    detail: 'System-prompt replacement is supported; Pi raw prompt and custom-message injection are unavailable at DSH assembly time.',
  },
  agent_end: {
    level: 'partial',
    detail: 'The lifecycle boundary is mapped, but the reconstructed Pi message history is intentionally minimal.',
  },
  turn_end: {
    level: 'partial',
    detail: 'The lifecycle boundary and tool results are mapped; the exact Pi final-message shape is not guaranteed.',
  },
  message_start: {
    level: 'partial',
    detail: 'Durable user, assistant, and tool-result messages are mapped without Pi-specific provider metadata.',
  },
  message_end: {
    level: 'partial',
    detail: 'Durable messages are observed, but message replacement is not supported.',
  },
  message_update: {
    level: 'unsupported',
    detail: 'DSH stream chunks do not expose Pi accumulated AgentMessage state.',
  },
  tool_execution_update: {
    level: 'unsupported',
    detail: 'DSH native tools do not expose Pi partial tool-result callbacks.',
  },
  context: {
    level: 'unsupported',
    detail: 'Pi context-list replacement conflicts with DSH append-only request reconstruction.',
  },
  before_provider_request: {
    level: 'unsupported',
    detail: 'Provider payload mutation belongs in a native DSH LLM adapter.',
  },
  before_provider_headers: {
    level: 'unsupported',
    detail: 'Provider header mutation belongs in a native DSH LLM adapter.',
  },
  after_provider_response: {
    level: 'unsupported',
    detail: 'Provider response interception belongs in a native DSH LLM adapter.',
  },
  model_select: { level: 'unsupported', detail: 'No stable cross-harness model-selection event contract exists.' },
  thinking_level_select: { level: 'unsupported', detail: 'No stable cross-harness thinking-selection event contract exists.' },
  user_bash: { level: 'unsupported', detail: 'Pi ! command interception is terminal-surface-specific.' },
  input: { level: 'unsupported', detail: 'Raw Pi terminal input interception is surface-specific.' },
  project_trust: { level: 'unsupported', detail: 'Project trust must remain owned by the DSH host.' },
  resources_discover: { level: 'unsupported', detail: 'Dynamic resource discovery must be converted into DSH providers.' },
  session_before_switch: { level: 'unsupported', detail: 'Pi session switching has no direct DSH event equivalent.' },
  session_before_fork: { level: 'unsupported', detail: 'Pi tree forking has no direct DSH event equivalent.' },
  session_before_compact: { level: 'unsupported', detail: 'Compaction customization requires a native DSH compaction plugin.' },
  session_compact: { level: 'unsupported', detail: 'Compaction observation requires a native DSH compaction plugin.' },
  session_before_tree: { level: 'unsupported', detail: 'Pi session-tree navigation has no direct DSH event equivalent.' },
  session_tree: { level: 'unsupported', detail: 'Pi session-tree navigation has no direct DSH event equivalent.' },
})

export function ruleForApi(method: string): Rule | undefined {
  return API_RULES[method]
}

export function ruleForEvent(event: string): Rule {
  return EVENT_RULES[event] ?? {
    level: 'unsupported',
    detail: `Unknown Pi event ${JSON.stringify(event)} has no verified DSH mapping.`,
  }
}

export function ruleForHostImport(packageName: string, importedName: string): Rule | undefined {
  const family = (PI_CODING_AGENT_PACKAGES as readonly string[]).includes(packageName)
    ? 'pi-coding-agent'
    : (PI_TUI_PACKAGES as readonly string[]).includes(packageName)
      ? 'pi-tui'
      : (PI_AI_PACKAGES as readonly string[]).includes(packageName) ? 'pi-ai' : undefined
  return family === undefined ? undefined : HOST_IMPORT_RULES[family]?.[importedName]
}

export function ruleForContextProperty(property: string): Rule | undefined {
  return CONTEXT_RULES[property]
}

export function ruleForUiContextProperty(property: string): Rule | undefined {
  return UI_CONTEXT_RULES[property]
}
