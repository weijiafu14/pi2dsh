#!/usr/bin/env node
// Turn the two surveys into the only table a user needs: what do I have, and
// what do I install for it.
//
//   node scripts/report-provider-coverage.mjs [wide-survey.json] [out.md]
//
// The mount survey says what a package became (native route / route through
// DSH's official adapter / nothing yet). The screening says whose service it
// is and whether anyone uses it. Neither alone answers "what do I install" —
// this joins them and groups by the vendor the endpoint names, because that is
// what a reader actually has: an account somewhere, not a package name.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const surveyPath = resolve(process.argv[2] ?? 'community/gateway-transports-wide.json')
const outPath = resolve(process.argv[3] ?? 'community/provider-coverage.md')

const survey = JSON.parse(await readFile(surveyPath, 'utf8'))
const universe = JSON.parse(await readFile('community/provider-universe.json', 'utf8'))
const meta = new Map(universe.providers.map(entry => [entry.name, entry]))

// Host → the thing a reader would say they have. Ordered: the first match wins,
// so a package naming both a vendor and an aggregator lands under the vendor.
const FAMILIES = [
  ['Kimi / Moonshot', ['kimi.com', 'moonshot.']],
  ['智谱 GLM', ['bigmodel.cn', 'z.ai']],
  ['MiniMax', ['minimax']],
  ['火山方舟 / 豆包', ['volces.com']],
  ['阿里百炼 / 通义千问', ['dashscope', 'maas.aliyuncs', 'qwencloud']],
  ['硅基流动', ['siliconflow', 'siliconcloud']],
  ['阶跃星辰 StepFun', ['stepfun.com']],
  ['商汤 SenseNova', ['sensenova']],
  ['Anthropic 订阅', ['anthropic.com', 'claude.ai']],
  ['OpenAI / ChatGPT', ['openai.com', 'chatgpt.com']],
  ['Google', ['ai.google.dev', 'googleapis.com']],
  ['xAI', ['x.ai']],
  ['NVIDIA NIM', ['nvidia.com']],
  ['Cerebras', ['cerebras.ai']],
  ['Fireworks', ['fireworks.ai']],
  ['Baseten', ['baseten.co']],
  ['Ollama', ['ollama.com']],
  ['Cloudflare', ['cloudflare.com']],
  ['Vercel AI Gateway', ['vercel.sh']],
  ['OpenRouter', ['openrouter.ai']],
  ['HuggingFace', ['hf.co', 'huggingface']],
  ['Cohere', ['cohere.ai']],
  ['DeepInfra', ['deepinfra']],
  ['Scaleway', ['scaleway']],
  ['Azure AI Foundry', ['azure.com', 'azurewebsites']],
  ['SAP AI Core', ['sap-aicore']],
]
const NOISE = new Set(['models.dev', 'agentskills.io', 'ai.corp.com', 'api.npmjs.org', 'registry.npmjs.org', 'docs.z.ai'])

/**
 * The vendor a package's endpoints name, or a bucket when they name none.
 * @param name - the npm package name.
 */
function familyOf(name) {
  const hosts = (meta.get(name)?.hosts ?? []).filter(host => !NOISE.has(host))
  for (const [family, keys] of FAMILIES) {
    if (hosts.some(host => keys.some(key => host.includes(key)))) return family
  }
  if (hosts.length === 0) return '自建 / 中转（端点由你配）'
  return `其它厂商（${hosts[0]}）`
}

// The tier a reader can act on. `modelsInPicker` is what the host's own model
// directory returned with NO credential configured — the same source the model
// picker reads — so it separates "installed it and models are there" from
// "installed it and the picker is empty until I supply something".
const TIER = {
  ready: '装完就有模型',
  needsCredential: '要先给密钥/登录',
  notRegistered: '启动时不注册',
  failed: '不能用',
}
function tierOf(result) {
  if (result.verdict === 'route' || result.verdict === 'route-via-official') {
    return (result.modelsInPicker ?? 0) > 0 ? TIER.ready : TIER.needsCredential
  }
  if (result.verdict === 'mounted-no-provider') return TIER.notRegistered
  return TIER.failed
}
const HOW = {
  route: '包自带传输 → DSH 原生路由',
  'route-via-official': '目录翻译成配置 → DSH 官方适配器',
  'mounted-no-provider': '要走它自己的命令/配置才注册',
  'not-served': '',
  'load-failed': '包在运行时加载失败',
  'install-failed': '装不上',
  unknown: '启动日志里没有它的踪迹',
}

const rows = survey.results.map(result => ({
  family: familyOf(result.name),
  name: result.name,
  downloads: meta.get(result.name)?.downloads ?? null,
  verdict: result.verdict,
  models: result.modelsInPicker ?? null,
  usable: tierOf(result),
  how: HOW[result.verdict] ?? '',
  reason: result.reason ?? '',
  oauth: meta.get(result.name)?.declaresOAuth === true,
}))

const byFamily = new Map()
for (const row of rows) {
  if (!byFamily.has(row.family)) byFamily.set(row.family, [])
  byFamily.get(row.family).push(row)
}

const counts = {}
for (const row of rows) counts[row.usable] = (counts[row.usable] ?? 0) + 1

const lines = [
  '# 你手上有什么 → 装哪个包',
  '',
  `实测 ${rows.length} 个包，覆盖 ${byFamily.size} 类服务。每个包装进独立的临时 profile、启动一次，然后问宿主自己的模型目录（模型选择器读的同一个源）。`,
  '**全程没有配任何凭证，也没有对任何一家发过请求。**「装完就有模型」= 模型出现在选择器里；能不能调通取决于你自己的密钥和那家服务。',
  '',
  Object.entries(counts).map(([tier, n]) => `${tier} ${n}`).join(' · '),
  '',
  '| 你有什么 | 装哪个 | 周下载 | 装完 | 模型数 | 怎么接进来的 |',
  '|---|---|---|---|---|---|',
]
const order = [...byFamily.entries()].sort((a, b) => {
  const best = list => Math.max(...list.map(row => row.downloads ?? 0))
  return best(b[1]) - best(a[1])
})
for (const [family, list] of order) {
  list.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
  for (const row of list) {
    const detail = row.usable === '不能用' ? row.reason.slice(0, 80) : row.how
    lines.push(`| ${family}${row.oauth ? ' *(要登录)*' : ''} | \`${row.name}\` | ${row.downloads ?? '?'} | ${row.usable} | ${row.models ?? '-'} | ${detail} |`)
  }
}
await writeFile(outPath, `${lines.join('\n')}\n`)
console.log(JSON.stringify(counts))
console.log(`families=${byFamily.size} packages=${rows.length} → ${outPath}`)
