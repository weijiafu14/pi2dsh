import * as llm from '@deepseek-ai/dsh-llm'

/** Bridge-owned message provenance, using DSH's public producer-source contract. */
export type PiMessageSource = llm.ContextFormed & {
  kind: 'pi2dsh'
  plugin: string
  piCustomType?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    pi2dsh: PiMessageSource
  }
}

/** A file is text on the Pi side, using the host's own execution-world locator. */
export function fileContentForPi(attachment: unknown, ctx?: { get(name: string): unknown }): { type: 'text', text: string } {
  const format = (llm as unknown as { fileHandleText?: (ref: unknown, path: string | undefined) => string }).fileHandleText
  if (format === undefined) throw new Error('pi2dsh: this DSH host cannot project file attachments')
  let path: string | undefined
  try {
    const store = ctx?.get('attachments') as { fileHostPath?(ref: unknown): string | undefined } | undefined
    const hostPath = store?.fileHostPath?.(attachment)
    const fs = ctx?.get('fs') as { processPathFromHostPath(path: string): string | undefined } | undefined
    if (hostPath !== undefined) path = fs?.processPathFromHostPath(hostPath)
  } catch {
    // The host's formatter explicitly reports an inaccessible attachment.
  }
  return { type: 'text', text: format(attachment, path) }
}
