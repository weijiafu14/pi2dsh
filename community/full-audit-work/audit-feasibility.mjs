import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const discussionsSource = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8'))
const classificationSource = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8'))
const matchSource = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8'))
let overrideSource = { overrides: [] }
try {
  overrideSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-overrides.json'), 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const output = resolve(process.env.FEASIBILITY_OUTPUT ?? resolve(root, 'architecture-feasibility.json'))
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')

const problemIntents = new Set(['bug', 'feature', 'question', 'documentation'])
const classifications = new Map(classificationSource.classifications.map(item => [item.number, item]))
const matches = new Map(matchSource.matches.map(item => [item.number, item]))
const candidates = discussionsSource.discussions.filter(discussion => {
  const classification = classifications.get(discussion.number)
  const match = matches.get(discussion.number)
  return problemIntents.has(classification?.intent)
    && match?.status !== 'not_fit'
    && match?.product !== 'none'
})

const expectedCount = 1123
if (candidates.length !== expectedCount) {
  throw new Error(`candidate denominator drifted: expected ${expectedCount}, got ${candidates.length}`)
}

let prior = { audits: [] }
try {
  prior = JSON.parse(await readFile(output, 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const byNumber = new Map(prior.audits.map(item => [item.number, item]))
for (const override of overrideSource.overrides) byNumber.set(override.number, override)

const verdicts = [
  'ready_now',
  'e2e_only',
  'pi2dsh_adapter_work',
  'pi_product_work',
  'multi_product_composition',
  'dsh_public_seam_needed',
  'dsh_core_only',
]
const owners = ['pi2dsh', 'pi_package', 'composition', 'dsh_upstream', 'none']
const costs = ['xs', 's', 'm', 'l', 'xl']
const clusters = [
  'provider_tool_stream',
  'provider_reasoning_compat',
  'provider_oauth_credentials',
  'provider_gateway_catalog',
  'provider_request_metadata',
  'provider_replay_history',
  'provider_retry_errors',
  'multimodal_admission_generation',
  'mcp_runtime',
  'skills_config_migration',
  'skill_discovery_validation',
  'subagent_models_lifecycle',
  'subagent_delivery_ui',
  'background_durable_jobs',
  'session_import_search',
  'memory_learning',
  'compaction_cache',
  'file_context_diff',
  'code_intelligence',
  'sandbox_policy_remote',
  'approval_review',
  'remote_im_voice',
  'web_search_browser',
  'goal_plan_task',
  'plugin_install_lifecycle',
  'ui_client_extension',
  'usage_observability',
  'agent_browser',
  'host_core_other',
]
const capabilities = [
  'provider_transport', 'oauth_credentials', 'model_catalog', 'protocol_normalization',
  'tool_stream_identity', 'reasoning_compat', 'request_metadata', 'replay_history',
  'multimodal', 'mcp', 'skills_prompts', 'commands_hooks', 'subagent_sessions',
  'background_jobs', 'session_persistence', 'session_import', 'memory', 'compaction',
  'file_tools', 'code_intelligence', 'sandbox', 'approval', 'user_questions',
  'web_client', 'tui', 'remote_channels', 'web_search', 'goal_plan',
  'plugin_lifecycle', 'usage_observability', 'browser_automation',
]
const capabilityAliases = {
  provider_tool_stream: 'tool_stream_identity',
  provider_reasoning_compat: 'reasoning_compat',
  provider_oauth_credentials: 'oauth_credentials',
  provider_gateway_catalog: 'model_catalog',
  provider_request_metadata: 'request_metadata',
  provider_replay_history: 'replay_history',
  provider_retry_errors: 'protocol_normalization',
  multimodal_admission_generation: 'multimodal',
  mcp_runtime: 'mcp',
  skills_config_migration: 'skills_prompts',
  skill_discovery_validation: 'skills_prompts',
  subagent_models_lifecycle: 'subagent_sessions',
  subagent_delivery_ui: 'subagent_sessions',
  background_durable_jobs: 'background_jobs',
  session_import_search: 'session_import',
  memory_learning: 'memory',
  compaction_cache: 'compaction',
  file_context_diff: 'file_tools',
  sandbox_policy_remote: 'sandbox',
  approval_review: 'approval',
  remote_im_voice: 'remote_channels',
  web_search_browser: 'web_search',
  goal_plan_task: 'goal_plan',
  plugin_install_lifecycle: 'plugin_lifecycle',
  ui_client_extension: 'web_client',
  agent_browser: 'browser_automation',
}
const clusterAliases = {
  provider_transport: 'provider_gateway_catalog',
  oauth_credentials: 'provider_oauth_credentials',
  model_catalog: 'provider_gateway_catalog',
  protocol_normalization: 'provider_retry_errors',
  tool_stream_identity: 'provider_tool_stream',
  reasoning_compat: 'provider_reasoning_compat',
  request_metadata: 'provider_request_metadata',
  replay_history: 'provider_replay_history',
  multimodal: 'multimodal_admission_generation',
  mcp: 'mcp_runtime',
  skills_prompts: 'skills_config_migration',
  commands_hooks: 'skills_config_migration',
  subagent_sessions: 'subagent_models_lifecycle',
  background_jobs: 'background_durable_jobs',
  session_persistence: 'session_import_search',
  session_import: 'session_import_search',
  memory: 'memory_learning',
  compaction: 'compaction_cache',
  file_tools: 'file_context_diff',
  code_intelligence: 'code_intelligence',
  sandbox: 'sandbox_policy_remote',
  approval: 'approval_review',
  user_questions: 'ui_client_extension',
  web_client: 'ui_client_extension',
  tui: 'ui_client_extension',
  remote_channels: 'remote_im_voice',
  web_search: 'web_search_browser',
  goal_plan: 'goal_plan_task',
  plugin_lifecycle: 'plugin_install_lifecycle',
  usage_observability: 'usage_observability',
  browser_automation: 'agent_browser',
}

const capabilityLedger = `Current pi2dsh/Pi evidence (2026-08-24):
- pi2dsh 0.17 maps Pi tools, commands with arguments, prompt commands, lifecycle events, context transforms, user questions/dialog abort, shared per-agent event buses, sessions, credentials/OAuth, model catalogs/provider routes, attachments, TUI commands/status, and a DSH client bundle/slot surface.
- createAgentSession is a genuine DSH child session with official creator setup, native tools, explicit/live parent model route, per-child reasoning, background, steer/followUp distinction, stop, resume, persisted cross-process reopen, descriptor and lineage. Stock TUI/headless real-model E2E exists.
- pi-mcp-adapter 2.27 is proven on stock DSH/TUI for stdio, SSE, streamable HTTP, discovery, resources/prompts, OAuth/PKCE, approval, elicitation, sampling, cancellation, reconnect, MCP Apps and session restart.
- @kassing/pi-vision and pi-vision-tool have CLI/Web image-to-text paths; pi-codex-image-gen has Codex OAuth generation/editing and Web image-card E2E.
- Provider-owned Pi transports become DSH routes; Codex OAuth drives a real DSH model call; gateway compat carries reasoning and request compatibility fields. Alibaba Bailian has one real streamed-tool identity proof.
- pi-hermes-memory has cross-process memory E2E; rpiv-web-tools has provider-independent search E2E; approval-guardian has reviewer allow/deny E2E.
- Skills boundary: pi2dsh can expose skills/resources that an installed Pi package declares, plus Pi prompt commands. It has NO proven arbitrary Claude Code/Codex/traditional Skill-directory importer yet. MCP transports/resources/prompts are not a Skill compatibility layer; never use pi-mcp-adapter to claim traditional Skill support.
- Session boundary: durable DSH session logs can be read and searched by a plugin-owned tool/service/client route, including remote read-only history products. The missing general seam is arbitrary cross-agent native-session WRITING/import, not read-only listing/search. External memories should enter a memory product's own store, never be described as manufacturing DSH session history.
- A separate dsh-remote-sandbox product line can own E2B remote filesystem/subprocess execution as DSH tools through keeper/sidecar sessions. Treat remote execution/filesystem requests as product/adapter/E2E work when an alternate remote tool surface preserves the requested result; do not demand a DSH-core remote-filesystem API. The internal JD DevCloud backend is not externally reusable evidence.

Hard boundaries:
- Pi followUp and steer are distinct and already mapped faithfully. Do not call an intentional followUp queue an adapter gap.
- pi2dsh has no generic before_provider_headers or after_provider_response seam. A transport-owning Pi provider may normalize its own wire; it cannot repair another DSH adapter's parsed response.
- A plugin cannot repair DSH history after core corrupted tool-call/result identity, replay metadata, ordering, or persistence. It may offer an alternate transport/session path only when that preserves the requested outcome.
- A Pi client can draw its own panel/card through public DSH client slots; that does not fix DSH's core settings/history/subagent UI. Mark core UI requests upstream unless an honest plugin-owned surface is the requested outcome.
- A safer alternate tool does not make an enabled unsafe DSH core tool safe. Native sandbox escapes/self-approval/core permission defects are upstream; a fully alternate remote execution product may still solve a request for isolated execution.
- DSH install/pnpm/profile reconciliation, global Cordis singleton conflicts, core SDK wire contracts and internal test/release defects are upstream unless the user only needs an alternate package-owned workflow.
- DSH currently lacks a general cross-agent durable session importer/writer. Reading/searching external histories is possible; manufacturing arbitrary native DSH history is not.
- A first-pass conceptual_exact label is NOT runtime evidence. ready_now is legal only when the capability ledger above explicitly names a matching clean DSH E2E. Otherwise use e2e_only when implementation exists, or the appropriate work verdict.
- Product-line identifiers such as skills_prompt_migration/ui_tui are taxonomy labels, not npm packages. recommendedProducts must name a real package/project from the input or capability ledger, or stay empty; never invent an installable product from the taxonomy label.
- Never borrow evidence from an adjacent product: MCP is not Skills, a TUI is not a native desktop app, memory search is not native session import, an alternate sandbox does not fix an enabled native tool, and a plugin-owned panel does not fix DSH core UI.
- A request only to list/view/search/export existing durable sessions is product/adapter/E2E work over read-only persistence; never require an import/write seam unless the original Discussion explicitly asks to create or mutate native DSH history.
- Example: “Codex-like remote connection that can browse existing conversation history” is remote-client/session-search product work over read-only logs, not native-session import and not a DSH upstream seam. Do not recommend web-search products for session history.
- ready_now means the primary requested outcome works now. Its solution/blocker must not say unsupported, missing, wait, or recommend only telling the user it cannot work.

Interpret ownership independently of who is assigned to implement it. Provider, OAuth, MCP, subagents, vision, sessions and client presentation overlap; list every relevant shared capability.`

const system = `You are doing the SECOND-PASS architecture feasibility audit of every Pi-mapped DeepSeek Harness problem thread. The first pass only measured topical/product relevance and overcounted partial matches. Correct that.

For each input, read title, body, root classification and the first-pass product reason. Judge the PRIMARY requested outcome against the current capability ledger and hard boundaries. A Discussion may use several shared capabilities: retain intersections in sharedCapabilities, while choosing one engineeringCluster and one verdict.

Verdicts:
- ready_now: an existing Pi product + current pi2dsh evidence honestly delivers the primary outcome as an alternate. Never claim DSH core was fixed.
- e2e_only: architecture and implementation surfaces already exist; the exact disputed scenario only needs clean DSH E2E before promotion.
- pi2dsh_adapter_work: DSH has the required public seam and a mature Pi product/API exists, but pi2dsh lacks or mis-maps a standard Host ABI behavior. Adapter work can solve it without package-name business logic.
- pi_product_work: DSH public seams are sufficient, but the Pi package/product itself needs a new product feature; this is not an adapter mismatch.
- multi_product_composition: two or more existing proven Pi/pi2dsh abilities can deliver the full requested outcome once composition E2E is added.
- dsh_public_seam_needed: a narrow new DSH public seam/API is required; pi2dsh alone cannot complete it, but an upstream seam would unlock a plugin solution.
- dsh_core_only: the requested fix changes DSH core parsing/history/storage/install/security/global UI/lifecycle semantics outside honest plugin ownership. An adjacent alternate that misses a required semantic does not make this solvable.

Owner means the smallest boundary that must change: pi2dsh, pi_package, composition, dsh_upstream, none. Cost estimates the engineering + exact E2E needed for this thread if worked as part of its shared cluster, not an isolated rewrite.

Choose engineeringCluster and sharedCapabilities ONLY from these exact values; never invent a synonym:
- engineeringCluster: ${clusters.join(', ')}
- sharedCapabilities: ${capabilities.join(', ')}
- verdict: ${verdicts.join(', ')}
- owner: ${owners.join(', ')}
- cost: ${costs.join(', ')}

solution must be concrete and in Chinese. blocker must name the exact missing or already-available seam. evidenceNeeded must be a falsifiable DSH test, or "none" only for ready_now. confidence is 0..1.

${capabilityLedger}

Return ONLY a JSON array in input order. Each object exactly:
{"number":123,"verdict":"...","owner":"...","engineeringCluster":"...","sharedCapabilities":["..."],"recommendedProducts":["..."],"solution":"concise Chinese concrete path","blocker":"concise Chinese architecture boundary","evidenceNeeded":"concise falsifiable test or none","cost":"xs|s|m|l|xl","confidence":0.0}
Never omit or reorder an input.`

function item(discussion) {
  return {
    number: discussion.number,
    title: discussion.title,
    body: String(discussion.body ?? '').slice(0, 3600),
    githubCategory: discussion.category?.name,
    priorClassification: classifications.get(discussion.number),
    priorProductMatch: matches.get(discussion.number),
  }
}

function parse(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))
}

async function audit(batch, attempt = 1) {
  let payload
  try {
    const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
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
    return audit(batch, attempt + 1)
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
      if (!verdicts.includes(value.verdict)) warnings.push(`invalid verdict:${value.verdict}`)
      if (!owners.includes(value.owner)) warnings.push(`invalid owner:${value.owner}`)
      const rawCluster = value.engineeringCluster
      value.engineeringCluster = clusterAliases[rawCluster] ?? rawCluster
      if (value.engineeringCluster !== rawCluster) {
        value.normalizationWarning = [value.normalizationWarning, `cluster alias normalized: ${rawCluster}`]
          .filter(Boolean).join('; ')
        value.confidence = Math.min(Number(value.confidence) || 0, 0.79)
      }
      if (!clusters.includes(value.engineeringCluster)) warnings.push(`invalid cluster:${value.engineeringCluster}`)
      if (!costs.includes(value.cost)) warnings.push(`invalid cost:${value.cost}`)
      const rawCapabilities = Array.isArray(value.sharedCapabilities) ? value.sharedCapabilities : []
      const normalizedAliases = rawCapabilities.filter(capability => capabilityAliases[capability] !== undefined)
      value.sharedCapabilities = [...new Set(rawCapabilities.map(capability => capabilityAliases[capability] ?? capability))]
      if (normalizedAliases.length > 0) {
        value.normalizationWarning = [value.normalizationWarning, `capability aliases normalized: ${normalizedAliases.join(',')}`]
          .filter(Boolean).join('; ')
        value.confidence = Math.min(Number(value.confidence) || 0, 0.79)
      }
      const invalidCapabilities = Array.isArray(value.sharedCapabilities)
        ? value.sharedCapabilities.filter(capability => !capabilities.includes(capability))
        : ['<not-an-array>']
      if (invalidCapabilities.length > 0) {
        warnings.push(`invalid sharedCapabilities:${invalidCapabilities.join(',')}`)
      }
      if (!Array.isArray(value.recommendedProducts)) warnings.push('invalid recommendedProducts')
      if (value.verdict === 'ready_now'
        && /不支持|尚未|缺少|等待|无法|no support|missing|wait for/iu.test(`${value.solution ?? ''}\n${value.blocker ?? ''}`)) {
        warnings.push(`ready_now #${value.number} contradicts its own missing/unsupported text`)
      }
      if (warnings.length > 0) throw new Error(warnings.join('; '))
      value.confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0))
    }
    return values
  } catch (error) {
    if (attempt >= 4) throw new Error(`${error.message}: ${text.slice(0, 1000)}`)
    return audit(batch, attempt + 1)
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
  const audits = [...byNumber.values()].sort((a, b) => a.number - b.number)
  const value = {
    schemaVersion: 1,
    capturedAt: discussionsSource.capturedAt,
    auditedAt: new Date().toISOString(),
    problemThreadCount: 2789,
    candidateCount: candidates.length,
    auditedCount: audits.length,
    unauditedCount: candidates.length - audits.length,
    verdicts,
    clusters,
    capabilities,
    audits,
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
    const values = await audit(batch)
    for (const value of values) byNumber.set(value.number, value)
    completedBatches += 1
    writes = writes.then(checkpoint)
    await writes
    process.stderr.write(`feasibility ${byNumber.size}/${candidates.length} (${completedBatches}/${totalBatches} batches this run)\n`)
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ audited: byNumber.size, total: candidates.length, output })}\n`)
