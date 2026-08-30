import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const source = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8'))
const classifications = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8')).classifications
const classificationByNumber = new Map(classifications.map(item => [item.number, item]))
const output = resolve(root, 'product-matches.json')
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')
let prior = { matches: [] }
try { prior = JSON.parse(await readFile(output, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
const byNumber = new Map(prior.matches.map(item => [item.number, item]))
const pending = source.discussions.filter(item => !byNumber.has(item.number))
const queue = []
for (let index = 0; index < pending.length; index += 50) queue.push(pending.slice(index, index + 50))

const products = [
  'piolium_security_audit', 'fabric_agent_runtime', 'goal_list_loop_audit',
  'pi_task_pipeline', 'hermes_memory_learning', 'pi_lens_code_intelligence',
  'background_tasks_fusion', 'agent_browser_native', 'web_access_research',
  'subagents', 'mcp_adapter', 'multimodal_imagegen', 'remote_voice_im',
  'code_file_tools', 'session_search_memory', 'permission_sandbox',
  'provider_model', 'ui_tui', 'skills_prompt_migration', 'none',
]
const statuses = ['conceptual_exact', 'conceptual_partial', 'not_fit']
const productAliases = {
  skills_prompts_migration: 'skills_prompt_migration',
  session_import_search: 'session_search_memory',
  remote_channels_voice: 'remote_voice_im',
  code_intelligence_files: 'code_file_tools',
  memory_learning: 'hermes_memory_learning',
}
const system = `Strictly match every deepseek-harness Discussion to at most ONE mature Pi product line. Read the title, body, and prior root classification. Do not reward mere topical similarity.

Products:
- piolium_security_audit: 17-phase specialist security audit, threat model, SAST/auth/state/parser review, adversarial false-positive verification, PoCs, variant search, reports/diff/revisit.
- fabric_agent_runtime: programmable TypeScript tool+agent runtime, workflows, RLM, supervisors, councils, fusion, swarms, actors, shared state and budgets.
- goal_list_loop_audit: interview-drafted goals, audited task queues, hours-long loops, mechanical gates, detached evidence auditor, retry/watchdog/recovery.
- pi_task_pipeline: deterministic refine/research/grill/spec/critique/implement/verify/guideline-enforce pipeline, crash resume, per-task commits, phone remote view.
- hermes_memory_learning: persistent/project memory, correction/failure learning, session search, consolidation, secret scanning, procedural skill creation.
- pi_lens_code_intelligence: LSP, AST, symbol search, diagnostics, impact cascade, post-edit checking, dependency map.
- background_tasks_fusion: durable shell/model jobs, logs/notifications, read-only delegates, attested runs, multi-model candidate/evaluator/merge Fusion.
- agent_browser_native: browser/Electron automation, authenticated state, snapshots, QA, safe sessions.
- web_access_research: web search/fetch, GitHub clone, PDF/YouTube/video understanding.
- subagents: isolated child agents, per-child model, background queue, steering/resume.
- mcp_adapter: advanced MCP transport/OAuth/discovery/resources/prompts/proxy/approval.
- multimodal_imagegen: vision fallback/admission and image generation/editing.
- remote_voice_im: Telegram/Feishu/IM remote control or local voice dictation.
- code_file_tools: fuzzy file search, LSP/readseek/hashline/diff-safe editing.
- session_search_memory: historical session search/import/recall/compaction utilities.
- permission_sandbox: Pi permission enforcement or alternate sandboxed execution.
- provider_model: provider/OAuth/model protocol routes.
- ui_tui: optional Pi-owned presentation/TUI only.
- skills_prompt_migration: skills/prompts/config migration/management.
- none: no product directly delivers the primary request.

status rules:
- conceptual_exact: installing the product can deliver the primary requested outcome as an honest alternate path without claiming to repair DSH core.
- conceptual_partial: product delivers a meaningful part but misses a required semantic.
- not_fit: showcase/nonproblem/vague, or DSH core install/UI/history/security/lifecycle/tool-parser defect that a Pi product cannot honestly fix.

Important: DSH core Web UI changes, install/update failures, corrupt history, sandbox escapes, protocol parser defects, plugin lifecycle defects, and internal test failures are normally none/not_fit. A plugin drawing its own panel does not fix the core settings page. A safer alternate tool does not repair an enabled unsafe core tool.

Return ONLY a JSON array in input order:
{"number":123,"product":"...","status":"...","reason":"concise Chinese reason","confidence":0.0}
Never omit/reorder.`

const item = discussion => ({ number: discussion.number, github_category: discussion.category?.name, title: discussion.title, body: String(discussion.body ?? '').slice(0, 2000), prior: classificationByNumber.get(discussion.number) })
const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))
async function classify(batch, attempt = 1) {
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 5000, temperature: 0, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content: JSON.stringify(batch.map(item)) }] }) })
  const payload = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const values = parse(text)
    if (!Array.isArray(values) || JSON.stringify(values.map(v => v.number)) !== JSON.stringify(batch.map(v => v.number))) throw new Error('number mismatch')
    for (const value of values) {
      value.product = productAliases[value.product] ?? value.product
      const warnings = []
      if (!products.includes(value.product)) { warnings.push(`invalid product:${value.product}`); value.product = 'none' }
      if (!statuses.includes(value.status)) { warnings.push(`invalid status:${value.status}`); value.status = 'not_fit' }
      if (warnings.length > 0) { value.confidence = Math.min(Number(value.confidence) || 0, 0.49); value.match_warning = warnings.join(';') }
    }
    return values
  } catch (error) {
    if (attempt >= 3) throw new Error(`${error.message}: ${text.slice(0, 600)}`)
    return classify(batch, attempt + 1)
  }
}

await mkdir(dirname(output), { recursive: true })
let writes = Promise.resolve()
async function checkpoint() {
  const value = { schemaVersion: 1, capturedAt: source.capturedAt, matchedAt: new Date().toISOString(), sourceCount: source.discussions.length, matchedCount: byNumber.size, unmatchedCount: source.discussions.length - byNumber.size, matches: [...byNumber.values()].sort((a, b) => a.number - b.number) }
  const temporary = `${output}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, output)
}
const total = queue.length
let completed = 0
async function worker() {
  while (queue.length > 0) {
    const batch = queue.shift()
    if (!batch) return
    for (const value of await classify(batch)) byNumber.set(value.number, value)
    completed += 1
    writes = writes.then(checkpoint)
    await writes
    process.stderr.write(`matched ${byNumber.size}/${source.discussions.length} (${completed}/${total})\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ matched: byNumber.size, total: source.discussions.length, output })}\n`)
