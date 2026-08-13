import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const counters: Record<string, number> = {}

function count(name: string): void {
  counters[name] = (counters[name] ?? 0) + 1
}

export default function completeFixture(pi: ExtensionAPI): void {
  pi.events.on('fixture-ready', () => { count('package_event') })
  pi.events.emit('fixture-ready', { ready: true })

  pi.registerFlag('fixture-mode', {
    description: 'Exercise migrated flag defaults.',
    type: 'string',
    default: 'safe',
  })
  if (pi.getFlag('fixture-mode') === 'safe') count('flag_default')

  pi.registerTool({
    name: 'pi_greet',
    label: 'Pi greet',
    description: 'Greet one person through a migrated Pi tool.',
    parameters: Type.Object({
      name: Type.String({ description: 'Person to greet' }),
    }),
    executionMode: 'parallel',
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      count('tool_execute')
      return {
        content: [{ type: 'text', text: `Hello, ${params.name}!` }],
        details: { greeted: params.name },
      }
    },
  })

  pi.registerTool({
    name: 'pi_probe',
    label: 'Pi probe',
    description: 'Return migrated extension lifecycle counters.',
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: 'text', text: JSON.stringify(counters) }],
        details: counters,
      }
    },
  })

  pi.registerTool({
    name: 'pi_error',
    label: 'Pi error',
    description: 'Return a Pi-native tool error for INOUT verification.',
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: 'text', text: 'PI2DSH_PI_ERROR_OK' }],
        details: { piOnly: true },
        isError: true,
      }
    },
  })

  pi.registerCommand('pi-hello', {
    description: 'Exercise a migrated Pi slash command.',
    handler: async (args, ctx) => {
      count('command')
      ctx.ui.notify(`Pi command says hello to ${args || 'world'}`, 'info')
    },
  })

  pi.on('session_start', () => { count('session_start') })
  pi.on('session_shutdown', () => { count('session_shutdown') })
  pi.on('agent_start', () => { count('agent_start') })
  pi.on('agent_end', () => { count('agent_end') })
  pi.on('agent_settled', () => { count('agent_settled') })
  pi.on('turn_start', () => { count('turn_start') })
  pi.on('turn_end', () => { count('turn_end') })
  pi.on('message_start', () => { count('message_start') })
  pi.on('message_end', () => { count('message_end') })
  pi.on('tool_execution_start', () => { count('tool_execution_start') })
  pi.on('tool_execution_end', () => { count('tool_execution_end') })

  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\nMigrated Pi system prompt hook active.`,
  }))

  pi.on('tool_call', event => {
    count('tool_call')
    if (event.toolName === 'pi_greet' && event.input.name === 'blocked') {
      return { block: true, reason: 'blocked by migrated Pi hook' }
    }
  })

  pi.on('tool_result', event => {
    count('tool_result')
    if (event.toolName !== 'pi_greet' || event.isError) return
    return {
      content: [...event.content, { type: 'text', text: 'Result passed through migrated Pi hook.' }],
    }
  })
}
