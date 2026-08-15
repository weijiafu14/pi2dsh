// Contract tests for the vendored Pi surfaces that replaced explicit-failure
// stubs: compaction/summarization (model calls on the llm bridge through Pi's
// own streamFn injection point), skills loading, the trust store, frontmatter
// (Pi's public { frontmatter, body } shape), and tool wrappers.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPACTION_SETTINGS,
  ProjectTrustStore,
  estimateTokens,
  findCutPoint,
  generateSummary,
  loadSkillsFromDir,
  parseFrontmatter,
  serializeConversation,
  shouldCompact,
  stripFrontmatter,
  wrapRegisteredTool,
} from '../src/compat/pi-coding-agent.js'
import { __setPiAiLlmBridge } from '../src/compat/pi-ai.js'

const cleanup: string[] = []

afterEach(async () => {
  __setPiAiLlmBridge(undefined)
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('vendored frontmatter (Pi public shape)', () => {
  it('returns { frontmatter, body } with YAML-parsed values — not string attributes', () => {
    const parsed = parseFrontmatter<{ name: string; count: number; nested: { deep: boolean } }>(
      '---\nname: demo\ncount: 3\nnested:\n  deep: true\n---\nBody text',
    )
    expect(parsed.frontmatter.name).toBe('demo')
    expect(parsed.frontmatter.count).toBe(3)
    expect(parsed.frontmatter.nested).toEqual({ deep: true })
    expect(parsed.body).toBe('Body text')
    expect(stripFrontmatter('---\na: 1\n---\nrest')).toBe('rest')
    expect(parseFrontmatter('no frontmatter').frontmatter).toEqual({})
  })
})

describe('vendored compaction surface', () => {
  it('exposes Pi\'s real defaults and pure logic (not the old always-false stub)', () => {
    expect(DEFAULT_COMPACTION_SETTINGS).toEqual({ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 })
    expect(shouldCompact(200_000, 128_000, DEFAULT_COMPACTION_SETTINGS)).toBe(true)
    expect(shouldCompact(1_000, 128_000, DEFAULT_COMPACTION_SETTINGS)).toBe(false)
    expect(shouldCompact(200_000, 128_000, { ...DEFAULT_COMPACTION_SETTINGS, enabled: false })).toBe(false)
  })

  it('estimates tokens with Pi\'s chars/4 heuristic including the 4800-char image weight', () => {
    const textTokens = estimateTokens({ role: 'user', content: 'x'.repeat(400) })
    expect(textTokens).toBe(100)
    const imageTokens = estimateTokens({ role: 'user', content: [{ type: 'image' }] })
    expect(imageTokens).toBe(1200)
  })

  it('finds cut points across session entries without cutting at tool results', () => {
    const userEntry = (id: string, text: string) => ({
      type: 'message', id, timestamp: 't',
      message: { role: 'user', content: [{ type: 'text', text }] },
    })
    const entries = [userEntry('a', 'x'.repeat(4000)), userEntry('b', 'y'.repeat(4000)), userEntry('c', 'z'.repeat(40))]
    const cut = findCutPoint(entries as never, 0, entries.length, 900)
    expect(cut.firstKeptEntryIndex).toBe(1)
    expect(findCutPoint([] as never, 0, 0, 100)).toEqual({ firstKeptEntryIndex: 0, turnStartIndex: -1, isSplitTurn: false })
  })

  it('serializes conversations in Pi\'s text form, truncating long tool results', () => {
    const serialized = serializeConversation([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'r'.repeat(3000) }] },
    ] as never)
    expect(serialized).toContain('[User]: hello')
    expect(serialized).toContain('more characters truncated')
    expect(serialized).not.toContain('r'.repeat(2500))
  })

  it('generateSummary runs the model call through the injected llm bridge, and fails loud without one', async () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'work happened' }], timestamp: 1 }]
    const model = { id: 'm', provider: 'p', maxTokens: 2048, reasoning: false }

    await expect(generateSummary(messages, model, 16384)).rejects.toThrow(/streamFn|llm bridge/)

    const seen: unknown[] = []
    __setPiAiLlmBridge(((bridgeModel: unknown, context: unknown, options: unknown) => {
      seen.push({ bridgeModel, context, options })
      return {
        result: async () => ({
          stopReason: 'stop',
          content: [{ type: 'text', text: 'THE SUMMARY' }],
          usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        }),
        [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) } },
      }
    }) as never)
    const summary = await generateSummary(messages, model, 16384)
    expect(summary).toBe('THE SUMMARY')
    expect(seen).toHaveLength(1)
    const request = seen[0] as { context: { systemPrompt: string; messages: Array<{ content: Array<{ text: string }> }> } }
    expect(request.context.systemPrompt).toContain('context summarization assistant')
    expect(request.context.messages[0]!.content[0]!.text).toContain('work happened')
  })
})

describe('vendored skills loading', () => {
  it('discovers SKILL.md roots and direct .md children with Pi\'s validation rules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi2dsh-skills-'))
    cleanup.push(dir)
    await mkdir(join(dir, 'my-skill'), { recursive: true })
    await writeFile(join(dir, 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: A real skill.\n---\nDo things.')
    await mkdir(join(dir, 'broken'), { recursive: true })
    await writeFile(join(dir, 'broken', 'SKILL.md'), '---\nname: broken\n---\nNo description.')
    const result = loadSkillsFromDir({ dir, source: 'path' })
    expect(result.skills.map(skill => skill.name)).toEqual(['my-skill'])
    expect(result.skills[0]!.description).toBe('A real skill.')
    expect(result.skills[0]!.baseDir).toBe(join(dir, 'my-skill'))
    expect(result.diagnostics.some((item: { message: string }) => item.message.includes('description is required'))).toBe(true)
  })
})

describe('vendored trust store', () => {
  it('persists nearest-ancestor trust decisions in a locked trust.json', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi2dsh-trust-'))
    cleanup.push(agentDir)
    const store = new ProjectTrustStore(agentDir)
    expect(store.get('/tmp/some/project')).toBeNull()
    store.set('/tmp/some', true)
    expect(store.get('/tmp/some/project')).toBe(true)
    expect(store.getEntry('/tmp/some/project')?.path).toBe('/tmp/some')
    store.set('/tmp/some/project', false)
    expect(store.get('/tmp/some/project')).toBe(false)
    store.setMany([{ path: '/tmp/some/project', decision: null }])
    expect(store.get('/tmp/some/project')).toBe(true)
  })
})

describe('vendored tool wrapper', () => {
  it('wraps a RegisteredTool with Pi\'s context factory and added-tool tracking', async () => {
    const active = [['a'], ['a', 'b']]
    let calls = 0
    const runner = {
      createContext: () => ({ marker: 'ctx' }),
      getActiveTools: () => active[Math.min(calls++, active.length - 1)]!,
    }
    const wrapped = wrapRegisteredTool({
      definition: {
        name: 'demo', label: 'Demo', description: 'd', parameters: {},
        execute: async (_id: string, params: unknown, _signal: AbortSignal, _update: unknown, ctx: { marker: string }) =>
          ({ content: [{ type: 'text', text: `ran with ${ctx.marker} ${JSON.stringify(params)}` }] }),
      },
    } as never, runner as never) as { execute(id: string, params: unknown, signal: AbortSignal, update?: unknown): Promise<{ content: Array<{ text: string }>; addedToolNames?: string[] }> }
    const result = await wrapped.execute('call-1', { x: 1 }, new AbortController().signal)
    expect(result.content[0]!.text).toBe('ran with ctx {"x":1}')
    // getActiveTools grew between before/after: Pi reports the added names.
    expect(result.addedToolNames).toEqual(['b'])
  })
})
