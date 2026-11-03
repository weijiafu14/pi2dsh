// Two-generation shims for symbols the DSH lines spell differently.
//
// 0.1.2-alpha renamed the tool-call id brand: `CallId` (rc lines) became
// `ToolCallId` (packages/llm/llm/src/brand.ts at dsh-v0.1.2-alpha.1). One
// test tree runs against whichever line the devDependencies install, so the
// constructor is resolved by capability, never by version sniffing.
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as llm from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import ToolRuntime, { type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'

/** Session projections must be active before AgentRegistry publishes its API. */
export async function mountSessions(ctx: Context): Promise<void> {
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
}

/** The stock 0.2.2 composition separates registration from execution. */
export async function mountTools(ctx: Context): Promise<void> {
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
}

/** One-call batch through the real host executor, with unchanged assertions. */
export async function executeTool(ctx: unknown, input: Omit<ToolExecutionInput, 'agent'> & { agent?: unknown }): Promise<ToolExecutionResult> {
  const host = ctx as Context
  const batch = await host.tools.execute({
    calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
    signal: input.signal,
    ...(input.agent === undefined ? {} : { agent: input.agent as NonNullable<ToolExecutionInput['agent']> }),
    ...(input.toolSet === undefined ? {} : { toolSet: input.toolSet }),
  })
  const result = batch.results.find(item => item.callId === input.callId)
  if (result === undefined) throw new Error(`host executor omitted ${input.callId}`)
  return result.result
}

type IdCtor = (id: string) => never

const resolved = (llm as unknown as { CallId?: IdCtor }).CallId
  ?? (llm as unknown as { ToolCallId?: IdCtor }).ToolCallId
if (resolved === undefined) {
  throw new Error('neither CallId (rc) nor ToolCallId (0.1.2) is exported by @deepseek-ai/dsh-llm')
}
/** The installed line's tool-call id constructor. */
export const CallId = resolved

interface PluginHost { plugin(plugin: never, config?: never): Promise<unknown> }

/**
 * Mount the agent-loop plugin with whatever service prerequisites the
 * installed line declares. 0.1.2-alpha.2 added `sessionProjections` to the
 * loop's inject list (provided by the new `@deepseek-ai/dsh-session-projection`
 * package, a peer of agent-loop on that line); the rc lines have no such
 * service. Capability-selected from the plugin's own `inject` declaration,
 * never by version sniffing — and the provider import uses a variable
 * specifier so the alpha-only package stays out of the rc trees' module
 * graph (it only needs to be installed where the inject list demands it).
 */
export async function mountAgentLoop(ctx: unknown, config: unknown = {}): Promise<void> {
  const host = ctx as PluginHost
  const inject = (AgentLoop as { inject?: readonly string[] }).inject ?? []
  if (inject.includes('sessionProjections') && (ctx as Context).get('sessionProjections') === undefined) {
    const entry = '@deepseek-ai/dsh-session-projection'
    const provider = await import(entry) as { default: unknown }
    await host.plugin(provider.default as never)
  }
  await host.plugin(AgentLoop as never, config as never)
}

interface FixtureQuestion { id: string, question: string, detail?: string }
interface FixtureRequest { questions: FixtureQuestion[], signal?: AbortSignal }
interface FixtureAnswer {
  answers: Array<{ id: string, selected: string[], custom?: string }>
}

/**
 * Register a test answerer for user questions on whichever seam the
 * installed line exposes: the rc lines' provider slot, or the 0.1.2 line's
 * `user-questions/request` waterfall (a root listener answers every agent).
 * The answer-item shape (id/selected/custom) is identical across lines.
 */
export function registerFixtureAnswerer(
  ctx: unknown,
  answer: (request: FixtureRequest) => FixtureAnswer | Promise<FixtureAnswer>,
): void {
  const service = (ctx as { userQuestions?: { registerProvider?(p: unknown): void } }).userQuestions
  if (typeof service?.registerProvider === 'function') {
    service.registerProvider({ ask: async (request: FixtureRequest) => answer(request) })
    return
  }
  ;(ctx as { on(event: string, listener: (...args: never[]) => unknown): void })
    .on('user-questions/request', (async (request: FixtureRequest) => answer(request)) as never)
}
