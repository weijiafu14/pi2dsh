// @ts-nocheck — vendored Pi source (MIT, see ./PI-LICENSE); logic unchanged.
// Sources @6f707eb36064e82af9c1320a7634f4dfad21049b:
//   coding-agent src/core/compaction/utils.ts            (file-op tracking, serialization, system prompt)
//   coding-agent src/core/compaction/compaction.ts       (token estimation, cut points, summarization)
//   coding-agent src/core/compaction/branch-summarization.ts (branch summaries)
//   pi-ai 0.84.1 dist/utils/text.js                      (contentText)
// One deliberate seam, marked below: Pi's completeSummarization falls back to the
// provider-SDK completeSimple() when no streamFn is given. In pi2dsh every model
// call goes through the host llm bridge, so the pi2dsh export layer always
// injects a bridge streamFn; reaching the fallback without one fails loud.
import { retryAssistantCall } from './pi-ai-retry.js'
import { uuidv7 } from './pi-uuid.js'
import {
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
  convertToLlm,
} from './pi-messages.js'
import { buildSessionContext, sessionEntryToContextMessages } from './pi-session-manager.js'

// ---- pi-ai utils/text.js ---------------------------------------------------

export function contentText(content, separator = '\n') {
  if (typeof content === 'string') return content
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join(separator)
}

// ---- compaction/utils.ts ---------------------------------------------------

export interface FileOperations {
  read: Set<string>
  written: Set<string>
  edited: Set<string>
}

export function createFileOps(): FileOperations {
  return {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  }
}

/**
 * Extract file operations from tool calls in an assistant message.
 */
export function extractFileOpsFromMessage(message, fileOps: FileOperations): void {
  if (message.role !== 'assistant') return
  if (!('content' in message) || !Array.isArray(message.content)) return

  for (const block of message.content) {
    if (typeof block !== 'object' || block === null) continue
    if (!('type' in block) || block.type !== 'toolCall') continue
    if (!('arguments' in block) || !('name' in block)) continue

    const args = block.arguments
    if (!args) continue

    const path = typeof args.path === 'string' ? args.path : undefined
    if (!path) continue

    switch (block.name) {
      case 'read':
        fileOps.read.add(path)
        break
      case 'write':
        fileOps.written.add(path)
        break
      case 'edit':
        fileOps.edited.add(path)
        break
    }
  }
}

/**
 * Compute final file lists from file operations.
 * Returns readFiles (files only read, not modified) and modifiedFiles.
 */
export function computeFileLists(fileOps: FileOperations): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set([...fileOps.edited, ...fileOps.written])
  const readOnly = [...fileOps.read].filter(f => !modified.has(f)).sort()
  const modifiedFiles = [...modified].sort()
  return { readFiles: readOnly, modifiedFiles }
}

/**
 * Format file operations as XML tags for summary.
 */
export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = []
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join('\n')}\n</read-files>`)
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join('\n')}\n</modified-files>`)
  }
  if (sections.length === 0) return ''
  return `\n\n${sections.join('\n\n')}`
}

/** Maximum characters for a tool result in serialized summaries. */
const TOOL_RESULT_MAX_CHARS = 2000

/**
 * Truncate text to a maximum character length for summarization.
 * Keeps the beginning and appends a truncation marker.
 */
function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const truncatedChars = text.length - maxChars
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`
}

/**
 * Serialize LLM messages to text for summarization.
 * This prevents the model from treating it as a conversation to continue.
 * Call convertToLlm() first to handle custom message types.
 *
 * Tool results are truncated to keep the summarization request within
 * reasonable token budgets. Full content is not needed for summarization.
 */
export function serializeConversation(messages): string {
  const parts: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = contentText(msg.content, '')
      if (content) parts.push(`[User]: ${content}`)
    } else if (msg.role === 'assistant') {
      const thinkingParts: string[] = []
      const toolCalls: string[] = []

      for (const block of msg.content) {
        if (block.type === 'thinking') {
          thinkingParts.push(block.thinking)
        } else if (block.type === 'toolCall') {
          const args = block.arguments
          const argsStr = Object.entries(args)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ')
          toolCalls.push(`${block.name}(${argsStr})`)
        }
      }

      if (thinkingParts.length > 0) {
        parts.push(`[Assistant thinking]: ${thinkingParts.join('\n')}`)
      }
      if (msg.content.some(block => block.type === 'text')) {
        parts.push(`[Assistant]: ${contentText(msg.content)}`)
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join('; ')}`)
      }
    } else if (msg.role === 'toolResult') {
      const content = contentText(msg.content, '')
      if (content) {
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`)
      }
    }
  }

  return parts.join('\n\n')
}

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`

// ---- compaction/compaction.ts ----------------------------------------------

const ESTIMATED_IMAGE_CHARS = 4800

function estimateTextAndImageContentChars(content): number {
  if (typeof content === 'string') {
    return content.length
  }

  let chars = 0
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      chars += block.text.length
    } else if (block.type === 'image') {
      chars += ESTIMATED_IMAGE_CHARS
    }
  }
  return chars
}

/**
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 */
export function estimateTokens(message): number {
  let chars = 0

  switch (message.role) {
    case 'user': {
      chars = estimateTextAndImageContentChars(message.content)
      return Math.ceil(chars / 4)
    }
    case 'assistant': {
      const assistant = message
      for (const block of assistant.content) {
        if (block.type === 'text') {
          chars += block.text.length
        } else if (block.type === 'thinking') {
          chars += block.thinking.length
        } else if (block.type === 'toolCall') {
          chars += block.name.length + JSON.stringify(block.arguments).length
        }
      }
      return Math.ceil(chars / 4)
    }
    case 'custom':
    case 'toolResult': {
      chars = estimateTextAndImageContentChars(message.content)
      return Math.ceil(chars / 4)
    }
    case 'bashExecution': {
      chars = message.command.length + message.output.length
      return Math.ceil(chars / 4)
    }
    case 'branchSummary':
    case 'compactionSummary': {
      chars = message.summary.length
      return Math.ceil(chars / 4)
    }
  }

  return 0
}

function isCutPointMessage(message): boolean {
  switch (message.role) {
    case 'user':
    case 'assistant':
    case 'bashExecution':
    case 'custom':
    case 'branchSummary':
    case 'compactionSummary':
      return true
    case 'toolResult':
      return false
  }
  return false
}

function isTurnStartMessage(message): boolean {
  switch (message.role) {
    case 'user':
    case 'bashExecution':
    case 'custom':
    case 'branchSummary':
    case 'compactionSummary':
      return true
    case 'assistant':
    case 'toolResult':
      return false
  }
  return false
}

function isTurnStartEntry(entry): boolean {
  if (entry.type === 'compaction') {
    return false
  }
  return sessionEntryToContextMessages(entry).some(isTurnStartMessage)
}

/**
 * Find valid cut points: indices of context-visible user-like or assistant messages.
 * Never cut at tool results (they must follow their tool call).
 * When we cut at an assistant message with tool calls, its tool results follow it
 * and will be kept.
 */
function findValidCutPoints(entries, startIndex: number, endIndex: number): number[] {
  const cutPoints: number[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i]
    if (entry.type === 'compaction') {
      continue
    }
    if (sessionEntryToContextMessages(entry).some(isCutPointMessage)) {
      cutPoints.push(i)
    }
  }
  return cutPoints
}

/**
 * Find the context-visible user-role message that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 */
export function findTurnStartIndex(entries, entryIndex: number, startIndex: number): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    if (isTurnStartEntry(entries[i])) {
      return i
    }
  }
  return -1
}

export interface CutPointResult {
  /** Index of first entry to keep */
  firstKeptEntryIndex: number
  /** Index of user message that starts the turn being split, or -1 if not splitting */
  turnStartIndex: number
  /** Whether this cut splits a turn (cut point is not a user message) */
  isSplitTurn: boolean
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 *
 * Algorithm: Walk backwards from newest, accumulating estimated message sizes.
 * Stop when we've accumulated >= keepRecentTokens. Cut at that point.
 *
 * Can cut at user OR assistant messages (never tool results). When cutting at an
 * assistant message with tool calls, its tool results come after and will be kept.
 *
 * Returns CutPointResult with:
 * - firstKeptEntryIndex: the entry index to start keeping from
 * - turnStartIndex: if cutting mid-turn, the user message that started that turn
 * - isSplitTurn: whether we're cutting in the middle of a turn
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 */
export function findCutPoint(
  entries,
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex)

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false }
  }

  // Walk backwards from newest, accumulating estimated message sizes
  let accumulatedTokens = 0
  let cutIndex = cutPoints[0] // Default: keep from first message (not header)

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i]
    const messageTokens = sessionEntryToContextMessages(entry).reduce(
      (sum, message) => sum + estimateTokens(message),
      0,
    )
    if (messageTokens === 0) continue
    accumulatedTokens += messageTokens

    // Check if we've exceeded the budget
    if (accumulatedTokens >= keepRecentTokens) {
      // Find the closest valid cut point at or after this entry
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c]
          break
        }
      }
      break
    }
  }

  // Scan backwards from cutIndex to include adjacent metadata entries that do not affect context.
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1]
    // Stop at compaction boundaries or context-visible entries.
    if (prevEntry.type === 'compaction' || sessionEntryToContextMessages(prevEntry).length > 0) {
      break
    }
    cutIndex--
  }

  // Determine if this is a split turn
  const cutEntry = entries[cutIndex]
  const startsTurn = isTurnStartEntry(cutEntry)
  const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(entries, cutIndex, startIndex)

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !startsTurn && turnStartIndex !== -1,
  }
}

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

function createSummarizationOptions(model, maxTokens, apiKey, headers, env, signal, thinkingLevel) {
  const options = { maxTokens, signal, apiKey, headers, env }
  if (model.reasoning && thinkingLevel && thinkingLevel !== 'off') {
    options.reasoning = thinkingLevel
  }
  return options
}

// pi2dsh seam (see file header): Pi calls the provider-SDK completeSimple() here.
// The pi2dsh export layer always injects a host-llm-bridge streamFn, so this
// fallback is unreachable through the shims; a direct vendored call without a
// streamFn fails loud instead of pretending to reach a provider.
function completeSimple(_model, _context, _options): never {
  throw new Error(
    'pi2dsh: summarization without a streamFn would call a Pi provider SDK directly; '
    + 'model calls run through the DSH llm bridge (the pi2dsh exports inject it automatically)',
  )
}

/**
 * Shared choke point for every compaction/branch-summary summarization call. Wraps the
 * single LLM call in retryAssistantCall so transient stream drops (e.g.
 * `terminated`, socket close) honor the configured retry policy instead of failing
 * the whole compaction on the first attempt. Deterministic errors and aborts return
 * immediately (see retryAssistantCall).
 */
export async function completeSummarization(model, context, options, streamFn, retry, callbacks) {
  // Summaries are standalone requests, so isolate routing and avoid cache writes that cannot be reused.
  const requestOptions = {
    ...options,
    cacheRetention: 'none',
    sessionId: uuidv7(),
  }
  const produce = async () =>
    streamFn
      ? (await streamFn(model, context, requestOptions)).result()
      : completeSimple(model, context, requestOptions)
  return retryAssistantCall(produce, retry, requestOptions.signal, callbacks)
}

export async function generateSummary(
  currentMessages,
  model,
  reserveTokens,
  apiKey,
  headers,
  signal,
  customInstructions,
  previousSummary,
  thinkingLevel,
  streamFn,
  env,
  retry,
  callbacks,
) {
  return (
    await generateSummaryWithUsage(
      currentMessages,
      model,
      reserveTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
      streamFn,
      env,
      retry,
      callbacks,
    )
  ).text
}

/** Generate or update a conversation summary and return its provider usage. */
export async function generateSummaryWithUsage(
  currentMessages,
  model,
  reserveTokens,
  apiKey,
  headers,
  signal,
  customInstructions,
  previousSummary,
  thinkingLevel,
  streamFn,
  env,
  retry,
  callbacks,
) {
  const maxTokens = Math.min(
    Math.floor(0.8 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  )

  // Use update prompt if we have a previous summary, otherwise initial prompt
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`
  }

  // Serialize conversation to text so model doesn't try to continue it
  // Convert to LLM messages first (handles custom types like bashExecution, custom, etc.)
  const llmMessages = convertToLlm(currentMessages)
  const conversationText = serializeConversation(llmMessages)

  // Build the prompt with conversation wrapped in tags
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`
  }
  promptText += basePrompt

  const summarizationMessages = [
    {
      role: 'user',
      content: [{ type: 'text', text: promptText }],
      timestamp: Date.now(),
    },
  ]

  const completionOptions = createSummarizationOptions(model, maxTokens, apiKey, headers, env, signal, thinkingLevel)

  const response = await completeSummarization(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    completionOptions,
    streamFn,
    retry,
    callbacks,
  )

  if (response.stopReason === 'error') {
    throw new Error(`Summarization failed: ${response.errorMessage || 'Unknown error'}`)
  }

  const textContent = contentText(response.content)

  return { text: textContent, usage: response.usage }
}

// ---- compaction/compaction.ts: usage math, preparation, full compaction ----

/** Result from compact() - SessionManager adds uuid/parentUuid when saving */
export interface CompactionResult<T = unknown> {
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  estimatedTokensAfter?: number
  /** Usage from the LLM call(s) that generated this summary, if available */
  usage?
  /** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
  details?: T
}

function combineUsage(first, second) {
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    ...(first.cacheWrite1h !== undefined || second.cacheWrite1h !== undefined
      ? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (second.cacheWrite1h ?? 0) }
      : {}),
    ...(first.reasoning !== undefined || second.reasoning !== undefined
      ? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
      : {}),
    totalTokens: first.totalTokens + second.totalTokens,
    cost: {
      input: first.cost.input + second.cost.input,
      output: first.cost.output + second.cost.output,
      cacheRead: first.cost.cacheRead + second.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      total: first.cost.total + second.cost.total,
    },
  }
}

export interface CompactionSettings {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
}

/**
 * Calculate total context tokens from usage.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite
}

/**
 * Get usage from an assistant message if available.
 * Skips aborted, error, and all-zero usage messages as they don't have valid usage data.
 */
function getAssistantUsage(msg) {
  if (msg.role === 'assistant' && 'usage' in msg) {
    const assistantMsg = msg
    if (
      assistantMsg.stopReason !== 'aborted'
      && assistantMsg.stopReason !== 'error'
      && assistantMsg.usage
      && calculateContextTokens(assistantMsg.usage) > 0
    ) {
      return assistantMsg.usage
    }
  }
  return undefined
}

/**
 * Find the last valid assistant message usage from session entries.
 */
export function getLastAssistantUsage(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type === 'message') {
      const usage = getAssistantUsage(entry.message)
      if (usage) return usage
    }
  }
  return undefined
}

export interface ContextUsageEstimate {
  tokens: number
  usageTokens: number
  trailingTokens: number
  lastUsageIndex: number | null
}

function getLastAssistantUsageInfo(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i])
    if (usage) return { usage, index: i }
  }
  return undefined
}

/**
 * Estimate context tokens from messages, using the last assistant usage when available.
 * If there are messages after the last usage, estimate their tokens with estimateTokens.
 */
export function estimateContextTokens(messages): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages)

  if (!usageInfo) {
    let estimated = 0
    for (const message of messages) {
      estimated += estimateTokens(message)
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    }
  }

  const usageTokens = calculateContextTokens(usageInfo.usage)
  let trailingTokens = 0
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i])
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  }
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  if (!settings.enabled) return false
  return contextTokens > contextWindow - settings.reserveTokens
}

function extractFileOperations(messages, entries, prevCompactionIndex: number): FileOperations {
  const fileOps = createFileOps()

  // Collect from previous compaction's details (if pi-generated)
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex]
    if (!prevCompaction.fromHook && prevCompaction.details) {
      // fromHook field kept for session file compatibility
      const details = prevCompaction.details
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f)
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) fileOps.edited.add(f)
      }
    }
  }

  // Extract from tool calls in messages
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps)
  }

  return fileOps
}

/**
 * Extract AgentMessage from an entry if it produces one.
 * Returns undefined for entries that don't contribute to LLM context.
 */
function getMessageFromEntryForCompaction(entry) {
  if (entry.type === 'compaction') {
    return undefined
  }
  return sessionEntryToContextMessages(entry)[0]
}

export interface CompactionPreparation {
  /** UUID of first entry to keep */
  firstKeptEntryId: string
  /** Messages that will be summarized and discarded */
  messagesToSummarize
  /** Messages that will be turned into turn prefix summary (if splitting) */
  turnPrefixMessages
  /** Whether this is a split turn (cut point in middle of turn) */
  isSplitTurn: boolean
  tokensBefore: number
  /** Summary from previous compaction, for iterative update */
  previousSummary?: string
  /** File operations extracted from messagesToSummarize */
  fileOps: FileOperations
  /** Compaction settions from settings.jsonl	*/
  settings: CompactionSettings
}

export function prepareCompaction(pathEntries, settings: CompactionSettings): CompactionPreparation | undefined {
  if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === 'compaction') {
    return undefined
  }

  let prevCompactionIndex = -1
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === 'compaction') {
      prevCompactionIndex = i
      break
    }
  }

  let previousSummary: string | undefined
  let boundaryStart = 0
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex]
    previousSummary = prevCompaction.summary
    const firstKeptEntryIndex = pathEntries.findIndex(entry => entry.id === prevCompaction.firstKeptEntryId)
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1
  }
  const boundaryEnd = pathEntries.length

  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens

  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens)

  // Get UUID of first kept entry
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex]
  if (!firstKeptEntry?.id) {
    return undefined // Session needs migration
  }
  const firstKeptEntryId = firstKeptEntry.id

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex

  // Messages to summarize (will be discarded after summary)
  const messagesToSummarize = []
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i])
    if (msg) messagesToSummarize.push(msg)
  }

  // Messages for turn prefix summary (if splitting a turn)
  const turnPrefixMessages = []
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i])
      if (msg) turnPrefixMessages.push(msg)
    }
  }

  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) {
    return undefined
  }

  // Extract file operations from messages and previous compaction
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex)

  // Also extract file ops from turn prefix if splitting
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps)
    }
  }

  return {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  }
}

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`

/**
 * Generate summaries for compaction using prepared data.
 * Returns CompactionResult - SessionManager adds uuid/parentUuid when saving.
 */
export async function compact(
  preparation: CompactionPreparation,
  model,
  apiKey,
  headers,
  customInstructions,
  signal,
  thinkingLevel,
  streamFn,
  env,
  retry,
  callbacks,
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  } = preparation

  // Generate summaries and merge into one
  let summary: string
  let summaryUsage

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    let historyText = 'No prior history.'
    let historyUsage
    if (messagesToSummarize.length > 0) {
      const historyResult = await generateSummaryWithUsage(
        messagesToSummarize,
        model,
        settings.reserveTokens,
        apiKey,
        headers,
        signal,
        customInstructions,
        previousSummary,
        thinkingLevel,
        streamFn,
        env,
        retry,
        callbacks,
      )
      historyText = historyResult.text
      historyUsage = historyResult.usage
    }
    const turnPrefixResult = await generateTurnPrefixSummary(
      turnPrefixMessages,
      model,
      settings.reserveTokens,
      apiKey,
      headers,
      env,
      signal,
      thinkingLevel,
      streamFn,
      retry,
      callbacks,
    )
    // Merge into single summary
    summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.text}`
    summaryUsage = historyUsage ? combineUsage(historyUsage, turnPrefixResult.usage) : turnPrefixResult.usage
  } else {
    // Just generate history summary
    const result = await generateSummaryWithUsage(
      messagesToSummarize,
      model,
      settings.reserveTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
      streamFn,
      env,
      retry,
      callbacks,
    )
    summary = result.text
    summaryUsage = result.usage
  }

  // Compute file lists and append to summary
  const { readFiles, modifiedFiles } = computeFileLists(fileOps)
  summary += formatFileOperations(readFiles, modifiedFiles)

  if (!firstKeptEntryId) {
    throw new Error('First kept entry has no UUID - session may need migration')
  }

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    usage: summaryUsage,
    details: { readFiles, modifiedFiles },
  }
}

/**
 * Generate a summary for a turn prefix (when splitting a turn).
 */
async function generateTurnPrefixSummary(
  messages,
  model,
  reserveTokens,
  apiKey,
  headers,
  env,
  signal,
  thinkingLevel,
  streamFn,
  retry,
  callbacks,
) {
  const maxTokens = Math.min(
    Math.floor(0.5 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  ) // Smaller budget for turn prefix
  const llmMessages = convertToLlm(messages)
  const conversationText = serializeConversation(llmMessages)
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`
  const summarizationMessages = [
    {
      role: 'user',
      content: [{ type: 'text', text: promptText }],
      timestamp: Date.now(),
    },
  ]

  const response = await completeSummarization(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    createSummarizationOptions(model, maxTokens, apiKey, headers, env, signal, thinkingLevel),
    streamFn,
    retry,
    callbacks,
  )

  if (response.stopReason === 'error') {
    throw new Error(`Turn prefix summarization failed: ${response.errorMessage || 'Unknown error'}`)
  }

  return {
    text: contentText(response.content),
    usage: response.usage,
  }
}

// ---- compaction/branch-summarization.ts ------------------------------------

export interface BranchSummaryResult {
  summary?: string
  usage?
  readFiles?: string[]
  modifiedFiles?: string[]
  aborted?: boolean
  error?: string
}

/** Details stored in BranchSummaryEntry.details for file tracking */
export interface BranchSummaryDetails {
  readFiles: string[]
  modifiedFiles: string[]
}

export interface BranchPreparation {
  /** Messages extracted for summarization, in chronological order */
  messages
  /** File operations extracted from tool calls */
  fileOps: FileOperations
  /** Total estimated tokens in messages */
  totalTokens: number
}

export interface CollectEntriesResult {
  /** Entries to summarize, in chronological order */
  entries
  /** Common ancestor between old and new position, if any */
  commonAncestorId: string | null
}

export interface GenerateBranchSummaryOptions {
  model
  apiKey?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  signal: AbortSignal
  customInstructions?: string
  replaceInstructions?: boolean
  reserveTokens?: number
  streamFn?
  retry?
  callbacks?
}

/**
 * Collect entries that should be summarized when navigating from one position to another.
 *
 * Walks from oldLeafId back to the common ancestor with targetId, collecting entries
 * along the way. Does NOT stop at compaction boundaries - those are included and their
 * summaries become context.
 */
export function collectEntriesForBranchSummary(session, oldLeafId, targetId): CollectEntriesResult {
  // If no old position, nothing to summarize
  if (!oldLeafId) {
    return { entries: [], commonAncestorId: null }
  }

  // Find common ancestor (deepest node that's on both paths)
  const oldPath = new Set(session.getBranch(oldLeafId).map(e => e.id))
  const targetPath = session.getBranch(targetId)

  // targetPath is root-first, so iterate backwards to find deepest common ancestor
  let commonAncestorId: string | null = null
  for (let i = targetPath.length - 1; i >= 0; i--) {
    if (oldPath.has(targetPath[i].id)) {
      commonAncestorId = targetPath[i].id
      break
    }
  }

  // Collect entries from old leaf back to common ancestor
  const entries = []
  let current = oldLeafId

  while (current && current !== commonAncestorId) {
    const entry = session.getEntry(current)
    if (!entry) break
    entries.push(entry)
    current = entry.parentId
  }

  // Reverse to get chronological order
  entries.reverse()

  return { entries, commonAncestorId }
}

/**
 * Extract AgentMessage from a session entry.
 * Similar to getMessageFromEntry in compaction.ts but also handles compaction entries.
 */
function getMessageFromEntry(entry) {
  switch (entry.type) {
    case 'message':
      // Skip tool results - context is in assistant's tool call
      if (entry.message.role === 'toolResult') return undefined
      return entry.message

    case 'custom_message':
      return createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp)

    case 'branch_summary':
      return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)

    case 'compaction':
      return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)

    // These don't contribute to conversation content
    case 'thinking_level_change':
    case 'model_change':
    case 'custom':
    case 'label':
    case 'session_info':
      return undefined
  }
}

/**
 * Prepare entries for summarization with token budget.
 *
 * Walks entries from NEWEST to OLDEST, adding messages until we hit the token budget.
 * This ensures we keep the most recent context when the branch is too long.
 */
export function prepareBranchEntries(entries, tokenBudget: number = 0): BranchPreparation {
  const messages = []
  const fileOps = createFileOps()
  let totalTokens = 0

  // First pass: collect file ops from ALL entries (even if they don't fit in token budget)
  // This ensures we capture cumulative file tracking from nested branch summaries
  // Only extract from pi-generated summaries (fromHook !== true), not extension-generated ones
  for (const entry of entries) {
    if (entry.type === 'branch_summary' && !entry.fromHook && entry.details) {
      const details = entry.details
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f)
      }
      if (Array.isArray(details.modifiedFiles)) {
        // Modified files go into both edited and written for proper deduplication
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f)
        }
      }
    }
  }

  // Second pass: walk from newest to oldest, adding messages until token budget
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const message = getMessageFromEntry(entry)
    if (!message) continue

    // Extract file ops from assistant messages (tool calls)
    extractFileOpsFromMessage(message, fileOps)

    const tokens = estimateTokens(message)

    // Check budget before adding
    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      // If this is a summary entry, try to fit it anyway as it's important context
      if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        if (totalTokens < tokenBudget * 0.9) {
          messages.unshift(message)
          totalTokens += tokens
        }
      }
      // Stop - we've hit the budget
      break
    }

    messages.unshift(message)
    totalTokens += tokens
  }

  return { messages, fileOps, totalTokens }
}

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

/**
 * Generate a summary of abandoned branch entries.
 */
export async function generateBranchSummary(entries, options: GenerateBranchSummaryOptions): Promise<BranchSummaryResult> {
  const {
    model,
    apiKey,
    headers,
    env,
    signal,
    customInstructions,
    replaceInstructions,
    reserveTokens = 16384,
    streamFn,
    retry,
    callbacks,
  } = options

  // Token budget = context window minus reserved space for prompt + response
  const contextWindow = model.contextWindow || 128000
  const tokenBudget = contextWindow - reserveTokens

  const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget)

  if (messages.length === 0) {
    return { summary: 'No content to summarize' }
  }

  // Transform to LLM-compatible messages, then serialize to text
  // Serialization prevents the model from treating it as a conversation to continue
  const llmMessages = convertToLlm(messages)
  const conversationText = serializeConversation(llmMessages)

  // Build prompt
  let instructions: string
  if (replaceInstructions && customInstructions) {
    instructions = customInstructions
  } else if (customInstructions) {
    instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`
  } else {
    instructions = BRANCH_SUMMARY_PROMPT
  }
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`

  const summarizationMessages = [
    {
      role: 'user',
      content: [{ type: 'text', text: promptText }],
      timestamp: Date.now(),
    },
  ]

  // Call LLM for summarization. Prefer the session stream function so SDK
  // request behavior (timeouts, retries, attribution headers) stays consistent
  // without running through agent state/events. Retried via completeSummarization
  // so transient stream drops reuse the configured retry policy.
  const context = { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages }
  const requestOptions = { apiKey, headers, env, signal, maxTokens: 2048 }
  const response = await completeSummarization(model, context, requestOptions, streamFn, retry, callbacks)

  // Check if aborted or errored
  if (response.stopReason === 'aborted') {
    return { aborted: true }
  }
  if (response.stopReason === 'error') {
    return { error: response.errorMessage || 'Summarization failed' }
  }

  let summary = contentText(response.content)

  // Prepend preamble to provide context about the branch summary
  summary = BRANCH_SUMMARY_PREAMBLE + summary

  // Compute file lists and append to summary
  const { readFiles, modifiedFiles } = computeFileLists(fileOps)
  summary += formatFileOperations(readFiles, modifiedFiles)

  return {
    summary: summary || 'No summary generated',
    usage: response.usage,
    readFiles,
    modifiedFiles,
  }
}
