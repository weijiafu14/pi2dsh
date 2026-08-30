import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const discussions = JSON.parse(await readFile(resolve(root, 'discussions.json'), 'utf8')).discussions
const matches = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8')).matches
const byDiscussion = new Map(discussions.map(item => [item.number, item]))
const output = resolve(root, 'partial-reassessment-0.20.json')
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')

const selectedProducts = new Set([
  'provider_model',
  'subagents',
  'mcp_adapter',
  'web_access_research',
  'ui_tui',
  'multimodal_imagegen',
  'session_search_memory',
])
const candidates = matches
  .filter(item => item.status === 'conceptual_partial' && selectedProducts.has(item.product))
  .map(item => ({ ...item, discussion: byDiscussion.get(item.number) }))
  .filter(item => item.discussion !== undefined)

let prior = { results: [] }
try { prior = JSON.parse(await readFile(output, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
const resultByNumber = new Map(prior.results.map(item => [item.number, item]))
const pending = candidates.filter(item => !resultByNumber.has(item.number))
const batches = []
for (let index = 0; index < pending.length; index += 2) batches.push(pending.slice(index, index + 2))

const capabilityFacts = `Current VERIFIED pi2dsh 0.20 capabilities (real DSH loops, not import-only):

PROVIDER/MODEL
- Unmodified Pi providers with their own transport become native DSH llm routes. Dynamic model catalogs, API/base URL/headers, input modalities, compat flags and reasoning effort maps are translated.
- Real E2E: Alibaba Token Plan live catalog + native agent/tool loop/restart; OpenAI Codex OAuth subscription login -> DSH model selector -> native call; private/domestic gateways that reject developer role; arbitrary package-owned providers.
- This is an alternate provider route. It does NOT repair an existing DSH-owned adapter, settings page, parser, or bundled catalog. An alternate is exact only when the user's primary outcome is using that service/model, not when they explicitly require the original DSH route to be repaired.

SUBAGENTS
- @tintinweb/pi-subagents runs unchanged: explicit per-child provider/model, inheritance from the parent's LIVE selected route, per-child thinkingLevel -> DSH reasoningEffort, foreground/background, completion notify, steer, wait, resume with memory, stop, durable cross-restart reopen and nested tools/extensions.
- pi2dsh 0.20 also has opt-in lineage routing that gives installed Pi extensions to DSH-native children and grandchildren, verified depth 2 with one mount pass and zero failures.
- This can be an exact alternate for user goals such as independent child model, reasoning level, background execution or steering. It does NOT repair DSH-native queue ordering, status colors, Web cards, AgentOptions schema, or core retry bugs.

MCP
- pi-mcp-adapter runs unchanged: stdio, Streamable HTTP/SSE, OAuth discovery, DCR, PKCE, localhost callback, secure tokens/refresh, reconnect, direct/proxy/script tools, resources/prompts, images, MCP Apps, approval, elicitation, sampling, cancellation and manager UI on Web/dsh-TUI/dsh-pi-tui.
- Real Atlassian OAuth + 26 tools + DSH model tool result E2E. This is an alternate MCP runtime; it does NOT repair dsh-mcp-client itself.

WEB
- @juicesharp/rpiv-web-tools latest runs unchanged: web_search via Brave/Tavily/Serper/Exa/You/Jina/Firecrawl/Perplexity or reachable SearXNG/Ollama; web_fetch reads public HTTP(S) without a search key, with SSRF guard.
- Exact alternate for "search the web" or "read this public URL" if the required backend/key condition is acceptable. It does NOT fix the native DSH web tool or permit private-network fetching.

TERMINAL/UI
- Stock dsh-TUI and @xmoon76/dsh-pi-tui both run with pi2dsh. Native /login coexists with projected Pi OAuth; Pi ui.custom managers render through public TUI surfaces; MCP and subagent UIs/tool loops are E2E.
- Exact for requests asking for a terminal/TUI or plugin-owned Pi interface. It does NOT fix DSH Web layout/settings/history/scroll/rendering bugs.

MULTIMODAL
- Vision bridge: pasted image -> Pi vision package -> text injected into a text model; CLI and Web verified.
- Codex image package: ChatGPT/Codex OAuth -> image generation and reference-image editing -> DSH native attachment -> inline Web card verified.
- Exact alternate for adding image understanding or generation/editing. It does NOT change the native input modality of an existing model/provider or repair native attachment/UI defects.

SESSION/SIDE CONVERSATION
- pi-btw: side question runs in a real DSH child session, stays out of the main thread, can be viewed/injected later; Web side panel and first-open/restart verified.
- Exact for "ask on the side without polluting main context". It does NOT repair corrupt history, native fork/tree/compaction bugs or generic session search.

CURATED PRODUCT: dsh-work-x
- One DSH install bundles the verified pi2dsh engine with pi-mcp-adapter, @tintinweb/pi-subagents, pi-btw and @crazygit/pi-codex-image-gen. Its Web product surface adds an MCP tab (project/global layers) and composes with dsh-better-sidebar's Tasks/Subagent UI.
- Exact for users asking for a ready-made/batteries-included agent workstation or a combination of MCP + subagents + side conversations + image generation. It is NOT a fix for an isolated DSH core bug.
- Real screenshots already published in the repository may be attached only when the post asks what the product looks like, asks for a ready-made solution, or benefits from visible proof. Do not attach pictures to narrow bug/architecture threads.

AVAILABLE PUBLIC VISUALS (choose at most one; use none by default):
- side_conversation: https://raw.githubusercontent.com/weijiafu14/pi2dsh/main/docs/posting-kit/assets/02-side-conversation-panel.png
- clean_main_thread: https://raw.githubusercontent.com/weijiafu14/pi2dsh/main/docs/posting-kit/assets/01-side-conversation-main-thread-clean.png
- image_generation: https://raw.githubusercontent.com/weijiafu14/pi2dsh/main/docs/posting-kit/assets/codex-image-gen/dragonball-dsh-result-v2.png
- pi_surfaces: https://raw.githubusercontent.com/weijiafu14/pi2dsh/main/docs/posting-kit/assets/06-pi-surfaces-on-dsh.png
- oauth_models: https://raw.githubusercontent.com/weijiafu14/pi2dsh/main/docs/posting-kit/assets/11-model-picker-after-login.png
`

const system = `You are re-auditing OLD conceptual_partial matches after new capabilities shipped. Read every title/body and the old reason. Judge the PRIMARY USER OUTCOME, not keyword overlap.

${capabilityFacts}

Verdicts:
- now_exact: installing the named verified Pi capability through pi2dsh directly delivers the primary requested outcome as an honest alternate path. It may bypass a broken native path, but the reply must say that it does not repair DSH core.
- still_partial: meaningful help, but one required semantic remains missing.
- not_fit: core bug/showcase/nonproblem or no installable capability delivers the primary outcome.

Be conservative. A core bug is not now_exact merely because an alternate tool exists, unless the user mainly needs the outcome and the alternate preserves it. Never claim a Web UI fix from a TUI, a native provider fix from another provider, or a DSH-native subagent protocol fix from Pi subagents.

Return ONLY a JSON array in input order with every item. Never echo title, body or oldReason:
{"number":123,"product":"same input product","verdict":"now_exact|still_partial|not_fit","solution":"specific installable capability and why","boundary":"what remains unfixed","confidence":0.0,"replyAngle":"one concise tailored angle, no generic ad copy","visualKey":"none|side_conversation|clean_main_thread|image_generation|pi_surfaces|oauth_models"}`

const compact = item => ({
  number: item.number,
  product: item.product,
  oldReason: item.reason,
  title: item.discussion.title,
  body: String(item.discussion.body ?? '').slice(0, 1500),
})
const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''))

async function classify(batch, attempt = 1) {
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      max_tokens: 6000,
      temperature: 0,
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: JSON.stringify(batch.map(compact)) }],
    }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`)
  const text = payload.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  try {
    const values = parse(text)
    if (!Array.isArray(values) || JSON.stringify(values.map(item => item.number)) !== JSON.stringify(batch.map(item => item.number))) {
      throw new Error('number/order mismatch')
    }
    return values
  } catch (error) {
    if (attempt >= 3) throw new Error(`${error.message}: ${text.slice(0, 800)}`)
    return classify(batch, attempt + 1)
  }
}

await mkdir(dirname(output), { recursive: true })
async function checkpoint() {
  const value = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourcePartialCount: candidates.length,
    assessedCount: resultByNumber.size,
    results: [...resultByNumber.values()].sort((a, b) => a.number - b.number),
  }
  const temporary = `${output}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, output)
}

let completed = 0
const queue = [...batches]
async function worker() {
  while (queue.length > 0) {
    const batch = queue.shift()
    if (batch === undefined) return
    for (const result of await classify(batch)) resultByNumber.set(result.number, result)
    completed += 1
    await checkpoint()
    process.stderr.write(`reassessed ${resultByNumber.size}/${candidates.length} (${completed}/${batches.length})\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(6, batches.length) }, () => worker()))
await checkpoint()
process.stdout.write(`${JSON.stringify({ output, assessed: resultByNumber.size, total: candidates.length })}\n`)
