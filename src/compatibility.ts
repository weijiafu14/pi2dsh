import type { CompatibilityLevel } from './types.js'

interface Rule {
  level: CompatibilityLevel
  detail: string
  /** How the mapping is built — the DSH seam or service that carries it. */
  design?: string
}

/**
 * A Pi extension surface. `design` is REQUIRED here and optional on Rule: an
 * imported symbol is served by a shim family the docs describe once, but every
 * surface a package can call has to name the DSH mechanism behind it, or the
 * documentation degrades into a list of verdicts nobody can act on. Adding a
 * surface without one is a type error, which is the point.
 */
interface SurfaceRule extends Rule {
  design: string
}

const rule = (level: CompatibilityLevel, detail: string): Rule => ({ level, detail })

const surface = (level: CompatibilityLevel, detail: string, design: string): SurfaceRule =>
  ({ level, detail, design })

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
const VENDORED_TOOL = 'Pi\'s built-in tool constructor, vendored byte-identical with its pure-logic closure.'
const EVENT_GUARD = 'Pi\'s exact one-line tool-event guard, reimplemented verbatim.'
const VENDORED_SUMMARIZER = 'Vendored Pi logic; the model call fills Pi\'s own streamFn injection point with the DSH llm bridge when the caller passes none, so summarization runs on the ONE model path. Without a mounted llm service it fails explicitly.'
const PI_PROVIDER_TRANSPORT_FACTORY = 'Pi\'s real lazy protocol transport factory, exposed to transport-owning provider packages and then wrapped as one native DSH llm adapter.'

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
    estimateTokens: rule('full', VENDORED),
    calculateContextTokens: rule('full', `${VENDORED} Pi\'s Usage-based total (an earlier reimplementation summed message estimates — same name, different meaning — and was replaced).`),
    DEFAULT_COMPACTION_SETTINGS: rule('full', VENDORED),
    serializeConversation: rule('full', VENDORED),
    shouldCompact: rule('full', `${VENDORED} The pure threshold check; DSH still owns automatic compaction scheduling.`),
    compact: rule('partial', VENDORED_SUMMARIZER),
    findCutPoint: rule('full', VENDORED),
    generateSummary: rule('partial', VENDORED_SUMMARIZER),
    generateSummaryWithUsage: rule('partial', VENDORED_SUMMARIZER),
    generateBranchSummary: rule('partial', VENDORED_SUMMARIZER),
    parseFrontmatter: rule('full', `${VENDORED} Returns Pi\'s public { frontmatter, body } shape with YAML-parsed values (an earlier reimplementation returned { attributes } with string values and was replaced).`),
    stripFrontmatter: rule('full', VENDORED),
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
    wrapRegisteredTool: rule('full', `${VENDORED} The runner argument is used exactly as Pi uses it (createContext + getActiveTools), which the pi2dsh projection provides.`),
    ProjectTrustStore: rule('partial', `${VENDORED} The store operates on trust.json under the caller\'s agentDir — with the redirected getAgentDir convention that is package-visible state inside the DSH-owned pi2dsh directory. The DSH host never consults it; host trust stays a DSH decision (ctx.isProjectTrusted fails closed).`),
    DefaultResourceLoader: rule('partial', 'A headless resource loader honoring overrides, with empty discovery sets.'),
    DefaultPackageManager: rule('unsupported', 'Installing packages is owned by the DSH host and its security gates (dsh plugin add/remove behind pnpm\'s build-script approval). Importing it is flagged at mount time (startup check); constructing it throws a structured PiCapabilityError, and doing so during entry setup marks the package unusable.'),
    ModelRuntime: rule('unsupported', 'Standalone model stacks are owned by the DSH host llm configuration; packages read the ONE directory through ctx.modelRegistry. Importing it is flagged at mount time (startup check); constructing it throws a structured PiCapabilityError, and doing so during entry setup marks the package unusable.'),
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
    loadSkills: rule('partial', `${VENDORED} Real directory discovery with Pi\'s exact rules; default locations resolve through the redirected getAgentDir, i.e. inside the DSH-owned pi2dsh directory.`),
    loadSkillsFromDir: rule('full', `${VENDORED} Real directory discovery: SKILL.md roots, direct .md children, ignore files, symlink dedup, and Pi\'s name/description validation.`),
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
    envApiKeyAuth: rule('full', 'Pi 0.84.1 stored-key-first auth helper with ordered environment fallback and the original secret-prompt login contract.'),
    anthropicMessagesApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    openAICompletionsApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    openAIResponsesApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    openAICodexResponsesApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    azureOpenAIResponsesApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    googleGenerativeAIApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    googleVertexApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    mistralConversationsApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    bedrockConverseStreamApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    piMessagesApi: rule('full', PI_PROVIDER_TRANSPORT_FACTORY),
    streamSimpleOpenAIResponses: rule('full', 'Pi\'s real OpenAI Responses simple transport, exported under the legacy symbol used by transport-owning provider packages.'),
    registerProvider: rule('partial', 'Recorded in the Pi-facing registry, then exposed as a DSH route: a transport-owning provider uses llm.registerAdapter; a catalog-only provider is translated into the official llm-pi-ai profile schema.'),
    getProviders: rule('partial', 'Returns the bridge-local registry contents.'),
    getProvider: rule('partial', 'Reads the bridge-local registry.'),
    getModel: rule('partial', 'Resolves no Pi model objects; DSH owns model routing.'),
    getModels: rule('partial', 'Returns an empty list; DSH owns model routing.'),
    complete: rule('partial', 'Real model calls through the DSH llm bridge (the host installs it at mount); without a mounted llm service the call fails explicitly. Provider SDKs are never loaded.'),
    stream: rule('partial', 'Real streaming model calls through the DSH llm bridge (the host installs it at mount); without a mounted llm service the call fails explicitly. Provider SDKs are never loaded.'),
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

export const CONTEXT_RULES: Readonly<Record<string, SurfaceRule>> = Object.freeze({
  cwd: surface('full', 'Mapped to the active DSH agent session working directory.', 'Read off the live DSH agent\'s session; the bridge keeps no working directory of its own.'),
  signal: surface('full', 'Mapped to the active DSH cancellation signal when one is available.', 'The DSH cancellation signal belonging to the moment the context was built — a tool context carries its execution signal, a lifecycle context the agent\'s.'),
  hasUI: surface('full', 'Reports whether a real interactive surface exists: true for dsh-TUI\'s mounted scene service or for a DSH user-question provider; false for a genuinely headless composition and for child-agent questions that DSH refuses.', 'The terminal answer comes from the optional public tuiScenes service. The question answer is probed rather than guessed: the bridge registers a throwaway UserQuestion provider and reads the documented DUPLICATE_PROVIDER rejection as "a real provider is already there", then disposes it. Inside a child agent only the terminal scene can make this true, because DSH refuses child-agent questions.'),
  mode: surface('full', 'Reports tui when dsh-TUI\'s public scene service is mounted, rpc in browser/headless compositions.', 'Derived from the live optional TuiSurfaceAdapter. This is the branch interactive Pi plugins use before calling ui.custom; it changes with the Cordis service lifecycle rather than being a constant.'),
  isIdle: surface('partial', 'Command contexts report idle; tool/lifecycle contexts conservatively report non-idle.', 'Derived from which context the call arrived through: a command context is outside a step, a tool or lifecycle context is inside one.'),
  isProjectTrusted: surface('partial', 'Fails closed as untrusted because DSH does not expose Pi project-trust state.', 'No DSH seam carries Pi\'s project-trust state, so the bridge returns the safe constant instead of inventing one. Pi\'s own ProjectTrustStore is vendored and available to packages that manage their own.'),
  hasPendingMessages: surface('full', 'Reads the DSH agent inbox — next-step plus next-turn input — which is exactly Pi\'s steering plus follow-up queue.', 'Reads the DSH agent inbox — next-step plus next-turn queues — which is the same queue sendMessage/sendUserMessage write into.'),
  getContextUsage: surface('partial', 'Returns no Pi token-usage projection.', 'Not synthesized. DSH accounts tokens in its own token-meter service, and a guessed Pi projection would be read as measurement.'),
  getSystemPrompt: surface('full', 'Returns the system prompt currently assembled by the bridge.', 'Returns the string the bridge recorded during system-prompt/assemble for the current turn. It is recorded on every assembly, before any gate, so a package that only reads the prompt still sees it.'),
  getSystemPromptOptions: surface('partial', 'Returns an empty Pi option projection in command contexts.', 'Pi\'s option object describes Pi\'s own prompt builder, which never runs here; the projection stays empty rather than reconstructed from DSH\'s sections.'),
  waitForIdle: surface('partial', 'Mapped to the DSH agent idle boundary when available.', 'Awaits the DSH agent\'s own idle boundary when the agent exposes one.'),
  sessionManager: surface('partial', 'A real read-only projection: DSH durable messages plus pi2dsh sidecar entries, exposed through Pi\'s exact 14-method surface as a single-branch tree. buildContextEntries is compaction-aware — entries a compaction summarized away are gone, exactly as they are for the model — while getEntries stays the append-only log, which is the same split Pi makes.', 'A read-only projection folded from two ordered sources — DSH\'s durable session log and the pi2dsh sidecar — into the single chain Pi\'s 14-method surface walks. Compaction awareness comes from the same fold: entries a compaction summarized away are dropped from the context view and kept in the log view.'),
  modelRegistry: surface('partial', 'A live registry over the ONE model directory — the DSH llm directory — projected exactly into Pi vocabulary; package-registered Pi-native routes keep api/baseUrl and the full Model shape through the round trip. DSH describes one model across two seams (a listing for directory membership, an exact per-route resolve for capacity) while Pi puts everything on one Model object read synchronously, so the projection joins them when the directory is read: entries carry contextWindow, maxTokens and reasoning, and a settings change re-reads them rather than serving the retired numbers. Custom gateways are HOST configuration (the official llm-pi-ai adapter\'s settings), never a Pi-side file: Pi\'s ~/.pi/agent/models.json is deliberately NOT read — user-facing configuration is DSH-shaped only. getProviderAuth/getApiKeyAndHeaders run Pi\'s full credential chain for package-registered providers and the host\'s configurable-provider + credentials seams for DSH routes. Host configuration may declare "<route>-vision" image-admission companions: real DSH routes that admit images, replace image blocks with explicit path-carrying notices (materialized attachment files any path-taking tool can read), and forward text-only to the original route; Pi\'s ctx.model reports the original route for a companion selection.', 'A ModelCatalog over llm.listProviders() x listModels(), joined per route with llm.resolveModelInfo() for capacity, refreshed on the llm/adapters-updated notification and cached so reads stay synchronous — Pi\'s getAll() is not async. Package-registered routes have their exact Pi Model restored from the registration on the way out.'),
  model: surface('partial', 'The agent\'s real provider/model route (a setModel() override wins), enriched from the projected catalog. When the selected route is an image-admission companion, ctx.model reports the ORIGINAL route with its true modalities — the generating model is the original text-only one, which is the truth extensions branching on input modalities (a vision bridge\'s activation check) need.', 'Reads the live agent\'s own options.provider/model (a setModel override wins) and enriches it through the same catalog projection, so a package reads one Model shape everywhere.'),
  scopedModels: surface('full', 'Empty, carrying Pi\'s own meaning for empty: no model scope is configured, so every available model is usable. DSH has no model-scope concept to narrow it.', 'Nothing to compute. DSH has no model-scope concept, and Pi\'s empty array already carries exactly that meaning.'),
  hasConfiguredAuth: surface('partial', 'Configuration check on the projected registry: true when the model\'s provider has a live route or package registration (not a key-liveness probe).', 'Answered from configuration alone — the package-provider map plus the live catalog — and never opens a connection, which is also what Pi\'s own check does.'),
  thinkingLevel: surface('partial', 'Reflects the level recorded by setThinkingLevel(); applied as reasoningEffort on the next request.', 'Bridge state written by setThinkingLevel, applied to the request on the agent/request waterfall.'),
  abort: surface('partial', 'Mapped to agent.cancel({ kind: "hook" }) on the live DSH agent.', 'Calls agent.cancel({ kind: \'hook\' }) on the live DSH agent.'),
  shutdown: surface('partial', 'Pi defines shutdown behavior as host-provided (runner.ts bindExtensions); this host absorbs the request — the user owns DSH process exit — and informs the user once. The package keeps running.', 'Pi defines shutdown as host-provided, so this host absorbs it: the request is recorded in the capability ledger and surfaced to the user once. Nothing calls process.exit — the DSH process belongs to the user.'),
  compact: surface('partial', 'Pi\'s fire-and-forget trigger, translated to DSH\'s official manual compaction (ctx.compaction.compactNow on the live agent). onComplete receives the real summary text and the shadowed-content token estimate as tokensBefore; firstKeptEntryId is empty because the DSH log has no Pi entry ids. Without a compaction service the gap flows through Pi\'s onError callback and the capability ledger.', 'Calls DSH\'s official compaction.compactNow on the live agent and adapts the outcome onto Pi\'s onComplete/onError callbacks. With no compaction service mounted the gap flows through onError rather than an exception.'),
  newSession: surface('partial', 'Really creates a DSH session (ctx.sessions.create) with parent lineage; withSession runs against a projection context bound to it, whose sendMessage/sendUserMessage/appendEntry write into THAT session rather than the one the call came from. DSH has no host-level "current session pointer" a plugin could move — which session the surface shows stays a host choice, announced once.', 'ctx.sessions.create with parent lineage, then a projection context bound to the new session so everything inside withSession (sendMessage, appendEntry, ...) writes into THAT session.'),
  fork: surface('partial', 'Really forks on DSH\'s official prefix-fork surface (ctx.sessions.fork with lineage metadata). Anchors are durable-log entries (projected ids "dsh-<seq>"); Pi\'s default position "before" is honored, and the boundary shrinks to the nearest completed-turn edge because DSH seeds must not split an open turn. Sidecar entries cannot anchor a fork.', 'ctx.sessions.fork at a durable sequence number decoded from the projected entry id (dsh-<seq>), snapped to the nearest completed-turn edge because a DSH seed must not split an open turn.'),
  navigateTree: surface('partial', 'Expressed through DSH\'s session model: the DSH tree lives BETWEEN sessions (fork lineage), not inside one log, so navigation forks at the target boundary. summarize runs Pi\'s vendored branch summarizer over the abandoned durable slice (model call on the DSH llm bridge) and lands the summary as a branch_summary entry in the new session\'s projection; label lands as a label entry.', 'A fork at the target boundary, plus — when the caller asks for one — Pi\'s vendored branch summarizer run over the abandoned slice with the DSH llm bridge filling Pi\'s own streamFn injection point.'),
  switchSession: surface('partial', 'Targets a LIVE DSH session by id (or a Pi-style path whose basename is "<id>.jsonl"); withSession runs against its projection. Switching to persisted sessions is host-owned — resume them from the DSH surface first. Which session the surface shows stays a host choice.', 'Resolves the id (or the basename of a Pi-style <id>.jsonl path) against live DSH sessions and binds a projection context to it.'),
  reload: surface('partial', 'Really remounts every mounted package\'s extension entries through a fresh loader (registrations replaced via the same-name path, event handlers reset), so edited plugin code takes effect. Skills, prompts, and themes are host-managed and reload with dsh itself.', 'Remounts every mounted package\'s extension entries through a fresh jiti loader: registrations are replaced through the same-name path and handler lists reset, so edited plugin code takes effect without restarting DSH.'),
})

export const UI_CONTEXT_RULES: Readonly<Record<string, SurfaceRule>> = Object.freeze({
  notify: surface('full', 'Captured as a command result when applicable and emitted through DSH logging at the severity the caller passed (warning and error log as warnings).', 'Written to the DSH logger at the severity the caller passed, and returned as the command result when the call happens inside one.'),
  setStatus: surface('full', 'Pi\'s keyed status entries render in the active DSH front door: dsh-TUI\'s native status line in terminal mode and package-keyed pills in the bridge\'s browser half. setStatus(key, undefined) removes exactly one entry.', 'Terminal mode writes a package-namespaced key through dsh-TUI\'s public tuiStatus service and owns the returned disposer. Browser mode writes BrowserSurfaces by (session, package, key); the client half draws the entries from the bridge route.'),
  setWidget: surface('partial', 'String-array widgets render as a strip in DSH\'s conversation.input.dock seat (a full-width row of its own above the composer card). setWidget(key, undefined) removes one widget. Component factories are ignored, exactly like Pi\'s own rpc mode, where widgets travel to a host as lines.', 'BrowserSurfaces.setWidget keeps the lines per widget key; the client half draws them in the conversation.input.dock slot. The factory branch is dropped at the ui seam, mirroring rpc-mode.ts\'s "Only support string arrays in RPC mode".'),
  select: surface('full', 'Mapped to one native DSH userQuestions single-select request.', 'One native DSH UserQuestionService request carrying Pi\'s options as the choices. The turn really blocks until a human answers.'),
  confirm: surface('full', 'Mapped to one native DSH userQuestions Yes/No request.', 'One native DSH UserQuestionService request with two choices.'),
  input: surface('full', 'Mapped to one native DSH userQuestions free-text request.', 'One native DSH UserQuestionService free-text request.'),
  editor: surface('partial', 'Mapped to one DSH userQuestions free-text request. The prefill is shown as context but is NOT editable text: the caller receives what the user typed fresh, not an edit of the prefill.', 'One native DSH UserQuestionService free-text request. DSH has no editable-prefill question type, so the prefill is shown in the question body and the answer comes back as fresh text.'),
  custom: surface('partial', 'In dsh-TUI, runs the real Pi component in a native full-screen scene with raw terminal input, render invalidation, result completion and disposal. In browser/headless compositions it resolves undefined, Pi\'s own rpc-mode behavior.', 'The bridge adapts the public Pi component protocol (render(width), handleInput(raw bytes), requestRender, dispose) onto dsh-TUI\'s public tuiScenes seam and host React/ANSI renderer; no Pi TUI owns the terminal. Browsers cannot execute terminal components, so their rpc behavior remains undefined and package-specific browser shapes continue through native client slots.'),
  onTerminalInput: surface('partial', 'Raw terminal input is absent; feature-detected listeners remain disabled.', 'Recorded; no DSH surface produces raw terminal input, and feature-detecting packages keep the listener disabled.'),
  setWorkingMessage: surface('partial', 'A live working message, drawn in DSH\'s conversation.composer.dock band (under the composer card — the host\'s ambient-readout seat, where its own stats line sits). Calling with no argument restores the default, i.e. clears it.', 'Recorded per session per package and drawn by the client half\'s composer-dock seat. Pi\'s rpc mode is a no-op here (it has no TUI loader); a browser host genuinely can show the text, so the bridge supersedes it.'),
  setWorkingVisible: surface('partial', 'Hides or shows the working chrome (message, indicator, hidden-thinking label) without clearing it — Pi\'s exact semantics.', 'A flag on the per-package surface view; the client half skips working keys while it is false. Supersedes Pi\'s rpc-mode no-op with a real visibility switch.'),
  setWorkingIndicator: surface('partial', 'WorkingIndicatorOptions ({frames?: string[]}) project to the frames\' text in the same composer-dock working chrome. An empty array hides the indicator and frames: undefined restores the default (clears it); animated frames render as their static concatenation — the honest still of the package\'s own frames.', 'surfaceText projects the frames object to text, recorded like the other working surfaces. Pi\'s rpc mode ignores the call; the browser host draws the static projection instead.'),
  setHiddenThinkingLabel: surface('partial', 'The label shows in the same working chrome; calling with no argument restores the default, i.e. clears it. DSH owns the thinking block\'s own presentation, so the label is informational chrome, not a re-render of the block.', 'Recorded per session per package like the other working surfaces. Pi\'s rpc mode is a no-op here; the browser host shows the text.'),
  setFooter: surface('partial', 'A custom footer factory renders when it can build its component without Pi\'s TUI, into the conversation.composer.dock band; otherwise the surface stays empty — the same shape as Pi\'s rpc mode, where no footer factory runs at all. The factory receives the bridge\'s headless theme.', 'surfaceText calls the factory with the headless theme (and no TUI) and renders the returned component\'s render(80) output; a factory that needs the TUI throws and degrades to an empty surface.'),
  setHeader: surface('partial', 'A custom header factory renders when it can build its component without Pi\'s TUI, into DSH\'s conversation.session.header.utilities seat; otherwise the surface stays empty — the same shape as Pi\'s rpc mode.', 'surfaceText calls the factory with the headless theme (and no TUI) and renders the component; failures degrade to empty. Drawn by the client half\'s header-utilities seat.'),
  setTitle: surface('partial', 'Pi\'s transient window title shows as a frame-wide pill in the bridge\'s browser half. It deliberately does NOT rename the DSH session: a session title is durable, user-owned and shown in the session list, and quietly rewriting it would outlive the turn that asked.', 'Recorded per session per package and drawn as a pill in the shell.overlay seat, next to the status pills.'),
  pasteToEditor: surface('partial', 'Appends to a per-agent editor buffer readable through getEditorText().', 'Appends to the live composer text and writes it back through the same path as setEditorText — the append is against what the user actually has, not against the package\'s last write.'),
  setEditorText: surface('partial', 'Stored in a per-agent editor buffer readable through getEditorText().', 'Writes the DSH composer for real. `inputActions.setDraft` is part of the session standard kit every session-scoped slot component receives, so the bridge\'s own browser half performs the write; the request carries a revision so a repeated call is a new write rather than a no-op. Without a browser (the CLI profile) it falls back to the per-agent buffer, which is what Pi\'s own non-interactive modes do.'),
  getEditorText: surface('partial', 'Reads the per-agent editor buffer maintained by the bridge.', 'Reads what the composer actually holds: the browser half reports the live draft back to the bridge, so a package sees the user\'s typing and not only its own writes. With no browser watching, it answers with the last text this package wrote.'),
  addAutocompleteProvider: surface('partial', 'The provider really runs: its completions appear as rows in DSH\'s own `@` trigger menu, and picking one inserts the value it chose. Providers anchored on a trigger character map exactly; one that completes bare words mid-sentence has no moment to fire in.', 'Pi asks a provider at the cursor on every edit; DSH asks a source after `/` or `@`. The two agree exactly for a provider ANCHORED on a trigger character — an @-mention provider, which is what the ecosystem\'s provider is — so the bridge builds Pi\'s provider chain, asks it with the token being typed, and offers the result as rows in DSH\'s own trigger menu; picking one inserts the value the provider chose. A provider that completes bare words mid-sentence has no DSH moment to fire in and contributes nothing, rather than being given an interaction its author never designed.'),
  setEditorComponent: surface('partial', 'Registration is recorded; no DSH surface mounts a Pi editor component.', 'Kept in bridge state and readable back; no DSH surface consumes it.'),
  getEditorComponent: surface('partial', 'Returns the recorded factory.', 'Returns the factory setEditorComponent recorded.'),
  theme: surface('partial', 'A headless theme whose styling calls return unstyled text.', 'A single headless Theme object whose styling functions return their input unchanged; DSH does the rendering.'),
  getAllThemes: surface('partial', 'Lists the single headless theme.', 'Lists the one headless theme the bridge owns.'),
  getTheme: surface('partial', 'Resolves only the headless theme.', 'Resolves the one headless theme by name.'),
  setTheme: surface('partial', 'Accepts the headless theme; other names report an explicit error result.', 'Accepts the headless theme and returns Pi\'s explicit error result for any other name, rather than pretending a switch happened.'),
  getToolsExpanded: surface('partial', 'A bridge-local presentation flag.', 'A bridge-local flag; nothing renders from it.'),
  setToolsExpanded: surface('partial', 'A bridge-local presentation flag.', 'A bridge-local flag; nothing renders from it.'),
})

export const API_RULES: Readonly<Record<string, SurfaceRule>> = Object.freeze({
  registerTool: {
    level: 'partial',
    detail: 'Registered as a native DSH tool. Text and image results use native DSH content/attachments; unsupported JSON Schema constraints and Pi-only error details are explicitly degraded.',
    design: 'Registered on DSH\'s own tool registry, so the model sees it in the same catalog and the loop runs it through the same permission and sandbox path. Arguments go through Pi\'s vendored validateToolArguments inside DSH\'s prepareArguments hook, which is what gives a Pi tool the coercions ("7" to 7) Pi\'s own gate would have made before its handler ran.',
  },
  unregisterTool: {
    level: 'full',
    detail: 'Disposes the exact native DSH tool registration and removes it from the migrated package registry.',
    design: 'Disposes the exact registration handle kept when the tool was registered, and drops it from the package\'s own registry.',
  },
  registerCommand: {
    level: 'partial',
    detail: 'Registered in ctx.commands with Pi\'s never-throw collision semantics: a package re-registering its own name replaces it, and cross-source collisions mount under Pi\'s numbered scheme (/name-2 — the earlier registration keeps the bare name, where Pi renumbers both). In dsh-TUI, its locally reserved /mcp remains native and the migrated command is reachable as /pi-mcp.',
    design: 'Registered on ctx.commands with an input descriptor. The descriptor is what makes /name <arguments> parse as a command instead of chat. dsh-TUI currently exposes no reserved-command registry; the one verified local interception needed by the MCP integration is translated before registration.',
  },
  registerShortcut: {
    level: 'partial',
    detail: 'Registration is recorded and introspectable; DSH surfaces feed no terminal key input, so handlers never fire — the same as Pi\'s non-TUI modes.',
    design: 'Recorded in bridge state; no DSH surface feeds terminal key events, exactly as in Pi\'s own non-TUI modes.',
  },
  registerFlag: {
    level: 'partial',
    detail: 'The declared default is available through getFlag; Pi process flags cannot be added to the DSH launcher.',
    design: 'The declared default goes into a bridge map. DSH\'s launcher exposes no seam for adding process flags, so the flag exists for the package\'s own reads only.',
  },
  getFlag: {
    level: 'partial',
    detail: 'Returns the migrated flag default because DSH cannot register the original Pi CLI flag.',
    design: 'Reads the bridge map registerFlag wrote.',
  },
  registerProvider: {
    level: 'partial',
    detail: 'Two outcomes, by whether the provider carries its own transport. '
      + 'WITH a transport (pi-ai createProvider and friends): it becomes a real DSH llm route through llm.registerAdapter, and from then on the package\'s own HTTP client carries the turn — its API key or OAuth token is resolved by Pi\'s credential chain and persisted in the bridge\'s auth.json, not by DSH credentials. '
      + 'WITHOUT one (catalog-only): protocol, endpoint, credential reference, model capabilities, reasoning levels and the compat fields offered by DSH are translated into the official llm-pi-ai profile; no bridge transport is synthesized.',
    design: 'Two mechanisms behind one call. A provider carrying its own transport becomes a real DSH route through llm.registerAdapter, and the package\'s own HTTP client then carries the turn with its key resolved by Pi\'s credential chain into the bridge\'s auth.json. A catalog-only declaration becomes configuration for DSH\'s official llm-pi-ai adapter, which owns credentials and the real HTTP request. Both enter the one DSH model directory.',
  },
  unregisterProvider: {
    level: 'partial',
    detail: 'Removes the recorded provider declaration.',
    design: 'Disposes the route registration when one was made and drops the recorded declaration.',
  },
  registerMessageRenderer: {
    level: 'partial',
    detail: 'The renderer really runs: a custom message the package sent is drawn by the package\'s own code and shown in the DSH web conversation. What reaches the browser is the component\'s rendered text, not a mounted Pi component.',
    design: 'A custom message is a durable DSH log entry carrying Pi\'s role:"custom" marker (source.piCustomType), so the projection reads it back from the session through ctx.sessions.get(id) rather than from a cache — the renderer keeps working after a restart. The returned component is projected through its own render(width), and the text takes a seat in the conversation flow.',
  },
  registerEntryRenderer: {
    level: 'partial',
    detail: 'The renderer really runs: entries the package appended are drawn by the package\'s own code and shown in the DSH web conversation. What reaches the browser is the component\'s rendered text, not a mounted Pi component.',
    design: 'Custom entries live in the pi2dsh sidecar (DSH\'s durable log has no channel for event types declared outside the harness, so the host\'s own conversation view can never show them). The registered EntryRenderer runs per entry, its component is projected through render(width), and the text is seated in the conversation flow. A renderer that throws contributes nothing and leaves every other package\'s entries — and the request — intact.',
  },
  registerMarkdownTransformer: {
    level: 'partial',
    detail: 'Registration is accepted; DSH owns presentation, so the transformer is never invoked — matching Pi\'s non-TUI surfaces.',
    design: 'Kept in bridge state and readable back; no DSH surface consumes it.',
  },
  sendMessage: {
    level: 'partial',
    detail: 'Durable by the time it returns, as in Pi: the no-turn call appends to the session log and announces its message events immediately, so the message IS in the conversation when the call resolves. Steering and follow-up drive a turn through the agent. Pi display/details metadata awaits the custom session-entry seam.',
    design: 'Two paths under one name. The no-turn call appends through Session.append(type, data, { surfaceOp: \'append\' }) — the public marker DSH requires for surface-eligible types — so the message is durable and visible by the time the call resolves, then announces its own message_start/message_end. Steering and follow-up go through the DSH agent inbox instead, which is what actually drives a turn.',
  },
  sendUserMessage: {
    level: 'full',
    detail: 'Mapped to native DSH steer/followup delivery with text and attachment-backed image content.',
    design: 'The DSH agent inbox (steer or follow-up by option), with image content materialized as DSH attachments first.',
  },
  appendEntry: {
    level: 'partial',
    detail: 'Persisted in a pi2dsh sidecar next to the DSH session and replayed on session start; DSH\'s main log stays untouched because it has no out-of-repo plugin-event channel yet.',
    design: 'A pi2dsh sidecar file beside the DSH session, replayed at session start. DSH\'s own log has no channel for event types declared outside the harness, and writing unknown types into it corrupts the session for every other reader.',
  },
  setSessionName: {
    level: 'full',
    detail: 'Renames the DSH session through ctx.sessionTitle, so every DSH surface shows it and the title is pinned against automatic regeneration, and announces it through session_info_changed. A composition that mounts no title service falls back to the pi2dsh sidecar, as does a blank name (DSH requires visible characters in a title; Pi does not).',
    design: 'ctx.sessionTitle.rename, which is also what pins the title against DSH\'s automatic regeneration, followed by a session_info_changed dispatch. A composition with no title service — or a blank name, which DSH refuses and Pi allows — falls back to the sidecar.',
  },
  getSessionName: {
    level: 'full',
    detail: 'Reads DSH\'s own session title, so it agrees with what DSH displays and sees titles DSH generated itself; falls back to the sidecar when no title service is mounted.',
    design: 'ctx.sessionTitle.get, so the answer agrees with what DSH displays and includes titles DSH generated itself; sidecar fallback when no title service is mounted.',
  },
  setLabel: {
    level: 'partial',
    detail: 'Persisted in the pi2dsh sidecar and reflected by the sessionManager projection.',
    design: 'Stored in the pi2dsh sidecar and read back through the sessionManager projection.',
  },
  exec: {
    level: 'partial',
    detail: 'Mapped to ctx.subprocess, so the selected local/E2B provider owns execution, isolation, cancellation, and tree cleanup; output is bounded to 64 MiB per stream.',
    design: 'Handed to ctx.subprocess, so the selected local or E2B provider owns execution, isolation, cancellation and process-tree cleanup — the bridge never spawns a child itself.',
  },
  getActiveTools: {
    level: 'partial',
    detail: 'Returns every tool visible in the current DSH agent scope, including native and migrated tools; scope-local tools follow DSH composition rules.',
    design: 'Lists the DSH tool scope the current context belongs to, native and migrated tools alike.',
  },
  getAllTools: {
    level: 'partial',
    detail: 'Returns metadata for all tools visible in the current DSH scope, without Pi-specific prompt guidelines unavailable from DSH schemas.',
    design: 'Reads schemas from the same DSH tool scope; Pi\'s prompt-guideline fields have no DSH source and are left out rather than invented.',
  },
  setActiveTools: {
    level: 'partial',
    detail: 'Mapped to the active DSH agent scope through tools.restrict, per-agent and without mutating other agents. Names DSH does not know are skipped exactly as Pi skips them. A tool DSH does not permit restricting (a scope\'s own registration, or a reserved transport name) cannot be deactivated at all and is reported once rather than silently left running.',
    design: 'DSH\'s scoped tools.restrict, narrowed first. Pi silently skips names its registry does not know, while DSH fails the whole restrict call on a name it cannot restrict — so the list is filtered against what the scope reports as restrictable before it is applied, and a visible-but-unrestrictable tool is reported once instead of being silently left running. Called before an agent exists, the intent is remembered and applied when one starts.',
  },
  getCommands: {
    level: 'partial',
    detail: 'Returns commands registered by this migrated Pi package, not every command visible in the DSH scope.',
    design: 'Reads the bridge\'s own command map, which holds this package\'s registrations rather than the whole DSH scope.',
  },
  setModel: {
    level: 'partial',
    detail: 'Recorded as a per-agent override applied through the agent/request waterfall on the next model call; DSH remains authoritative for provider routing.',
    design: 'Recorded as a per-agent override and applied on the agent/request waterfall, so the next model call carries it while DSH stays authoritative for routing.',
  },
  getThinkingLevel: {
    level: 'partial',
    detail: 'Returns the level recorded by setThinkingLevel (default off).',
    design: 'Reads the per-agent level the bridge recorded.',
  },
  setThinkingLevel: {
    level: 'partial',
    detail: 'Recorded per agent and applied as reasoningEffort through the agent/request waterfall; DSH validates the effort id at the request boundary.',
    design: 'Recorded per agent and applied as reasoningEffort on the agent/request waterfall; DSH validates the effort id at the request boundary.',
  },
  events: {
    level: 'full',
    detail: 'Package-local Pi extension event-bus emit/on semantics are preserved for migrated extensions in the same bundle.',
    design: 'A package-local emitter inside the bridge, so extensions bundled together talk to each other exactly as they do under Pi.',
  },
})

const OBSERVED_NEVER_FIRES = (moment: string): SurfaceRule => ({
  level: 'partial',
  detail: `Registration is accepted; ${moment} never occurs on DSH surfaces, so the handler never fires. Loading is unaffected.`,
  design: `The handler goes into the bridge's handler map like any other, and nothing dispatches it: no DSH seam produces ${moment}. Registration is kept rather than refused so a package that subscribes at load time still loads.`,
})

export const EVENT_RULES: Readonly<Record<string, SurfaceRule>> = Object.freeze({
  session_start: { level: 'full', detail: 'Mapped to agent/session-start.', design: 'Dispatched from the cordis agent/session-start notification.' },
  session_shutdown: { level: 'full', detail: 'Mapped to agent disposal and plugin teardown with duplicate suppression.', design: 'Dispatched from agent/disposed and from plugin teardown, with duplicate suppression so a package that sees both gets one event.' },
  session_info_changed: { level: 'partial', detail: 'Fired by setSessionName() and projected from DSH session/title events.', design: 'Two sources, one event: the bridge\'s own setSessionName, and DSH\'s durable session title event projected into Pi\'s shape.' },
  agent_start: { level: 'full', detail: 'Mapped to the DSH turn/start boundary.', design: 'The DSH turn/start boundary from the durable session/event stream. DSH\'s turn is the whole prompt, which is what Pi calls an agent run.' },
  agent_settled: { level: 'full', detail: 'Mapped to the DSH turn/end boundary.', design: 'The DSH turn/end boundary.' },
  turn_start: { level: 'full', detail: 'Fires once per MODEL CALL, as in Pi — DSH calls that a step — with turnIndex counting from zero and resetting at each new prompt.', design: 'The DSH step/start boundary — one step is one model call, which is what Pi calls a turn. The index resets when a new prompt is claimed off the inbox, matching Pi\'s reset at agent_start.' },
  tool_execution_start: { level: 'full', detail: 'Mapped from durable tool/call events.', design: 'Projected from the durable tool/call event, so a handler sees exactly what was written to the session log.' },
  tool_execution_end: { level: 'full', detail: 'Mapped from finalized tools/result events.', design: 'Dispatched on DSH\'s tools/post-execute waterfall and awaited there. Riding the durable result emit instead let the handler land after turn_end, which is the opposite of Pi\'s order; the waterfall is the moment that is guaranteed to run before the caller sees the result.' },
  tool_execution_update: {
    level: 'partial',
    detail: 'Fired from migrated Pi tools\' own onUpdate callbacks; DSH-native tools expose no partial-result stream.',
    design: 'Fed by migrated Pi tools\' own onUpdate callbacks. DSH-native tools expose no partial-result stream, so nothing is synthesized for them.',
  },
  tool_call: {
    level: 'partial',
    detail: 'Blocking is supported, in-place argument mutation reaches migrated Pi tools, and `terminate` follows Pi\'s batch rule — the loop stops after a tool batch only when every call in it was blocked asking to stop. Mutating a DSH-native tool\'s arguments is rejected because DSH logs arguments before policy.',
    design: 'DSH\'s tools/pre-execute waterfall, whose decision type carries exactly the two outcomes Pi needs (proceed, deny with a reason). Pi\'s in-place argument mutation is applied to migrated Pi tools; for a DSH-native tool it is refused, because DSH logs arguments before policy runs and the log would then disagree with what executed. Pi\'s batch rule for terminate is reimplemented verbatim: the loop stops only when every finalized call in the batch asked to stop.',
  },
  tool_result: {
    level: 'partial',
    detail: 'Text replacement and success-to-error blocking are supported; arbitrary details and error recovery are not.',
    design: 'The same tools/post-execute waterfall, which is where a result can still be rewritten before the caller reads it.',
  },
  before_agent_start: {
    level: 'full',
    detail: 'Fires once per user prompt, inside the assembly of the turn it belongs to, with the real prompt text and image attachments; returned custom messages enter that same turn beside the user message, and a returned systemPrompt overrides that turn\'s own assembly and resets at the next turn.',
    design: 'DSH\'s system-prompt/assemble waterfall — an async waterfall that runs while the prompt is being assembled and whose return value is authoritative. That is why a returned systemPrompt reaches the very turn the handler fired for; the later agent/pre-step waterfall would have been one turn too late. Firing is gated on the inbox claim so it happens once per user prompt, and returned custom messages are held and injected into that same step.',
  },
  agent_end: {
    level: 'partial',
    detail: 'The lifecycle boundary is mapped, but the reconstructed Pi message history is intentionally minimal.',
    design: 'The DSH turn/end boundary. Pi\'s message history on this event is reconstructed minimally rather than replayed, because the durable log is the honest source and packages that need it read the projection.',
  },
  turn_end: {
    level: 'full',
    detail: 'Fires once per MODEL CALL, as in Pi — DSH calls that a step — carrying that call\'s own assistant message and its own tool results, with turnIndex counting model calls from zero and resetting each prompt.',
    design: 'The DSH step/end boundary, carrying that model call\'s own assistant message and the tool results belonging to it.',
  },
  message_start: {
    level: 'partial',
    detail: 'Durable user, assistant, and tool-result messages are mapped without Pi-specific provider metadata.',
    design: 'Projected from durable message events in the session/event stream.',
  },
  message_end: {
    level: 'partial',
    detail: 'Durable messages are observed, but message replacement is not supported.',
    design: 'Projected from the same durable message events; DSH\'s log is append-only, so Pi\'s message replacement has nowhere to land.',
  },
  message_update: {
    level: 'partial',
    detail: 'Projected from DSH assistant/chunk events with accumulated text; Pi\'s full AgentMessage accumulation state is approximated.',
    design: 'Projected from DSH assistant/chunk events with text accumulated by the bridge. Pi\'s full AgentMessage accumulation state is approximated, not reconstructed.',
  },
  session_before_compact: {
    level: 'partial',
    detail: 'Projected from DSH compaction/start as a notification; cancel/replace cannot reach DSH\'s compactor.',
    design: 'Projected from DSH\'s compaction/start as a notification. It is an emit, not a waterfall, so a cancel or a replacement has no channel to reach DSH\'s compactor and is not pretended.',
  },
  session_compact: {
    level: 'partial',
    detail: 'Fires once per SUCCESSFUL compaction, from DSH\'s summary event, with the summary rendered to the string Pi\'s CompactionEntry declares. A manual compaction is identified as manual; DSH does not record which automatic trigger fired, so automatic ones report "threshold" and willRetry is always false.',
    design: 'Projected from DSH\'s compaction summary event, rendered to the exact string Pi\'s CompactionEntry declares. Manual compactions are identifiable; DSH does not record which automatic trigger fired, so automatic ones report Pi\'s threshold reason.',
  },
  model_select: {
    level: 'partial',
    detail: 'Fired by setModel() and projected from request/header model changes in the durable log.',
    design: 'Fired by the bridge\'s own setModel, and projected from model changes in the durable request/header record — which is the call configuration DSH logs, not the HTTP body.',
  },
  thinking_level_select: {
    level: 'partial',
    detail: 'Fired by setThinkingLevel(); DSH-side reasoning changes surface through request/header projection.',
    design: 'Fired by the bridge\'s own setThinkingLevel; host-side reasoning changes arrive through the same request/header projection.',
  },
  context: {
    level: 'partial',
    detail: 'Fires before each step with the full message projection; the transform applies to the step\'s not-yet-entered messages (the slice packages rewrite), while already-entered history stays read-only under DSH\'s append-only log.',
    design: 'DSH\'s agent/pre-step waterfall, whose decision type distinguishes entering a step from rejecting it. The transform applies to the messages that have not entered the step yet — the slice Pi packages actually rewrite — while entered history stays read-only under DSH\'s append-only log.',
  },
  before_provider_request: {
    level: 'partial',
    detail: 'Fires with the exact outgoing payload for Pi package-owned transports; native DSH adapters expose no body-builder hook and remain unavailable.',
    design: 'A transport-owning Pi provider is wrapped by pi2dsh as a DSH llm adapter and Pi\'s standard stream helpers expose the exact pre-fetch body through onPayload, so the waterfall is real there. Native DSH adapters build their body behind their own boundary; without an upstream seam this event cannot honestly fire for them.',
  },
  before_provider_headers: {
    level: 'unsupported',
    detail: 'Provider header mutation belongs in a native DSH LLM adapter; the handler is accepted but never fires.',
    design: 'Deliberately not wired, for the same reason as before_provider_request: headers belong to the adapter that owns the transport.',
  },
  after_provider_response: {
    level: 'unsupported',
    detail: 'Provider response interception belongs in a native DSH LLM adapter; the handler is accepted but never fires.',
    design: 'Deliberately not wired: the response is consumed inside the adapter, and interception there is an adapter concern.',
  },
  user_bash: OBSERVED_NEVER_FIRES('Pi\'s ! command surface'),
  input: OBSERVED_NEVER_FIRES('raw Pi terminal input'),
  project_trust: {
    level: 'unsupported',
    detail: 'Project trust must remain owned by the DSH host; the handler is accepted but never consulted.',
    design: 'Accepted and never consulted. Trust is a host decision in DSH, and letting a package answer it would move the decision to the code being trusted.',
  },
  resources_discover: {
    level: 'unsupported',
    detail: 'Dynamic resource discovery must be converted into DSH providers; the handler is accepted but never fires.',
    design: 'Accepted and never fired. Dynamic resource discovery in DSH is a provider registration, which is a different (and official) seam.',
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
