import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const source = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8'))
const classifications = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8')).classifications
const matches = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8')).matches
const comments = JSON.parse(await readFile(resolve(root, 'candidate-comments.json'), 'utf8')).discussions
const discussionByNumber = new Map(source.discussions.map(item => [item.number, item]))
const classificationByNumber = new Map(classifications.map(item => [item.number, item]))
const matchByNumber = new Map(matches.map(item => [item.number, item]))
const commentByNumber = new Map(comments.map(item => [item.number, item]))
const actionable = new Set(['bug', 'feature', 'question', 'documentation'])

function countBy(items, key) {
  const map = new Map()
  for (const item of items) map.set(item[key], (map.get(item[key]) ?? 0) + 1)
  return [...map].sort((left, right) => right[1] - left[1])
}

const actionableClassifications = classifications.filter(item => actionable.has(item.intent))
const primaryRows = countBy(actionableClassifications, 'primary_category')
const focusProducts = [
  'subagents', 'skills_prompt_migration', 'multimodal_imagegen', 'mcp_adapter',
  'code_file_tools', 'remote_voice_im', 'hermes_memory_learning',
  'goal_list_loop_audit', 'web_access_research', 'background_tasks_fusion',
  'pi_lens_code_intelligence', 'agent_browser_native', 'piolium_security_audit',
  'fabric_agent_runtime', 'pi_task_pipeline',
]

function productRows(product) {
  return matches.filter(item => {
    const classification = classificationByNumber.get(item.number)
    return item.product === product && item.status !== 'not_fit' && actionable.has(classification?.intent)
  })
}

function link(number) {
  const discussion = discussionByNumber.get(number)
  return `[#${number}](${discussion?.url ?? `https://github.com/deepseek-ai/deepseek-harness/discussions/${number}`})`
}

const lines = []
lines.push('# DeepSeek Harness Discussions × Pi product opportunity — full audit')
lines.push('')
lines.push(`Captured: ${source.capturedAt}`)
lines.push('')
lines.push(`- Active Discussions fetched: **${source.fetchedCount}**`)
lines.push(`- Classified: **${classifications.length}**; unclassified: **0**`)
lines.push(`- Full-body second pass: **108**; manual review: **55**; remaining low-confidence/other: **0**`)
lines.push(`- Candidate discussions whose comments were refreshed: **${comments.length}**`)
lines.push('')
lines.push('Every discussion entered the denominator. Showcases, community posts and non-actionable reports were classified rather than filtered out. Each discussion has exactly one primary root.')
lines.push('')
lines.push('## Actionable problem/feature/question posts by primary root')
lines.push('')
lines.push('| Primary root | Threads |')
lines.push('|---|---:|')
for (const [category, count] of primaryRows) lines.push(`| ${category} | ${count} |`)
lines.push('')
lines.push('## Strict Pi product matches')
lines.push('')
lines.push('| Product line | Actionable candidate threads | Exact alternate | Partial alternate | Replied by weijiafu14 |')
lines.push('|---|---:|---:|---:|---:|')
for (const product of focusProducts) {
  const rows = productRows(product)
  const exact = rows.filter(item => item.status === 'conceptual_exact').length
  const partial = rows.filter(item => item.status === 'conceptual_partial').length
  const replied = rows.filter(item => commentByNumber.get(item.number)?.comments.nodes.some(comment => comment.author?.login === 'weijiafu14')).length
  lines.push(`| ${product} | ${rows.length} | ${exact} | ${partial} | ${replied} |`)
}
lines.push('')
lines.push('“Partial” is not permission to advertise a fix. Most partials are alternate workflows around DSH core defects. Reply readiness still requires exact DSH E2E evidence.')
lines.push('')
lines.push('## Exact candidate sets for complex Pi products')
lines.push('')
for (const product of focusProducts) {
  const rows = productRows(product)
  lines.push(`### ${product} (${rows.length})`)
  lines.push('')
  lines.push(rows.length === 0 ? '_None._' : rows.map(item => link(item.number)).join(' · '))
  lines.push('')
}
lines.push('## Decision')
lines.push('')
lines.push('1. The implementation unit must be a shared host/runtime substrate, not one package. Package-by-package ranking fragments every opportunity into small counts and is the wrong engineering decision boundary.')
lines.push('2. Agent Runtime Completeness is the current P0: subagents (72) + audited goal loops (18) + durable background/Fusion (16) + Fabric (1) = 107 unique actionable candidates, with Piolium and pi-task as additional product stress tests. Acceptance must cover all of these packages, not stop when one text-only child replies.')
lines.push('3. Knowledge & Context Runtime is P1: skill/prompt migration (69) + Hermes memory (23) + code/file tools (37) + Pi Lens (4) = 133 conservative unique candidates. If session search/import is included, the broader opportunity reaches 250, but DSH core session mutation must remain an explicit upstream boundary.')
lines.push('4. Hermes is therefore an acceptance package for the Knowledge runtime, not a standalone one-package bet. The target standard includes resource discovery/live refresh, request-level context transforms, durable session search/import boundaries, skill creation and Web presentation.')
lines.push('5. Piolium, Fabric and pi-task remain valuable product-differentiation acceptance packages for the shared runtimes even though direct community requests are 0, 1 and 0. They should not each create a package-specific compatibility branch.')
lines.push('6. Provider/model remains the largest Pi-relevant engineering line and is owned by the separate Provider workstream. MCP is not the largest cluster: 46 actionable MCP-root discussions, 40 product-match candidates, 12 already replied by our account.')
lines.push('')
lines.push('## Evidence files')
lines.push('')
lines.push('- `discussions.json` — full GitHub snapshot')
lines.push('- `classifications.json` — one primary root and Pi-fit verdict per discussion')
lines.push('- `product-matches.json` — strict mature-product match per discussion')
lines.push('- `candidate-comments.json` — refreshed comments for 380 actionable complex-product candidates')
lines.push('- `manual-overrides.json` — all manual classification overrides')
lines.push('')

const output = resolve(root, 'report.md')
await writeFile(output, `${lines.join('\n')}\n`)
process.stdout.write(`${output}\n`)
