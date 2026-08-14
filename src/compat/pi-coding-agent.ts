// Headless @earendil-works/pi-coding-agent compatibility surface.
//
// Three tiers, all package-agnostic:
//   1. Vendored Pi source (SessionManager, message transforms, truncation,
//      file-mutation queue) — byte-level Pi semantics, see ./vendor/PI-LICENSE.
//   2. Headless reimplementations (Theme, settings, shell/clipboard/image
//      helpers) — same signatures, no terminal or Pi-global state.
//   3. Explicit-failure stubs (AgentSession runtime, resource loaders) —
//      importable and constructible so packages load, but running them
//      requires a native DSH port and fails with a clear message instead of
//      silently faking success.

export {
  SessionManager,
  CURRENT_SESSION_VERSION,
  parseSessionEntries,
  migrateSessionEntries,
  getLatestCompactionEntry,
  sessionEntryToContextMessages,
  buildContextEntries,
  buildSessionContext,
  loadEntriesFromFile,
  findMostRecentSession,
  getDefaultSessionDir,
  assertValidSessionId,
} from './vendor/pi-session-manager.js'
export type {
  SessionEntry,
  SessionHeader,
  SessionTreeNode,
  SessionContext,
  SessionInfo,
  SessionMessageEntry,
  CompactionEntry,
  BranchSummaryEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  SessionInfoEntry,
  ThinkingLevelChangeEntry,
  ModelChangeEntry,
} from './vendor/pi-session-manager.js'
export {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
  bashExecutionToText,
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  BRANCH_SUMMARY_PREFIX,
  BRANCH_SUMMARY_SUFFIX,
} from './vendor/pi-messages.js'
export type {
  BashExecutionMessage,
  CustomMessage,
  BranchSummaryMessage,
  CompactionSummaryMessage,
} from './vendor/pi-messages.js'
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateLine,
  truncateTail,
} from './vendor/pi-truncate.js'
export type { TruncationOptions, TruncationResult } from './vendor/pi-truncate.js'
export { withFileMutationQueue } from './vendor/pi-file-mutation-queue.js'
export { getAgentDir } from './vendor/pi-config-shim.js'
// Pi's built-in tool constructors, vendored byte-identical (spawn semantics,
// output accumulation, truncation, kill-tree, mutation queue, diff rendering)
// — the constructor surface packages like pi-landstrip and pi-fabric build
// their own sandboxed/filtered variants on.
export {
  createBashTool,
  createBashToolDefinition,
  createLocalBashOperations,
  bashToolSystemPromptContribution,
} from './vendor/pi-tools/bash.js'
export { createReadTool, createReadToolDefinition } from './vendor/pi-tools/read.js'
export { createEditTool, createEditToolDefinition } from './vendor/pi-tools/edit.js'
export { createWriteTool, createWriteToolDefinition } from './vendor/pi-tools/write.js'
export { createGrepTool, createGrepToolDefinition } from './vendor/pi-tools/grep.js'
export { createFindTool, createFindToolDefinition } from './vendor/pi-tools/find.js'
export { createLsTool, createLsToolDefinition } from './vendor/pi-tools/ls.js'

// Pi's one-line tool-event guards (core/extensions/types.js), verbatim.
interface ToolNamedEvent { toolName?: unknown }
export function isToolCallEventType(toolName: string, event: ToolNamedEvent): boolean {
  return event.toolName === toolName
}
export function isBashToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'bash' }
export function isReadToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'read' }
export function isEditToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'edit' }
export function isWriteToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'write' }
export function isGrepToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'grep' }
export function isFindToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'find' }
export function isLsToolResult(event: ToolNamedEvent): boolean { return event.toolName === 'ls' }

import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createBashTool } from './vendor/pi-tools/bash.js'
import { createReadTool } from './vendor/pi-tools/read.js'
import { createEditTool } from './vendor/pi-tools/edit.js'
import { createWriteTool } from './vendor/pi-tools/write.js'
import { createGrepTool } from './vendor/pi-tools/grep.js'
import { createFindTool } from './vendor/pi-tools/find.js'
import { createLsTool } from './vendor/pi-tools/ls.js'
import { execFile } from 'node:child_process'
import type { AgentMessage } from './vendor/pi-types.js'
import type { Component, SettingsListTheme, SelectListTheme } from './pi-tui.js'
import { visibleWidth, truncateToWidth } from './vendor/pi-tui-utils.js'
import { getAgentDir as agentDirOf } from './vendor/pi-config-shim.js'

export const CONFIG_DIR_NAME = '.pi'
export const VERSION = 'pi2dsh-compat'

export function defineTool<T>(tool: T): T {
  return tool
}

function unsupportedRuntime(name: string): never {
  throw new Error(
    `pi2dsh: ${name} belongs to Pi's internal agent runtime and has no verified DSH mapping; `
    + 'use the DSH-native service instead (see the pi2dsh compatibility report)',
  )
}

// ---------------------------------------------------------------------------
// Theme system (headless)
// ---------------------------------------------------------------------------

const identity = (text: string): string => text

export type ThemeColor = string
export type ThemeBg = string
export type ColorMode = 'truecolor' | '256' | '16' | 'none'

export class Theme {
  constructor(public name = 'pi2dsh-headless') {}
  fg(_color: ThemeColor, text: string): string {
    return text
  }
  bg(_color: ThemeBg, text: string): string {
    return text
  }
  bold(text: string): string {
    return text
  }
  italic(text: string): string {
    return text
  }
  underline(text: string): string {
    return text
  }
  inverse(text: string): string {
    return text
  }
  strikethrough(text: string): string {
    return text
  }
  getFgAnsi(_color: ThemeColor): string {
    return ''
  }
  getBgAnsi(_color: ThemeBg): string {
    return ''
  }
  getColorMode(): ColorMode {
    return 'none'
  }
  getThinkingBorderColor(_level: unknown): (str: string) => string {
    return identity
  }
  getBashModeBorderColor(): (str: string) => string {
    return identity
  }
}

export const theme = new Theme()

export function initTheme(_themeName?: string, _enableWatcher = false): void {}

export function getSettingsListTheme(): SettingsListTheme {
  return {
    label: (text: string, _selected: boolean) => text,
    value: (text: string, _selected: boolean) => text,
    description: (text: string) => text,
    cursor: '→ ',
    hint: (text: string) => text,
  }
}

export function getSelectListTheme(): SelectListTheme {
  return {
    selectedPrefix: '→ ',
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  }
}

export function getMarkdownTheme(): Record<string, unknown> {
  return {
    heading: identity, link: identity, linkUrl: identity, code: identity, codeBlock: identity,
    codeBlockBorder: identity, quote: identity, quoteBorder: identity, hr: identity,
    listBullet: identity, bold: identity, italic: identity, underline: identity,
    strikethrough: identity, highlightCode: (code: string) => code.split('\n'),
  }
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python', '.rb': 'ruby', '.go': 'go',
  '.rs': 'rust', '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.md': 'markdown', '.html': 'xml',
  '.xml': 'xml', '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.php': 'php',
  '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala', '.lua': 'lua', '.r': 'r',
}

export function getLanguageFromPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return undefined
  return LANGUAGE_BY_EXTENSION[filePath.slice(dot).toLowerCase()]
}

export function highlightCode(code: string, _lang?: string): string[] {
  return code.split('\n')
}

export class DynamicBorder implements Component {
  constructor(private color: (str: string) => string = identity) {}
  render(width: number): string[] {
    return [this.color('─'.repeat(Math.max(1, width)))]
  }
  invalidate(): void {}
}

// ---------------------------------------------------------------------------
// Message / compaction helpers
// ---------------------------------------------------------------------------

function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (typeof record.text === 'string') chars += record.text.length
    else if (typeof record.thinking === 'string') chars += record.thinking.length
    else if (record.type === 'image') chars += 1600
    else if (record.arguments !== undefined) chars += JSON.stringify(record.arguments ?? {}).length
  }
  return chars
}

// chars/4 heuristic, matching Pi's estimateTokens semantics.
export function estimateTokens(message: AgentMessage): number {
  const record = message as Record<string, unknown>
  let chars = contentChars(record.content)
  if (typeof record.summary === 'string') chars += (record.summary as string).length
  if (record.role === 'bashExecution') {
    chars += String(record.command ?? '').length + String(record.output ?? '').length
  }
  return Math.ceil(chars / 4)
}

export function calculateContextTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0)
}

export const DEFAULT_COMPACTION_SETTINGS = Object.freeze({
  enabled: true,
  reserveTokens: 30_000,
  keepRecentTokens: 20_000,
})

export function shouldCompact(..._args: unknown[]): boolean {
  return false
}

export function compact(..._args: unknown[]): never {
  return unsupportedRuntime('compact()')
}

export function findCutPoint(..._args: unknown[]): never {
  return unsupportedRuntime('findCutPoint()')
}

export function generateSummary(..._args: unknown[]): never {
  return unsupportedRuntime('generateSummary()')
}

export function generateSummaryWithUsage(..._args: unknown[]): never {
  return unsupportedRuntime('generateSummaryWithUsage()')
}

export function generateBranchSummary(..._args: unknown[]): never {
  return unsupportedRuntime('generateBranchSummary()')
}

export function serializeConversation(messages: AgentMessage[]): string {
  return JSON.stringify(messages)
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export function parseFrontmatter(text: string): { attributes: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n?/gu, '\n')
  if (!normalized.startsWith('---')) return { attributes: {}, body: normalized }
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return { attributes: {}, body: normalized }
  const attributes: Record<string, string> = {}
  for (const line of normalized.slice(4, endIndex).split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key.length > 0) attributes[key] = value
  }
  return { attributes, body: normalized.slice(endIndex + 4).replace(/^\n/u, '') }
}

export function stripFrontmatter(text: string): string {
  return parseFrontmatter(text).body
}

// ---------------------------------------------------------------------------
// Clipboard / image / shell helpers
// ---------------------------------------------------------------------------

export async function copyToClipboard(text: string): Promise<boolean> {
  const attempt = (command: string, args: string[]): Promise<boolean> =>
    new Promise(resolve => {
      const child = execFile(command, args, error => resolve(error === null))
      child.stdin?.write(text)
      child.stdin?.end()
    })
  if (process.platform === 'darwin') return attempt('pbcopy', [])
  if (process.platform === 'win32') return attempt('clip', [])
  if (await attempt('wl-copy', [])) return true
  return attempt('xclip', ['-selection', 'clipboard'])
}

export interface ImageResizeOptions {
  maxWidth?: number
  maxHeight?: number
  [key: string]: unknown
}

export interface ResizedImage {
  data: string
  mimeType: string
  width?: number
  height?: number
  [key: string]: unknown
}

// Headless degradation: images pass through un-resized. Pi resizes only to
// save tokens, so returning the original preserves correctness.
export async function resizeImage(
  data: string,
  mimeType: string,
  _options: ImageResizeOptions = {},
): Promise<ResizedImage> {
  return { data, mimeType }
}

export async function convertToPng(data: string, mimeType: string): Promise<ResizedImage> {
  if (mimeType === 'image/png') return { data, mimeType }
  return unsupportedRuntime('convertToPng() for non-PNG input')
}

export interface ShellConfig {
  shell: string
  args: string[]
}

export function getShellConfig(): ShellConfig {
  if (process.platform === 'win32') {
    return { shell: process.env.COMSPEC ?? 'cmd.exe', args: ['/d', '/s', '/c'] }
  }
  const preferred = process.env.SHELL
  if (preferred !== undefined && preferred.length > 0 && existsSync(preferred)) {
    return { shell: preferred, args: ['-c'] }
  }
  for (const candidate of ['/bin/bash', '/bin/zsh', '/bin/sh']) {
    if (existsSync(candidate)) return { shell: candidate, args: ['-c'] }
  }
  return { shell: 'sh', args: ['-c'] }
}

// Pi's install-directory locator: PI_PACKAGE_DIR override, else a stable
// bridge-owned location (Pi itself falls back to its executable's directory,
// which has no meaningful equivalent inside DSH).
export function getPackageDir(): string {
  const override = process.env.PI_PACKAGE_DIR
  if (override !== undefined && override.length > 0) return override
  return join(agentDirOf(), 'package')
}

export interface StoredCredential {
  type?: string
  [key: string]: unknown
}

// Pi's one-off synchronous auth.json read, against the pi2dsh-owned agent
// directory. DSH credentials stay authoritative for DSH model calls; this
// serves packages that manage their own provider credentials Pi-style.
export function readStoredCredential(
  providerId: string,
  authPath: string = join(agentDirOf(), 'auth.json'),
): StoredCredential | undefined {
  try {
    const data = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, StoredCredential>
    return data[providerId]
  } catch {
    return undefined
  }
}

export interface ParsedSkillBlock {
  name: string
  content: string
  [key: string]: unknown
}

// Pi's <skill_content name="..."> block parser, reimplemented over the same
// wire shape.
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = /<skill_content\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/skill_content>/u.exec(text)
  if (match === null) return null
  return { name: match[1]!, content: match[2]!.trim() }
}

export function wrapRegisteredTool(..._args: unknown[]): never {
  return unsupportedRuntime('wrapRegisteredTool()')
}

export function getBinDir(): string {
  const parts = (process.env.PATH ?? '').split(delimiter)
  return parts[0] ?? join(homedir(), '.local', 'bin')
}

// ---------------------------------------------------------------------------
// Settings (in-memory, layered global/project like Pi)
// ---------------------------------------------------------------------------

type SettingsRecord = Record<string, unknown>

export interface SettingsManagerCreateOptions {
  [key: string]: unknown
}

export interface RetrySettings {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
}

export interface CompactionSettings {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

export type DefaultProjectTrust = 'ask' | 'always' | 'never'
export type TuiMode = 'regular' | 'fullscreen'
export type PackageSource = string | Record<string, unknown>

export class SettingsManager {
  private constructor(
    private globalSettings: SettingsRecord,
    private projectSettings: SettingsRecord,
  ) {}

  static create(_cwd?: string, _agentDir?: string, options: SettingsManagerCreateOptions = {}): SettingsManager {
    return SettingsManager.inMemory({}, options)
  }

  static fromStorage(_storage: unknown, options: SettingsManagerCreateOptions = {}): SettingsManager {
    return SettingsManager.inMemory({}, options)
  }

  static inMemory(settings: SettingsRecord = {}, _options: SettingsManagerCreateOptions = {}): SettingsManager {
    return new SettingsManager({ ...settings }, {})
  }

  private get merged(): SettingsRecord {
    return { ...this.globalSettings, ...this.projectSettings }
  }

  private read<T>(key: string, fallback: T): T {
    const value = this.merged[key]
    return value === undefined ? fallback : value as T
  }

  async reload(): Promise<void> {}
  async flush(): Promise<void> {}
  drainErrors(): unknown[] {
    return []
  }
  applyOverrides(overrides: SettingsRecord): void {
    Object.assign(this.globalSettings, overrides)
  }
  getGlobalSettings(): SettingsRecord {
    return { ...this.globalSettings }
  }
  getProjectSettings(): SettingsRecord {
    return { ...this.projectSettings }
  }
  isProjectTrusted(): boolean {
    return this.read('projectTrusted', false)
  }
  setProjectTrusted(trusted: boolean): void {
    this.projectSettings.projectTrusted = trusted
  }
  getDefaultProjectTrust(): DefaultProjectTrust {
    return this.read('defaultProjectTrust', 'ask')
  }
  getDefaultProvider(): string | undefined {
    return this.read('defaultProvider', undefined)
  }
  getDefaultModel(): string | undefined {
    return this.read('defaultModel', undefined)
  }
  setDefaultProvider(provider: string): void {
    this.globalSettings.defaultProvider = provider
  }
  setDefaultModel(model: string): void {
    this.globalSettings.defaultModel = model
  }
  setDefaultModelAndProvider(model: string, provider: string): void {
    this.setDefaultModel(model)
    this.setDefaultProvider(provider)
  }
  getDefaultThinkingLevel(): string | undefined {
    return this.read('defaultThinkingLevel', undefined)
  }
  getThemeSetting(): string | undefined {
    return this.read('theme', undefined)
  }
  getTheme(): string | undefined {
    return this.getThemeSetting()
  }
  setTheme(themeName: string): void {
    this.globalSettings.theme = themeName
  }
  getCompactionSettings(): CompactionSettings {
    return this.read('compaction', { ...DEFAULT_COMPACTION_SETTINGS })
  }
  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
    return this.read('branchSummary', { reserveTokens: 8000, skipPrompt: false })
  }
  getRetrySettings(): RetrySettings {
    return this.read('retry', { enabled: true, maxRetries: 3, baseDelayMs: 1000 })
  }
  getProviderRetrySettings(): RetrySettings {
    return this.getRetrySettings()
  }
  getHttpIdleTimeoutMs(): number {
    return this.read('httpIdleTimeoutMs', 120_000)
  }
  getWebSocketConnectTimeoutMs(): number {
    return this.read('webSocketConnectTimeoutMs', 30_000)
  }
  getPackages(): PackageSource[] {
    return this.read('packages', [])
  }
  getExtensionPaths(): string[] {
    return this.read('extensions', [])
  }
  getSkillPaths(): string[] {
    return this.read('skills', [])
  }
  getPromptTemplatePaths(): string[] {
    return this.read('prompts', [])
  }
  getThemePaths(): string[] {
    return this.read('themes', [])
  }
  getTuiMode(): TuiMode {
    return this.read('tuiMode', 'regular')
  }
  getShowImages(): boolean {
    return this.read('showImages', false)
  }
  getImageWidthCells(): number {
    return this.read('imageWidthCells', 40)
  }
  getClearOnShrink(): boolean {
    return this.read('clearOnShrink', false)
  }
  getShowTerminalProgress(): boolean {
    return this.read('showTerminalProgress', false)
  }
  getHideThinkingBlock(): boolean {
    return this.read('hideThinkingBlock', false)
  }
  getExternalEditorCommand(): string | undefined {
    return this.read('externalEditorCommand', undefined)
  }
  getSteeringMode(): 'all' | 'one-at-a-time' {
    return this.read('steeringMode', 'all')
  }
  getFollowUpMode(): string {
    return this.read('followUpMode', 'queue')
  }
  getShellPath(): string | undefined {
    return this.read('shellPath', undefined)
  }
  getShellCommandPrefix(): string | undefined {
    return this.read('shellCommandPrefix', undefined)
  }
  getNpmCommand(): string[] | undefined {
    return this.read('npmCommand', undefined)
  }
  getEnableSkillCommands(): boolean {
    return this.read('enableSkillCommands', true)
  }
  getEnableAnalytics(): boolean {
    return false
  }
  getTrackingId(): string | undefined {
    return undefined
  }
}

export class InMemorySettingsStorage {
  constructor(public settings: SettingsRecord = {}) {}
  async withLock<T>(_scope: string, fn: () => Promise<T> | T): Promise<T> {
    return fn()
  }
}

export class FileSettingsStorage extends InMemorySettingsStorage {}

// ---------------------------------------------------------------------------
// Explicit-failure stubs for Pi's internal agent runtime
// ---------------------------------------------------------------------------

function runtimeStubClass(name: string): new (...args: unknown[]) => never {
  return class {
    constructor() {
      return unsupportedRuntime(`new ${name}()`)
    }
  } as never
}

export const ProjectTrustStore = runtimeStubClass('ProjectTrustStore')

// Pi's resource loader, headless: subagent packages construct one to control
// a child session's resources (extensions/skills off, a system-prompt
// override on). In the pi2dsh host the child shares the DSH composition's
// registrations, so the loader carries the overrides and empty resource sets
// — the exact result Pi produces under noExtensions/noSkills/noThemes.
export class DefaultResourceLoader {
  readonly #options: SettingsRecord

  constructor(options: SettingsRecord = {}) {
    this.#options = options
  }

  getExtensions(): { extensions: unknown[], errors: unknown[] } {
    const base = { extensions: [], errors: [] }
    const override = this.#options.extensionsOverride
    return typeof override === 'function' ? (override as (b: unknown) => never)(base) : base
  }

  getSkills(): { skills: unknown[], diagnostics: unknown[] } {
    return { skills: [], diagnostics: [] }
  }

  getPrompts(): { prompts: unknown[], diagnostics: unknown[] } {
    return { prompts: [], diagnostics: [] }
  }

  getThemes(): { themes: unknown[], diagnostics: unknown[] } {
    return { themes: [], diagnostics: [] }
  }

  getAgentsFiles(): { files: unknown[], diagnostics: unknown[] } {
    return { files: [], diagnostics: [] }
  }

  getSystemPrompt(): string | undefined {
    const override = this.#options.systemPromptOverride
    return typeof override === 'function' ? (override as (b: undefined) => string | undefined)(undefined) : undefined
  }

  getSystemPromptSource(): { kind: string } {
    return { kind: 'default' }
  }

  getAppendSystemPrompt(): string[] {
    const override = this.#options.appendSystemPromptOverride
    return typeof override === 'function' ? (override as (b: string[]) => string[])([]) : []
  }

  getAppendSystemPromptSources(): unknown[] {
    return []
  }

  extendResources(_paths: unknown): void {}

  async reload(_options?: unknown): Promise<void> {}
}

export const DefaultPackageManager = runtimeStubClass('DefaultPackageManager')
export const ModelRuntime = runtimeStubClass('ModelRuntime')

export class ModelRegistry {
  private models = new Map<string, unknown>()
  register(id: string, model: unknown): void {
    this.models.set(id, model)
  }
  get(id: string): unknown {
    return this.models.get(id)
  }
  list(): unknown[] {
    return [...this.models.values()]
  }
}

export interface RegisteredToolRecord {
  definition: unknown
  sourceInfo: { path: string, source?: string, scope?: string, origin?: string }
}

// Pi's runner class, reduced to the surface tool-catalog packages actually
// hook: pi-fabric patches `prototype.getAllRegisteredTools` to observe and
// filter every registered tool. The pi2dsh runtime constructs one instance
// whose provider yields the live Pi tool registrations (original definition
// object references, so symbol-anchored detection works), and routes its own
// tool enumeration through it — a patched prototype really filters the
// catalog, exactly as under Pi.
export class ExtensionRunner {
  #provider: () => RegisteredToolRecord[]

  constructor(provider?: () => RegisteredToolRecord[]) {
    this.#provider = provider ?? (() => [])
  }

  getAllRegisteredTools(): RegisteredToolRecord[] {
    return this.#provider()
  }
}

// The mounted pi2dsh runtime installs the real factory: createAgentSession
// builds a genuine DSH child agent through ctx.agents (the host loop's
// factory) with Pi's public AgentSession surface bridged over it. Outside a
// mounted runtime the call keeps its explicit failure.
type SubagentSessionFactory = (options: Record<string, unknown>) => Promise<{ session: unknown }>
let subagentSessionFactory: SubagentSessionFactory | undefined

export function __setSubagentSessionFactory(factory: SubagentSessionFactory | undefined): void {
  subagentSessionFactory = factory
}

export async function createAgentSession(options: Record<string, unknown> = {}): Promise<{ session: unknown }> {
  if (subagentSessionFactory === undefined) {
    return unsupportedRuntime('createAgentSession() outside a mounted pi2dsh runtime')
  }
  return subagentSessionFactory(options)
}

// Byte-identical to Pi's own composition of its built-in tool constructors
// (core/tools/index.js): coding = read+bash+edit+write, read-only =
// read+grep+find+ls.
export function createCodingTools(cwd: string, options?: Record<string, { [key: string]: unknown } | undefined>): unknown[] {
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write),
  ]
}

export function createReadOnlyTools(cwd: string, options?: Record<string, { [key: string]: unknown } | undefined>): unknown[] {
  return [
    createReadTool(cwd, options?.read),
    createGrepTool(cwd, options?.grep),
    createFindTool(cwd, options?.find),
    createLsTool(cwd, options?.ls),
  ]
}

export function loadSkills(..._args: unknown[]): never {
  return unsupportedRuntime('loadSkills()')
}

// ---------------------------------------------------------------------------
// Headless host services backing the vendored built-in tools. Each mirrors a
// documented Pi behavior for environments without the full interactive host:
// ensureTool matches Pi's own offline mode (find on PATH, never download);
// highlightCode matches Pi's no-language branch (plain lines — the headless
// theme applies no styling anyway); processImage passes supported formats
// through un-resized (Pi's resize/convert path runs a WASM codec that has no
// place in a headless bridge; oversized or exotic images degrade with Pi's
// own omission message).
// ---------------------------------------------------------------------------

export function getReadmePath(): string {
  return join(getPackageDir(), 'README.md')
}

const MANAGED_HOST_TOOLS = new Set(['rg', 'fd'])

export function getToolPath(tool: string): string | undefined {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  for (const dir of (process.env[pathKey] ?? '').split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = join(dir, process.platform === 'win32' ? `${tool}.exe` : tool)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export async function ensureTool(tool: string, _silent = false): Promise<string | undefined> {
  const existing = getToolPath(tool)
  if (existing !== undefined) return existing
  // Pi's offline mode semantics: a managed tool that is not on PATH is
  // reported unavailable instead of downloaded.
  return MANAGED_HOST_TOOLS.has(tool) ? undefined : undefined
}

const INLINE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export async function processImage(
  bytes: Uint8Array,
  mimeType: string,
  _options?: { autoResizeImages?: boolean },
): Promise<
  | { ok: true, data: string, mimeType: string, hints: string[] }
  | { ok: false, message: string }
> {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!INLINE_IMAGE_MIME_TYPES.has(base)) {
    return { ok: false, message: '[Image omitted: could not be converted to a supported inline image format.]' }
  }
  return {
    ok: true,
    data: Buffer.from(bytes).toString('base64'),
    mimeType: base,
    hints: ['[Image passed through unresized by pi2dsh.]'],
  }
}


export function loadSkillsFromDir(..._args: unknown[]): never {
  return unsupportedRuntime('loadSkillsFromDir()')
}

export { formatSkillsForPrompt } from './vendor/pi-skills-format.js'

export function createEventBus(): {
  emit(channel: string, data: unknown): void
  on(channel: string, handler: (data: unknown) => void): () => void
  clear(): void
} {
  const handlers = new Map<string, Set<(data: unknown) => void>>()
  return {
    emit(channel, data) {
      for (const handler of handlers.get(channel) ?? []) {
        Promise.resolve().then(() => handler(data)).catch(error => console.error(error))
      }
    },
    on(channel, handler) {
      const set = handlers.get(channel) ?? new Set()
      set.add(handler)
      handlers.set(channel, set)
      return () => {
        set.delete(handler)
      }
    },
    clear() {
      handlers.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Interactive-mode UI components (headless)
// ---------------------------------------------------------------------------

class HeadlessComponent implements Component {
  render(_width: number): string[] {
    return []
  }
  invalidate(): void {}
}

export class ToolExecutionComponent extends HeadlessComponent {}
export class FooterComponent extends HeadlessComponent {}
export class BorderedLoader extends HeadlessComponent {
  start(): void {}
  stop(): void {}
  dispose(): void {}
}
export class CustomMessageComponent extends HeadlessComponent {}
export class AssistantMessageComponent extends HeadlessComponent {}
export class UserMessageComponent extends HeadlessComponent {}
export class ExtensionSelectorComponent extends HeadlessComponent {}
export class ExtensionInputComponent extends HeadlessComponent {}
export class ExtensionEditorComponent extends HeadlessComponent {}
export class SettingsSelectorComponent extends HeadlessComponent {}

export class CustomEditor extends HeadlessComponent {
  private text = ''
  onSubmit?: (text: string) => void
  onChange?: (text: string) => void
  getText(): string {
    return this.text
  }
  setText(text: string): void {
    this.text = text
    this.onChange?.(text)
  }
  handleInput(data: string): void {
    if (data === '\r' || data === '\n') {
      this.onSubmit?.(this.text)
      return
    }
    if (data >= ' ') this.setText(this.text + data)
  }
}

export interface ToolExecutionOptions {
  [key: string]: unknown
}
export interface SettingsConfig {
  [key: string]: unknown
}
export interface SettingsCallbacks {
  [key: string]: unknown
}
export interface RenderDiffOptions {
  [key: string]: unknown
}

export function renderDiff(oldText: string, newText: string, _options: RenderDiffOptions = {}): string[] {
  const removed = oldText.split('\n').map(line => `- ${line}`)
  const added = newText.split('\n').map(line => `+ ${line}`)
  return [...removed, ...added]
}

export interface VisualTruncateResult {
  visualLines: string[]
  skippedCount: number
}

export function truncateToVisualLines(
  text: string,
  maxVisualLines: number,
  width: number,
  paddingX = 0,
): VisualTruncateResult {
  const inner = Math.max(1, width - paddingX * 2)
  const lines = text.split('\n').map(line =>
    visibleWidth(line) > inner ? truncateToWidth(line, inner) : line)
  return {
    visualLines: lines.slice(0, Math.max(0, maxVisualLines)),
    skippedCount: Math.max(0, lines.length - maxVisualLines),
  }
}

export function keyHint(keybinding: string, description: string): string {
  return `${keybinding} ${description}`
}

export function keyText(keybinding: string): string {
  return keybinding
}

export function rawKeyHint(key: string, description: string): string {
  return `${key} ${description}`
}
