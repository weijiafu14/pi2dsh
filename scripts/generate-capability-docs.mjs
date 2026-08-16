// Generate docs/capabilities/*.md from the bridge's own compatibility rules.
//
//   node scripts/generate-capability-docs.mjs        # write
//   node scripts/generate-capability-docs.mjs --check # fail if stale (CI)
//
// The per-surface tables are DERIVED, never hand-written: the rules in
// src/compatibility.ts are what the runtime consults and what `pi2dsh matrix`
// reports, so a mapping cannot drift from its documentation. Prose lives in
// PROSE below, beside the group it introduces.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'docs', 'capabilities')
const check = process.argv.includes('--check')

const { API_RULES, EVENT_RULES, CONTEXT_RULES, UI_CONTEXT_RULES, HOST_IMPORT_RULES } =
  await import(join(root, 'dist', 'index.mjs'))

/** Every rule as one flat list, tagged with the surface it belongs to. */
const surfaces = [
  ...Object.entries(API_RULES).map(([name, rule]) => ({ name, rule, kind: 'pi.*' })),
  ...Object.entries(EVENT_RULES).map(([name, rule]) => ({ name, rule, kind: 'event' })),
  ...Object.entries(CONTEXT_RULES).map(([name, rule]) => ({ name, rule, kind: 'ctx.*' })),
  ...Object.entries(UI_CONTEXT_RULES).map(([name, rule]) => ({ name, rule, kind: 'ctx.ui.*' })),
]

// One capability area per file. `members` lists surface names exactly as the
// rules key them; every rule must land in exactly one area (asserted below),
// so a new surface cannot silently escape the docs.
const AREAS = [
  {
    file: 'tools',
    title: 'Tools',
    members: [
      'registerTool', 'unregisterTool', 'getActiveTools', 'getAllTools', 'setActiveTools',
      'tool_execution_start', 'tool_execution_end', 'tool_execution_update', 'tool_call', 'tool_result',
      'user_bash', 'exec',
    ],
  },
  {
    file: 'commands',
    title: 'Commands, flags and editor input',
    members: [
      'registerCommand', 'getCommands', 'registerShortcut', 'registerFlag', 'getFlag', 'input',
      'addAutocompleteProvider', 'onTerminalInput', 'pasteToEditor', 'setEditorText', 'getEditorText',
      'setEditorComponent', 'getEditorComponent',
    ],
  },
  {
    file: 'conversation',
    title: 'Messages, context and the agent loop',
    members: [
      'sendMessage', 'sendUserMessage', 'message_start', 'message_end', 'message_update',
      'before_agent_start', 'context', 'agent_start', 'agent_settled', 'agent_end',
      'turn_start', 'turn_end', 'getContextUsage', 'getSystemPrompt', 'getSystemPromptOptions',
      'hasPendingMessages', 'isIdle', 'waitForIdle', 'abort', 'signal',
    ],
  },
  {
    file: 'sessions',
    title: 'Sessions, branching and side conversations',
    members: [
      'appendEntry', 'setSessionName', 'getSessionName', 'setLabel',
      'session_start', 'session_shutdown', 'session_info_changed',
      'newSession', 'fork', 'navigateTree', 'switchSession',
      'session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree',
      'compact', 'session_before_compact', 'session_compact',
      'shutdown', 'reload', 'sessionManager', 'cwd', 'mode', 'hasUI',
    ],
  },
  {
    file: 'models',
    title: 'Models, providers and credentials',
    members: [
      'registerProvider', 'unregisterProvider', 'setModel', 'getThinkingLevel', 'setThinkingLevel',
      'model', 'scopedModels', 'modelRegistry', 'hasConfiguredAuth', 'thinkingLevel',
      'model_select', 'thinking_level_select',
      'before_provider_request', 'before_provider_headers', 'after_provider_response',
    ],
  },
  {
    file: 'interaction',
    title: 'Asking the user, and rendering',
    members: [
      'select', 'confirm', 'input', 'notify', 'editor', 'custom',
      'registerMessageRenderer', 'registerEntryRenderer', 'registerMarkdownTransformer',
      'setStatus', 'setWidget', 'setWorkingMessage', 'setWorkingVisible', 'setWorkingIndicator',
      'setHiddenThinkingLabel', 'setFooter', 'setHeader', 'setTitle',
      'theme', 'getAllThemes', 'getTheme', 'setTheme', 'getToolsExpanded', 'setToolsExpanded',
    ],
  },
  {
    file: 'environment',
    title: 'Project environment, skills and resources',
    members: ['isProjectTrusted', 'project_trust', 'resources_discover', 'events'],
  },
]

// `input` is both an event (raw input transform) and ctx.ui.input (a prompt).
// Route each occurrence by the surface it belongs to rather than by name.
const AREA_BY_KIND_OVERRIDE = { input: { event: 'commands', 'ctx.ui.*': 'interaction' } }

const PROSE = {
  tools: `Pi packages contribute tools and observe every tool call. Both map
onto DSH's own tool registry and its durable tool events, so a migrated tool
is indistinguishable from a native one at the call site: the model sees it in
the same catalog, the loop runs it through the same permission and sandbox
path, and results land in the session log in DSH's own shapes.`,
  commands: `Slash commands, flags and editor-side input. Commands register
into DSH's command registry, so they appear in the CLI and in the web
command palette. Every bridged command declares an input descriptor, which is
what lets \`/name <arguments>\` parse as a command in the web app instead of
being sent as chat. Pi's never-throw collision behaviour is preserved.`,
  conversation: `The turn itself: injecting messages, transforming what enters
a step, and observing the loop. These map onto DSH's waterfalls and durable
events. Nothing here fabricates a result — where DSH has no equivalent moment,
the surface is registered and stated as never firing rather than faked.`,
  sessions: `Session lifecycle: naming, branching, switching, compaction and
child sessions. These run on DSH's own session services
(\`ctx.sessions.create/fork\`, \`ctx.compaction.compactNow\`, Cordis reload),
so a Pi package's branch really is a DSH session with lineage — visible in the
session list, resumable, and compactable by the host.

A package that opens a side conversation gets DSH's native subagent UI: the
child records the host's own identity event, so it is listed, named after the
package, opened in its own view and continuable. See
[\`examples/side-conversation\`](../../examples/side-conversation/).`,
  models: `Model directory, provider registration, credentials and per-request
overrides. There is exactly ONE model directory — DSH's llm configuration — and
Pi's registry is its projection, so a package never reaches a model except
through a route in that directory.

Which code carries the bytes depends on the provider. A package that only
declares a catalog gets no transport from the bridge: its models are served by
the host's own adapters and DSH credentials. A package that brings its own
transport (pi-ai's \`createProvider\`) becomes a real DSH route through
\`llm.registerAdapter\`, and from then on **that package's HTTP client carries
the turn, with its key resolved by Pi's credential chain and persisted in the
bridge's \`auth.json\`** rather than by DSH credentials. Worth knowing if you
audit where your keys go. Interactive OAuth flows from the Pi ecosystem run on
DSH-native interaction and persist with Pi's \`auth.json\` semantics.`,
  interaction: `Asking the user something, and drawing. Questions
(\`select\` / \`confirm\` / \`input\`) become real DSH user questions that
genuinely block the turn. Terminal decoration (footer, statusline, themes,
shortcuts) registers and never fires — exactly as in Pi's own non-terminal
modes. Plugin-drawn cards are the one Pi UI surface pi2dsh does not draw yet.`,
  environment: `Project trust and dynamic resource discovery — the two places
where the host, not the package, owns the decision. Skills declared by a Pi
package are loaded through DSH's own skill filesystem; MCP servers declared in
Pi config are translated into official \`dsh-mcp-client\` entries by
\`pi2dsh mcp-config\` (the Pi MCP adapter's code never runs).`,
}

const LEVEL_LABEL = {
  full: 'Same semantics',
  partial: 'Mapped, difference stated',
  unsupported: 'Not available',
  fatal: 'Fails loud',
}

const escape = text => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

/**
 * Which area a surface belongs to.
 * @param entry - one rule entry with its name and kind.
 */
function areaOf(entry) {
  const override = AREA_BY_KIND_OVERRIDE[entry.name]?.[entry.kind]
  if (override !== undefined) return override
  return AREAS.find(area => area.members.includes(entry.name))?.file
}

const unassigned = surfaces.filter(entry => areaOf(entry) === undefined)
if (unassigned.length > 0) {
  throw new Error(`generate-capability-docs: unassigned surfaces — ${
    unassigned.map(entry => `${entry.kind}:${entry.name}`).join(', ')} (add them to AREAS)`)
}

const written = []
for (const area of AREAS) {
  const rows = surfaces.filter(entry => areaOf(entry) === area.file)
  const counts = rows.reduce((all, { rule }) => ({ ...all, [rule.level]: (all[rule.level] ?? 0) + 1 }), {})
  const summary = Object.entries(LEVEL_LABEL)
    .filter(([level]) => counts[level] !== undefined)
    .map(([level, label]) => `${counts[level]} ${label.toLowerCase()}`)
    .join(' · ')
  const body = `<!-- Generated by scripts/generate-capability-docs.mjs — edit the prose there, never here. -->
# ${area.title}

${PROSE[area.file]}

**${rows.length} Pi surfaces** — ${summary}.

| Pi surface | Kind | Status | How it maps onto DSH |
|---|---|---|---|
${rows.map(({ name, kind, rule }) =>
    `| \`${name}\` | \`${kind}\` | ${LEVEL_LABEL[rule.level]} | ${escape(rule.detail)} |`).join('\n')}

---

Back to the [capability index](README.md) · the whole verdict in
[pi-abi-coverage.md](../pi-abi-coverage.md).
`
  written.push({ path: join(outDir, `${area.file}.md`), body, area, rows, counts })
}

const totals = surfaces.reduce((all, { rule }) => ({ ...all, [rule.level]: (all[rule.level] ?? 0) + 1 }), {})
const importSymbols = Object.values(HOST_IMPORT_RULES).reduce((sum, group) => sum + Object.keys(group).length, 0)
const index = `<!-- Generated by scripts/generate-capability-docs.mjs — edit the prose there, never here. -->
# Pi capabilities on DSH, area by area

Every surface a Pi package can touch, what it maps onto in DeepSeek Harness,
and where the mapping differs. These tables are generated from the rules the
bridge itself consults at runtime (\`src/compatibility.ts\`, also reported by
\`pi2dsh matrix --json\`), so they cannot drift from the implementation.

**${surfaces.length} Pi surfaces total** — ${
  Object.entries(LEVEL_LABEL).filter(([level]) => totals[level] !== undefined)
    .map(([level, label]) => `${totals[level]} ${label.toLowerCase()}`).join(' · ')
} — plus **${importSymbols} imported symbols** from the three Pi runtime
packages (\`pi-coding-agent\`, \`pi-tui\`, \`pi-ai\`), which the bridge serves
from vendored or headless shims so a package's own Pi pins never load.

| Area | Surfaces | Status |
|---|---|---|
${written.map(({ area, rows, counts }) =>
  `| [${area.title}](${area.file}.md) | ${rows.length} | ${
    Object.entries(LEVEL_LABEL).filter(([level]) => counts[level] !== undefined)
      .map(([level, label]) => `${counts[level]} ${label.toLowerCase()}`).join(' · ')} |`).join('\n')}

## What the statuses mean

| Status | Meaning |
|---|---|
| **Same semantics** | The DSH behaviour matches Pi's, including edge cases |
| **Mapped, difference stated** | The capability works; the row says exactly where the behaviour differs from Pi (representation, timing, or scope). Most surfaces sit here because the bridge documents differences rather than glossing over them |
| **Not available** | No safe mapping. The surface is accepted so packages keep running, and the gap is reported once through the capability ledger rather than throwing mid-turn |
| **Fails loud** | Calling it raises a structured, catchable error instead of returning a fabricated result |

A package that hits a "not available" surface during startup is marked
unusable with a removal hint, instead of half-working silently.
`
written.push({ path: join(outDir, 'README.md'), body: index })

await mkdir(outDir, { recursive: true })
let stale = 0
for (const { path, body } of written) {
  const current = await readFile(path, 'utf8').catch(() => undefined)
  if (current === body) continue
  stale += 1
  if (check) console.error(`stale: ${path}`)
  else await writeFile(path, body, 'utf8')
}
if (check && stale > 0) {
  console.error(`generate-capability-docs: ${stale} file(s) out of date — run node scripts/generate-capability-docs.mjs`)
  process.exit(1)
}
console.log(check ? 'capability docs up to date' : `wrote ${written.length} files to docs/capabilities/`)
