import assert from 'node:assert/strict'

export function toolPairs(records, name) {
  return records
    .filter(record => record.type === 'tool/call' && record.data?.name === name)
    .map(call => ({
      call,
      block: records.find(record => record.type === 'tool/result'
        && record.data?.message?.toolCallId === call.data.callId)?.data?.message,
    }))
    .filter(pair => pair.block !== undefined)
}

function argumentsOf(call) {
  try {
    const value = call.data?.arguments
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch { return undefined }
}

/** Search scripts can mention slow_task too. Require both a timeout result and
 * independent evidence that the real MCP server actually entered the handler. */
export function assertMcpScaleTimeout(records, elapsedMs, serverEvents, startedAt) {
  const candidates = toolPairs(records, 'mcpScript').filter(({ call }) => {
    const args = argumentsOf(call)
    return Number(args?.timeoutMs) === 5000 && /slow_task/u.test(String(args?.code ?? ''))
  })
  const timeout = candidates.find(({ block }) =>
    /mcpScript timed out after 5000ms/iu.test(JSON.stringify(block.content ?? '')))
  assert(timeout, 'no mcpScript slow_task invocation produced the real 5000ms timeout result; search results and unrelated errors do not count')

  const starts = serverEvents.filter(event => event.tool === 'slow_task'
    && event.phase === 'started' && event.at >= startedAt)
  assert(starts.length > 0, 'the real MCP server never started slow_task during the budget turn')
  assert(starts.every(start => !serverEvents.some(event => event.id === start.id && event.phase === 'completed')),
    'slow_task completed normally instead of remaining interrupted by the client budget')

  // The recovery call must follow the timed-out invocation in the same log.
  const timeoutIndex = records.indexOf(timeout.call)
  const followUp = toolPairs(records.slice(timeoutIndex + 1), 'mcp').find(({ block }) =>
    block.isError !== true && /tool_001 reporting in/u.test(JSON.stringify(block.content)))
  assert(followUp, 'after the timeout, tool_001 never answered through the MCP proxy')
  assert(elapsedMs < 110_000, `the timeout turn took ${Math.round(elapsedMs / 1000)}s — the ~120s tool was awaited, not budgeted`)
  return { timeoutCallId: timeout.call.data.callId, serverSlowStarts: starts.length }
}
