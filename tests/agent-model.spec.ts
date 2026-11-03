import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentModel, modelSelectionProjectionDefinition } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { readAgentModel, selectAgentModel } from '../src/agent-model.js'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture(id: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd: process.cwd(), createdAt: Date.now() } })
  const model = new AgentModel(() => projection.stateOf(session), session, { provider: 'first', model: 'one' })
  return { ctx, session, agent: { model, session } }
}

describe('DSH-owned model choice', () => {
  it('reads a pending host choice before any model request and records Pi choices durably', async () => {
    const { agent, session } = await fixture('native-choice')
    expect(readAgentModel(agent)).toEqual({ provider: 'first', model: 'one' })
    selectAgentModel(agent, { provider: 'pi-provider', model: 'two', reasoningEffort: 'high' })
    expect(readAgentModel(agent)).toEqual({ provider: 'pi-provider', model: 'two', reasoningEffort: 'high' })
    agent.model.select({ provider: 'host-ui', model: 'three' })
    expect(readAgentModel(agent)).toEqual({ provider: 'host-ui', model: 'three' })
    const events = session.snapshotEvents()
    expect(events.filter(event => event.type === 'model/selection')).toHaveLength(2)
    expect(events.some(event => event.type === 'request/header')).toBe(false)
  })

  it('keeps child reasoning choices separate from the parent and sibling', async () => {
    const parent = await fixture('choice-parent')
    const child = await fixture('choice-child')
    const sibling = await fixture('choice-sibling')
    selectAgentModel(child.agent, { provider: 'first', model: 'one', reasoningEffort: 'high' })
    expect(readAgentModel(child.agent)?.reasoningEffort).toBe('high')
    expect(readAgentModel(parent.agent)?.reasoningEffort).toBeUndefined()
    expect(readAgentModel(sibling.agent)?.reasoningEffort).toBeUndefined()
  })

  it('does not pretend to select a model without the host service', () => {
    expect(readAgentModel({})).toBeUndefined()
    expect(() => selectAgentModel({}, { provider: 'test', model: 'one' })).toThrow('model-selection')
  })
})
