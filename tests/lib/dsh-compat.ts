// Two-generation shims for symbols the DSH lines spell differently.
//
// 0.1.2-alpha renamed the tool-call id brand: `CallId` (rc lines) became
// `ToolCallId` (packages/llm/llm/src/brand.ts at dsh-v0.1.2-alpha.1). One
// test tree runs against whichever line the devDependencies install, so the
// constructor is resolved by capability, never by version sniffing.
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as llm from '@deepseek-ai/dsh-llm'

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
  if (inject.includes('sessionProjections')) {
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
