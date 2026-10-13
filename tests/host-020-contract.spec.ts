import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import LlmRuntime, { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mountAgentLoop } from './lib/dsh-compat.js'
import { createBridgedAgentSession, type SubagentHost } from '../src/subagent-bridge.js'
import { dshRequestToPiContext, piRequestToDshMessages } from '../src/model-bridge.js'
import { runtimeInternals } from '../src/runtime.js'

describe('DSH 0.2 published service contracts', () => {
  it('resolves native model credentials from modern Settings.describe, with no removed get() API', async () => {
    const refs: string[] = []
    const services: Record<string, unknown> = {
      llm: { listConfigurableProviders: () => [{ provider: 'native', settingsNs: 'model-owner', settingsPath: ['providers', 'native'] }] },
      settings: { describe: () => [{ ns: 'model-owner', value: { providers: { native: { apiKeyEnv: 'TEST_CREDENTIAL_REF' } } } }] },
      credentials: { resolve: async (ref: string) => { refs.push(ref); return { value: 'fixture-only-secret' } } },
    }
    expect(await runtimeInternals.resolveHostModelAuth({ get: name => services[name] }, 'native'))
      .toEqual({ ok: true, apiKey: 'fixture-only-secret' })
    expect(refs).toEqual(['TEST_CREDENTIAL_REF'])
    expect(await runtimeInternals.resolveHostModelAuth({ get: name => services[name] }, 'unknown'))
      .toEqual({ ok: false })
  })
  it('refuses unsupported developer history instead of silently losing instructions', async () => {
    await expect(dshRequestToPiContext({ messages: [{ role: 'developer', content: [{ type: 'text', text: 'keep this restriction' }] }] }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })
  it('surfaces a failed native child turn to Pi consumers instead of completing with empty history', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await mountAgentLoop(ctx)
    const host: SubagentHost = {
      cordis: ctx, cwd: () => process.cwd(), parentSessionId: () => undefined,
      parentDelegationDepth: () => 0, parentAgentContext: () => undefined,
      parentModelRoute: () => ({ provider: 'missing-test-provider', model: 'model-identity-probe' }),
      delegatedPolicyOverrides: () => ({}), registerChildTools: () => {},
      piContentToDsh: async content => content as never,
      deliver: (agent, message, mode) => {
        ;(agent[mode] as (message: unknown) => void).call(agent, message)
      },
      messageFromSessionEvent: async () => undefined,
      messageSource: 'pi2dsh:contract',
    }
    const created = await createBridgedAgentSession(host, { systemPrompt: 'Contract probe', noTools: true })
    try {
      await created.session.prompt('Trigger the missing-provider failure')
      expect(created.session.messages.at(-1)).toMatchObject({
        role: 'assistant', stopReason: 'error', errorMessage: expect.stringContaining('missing-test-provider'),
      })
      expect(created.session.state.model).toMatchObject({ provider: 'missing-test-provider', id: 'model-identity-probe' })
      // A resumed failure must belong to this call as well; the first error
      // cannot be reused as a successful empty second invocation.
      await created.session.prompt('Try another native turn')
      expect(created.session.messages).toHaveLength(2)
      expect(created.session.messages[1]).toMatchObject({ stopReason: 'error' })
    } finally { await created.session.dispose() }
  })

  it('round-trips the native tool role without losing results, identity or failure status', async () => {
    const native = createToolResultMessage({
      callId: ToolCallId('native-result'),
      content: [{ type: 'text', text: 'specific failed-tool diagnostic' }], isError: true,
    })
    const pi = await dshRequestToPiContext({ messages: [native] })
    expect(pi.messages).toEqual([{
      role: 'toolResult', toolCallId: 'native-result',
      content: [{ type: 'text', text: 'specific failed-tool diagnostic' }], isError: true,
    }])
    const roundTrip = piRequestToDshMessages(pi)
    expect(roundTrip.messages[0]).toMatchObject({
      role: 'tool', toolCallId: native.toolCallId, source: native.source,
      content: native.content, isError: true,
    })
  })
})
