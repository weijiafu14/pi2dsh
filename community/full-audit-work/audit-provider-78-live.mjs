import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const source = JSON.parse(await readFile(resolve(root, 'provider-78-live.json'), 'utf8'))
const output = resolve(root, 'provider-78-audit.json')
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')
if (source.records.length !== 78) throw new Error(`expected 78 records, got ${source.records.length}`)

let prior = { audits: [] }
try { prior = JSON.parse(await readFile(output, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
const byNumber = new Map(prior.audits.map(item => [item.number, item]))

const verdicts = [
  'ready_reply', 'e2e_only', 'pi2dsh_standard_gap', 'pi_provider_product_gap',
  'multi_product_composition', 'dsh_upstream', 'candidate_error',
]
const layers = [
  'none', 'test_only', 'pi2dsh_host_abi', 'pi_provider_product', 'composition',
  'dsh_public_seam', 'dsh_core', 'named_service_unknown',
]
const system = `Audit ONE current DeepSeek Harness Provider-related Discussion for a developer-ready pi2dsh plan. You receive the COMPLETE live title/body, ALL top-level comments, ALL replies, and the old audit. Ignore the old verdict when the live content contradicts it.

Read every supplied field. Determine the user's actual required outcome and the latest state from comments/replies. Do not classify by title keywords.

Verdicts:
- ready_reply: current repository evidence or a live comment proves an honest Pi/pi2dsh alternate for the exact outcome; no new E2E required.
- e2e_only: implementation/standard path already exists; the named service/failure shape needs a clean real DSH E2E before promotion.
- pi2dsh_standard_gap: a PUBLIC Pi Host ABI semantic and PUBLIC DSH seam exist, but pi2dsh still fails to translate it generically. Must name Pi semantic, DSH seam and missing mapping. Never create package-name special cases.
- pi_provider_product_gap: Host ABI is already faithful; the Pi Provider/product must add transport/catalog/auth/retry/normalization behavior.
- multi_product_composition: two or more existing products/abilities jointly preserve the outcome; composition E2E missing.
- dsh_upstream: the required semantic is inside DSH core/public API and cannot be honestly replaced by a transport-owning Provider.
- candidate_error: old 78-list inclusion is wrong, duplicate, already resolved upstream without our product, or insufficient information to define work.

Current pi2dsh facts:
- 0.17 maps Pi Provider registration/catalog/model route, package-owned transport, credentials/OAuth, model request/body compatibility, per-request reasoning, tools, commands, events, sessions, and DSH official llm-pi-ai route composition.
- Provider-owned Pi transports can normalize only their own outgoing/incoming wire. pi2dsh has no generic before_provider_headers or after_provider_response hook and cannot repair another DSH adapter after it parsed/corrupted a response.
- Codex OAuth real call, gateway compat request capture, reasoning/compat mapping, live/explicit child model routing, and one Bailian streamed-tool identity path are proven. Named services/accounts still need exact E2E unless the live thread or evidence says otherwise.
- Static non-secret headers are configurable; arbitrary secret/dynamic headers and host-wide attribution are different semantics.
- Pi followUp vs steer, Provider product behavior vs Host ABI mapping, and DSH core settings/UI must not be conflated.
- A discussion asking to fix DSH native parser/history/settings remains upstream even if an alternate provider route exists, unless the user's practical outcome is fully preserved by using that alternate.

For standard gaps, be strict: most Provider-specific protocol/retry/catalog/auth needs are pi_provider_product_gap or e2e_only, not pi2dsh_standard_gap. A pi2dsh standard gap requires an actual Pi public semantic that current pi2dsh drops or mis-maps for every conforming package.

Return ONLY one JSON object:
{
  "number":123,
  "verdict":"one enum",
  "missingLayer":"one enum",
  "actualProblem":"Chinese, exact user outcome",
  "requiredSemantics":["essential semantics"],
  "latestThreadState":"what comments/replies establish, including upstream fixes/duplicates",
  "sourceEvidence":[{"url":"discussion/comment URL","fact":"short paraphrase, no long quote"}],
  "piPublicSemantic":"exact Pi API/behavior, or none",
  "dshPublicSeam":"exact DSH seam, or none",
  "currentPi2dshGap":"exact missing/mis-mapped behavior, or none",
  "implementationTask":"generic developer task, or none",
  "genericStandardWork":true,
  "affectedProviders":["names or all conforming providers"],
  "acceptanceE2E":["falsifiable checks"],
  "replyCondition":"what must be true before replying",
  "devCluster":"stable-kebab-case root cause",
  "confidence":0.0
}
Use verdict only from: ${verdicts.join(', ')}.
Use missingLayer only from: ${layers.join(', ')}.`

function cleanRecord(record) {
  return {
    number: record.number,
    title: record.title,
    body: record.body,
    url: record.url,
    updatedAt: record.updatedAt,
    isAnswered: record.isAnswered,
    answerChosenAt: record.answerChosenAt,
    comments: record.comments.map(comment => ({
      author: comment.author?.login,
      body: comment.body,
      url: comment.url,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      replies: comment.replies.nodes.map(reply => ({
        author: reply.author?.login,
        body: reply.body,
        url: reply.url,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt,
      })),
    })),
    oldAudit: record.priorAudit,
  }
}
const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))

async function audit(record, attempt = 1) {
  let payload
  try {
    const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.PROVIDER_AUDIT_MODEL ?? 'deepseek-v4-flash',
        max_tokens: Number(process.env.PROVIDER_AUDIT_MAX_TOKENS ?? 5000),
        temperature: 0,
        thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: JSON.stringify(cleanRecord(record)) }],
      }),
    })
    payload = await response.json()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`)
  } catch (error) {
    if (attempt >= 6) throw error
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * (2 ** attempt)))
    return audit(record, attempt + 1)
  }
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const value = parse(text)
    const warnings = []
    if (value.number !== record.number) warnings.push(`number mismatch:${value.number}`)
    if (!verdicts.includes(value.verdict)) warnings.push(`invalid verdict:${value.verdict}`)
    if (!layers.includes(value.missingLayer)) warnings.push(`invalid layer:${value.missingLayer}`)
    for (const key of ['requiredSemantics', 'sourceEvidence', 'affectedProviders', 'acceptanceE2E']) {
      if (!Array.isArray(value[key])) warnings.push(`${key} is not array`)
    }
    for (const key of ['actualProblem', 'latestThreadState', 'piPublicSemantic', 'dshPublicSeam', 'currentPi2dshGap', 'implementationTask', 'replyCondition', 'devCluster']) {
      if (typeof value[key] !== 'string' || value[key].length === 0) warnings.push(`${key} missing`)
    }
    if (typeof value.genericStandardWork !== 'boolean') warnings.push('genericStandardWork not boolean')
    if (value.verdict === 'pi2dsh_standard_gap'
      && (/^none$/iu.test(value.piPublicSemantic) || /^none$/iu.test(value.dshPublicSeam)
        || /^none$/iu.test(value.currentPi2dshGap))) {
      warnings.push('standard gap lacks Pi/DSH/gap triplet')
    }
    const isNone = input => /^(?:none|无|没有|无需)(?:$|\s*[-—:])/iu.test(String(input).trim())
    if (value.verdict === 'ready_reply'
      && (!isNone(value.currentPi2dshGap) || !isNone(value.implementationTask))) {
      warnings.push('ready reply still declares a current gap or implementation task')
    }
    if (warnings.length > 0) throw new Error(warnings.join('; '))
    value.confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0))
    value.fullBodyChars = record.body.length
    value.topLevelCommentCount = record.comments.length
    value.replyCount = record.comments.reduce((sum, comment) => sum + comment.replies.nodes.length, 0)
    return value
  } catch (error) {
    if (attempt >= 4) throw new Error(`#${record.number} ${error.message}: ${text.slice(0, 1200)}`)
    return audit(record, attempt + 1)
  }
}

async function checkpoint() {
  const audits = [...byNumber.values()].sort((a, b) => a.number - b.number)
  const temporary = `${output}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: 1,
    fetchedAt: source.fetchedAt,
    auditedAt: new Date().toISOString(),
    candidateCount: source.records.length,
    auditedCount: audits.length,
    unauditedCount: source.records.length - audits.length,
    verdicts,
    layers,
    audits,
  }, null, 2)}\n`)
  await rename(temporary, output)
}

const queue = source.records.filter(record => !byNumber.has(record.number))
const concurrency = Number(process.env.PROVIDER_AUDIT_CONCURRENCY ?? 6)
let completed = 0
let writes = Promise.resolve()
async function worker() {
  while (queue.length > 0) {
    const record = queue.shift()
    if (!record) return
    const value = await audit(record)
    byNumber.set(value.number, value)
    completed += 1
    writes = writes.then(checkpoint)
    await writes
    process.stderr.write(`provider live audit ${byNumber.size}/${source.records.length} (${completed} this run)\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ output, audited: byNumber.size, total: source.records.length })}\n`)
