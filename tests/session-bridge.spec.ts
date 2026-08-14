import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PiSessionBridge } from '../src/session-bridge.js'

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
