// Generate docs/capabilities/*.md from the bridge's own compatibility rules.
//
//   node scripts/generate-capability-docs.mjs        # write
//   node scripts/generate-capability-docs.mjs --check # fail if stale (CI)
//
// The per-surface tables are DERIVED, never hand-written: the rules in
// src/compatibility.ts are what the runtime consults and what `pi2dsh matrix`
// reports, so a mapping cannot drift from its documentation. Prose lives in
// PROSE below, beside the group it introduces.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'docs', 'capabilities')
const check = process.argv.includes('--check')
const architectureLedger = JSON.parse(
  await readFile(join(root, 'docs', 'architecture-ledger.json'), 'utf8'),
)

const { API_RULES, EVENT_RULES, CONTEXT_RULES, UI_CONTEXT_RULES, HOST_IMPORT_RULES } =
  await import(join(root, 'dist', 'index.mjs'))

/** Every rule as one flat list, tagged with the surface it belongs to. */
const surfaces = [
  ...Object.entries(API_RULES).map(([name, rule]) => ({ name, rule, kind: 'pi.*' })),
  ...Object.entries(EVENT_RULES).map(([name, rule]) => ({ name, rule, kind: 'event' })),
  ...Object.entries(CONTEXT_RULES).map(([name, rule]) => ({ name, rule, kind: 'ctx.*' })),
  ...Object.entries(UI_CONTEXT_RULES).map(([name, rule]) => ({ name, rule, kind: 'ctx.ui.*' })),
]

// Runtime rules may intentionally keep compatibility extensions that are not
// members of the pinned upstream Pi ABI. Document them, but never let them
// inflate the upstream denominator. Pi 0.84.1 has no ExtensionAPI.unregisterTool.
const BRIDGE_EXTENSIONS = new Set(['pi.*:unregisterTool'])
const isBridgeExtension = entry => BRIDGE_EXTENSIONS.has(`${entry.kind}:${entry.name}`)
const upstreamSurfaces = surfaces.filter(entry => !isBridgeExtension(entry))
const bridgeExtensions = surfaces.filter(isBridgeExtension)

// Presentation areas are only views. The canonical assignment of every Pi
// surface to an architectural capability contract lives in
// docs/architecture-ledger.json and is validated below.
const AREAS = [
  { file: 'tools', title: 'Tools' },
  { file: 'commands', title: 'Commands, flags and editor input' },
  { file: 'conversation', title: 'Messages, context and the agent loop' },
  { file: 'sessions', title: 'Sessions, branching and side conversations' },
  { file: 'models', title: 'Models, providers and credentials' },
  { file: 'interaction', title: 'Asking the user, and rendering' },
  { file: 'environment', title: 'Project environment, skills and resources' },
]

const PROSE = {
  tools: `Pi packages contribute tools and observe every tool call. Both map
onto DSH's own tool registry and its durable tool events, so a migrated tool
is indistinguishable from a native one at the call site: the model sees it in
the same catalog, the loop runs it through the same permission pipeline, and
results land in the session log in DSH's own shapes. A tool implementation can
still call Node APIs directly, just like any trusted DSH plugin; only work
handed to DSH's filesystem/subprocess/sandbox services inherits those providers.`,
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
bridge creates a real child agent/session through \`ctx.agents\`; the child is
listed, named after the package, opened in its own view and continuable. This
does not exercise the separate \`ctx.subagents\` provider seam. See
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
genuinely block the turn. pi2dsh also ships a DSH client module that redraws
portable presentation intent — status, widgets, headers, footers, editor text
and side conversations — in native Web slots. A Pi terminal component itself
is not mounted in the browser; terminal-only factories and raw key handling
remain headless or become an explicit Web-native projection.`,
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

// `input` exists twice (an event and a ctx.ui method), so the kind is part of
// the anchor — otherwise the two sections would collide and one link would
// land on the wrong surface.
const anchor = (name, kind) => `${name.toLowerCase()}-${kind.replaceAll(/[^a-z]/gu, '')}`
const surfaceKey = entry => `${entry.kind}:${entry.name}`

const capabilityContracts = architectureLedger.piCapabilityContracts
const duplicateIds = values => values.filter((value, index) => values.indexOf(value) !== index)
const duplicateContractIds = duplicateIds(capabilityContracts.map(contract => contract.id))
if (duplicateContractIds.length > 0) {
  throw new Error(`architecture ledger: duplicate Pi contract IDs ${duplicateContractIds.join(', ')}`)
}
const contractBySurface = new Map()
for (const contract of capabilityContracts) {
  if (!AREAS.some(area => area.file === contract.area)) {
    throw new Error(`architecture ledger: contract ${contract.id} has unknown area ${contract.area}`)
  }
  for (const key of contract.surfaces) {
    if (contractBySurface.has(key)) {
      throw new Error(`architecture ledger: ${key} belongs to both ${contractBySurface.get(key).id} and ${contract.id}`)
    }
    contractBySurface.set(key, contract)
  }
}

const runtimeSurfaceKeys = new Set(surfaces.map(surfaceKey))
const missingContracts = surfaces.filter(entry => !contractBySurface.has(surfaceKey(entry)))
const staleContractSurfaces = [...contractBySurface.keys()].filter(key => !runtimeSurfaceKeys.has(key))
if (missingContracts.length > 0 || staleContractSurfaces.length > 0) {
  throw new Error(`architecture ledger: Pi surface coverage mismatch — missing: ${
    missingContracts.map(surfaceKey).join(', ') || 'none'}; stale: ${staleContractSurfaces.join(', ') || 'none'}`)
}

const mappingByContract = new Map()
const duplicateMappingIds = duplicateIds(architectureLedger.theoreticalMappings.map(mapping => mapping.id))
if (duplicateMappingIds.length > 0) {
  throw new Error(`architecture ledger: duplicate mapping IDs ${duplicateMappingIds.join(', ')}`)
}
for (const mapping of architectureLedger.theoreticalMappings) {
  if (mappingByContract.has(mapping.piContract)) {
    throw new Error(`architecture ledger: duplicate theoretical mapping for ${mapping.piContract}`)
  }
  mappingByContract.set(mapping.piContract, mapping)
}
const unmappedContracts = capabilityContracts.filter(contract => !mappingByContract.has(contract.id))
const staleMappings = architectureLedger.theoreticalMappings.filter(mapping =>
  !capabilityContracts.some(contract => contract.id === mapping.piContract))
if (unmappedContracts.length > 0 || staleMappings.length > 0) {
  throw new Error(`architecture ledger: theoretical mapping coverage mismatch — missing: ${
    unmappedContracts.map(contract => contract.id).join(', ') || 'none'}; stale: ${
    staleMappings.map(mapping => mapping.id).join(', ') || 'none'}`)
}

const EXPECTED_DSH_SUBSYSTEMS = new Set([
  'approval', 'attachment', 'client-modules', 'code-runtime', 'commands', 'compaction',
  'core', 'credentials', 'extensions', 'feedback', 'filesystem', 'goal', 'invariants',
  'jobs', 'llm-streaming', 'lsp', 'permission-presets', 'persistence', 'plan', 'sandbox',
  'schedule', 'scope', 'session-projection', 'session-query', 'session-reference',
  'session-telemetry', 'session-title', 'session', 'settings', 'shell', 'skills', 'spill',
  'storage', 'subagent', 'subprocess', 'system-prompt', 'terminal', 'token-meter', 'tools',
  'typert', 'user-questions', 'web-server', 'web', 'workflow', 'workspace',
])
const subsystemOwner = new Map()
for (const mechanism of architectureLedger.dshMechanisms) {
  for (const subsystem of mechanism.subsystems) {
    if (subsystemOwner.has(subsystem)) {
      throw new Error(`architecture ledger: DSH subsystem ${subsystem} belongs to both ${subsystemOwner.get(subsystem)} and ${mechanism.id}`)
    }
    subsystemOwner.set(subsystem, mechanism.id)
  }
}
const missingSubsystems = [...EXPECTED_DSH_SUBSYSTEMS].filter(name => !subsystemOwner.has(name))
const staleSubsystems = [...subsystemOwner.keys()].filter(name => !EXPECTED_DSH_SUBSYSTEMS.has(name))
if (missingSubsystems.length > 0 || staleSubsystems.length > 0) {
  throw new Error(`architecture ledger: DSH subsystem coverage mismatch — missing: ${
    missingSubsystems.join(', ') || 'none'}; stale: ${staleSubsystems.join(', ') || 'none'}`)
}

const mechanismIds = new Set(architectureLedger.dshMechanisms.map(mechanism => mechanism.id))
if (mechanismIds.size !== architectureLedger.dshMechanisms.length) {
  throw new Error('architecture ledger: duplicate DSH mechanism IDs')
}
for (const mapping of architectureLedger.theoreticalMappings) {
  const unknown = mapping.dshMechanisms.filter(id => !mechanismIds.has(id))
  if (unknown.length > 0) throw new Error(`architecture ledger: ${mapping.id} references unknown DSH mechanisms ${unknown.join(', ')}`)
}
const mappingIds = new Set(architectureLedger.theoreticalMappings.map(mapping => mapping.id))
const validationIds = architectureLedger.validations.map(validation => validation.id)
if (new Set(validationIds).size !== validationIds.length) {
  throw new Error('architecture ledger: duplicate validation IDs')
}
for (const validation of architectureLedger.validations) {
  for (const result of validation.results) {
    if (!mappingIds.has(result.mapping)) throw new Error(`architecture ledger: ${validation.id} references unknown mapping ${result.mapping}`)
    if (![1, 2, 3, 4, 5].includes(result.grade)) throw new Error(`architecture ledger: ${validation.id} has invalid grade ${result.grade}`)
  }
  for (const evidence of validation.evidence) {
    if (/^https?:/u.test(evidence)) continue
    await stat(join(root, evidence)).catch(() => {
      throw new Error(`architecture ledger: ${validation.id} references missing evidence ${evidence}`)
    })
  }
}

/**
 * Which area a surface belongs to.
 * @param entry - one rule entry with its name and kind.
 */
function areaOf(entry) {
  return contractBySurface.get(surfaceKey(entry))?.area
}

const unassigned = surfaces.filter(entry => areaOf(entry) === undefined)
if (unassigned.length > 0) {
  throw new Error(`generate-capability-docs: unassigned surfaces — ${
    unassigned.map(entry => `${entry.kind}:${entry.name}`).join(', ')} (add them to AREAS)`)
}

// A missing design would render as the literal word "undefined" in a public
// page. It is also the shape a stale dist/ takes, since this script reads the
// build rather than the source — so fail here instead of publishing that.
const undesigned = surfaces.filter(entry => typeof entry.rule.design !== 'string' || entry.rule.design.length === 0)
if (undesigned.length > 0) {
  throw new Error(`generate-capability-docs: surfaces with no design — ${
    undesigned.map(entry => `${entry.kind}:${entry.name}`).join(', ')
  } (add one in src/compatibility.ts, and run pnpm build first — this script reads dist/)`)
}

const written = []
for (const area of AREAS) {
  const rows = surfaces.filter(entry => areaOf(entry) === area.file).map(entry => {
    const contract = contractBySurface.get(surfaceKey(entry))
    return { ...entry, contract, mapping: mappingByContract.get(contract.id) }
  })
  const upstreamRows = rows.filter(entry => !isBridgeExtension(entry))
  const extensionRows = rows.filter(isBridgeExtension)
  const counts = upstreamRows.reduce((all, { rule }) => ({ ...all, [rule.level]: (all[rule.level] ?? 0) + 1 }), {})
  const summary = Object.entries(LEVEL_LABEL)
    .filter(([level]) => counts[level] !== undefined)
    .map(([level, label]) => `${counts[level]} ${label.toLowerCase()}`)
    .join(' · ')
  const body = `<!-- Generated by scripts/generate-capability-docs.mjs — edit the prose there, never here. -->
# ${area.title}

${PROSE[area.file]}

**${upstreamRows.length} upstream-shaped Pi rule rows** — ${summary}.${extensionRows.length === 0 ? '' : `

This page also documents **${extensionRows.length} bridge-only compatibility extension**
(\`${extensionRows.map(entry => entry.name).join('`, `')}\`), outside the pinned Pi ABI denominator.`}

| Pi surface | Capability contract | Kind | Status | What it does on DSH |
|---|---|---|---|---|
${rows.map(({ name, kind, rule, contract }) =>
    `| [\`${name}\`](#${anchor(name, kind)}) | \`${contract.id}\` | \`${kind}\` | ${LEVEL_LABEL[rule.level]} | ${escape(rule.detail)} |`).join('\n')}

## How each one is built

Every surface below names the DSH mechanism that carries it — the seam, service
or waterfall — so the mapping can be checked against the harness rather than
taken on trust.

${rows.map(({ name, kind, rule, contract, mapping }) => `### \`${name}\` <a id="${anchor(name, kind)}"></a>

\`${kind}\` · \`${contract.id}\` · ${LEVEL_LABEL[rule.level]}

**Theoretical DSH mapping:** ${mapping.dshMechanisms.map(id => `\`${id}\``).join(' + ')} through
${mapping.expectedSeams.map(seam => `\`${seam}\``).join(', ')}.

**Current implementation:**

${rule.design}`).join('\n\n')}

---

Back to the [capability index](README.md) · the whole verdict in
[pi-abi-coverage.md](../pi-abi-coverage.md).
`
  written.push({ path: join(outDir, `${area.file}.md`), body, area, rows, upstreamRows, counts })
}

// The three Pi runtime packages a plugin imports from. These are not surfaces a
// package registers into — they are the library it was compiled against — so
// they get one page of their own rather than a row in an area table.
const IMPORT_PROSE = {
  'pi-coding-agent': `Pi's agent runtime. A migrated package never loads Pi's own
copy: \`jiti\` aliases the specifier to a bridge shim, so the symbols below come
from pi2dsh. Most are Pi's own source vendored byte-identical with the commit
recorded beside them — same code, same edge cases — because a reimplementation
of a pure function is a second behaviour to keep in sync. The rest are the ones
that reach for host state (config directories, session storage, the model call
inside compaction): those are re-pointed at DSH-owned locations and services,
which is exactly where a package's Pi assumptions have to stop.`,
  'pi-tui': `Pi's terminal UI toolkit. DSH renders its own surfaces, so these are
headless components with Pi-exact signatures: they construct, accept the same
arguments and return plain text instead of drawing. A package that builds a
component keeps working; a package whose whole purpose is drawing a terminal
overlay is honest about not drawing it.`,
  'pi-ai': `Pi's model layer. The types and pure helpers are vendored, while
everything that would open a socket routes into DSH's llm service instead —
there is exactly one model path, and a package cannot reach around it to a
direct transport. Providers a package brings itself become real DSH routes
through \`llm.registerAdapter\`.`,
}

const importBody = `<!-- Generated by scripts/generate-capability-docs.mjs — edit the prose there, never here. -->
# Imported Pi runtime symbols

What a Pi package gets when it imports from the three Pi runtime packages. The
bridge serves every one of them, so a package's own Pi version pins never load
and never conflict with the harness.

${Object.entries(HOST_IMPORT_RULES).map(([family, group]) => {
  const entries = Object.entries(group)
  const counts = entries.reduce((all, [, rule]) => ({ ...all, [rule.level]: (all[rule.level] ?? 0) + 1 }), {})
  return `## \`${family}\`

${IMPORT_PROSE[family]}

**${entries.length} symbols** — ${Object.entries(LEVEL_LABEL).filter(([level]) => counts[level] !== undefined)
    .map(([level, label]) => `${counts[level]} ${label.toLowerCase()}`).join(' · ')}.

| Symbol | Status | How it is served |
|---|---|---|
${entries.map(([name, rule]) => `| \`${name}\` | ${LEVEL_LABEL[rule.level]} | ${escape(rule.detail)} |`).join('\n')}`
}).join('\n\n')}

---

Back to the [capability index](README.md).
`
written.push({ path: join(outDir, 'imports.md'), body: importBody })

const totals = upstreamSurfaces.reduce((all, { rule }) => ({ ...all, [rule.level]: (all[rule.level] ?? 0) + 1 }), {})
const importSymbols = Object.values(HOST_IMPORT_RULES).reduce((sum, group) => sum + Object.keys(group).length, 0)
const index = `<!-- Generated by scripts/generate-capability-docs.mjs — edit the prose there, never here. -->
# Pi capabilities on DSH, area by area

Every upstream-shaped rule the bridge currently tracks, what it maps onto in
DeepSeek Harness, and where the mapping differs. Nested objects such as
\`sessionManager\` may expose several methods behind one row; this is a runtime
rule catalog, not yet a callable-by-callable proof. These tables are generated
from the rules the bridge itself consults at runtime (\`src/compatibility.ts\`,
also reported by \`pi2dsh matrix --json\`), so they cannot drift from the
implementation.

**${upstreamSurfaces.length} upstream-shaped Pi rule rows total** — ${
  Object.entries(LEVEL_LABEL).filter(([level]) => totals[level] !== undefined)
    .map(([level, label]) => `${totals[level]} ${label.toLowerCase()}`).join(' · ')
} — plus **${importSymbols} imported symbols** from the three Pi runtime
packages (\`pi-coding-agent\`, \`pi-tui\`, \`pi-ai\`), which the bridge serves
from vendored or headless shims so a package's own Pi pins never load — listed
in [Imported Pi runtime symbols](imports.md).

The rule set additionally documents **${bridgeExtensions.length} bridge-only
compatibility extension** (\`${bridgeExtensions.map(entry => entry.name).join('`, `')}\`),
which is deliberately outside the upstream Pi ABI total.

Each area page carries two things per surface: what it does on DSH, and **how
it is built** — the DSH seam, service or waterfall behind it.

| Area | Surfaces | Status |
|---|---|---|
${written.filter(({ area }) => area !== undefined).map(({ area, upstreamRows, counts }) =>
  `| [${area.title}](${area.file}.md) | ${upstreamRows.length} | ${
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

const THEORY_LABEL = {
  direct: '直接承接',
  composed: '组合承接',
  'host-translation': '宿主语义翻译',
  'missing-seam': '理论上缺公开 seam',
}
const architectureMatrix = `<!-- Generated by scripts/generate-capability-docs.mjs — edit docs/architecture-ledger.json, never this file. -->
# Pi → DSH 理论架构映射

本页是[映射标准](architecture-mapping-standard.md)的理论视图。每条 Pi 叶子接口先归入一个
能力契约，再由能力契约映射到 DSH 承载机制和具体公开 seam。接口清单、架构抽象与
理论映射因此可以双向下钻，而不是三张互不相干的表。

## Pi 能力契约与 DSH 承载机制

| Pi 能力契约 | 上游接口行 | DSH 承载机制 | 理论承载方式 | 预期公开 seam |
|---|---:|---|---|---|
${capabilityContracts.map(contract => {
  const mapping = mappingByContract.get(contract.id)
  const upstreamCount = contract.surfaces.filter(key => !BRIDGE_EXTENSIONS.has(key)).length
  return `| \`${contract.id}\`<br>${contract.titleZh} | ${upstreamCount} | ${mapping.dshMechanisms.map(id => `\`${id}\``).join('<br>')} | ${THEORY_LABEL[mapping.theory]} | ${mapping.expectedSeams.map(escape).join('<br>')} |`
}).join('\n')}

## DSH 承载机制与 45 个子系统

| DSH 承载机制 | 子系统 | 公开机制示例 |
|---|---|---|
${architectureLedger.dshMechanisms.map(mechanism =>
  `| \`${mechanism.id}\`<br>${mechanism.titleZh} | ${mechanism.subsystems.map(name => `\`${name}\``).join('、')} | ${mechanism.seams.map(escape).join('<br>')} |`).join('\n')}

完整性约束由文档生成检查强制执行：每条运行时 Pi surface 恰好属于一个能力契约；每个
能力契约恰好有一条理论映射；官方 45 个 DSH 子系统恰好属于一个承载机制。任何新增、
遗漏、重复或陈旧条目都会让 \`pnpm check:docs\` 失败。
`
written.push({ path: join(root, 'docs', 'architecture-mapping-matrix.md'), body: architectureMatrix })

const GRADE_LABEL = {
  1: '1 · 原生承接',
  2: '2 · 可靠翻译',
  3: '3 · 旁路完成',
  4: '4 · 降级或缺失',
  5: '5 · 宿主专属，不计分',
}
const validationMatrix = `<!-- Generated by scripts/generate-capability-docs.mjs — edit docs/architecture-ledger.json, never this file. -->
# 真实插件验证矩阵

本页是[映射标准](architecture-mapping-standard.md)的实践视图。每条记录引用理论映射 ID，
再记录真实插件场景达到的五级结果；它不重复发明另一套能力分类。

| 插件 / 场景 | 理论映射 | 实际判定 | 证据 |
|---|---|---|---|
${architectureLedger.validations.flatMap(validation => validation.results.map(result => {
  const mapping = architectureLedger.theoreticalMappings.find(item => item.id === result.mapping)
  return `| **${escape(validation.plugin)}**<br>${escape(validation.scenario)} | \`${result.mapping}\`<br>\`${mapping.piContract}\` | **${GRADE_LABEL[result.grade]}** | ${validation.evidence.map(item => `\`${item}\``).join('<br>')} |`
})).join('\n')}

没有出现在本页的理论映射只能写“尚未实证”。一条验证可以覆盖多个映射，同一个插件的
不同能力也可以得到不同等级，禁止给整包粗暴打一个总分。
`
written.push({ path: join(root, 'docs', 'plugin-validation-matrix.md'), body: validationMatrix })

// The READMEs carry the same table, and claim in prose that it is generated.
// It was not: it was hand-maintained and had drifted from the rules by the time
// anyone noticed. Generating it into a marked block is what makes the claim
// true, and `--check` is what keeps it true.
const README_TABLES = [
  {
    file: 'README.md',
    header: '| Area | Pi surfaces | Status |',
    total: 'Total',
    // Lowercase mid-sentence, the way the index pages tally them.
    labels: Object.fromEntries(Object.entries(LEVEL_LABEL).map(([level, label]) => [level, label.toLowerCase()])),
    titles: {
      tools: 'Tools',
      commands: 'Commands, flags, editor input',
      conversation: 'Messages, context, agent loop',
      sessions: 'Sessions & side conversations',
      models: 'Models, providers, credentials',
      interaction: 'Asking the user, rendering',
      environment: 'Project environment & resources',
    },
  },
  {
    file: 'README.zh.md',
    header: '| 能力域 | Pi 面数 | 状态 |',
    total: '合计',
    labels: { full: '语义一致', partial: '已映射并写明差异', unsupported: '不提供', fatal: '明确报错' },
    titles: {
      tools: '工具',
      commands: '命令、flag、编辑器输入',
      conversation: '消息、上下文、agent 循环',
      sessions: '会话与侧边对话',
      models: '模型、provider、凭证',
      interaction: '向用户提问与渲染',
      environment: '项目环境与资源',
    },
  },
]

const START = '<!-- capability-table:start -->'
const END = '<!-- capability-table:end -->'
for (const table of README_TABLES) {
  const tally = counts => Object.entries(table.labels)
    .filter(([level]) => counts[level] !== undefined)
    .map(([level, label]) => `${counts[level]} ${label}`).join(' · ')
  const block = [
    table.header,
    '|---|---|---|',
    ...written.filter(({ area }) => area !== undefined).map(({ area, upstreamRows, counts }) =>
      `| [${table.titles[area.file]}](docs/capabilities/${area.file}.md) | ${upstreamRows.length} | ${tally(counts)} |`),
    `| **${table.total}** | **${upstreamSurfaces.length}** | **${tally(totals)}** |`,
  ].join('\n')
  const path = join(root, table.file)
  const current = await readFile(path, 'utf8')
  const from = current.indexOf(START)
  const to = current.indexOf(END)
  if (from === -1 || to === -1) {
    throw new Error(`generate-capability-docs: ${table.file} has no ${START} / ${END} markers`)
  }
  written.push({
    path,
    body: `${current.slice(0, from)}${START}\n${block}\n${current.slice(to)}`,
  })
}

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
