/** The plain JSONL generations emitted by the stock persistence provider. */
export const isSessionLog = path => /(?:^|\/)session(?:\.v[0-9]+)?\.jsonl$/u.test(path)

/** System text only from the host's authoritative log, never an assistant answer. */
export function systemPromptText(record) {
  if (record.type === 'request/header') return String(record.data?.header?.system ?? '')
  if (record.type !== 'system/message') return ''
  return (record.data?.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
}
