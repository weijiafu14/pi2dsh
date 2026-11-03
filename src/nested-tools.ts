import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'

type RecordValue = Record<string, unknown>
export interface NestedToolOutcome {
  toolCall: { type: string, id: string, name: string, arguments: unknown }
  result: RecordValue
  isError: boolean
}
export interface NestedToolOptions { signal?: AbortSignal, onUpdate?: (value: unknown) => void }
const identities = new Map<symbol, string>()
const updates = new Map<symbol, (value: unknown) => void>()

export function parentPiToolCallId(exec: ToolExecution): string | undefined {
  return exec.parent === undefined ? undefined : identities.get(exec.parent)
}

export function publishNestedToolUpdate(exec: ToolExecution, value: unknown): void {
  updates.get(exec.token)?.(value)
}

/** Keep correlation scoped to the real host execution, including concurrent nested calls. */
export async function withPiToolIdentity<T>(exec: ToolExecution, run: () => Promise<T>): Promise<T> {
  identities.set(exec.token, String(exec.callId))
  try { return await run() } finally { identities.delete(exec.token) }
}

/** Pi nested calls run through DSH's public policy/validation/settlement pipeline. */
export function nestedToolCaller(
  ctx: Context,
  parent: ToolRunContext,
  projectContent: (content: unknown) => Promise<unknown>,
  projectArguments: (name: string, args: unknown) => unknown,
): (name: string, args: unknown, options?: NestedToolOptions) => Promise<NestedToolOutcome> {
  let index = 0
  return async (name: string, args: unknown, options: NestedToolOptions = {}): Promise<NestedToolOutcome> => {
    const id = `${parent.callId}/${++index}`
    const toolCall = { type: 'toolCall', id, name, arguments: args }
    try {
      const signal = options.signal === undefined ? parent.signal : AbortSignal.any([parent.signal, options.signal])
      const pipeline = new ToolExecutionPipeline(ctx)
      const prepared = await pipeline.prepare({
        callId: ToolCallId(id), rootCallId: parent.rootCallId, parent: parent.token,
        name, arguments: projectArguments(name, args), signal,
        ...(parent.agent === undefined ? {} : { agent: parent.agent }),
        ...(parent.toolSet === undefined ? {} : { toolSet: parent.toolSet }),
      })
      if (options.onUpdate !== undefined) updates.set(prepared.exec.token, options.onUpdate)
      try {
        const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
        const result = await pipeline.complete(prepared.exec, outcome)
        for (const context of result.additionalContexts ?? []) parent.deferContext(context)
        if (!result.isError && result.concludesTurn) parent.concludeTurn()
        const value = !result.isError && typeof result.value === 'object' && result.value !== null
          ? result.value as RecordValue : undefined
        return { toolCall, isError: result.isError, result: {
          content: await projectContent(result.content), details: result.meta,
          ...(value?.structuredContent === undefined ? {} : { structuredContent: value.structuredContent }),
          ...(result.isError ? { isError: true } : {}),
        } }
      } finally { updates.delete(prepared.exec.token) }
    } catch (error) {
      return { toolCall, isError: true, result: { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], details: undefined, isError: true } }
    }
  }
}
