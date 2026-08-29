// Two-generation shims for symbols the DSH lines spell differently.
//
// 0.1.2-alpha renamed the tool-call id brand: `CallId` (rc lines) became
// `ToolCallId` (packages/llm/llm/src/brand.ts at dsh-v0.1.2-alpha.1). One
// test tree runs against whichever line the devDependencies install, so the
// constructor is resolved by capability, never by version sniffing.
import * as llm from '@deepseek-ai/dsh-llm'

type IdCtor = (id: string) => never

const resolved = (llm as unknown as { CallId?: IdCtor }).CallId
  ?? (llm as unknown as { ToolCallId?: IdCtor }).ToolCallId
if (resolved === undefined) {
  throw new Error('neither CallId (rc) nor ToolCallId (0.1.2) is exported by @deepseek-ai/dsh-llm')
}
/** The installed line's tool-call id constructor. */
export const CallId = resolved

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
