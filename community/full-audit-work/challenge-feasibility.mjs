import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const discussionsSource = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8'))
const classificationSource = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8'))
const matchSource = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8'))
const firstSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility.json'), 'utf8'))
let overrideSource = { overrides: [] }
try {
  overrideSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-challenge-overrides.json'), 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const output = resolve(process.env.FEASIBILITY_CHALLENGE_OUTPUT ?? resolve(root, 'architecture-feasibility-challenges.json'))
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')

const discussions = new Map(discussionsSource.discussions.map(item => [item.number, item]))
const classifications = new Map(classificationSource.classifications.map(item => [item.number, item]))
const matches = new Map(matchSource.matches.map(item => [item.number, item]))
const first = new Map(firstSource.audits.map(item => [item.number, item]))
if (first.size !== 1123) throw new Error(`first-pass denominator must be 1123, got ${first.size}`)

const verdicts = [
  'ready_now', 'e2e_only', 'pi2dsh_adapter_work', 'pi_product_work',
  'multi_product_composition', 'dsh_public_seam_needed', 'dsh_core_only',
]
const owners = ['pi2dsh', 'pi_package', 'composition', 'dsh_upstream', 'none']
const costs = ['xs', 's', 'm', 'l', 'xl']
const clusters = firstSource.clusters
const capabilities = firstSource.capabilities
const clusterAliases = {
  provider_transport: 'provider_gateway_catalog', oauth_credentials: 'provider_oauth_credentials',
  model_catalog: 'provider_gateway_catalog', protocol_normalization: 'provider_retry_errors',
  tool_stream_identity: 'provider_tool_stream', reasoning_compat: 'provider_reasoning_compat',
  request_metadata: 'provider_request_metadata', replay_history: 'provider_replay_history',
  multimodal: 'multimodal_admission_generation', mcp: 'mcp_runtime',
  skills_prompts: 'skills_config_migration', commands_hooks: 'skills_config_migration',
  subagent_sessions: 'subagent_models_lifecycle', background_jobs: 'background_durable_jobs',
  session_persistence: 'session_import_search', session_import: 'session_import_search',
  memory: 'memory_learning', compaction: 'compaction_cache', file_tools: 'file_context_diff',
  sandbox: 'sandbox_policy_remote', approval: 'approval_review', user_questions: 'ui_client_extension',
  web_client: 'ui_client_extension', tui: 'ui_client_extension', remote_channels: 'remote_im_voice',
  web_search: 'web_search_browser', goal_plan: 'goal_plan_task', plugin_lifecycle: 'plugin_install_lifecycle',
  browser_automation: 'agent_browser',
}
const capabilityAliases = {
  provider_tool_stream: 'tool_stream_identity', provider_reasoning_compat: 'reasoning_compat',
  provider_oauth_credentials: 'oauth_credentials', provider_gateway_catalog: 'model_catalog',
  provider_request_metadata: 'request_metadata', provider_replay_history: 'replay_history',
  provider_retry_errors: 'protocol_normalization', multimodal_admission_generation: 'multimodal',
  mcp_runtime: 'mcp', skills_config_migration: 'skills_prompts', skill_discovery_validation: 'skills_prompts',
  subagent_models_lifecycle: 'subagent_sessions', subagent_delivery_ui: 'subagent_sessions',
  background_durable_jobs: 'background_jobs', session_import_search: 'session_import',
  memory_learning: 'memory', compaction_cache: 'compaction', file_context_diff: 'file_tools',
  sandbox_policy_remote: 'sandbox', approval_review: 'approval', remote_im_voice: 'remote_channels',
  web_search_browser: 'web_search', goal_plan_task: 'goal_plan', plugin_install_lifecycle: 'plugin_lifecycle',
  ui_client_extension: 'web_client', agent_browser: 'browser_automation',
}

let prior = { challenges: [] }
try {
  prior = JSON.parse(await readFile(output, 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const byNumber = new Map(prior.challenges.map(item => [item.number, item]))
for (const override of overrideSource.overrides) byNumber.set(override.number, override)
const candidates = [...first.values()].sort((a, b) => a.number - b.number)

const evidence = `Evidence and architecture boundaries:
- pi2dsh 0.17 maps Pi tools, commands, prompt commands, lifecycle/context events, user questions, shared per-agent event buses, durable sessions, credentials/OAuth, model catalogs/provider-owned transports, attachments, TUI and DSH client slots.
- createAgentSession is a real DSH child: native tools, explicit/live model route, per-child reasoning, background, steer/followUp distinction, stop/resume/reopen. Stock TUI/headless real-model E2E.
- pi-mcp-adapter 2.27: stock DSH/TUI proof for three transports, discovery, resources/prompts, OAuth/PKCE, approval/elicitation/sampling, cancellation/reconnect, MCP Apps, session restart.
- vision: @kassing/pi-vision automatic text injection and pi-vision-tool path-tool fallback have CLI/Web proofs. pi-codex-image-gen generation/editing has Codex OAuth + Web image proof.
- provider: provider-owned Pi transports become DSH routes; Codex OAuth real call; gateway compat; Bailian streamed tool identity proof. A transport-owning provider may normalize its own wire, never another adapter's parsed result.
- pi-hermes-memory cross-process add/search proof; rpiv-web-tools search proof; approval-guardian review proof.
- dsh-remote-sandbox may own E2B remote filesystem/subprocess tools; internal JD DevCloud is not external evidence.
- arbitrary traditional/Claude/Codex Skill directory import is NOT yet proven. MCP is not Skills.
- read-only DSH session listing/search/export can be product-owned. Arbitrary native-session writing/import lacks a general seam.
- Web-search products such as rpiv-web-tools cannot read DSH session history. A remote history browser needs session persistence/search plus a remote/client product; never recommend web search for it.
- Pi followUp intentionally queues; steer is separate. Reinterpreting every followUp is an ABI violation.
- plugin-owned client panels/cards are honest alternates only when the user asks for that capability, not a fix for DSH core pages.
- core history corruption, native parser/persistence/install/global lifecycle/security bugs remain upstream unless a full alternate transport/tool/session preserves the requested user outcome.`

const system = `Adversarially challenge a first-pass architecture-feasibility audit of DeepSeek Harness Discussions. Review EVERY input independently. The first pass overclassified many items as dsh_core_only and can also overclaim ready_now.

Process:
1. State the exact PRIMARY user outcome from title/body, not the proposed implementation.
2. Search for an honest product-owned alternate using Pi/provider transport/tools/sessions/client/remote sandbox. If it preserves the full requested outcome, it can be product/adapter/composition work even though DSH native core stays broken.
3. If the user explicitly asks to fix a DSH core page/parser/history/security invariant, an adjacent panel/tool is not enough.
4. ready_now requires an exact matching E2E explicitly named in the evidence below. First-pass exact/reason is not evidence.
5. Distinguish read-only history from native history writing; Skills from MCP; followUp from steer; alternate sandbox from fixing native unsafe tools.
6. Provider/OAuth/MCP/subagent/vision/session/client capabilities overlap regardless of implementation owner.

${evidence}

Use exact enums only:
- verdict: ${verdicts.join(', ')}
- owner: ${owners.join(', ')}
- engineeringCluster: ${clusters.join(', ')}
- sharedCapabilities: ${capabilities.join(', ')}
- cost: ${costs.join(', ')}

Return ONLY a JSON array in input order. Always return a complete final audit, even when upholding:
{"number":123,"decision":"uphold|revise","originalVerdict":"...","verdict":"...","owner":"...","engineeringCluster":"...","sharedCapabilities":["..."],"recommendedProducts":["real package/project only"],"solution":"concrete Chinese path","blocker":"exact boundary","evidenceNeeded":"falsifiable test or none only for ready_now","cost":"xs|s|m|l|xl","confidence":0.0,"challengeReason":"why first pass stands or changes"}
Never omit/reorder.`

function item(audit) {
  const discussion = discussions.get(audit.number)
  return {
    number: audit.number,
    title: discussion?.title,
    body: String(discussion?.body ?? '').slice(0, 3600),
    priorClassification: classifications.get(audit.number),
    priorProductMatch: matches.get(audit.number),
    firstAudit: audit,
  }
}
const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))

async function challenge(batch, attempt = 1) {
  let payload
  try {
    const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.FEASIBILITY_MODEL ?? 'deepseek-v4-flash',
        max_tokens: Number(process.env.FEASIBILITY_MAX_TOKENS ?? 10000),
        temperature: 0,
        thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: JSON.stringify(batch.map(item)) }],
      }),
    })
    payload = await response.json()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`)
  } catch (error) {
    if (attempt >= 6) throw error
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * (2 ** attempt)))
    return challenge(batch, attempt + 1)
  }
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const values = parse(text)
    if (!Array.isArray(values)
      || JSON.stringify(values.map(value => value.number)) !== JSON.stringify(batch.map(value => value.number))) {
      throw new Error('number/order mismatch')
    }
    for (const value of values) {
      const warnings = []
      const rawCluster = value.engineeringCluster
      value.engineeringCluster = clusterAliases[rawCluster] ?? rawCluster
      const rawCapabilities = Array.isArray(value.sharedCapabilities) ? value.sharedCapabilities : []
      value.sharedCapabilities = [...new Set(rawCapabilities.map(capability => capabilityAliases[capability] ?? capability))]
      const normalized = []
      if (rawCluster !== value.engineeringCluster) normalized.push(`cluster:${rawCluster}`)
      for (const capability of rawCapabilities) if (capabilityAliases[capability]) normalized.push(`capability:${capability}`)
      if (normalized.length > 0) {
        value.normalizationWarning = normalized.join(',')
        value.confidence = Math.min(Number(value.confidence) || 0, 0.79)
      }
      if (!['uphold', 'revise'].includes(value.decision)) warnings.push(`invalid decision:${value.decision}`)
      if (value.originalVerdict !== first.get(value.number)?.verdict) warnings.push('original verdict mismatch')
      if (!verdicts.includes(value.verdict)) warnings.push(`invalid verdict:${value.verdict}`)
      if (!owners.includes(value.owner)) warnings.push(`invalid owner:${value.owner}`)
      if (!clusters.includes(value.engineeringCluster)) warnings.push(`invalid cluster:${value.engineeringCluster}`)
      if (!costs.includes(value.cost)) warnings.push(`invalid cost:${value.cost}`)
      const invalidCapabilities = value.sharedCapabilities.filter(capability => !capabilities.includes(capability))
      if (invalidCapabilities.length > 0) warnings.push(`invalid capabilities:${invalidCapabilities.join(',')}`)
      if (!Array.isArray(value.recommendedProducts)) warnings.push('recommendedProducts is not an array')
      if (value.engineeringCluster === 'session_import_search'
        && value.recommendedProducts?.some(product => /rpiv-web-tools|web.?search/iu.test(String(product)))) {
        warnings.push(`session history #${value.number} incorrectly recommends a web-search product`)
      }
      if (value.verdict === 'ready_now'
        && /不支持|尚未|缺少|等待|无法|no support|missing|wait for/iu.test(`${value.solution ?? ''}\n${value.blocker ?? ''}`)) {
        warnings.push(`ready_now #${value.number} contradicts missing text`)
      }
      if (warnings.length > 0) throw new Error(warnings.join('; '))
      value.confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0))
    }
    return values
  } catch (error) {
    if (attempt >= 4) throw new Error(`${error.message}: ${text.slice(0, 1000)}`)
    return challenge(batch, attempt + 1)
  }
}

const limit = Number(process.env.FEASIBILITY_LIMIT ?? 0)
const batchSize = Number(process.env.FEASIBILITY_BATCH_SIZE ?? 16)
const concurrency = Number(process.env.FEASIBILITY_CONCURRENCY ?? 6)
const pendingAll = candidates.filter(candidate => !byNumber.has(candidate.number))
const pending = limit > 0 ? pendingAll.slice(0, limit) : pendingAll
const queue = []
for (let index = 0; index < pending.length; index += batchSize) queue.push(pending.slice(index, index + batchSize))

await mkdir(dirname(output), { recursive: true })
let writes = Promise.resolve()
async function checkpoint() {
  const challenges = [...byNumber.values()].sort((a, b) => a.number - b.number)
  const value = {
    schemaVersion: 1,
    capturedAt: discussionsSource.capturedAt,
    challengedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    challengedCount: challenges.length,
    unchallengedCount: candidates.length - challenges.length,
    challenges,
  }
  const temporary = `${output}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, output)
}
const totalBatches = queue.length
let completedBatches = 0
async function worker() {
  while (queue.length > 0) {
    const batch = queue.shift()
    if (!batch) return
    const values = await challenge(batch)
    for (const value of values) byNumber.set(value.number, value)
    completedBatches += 1
    writes = writes.then(checkpoint)
    await writes
    process.stderr.write(`challenge ${byNumber.size}/${candidates.length} (${completedBatches}/${totalBatches} batches this run)\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ challenged: byNumber.size, total: candidates.length, output })}\n`)
