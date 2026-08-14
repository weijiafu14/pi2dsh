// Pi session semantics over a DSH durable session.
//
// DSH's append-only event log is authoritative for messages; Pi-only state
// (custom entries, labels, a session name fallback) persists in a pi2dsh
// sidecar JSONL next to DSH's home. The sidecar exists because DSH currently
// has no channel for out-of-repo plugin events: `Session.append()` cannot set
// the envelope's `ignorable: true`, so an unknown event type appended to the
// main log would make other builds refuse to reload the whole session. Until
// DSH grows that registration surface, the sidecar keeps Pi entries durable
// and replayable without touching main-log compatibility.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAgentDir } from './compat/vendor/pi-config-shim.js'

type UnknownRecord = Record<string, unknown>

interface DshSessionLike {
  id: string
  events: readonly UnknownRecord[] | (() => readonly UnknownRecord[])
  append?(type: string, data: unknown, opts?: unknown): unknown
  header?: UnknownRecord
}

interface SidecarRecord {
  kind: 'custom' | 'label' | 'name'
  id: string
  timestamp: string
  customType?: string
  data?: unknown
  targetId?: string
  label?: string
  name?: string
}

export interface PiProjectedEntry {
  type: string
  id: string
  parentId: string | null
  timestamp: string
  [key: string]: unknown
}

function sidecarDir(): string {
  return join(getAgentDir(), 'session-entries')
}

function sessionEvents(session: DshSessionLike): readonly UnknownRecord[] {
  const events = session.events
  return typeof events === 'function' ? events.call(session) : events ?? []
}

function dshToPiContent(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }]
  return content.map(block => {
    if (typeof block !== 'object' || block === null) return { type: 'text', text: String(block) }
    const record = block as UnknownRecord
    if (record.type === 'text') return { type: 'text', text: String(record.text ?? '') }
    if (record.type === 'reasoning') return { type: 'thinking', thinking: String(record.text ?? '') }
    if (record.type === 'tool-call') {
      return { type: 'toolCall', id: record.id, name: record.name, arguments: record.arguments }
    }
    return { type: record.type }
  })
}

export class PiSessionBridge {
  private readonly records = new Map<string, SidecarRecord[]>()
  private readonly loaded = new Set<string>()

  private sidecarPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9._-]+/gu, '_')
    return join(sidecarDir(), `${safe}.jsonl`)
  }

  load(sessionId: string): void {
    if (this.loaded.has(sessionId)) return
    this.loaded.add(sessionId)
    const path = this.sidecarPath(sessionId)
    if (!existsSync(path)) {
      this.records.set(sessionId, this.records.get(sessionId) ?? [])
      return
    }
    const parsed: SidecarRecord[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue
      try {
        parsed.push(JSON.parse(line) as SidecarRecord)
      } catch {
        // A torn tail line from a crashed process is dropped, like DSH's own
        // never-finished trailing fragments.
      }
    }
    this.records.set(sessionId, parsed)
  }

  private persist(sessionId: string, record: SidecarRecord): void {
    this.load(sessionId)
    const list = this.records.get(sessionId) ?? []
    list.push(record)
    this.records.set(sessionId, list)
    mkdirSync(sidecarDir(), { recursive: true })
    appendFileSync(this.sidecarPath(sessionId), `${JSON.stringify(record)}\n`)
  }

  appendCustomEntry(sessionId: string, customType: string, data: unknown): string {
    const id = randomUUID()
    this.persist(sessionId, {
      kind: 'custom', id, timestamp: new Date().toISOString(), customType,
      ...(data === undefined ? {} : { data }),
    })
    return id
  }

  appendLabel(sessionId: string, targetId: string, label: string | undefined): void {
    this.persist(sessionId, {
      kind: 'label', id: randomUUID(), timestamp: new Date().toISOString(), targetId,
      ...(label === undefined ? {} : { label }),
    })
  }

  setName(sessionId: string, name: string): void {
    const sanitized = name.replace(/[\r\n]+/gu, ' ').trim()
    this.persist(sessionId, { kind: 'name', id: randomUUID(), timestamp: new Date().toISOString(), name: sanitized })
  }

  getName(sessionId: string): string | undefined {
    this.load(sessionId)
    const list = this.records.get(sessionId) ?? []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]!.kind === 'name') return list[i]!.name
    }
    return undefined
  }

  labels(sessionId: string): Map<string, string> {
    this.load(sessionId)
    const labels = new Map<string, string>()
    for (const record of this.records.get(sessionId) ?? []) {
      if (record.kind !== 'label' || record.targetId === undefined) continue
      if (record.label === undefined) labels.delete(record.targetId)
      else labels.set(record.targetId, record.label)
    }
    return labels
  }

  /**
   * Project the DSH durable log plus sidecar records into Pi's entry-chain
   * shape. DSH history is linear, so the projection is a single-branch tree:
   * every entry's parent is its predecessor.
   */
  projectEntries(session: DshSessionLike): PiProjectedEntry[] {
    this.load(session.id)
    const merged: Array<{ time: number; entry: Omit<PiProjectedEntry, 'parentId'> }> = []
    for (const event of sessionEvents(session)) {
      const seq = Number(event.seq ?? 0)
      const time = Number(event.time ?? 0)
      const data = (event.data ?? {}) as UnknownRecord
      const type = event.type
      if (type === 'user/message') {
        merged.push({
          time,
          entry: {
            type: 'message', id: `dsh-${seq}`, timestamp: new Date(time).toISOString(),
            message: { role: 'user', content: dshToPiContent(data.content) },
          },
        })
      } else if (type === 'assistant/message') {
        const message = (data.message ?? {}) as UnknownRecord
        merged.push({
          time,
          entry: {
            type: 'message', id: `dsh-${seq}`, timestamp: new Date(time).toISOString(),
            message: { role: 'assistant', content: dshToPiContent(message.content) },
          },
        })
      } else if (type === 'tool/result') {
        const message = (data.message ?? {}) as UnknownRecord
        const blocks = Array.isArray(message.content) ? message.content as UnknownRecord[] : []
        const tool = blocks.find(block => block.type === 'tool-result')
        merged.push({
          time,
          entry: {
            type: 'message', id: `dsh-${seq}`, timestamp: new Date(time).toISOString(),
            message: {
              role: 'toolResult',
              toolCallId: tool?.toolCallId,
              content: dshToPiContent(tool?.content ?? []),
              isError: tool?.isError === true,
            },
          },
        })
      }
    }
    for (const record of this.records.get(session.id) ?? []) {
      const time = Date.parse(record.timestamp)
      if (record.kind === 'custom') {
        merged.push({
          time,
          entry: {
            type: 'custom', id: record.id, timestamp: record.timestamp,
            customType: record.customType,
            ...(record.data === undefined ? {} : { data: record.data }),
          },
        })
      } else if (record.kind === 'label') {
        merged.push({
          time,
          entry: {
            type: 'label', id: record.id, timestamp: record.timestamp,
            targetId: record.targetId, label: record.label,
          },
        })
      } else {
        merged.push({
          time,
          entry: { type: 'session_info', id: record.id, timestamp: record.timestamp, name: record.name },
        })
      }
    }
    merged.sort((left, right) => left.time - right.time)
    const entries: PiProjectedEntry[] = []
    let parentId: string | null = null
    for (const item of merged) {
      const entry = { ...item.entry, parentId } as PiProjectedEntry
      entries.push(entry)
      parentId = entry.id
    }
    return entries
  }

  /** The exact 14-method surface Pi exposes as ctx.sessionManager. */
  readonlySessionManager(session: DshSessionLike, cwd: string): UnknownRecord {
    const entriesOf = (): PiProjectedEntry[] => this.projectEntries(session)
    const leafOf = (): PiProjectedEntry | undefined => entriesOf().at(-1)
    return {
      getCwd: () => cwd,
      getSessionDir: () => sidecarDir(),
      getSessionId: () => session.id,
      getSessionFile: () => this.sidecarPath(session.id),
      getLeafId: () => leafOf()?.id ?? null,
      getLeafEntry: () => leafOf(),
      getEntry: (id: string) => entriesOf().find(entry => entry.id === id),
      getLabel: (id: string) => this.labels(session.id).get(id),
      getBranch: (fromId?: string) => {
        const entries = entriesOf()
        if (fromId === undefined) return entries
        const index = entries.findIndex(entry => entry.id === fromId)
        return index === -1 ? [] : entries.slice(0, index + 1)
      },
      // Pi context rules: message/compaction/branch_summary/custom_message
      // enter the LLM context; custom entries and labels are state-only.
      buildContextEntries: () => entriesOf().filter(entry =>
        entry.type === 'message' || entry.type === 'compaction' || entry.type === 'branch_summary' || entry.type === 'custom_message'),
      getHeader: () => ({
        type: 'session',
        version: 3,
        id: session.id,
        timestamp: new Date(Number(sessionEvents(session)[0]?.time ?? Date.now())).toISOString(),
        cwd,
      }),
      getEntries: () => entriesOf(),
      getTree: () => {
        const entries = entriesOf()
        const labels = this.labels(session.id)
        type Node = { entry: PiProjectedEntry; children: Node[]; label?: string | undefined }
        let root: Node | undefined
        let cursor: Node | undefined
        for (const entry of entries) {
          const node: Node = {
            entry,
            children: [],
            ...(labels.has(entry.id) ? { label: labels.get(entry.id) } : {}),
          }
          if (cursor === undefined) root = node
          else cursor.children.push(node)
          cursor = node
        }
        return root === undefined ? [] : [root]
      },
      getSessionName: () => this.getName(session.id),
    }
  }
}
