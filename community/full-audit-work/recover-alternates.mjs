import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const discussionsSource = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8'))
const matchSource = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8'))
const challengeSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-challenges.json'), 'utf8'))
const evidenceGroupSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-evidence-groups.json'), 'utf8'))
let overrideSource = { overrides: [] }
try {
  overrideSource = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-recovery-overrides.json'), 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const output = resolve(process.env.FEASIBILITY_RECOVERY_OUTPUT ?? resolve(root, 'architecture-feasibility-recoveries.json'))
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')

const discussions = new Map(discussionsSource.discussions.map(item => [item.number, item]))
const matches = new Map(matchSource.matches.map(item => [item.number, item]))
const challenges = new Map(challengeSource.challenges.map(item => [item.number, item]))
const knownEvidence = new Map()
for (const group of evidenceGroupSource.groups) {
  for (const number of group.numbers) knownEvidence.set(number, group)
}
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
const allCandidates = [...challenges.values()].filter(item => item.verdict === 'dsh_core_only').sort((a, b) => a.number - b.number)
if (allCandidates.length !== 873) throw new Error(`core-only denominator must be 873, got ${allCandidates.length}`)
const requestedNumbers = new Set(String(process.env.FEASIBILITY_NUMBERS ?? '')
  .split(',').map(value => value.trim()).filter(Boolean).map(Number).filter(Number.isFinite))
const candidates = requestedNumbers.size > 0
  ? allCandidates.filter(item => requestedNumbers.has(item.number))
  : allCandidates

const statuses = [
  'no_alternate', 'ready_now', 'e2e_only', 'pi2dsh_adapter_work',
  'pi_product_work', 'multi_product_composition',
]
const verdictOf = {
  ready_now: 'ready_now', e2e_only: 'e2e_only',
  pi2dsh_adapter_work: 'pi2dsh_adapter_work', pi_product_work: 'pi_product_work',
  multi_product_composition: 'multi_product_composition',
}
const costs = ['xs', 's', 'm', 'l', 'xl']
const clusters = JSON.parse(await readFile(resolve(root, 'architecture-feasibility.json'), 'utf8')).clusters
const capabilities = JSON.parse(await readFile(resolve(root, 'architecture-feasibility.json'), 'utf8')).capabilities

let prior = { recoveries: [] }
try { prior = JSON.parse(await readFile(output, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
const byNumber = new Map(prior.recoveries.map(item => [item.number, item]))
for (const override of overrideSource.overrides) byNumber.set(override.number, override)
for (const [number, group] of knownEvidence) {
  if (challenges.get(number)?.verdict !== 'dsh_core_only') continue
  const defaults = evidenceDefaults[group.id]
  if (!defaults) throw new Error(`missing evidence defaults for ${group.id}`)
  byNumber.set(number, {
    number,
    status: group.defaultStatus,
    engineeringCluster: defaults.cluster,
    sharedCapabilities: defaults.capabilities,
    recommendedProducts: defaults.products,
    practicalOutcome: discussions.get(number)?.title ?? `Discussion #${number}`,
    preservedSemantics: group.evidence,
    lostSemantics: 'none',
    solution: `使用已验证的 ${group.id} 替代路线交付原帖的实际用户结果；不声称 DSH 原生实现已修。`,
    evidenceNeeded: 'none',
    cost: 'xs',
    confidence: 0.99,
    evidenceOverride: group.id,
  })
}

const evidence = `Current honest alternate products:
- @tintinweb/pi-subagents through pi2dsh 0.17: native DSH child sessions, real tools, background/wait, explicit and live parent model routing, per-child reasoning, steer/followUp distinction, stop, resume, cross-process reopen, descriptor/lineage. Real stock TUI/headless E2E. Thus a user's practical need for working child agents/model choice/steer/resume can be satisfied even while DSH native subagent remains buggy; core UI/status/delivery bugs are not thereby fixed.
- pi-mcp-adapter 2.27 through pi2dsh: advanced MCP transport/OAuth/discovery/resources/prompts/approval/elicitation/sampling/cancel/reconnect/MCP Apps/session restart, stock DSH/TUI E2E. It cannot fix another MCP runtime's internal bug.
- vision: @kassing/pi-vision automatic analysis injection and pi-vision-tool path-based fallback have real DSH CLI/Web proofs. These satisfy “let a text model handle an attached image”; they do not fix DSH core image UI or a named local model's missing vision.
- pi-codex-image-gen: Codex OAuth image generation/editing + DSH Web image result proof.
- provider-owned Pi transports may replace a broken DSH adapter for the SAME named service/protocol and normalize their own streamed tool calls/reasoning/request fields. Codex OAuth, gateway compat and one Bailian streamed-tool proof exist. If no exact provider/service proof exists, use e2e_only or product/adapter work, not ready.
- pi-hermes-memory cross-process memory; rpiv-web-tools search; approval-guardian review. Traditional Skill import is not yet proven.
- dsh-remote-sandbox can own E2B remote fs/subprocess tools. Internal JD DevCloud is not public evidence.
- read-only session search/remote browsing can be product-owned. Arbitrary native DSH session writing/import is unavailable.
- Plugin-owned UI through DSH client slots is an alternate only if it delivers the user's practical UI/product outcome; it does not repair a specifically requested core page/layout/status.

Non-alternatable examples: exact fix to DSH installer/profile reconciliation; core security invariant while unsafe native tool remains enabled; corrupt history/replay already produced by core; exact core Web layout/settings/history behavior; global Cordis singleton/process lifecycle; internal tests/releases. A different panel/tool that leaves the required semantic broken is no_alternate.`

const system = `You are a third-pass alternate-path recovery auditor. Every input was judged dsh_core_only. Ignore whether DSH native code is fixed and ask a narrower product question:

Can an existing or buildable Pi/pi2dsh/provider/remote-sandbox/client-owned route let the user accomplish the SAME practical job with all essential semantics preserved?

- If yes, classify how far away: ready_now, e2e_only, pi2dsh_adapter_work, pi_product_work, or multi_product_composition.
- If an essential semantic is lost, status=no_alternate and name that loss.
- A Bug title does not force no_alternate; focus on user outcome. Conversely, superficial topical similarity is not enough.
- ready_now requires an exact E2E named below. Provider service-specific claims without exact proof are e2e_only or work.
- Only inputs carrying knownCurrentEvidence may be ready_now in this recovery pass. Every other recoverable alternate is at most e2e_only until its exact scenario is run.
- Explicit examples: stale/native subagent model routing can be replaced by proven Pi subagents; text-model image handling can be replaced by proven vision bridge; core subagent status colors cannot; DSH install corruption cannot; a named service's broken parser can only be replaced if a provider-owned route for that service can own the whole transport.

${evidence}

Use exact enums only:
- status: ${statuses.join(', ')}
- engineeringCluster: ${clusters.join(', ')}
- sharedCapabilities: ${capabilities.join(', ')}
- cost: ${costs.join(', ')}

Return ONLY a JSON array in input order:
{"number":123,"status":"...","engineeringCluster":"...","sharedCapabilities":["..."],"recommendedProducts":["real package/project"],"practicalOutcome":"exact user job","preservedSemantics":"what remains intact","lostSemantics":"none or essential loss","solution":"concrete Chinese alternate","evidenceNeeded":"falsifiable DSH test or none only for ready_now","cost":"xs|s|m|l|xl","confidence":0.0}
Never omit/reorder.`

function item(challenge) {
  const discussion = discussions.get(challenge.number)
  return {
    number: challenge.number,
    title: discussion?.title,
    body: String(discussion?.body ?? '').slice(0, 3600),
    firstProductMatch: matches.get(challenge.number),
    priorCoreAudit: challenge,
    knownCurrentEvidence: knownEvidence.get(challenge.number),
  }
}
const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))

async function recover(batch, attempt = 1) {
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
    return recover(batch, attempt + 1)
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
      if (!statuses.includes(value.status)) warnings.push(`invalid status:${value.status}`)
      if (!clusters.includes(value.engineeringCluster)) warnings.push(`invalid cluster:${value.engineeringCluster}`)
      if (!costs.includes(value.cost)) warnings.push(`invalid cost:${value.cost}`)
      const invalidCapabilities = Array.isArray(value.sharedCapabilities)
        ? value.sharedCapabilities.filter(capability => !capabilities.includes(capability)) : ['<not-array>']
      if (invalidCapabilities.length > 0) warnings.push(`invalid capabilities:${invalidCapabilities.join(',')}`)
      if (!Array.isArray(value.recommendedProducts)) warnings.push('recommendedProducts is not array')
      if (value.status === 'ready_now'
        && (/不支持|尚未|缺少|等待|无法|no support|missing|wait for/iu.test(`${value.solution ?? ''}\n${value.lostSemantics ?? ''}`)
          || String(value.evidenceNeeded).trim().toLowerCase() !== 'none')) {
        warnings.push(`ready_now #${value.number} lacks exact evidence or contradicts itself`)
      }
      if (value.status !== 'no_alternate' && !verdictOf[value.status]) warnings.push('status has no verdict mapping')
      if (knownEvidence.has(value.number) && value.status === 'no_alternate') {
        warnings.push(`known evidence #${value.number} was ignored`)
      }
      if (!knownEvidence.has(value.number) && value.status === 'ready_now') {
        warnings.push(`unproven recovery #${value.number} cannot be ready_now`)
      }
      if (warnings.length > 0) throw new Error(warnings.join('; '))
      value.confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0))
    }
    return values
  } catch (error) {
    if (attempt >= 4) throw new Error(`${error.message}: ${text.slice(0, 1000)}`)
    return recover(batch, attempt + 1)
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
  const recoveries = [...byNumber.values()].sort((a, b) => a.number - b.number)
  const value = {
    schemaVersion: 1,
    capturedAt: discussionsSource.capturedAt,
    recoveredAt: new Date().toISOString(),
    candidateCount: candidates.length,
    recoveredCount: recoveries.length,
    unrecoveredCount: candidates.length - recoveries.length,
    recoveries,
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
    const values = await recover(batch)
    for (const value of values) byNumber.set(value.number, value)
    completedBatches += 1
    writes = writes.then(checkpoint)
    await writes
    process.stderr.write(`recovery ${byNumber.size}/${candidates.length} (${completedBatches}/${totalBatches} batches this run)\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ recovered: byNumber.size, total: candidates.length, output })}\n`)
