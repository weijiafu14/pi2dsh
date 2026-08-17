// A Pi package that touches every presentation surface Pi gives an extension,
// once, with Pi's exact signatures (coding-agent/src/core/extensions/types.ts).
//
// It is written the way a real Pi package is written — nothing in here knows
// DSH exists. Run it and each call shows up somewhere in the DSH web app; the
// README maps call → seat. The strings are deliberately unique so you can tell
// at a glance which surface drew which line.
export default function (pi) {
  // Renderers are registered at load time, not inside the command: Pi resolves
  // a renderer when the entry or message is drawn, so it has to be on file
  // before anything is appended.
  pi.registerMessageRenderer('demo-msg', (message, options, theme) => ({
    render: () => [`message(${message.customType}): custom message drawn by the package`],
  }))
  pi.registerEntryRenderer('demo-note', (entry, options, theme) => ({
    render: () => [`entry(${entry.customType}): ${entry.data?.note ?? ''}`],
  }))

  pi.registerCommand('surfaces', {
    description: 'Drive every Pi presentation surface once.',
    handler: async (args, ctx) => {
      // An @-mention source. Pi's autocomplete is a CHAIN: you are handed the
      // provider that is currently in place and return one that wraps it, so
      // falling through to `current` is how the rest of the menu keeps working.
      ctx.ui.addAutocompleteProvider(current => ({
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          const line = lines[cursorLine] ?? ''
          const before = line.slice(0, cursorCol)
          const at = before.lastIndexOf('@')
          if (at === -1) return current.getSuggestions(lines, cursorLine, cursorCol, options)
          const query = before.slice(at + 1)
          const all = [
            { value: 'demo-alpha', label: 'demo-alpha', description: 'first demo mention' },
            { value: 'demo-beta', label: 'demo-beta', description: 'second demo mention' },
          ]
          const items = all.filter(item => item.value.startsWith(query))
          return items.length === 0 ? null : { items, prefix: before.slice(at) }
        },
        applyCompletion: (...rest) => current.applyCompletion(...rest),
      }))

      // Session chrome.
      ctx.ui.setStatus('demo', 'status: demo is live')
      ctx.ui.setTitle('title: demo session')
      ctx.ui.setWidget('demo', ['widget: line one', 'widget: line two'])
      ctx.ui.setHeader(() => ({ render: () => ['header: built by factory'] }))
      ctx.ui.setFooter(() => ({ render: () => ['footer: built by factory'] }))

      // Working chrome. In Pi these paint while the agent is busy; the seat
      // holds them so you can see the text a package supplies.
      ctx.ui.setWorkingMessage('working: still thinking')
      ctx.ui.setWorkingIndicator({ frames: ['◐', '◓'] })
      ctx.ui.setHiddenThinkingLabel('thinking-label: hidden reasoning')

      // Content the package draws itself, through the two renderers above.
      pi.appendEntry('demo-note', { note: 'rendered by the package itself' })
      pi.sendMessage({ role: 'custom', customType: 'demo-msg', content: 'raw custom message' })

      // The composer. setEditorText replaces it, pasteToEditor appends at the
      // cursor, getEditorText reads it back.
      ctx.ui.setEditorText('composer: written by the package')
      ctx.ui.pasteToEditor(' + pasted')
      ctx.ui.notify(`surfaces driven; editor reads: ${ctx.ui.getEditorText()}`)
    },
  })
}
