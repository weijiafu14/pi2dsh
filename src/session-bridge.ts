// Pi session semantics over a DSH durable session.
//
// Single authority, live projection: DSH's append-only event log is the ONLY
// store for conversation content, and every read below projects from it at
// call time — nothing conversation-shaped is ever written to a second file.
//
// What DOES live on disk here is the Pi-visible session file, one per DSH
// session, in genuine Pi session-file format (a Pi `{type:"session"}` header
// line followed by Pi entry lines). It exists for two reasons, both forced by
// Pi's own ABI:
//
//  1. Pi's contract IS a file. `getSessionFile()` hands consumers a path they
//     probe with plain `existsSync` (pi-subagents' tombstone resurrect) and
//     hand back to `SessionManager.open()` — the OS call cannot be
//     intercepted, so a real inode must exist. The header line makes the file
//     honestly parseable as a Pi session.
//  2. Pi-ONLY entries (a package's appendEntry customs, labels, branch
//     summaries, a session_info name fallback) have no home in the native
//     log: DSH's persistence read path refuses logs carrying out-of-vocabulary
//     event types, and `Session.append()` cannot set the envelope's
//     `ignorable: true` escape hatch. These entries are sole originals, not
//     copies — the file is where they live until DSH's deferred plugin-event
//     registration surface exists (their KNOWN_SESSION_EVENT_TYPES comment
//     defers it "until such a consumer exists").
//
// Known limit, documented rather than papered over: the file's existence is
// minted while the native session is alive, but nothing deletes it if the
// native store later loses the session — a resurrect attempt then fails
// LOUDLY at the official resume seam instead of being pre-filtered by
// existsSync. Auto-deleting on resume failure would be worse: the failure is
// indistinguishable from "this composition has no session persistence", and
// destroying a valid identity token on a composition quirk lies in the other
// direction.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { foldSurface } from '@deepseek-ai/dsh-session'
import { getAgentDir } from './compat/vendor/pi-config-shim.js'

/** The durable seq behind a projected entry id (`dsh-<seq>`), when it has one. */
function entrySeq(id: string): number | undefined {
  const match = /^dsh-(\d+)$/.exec(id)
  return match === null ? undefined : Number(match[1])
}

type UnknownRecord = Record<string, unknown>

interface DshSessionLike {
  id: string
  events: readonly UnknownRecord[] | (() => readonly UnknownRecord[])
  append?(type: string, data: unknown, opts?: unknown): unknown
  header?: UnknownRecord
}

interface SidecarRecord {
  kind: 'custom' | 'label' | 'name' | 'branch_summary'
  id: string
  timestamp: string
  customType?: string
  data?: unknown
  targetId?: string
  label?: string
  name?: string
  summary?: string
  fromId?: string
}

/** One Pi-only record as the Pi session-file entry line it is stored as. */
function piEntryLineOf(record: SidecarRecord): string {
  const base = { id: record.id, parentId: null, timestamp: record.timestamp }
  switch (record.kind) {
    case 'custom':
      return JSON.stringify({
        type: 'custom', ...base, customType: record.customType,
        ...(record.data === undefined ? {} : { data: record.data }),
      })
    case 'label':
      return JSON.stringify({
        type: 'label', ...base, targetId: record.targetId,
        ...(record.label === undefined ? {} : { label: record.label }),
      })
    case 'branch_summary':
      return JSON.stringify({ type: 'branch_summary', ...base, fromId: record.fromId, summary: record.summary })
    case 'name':
      return JSON.stringify({ type: 'session_info', ...base, name: record.name })
  }
}

/**
 * Normalize one parsed session-file line back into a record. Understands the
 * Pi entry shapes this bridge writes today AND the pre-0.18 private
 * `{kind: …}` lines, so archives written by older engines keep loading. A Pi
 * header line and anything unrecognized return undefined.
 */
function recordOfParsedLine(parsed: UnknownRecord): SidecarRecord | undefined {
  if (typeof parsed.kind === 'string') return parsed as unknown as SidecarRecord
  const id = typeof parsed.id === 'string' ? parsed.id : undefined
  const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined
  if (id === undefined || timestamp === undefined) return undefined
  switch (parsed.type) {
    case 'custom':
      return {
        kind: 'custom', id, timestamp, customType: String(parsed.customType ?? ''),
        ...(parsed.data === undefined ? {} : { data: parsed.data }),
      }
    case 'label':
      return {
        kind: 'label', id, timestamp,
        ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
        ...(typeof parsed.label === 'string' ? { label: parsed.label } : {}),
      }
    case 'branch_summary':
      return {
        kind: 'branch_summary', id, timestamp,
        ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
        ...(typeof parsed.fromId === 'string' ? { fromId: parsed.fromId } : {}),
      }
    case 'session_info':
      return { kind: 'name', id, timestamp, ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}) }
    default:
      return undefined
  }
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

  /**
   * The Pi-visible archive file for one DSH session — the established
   * `<id>.jsonl` convention (getSessionFile/switchSession use the same one).
   * Guaranteed to EXIST on return, and to start with a genuine Pi
   * `{type:"session"}` header line: Pi consumers treat the session file as
   * the durable identity a conversation can be reopened by (pi-subagents
   * guards its tombstone resurrect with existsSync), and real Pi parsing
   * (`SessionManager.open` reads the header for id/cwd) must see a Pi file,
   * not a bare inode. An empty pre-existing file is upgraded in place.
   */
  archiveFileFor(sessionId: string, cwd?: string): string {
    const path = this.sidecarPath(sessionId)
    const needsHeader = !existsSync(path) || readFileSync(path, 'utf8').trim().length === 0
    if (needsHeader) {
      mkdirSync(sidecarDir(), { recursive: true })
      appendFileSync(path, `${JSON.stringify({
        type: 'session', version: 3, id: sessionId,
        timestamp: new Date().toISOString(), cwd: cwd ?? process.cwd(),
      })}\n`)
    }
    return path
  }

  /**
   * The DSH session id an archive-file path names, or undefined for any path
   * this bridge did not mint (a genuine Pi session file, an in-memory
   * manager's undefined). The reverse of {@link archiveFileFor} — ids that
   * survive its sanitization round-trip exactly, which every id this bridge
   * mints does.
   */
  sessionIdOfArchiveFile(path: unknown): string | undefined {
    if (typeof path !== 'string' || path.length === 0) return undefined
    const resolved = resolve(path)
    if (resolve(dirname(resolved)) !== resolve(sidecarDir())) return undefined
    const base = basename(resolved)
    return base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : undefined
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
        const record = recordOfParsedLine(JSON.parse(line) as UnknownRecord)
        if (record !== undefined) parsed.push(record)
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
    // The archive must open with its Pi header before any entry follows it.
    this.archiveFileFor(sessionId)
    appendFileSync(this.sidecarPath(sessionId), `${piEntryLineOf(record)}\n`)
  }

  appendCustomEntry(sessionId: string, customType: string, data: unknown): string {
    const id = randomUUID()
    this.persist(sessionId, {
      kind: 'custom', id, timestamp: new Date().toISOString(), customType,
      ...(data === undefined ? {} : { data }),
    })
    return id
  }

  /**
   * The custom entries a package appended to one session, oldest first.
   *
   * Addressed by id alone: the browser half asks for a session it is showing,
   * and has no DSH session object to hand over.
   * @param sessionId - session whose sidecar to read.
   * @returns each custom entry with its type, data and id.
   */
  customEntries(sessionId: string): Array<{ id: string, customType: string, data: unknown, timestamp: string }> {
    this.load(sessionId)
    const out: Array<{ id: string, customType: string, data: unknown, timestamp: string }> = []
    for (const record of this.records.get(sessionId) ?? []) {
      if (record.kind !== 'custom') continue
      const entry = record as unknown as { id: string, customType: string, data?: unknown, timestamp: string }
      out.push({ id: entry.id, customType: entry.customType, data: entry.data, timestamp: entry.timestamp })
    }
    return out
  }

  appendBranchSummary(sessionId: string, summary: string, fromId: string): string {
    const id = randomUUID()
    this.persist(sessionId, {
      kind: 'branch_summary', id, timestamp: new Date().toISOString(), summary, fromId,
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
  /**
   * The seqs still on the model-visible surface, via DSH's own canonical fold.
   * @param session - the session to project.
   * @returns the visible seqs, or undefined when the fold cannot run (a
   *   projection built from a partial event list, e.g. in a test double) — in
   *   which case nothing is filtered out rather than everything.
   */
  visibleSeqs(session: DshSessionLike): Set<number> | undefined {
    try {
      return new Set(foldSurface(sessionEvents(session) as never).nodes)
    } catch {
      return undefined
    }
  }

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
      } else if (record.kind === 'branch_summary') {
        merged.push({
          time,
          entry: {
            type: 'branch_summary', id: record.id, timestamp: record.timestamp,
            summary: record.summary, fromId: record.fromId,
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
      // The archive path is a REOPENABLE identity to Pi consumers (existsSync
      // guards, SessionManager.open) — materialized on read, not virtual.
      getSessionFile: () => this.archiveFileFor(session.id, cwd),
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
      // Pi's buildContextEntries is the COMPACTION-AWARE list — what actually
      // goes to the model. Two rules, both of them Pi's:
      //
      //  - by type: message/compaction/branch_summary/custom_message enter the
      //    context; custom entries and labels are state-only;
      //  - by compaction: entries the latest compaction summarized are gone,
      //    replaced by the summary. Returning them anyway (what this did) let
      //    a package build context out of history the model can no longer see
      //    — and the longer the session, the further apart the two drift.
      //
      // Which entries survive is not re-derived here: DSH's own `foldSurface`
      // is the authority on the model-visible surface, and its node list is
      // seqs, which is exactly what these entry ids are made of.
      buildContextEntries: () => {
        const visible = this.visibleSeqs(session)
        return entriesOf().filter(entry => {
          if (entry.type !== 'message' && entry.type !== 'compaction'
            && entry.type !== 'branch_summary' && entry.type !== 'custom_message') return false
          // A sidecar entry has no seq of its own and is never shadowed.
          const seq = entrySeq(entry.id)
          return seq === undefined || visible === undefined || visible.has(seq)
        })
      },
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
