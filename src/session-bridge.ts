// Pi session semantics over a DSH durable session.
//
// Single authority, live projection: DSH's append-only event log is the ONLY
// authority for conversation content. API reads project from it at call time.
// File-only Pi consumers additionally receive a disposable Pi JSONL export:
// it is never read back as DSH state or used as a resume authority. This disk
// adapter is a materialized compatibility view, not native storage.
//
// Pi-only facts (custom entries, labels, branch summaries) remain in their
// original per-session archive. Derived full transcripts live separately in
// Pi's standard sessions/<cwd>/ layout so file scanners and source anchors
// can consume them. Editing a derived transcript never edits DSH or the
// Pi-only facts; exports are rebuilt from those authorities. Resume uses the
// export's native identity and the official DSH resume seam, never its body.
// A positive native deletion verdict retires an export. An unavailable
// persistence service or a failed listing never deletes evidence.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isPiEphemeralSession, isPiUserMessage, readSessionEvents } from './session-events.js'
import { foldSurface } from '@deepseek-ai/dsh-session'
import { getAgentDir } from './compat/vendor/pi-config-shim.js'
import { fileContentForPi } from './dsh-content.js'
import { getDefaultSessionDir } from './compat/vendor/pi-session-manager.js'

/** The durable seq behind a projected entry id (`dsh-<seq>`), when it has one. */
function entrySeq(id: string): number | undefined {
  const match = /^dsh-(\d+)$/.exec(id)
  return match === null ? undefined : Number(match[1])
}

type UnknownRecord = Record<string, unknown>

interface DshSessionLike {
  id: string
  events?: readonly UnknownRecord[] | (() => readonly UnknownRecord[])
  snapshotEvents?(): readonly UnknownRecord[]
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

/** Only public persistence reads; never resume or load-with-recovery for indexing. */
export interface SessionExportPersistence {
  list(): Promise<readonly UnknownRecord[]>
  inspect?(id: string): Promise<{ meta: UnknownRecord; events: readonly UnknownRecord[] }>
  open?(id: string, access: 'read'): Promise<{
    header: UnknownRecord
    read(): Promise<{ events: readonly UnknownRecord[] }>
    close(): Promise<void>
  }>
}

function sidecarDir(): string {
  return join(getAgentDir(), 'session-entries')
}

function sessionEvents(session: DshSessionLike): readonly UnknownRecord[] {
  return readSessionEvents(session)
}

function dshToPiContent(content: unknown, fileContent: (ref: unknown) => unknown = fileContentForPi): unknown[] {
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }]
  return content.map(block => {
    if (typeof block !== 'object' || block === null) return { type: 'text', text: String(block) }
    const record = block as UnknownRecord
    if (record.type === 'file') return fileContent(record.attachment)
    if (record.type === 'text') return { type: 'text', text: String(record.text ?? '') }
    if (record.type === 'reasoning') return { type: 'thinking', thinking: String(record.text ?? '') }
    if (record.type === 'tool-call') {
      return { type: 'toolCall', id: record.id, name: record.name, arguments: record.arguments }
    }
    return { type: record.type }
  })
}

export class PiSessionBridge {
  constructor(private readonly fileContent: (ref: unknown) => unknown = fileContentForPi) {}
  private readonly records = new Map<string, SidecarRecord[]>()
  private readonly loaded = new Set<string>()
  private readonly exportedSessions = new Map<string, { session: DshSessionLike; cwd: string }>()

  async exportStoredSessions(persistence: SessionExportPersistence): Promise<void> {
    const priorExports: Array<{ path: string; id: string }> = []
    const root = join(getAgentDir(), 'sessions')
    if (existsSync(root)) {
      for (const directory of readdirSync(root, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue
        for (const entry of readdirSync(join(root, directory.name), { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.startsWith('dsh-')) continue
          const path = join(root, directory.name, entry.name)
          const id = this.sessionIdOfArchiveFile(path)
          if (id !== undefined) priorExports.push({ path, id })
        }
      }
    }
    const snapshots = await persistence.list()
    const present = new Set<string>()
    const hidden = new Set<string>()
    for (const snapshot of snapshots) {
      const header = (snapshot.header ?? snapshot) as UnknownRecord
      if (typeof header.id !== 'string') continue
      present.add(header.id)
      if (typeof header.cwd !== 'string') continue
      if (typeof persistence.open === 'function') {
        const handle = await persistence.open(header.id, 'read')
        try {
          const { events } = await handle.read()
          const session = { id: header.id, header: handle.header, events }
          if (isPiEphemeralSession(session)) hidden.add(header.id)
          else this.exportSessionFile(session, header.cwd)
        } finally { await handle.close() }
      } else if (typeof persistence.inspect === 'function') {
        const { meta, events } = await persistence.inspect(header.id)
        const session = { id: header.id, header: meta, events }
        if (isPiEphemeralSession(session)) hidden.add(header.id)
        else this.exportSessionFile(session, header.cwd)
      }
      // Stored snapshots are not live objects and must not later overwrite a live export.
      this.exportedSessions.delete(header.id)
    }
    // A successful complete native listing is the authority. Never let a
    // deleted native session live on solely in a derived search export.
    for (const exported of priorExports) {
      if ((!present.has(exported.id) || hidden.has(exported.id)) && existsSync(exported.path)) unlinkSync(exported.path)
    }
  }

  /** Materialize the public Pi file contract from the native session, never vice versa. */
  exportSessionFile(session: DshSessionLike, cwd: string): string {
    this.exportedSessions.set(session.id, { session, cwd })
    const safe = session.id.replace(/[^a-zA-Z0-9._-]+/gu, '_')
    const path = join(getDefaultSessionDir(cwd, getAgentDir()), `dsh-${safe}.jsonl`)
    const header = {
      type: 'session', version: 3, id: session.id, cwd,
      timestamp: new Date(Number(session.header?.createdAt ?? sessionEvents(session)[0]?.time ?? Date.now())).toISOString(),
      pi2dshExport: { nativeSessionId: session.id },
    }
    const text = `${[header, ...this.projectEntries(session)].map(value => JSON.stringify(value)).join('\n')}\n`
    // Preserve mtime when unchanged so incremental file consumers can skip it.
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return path
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, text, { mode: 0o600 })
      renameSync(temporary, path)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
    return path
  }

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
    const base = basename(resolved)
    if (resolve(dirname(resolved)) === resolve(sidecarDir())) {
      return base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : undefined
    }
    const within = relative(join(getAgentDir(), 'sessions'), resolved)
    if (within.startsWith('..') || !base.startsWith('dsh-') || !base.endsWith('.jsonl')) return undefined
    try {
      const header = JSON.parse(readFileSync(resolved, 'utf8').split('\n')[0]!) as UnknownRecord
      const marker = header.pi2dshExport as UnknownRecord | undefined
      return typeof marker?.nativeSessionId === 'string' && marker.nativeSessionId === header.id
        ? marker.nativeSessionId : undefined
    } catch { return undefined }
  }

  /**
   * Retire one archive this bridge minted: the file whose existence tells Pi
   * consumers "this conversation can be reopened". Called ONLY on a positive
   * persistence-layer verdict that the DSH session is gone, so existsSync
   * answers honestly again.
   */
  discardArchive(sessionId: string): void {
    try {
      unlinkSync(this.sidecarPath(sessionId))
    } catch {
      // Already gone — retiring an absent identity is a no-op, not a failure.
    }
    this.records.delete(sessionId)
    this.loaded.delete(sessionId)
    this.exportedSessions.delete(sessionId)
    const root = join(getAgentDir(), 'sessions')
    if (existsSync(root)) {
      for (const directory of readdirSync(root, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue
        const file = join(root, directory.name, `dsh-${sessionId.replace(/[^a-zA-Z0-9._-]+/gu, '_')}.jsonl`)
        if (this.sessionIdOfArchiveFile(file) === sessionId) unlinkSync(file)
      }
    }
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
    const exported = this.exportedSessions.get(sessionId)
    if (exported !== undefined) this.exportSessionFile(exported.session, exported.cwd)
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
            id: `dsh-${seq}`, timestamp: new Date(time).toISOString(),
            ...(isPiUserMessage(data)
              ? { type: 'message', message: { role: 'user', content: dshToPiContent(data.content, this.fileContent) } }
              : { type: 'custom_message', customType: String((data.source as UnknownRecord | undefined)?.piCustomType ?? (data.source as UnknownRecord | undefined)?.kind ?? 'context'), content: dshToPiContent(data.content, this.fileContent), display: false }),
          },
        })
      } else if (type === 'assistant/message') {
        const message = (data.message ?? {}) as UnknownRecord
        merged.push({
          time,
          entry: {
            type: 'message', id: `dsh-${seq}`, timestamp: new Date(time).toISOString(),
            message: { role: 'assistant', content: dshToPiContent(message.content, this.fileContent) },
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
      getSessionDir: () => getDefaultSessionDir(cwd, getAgentDir()),
      getSessionId: () => session.id,
      // The archive path is a REOPENABLE identity to Pi consumers (existsSync
      // guards, SessionManager.open) — materialized on read, not virtual.
      getSessionFile: () => isPiEphemeralSession(session) ? undefined : this.exportSessionFile(session, cwd),
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
