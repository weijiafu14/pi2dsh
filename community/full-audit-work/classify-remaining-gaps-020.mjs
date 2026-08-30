import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const reassessment = JSON.parse(await readFile(resolve(root, 'partial-reassessment-0.20.json'), 'utf8'))
const discussions = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8')).discussions
const discussionByNumber = new Map(discussions.map(item => [item.number, item]))
const candidates = reassessment.results
  .filter(item => item.verdict === 'still_partial')
  .map(item => ({ ...item, discussion: discussionByNumber.get(item.number) }))
const output = resolve(root, 'remaining-gap-ownership-0.20.json')
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')

let prior = { results: [] }
try { prior = JSON.parse(await readFile(output, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
const byNumber = new Map(prior.results.map(item => [item.number, item]))
const pending = candidates.filter(item => !byNumber.has(item.number))
const queue = []
for (let index = 0; index < pending.length; index += 8) queue.push(pending.slice(index, index + 8))

const categories = [
  'pi2dsh_abi_gap',
  'workx_product_gap',
  'missing_pi_package',
  'needs_e2e_only',
  'dsh_public_seam_gap',
  'dsh_core_bug',
  'external_dependency',
  'not_addressable',
]
const system = `Classify WHY each old DeepSeek Harness Discussion is still only partially served after pi2dsh 0.20.

Definitions:
- pi2dsh_abi_gap: the public Pi contract is not faithfully translated yet, while DSH has enough public mechanisms. Fix belongs in the pi2dsh engine.
- workx_product_gap: the engine ABI is sufficient, but users need a curated DSH-facing product/client feature (settings page, session manager, IDE/desktop/file pane, integrated workflow). Fix belongs in dsh-work-x or another DSH product plugin, not in the ABI engine.
- missing_pi_package: the ABI can carry it, but no mature/installable Pi package currently owns the requested product behavior. Build or migrate a capability package.
- needs_e2e_only: an existing likely package/path appears to deliver the whole outcome, but pi2dsh has not completed real DSH E2E, so it cannot be promoted yet.
- dsh_public_seam_gap: an external plugin needs a timing/data/presentation seam DSH does not expose. Requires upstream DSH support before a faithful external implementation.
- dsh_core_bug: the user explicitly needs a broken native DSH path fixed (parser, persistence, native subagent queue, adapter, sandbox, Web core). An alternate path does not satisfy the primary request.
- external_dependency: the remaining requirement is an external API/key/service/model/OS facility rather than pi2dsh/work-x code.
- not_addressable: showcase, competing project, vague/nonproblem, or only superficial overlap; we should not market there.

Important: a complete Host ABI can coexist with workx_product_gap, missing_pi_package, DSH gaps and DSH core bugs. Do not blame the bridge for native DSH behavior. Choose exactly one PRIMARY owner.

Return ONLY a compact JSON array in input order. Never echo input text:
{"number":123,"owner":"one category","rootGap":"specific missing thing","canWeBuildWithoutDshCore":true,"recommendedAction":"one concrete action","confidence":0.0}

Allowed owner values: ${categories.join(', ')}.`

const compact = item => ({
  number: item.number,
  product: item.product,
  title: item.discussion?.title,
  body: String(item.discussion?.body ?? '').slice(0, 1800),
  currentSolution: item.solution,
  remainingBoundary: item.boundary,
})
const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))

async function classify(batch, attempt = 1) {
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-v4-flash', max_tokens: 4000, temperature: 0,
      thinking: { type: 'disabled' }, system,
      messages: [{ role: 'user', content: JSON.stringify(batch.map(compact)) }],
    }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const values = parse(text)
    if (!Array.isArray(values) || JSON.stringify(values.map(item => item.number)) !== JSON.stringify(batch.map(item => item.number))) throw new Error('number mismatch')
    for (const value of values) if (!categories.includes(value.owner)) throw new Error(`invalid owner ${value.owner}`)
    return values
  } catch (error) {
    if (attempt >= 3) throw new Error(`${error.message}: ${text.slice(0, 600)}`)
    return classify(batch, attempt + 1)
  }
}

async function checkpoint() {
  const value = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: candidates.length,
    classifiedCount: byNumber.size,
    results: [...byNumber.values()].sort((a, b) => a.number - b.number),
  }
  const temporary = `${output}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, output)
}

let complete = 0
const total = queue.length
async function worker() {
  while (queue.length > 0) {
    const batch = queue.shift()
    if (batch === undefined) return
    for (const result of await classify(batch)) byNumber.set(result.number, result)
    complete += 1
    await checkpoint()
    process.stderr.write(`owned ${byNumber.size}/${candidates.length} (${complete}/${total})\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ output, classified: byNumber.size, total: candidates.length })}\n`)
