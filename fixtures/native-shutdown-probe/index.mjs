// Minimal native-only reproduction: no Pi or bridge imports, no alternate adapter.
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
export const name = 'native-shutdown-probe'
export const inject = ['llm', 'credentials', 'settings', 'commands', 'agents', 'agentDefaultModel']
export function apply(ctx) {
  const llm = ctx.llm
  const credentials = ctx.credentials
  const settings = ctx.settings
  let live
  let route
  let prepared
  ctx.commands.register({
    name: 'native-session-flush-probe',
    description: 'Test an owned native Agent disposal while the host remains alive',
    input: { hint: 'a synthetic project nickname' },
    async handler(invocation) {
      const selection = ctx.agentDefaultModel.currentSelection()
      const sessionId = `native-flush-${randomUUID()}`
      const handle = await ctx.agents.create({ sessionId, meta: { cwd: invocation.agent.session.header.cwd },
        agentOptions: { provider: selection.provider, model: selection.model },
      })
      try {
        await handle.agent.whenIdle()
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: `Our permanent public project nickname is ${invocation.rawInput.trim()}. Reply ACK without using any tools.` }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
      } finally { await handle.dispose() }
      return { kind: 'success', text: sessionId }
    },
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'request/header') return
    const config = event.data.header?.config ?? event.data.config ?? event.data.header
    if (!config?.provider || !config?.model) return
    route = { provider: config.provider, model: config.model }
    live = { providers: llm.listProviders().map(p => p.id), settingsPresent: settings.get('llm-deepseek') !== undefined }
    if (process.env.NATIVE_SHUTDOWN_PROBE_OUT) prepared = llm.prepareCall({ ...route, reasoningEffort: 'off' }).catch(error => ({ error: error.message }))
  })
  ctx.effect(() => async () => {
    if (!route || !process.env.NATIVE_SHUTDOWN_PROBE_OUT) return
    const output = { live, route, phase: 'public-async-disposer' }
    try { output.providers = llm.listProviders().map(p => p.id) } catch (e) { output.directoryError = e.message }
    try { output.credentialResolved = Boolean((await credentials.resolve('DEEPSEEK_API_KEY'))?.value) } catch (e) { output.credentialError = e.message }
    try { output.settingsPresent = settings.get('llm-deepseek') !== undefined } catch (e) { output.settingsError = e.message }
    try {
      for await (const chunk of llm.stream({ ...route, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply NATIVE_EXIT_OK.' }], source: { kind: 'user' } }], signal: AbortSignal.timeout(1500) })) {
        if (chunk.type === 'finish') output.finish = chunk.reason
      }
    } catch (e) { output.modelError = { name: e.name, message: e.message, code: e.code } }
    // Also inspect the distinct pre-bound-call seam; do not confuse keeping
    // an earlier dispatch generation with starting arbitrary new exit work.
    try {
      const held = await prepared
      if (held?.stream) {
        for await (const chunk of held.stream({ ...held.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply PREPARED_EXIT_OK.' }], source: { kind: 'user' } }], signal: AbortSignal.timeout(1500) })) {
          if (chunk.type === 'finish') output.preparedFinish = chunk.reason
        }
      } else output.preparedError = held?.error
    } catch (e) { output.preparedError = e.message }
    writeFileSync(process.env.NATIVE_SHUTDOWN_PROBE_OUT, JSON.stringify(output, null, 2), { mode: 0o600 })
  })
}
