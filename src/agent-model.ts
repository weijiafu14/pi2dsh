import { PiCapabilityError } from './capability.js'

/** DSH owns model selection, including a choice not yet used by a request. */
export interface AgentModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

interface AgentModelSurface {
  current(): Readonly<AgentModelSelection> | undefined
  select(selection: Readonly<AgentModelSelection>): void
}

function modelSurface(agent: Record<string, unknown> | undefined): AgentModelSurface | undefined {
  const surface = agent?.model as Partial<AgentModelSurface> | undefined
  return surface !== undefined && typeof surface.current === 'function' && typeof surface.select === 'function'
    ? surface as AgentModelSurface : undefined
}

export function readAgentModel(agent: Record<string, unknown> | undefined): AgentModelSelection | undefined {
  const selected = modelSurface(agent)?.current()
  if (selected === undefined) return undefined
  return {
    provider: selected.provider,
    model: selected.model,
    ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
  }
}

export function selectAgentModel(agent: Record<string, unknown>, selection: AgentModelSelection): void {
  const surface = modelSurface(agent)
  if (surface === undefined) {
    throw new PiCapabilityError({
      capability: 'pi.setModel',
      reason: 'The active Agent has no public model-selection service.',
      guidance: 'Run this extension in a DSH 0.2.2 Agent composition.',
    })
  }
  surface.select({
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  })
}
