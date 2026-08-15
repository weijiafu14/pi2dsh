// The bridge's own openai-completions wire client for models.json
// config-only providers, written against Pi's client semantics
// (../pi packages/ai/src/api/openai-completions.ts @ 47f9438) and the
// official `openai` SDK. It exists so the ENGINE's dependency tree stays
// free of packages carrying install scripts (@earendil-works/pi-ai pulls
// @google/genai → protobufjs, whose blocked build script fails
// `dsh plugin add` for a transitive dependency): the one wire protocol
// virtually every custom gateway speaks is served natively; the rarer
// apis lazily use a real pi-ai when the profile has one.
//
// Scope: the config-only gateway surface — messages (text, images as data
// URLs, tool calls/results), tools, maxTokens/temperature, apiKey/baseUrl/
// headers, reasoning-content thinking, streamed tool calls, usage, finish
// mapping, and the two compat switches such gateways actually vary on
// (maxTokensField, supportsUsageInStreaming). Pi-provider-specific layers
// (copilot headers, session affinity, grammar tools, prompt cache) are
// out of scope by design.

import OpenAI from 'openai'
import { AssistantMessageEventStream } from './vendor/pi-ai-event-stream.js'

type UnknownRecord = Record<string, unknown>

interface PiContentBlock { type: string, [key: string]: unknown }

interface LiteCompat {
  maxTokensField?: 'max_completion_tokens' | 'max_tokens'
  supportsUsageInStreaming?: boolean
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as PiContentBlock[])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

function userParts(content: unknown): string | Array<UnknownRecord> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: UnknownRecord[] = []
  for (const block of content as PiContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image' && typeof block.data === 'string') {
      // Pi's ImageContent {data, mimeType} → OpenAI data-URL image part.
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${String(block.mimeType ?? 'image/png')};base64,${block.data}` },
      })
    }
  }
  const allText = parts.every(part => part.type === 'text')
  return allText ? parts.map(part => String(part.text ?? '')).join('') : parts
}

/** Pi request context → OpenAI chat.completions messages (Pi's convertMessages semantics for the gateway surface). */
export function liteConvertMessages(context: UnknownRecord): Array<UnknownRecord> {
  const out: Array<UnknownRecord> = []
  const system = typeof context.systemPrompt === 'string' && context.systemPrompt.length > 0
    ? context.systemPrompt
    : undefined
  if (system !== undefined) out.push({ role: 'system', content: system })
  for (const message of Array.isArray(context.messages) ? context.messages as UnknownRecord[] : []) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: userParts(message.content) })
    } else if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content) ? message.content as PiContentBlock[] : []
      const toolCalls = blocks.filter(block => block.type === 'toolCall')
      const assistant: UnknownRecord = { role: 'assistant', content: textFromContent(message.content) || null }
      if (toolCalls.length > 0) {
        assistant.tool_calls = toolCalls.map(call => ({
          id: String(call.id ?? ''),
          type: 'function',
          function: {
            name: String(call.name ?? ''),
            arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
          },
        }))
      }
      out.push(assistant)
    } else if (message.role === 'toolResult') {
      out.push({
        role: 'tool',
        tool_call_id: String(message.toolCallId ?? ''),
        content: textFromContent(message.content) || '(no output)',
      })
    }
  }
  return out
}

function liteTools(tools: unknown): Array<UnknownRecord> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  return (tools as UnknownRecord[]).map(tool => ({
    type: 'function',
    function: {
      name: String(tool.name ?? ''),
      description: String(tool.description ?? ''),
      parameters: (tool.parameters ?? { type: 'object', properties: {} }) as UnknownRecord,
    },
  }))
}

function mapStopReason(reason: string): 'stop' | 'length' | 'toolUse' {
  if (reason === 'length') return 'length'
  if (reason === 'tool_calls' || reason === 'function_call') return 'toolUse'
  return 'stop'
}

// Pi probes these delta fields for reasoning text, in this order.
const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'reasoning_text'] as const

/**
 * Stream one completion from an OpenAI-compatible gateway as Pi's
 * AssistantMessageEventStream. The public shape matches pi-ai's api
 * modules: (model, context, options) with apiKey/baseUrl/headers riding
 * options, exactly how the provider adapter's synthesized transport calls.
 */
export function stream(
  model: UnknownRecord,
  context: UnknownRecord,
  options: UnknownRecord = {},
): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream() as AssistantMessageEventStream & {
    push(event: UnknownRecord): void
    end?(): void
  }
  const provider = String(model.provider ?? '')
  const modelId = String(model.id ?? '')
  const compat = (model.compat ?? {}) as LiteCompat

  void (async () => {
    const content: PiContentBlock[] = []
    const partial: UnknownRecord = { role: 'assistant', content, provider, model: modelId, api: 'openai-completions' }
    let usage: UnknownRecord | undefined
    let stopReason: 'stop' | 'length' | 'toolUse' | undefined
    events.push({ type: 'start', partial })
    try {
      const client = new OpenAI({
        apiKey: String(options.apiKey ?? 'missing-api-key'),
        baseURL: String(model.baseUrl ?? ''),
        dangerouslyAllowBrowser: true,
        ...(options.headers === undefined ? {} : { defaultHeaders: options.headers as Record<string, string> }),
      })
      const params: UnknownRecord = {
        model: modelId,
        messages: liteConvertMessages(context),
        stream: true,
      }
      if (compat.supportsUsageInStreaming !== false) params.stream_options = { include_usage: true }
      const tools = liteTools(context.tools)
      if (tools !== undefined) params.tools = tools
      if (typeof options.maxTokens === 'number') {
        params[compat.maxTokensField === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens'] = options.maxTokens
      }
      if (typeof options.temperature === 'number') params.temperature = options.temperature

      const response = await client.chat.completions.create(
        params as never,
        options.signal instanceof AbortSignal ? { signal: options.signal } : undefined,
      ) as unknown as AsyncIterable<UnknownRecord>

      // Streaming block state: at most one open text block, one open
      // thinking block, and one open tool call at a time (OpenAI deltas
      // arrive per tool-call index; text/reasoning interleave by field).
      let textIndex = -1
      let thinkingIndex = -1
      const toolIndexByPosition = new Map<number, number>()
      const closeText = (): void => {
        if (textIndex === -1) return
        events.push({ type: 'text_end', contentIndex: textIndex, content: String(content[textIndex]?.text ?? ''), partial })
        textIndex = -1
      }
      const closeThinking = (): void => {
        if (thinkingIndex === -1) return
        events.push({ type: 'thinking_end', contentIndex: thinkingIndex, content: String(content[thinkingIndex]?.thinking ?? ''), partial })
        thinkingIndex = -1
      }

      for await (const chunk of response) {
        const chunkUsage = chunk.usage as UnknownRecord | undefined
        if (chunkUsage !== undefined && chunkUsage !== null) {
          const input = Number(chunkUsage.prompt_tokens ?? 0)
          const output = Number(chunkUsage.completion_tokens ?? 0)
          usage = {
            input, output, cacheRead: 0, cacheWrite: 0,
            totalTokens: Number(chunkUsage.total_tokens ?? input + output),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          }
        }
        const choice = (Array.isArray(chunk.choices) ? chunk.choices[0] : undefined) as UnknownRecord | undefined
        if (choice === undefined) continue
        const delta = (choice.delta ?? {}) as UnknownRecord

        for (const field of REASONING_FIELDS) {
          const value = delta[field]
          if (typeof value === 'string' && value.length > 0) {
            closeText()
            if (thinkingIndex === -1) {
              thinkingIndex = content.length
              content[thinkingIndex] = { type: 'thinking', thinking: '' }
              events.push({ type: 'thinking_start', contentIndex: thinkingIndex, partial })
            }
            const block = content[thinkingIndex] as PiContentBlock
            block.thinking = String(block.thinking ?? '') + value
            events.push({ type: 'thinking_delta', contentIndex: thinkingIndex, delta: value, partial })
          }
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          closeThinking()
          if (textIndex === -1) {
            textIndex = content.length
            content[textIndex] = { type: 'text', text: '' }
            events.push({ type: 'text_start', contentIndex: textIndex, partial })
          }
          const block = content[textIndex] as PiContentBlock
          block.text = String(block.text ?? '') + delta.content
          events.push({ type: 'text_delta', contentIndex: textIndex, delta: delta.content, partial })
        }

        if (Array.isArray(delta.tool_calls)) {
          closeText()
          closeThinking()
          for (const call of delta.tool_calls as UnknownRecord[]) {
            const position = Number(call.index ?? 0)
            let index = toolIndexByPosition.get(position)
            if (index === undefined) {
              index = content.length
              toolIndexByPosition.set(position, index)
              content[index] = { type: 'toolCall', id: '', name: '', arguments: undefined, partialJson: '' }
              events.push({ type: 'toolcall_start', contentIndex: index, partial })
            }
            const block = content[index] as PiContentBlock
            if (typeof call.id === 'string' && call.id.length > 0) block.id = call.id
            const fn = call.function as UnknownRecord | undefined
            if (typeof fn?.name === 'string' && fn.name.length > 0) block.name = String(block.name ?? '') + fn.name
            if (typeof fn?.arguments === 'string' && fn.arguments.length > 0) {
              block.partialJson = String(block.partialJson ?? '') + fn.arguments
              events.push({ type: 'toolcall_delta', contentIndex: index, delta: fn.arguments, partial })
            }
          }
        }

        if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
          stopReason = mapStopReason(choice.finish_reason)
        }
      }

      closeText()
      closeThinking()
      for (const index of toolIndexByPosition.values()) {
        const block = content[index] as PiContentBlock
        let parsed: unknown
        try { parsed = JSON.parse(String(block.partialJson ?? '') || '{}') } catch { parsed = {} }
        content[index] = { type: 'toolCall', id: String(block.id ?? ''), name: String(block.name ?? ''), arguments: parsed }
        events.push({ type: 'toolcall_end', contentIndex: index, toolCall: content[index], partial })
      }
      if (stopReason === undefined) throw new Error('stream ended without finish_reason')
      const message: UnknownRecord = {
        role: 'assistant',
        content: content.filter(block => block !== undefined),
        provider, model: modelId, api: 'openai-completions',
        ...(usage === undefined ? {} : { usage }),
        stopReason,
        timestamp: Date.now(),
      }
      events.push({ type: 'done', reason: stopReason, message })
    } catch (error) {
      const aborted = options.signal instanceof AbortSignal && options.signal.aborted
      events.push({
        type: 'error',
        reason: aborted ? 'aborted' : 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        partial,
      })
    }
  })()

  return events
}

/** Pi's streamSimple for this api is the same call surface on the gateway slice. */
export const streamSimple = stream
