type RecordValue = Record<string, unknown>

function captureFailure(failures: string[], name: string, callback: () => unknown): void {
  try {
    callback()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('requires a native DSH port')) failures.push(name)
  }
}

export default function runtimeEdgeExtension(pi: any): void {
  const registrationFailures: string[] = []
  pi.registerShortcut('ctrl+x', {})
  pi.registerProvider('fixture', {})
  pi.unregisterProvider('fixture')
  pi.registerMessageRenderer('fixture', {})
  pi.registerEntryRenderer('fixture', {})
  pi.registerMarkdownTransformer('fixture', {})

  for (const [name, callback] of [
    ['sendMessage', () => pi.sendMessage({})],
    ['sendUserMessage', () => pi.sendUserMessage('x')],
    ['appendEntry', () => pi.appendEntry({})],
    ['setSessionName', () => pi.setSessionName('x')],
    ['setLabel', () => pi.setLabel('x', 'y')],
    ['exec', () => pi.exec('x')],
    ['setActiveTools', () => pi.setActiveTools([])],
    ['setModel', () => pi.setModel('x')],
    ['setThinkingLevel', () => pi.setThinkingLevel('high')],
  ] as Array<[string, () => unknown]>) captureFailure(registrationFailures, name, callback)

  const dispose = pi.events.on('runtime-edge', () => Promise.reject(new Error('expected fixture rejection')))
  pi.events.emit('runtime-edge', {})
  dispose()

  pi.registerTool({
    name: 'pi_context_probe',
    description: 'Exercise explicit headless context behavior.',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    executionMode: 'parallel',
    prepareArguments: (args: RecordValue) => ({ ...args, prepared: true }),
    async execute(_id: string, args: RecordValue, _signal: AbortSignal, onUpdate: (value: unknown) => void, ctx: any) {
      onUpdate({ content: [{ type: 'text', text: 'partial' }] })
      ctx.ui.setStatus('fixture', 'working')
      ctx.ui.setWidget('fixture', [])
      const unavailable: string[] = []
      for (const [name, callback] of [
        ['select', () => ctx.ui.select('x', [])],
        ['confirm', () => ctx.ui.confirm('x', 'y')],
        ['input', () => ctx.ui.input('x')],
        ['custom', () => ctx.ui.custom({})],
        ['abort', () => ctx.abort()],
        ['shutdown', () => ctx.shutdown()],
        ['compact', () => ctx.compact()],
      ] as Array<[string, () => unknown]>) {
        try {
          await callback()
        } catch (error) {
          if (String(error).includes('requires a native DSH port')) unavailable.push(name)
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({
          args,
          cwd: ctx.cwd,
          entries: ctx.sessionManager.getEntries(),
          label: ctx.sessionManager.getLabel(),
          idle: ctx.isIdle(),
          trusted: ctx.isProjectTrusted(),
          pending: ctx.hasPendingMessages(),
          usage: ctx.getContextUsage(),
          systemPrompt: ctx.getSystemPrompt(),
          unavailable,
        }) }],
        details: { unavailable },
      }
    },
  })

  pi.registerTool({
    name: 'pi_mutation_probe',
    description: 'Exercise rejected pre-tool argument mutation.',
    parameters: { type: 'object', properties: { value: { type: 'string' } } },
    async execute() { return { content: [{ type: 'text', text: 'must not execute' }] } },
  })

  pi.registerTool({
    name: 'pi_post_block_probe',
    description: 'Exercise success-to-error post-tool mapping.',
    parameters: { type: 'object', properties: {} },
    async execute() { return { content: [{ type: 'text', text: 'initial success' }] } },
  })

  pi.registerCommand('pi-context-probe', {
    description: '',
    argumentHint: '<value>',
    async handler(_input: string, ctx: any) {
      await ctx.waitForIdle()
      const unavailable: string[] = []
      for (const [name, callback] of [
        ['newSession', () => ctx.newSession()],
        ['fork', () => ctx.fork()],
        ['navigateTree', () => ctx.navigateTree()],
        ['switchSession', () => ctx.switchSession()],
        ['reload', () => ctx.reload()],
      ] as Array<[string, () => unknown]>) captureFailure(unavailable, name, callback)
      ctx.ui.notify(JSON.stringify({ options: ctx.getSystemPromptOptions(), unavailable }))
    },
  })

  pi.on('before_agent_start', () => ({ message: { role: 'user', content: 'ignored fixture message' } }))
  pi.on('tool_call', (event: RecordValue) => {
    if (event.toolName === 'pi_mutation_probe') (event.input as RecordValue).value = 'mutated'
  })
  pi.on('tool_result', (event: RecordValue) => {
    if (event.toolName === 'pi_post_block_probe') {
      return { isError: true, content: [{ type: 'text', text: 'blocked after execution' }] }
    }
    if (event.toolName === 'pi_error') return { isError: false }
  })

  pi.registerTool({
    name: 'pi_api_probe',
    description: 'Report registration-time API behavior.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: JSON.stringify({
        registrationFailures,
        sessionName: pi.getSessionName(),
        thinking: pi.getThinkingLevel(),
        active: pi.getActiveTools(),
        all: pi.getAllTools().map((tool: RecordValue) => tool.name),
        commands: pi.getCommands().map((command: RecordValue) => command.name),
      }) }] }
    },
  })
}
