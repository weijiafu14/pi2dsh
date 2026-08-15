// @ts-nocheck — vendored Pi source (coding-agent src/core/tools/tool-definition-wrapper.ts +
// src/core/extensions/wrapper.ts @6f707eb36064e82af9c1320a7634f4dfad21049b, MIT, see ./PI-LICENSE);
// logic unchanged. The `runner` parameter is typed structurally: Pi's own code uses exactly
// createContext() and getActiveTools() from ExtensionRunner, which the pi2dsh projection provides.

/** Wrap a ToolDefinition into an AgentTool for the core runtime. */
export function wrapToolDefinition(definition, ctxFactory) {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    constrainedSampling: definition.constrainedSampling,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      definition.execute(toolCallId, params, signal, onUpdate, ctx ?? ctxFactory?.()),
  }
}

/** Wrap multiple ToolDefinitions into AgentTools for the core runtime. */
export function wrapToolDefinitions(definitions, ctxFactory) {
  return definitions.map(definition => wrapToolDefinition(definition, ctxFactory))
}

/**
 * Wrap a RegisteredTool into an AgentTool.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTool(registeredTool, runner) {
  const tool = wrapToolDefinition(registeredTool.definition, () => runner.createContext())
  const execute = tool.execute
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const activeBefore = runner.getActiveTools()
      const result = await execute(toolCallId, params, signal, onUpdate)
      const activeAfter = runner.getActiveTools()
      if (!activeBefore.every(name => activeAfter.includes(name))) return result

      const beforeNames = new Set(activeBefore)
      const addedToolNames = activeAfter.filter(name => !beforeNames.has(name))
      if (addedToolNames.length === 0) return result
      return {
        ...result,
        addedToolNames: [...new Set([...(result.addedToolNames ?? []), ...addedToolNames])],
      }
    },
  }
}

/**
 * Wrap all registered tools into AgentTools.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTools(registeredTools, runner) {
  return registeredTools.map(tool => wrapRegisteredTool(tool, runner))
}
