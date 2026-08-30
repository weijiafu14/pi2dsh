import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const discussions = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8')).discussions
const data = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8'))
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')
const discussionByNumber = new Map(discussions.map(item => [item.number, item]))
const candidates = data.classifications.filter(item => item.classification_warning || item.primary_category === 'other' || Number(item.confidence) < 0.7)

const categories = ['provider_model_protocol','install_update_startup','plugin_framework_market','session_workspace_history','tool_loop_runtime','background_jobs','sandbox_permissions_security','web_desktop_ui','mcp','subagents_multiagent_workflow','context_tokens_cache_compaction','memory_learning','files_diff_code_intelligence','web_search_browser_research','multimodal_image_audio_video','planning_goal_task_autonomy','remote_headless_im_mobile','usage_quota_observability','skills_prompts_rules_migration','docs_howto','domain_showcase','community_meta_nonactionable','other']
const intents = ['bug','feature','question','showcase','documentation','community','nonactionable']
const lines = ['provider_model','mcp','subagents','autonomous_goals_tasks','memory_learning','code_intelligence_files','web_search_browser','multimodal_media','background_jobs','remote_channels_voice','permission_sandbox','skills_prompts_migration','session_import_search','ui_tui','none']
const fits = ['existing_pi_exact','existing_pi_partial','requires_pi2dsh_abi','upstream_dsh_only','not_a_problem']
const categoryAliases = {
  ui_tui: 'web_desktop_ui',
  permission_sandbox_security: 'sandbox_permissions_security',
  autonomous_goals_task_autonomy: 'planning_goal_task_autonomy',
}
const system = `Re-audit ambiguous deepseek-harness Discussions using the FULL body. Choose only the exact enums below; do not invent aliases.
primary_category: ${categories.join(', ')}
intent: ${intents.join(', ')}
pi_line: ${lines.join(', ')}
pi_fit: ${fits.join(', ')}
Pick one primary root. existing_pi_exact means a mature Pi extension directly offers an alternate path; partial means it helps but cannot preserve all requested semantics; requires_pi2dsh_abi means Pi has it but the compatibility standard lacks a host surface; upstream_dsh_only means a DSH core/history/UI/security/lifecycle defect; not_a_problem means showcase/community/vague/solution.
Pi lines: provider_model; mcp; subagents; autonomous_goals_tasks; memory_learning; code_intelligence_files; web_search_browser; multimodal_media; background_jobs; remote_channels_voice; permission_sandbox; skills_prompts_migration; session_import_search; ui_tui; none.
Return ONLY a JSON array in input order with {number,primary_category,intent,pi_line,pi_fit,root,confidence}. Never omit/reorder.`

function parse(text) { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')) }
async function call(batch, attempt = 1) {
  const input = batch.map(old => { const d = discussionByNumber.get(old.number); return { number: d.number, github_category: d.category?.name, title: d.title, body: String(d.body ?? '').slice(0, 8000), previous: old } })
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 5000, temperature: 0, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content: JSON.stringify(input) }] }) })
  const payload = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const values = parse(text)
    if (!Array.isArray(values) || JSON.stringify(values.map(v => v.number)) !== JSON.stringify(batch.map(v => v.number))) throw new Error('number mismatch')
    for (const value of values) {
      value.primary_category = categoryAliases[value.primary_category] ?? value.primary_category
      if (!categories.includes(value.primary_category) || !intents.includes(value.intent) || !lines.includes(value.pi_line) || !fits.includes(value.pi_fit)) throw new Error(`invalid enum #${value.number}`)
      delete value.classification_warning
    }
    return values
  } catch (error) {
    if (attempt >= 3) throw new Error(`${error.message}: ${text.slice(0, 800)}`)
    return call(batch, attempt + 1)
  }
}

const replacements = new Map()
for (let index = 0; index < candidates.length; index += 15) {
  const batch = candidates.slice(index, index + 15)
  for (const value of await call(batch)) replacements.set(value.number, value)
  process.stderr.write(`repaired ${replacements.size}/${candidates.length}\n`)
}
data.classifications = data.classifications.map(item => replacements.get(item.number) ?? item)
data.classifiedAt = new Date().toISOString()
data.repairedCount = replacements.size
const output = resolve(root, 'classifications.json')
const temporary = `${output}.tmp`
await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
await rename(temporary, output)
process.stdout.write(`${JSON.stringify({ repaired: replacements.size, output })}\n`)
