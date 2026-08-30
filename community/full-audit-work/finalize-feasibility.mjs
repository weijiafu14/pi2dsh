import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const discussionsSource = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8'))
const classificationSource = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8'))
const matchSource = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8'))
const firstSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility.json'), 'utf8'))
const challengeSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-challenges.json'), 'utf8'))
const recoverySource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-recoveries.json'), 'utf8'))
const finalOverrideSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-final-overrides.json'), 'utf8'))
const evidenceGroupSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-evidence-groups.json'), 'utf8'))

const discussions = new Map(discussionsSource.discussions.map(item => [item.number, item]))
const classifications = new Map(classificationSource.classifications.map(item => [item.number, item]))
const matches = new Map(matchSource.matches.map(item => [item.number, item]))
const first = new Map(firstSource.audits.map(item => [item.number, item]))
const challenges = new Map(challengeSource.challenges.map(item => [item.number, item]))
const recoveries = new Map(recoverySource.recoveries.map(item => [item.number, item]))
const overrides = new Map(finalOverrideSource.overrides.map(item => [item.number, item]))
const evidenceByNumber = new Map()
for (const group of evidenceGroupSource.groups) for (const number of group.numbers) evidenceByNumber.set(number, group)
const evidenceDefaults = {
  'subagents-live-route': { cluster: 'subagent_models_lifecycle', capabilities: ['subagent_sessions', 'provider_transport', 'model_catalog'], products: ['@tintinweb/pi-subagents', 'pi2dsh'] },
  'subagents-explicit-model': { cluster: 'subagent_models_lifecycle', capabilities: ['subagent_sessions', 'provider_transport', 'model_catalog'], products: ['@tintinweb/pi-subagents', 'pi2dsh'] },
  'subagents-per-child-reasoning': { cluster: 'subagent_models_lifecycle', capabilities: ['subagent_sessions', 'reasoning_compat'], products: ['@tintinweb/pi-subagents', 'pi2dsh'] },
  'subagents-lifecycle-result-steer': { cluster: 'subagent_models_lifecycle', capabilities: ['subagent_sessions', 'background_jobs', 'session_persistence'], products: ['@tintinweb/pi-subagents', 'pi2dsh'] },
  'vision-bridge-web-cli': { cluster: 'multimodal_admission_generation', capabilities: ['multimodal', 'provider_transport', 'web_client'], products: ['@kassing/pi-vision', 'pi-vision-tool', 'pi2dsh'] },
  'provider-demonstrated-routes': { cluster: 'provider_gateway_catalog', capabilities: ['provider_transport', 'model_catalog', 'reasoning_compat', 'protocol_normalization'], products: ['pi2dsh'] },
  'provider-independent-web-search': { cluster: 'web_search_browser', capabilities: ['web_search'], products: ['@juicesharp/rpiv-web-tools', 'pi2dsh'] },
  'persistent-memory': { cluster: 'memory_learning', capabilities: ['memory', 'session_persistence'], products: ['pi-hermes-memory', 'pi2dsh'] },
  'codex-image-generation': { cluster: 'multimodal_admission_generation', capabilities: ['multimodal', 'oauth_credentials', 'web_client'], products: ['pi-codex-image-gen', 'pi2dsh'] },
  'approval-guardian-review': { cluster: 'approval_review', capabilities: ['approval', 'subagent_sessions'], products: ['pi-approval-guardian', 'pi2dsh'] },
}

for (const [name, map, expected] of [
  ['first', first, 1123], ['challenges', challenges, 1123], ['recoveries', recoveries, 873],
]) {
  if (map.size !== expected) throw new Error(`${name} denominator: expected ${expected}, got ${map.size}`)
}

const recoveryVerdict = {
  no_alternate: 'dsh_core_only', ready_now: 'ready_now', e2e_only: 'e2e_only',
  pi2dsh_adapter_work: 'pi2dsh_adapter_work', pi_product_work: 'pi_product_work',
  multi_product_composition: 'multi_product_composition',
}
const ownerFor = verdict => ({
  ready_now: 'none', e2e_only: 'composition', pi2dsh_adapter_work: 'pi2dsh',
  pi_product_work: 'pi_package', multi_product_composition: 'composition',
  dsh_public_seam_needed: 'dsh_upstream', dsh_core_only: 'dsh_upstream',
})[verdict]
const finalItems = [...challenges.values()].sort((a, b) => a.number - b.number).map(challenge => {
  const recovery = recoveries.get(challenge.number)
  const recovered = recovery === undefined ? challenge : {
    ...challenge,
    ...recovery,
    verdict: recoveryVerdict[recovery.status],
    owner: ownerFor(recoveryVerdict[recovery.status]),
  }
  const evidenceGroup = evidenceByNumber.get(challenge.number)
  const evidenceFinal = evidenceGroup === undefined ? recovered : {
    ...recovered,
    verdict: evidenceGroup.defaultStatus,
    owner: 'none',
    engineeringCluster: evidenceDefaults[evidenceGroup.id].cluster,
    sharedCapabilities: evidenceDefaults[evidenceGroup.id].capabilities,
    recommendedProducts: evidenceDefaults[evidenceGroup.id].products,
    solution: `使用已验证的 ${evidenceGroup.id} 替代路线交付原帖实际结果；不声称 DSH 原生实现已修。`,
    blocker: 'none',
    evidenceNeeded: 'none',
    cost: 'xs',
    confidence: 0.99,
    finalEvidenceOverride: evidenceGroup.id,
  }
  const override = overrides.get(challenge.number)
  const final = override === undefined ? evidenceFinal : { ...evidenceFinal, ...override, finalManualOverride: true }
  const discussion = discussions.get(challenge.number)
  const classification = classifications.get(challenge.number)
  const match = matches.get(challenge.number)
  return {
    number: challenge.number,
    title: discussion?.title,
    url: discussion?.url,
    intent: classification?.intent,
    primaryCategory: classification?.primary_category,
    primaryRoot: classification?.root,
    firstProduct: match?.product,
    firstProductStatus: match?.status,
    verdict: final.verdict,
    owner: final.owner ?? ownerFor(final.verdict),
    engineeringCluster: final.engineeringCluster,
    sharedCapabilities: final.sharedCapabilities ?? [],
    recommendedProducts: final.recommendedProducts ?? [],
    solution: final.solution,
    blocker: final.blocker ?? final.lostSemantics,
    evidenceNeeded: final.evidenceNeeded,
    cost: final.cost,
    confidence: final.confidence,
    provenance: {
      firstVerdict: first.get(challenge.number)?.verdict,
      challengeDecision: challenge.decision,
      challengeVerdict: challenge.verdict,
      recoveryStatus: recovery?.status,
      evidenceOverride: final.finalEvidenceOverride ?? recovery?.evidenceOverride,
      manualOverride: final.finalManualOverride === true || final.manualOverride === true,
    },
  }
})
if (finalItems.length !== 1123 || new Set(finalItems.map(item => item.number)).size !== 1123) {
  throw new Error('final output is not 1123 unique discussions')
}

const verdictOrder = [
  'ready_now', 'e2e_only', 'pi2dsh_adapter_work', 'pi_product_work',
  'multi_product_composition', 'dsh_public_seam_needed', 'dsh_core_only',
]
const solvableVerdicts = new Set(verdictOrder.slice(0, 5))
const countsOf = (items, key, order) => {
  const grouped = Object.groupBy(items, item => item[key])
  const keys = order ?? Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length)
  return Object.fromEntries(keys.map(value => [value, grouped[value]?.length ?? 0]))
}
const verdictCounts = countsOf(finalItems, 'verdict', verdictOrder)
const directlySolvable = finalItems.filter(item => solvableVerdicts.has(item.verdict))
const problemIntents = new Set(['bug', 'feature', 'question', 'documentation'])
const problemThreadCount = classificationSource.classifications.filter(item => problemIntents.has(item.intent)).length

const productRows = Object.entries(Object.groupBy(finalItems, item => item.firstProduct)).map(([product, items]) => ({
  product,
  total: items.length,
  ...countsOf(items, 'verdict', verdictOrder),
})).sort((a, b) => b.total - a.total)

const costWeight = { xs: 1, s: 2, m: 4, l: 8, xl: 16 }
const clusterRows = Object.entries(Object.groupBy(finalItems, item => item.engineeringCluster)).map(([cluster, items]) => {
  const counts = countsOf(items, 'verdict', verdictOrder)
  const workItems = items.filter(item => ['e2e_only', 'pi2dsh_adapter_work', 'pi_product_work', 'multi_product_composition'].includes(item.verdict))
  const weights = workItems.map(item => costWeight[item.cost] ?? 4).sort((a, b) => a - b)
  const medianCost = weights.length > 0 ? weights[Math.floor(weights.length / 2)] : 99
  const newUnlockable = workItems.length
  return {
    cluster, total: items.length, ...counts, newUnlockable, medianCost,
    priorityScore: Number((newUnlockable / medianCost).toFixed(2)),
  }
}).sort((a, b) => b.priorityScore - a.priorityScore || b.newUnlockable - a.newUnlockable)

const capabilityRows = firstSource.capabilities.map(capability => {
  const items = finalItems.filter(item => item.sharedCapabilities.includes(capability))
  return {
    capability,
    total: items.length,
    solvable: items.filter(item => solvableVerdicts.has(item.verdict)).length,
    seam: items.filter(item => item.verdict === 'dsh_public_seam_needed').length,
    core: items.filter(item => item.verdict === 'dsh_core_only').length,
  }
}).sort((a, b) => b.total - a.total)

const programDefinitions = {
  provider_interoperability: [
    'provider_gateway_catalog', 'provider_reasoning_compat', 'provider_request_metadata',
    'provider_retry_errors', 'provider_tool_stream', 'provider_oauth_credentials',
    'provider_replay_history',
  ],
  agent_runtime_continuity: [
    'subagent_models_lifecycle', 'subagent_delivery_ui', 'background_durable_jobs',
    'session_import_search', 'memory_learning', 'goal_plan_task', 'compaction_cache',
  ],
  client_remote_interaction: [
    'ui_client_extension', 'remote_im_voice', 'approval_review', 'agent_browser',
    'usage_observability',
  ],
  knowledge_code_workflows: [
    'skills_config_migration', 'skill_discovery_validation', 'file_context_diff',
    'code_intelligence', 'web_search_browser',
  ],
  multimodal_media: ['multimodal_admission_generation'],
  mcp_ecosystem: ['mcp_runtime'],
  sandbox_remote_execution: ['sandbox_policy_remote'],
  plugin_install_runtime: ['plugin_install_lifecycle'],
  host_core_misc: ['host_core_other'],
}
const programRows = Object.entries(programDefinitions).map(([program, programClusters]) => {
  const items = finalItems.filter(item => programClusters.includes(item.engineeringCluster))
  const counts = countsOf(items, 'verdict', verdictOrder)
  return {
    program,
    clusters: programClusters,
    total: items.length,
    ...counts,
    newlyUnlockable: counts.e2e_only + counts.pi2dsh_adapter_work
      + counts.pi_product_work + counts.multi_product_composition,
  }
}).sort((a, b) => b.newlyUnlockable - a.newlyUnlockable)

const summary = {
  discussionCount: discussionsSource.discussions.length,
  problemThreadCount,
  piMappedProblemThreadCount: finalItems.length,
  verdictCounts,
  directlySolvableWithoutDshChange: directlySolvable.length,
  conditionallySolvableWithDshSeam: verdictCounts.dsh_public_seam_needed,
  noHonestPluginAlternate: verdictCounts.dsh_core_only,
  evidenceGroupCount: evidenceGroupSource.groups.length,
  finalManualOverrideCount: overrides.size,
}
const finalOutput = {
  schemaVersion: 1,
  capturedAt: discussionsSource.capturedAt,
  finalizedAt: new Date().toISOString(),
  methodology: {
    firstPass: 'architecture verdict for every Pi-mapped problem thread',
    secondPass: 'adversarial challenge of all 1123 verdicts',
    thirdPass: 'alternate-path recovery for every final dsh_core_only verdict',
    evidenceGroups: 'deterministic overrides for repository-proven E2E thread families',
    manualReview: 'low-confidence and obvious ready-now contradictions',
  },
  summary,
  productRows,
  clusterRows,
  programRows,
  capabilityRows,
  items: finalItems,
}
await writeFile(resolve(root, 'architecture-feasibility-final.json'), `${JSON.stringify(finalOutput, null, 2)}\n`)

const ids = items => items.map(item => `[#${item.number}](${item.url})`).join(' · ')
const lines = []
lines.push('# DeepSeek Harness × Pi/pi2dsh architecture feasibility — 1,123-thread audit')
lines.push('')
lines.push(`Captured: ${discussionsSource.capturedAt}. Finalized: ${finalOutput.finalizedAt}.`)
lines.push('')
lines.push('Every bug/feature/question/documentation thread that the first full audit mapped to a Pi product line entered this second-pass denominator. No product line was removed because another developer owns it. Every item has a first verdict, an adversarial challenge, and — when still core-only — an alternate-path recovery audit.')
lines.push('')
lines.push('## Denominator and final verdict')
lines.push('')
lines.push('| Population | Unique discussions |')
lines.push('|---|---:|')
lines.push(`| All captured Discussions | ${summary.discussionCount} |`)
lines.push(`| Actual bug/feature/question/documentation threads | ${summary.problemThreadCount} |`)
lines.push(`| Pi/pi2dsh-mapped problem threads audited one by one | ${summary.piMappedProblemThreadCount} |`)
lines.push(`| Solvable without a DSH upstream change | **${summary.directlySolvableWithoutDshChange}** |`)
lines.push(`| Solvable after a narrow DSH public seam | **${summary.conditionallySolvableWithDshSeam}** |`)
lines.push(`| No honest plugin/product alternate for the required semantics | ${summary.noHonestPluginAlternate} |`)
lines.push('')
lines.push('| Verdict | Threads | Meaning |')
lines.push('|---|---:|---|')
const meanings = {
  ready_now: 'Current repository evidence supports a targeted alternate reply now',
  e2e_only: 'Implementation path exists; exact named scenario must pass clean DSH E2E',
  pi2dsh_adapter_work: 'A public DSH seam and mature Pi API exist; standard Host ABI mapping is missing',
  pi_product_work: 'DSH seams are sufficient; the Pi/adjacent product needs a feature',
  multi_product_composition: 'Two or more existing products must be composed and tested',
  dsh_public_seam_needed: 'A narrow upstream public seam is required before a plugin can complete it',
  dsh_core_only: 'The required core parser/history/install/security/global-UI semantic cannot be honestly replaced',
}
for (const verdict of verdictOrder) lines.push(`| ${verdict} | ${verdictCounts[verdict]} | ${meanings[verdict]} |`)

lines.push('')
lines.push('## Product lines — deduplicated primary ownership')
lines.push('')
lines.push('| First-pass product line | Total | Ready | E2E | Adapter | Product | Composition | DSH seam | Core only |')
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const row of productRows) {
  lines.push(`| ${row.product} | ${row.total} | ${row.ready_now} | ${row.e2e_only} | ${row.pi2dsh_adapter_work} | ${row.pi_product_work} | ${row.multi_product_composition} | ${row.dsh_public_seam_needed} | ${row.dsh_core_only} |`)
}

lines.push('')
lines.push('## Cross-cluster product programs')
lines.push('')
lines.push('These programs restore the intersections that one-primary-product classification intentionally removed. Counts remain unique because every engineering cluster belongs to one program here.')
lines.push('')
lines.push('| Rank | Product program | New work | Already ready | DSH seam | Core only | Total mapped |')
lines.push('|---:|---|---:|---:|---:|---:|---:|')
programRows.forEach((row, index) => {
  lines.push(`| ${index + 1} | ${row.program} | **${row.newlyUnlockable}** | ${row.ready_now} | ${row.dsh_public_seam_needed} | ${row.dsh_core_only} | ${row.total} |`)
})

lines.push('')
lines.push('## Development priority — newly unlockable threads per median cluster cost')
lines.push('')
lines.push('This ranks remaining work, not total topical mentions. `new` excludes already-ready replies; cost weights are xs=1, s=2, m=4, l=8, xl=16.')
lines.push('')
lines.push('| Rank | Engineering cluster | New | Already ready | DSH seam | Core only | Median cost weight | Score |')
lines.push('|---:|---|---:|---:|---:|---:|---:|---:|')
clusterRows.forEach((row, index) => {
  lines.push(`| ${index + 1} | ${row.cluster} | ${row.newUnlockable} | ${row.ready_now} | ${row.dsh_public_seam_needed} | ${row.dsh_core_only} | ${row.medianCost === 99 ? '—' : row.medianCost} | ${row.priorityScore} |`)
})

lines.push('')
lines.push('## Cross-capability surface')
lines.push('')
lines.push('Unlike the first product match, this table is many-to-many: one thread can count under Provider + OAuth + session + subagent, without duplicating the final unique-thread denominator.')
lines.push('')
lines.push('| Shared capability | Threads | Solvable by us | Needs DSH seam | Core only |')
lines.push('|---|---:|---:|---:|---:|')
for (const row of capabilityRows) lines.push(`| ${row.capability} | ${row.total} | ${row.solvable} | ${row.seam} | ${row.core} |`)

lines.push('')
lines.push('## Exact actionable sets by engineering cluster')
for (const row of clusterRows.filter(row => row.ready_now + row.newUnlockable + row.dsh_public_seam_needed > 0)) {
  const items = finalItems.filter(item => item.engineeringCluster === row.cluster)
  lines.push('')
  lines.push(`### ${row.cluster}`)
  lines.push('')
  for (const verdict of verdictOrder.filter(verdict => verdict !== 'dsh_core_only')) {
    const selected = items.filter(item => item.verdict === verdict)
    if (selected.length > 0) lines.push(`- **${verdict} (${selected.length})**: ${ids(selected)}`)
  }
}

const reviewItems = finalItems.filter(item => item.confidence < 0.7 || item.provenance.manualOverride)
lines.push('')
lines.push('## Manual/low-confidence review ledger')
lines.push('')
lines.push(`Final manual overrides: ${overrides.size}. Final confidence < 0.7: ${finalItems.filter(item => item.confidence < 0.7).length}.`)
lines.push('')
for (const item of reviewItems) lines.push(`- [#${item.number}](${item.url}) — ${item.verdict} / ${item.engineeringCluster} / confidence ${item.confidence}: ${item.solution}`)

lines.push('')
lines.push('## Artifacts')
lines.push('')
lines.push('- `architecture-feasibility-final.json` — final per-thread verdicts and provenance')
lines.push('- `architecture-feasibility.json` — first architecture pass')
lines.push('- `architecture-feasibility-challenges.json` — adversarial second pass')
lines.push('- `architecture-feasibility-recoveries.json` — alternate-path recovery for core-only items')
lines.push('- `architecture-feasibility-*-overrides.json` — explicit human/evidence corrections')
lines.push('- `audit-feasibility.mjs`, `challenge-feasibility.mjs`, `recover-alternates.mjs`, `finalize-feasibility.mjs` — reproducible pipeline')

await writeFile(resolve(root, 'architecture-feasibility-report.md'), `${lines.join('\n')}\n`)
process.stdout.write(`${JSON.stringify({ summary, output: resolve(root, 'architecture-feasibility-final.json'), report: resolve(root, 'architecture-feasibility-report.md') })}\n`)
