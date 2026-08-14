// @ts-nocheck — vendored Pi source; checked upstream under Pi's own tsconfig.
// Structural stand-ins for the @earendil-works/pi-agent-core and
// @earendil-works/pi-ai types that vendored Pi modules reference. Kept
// deliberately loose: they only need to type-check the vendored sources and
// stay assignment-compatible with what Pi extensions construct at runtime.

export interface TextContent {
  type: 'text'
  text: string
  [key: string]: unknown
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
  [key: string]: unknown
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  [key: string]: unknown
}

export interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: unknown
  [key: string]: unknown
}

export interface Usage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  [key: string]: unknown
}

export interface UserMessage {
  role: 'user'
  content: string | (TextContent | ImageContent)[]
  timestamp?: number
  [key: string]: unknown
}

export interface AssistantMessage {
  role: 'assistant'
  content: (TextContent | ThinkingContent | ToolCallContent)[]
  usage?: Usage
  timestamp?: number
  [key: string]: unknown
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId?: string
  content: (TextContent | ImageContent)[]
  isError?: boolean
  timestamp?: number
  [key: string]: unknown
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

// Pi's AgentMessage is Message extended through CustomAgentMessages
// declaration merging. The vendored modules and Pi extensions add roles like
// "custom", "bashExecution", "branchSummary", "compactionSummary"; downstream
// code discriminates on `role`, so a loose record union is sufficient here.
export type AgentMessage = Message | { role: string; timestamp?: number; [key: string]: unknown }
