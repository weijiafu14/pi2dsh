import { homedir } from 'node:os'
import { join } from 'node:path'

export const CONFIG_DIR_NAME = '.pi'
export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024

export function defineTool<T>(tool: T): T {
  return tool
}

export function getAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'pi2dsh', 'agent')
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export interface TruncationOptions {
  maxLines?: number
  maxBytes?: number
}

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: 'lines' | 'bytes' | null
  totalLines: number
  totalBytes: number
  outputLines: number
  outputBytes: number
  lastLinePartial: boolean
  firstLineExceedsLimit: boolean
  maxLines: number
  maxBytes: number
}

function countedLines(content: string): string[] {
  if (content.length === 0) return []
  const lines = content.split('\n')
  if (content.endsWith('\n')) lines.pop()
  return lines
}

export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const lines = countedLines(content)
  const totalLines = lines.length
  const totalBytes = Buffer.byteLength(content)
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content, truncated: false, truncatedBy: null, totalLines, totalBytes,
      outputLines: totalLines, outputBytes: totalBytes, lastLinePartial: false,
      firstLineExceedsLimit: false, maxLines, maxBytes,
    }
  }
  if (Buffer.byteLength(lines[0] ?? '') > maxBytes) {
    return {
      content: '', truncated: true, truncatedBy: 'bytes', totalLines, totalBytes,
      outputLines: 0, outputBytes: 0, lastLinePartial: false,
      firstLineExceedsLimit: true, maxLines, maxBytes,
    }
  }
  const output: string[] = []
  let truncatedBy: 'lines' | 'bytes' = 'lines'
  for (const line of lines.slice(0, maxLines)) {
    const candidate = [...output, line].join('\n')
    if (Buffer.byteLength(candidate) > maxBytes) {
      truncatedBy = 'bytes'
      break
    }
    output.push(line)
  }
  const value = output.join('\n')
  return {
    content: value, truncated: true, truncatedBy, totalLines, totalBytes,
    outputLines: output.length, outputBytes: Buffer.byteLength(value), lastLinePartial: false,
    firstLineExceedsLimit: false, maxLines, maxBytes,
  }
}

const plain = (text: string): string => text

export function getMarkdownTheme(): Record<string, unknown> {
  return {
    heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain,
    codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain,
    listBullet: plain, bold: plain, italic: plain, underline: plain,
    strikethrough: plain, highlightCode: (code: string) => code.split('\n'),
  }
}
