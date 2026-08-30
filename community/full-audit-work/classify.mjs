import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const inputPath = resolve(process.argv[2] ?? 'community/full-audit-work/discussions.json')
const outputPath = resolve(process.argv[3] ?? 'community/full-audit-work/classifications.json')
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')
const source = JSON.parse(await readFile(inputPath, 'utf8'))
let prior = { classifications: [] }
try { prior = JSON.parse(await readFile(outputPath, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
const byNumber = new Map(prior.classifications.map(item => [item.number, item]))
const pending = source.discussions.filter(item => !byNumber.has(item.number))
const queue = []
for (let index = 0; index < pending.length; index += 50) queue.push(pending.slice(index, index + 50))

const primaryCategories = [
  'provider_model_protocol', 'install_update_startup', 'plugin_framework_market',
  'session_workspace_history', 'tool_loop_runtime', 'background_jobs', 'sandbox_permissions_security',
  'web_desktop_ui', 'mcp', 'subagents_multiagent_workflow',
  'context_tokens_cache_compaction', 'memory_learning', 'files_diff_code_intelligence',
  'web_search_browser_research', 'multimodal_image_audio_video',
  'planning_goal_task_autonomy', 'remote_headless_im_mobile',
  'usage_quota_observability', 'skills_prompts_rules_migration', 'docs_howto',
  'domain_showcase', 'community_meta_nonactionable', 'other',
]
const piLines = [
  'provider_model', 'mcp', 'subagents', 'autonomous_goals_tasks', 'memory_learning',
  'code_intelligence_files', 'web_search_browser', 'multimodal_media',
  'background_jobs', 'remote_channels_voice', 'permission_sandbox',
  'skills_prompts_migration', 'session_import_search', 'ui_tui', 'none',
]
const fits = ['existing_pi_exact', 'existing_pi_partial', 'requires_pi2dsh_abi', 'upstream_dsh_only', 'not_a_problem']
const intents = ['bug', 'feature', 'question', 'showcase', 'documentation', 'community', 'nonactionable']

const system = `Audit every supplied deepseek-harness GitHub Discussion. Read every title and body; never prefilter or skip showcases. Assign exactly one PRIMARY root.
primary_category enum: ${primaryCategories.join(', ')}
intent enum: ${intents.join(', ')}
pi_line enum: ${piLines.join(', ')}
pi_fit enum: ${fits.join(', ')}

Pi line meanings:
provider_model=provider transports/OAuth/catalog/protocol/reasoning; mcp=advanced MCP; subagents=child agents/model pins/steering/resume; autonomous_goals_tasks=goal loops/audited queues/spec pipelines; memory_learning=cross-session memory/corrections/session search/learned skills; code_intelligence_files=LSP/AST/symbol/file context/diff; web_search_browser=search/fetch/browser/PDF/video research; multimodal_media=vision/image/audio/video; background_jobs=durable shell/model jobs/Fusion; remote_channels_voice=IM/phone/voice; permission_sandbox=permission enforcement/alternate sandbox; skills_prompts_migration=skill/config/prompt migration; session_import_search=import/search/organize sessions but not core corruption; ui_tui=optional Pi-owned presentation; none=no credible Pi path.

pi_fit meanings:
existing_pi_exact=mature Pi feature directly expresses an alternate solution; existing_pi_partial=helps but does not preserve the whole request; requires_pi2dsh_abi=Pi has it but the host compatibility standard needs a capability; upstream_dsh_only=DSH core/history/UI/security/lifecycle defect an extension cannot honestly repair; not_a_problem=showcase/community/announcement/vague/solution post.

Return ONLY a JSON array in input order, one object per item:
{"number":123,"primary_category":"...","intent":"...","pi_line":"...","pi_fit":"...","root":"concise Chinese root cause/request","confidence":0.0}
Never omit or reorder a number.`

const inputItem = item => ({
  number: item.number,
  github_category: item.category?.name,
  title: item.title,
  body: String(item.body ?? '').replaceAll('\u0000', '').slice(0, 2500),
})

function parseText(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))
}

async function classify(batch, attempt = 1) {
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 6000, temperature: 0, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content: JSON.stringify(batch.map(inputItem)) }] }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`)
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const values = parseText(text)
    const expected = batch.map(item => item.number)
    if (!Array.isArray(values) || JSON.stringify(values.map(item => item.number)) !== JSON.stringify(expected)) throw new Error('number/order mismatch')
    for (const value of values) {
      const warnings = []
      if (!primaryCategories.includes(value.primary_category)) { warnings.push(`invalid primary_category:${value.primary_category}`); value.primary_category = 'other' }
      if (!intents.includes(value.intent)) { warnings.push(`invalid intent:${value.intent}`); value.intent = 'nonactionable' }
      if (!piLines.includes(value.pi_line)) { warnings.push(`invalid pi_line:${value.pi_line}`); value.pi_line = 'none' }
      if (!fits.includes(value.pi_fit)) { warnings.push(`invalid pi_fit:${value.pi_fit}`); value.pi_fit = value.intent === 'showcase' ? 'not_a_problem' : 'upstream_dsh_only' }
      if (warnings.length > 0) { value.confidence = Math.min(Number(value.confidence) || 0, 0.49); value.classification_warning = warnings.join(';') }
    }
    return values
  } catch (error) {
    if (attempt >= 3) throw new Error(`parse failed: ${error.message}; ${text.slice(0, 600)}`)
    return classify(batch, attempt + 1)
  }
}

await mkdir(dirname(outputPath), { recursive: true })
let writes = Promise.resolve()
async function checkpoint() {
  const value = { schemaVersion: 1, capturedAt: source.capturedAt, classifiedAt: new Date().toISOString(), sourceCount: source.discussions.length, classifiedCount: byNumber.size, unclassifiedCount: source.discussions.length - byNumber.size, classifications: [...byNumber.values()].sort((a, b) => a.number - b.number) }
  const temporary = `${outputPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, outputPath)
}
const totalBatches = queue.length
let completed = 0
async function worker() {
  while (queue.length > 0) {
    const batch = queue.shift()
    if (!batch) return
    const values = await classify(batch)
    for (const value of values) byNumber.set(value.number, value)
    completed += 1
    writes = writes.then(checkpoint)
    await writes
    process.stderr.write(`classified ${byNumber.size}/${source.discussions.length} (${completed}/${totalBatches})\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ classified: byNumber.size, total: source.discussions.length, output: outputPath })}\n`)
