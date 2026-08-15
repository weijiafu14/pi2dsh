// Capability contract: Pi session-control operations run on DSH's OWN
// official surfaces, and what has no DSH mapping degrades legibly.
//
// The graded rules under test:
// - newSession/fork/navigateTree/switchSession are REAL: they create/fork/
//   target genuine DSH sessions (ctx.sessions.create / ctx.sessions.fork /
//   the live store), with the withSession callback bound to the replacement
//   session. Only a composition without a session service falls back to Pi's
//   own refusal channel ({ cancelled: true }).
// - shutdown() follows Pi's host-defined semantics: absorbed and reported,
//   the package keeps running.
// - reload() really remounts the package's extension entries.
// - compact() translates to the official DSH compaction service when one is
//   composed; without one the gap flows through Pi's onError callback.
// - Host-owned capabilities (ModelRuntime, DefaultPackageManager) throw a
//   structured PiCapabilityError; importing them is flagged at STARTUP, and
//   constructing them during entry setup marks the package unusable while
//   other entries keep Pi's per-entry isolation.
// - Every gap reaches the user ONCE per (package, capability).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { applyPiPackage } from '../src/runtime.js'
import { CapabilityLedger, PiCapabilityError } from '../src/capability.js'
import type { GeneratedRuntimeManifest } from '../src/types.js'

const cleanup: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function manifestFor(extensions: string[]): GeneratedRuntimeManifest {
  return {
    schemaVersion: 1,
    package: { name: 'pi-cap-probe', version: '1.0.0', source: 'test-fixture' },
    extensions,
    skillDirs: [],
    prompts: [],
  }
}

async function composeHost(options: { withSessions?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  if (options.withSessions !== false) await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  return ctx
}

interface TypedHost {
  sessions?: {
    create(id?: unknown, options?: Record<string, unknown>): { id: unknown; header: Record<string, unknown> }
    list(): Array<{ id: unknown; header: Record<string, unknown> }>
    get(id: unknown): unknown
  }
  commands: { execute(agent: never, input: string, signal: AbortSignal): Promise<{ result?: unknown } | undefined> }
}

function makeAgent(ctx: Context, root: string): Record<string, unknown> {
  const typed = ctx as unknown as TypedHost
  // Without a session service (the refusal-channel scenario) the command
  // runtime still needs an agent session to log against — a minimal stand-in.
  const session = typed.sessions?.create(SessionId('pi2dsh-capability-probe'), {
    meta: { createdAt: Date.now(), cwd: root },
  }) ?? { id: 'pi2dsh-capability-probe', events: [], append() {}, header: { cwd: root } }
  return {
    id: session.id,
    session,
    options: {},
    steer() {}, inject() {}, followup() {},
    whenIdle: () => Promise.resolve(),
    // The real DSH agent-loop agent exposes runMaintenance (compactNow's
    // idle-serialization requirement).
    runMaintenance: async <T,>(job: (signal: AbortSignal) => Promise<T>): Promise<T> =>
      job(new AbortController().signal),
  }
}

async function mountProbe(
  extensionSources: Record<string, string>,
  hostOptions: { withSessions?: boolean } = {},
): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pi2dsh-capability-'))
  cleanup.push(root)
  for (const [name, source] of Object.entries(extensionSources)) {
    await mkdir(join(root, name, '..'), { recursive: true })
    await writeFile(join(root, name), source)
  }
  const ctx = await composeHost(hostOptions)
  await applyPiPackage(ctx, {
    rootUrl: pathToFileURL(`${root}/`),
    manifest: manifestFor(Object.keys(extensionSources)),
  })
  return { ctx, root }
}

const resultText = (outcome: { result?: unknown } | undefined): string =>
  (outcome?.result as { text?: string } | undefined)?.text ?? ''

const SESSION_PROBE = `
  export default function probe(pi: any) {
    pi.registerCommand('cap-sessions', {
      description: 'Probe real session-control operations.',
      handler: async (_args: string, ctx: any) => {
        const out: any = {}
        let replacedId: string | undefined
        out.newSession = await ctx.newSession({
          withSession: async (replaced: any) => { replacedId = replaced.sessionManager.getSessionId?.() ?? 'no-id' },
        })
        out.replacedSeen = replacedId !== undefined
        out.fork = await ctx.fork('dsh-0')
        out.navigateTree = await ctx.navigateTree('dsh-0')
        out.shutdownThrew = false
        try { ctx.shutdown() } catch { out.shutdownThrew = true }
        try { await ctx.reload(); out.reloadOutcome = 'ok' } catch (error: any) { out.reloadOutcome = error.name }
        ctx.ui.notify(JSON.stringify(out), 'info')
      },
    })
    pi.registerCommand('cap-switch', {
      description: 'Probe switching to a live session.',
      handler: async (args: string, ctx: any) => {
        try {
          const result = await ctx.switchSession(args)
          ctx.ui.notify(JSON.stringify(result), 'info')
        } catch (error: any) {
          ctx.ui.notify(JSON.stringify({ threw: error.message }), 'info')
        }
      },
    })
  }
`

describe('capability ledger', () => {
  it('reports each (package, capability) once and never downgrades unusable', () => {
    const messages: string[] = []
    const ledger = new CapabilityLedger(message => messages.push(message))

    ledger.reportDegraded({ capability: 'ctx.x', reason: 'gap.', guidance: '', packageName: 'p' })
    ledger.reportDegraded({ capability: 'ctx.x', reason: 'gap.', guidance: '', packageName: 'p' })
    ledger.reportDegraded({ capability: 'ctx.y', reason: 'gap.', guidance: '', packageName: 'p' })
    expect(messages).toHaveLength(2)
    expect(ledger.healthOf('p')).toEqual({ status: 'degraded', gaps: ['ctx.x', 'ctx.y'] })

    ledger.reportUnusable({ capability: 'new ModelRuntime()', reason: 'host owns models.', guidance: '', packageName: 'p' })
    ledger.reportDegraded({ capability: 'ctx.z', reason: 'gap.', guidance: '', packageName: 'p' })
    expect(ledger.healthOf('p').status).toBe('unusable')

    // Host decisions and startup references inform without touching health.
    ledger.reportHostDecision({ capability: 'ctx.shutdown', reason: 'user owns exit.', guidance: '', packageName: 'q' })
    ledger.reportStartupReference({ capability: 'ModelRuntime', reason: 'host owns models.', packageName: 'q', guidance: '' })
    expect(ledger.healthOf('q')).toEqual({ status: 'ok', gaps: [] })
    expect(messages.some(message => message.includes('remove it: dsh plugin remove p'))).toBe(true)
  })
})

describe('session control on a real DSH composition', () => {
  it('really creates, forks, and navigates sessions on the official surfaces; shutdown absorbs; reload remounts', async () => {
    const warned: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warned.push(String(message)) })

    const { ctx, root } = await mountProbe({ 'probe.ts': SESSION_PROBE })
    const agent = makeAgent(ctx, root)
    const typed = ctx as unknown as TypedHost
    const before = typed.sessions!.list().length

    const outcome = await typed.commands.execute(agent as never, '/cap-sessions', new AbortController().signal)
    const parsed = JSON.parse(resultText(outcome)) as Record<string, unknown>
    expect(parsed.newSession).toEqual({ cancelled: false })
    expect(parsed.replacedSeen).toBe(true)
    expect(parsed.fork).toEqual({ cancelled: false })
    expect(parsed.navigateTree).toEqual({ cancelled: false })
    expect(parsed.shutdownThrew).toBe(false)
    // reload really remounts: the command that just ran was re-registered.
    expect(parsed.reloadOutcome).toBe('ok')

    // Three real sessions appeared (newSession + fork + navigateTree), each
    // carrying lineage back to the probe session.
    const after = typed.sessions!.list()
    expect(after.length).toBe(before + 3)
    const lineage = after
      .map(session => session.header.parentSession)
      .filter(parent => parent !== undefined)
    expect(lineage.every(parent => String(parent) === 'pi2dsh-capability-probe')).toBe(true)
    expect(lineage.length).toBe(3)

    // The command survived its own reload-remount and still executes.
    const again = await typed.commands.execute(agent as never, '/cap-sessions', new AbortController().signal)
    expect((JSON.parse(resultText(again)) as Record<string, unknown>).newSession).toEqual({ cancelled: false })

    // The user learned about the host-surface boundary once per capability.
    expect(warned.filter(message => message.includes('ctx.newSession'))).toHaveLength(1)
    const shutdownNotices = warned.filter(message => message.includes('ctx.shutdown'))
    expect(shutdownNotices).toHaveLength(1)
    expect(shutdownNotices[0]).not.toContain('remove')
  })

  it('switches to a live session by id or Pi-style path, and throws honestly for unknown sessions', async () => {
    const { ctx, root } = await mountProbe({ 'probe.ts': SESSION_PROBE })
    const typed = ctx as unknown as TypedHost
    typed.sessions!.create(SessionId('other-live-session'), { meta: { createdAt: Date.now(), cwd: root } })
    const agent = makeAgent(ctx, root)

    const byPath = await typed.commands.execute(agent as never, '/cap-switch /somewhere/other-live-session.jsonl', new AbortController().signal)
    expect(JSON.parse(resultText(byPath))).toEqual({ cancelled: false })

    const missing = await typed.commands.execute(agent as never, '/cap-switch nope.jsonl', new AbortController().signal)
    expect((JSON.parse(resultText(missing)) as { threw: string }).threw).toContain('no live DSH session')
  })

  it('falls back to Pi\'s refusal channel only when the composition has no session service', async () => {
    const warned: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warned.push(String(message)) })
    const { ctx, root } = await mountProbe({ 'probe.ts': SESSION_PROBE }, { withSessions: false })
    const agent = makeAgent(ctx, root)
    const typed = ctx as unknown as TypedHost
    const outcome = await typed.commands.execute(agent as never, '/cap-sessions', new AbortController().signal)
    const parsed = JSON.parse(resultText(outcome)) as Record<string, unknown>
    expect(parsed.newSession).toEqual({ cancelled: true })
    expect(parsed.fork).toEqual({ cancelled: true })
    expect(warned.some(message => message.includes('ctx.newSession') && message.includes('no session service'))).toBe(true)
  })
})

describe('compact translation', () => {
  it('routes the gap through Pi\'s onError callback when no compaction service is composed', async () => {
    const { ctx, root } = await mountProbe({
      'probe.ts': `
        export default function probe(pi: any) {
          pi.registerCommand('cap-compact', {
            description: 'Probe compact translation.',
            handler: async (_args: string, ctx: any) => {
              const seen: string[] = []
              await new Promise<void>(resolve => {
                ctx.compact({
                  onComplete: () => { seen.push('complete'); resolve() },
                  onError: (error: any) => { seen.push('error:' + error.name); resolve() },
                })
                setTimeout(resolve, 50)
              })
              ctx.ui.notify(JSON.stringify(seen), 'info')
            },
          })
        }
      `,
    })
    const agent = makeAgent(ctx, root)
    const typed = ctx as unknown as TypedHost
    const outcome = await typed.commands.execute(agent as never, '/cap-compact', new AbortController().signal)
    expect(JSON.parse(resultText(outcome) || '[]')).toEqual(['error:PiCapabilityError'])
  })

  it('translates to the composed DSH compaction service (official compactNow), projecting the real summary', async () => {
    const compactCalls: unknown[] = []
    const { ctx, root } = await mountProbe({
      'probe.ts': `
        export default function probe(pi: any) {
          pi.registerCommand('cap-compact-now', {
            description: 'Probe compact translation to a live service.',
            handler: async (_args: string, ctx: any) => {
              const result = await new Promise(resolve => {
                ctx.compact({
                  onComplete: (value: any) => resolve(value),
                  onError: (error: any) => resolve({ failed: error.message }),
                })
              })
              ctx.ui.notify(JSON.stringify(result), 'info')
            },
          })
        }
      `,
    })
    // Compose an official-shaped compaction service the way the resolver sees
    // services: through ctx.get (a plain property does not register one).
    const realGet = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
    const mockCompaction = {
      compactNow: async (agent: unknown, _signal: AbortSignal) => {
        compactCalls.push(agent)
        return {
          compactionId: 'cx-1',
          startSeq: 1, summarySeq: 2, endSeq: 3,
          summary: [{ type: 'text', text: 'the compacted summary' }],
          shadowedRange: { start: 1, end: 2 },
          shadowedSeqs: [1, 2],
          shadowedTokenCount: 321,
        }
      },
    }
    ;(ctx as unknown as { get(name: string): unknown }).get = (name: string) =>
      name === 'compaction' ? mockCompaction : realGet(name)
    const agent = makeAgent(ctx, root)
    const typed = ctx as unknown as TypedHost
    const outcome = await typed.commands.execute(agent as never, '/cap-compact-now', new AbortController().signal)
    expect(JSON.parse(resultText(outcome) || '{}')).toEqual({
      summary: 'the compacted summary',
      firstKeptEntryId: '',
      tokensBefore: 321,
    })
    expect(compactCalls).toHaveLength(1)
    expect(compactCalls[0]).toMatchObject({ options: {} })
  })
})

describe('host-owned capabilities', () => {
  it('flags the import at startup, keeps per-entry isolation, and marks the package unusable on setup construction', async () => {
    const warned: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warned.push(String(message)) })

    const { ctx, root } = await mountProbe({
      'good.ts': `
        export default function good(pi: any) {
          pi.registerCommand('cap-alive', {
            description: 'Still mounted.',
            handler: async (_args: string, ctx: any) => { ctx.ui.notify('alive', 'info') },
          })
        }
      `,
      'bad.ts': `
        import { ModelRuntime } from '@earendil-works/pi-coding-agent'
        export default function bad() {}
        // Setup-time construction of a host-owned stack: the mount itself fails.
        new (ModelRuntime as any)()
      `,
    })
    const agent = makeAgent(ctx, root)
    const typed = ctx as unknown as TypedHost

    // Startup check: the import alone was flagged BEFORE the entry ran.
    const startupNotices = warned.filter(message => message.includes('startup check'))
    expect(startupNotices).toHaveLength(1)
    expect(startupNotices[0]).toContain('ModelRuntime')

    // Pi's per-entry isolation: the healthy entry still works.
    const alive = await typed.commands.execute(agent as never, '/cap-alive', new AbortController().signal)
    expect(resultText(alive)).toBe('alive')

    // The user got the unusable verdict with the removal instruction.
    const verdicts = warned.filter(message => message.includes('could not start'))
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toContain('pi-cap-probe')
    expect(verdicts[0]).toContain('new ModelRuntime()')
    expect(verdicts[0]).toContain('dsh plugin remove pi-cap-probe')
  })

  it('constructing host-infrastructure classes throws a catchable structured error', async () => {
    const { ModelRuntime, DefaultPackageManager } = await import('../src/compat/pi-coding-agent.js')
    for (const Cls of [ModelRuntime, DefaultPackageManager]) {
      try {
        new (Cls as new () => never)()
        expect.unreachable('construction must throw')
      } catch (error) {
        expect(error).toBeInstanceOf(PiCapabilityError)
        expect(error).toBeInstanceOf(Error)
        expect((error as PiCapabilityError).name).toBe('PiCapabilityError')
      }
    }
  })
})
