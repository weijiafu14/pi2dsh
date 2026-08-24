import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { PiSessionBridge } from '../src/session-bridge.js'

type DshSession = {
  id: unknown
  events: unknown[]
  append(type: string, data: unknown, meta?: unknown): { seq: number }
}

let scratch: string
let previousAgentDir: string | undefined

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-bridge-'))
  previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = scratch
})

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir
  await rm(scratch, { recursive: true, force: true })
})

function dshSession(id: string, events: Array<Record<string, unknown>> = []): { id: string; events: Array<Record<string, unknown>> } {
  return { id, events }
}

describe("buildContextEntries is the model's view, not the whole log", () => {
  it('drops the entries a real compaction summarized away', async () => {
    // Pi's buildContextEntries is the compaction-aware list: the summary
    // stands in for the entries it replaced. This bridge returned everything,
    // so a package built context out of history the model can no longer see —
    // and the longer the session runs, the further the two drift apart.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const sessions = (ctx as unknown as {
      sessions: { create(id: unknown, options?: unknown): DshSession }
    }).sessions
    const session = sessions.create(SessionId('pi2dsh-compaction'), { meta: { cwd: scratch } })

    const first = session.append('user/message',
      createUserMessage({ content: [{ type: 'text', text: 'the old question' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' })
    const second = session.append('user/message',
      createUserMessage({ content: [{ type: 'text', text: 'the old follow-up' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' })
    session.append('user/message',
      createUserMessage({ content: [{ type: 'text', text: 'the live question' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' })

    const bridge = new PiSessionBridge()
    const manager = bridge.readonlySessionManager(session as never, scratch) as unknown as {
      buildContextEntries(): unknown[]
      getEntries(): unknown[]
    }
    expect(manager.buildContextEntries()).toHaveLength(3)

    // A real compaction: summary event, then the replacement that shadows the
    // range — the same shape DSH's own compaction engine appends.
    const summary = [{ type: 'text' as const, text: 'summary of the old exchange' }]
    const shadowedSeqs = [first.seq, second.seq]
    const startEvent = session.append('compaction/start', { compactionId: 'c1', turn: 0 })
    const summaryEvent = session.append('compaction/summary', {
      compactionId: 'c1',
      summary,
      shadowedRange: { start: first.seq, end: second.seq },
      shadowedSeqs,
      shadowedTokenCount: 0,
      provider: 'test',
      model: 'test',
    })
    session.append('user/message', createUserMessage({ content: summary, source: { kind: 'user' } }), {
      surfaceOp: { op: 'replace', start: first.seq, end: second.seq },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
    })

    const after = manager.buildContextEntries()
    const texts = JSON.stringify(after)
    expect(texts).not.toContain('the old question')
    expect(texts).not.toContain('the old follow-up')
    expect(texts).toContain('summary of the old exchange')
    expect(texts).toContain('the live question')

    // getEntries() is Pi's append-only log and still shows everything — the
    // two methods differ on purpose.
    expect(JSON.stringify(manager.getEntries())).toContain('the old question')
  })
})

describe('Pi session semantics over a DSH durable session', () => {
  it('persists custom entries, labels, and names to the sidecar and survives a reload', () => {
    const writer = new PiSessionBridge()
    const entryId = writer.appendCustomEntry('sess-1', 'todo-state', { items: ['a'] })
    writer.appendLabel('sess-1', entryId, 'bookmark')
    writer.setName('sess-1', 'My  session\r\nname')

    // A fresh bridge instance simulates a process restart: everything must
    // come back from the sidecar file alone.
    const reader = new PiSessionBridge()
    expect(reader.getName('sess-1')).toBe('My  session name')
    expect(reader.labels('sess-1').get(entryId)).toBe('bookmark')
    const entries = reader.projectEntries(dshSession('sess-1'))
    const custom = entries.find(entry => entry.type === 'custom')
    expect(custom).toMatchObject({ customType: 'todo-state', data: { items: ['a'] } })

    // Clearing a label removes it from the projection.
    reader.appendLabel('sess-1', entryId, undefined)
    expect(new PiSessionBridge().labels('sess-1').has(entryId)).toBe(false)
  })

  it('projects DSH durable messages and sidecar entries into one parent-linked chain', () => {
    const bridge = new PiSessionBridge()
    const session = dshSession('sess-2', [
      { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2000, data: { content: [{ type: 'text', text: 'hi' }] } },
      {
        type: 'assistant/message', seq: 2, time: 3000,
        data: { message: { content: [{ type: 'text', text: 'hello' }, { type: 'reasoning', text: 'hmm' }] } },
      },
      {
        type: 'tool/result', seq: 3, time: 4000,
        data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }], isError: false }] } },
      },
    ])
    bridge.appendCustomEntry('sess-2', 'checkpoint', 42)

    const entries = bridge.projectEntries(session)
    expect(entries.map(entry => entry.type)).toEqual(['message', 'message', 'message', 'custom'])
    expect(entries[0]).toMatchObject({ id: 'dsh-1', parentId: null, message: { role: 'user' } })
    expect(entries[1]).toMatchObject({
      id: 'dsh-2', parentId: 'dsh-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'thinking', thinking: 'hmm' }] },
    })
    expect(entries[2]).toMatchObject({ id: 'dsh-3', parentId: 'dsh-2', message: { role: 'toolResult', toolCallId: 'c1' } })
    expect(entries[3]).toMatchObject({ type: 'custom', parentId: 'dsh-3' })
  })

  it('serves Pi ReadonlySessionManager surface over the projection', () => {
    const bridge = new PiSessionBridge()
    const session = dshSession('sess-3', [
      { type: 'user/message', seq: 0, time: 1000, data: { content: [{ type: 'text', text: 'q' }] } },
    ])
    const entryId = bridge.appendCustomEntry('sess-3', 'note', 'n1')
    bridge.appendLabel('sess-3', entryId, 'marked')
    const manager = bridge.readonlySessionManager(session, '/work') as {
      getCwd(): string
      getSessionId(): string
      getLeafId(): string | null
      getLeafEntry(): { id: string } | undefined
      getEntry(id: string): unknown
      getLabel(id: string): string | undefined
      getBranch(fromId?: string): Array<{ id: string }>
      getEntries(): Array<{ id: string }>
      getTree(): Array<{ entry: { id: string }; children: unknown[]; label?: string }>
      buildContextEntries(): Array<{ type: string }>
      getHeader(): { cwd: string; version: number }
      getSessionName(): string | undefined
    }
    expect(manager.getCwd()).toBe('/work')
    expect(manager.getSessionId()).toBe('sess-3')
    // A label change is itself an entry in Pi (appendLabelChange advances the
    // leaf), so the chain is message -> custom -> label and the leaf is the
    // label entry.
    const chain = manager.getBranch().map(entry => entry.id)
    expect(chain).toHaveLength(3)
    expect(chain[0]).toBe('dsh-0')
    expect(chain[1]).toBe(entryId)
    expect(manager.getLeafId()).toBe(chain[2])
    expect(manager.getLeafEntry()?.id).toBe(chain[2])
    expect(manager.getEntry('dsh-0')).toMatchObject({ id: 'dsh-0' })
    expect(manager.getLabel(entryId)).toBe('marked')
    expect(manager.getBranch('dsh-0').map(entry => entry.id)).toEqual(['dsh-0'])
    expect(manager.getEntries()).toHaveLength(3)
    // Pi context rules: custom entries are state-only and stay out of context.
    expect(manager.buildContextEntries().map(entry => entry.type)).toEqual(['message'])
    expect(manager.getHeader()).toMatchObject({ cwd: '/work', version: 3 })
    // The projection is a single-branch tree: one root, nested children.
    const tree = manager.getTree()
    expect(tree).toHaveLength(1)
    expect(tree[0]!.entry.id).toBe('dsh-0')
    expect(tree[0]!.children).toHaveLength(1)
  })
})

describe('the durable archive identity Pi consumers reopen a session by', () => {
  // pi-subagents records session.sessionManager.getSessionFile() per child and
  // resurrects an evicted `@handle` by existsSync + SessionManager.open on that
  // exact path — a virtual path reads as "the conversation is gone".
  it('materializes the archive file on first ask and round-trips the session id', () => {
    const bridge = new PiSessionBridge()
    const file = bridge.archiveFileFor('pi2dsh-sub-abc-1')
    expect(file.endsWith('pi2dsh-sub-abc-1.jsonl')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('node:fs').existsSync(file)).toBe(true)
    expect(bridge.sessionIdOfArchiveFile(file)).toBe('pi2dsh-sub-abc-1')
  })

  it('refuses to claim paths it did not mint', () => {
    const bridge = new PiSessionBridge()
    expect(bridge.sessionIdOfArchiveFile(undefined)).toBeUndefined()
    expect(bridge.sessionIdOfArchiveFile('')).toBeUndefined()
    // A genuine Pi session file outside the archive dir is NOT ours to rebind.
    expect(bridge.sessionIdOfArchiveFile('/tmp/elsewhere/2026-01-01-abc.jsonl')).toBeUndefined()
    // Right directory, wrong extension.
    expect(bridge.sessionIdOfArchiveFile(bridge.archiveFileFor('x').replace('.jsonl', '.txt'))).toBeUndefined()
  })

  it('mints the archive as a genuine Pi session file: header line + Pi entry lines', async () => {
    const bridge = new PiSessionBridge()
    const manager = bridge.readonlySessionManager(dshSession('pi2dsh-sub-fmt-1') as never, '/work/dir') as {
      getSessionFile(): string
    }
    const file = manager.getSessionFile()
    bridge.appendCustomEntry('pi2dsh-sub-fmt-1', 'subagents:record', { status: 'completed' })
    bridge.appendLabel('pi2dsh-sub-fmt-1', 'dsh-0', 'pin')

    const lines = require('node:fs').readFileSync(file, 'utf8').trim().split('\n').map((l: string) => JSON.parse(l))
    expect(lines[0]).toMatchObject({ type: 'session', version: 3, id: 'pi2dsh-sub-fmt-1', cwd: '/work/dir' })
    expect(lines[1]).toMatchObject({ type: 'custom', customType: 'subagents:record', parentId: null, data: { status: 'completed' } })
    expect(lines[2]).toMatchObject({ type: 'label', targetId: 'dsh-0', label: 'pin' })
    // No private {kind: …} shapes on disk — every line is a Pi shape.
    expect(lines.some((l: Record<string, unknown>) => 'kind' in l)).toBe(false)

    // The REAL Pi parser (vendored, logic unchanged) reads the file as-is:
    // this is the ABI the file exists to honour, not our own reader again.
    const { loadEntriesFromFile } = await import('../src/compat/vendor/pi-session-manager.js')
    const parsed = loadEntriesFromFile(file)
    expect(parsed.map((entry: { type: string }) => entry.type)).toEqual(['session', 'custom', 'label'])

    // And a fresh bridge (process restart) round-trips it back.
    const reader = new PiSessionBridge()
    expect(reader.customEntries('pi2dsh-sub-fmt-1')[0]).toMatchObject({ customType: 'subagents:record' })
    expect(reader.labels('pi2dsh-sub-fmt-1').get('dsh-0')).toBe('pin')
  })

  it('still loads archives written in the pre-Pi-format private shape', () => {
    const fs = require('node:fs')
    const bridge = new PiSessionBridge()
    const file = bridge.archiveFileFor('legacy-1')
    fs.appendFileSync(file, `${JSON.stringify({ kind: 'custom', id: 'c1', timestamp: '2026-01-01T00:00:00.000Z', customType: 'old', data: 7 })}\n`)
    fs.appendFileSync(file, `${JSON.stringify({ kind: 'name', id: 'n1', timestamp: '2026-01-01T00:00:01.000Z', name: 'kept' })}\n`)
    const reader = new PiSessionBridge()
    expect(reader.customEntries('legacy-1')[0]).toMatchObject({ customType: 'old', data: 7 })
    expect(reader.getName('legacy-1')).toBe('kept')
  })

  it('upgrades a pre-existing empty archive with the Pi header in place', () => {
    const fs = require('node:fs')
    const bridge = new PiSessionBridge()
    // A file minted by an older engine is empty; place one at the real path.
    const path = join(require('node:path').dirname(bridge.archiveFileFor('probe-x')), 'empty-1.jsonl')
    fs.writeFileSync(path, '')
    expect(bridge.archiveFileFor('empty-1', '/w')).toBe(path)
    const first = JSON.parse(fs.readFileSync(path, 'utf8').trim().split('\n')[0])
    expect(first).toMatchObject({ type: 'session', id: 'empty-1', cwd: '/w' })
  })

  it('keeps getSessionFile on the readonly projection reopenable (exists on disk)', () => {
    const bridge = new PiSessionBridge()
    const projection = bridge.readonlySessionManager(dshSession('proj-1') as never, scratch) as {
      getSessionFile(): string
      getSessionId(): string
    }
    const file = projection.getSessionFile()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('node:fs').existsSync(file)).toBe(true)
    expect(bridge.sessionIdOfArchiveFile(file)).toBe('proj-1')
    expect(projection.getSessionId()).toBe('proj-1')
  })
})
