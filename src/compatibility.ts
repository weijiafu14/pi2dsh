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

const VENDORED = 'Vendored byte-identical from Pi, so semantics match Pi exactly.'
const HEADLESS_COMPONENT = 'Constructible headless component with Pi-exact signatures; renders plain text, never a terminal.'
const RUNTIME_STUB = 'Importable, but calling it fails explicitly: it belongs to Pi\'s internal agent runtime and needs a native DSH port.'
const VENDORED_TOOL = 'Pi\'s built-in tool constructor, vendored byte-identical with its pure-logic closure.'
const EVENT_GUARD = 'Pi\'s exact one-line tool-event guard, reimplemented verbatim.'

export const HOST_IMPORT_RULES: Readonly<Record<string, Readonly<Record<string, Rule>>>> = Object.freeze({
  'pi-coding-agent': Object.freeze({
    defineTool: rule('full', 'Identity helper, preserved.'),
    CONFIG_DIR_NAME: rule('partial', 'The conventional config directory name is preserved, while DSH owns the actual profile layout.'),
    DEFAULT_MAX_LINES: rule('full', VENDORED),
    DEFAULT_MAX_BYTES: rule('full', VENDORED),
    VERSION: rule('partial', 'Reports a pi2dsh compatibility marker instead of a Pi release version.'),
    CURRENT_SESSION_VERSION: rule('full', VENDORED),
    getAgentDir: rule('partial', 'Redirected to an isolated DSH-owned pi2dsh directory instead of Pi global state.'),
    getPackageDir: rule('partial', 'Resolves inside the DSH-owned pi2dsh agent directory.'),
    formatSize: rule('full', VENDORED),
    truncateHead: rule('full', VENDORED),
    truncateTail: rule('full', VENDORED),
    truncateLine: rule('full', VENDORED),
    withFileMutationQueue: rule('full', VENDORED),
    SessionManager: rule('full', `${VENDORED} Sessions live under the DSH-owned pi2dsh agent directory.`),
    parseSessionEntries: rule('full', VENDORED),
    migrateSessionEntries: rule('full', VENDORED),
    getLatestCompactionEntry: rule('full', VENDORED),
    sessionEntryToContextMessages: rule('full', VENDORED),
    buildContextEntries: rule('full', VENDORED),
    buildSessionContext: rule('full', VENDORED),
    loadEntriesFromFile: rule('full', VENDORED),
    findMostRecentSession: rule('full', VENDORED),
    getDefaultSessionDir: rule('full', VENDORED),
    assertValidSessionId: rule('full', VENDORED),
    convertToLlm: rule('full', VENDORED),
    createCustomMessage: rule('full', VENDORED),
    createBranchSummaryMessage: rule('full', VENDORED),
    createCompactionSummaryMessage: rule('full', VENDORED),
    bashExecutionToText: rule('full', VENDORED),
    estimateTokens: rule('full', 'Reimplements Pi\'s chars/4 heuristic over the same message roles.'),
    calculateContextTokens: rule('full', 'Sums the Pi chars/4 heuristic across messages.'),
    DEFAULT_COMPACTION_SETTINGS: rule('full', 'Pi\'s default compaction thresholds, preserved as constants.'),
    serializeConversation: rule('partial', 'JSON serialization without Pi\'s prompt-oriented formatting.'),
    shouldCompact: rule('partial', 'Always reports false: DSH owns compaction scheduling.'),
    compact: rule('unsupported', 'Pi compaction execution belongs to DSH\'s native compaction plugin; calling fails explicitly.'),
    findCutPoint: rule('unsupported', RUNTIME_STUB),
    generateSummary: rule('unsupported', RUNTIME_STUB),
    generateSummaryWithUsage: rule('unsupported', RUNTIME_STUB),
    generateBranchSummary: rule('unsupported', RUNTIME_STUB),
    parseFrontmatter: rule('full', 'Frontmatter parsing with Pi-compatible semantics.'),
    stripFrontmatter: rule('full', 'Frontmatter stripping with Pi-compatible semantics.'),
    copyToClipboard: rule('partial', 'Attempts the platform clipboard command (pbcopy/clip/wl-copy/xclip); resolves false when none succeeds.'),
    resizeImage: rule('partial', 'Passes images through un-resized; Pi resizes only to save tokens, so content is preserved.'),
    convertToPng: rule('partial', 'PNG input passes through; other formats fail explicitly without Pi\'s wasm codec.'),
    getShellConfig: rule('partial', 'Standard shell detection without Pi\'s managed-bin PATH handling.'),
    getBinDir: rule('partial', 'Reports the first PATH segment instead of Pi\'s managed bin directory.'),
    Theme: rule('partial', 'Headless theme: styling calls return their input text unstyled.'),
    theme: rule('partial', 'A headless theme singleton; jiti-loaded Pi extensions must not rely on Pi global theme state anyway.'),
    initTheme: rule('partial', 'Accepted as a no-op; DSH surfaces own presentation.'),
    getSettingsListTheme: rule('partial', 'Returns an unstyled theme with Pi\'s exact field shape.'),
    getSelectListTheme: rule('partial', 'Returns an unstyled theme with Pi\'s exact field shape.'),
    getMarkdownTheme: rule('partial', 'Returns a plain-text headless theme; Pi terminal styling is intentionally discarded.'),
    getLanguageFromPath: rule('partial', 'Extension-based language detection covering common languages.'),
    highlightCode: rule('partial', 'Splits lines without terminal syntax colors.'),
    DynamicBorder: rule('full', 'Headless implementation of Pi\'s one-line border component; pass an explicit color function as Pi itself recommends.'),
    SettingsManager: rule('partial', 'In-memory settings with Pi\'s getter/setter surface; DSH owns real persisted configuration.'),
    InMemorySettingsStorage: rule('partial', 'In-memory storage stub honoring the withLock contract.'),
    FileSettingsStorage: rule('partial', 'Alias of the in-memory storage; DSH owns persisted settings.'),
    ModelRegistry: rule('partial', 'A local registry container; DSH llm adapters own real model routing.'),
    createEventBus: rule('full', 'Pi event-bus semantics: async handler isolation and unsubscribe functions.'),
    readStoredCredential: rule('partial', 'Reads Pi-style auth.json from the pi2dsh-owned agent directory; DSH credentials stay authoritative for DSH model calls.'),
    parseSkillBlock: rule('full', 'Pi\'s skill_content block parser, reimplemented over the same wire shape.'),
    wrapRegisteredTool: rule('unsupported', RUNTIME_STUB),
    ProjectTrustStore: rule('unsupported', RUNTIME_STUB),
    DefaultResourceLoader: rule('partial', 'A headless resource loader honoring overrides, with empty discovery sets.'),
    DefaultPackageManager: rule('unsupported', RUNTIME_STUB),
    ModelRuntime: rule('unsupported', RUNTIME_STUB),
    createAgentSession: rule('partial', 'Bridged to a genuine DSH child agent through ctx.agents (a Pi model on the options routes the child); compositions without a loop factory fail explicitly.'),
    createCodingTools: rule('full', 'Pi\'s exact tool set composed from the vendored built-in constructors.'),
    createReadOnlyTools: rule('full', 'Pi\'s exact read-only tool set composed from the vendored built-in constructors.'),
    createBashTool: rule('full', VENDORED_TOOL),
    createReadTool: rule('full', VENDORED_TOOL),
    createEditTool: rule('full', VENDORED_TOOL),
    createWriteTool: rule('full', VENDORED_TOOL),
    createGrepTool: rule('full', VENDORED_TOOL),
    createFindTool: rule('full', VENDORED_TOOL),
    createLsTool: rule('full', VENDORED_TOOL),
    createBashToolDefinition: rule('full', VENDORED_TOOL),
    createReadToolDefinition: rule('full', VENDORED_TOOL),
    createEditToolDefinition: rule('full', VENDORED_TOOL),
    createWriteToolDefinition: rule('full', VENDORED_TOOL),
    createGrepToolDefinition: rule('full', VENDORED_TOOL),
    createFindToolDefinition: rule('full', VENDORED_TOOL),
    createLsToolDefinition: rule('full', VENDORED_TOOL),
    isToolCallEventType: rule('full', EVENT_GUARD),
    isBashToolResult: rule('full', EVENT_GUARD),
    isReadToolResult: rule('full', EVENT_GUARD),
    isEditToolResult: rule('full', EVENT_GUARD),
    isWriteToolResult: rule('full', EVENT_GUARD),
    isGrepToolResult: rule('full', EVENT_GUARD),
    isFindToolResult: rule('full', EVENT_GUARD),
    isLsToolResult: rule('full', EVENT_GUARD),
    loadSkills: rule('unsupported', RUNTIME_STUB),
    loadSkillsFromDir: rule('unsupported', RUNTIME_STUB),
    formatSkillsForPrompt: rule('full', 'Pi\'s skill prompt formatter, vendored with logic unchanged.'),
    CustomEditor: rule('partial', HEADLESS_COMPONENT),
    ToolExecutionComponent: rule('partial', HEADLESS_COMPONENT),
    FooterComponent: rule('partial', HEADLESS_COMPONENT),
    BorderedLoader: rule('partial', HEADLESS_COMPONENT),
    CustomMessageComponent: rule('partial', HEADLESS_COMPONENT),
    AssistantMessageComponent: rule('partial', HEADLESS_COMPONENT),
    UserMessageComponent: rule('partial', HEADLESS_COMPONENT),
    ExtensionSelectorComponent: rule('partial', HEADLESS_COMPONENT),
    ExtensionInputComponent: rule('partial', HEADLESS_COMPONENT),
    ExtensionEditorComponent: rule('partial', HEADLESS_COMPONENT),
    SettingsSelectorComponent: rule('partial', HEADLESS_COMPONENT),
    renderDiff: rule('partial', 'Plain unified-style diff lines without terminal colors.'),
    truncateToVisualLines: rule('partial', 'Visual-line truncation backed by Pi\'s vendored width math.'),
    keyHint: rule('partial', 'Plain-text key hint without theme styling.'),
    keyText: rule('partial', 'Plain-text key name without theme styling.'),
    rawKeyHint: rule('partial', 'Plain-text key hint without theme styling.'),
  }),
  'pi-tui': Object.freeze({
    visibleWidth: rule('full', VENDORED),
    truncateToWidth: rule('full', VENDORED),
    wrapTextWithAnsi: rule('full', VENDORED),
    sliceByColumn: rule('full', VENDORED),
    sliceWithWidth: rule('full', VENDORED),
    stripTerminalSequences: rule('full', VENDORED),
    getOsc8LinkAtColumn: rule('full', VENDORED),
    normalizeTerminalOutput: rule('full', VENDORED),
    extractAnsiCode: rule('full', VENDORED),
    getGraphemeCellRange: rule('full', VENDORED),
    getGraphemeSegmenter: rule('full', VENDORED),
    getWordSegmenter: rule('full', VENDORED),
    applyBackgroundToLine: rule('full', VENDORED),
    isWhitespaceChar: rule('full', VENDORED),
    isPunctuationChar: rule('full', VENDORED),
    cjkBreakRegex: rule('full', VENDORED),
    PUNCTUATION_REGEX: rule('full', VENDORED),
    fuzzyMatch: rule('full', VENDORED),
    fuzzyFilter: rule('full', VENDORED),
    parseKey: rule('full', VENDORED),
    matchesKey: rule('full', VENDORED),
    isKeyRelease: rule('full', VENDORED),
    isKeyRepeat: rule('full', VENDORED),
    decodeKittyPrintable: rule('full', VENDORED),
    isKittyProtocolActive: rule('full', VENDORED),
    setKittyProtocolActive: rule('full', VENDORED),
    Key: rule('full', VENDORED),
    getKeybindings: rule('full', `${VENDORED} Bindings only match when a surface feeds terminal input, which DSH does not.`),
    setKeybindings: rule('full', VENDORED),
    KeybindingsManager: rule('full', VENDORED),
    TUI_KEYBINDINGS: rule('full', VENDORED),
    parseOsc11BackgroundColor: rule('full', VENDORED),
    parseTerminalColorSchemeReport: rule('full', VENDORED),
    renderLatex: rule('full', VENDORED),
    getPngDimensions: rule('full', VENDORED),
    getJpegDimensions: rule('full', VENDORED),
    getGifDimensions: rule('full', VENDORED),
    getWebpDimensions: rule('full', VENDORED),
    getImageDimensions: rule('full', VENDORED),
    calculateImageRows: rule('full', VENDORED),
    allocateImageId: rule('full', VENDORED),
    encodeKitty: rule('partial', `${VENDORED} No DSH surface consumes the escape sequences.`),
    encodeITerm2: rule('partial', `${VENDORED} No DSH surface consumes the escape sequences.`),
    deleteKittyImage: rule('partial', `${VENDORED} No DSH surface consumes the escape sequences.`),
    deleteAllKittyImages: rule('partial', `${VENDORED} No DSH surface consumes the escape sequences.`),
    detectCapabilities: rule('partial', `${VENDORED} Headless environments report no image protocol.`),
    getCapabilities: rule('partial', VENDORED),
    setCapabilities: rule('partial', VENDORED),
    resetCapabilitiesCache: rule('partial', VENDORED),
    getCellDimensions: rule('partial', VENDORED),
    setCellDimensions: rule('partial', VENDORED),
    hyperlink: rule('full', VENDORED),
    imageFallback: rule('full', VENDORED),
    CombinedAutocompleteProvider: rule('partial', `${VENDORED} Suggestions surface only if a DSH UI asks for them.`),
    Marked: rule('full', 'Re-exported from the same marked dependency Pi uses.'),
    CURSOR_MARKER: rule('full', 'Pi\'s exact APC marker; vendored width math treats it as zero-width.'),
    Text: rule('partial', HEADLESS_COMPONENT),
    Spacer: rule('partial', HEADLESS_COMPONENT),
    Container: rule('partial', HEADLESS_COMPONENT),
    Box: rule('partial', HEADLESS_COMPONENT),
    Markdown: rule('partial', HEADLESS_COMPONENT),
    TruncatedText: rule('partial', HEADLESS_COMPONENT),
    Editor: rule('partial', `${HEADLESS_COMPONENT} Text editing state works; interactive keyboard flows do not.`),
    Input: rule('partial', `${HEADLESS_COMPONENT} Value state and submit/escape callbacks work; kill-ring editing does not.`),
    SelectList: rule('partial', `${HEADLESS_COMPONENT} Filtering and selection state work; keyboard interaction does not.`),
    SettingsList: rule('partial', `${HEADLESS_COMPONENT} Value updates work; keyboard interaction does not.`),
    ScrollView: rule('partial', HEADLESS_COMPONENT),
    VStack: rule('partial', HEADLESS_COMPONENT),
    HStack: rule('partial', HEADLESS_COMPONENT),
    Loader: rule('partial', HEADLESS_COMPONENT),
    CancellableLoader: rule('partial', HEADLESS_COMPONENT),
    Image: rule('partial', `${HEADLESS_COMPONENT} Renders a text placeholder; image bytes flow through DSH attachments instead.`),
    isFocusable: rule('full', 'Structural check preserved.'),
    isViewportTUI: rule('partial', 'Always false: no viewport TUI exists in DSH surfaces.'),
  }),
  'pi-ai': Object.freeze({
    StringEnum: rule('full', 'Preserves Pi flat string-enum JSON Schema generation without loading provider SDKs.'),
    registerProvider: rule('partial', 'Recorded in a bridge-local registry; DSH llm adapters own real routing.'),
    getProviders: rule('partial', 'Returns the bridge-local registry contents.'),
    getProvider: rule('partial', 'Reads the bridge-local registry.'),
    getModel: rule('partial', 'Resolves no Pi model objects; DSH owns model routing.'),
    getModels: rule('partial', 'Returns an empty list; DSH owns model routing.'),
    complete: rule('unsupported', 'Pi provider SDK calls have no DSH mapping; calling fails explicitly.'),
    stream: rule('unsupported', 'Pi provider SDK calls have no DSH mapping; calling fails explicitly.'),
    Type: rule('full', 'Re-exported from the same typebox dependency Pi resolves for extensions.'),
    uuidv7: rule('full', VENDORED),
    isContextOverflow: rule('full', VENDORED),
    isRecoverableLength: rule('full', VENDORED),
    isRetryableAssistantError: rule('full', VENDORED),
    contentText: rule('full', 'Pi\'s text-block joiner, reimplemented with identical semantics.'),
    clampThinkingLevel: rule('full', 'Pi\'s clamping walk over the extended thinking-level ladder.'),
    getSupportedThinkingLevels: rule('full', 'Pi\'s thinkingLevelMap filter, preserved.'),
    modelsAreEqual: rule('full', 'Id+provider equality, preserved.'),
  }),
})

export const CONTEXT_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  cwd: rule('full', 'Mapped to the active DSH agent session working directory.'),
  signal: rule('full', 'Mapped to the active DSH cancellation signal when one is available.'),
  hasUI: rule('full', 'Reports whether the native DSH userQuestions service is available to back Pi dialogs.'),
  mode: rule('partial', 'Reports rpc mode so Pi extensions can choose their documented headless fallback.'),
  isIdle: rule('partial', 'Command contexts report idle; tool/lifecycle contexts conservatively report non-idle.'),
  isProjectTrusted: rule('partial', 'Fails closed as untrusted because DSH does not expose Pi project-trust state.'),
  hasPendingMessages: rule('partial', 'Conservatively reports no Pi-specific pending-message queue.'),
  getContextUsage: rule('partial', 'Returns no Pi token-usage projection.'),
  getSystemPrompt: rule('full', 'Returns the system prompt currently assembled by the bridge.'),
  getSystemPromptOptions: rule('partial', 'Returns an empty Pi option projection in command contexts.'),
  waitForIdle: rule('partial', 'Mapped to the DSH agent idle boundary when available.'),
  sessionManager: rule('partial', 'A real read-only projection: DSH durable messages plus pi2dsh sidecar entries, exposed through Pi\'s exact 14-method surface as a single-branch tree.'),
  modelRegistry: rule('partial', 'A live registry over the ONE model directory: every Pi provider (package-registered or ~/.pi/agent/models.json) is a DSH llm route, and the registry is that directory\'s exact Pi projection — Pi-native entries keep api/baseUrl and the full Model shape. getProviderAuth/getApiKeyAndHeaders run Pi\'s full credential chain (models.json keys resolve with Pi\'s $ENV/!command semantics); DSH-owned routes keep their credentials inside their adapters by design.'),
  model: rule('partial', 'The agent\'s real provider/model route (a setModel() override wins), enriched from the projected catalog.'),
  scopedModels: rule('partial', 'The projected model catalog (DSH llm directory plus package-registered providers).'),
  hasConfiguredAuth: rule('partial', 'Configuration check on the projected registry: true when the model\'s provider has a live route or package registration (not a key-liveness probe).'),
  thinkingLevel: rule('partial', 'Reflects the level recorded by setThinkingLevel(); applied as reasoningEffort on the next request.'),
  abort: rule('partial', 'Mapped to agent.cancel({ kind: "hook" }) on the live DSH agent.'),
  shutdown: rule('unsupported', 'A migrated package may not shut down the DSH host; calling fails explicitly.'),
  compact: rule('unsupported', 'Pi compaction control requires a native DSH compaction integration; calling fails explicitly.'),
  newSession: rule('unsupported', 'Session replacement belongs to the DSH host; calling fails explicitly.'),
  fork: rule('unsupported', 'Pi entry-tree forking has no DSH equivalent (DSH fork is boundary-based); calling fails explicitly.'),
  navigateTree: rule('unsupported', 'Pi tree navigation has no DSH equivalent; calling fails explicitly.'),
  switchSession: rule('unsupported', 'Session switching belongs to the DSH host; calling fails explicitly.'),
  reload: rule('unsupported', 'Extension reload belongs to the DSH host (HMR); calling fails explicitly.'),
})

export const UI_CONTEXT_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  notify: rule('full', 'Captured as a command result when applicable and emitted through DSH logging.'),
  setStatus: rule('partial', 'Accepted as a no-op because DSH owns status presentation.'),
  setWidget: rule('partial', 'Accepted as a no-op because Pi terminal widgets cannot render in DSH.'),
  select: rule('full', 'Mapped to one native DSH userQuestions single-select request.'),
  confirm: rule('full', 'Mapped to one native DSH userQuestions Yes/No request.'),
  input: rule('full', 'Mapped to one native DSH userQuestions free-text request.'),
  editor: rule('partial', 'Mapped to one DSH userQuestions free-text request; multi-line editing UX is not emulated.'),
  custom: rule('partial', 'Resolves undefined, exactly like Pi\'s own rpc mode; guarded fallbacks keep working.'),
  onTerminalInput: rule('partial', 'Raw terminal input is absent; feature-detected listeners remain disabled.'),
  setWorkingMessage: rule('partial', 'Accepted as a no-op; DSH owns progress presentation.'),
  setWorkingVisible: rule('partial', 'Accepted as a no-op; DSH owns progress presentation.'),
  setWorkingIndicator: rule('partial', 'Accepted as a no-op; DSH owns progress presentation.'),
  setHiddenThinkingLabel: rule('partial', 'Accepted as a no-op; DSH owns thinking presentation.'),
  setFooter: rule('partial', 'Accepted as a no-op; DSH owns footer presentation.'),
  setHeader: rule('partial', 'Accepted as a no-op; DSH owns header presentation.'),
  setTitle: rule('partial', 'Accepted as a no-op; DSH owns window titles.'),
  pasteToEditor: rule('partial', 'Appends to a per-agent editor buffer readable through getEditorText().'),
  setEditorText: rule('partial', 'Stored in a per-agent editor buffer readable through getEditorText().'),
  getEditorText: rule('partial', 'Reads the per-agent editor buffer maintained by the bridge.'),
  addAutocompleteProvider: rule('partial', 'Registration is recorded; no DSH surface requests suggestions.'),
  setEditorComponent: rule('partial', 'Registration is recorded; no DSH surface mounts a Pi editor component.'),
  getEditorComponent: rule('partial', 'Returns the recorded factory.'),
  theme: rule('partial', 'A headless theme whose styling calls return unstyled text.'),
  getAllThemes: rule('partial', 'Lists the single headless theme.'),
  getTheme: rule('partial', 'Resolves only the headless theme.'),
  setTheme: rule('partial', 'Accepts the headless theme; other names report an explicit error result.'),
  getToolsExpanded: rule('partial', 'A bridge-local presentation flag.'),
  setToolsExpanded: rule('partial', 'A bridge-local presentation flag.'),
})

export const API_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  registerTool: {
    level: 'partial',
    detail: 'Registered as a native DSH tool. Text and image results use native DSH content/attachments; unsupported JSON Schema constraints and Pi-only error details are explicitly degraded.',
  },
  unregisterTool: {
    level: 'full',
    detail: 'Disposes the exact native DSH tool registration and removes it from the migrated package registry.',
  },
  registerCommand: {
    level: 'partial',
    detail: 'Registered in ctx.commands with Pi\'s never-throw collision semantics: a package re-registering its own name replaces it, and cross-source collisions mount under Pi\'s numbered scheme (/name-2 — the earlier registration keeps the bare name, where Pi renumbers both). ui.notify becomes the result, while interactive Pi TUI methods fail explicitly in headless DSH.',
  },
  registerShortcut: {
    level: 'partial',
    detail: 'Registration is recorded and introspectable; DSH surfaces feed no terminal key input, so handlers never fire — the same as Pi\'s non-TUI modes.',
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
    level: 'partial',
    detail: 'The provider declaration is recorded and introspectable; model calls stay on native DSH llm adapters and credentials, which own transports and secrets.',
  },
  unregisterProvider: {
    level: 'partial',
    detail: 'Removes the recorded provider declaration.',
  },
  registerMessageRenderer: {
    level: 'partial',
    detail: 'Registration is accepted; DSH owns presentation, so the renderer is never invoked — matching Pi\'s non-TUI surfaces.',
  },
  registerEntryRenderer: {
    level: 'partial',
    detail: 'Registration is accepted; DSH owns presentation, so the renderer is never invoked — matching Pi\'s non-TUI surfaces.',
  },
  registerMarkdownTransformer: {
    level: 'partial',
    detail: 'Registration is accepted; DSH owns presentation, so the transformer is never invoked — matching Pi\'s non-TUI surfaces.',
  },
  sendMessage: {
    level: 'partial',
    detail: 'Mapped to native DSH inject/steer/followup delivery with honest plugin provenance; Pi display/details metadata awaits the custom session-entry seam.',
  },
  sendUserMessage: {
    level: 'full',
    detail: 'Mapped to native DSH steer/followup delivery with text and attachment-backed image content.',
  },
  appendEntry: {
    level: 'partial',
    detail: 'Persisted in a pi2dsh sidecar next to the DSH session and replayed on session start; DSH\'s main log stays untouched because it has no out-of-repo plugin-event channel yet.',
  },
  setSessionName: {
    level: 'partial',
    detail: 'Persisted in the pi2dsh sidecar and announced through session_info_changed; DSH\'s own title events are also projected when present.',
  },
  getSessionName: {
    level: 'partial',
    detail: 'Reads the sidecar-persisted session name.',
  },
  setLabel: {
    level: 'partial',
    detail: 'Persisted in the pi2dsh sidecar and reflected by the sessionManager projection.',
  },
  exec: {
    level: 'partial',
    detail: 'Mapped to ctx.subprocess, so the selected local/E2B provider owns execution, isolation, cancellation, and tree cleanup; output is bounded to 64 MiB per stream.',
  },
  getActiveTools: {
    level: 'partial',
    detail: 'Returns every tool visible in the current DSH agent scope, including native and migrated tools; scope-local tools follow DSH composition rules.',
  },
  getAllTools: {
    level: 'partial',
    detail: 'Returns metadata for all tools visible in the current DSH scope, without Pi-specific prompt guidelines unavailable from DSH schemas.',
  },
  setActiveTools: {
    level: 'partial',
    detail: 'Mapped to the active DSH agent scope through tools.restrict({ allow }), preserving per-agent global-tool visibility without mutating other agents; DSH scope-local tools remain visible by design.',
  },
  getCommands: {
    level: 'partial',
    detail: 'Returns commands registered by this migrated Pi package, not every command visible in the DSH scope.',
  },
  setModel: {
    level: 'partial',
    detail: 'Recorded as a per-agent override applied through the agent/request waterfall on the next model call; DSH remains authoritative for provider routing.',
  },
  getThinkingLevel: {
    level: 'partial',
    detail: 'Returns the level recorded by setThinkingLevel (default off).',
  },
  setThinkingLevel: {
    level: 'partial',
    detail: 'Recorded per agent and applied as reasoningEffort through the agent/request waterfall; DSH validates the effort id at the request boundary.',
  },
  events: {
    level: 'full',
    detail: 'Package-local Pi extension event-bus emit/on semantics are preserved for migrated extensions in the same bundle.',
  },
})

const OBSERVED_NEVER_FIRES = (moment: string): Rule => ({
  level: 'partial',
  detail: `Registration is accepted; ${moment} never occurs on DSH surfaces, so the handler never fires. Loading is unaffected.`,
})

export const EVENT_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  session_start: { level: 'full', detail: 'Mapped to agent/session-start.' },
  session_shutdown: { level: 'full', detail: 'Mapped to agent disposal and plugin teardown with duplicate suppression.' },
  session_info_changed: { level: 'partial', detail: 'Fired by setSessionName() and projected from DSH session/title events.' },
  agent_start: { level: 'full', detail: 'Mapped to the DSH turn/start boundary.' },
  agent_settled: { level: 'full', detail: 'Mapped to the DSH turn/end boundary.' },
  turn_start: { level: 'full', detail: 'Mapped from durable turn/start events.' },
  tool_execution_start: { level: 'full', detail: 'Mapped from durable tool/call events.' },
  tool_execution_end: { level: 'full', detail: 'Mapped from finalized tools/result events.' },
  tool_execution_update: {
    level: 'partial',
    detail: 'Fired from migrated Pi tools\' own onUpdate callbacks; DSH-native tools expose no partial-result stream.',
  },
  tool_call: {
    level: 'partial',
    detail: 'Blocking is supported, and in-place argument mutation reaches migrated Pi tools; mutating a DSH-native tool\'s arguments is rejected because DSH logs arguments before policy.',
  },
  tool_result: {
    level: 'partial',
    detail: 'Text replacement and success-to-error blocking are supported; arbitrary details and error recovery are not.',
  },
  before_agent_start: {
    level: 'full',
    detail: 'Fires at the turn\'s first pre-step with the real prompt text and image attachments; returned custom messages enter the turn beside the user message, and a returned systemPrompt overrides this turn\'s assembly.',
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
    level: 'partial',
    detail: 'Projected from DSH assistant/chunk events with accumulated text; Pi\'s full AgentMessage accumulation state is approximated.',
  },
  session_before_compact: {
    level: 'partial',
    detail: 'Projected from DSH compaction/start as a notification; cancel/replace cannot reach DSH\'s compactor.',
  },
  session_compact: {
    level: 'partial',
    detail: 'Projected from DSH compaction summary/end events.',
  },
  model_select: {
    level: 'partial',
    detail: 'Fired by setModel() and projected from request/header model changes in the durable log.',
  },
  thinking_level_select: {
    level: 'partial',
    detail: 'Fired by setThinkingLevel(); DSH-side reasoning changes surface through request/header projection.',
  },
  context: {
    level: 'partial',
    detail: 'Fires before each step with the full message projection; the transform applies to the step\'s not-yet-entered messages (the slice packages rewrite), while already-entered history stays read-only under DSH\'s append-only log.',
  },
  before_provider_request: {
    level: 'unsupported',
    detail: 'Provider payload mutation belongs in a native DSH LLM adapter; the handler is accepted but never fires.',
  },
  before_provider_headers: {
    level: 'unsupported',
    detail: 'Provider header mutation belongs in a native DSH LLM adapter; the handler is accepted but never fires.',
  },
  after_provider_response: {
    level: 'unsupported',
    detail: 'Provider response interception belongs in a native DSH LLM adapter; the handler is accepted but never fires.',
  },
  user_bash: OBSERVED_NEVER_FIRES('Pi\'s ! command surface'),
  input: OBSERVED_NEVER_FIRES('raw Pi terminal input'),
  project_trust: {
    level: 'unsupported',
    detail: 'Project trust must remain owned by the DSH host; the handler is accepted but never consulted.',
  },
  resources_discover: {
    level: 'unsupported',
    detail: 'Dynamic resource discovery must be converted into DSH providers; the handler is accepted but never fires.',
  },
  session_before_switch: OBSERVED_NEVER_FIRES('Pi session switching'),
  session_before_fork: OBSERVED_NEVER_FIRES('Pi tree forking'),
  session_before_tree: OBSERVED_NEVER_FIRES('Pi session-tree navigation'),
  session_tree: OBSERVED_NEVER_FIRES('Pi session-tree navigation'),
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
