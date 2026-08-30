import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const live = JSON.parse(await readFile(resolve(root, 'provider-78-live.json'), 'utf8'))
const audit = JSON.parse(await readFile(resolve(root, 'provider-78-audit.json'), 'utf8'))
const overrideSource = JSON.parse(await readFile(resolve(root, 'provider-78-overrides.json'), 'utf8'))
const packageAuditSource = JSON.parse(await readFile(resolve(root, 'provider-78-pi-package-audit.json'), 'utf8'))
const overrides = new Map(overrideSource.overrides.map(item => [item.number, item]))
const liveByNumber = new Map(live.records.map(item => [item.number, item]))
const items = audit.audits.map(item => ({
  ...item,
  ...overrides.get(item.number),
  title: liveByNumber.get(item.number)?.title,
  url: liveByNumber.get(item.number)?.url,
  updatedAt: liveByNumber.get(item.number)?.updatedAt,
  manualOverride: overrides.has(item.number),
  isAnswered: liveByNumber.get(item.number)?.isAnswered,
  answerChosenAt: liveByNumber.get(item.number)?.answerChosenAt,
  ourCommentUrls: liveByNumber.get(item.number)?.comments
    .filter(comment => comment.author?.login === 'weijiafu14').map(comment => comment.url) ?? [],
})).sort((a, b) => a.number - b.number)
if (items.length !== 78 || new Set(items.map(item => item.number)).size !== 78) throw new Error('final Provider set must be 78 unique')

const byNumber = new Map(items.map(item => [item.number, item]))
const taskDefinitions = [
  { id: 'compose-adaptive-model-router', kind: 'composition', numbers: [366], owner: 'Pi router + pi2dsh integration', objective: '复用 pi-bifrost 类 query-aware router，在已配置 flash/pro routes 间自动选择，并保留用户显式覆盖。' },
  { id: 'provider-tool-name-policy', kind: 'pi-provider-product', numbers: [1113], owner: 'OpenCode/Grok Provider', objective: '为上游保留工具名提供声明、检测、过滤/别名和失败提示，不能在 Host ABI 全局偷偷改名。' },
  { id: 'pi-ai-reasoning-replay', kind: 'pi-provider-product', numbers: [1198], owner: 'pi-ai', objective: '补齐 thinkingSignature/reasoning_content 跨轮回放，防止思考内容降级成正文。' },
  { id: 'amd-tokenfactory-cn-provider', kind: 'pi-provider-product', numbers: [2354], owner: 'New Pi Provider package', objective: '实现 AMD TokenFactory 中国区目录、鉴权、模型能力和 reasoning 映射。' },
  { id: 'tokenferry-provider-billing', kind: 'pi-provider-product', numbers: [2441], owner: 'TokenFerry integration', objective: '把 TokenFerry transport、模型目录与 session usage/结算事件接入并验证。' },
  { id: 'custom-header-auth-strategies', kind: 'pi-provider-product', numbers: [2602, 2668], owner: 'Generic Provider product', objective: '提供凭证记录驱动的自定义 secret header、Anthropic Bearer/x-api-key 策略、脱敏和 contextWindow 配置。', acceptance: ['settings 只保存 credential key，不保存 secret', '每请求从 credentials service 解析并注入命名 header', 'bearer 模式只发 Authorization: Bearer，x-api-key 模式只发 x-api-key', '日志、错误和持久 session 中均无 secret', 'contextWindow 进入 DSH 精确模型目录并驱动压缩边界'] },
  { id: 'quota-aware-key-pool', kind: 'pi-provider-product', numbers: [2884], owner: 'Generic Provider product', objective: '实现多 key 池、RPM/余额感知轮转、429 切换、热更新和 per-key 可观测性。' },
  { id: 'retry-after-and-long-timeout', kind: 'pi-provider-product', numbers: [3128, 3157], owner: 'pi-ai / Provider transport', objective: 'Provider 自己保留 Retry-After，统一 stream idle 与 Undici dispatcher 超时，并正确响应取消。', acceptance: ['假网关先返回 429 + Retry-After: 3，再成功；Provider 等待约 3 秒且同一 DSH turn 完成', 'retry-after-ms: 1500 被按 1.5 秒处理', '1200000ms idle 配置同步到 Undici headers/body timeout，超过5分钟的本地流不再 terminated', '取消信号立即终止等待、dispatcher 和流，不再重试', '不同 route 的超时/重试配置互不串线，热替换后在途请求保持旧策略'] },
  { id: 'cli-agent-as-provider-safety', kind: 'pi-provider-product', numbers: [3283], owner: 'New Pi Provider package', objective: '把 Codex/Claude/agy CLI 安全包装为无自主工具的 Provider，含进程组清理、取消、错误分类和回退。' },
  { id: 'subscription-oauth-provider-family', kind: 'pi-provider-product', numbers: [3917], owner: 'Provider packages', objective: '补 Claude/Anthropic 与 Antigravity 等官方允许的订阅 OAuth；OpenAI Codex 复用现有已证路线；支持注销与 API-key 回退。' },
]
const packageAuditByTask = new Map(packageAuditSource.tasks.map(item => [item.taskId, item]))
if (packageAuditByTask.size !== taskDefinitions.length) throw new Error('Pi package audit must cover every development task')
const matrixDefinitions = [
  { id: 'named-routes-and-subscriptions', numbers: [743, 1063, 1073, 1866, 2128, 3958], objective: '真实凭证/本地服务下验证命名 route、目录、鉴权、协议和一轮模型调用。', acceptance: ['gpt-daybreak-blue 与 kimi-k3 各自使用订阅凭证完成目录+真实调用，token 不落日志', 'TokenHub 用真实 key 完成目录+真实调用并捕获实际鉴权头风格', 'OpenCode Go 在 go/v1、OpenCode Zen 在 zen/v1 各自完成真实调用；错误端点控制组失败', 'Ollama 从 DSH 宿主访问 127.0.0.1:11434/v1，空 API key、精确 tag 模型真实调用成功', 'OpenCode Go 新模型目录可见且按其真实协议完成调用，不能把三协议模型塞进一个 route'] },
  { id: 'reasoning-capacity-output', numbers: [1058, 2659], objective: '验证本地 reasoning effort wire 与超长输出/maxTokens/压缩边界。', acceptance: ['llama-server 模型声明 off/high 后 DSH 选择器可选；wire 中 high/off 与选择一致', '父会话重启后 effort 仍从持久选择恢复', '用可控长输出端点越过 12189 tokens，request/header.maxTokens 与实际上限一致且输出不被意外截断', '超过 contextWindow 前触发预期压缩；若仍截断，归因到 DSH core 而非 Provider'] },
  { id: 'retry-termination-shape', numbers: [1077], objective: '捕获 OpenCode Go terminated 错误，验证现有 retryPolicy 次数、退避、取消。', acceptance: ['捕获真实 terminated cause 和错误码', '配置有限预算后前三次失败、第四次成功，DSH turn 最终完成', '不可重试 4xx 不重试', '用户取消立即停止退避和网络请求'] },
  { id: 'named-tool-wire', numbers: [3342, 3374], objective: '捕获 agnes/DeepSeek gateway 工具流，验证 name/id/arguments、执行结果和第二模型步。', acceptance: ['保存 agnes 与目标 DeepSeek gateway 的脱敏原始工具流', 'Provider-owned Pi route 向模型声明真实 DSH 工具 schema', 'null/空/省略 continuation 不覆盖首个非空 call id/name', '模型调用一个具有互斥 required 字段的工具，DSH 参数校验通过并产生非错误 tool/result', 'tool result 回传后第二个模型请求完成，不能只停在第一次工具调用'] },
]

const assigned = new Set()
for (const definition of [...taskDefinitions, ...matrixDefinitions]) {
  for (const number of definition.numbers) {
    if (assigned.has(number)) throw new Error(`#${number} assigned twice`)
    assigned.add(number)
    if (!byNumber.has(number)) throw new Error(`#${number} absent from final set`)
  }
}
const expectedWork = items.filter(item => ['e2e_only', 'pi_provider_product_gap', 'multi_product_composition'].includes(item.verdict))
if (assigned.size !== expectedWork.length || expectedWork.some(item => !assigned.has(item.number))) {
  throw new Error(`developer handoff does not exactly cover work set: assigned ${assigned.size}, expected ${expectedWork.length}`)
}

const expand = definition => ({
  ...definition,
  packageAvailability: packageAuditByTask.get(definition.id),
  discussions: definition.numbers.map(number => {
    const item = byNumber.get(number)
    return {
      number,
      title: item.title,
      url: item.url,
      actualProblem: item.actualProblem,
      currentState: item.latestThreadState,
      piPublicSemantic: item.piPublicSemantic,
      dshPublicSeam: item.dshPublicSeam,
      currentPi2dshGap: item.currentPi2dshGap,
      acceptanceE2E: item.acceptanceE2E,
      replyCondition: item.replyCondition,
    }
  }),
  acceptance: definition.acceptance
    ?? [...new Set(definition.numbers.flatMap(number => byNumber.get(number).acceptanceE2E))],
})
const verdictOrder = ['ready_reply', 'e2e_only', 'pi2dsh_standard_gap', 'pi_provider_product_gap', 'multi_product_composition', 'dsh_upstream', 'candidate_error']
const verdictCounts = Object.fromEntries(verdictOrder.map(verdict => [verdict, items.filter(item => item.verdict === verdict).length]))
if (verdictCounts.pi2dsh_standard_gap !== 0) throw new Error('Provider 78 still contains a pi2dsh standard gap')

const selectedAnswer = items.filter(item => item.verdict === 'candidate_error'
  && (item.isAnswered === true || item.answerChosenAt !== null)).map(item => item.number)
const resolvedUnanswered = [175, 668, 1080, 1118, 1148, 1786, 3335, 3363, 3372, 3379, 3394, 3493, 3495, 3538, 3745, 3949]
const wrongProductLine = [196, 1078, 1604, 2053]
const insufficientInformation = [481, 695, 931, 947, 1099, 2670, 2893, 3023, 3362]
const duplicateCanonical = [3387]
const candidatePartition = new Set([...selectedAnswer, ...resolvedUnanswered, ...wrongProductLine, ...insufficientInformation, ...duplicateCanonical])
const candidateIds = items.filter(item => item.verdict === 'candidate_error').map(item => item.number)
if (candidatePartition.size !== candidateIds.length || candidateIds.some(number => !candidatePartition.has(number))) {
  throw new Error(`candidate disposition is not an exact partition (${candidatePartition.size}/${candidateIds.length})`)
}
const directReadyUnanswered = items.filter(item => item.verdict === 'ready_reply'
  && item.isAnswered !== true && item.answerChosenAt === null && item.ourCommentUrls.length === 0).map(item => item.number)
const replyQueue = [...new Set([...directReadyUnanswered, ...resolvedUnanswered])]
const validationOnly = [1058, 1073, 1077, 1866, 2128, 3958]
const protocolQualification = [743, 1063, 2659, 3342, 3374]
if (new Set([...validationOnly, ...protocolQualification]).size !== verdictCounts.e2e_only) {
  throw new Error('E2E subtype partition does not cover exactly 11 threads')
}

const output = {
  schemaVersion: 1,
  fetchedAt: live.fetchedAt,
  finalizedAt: new Date().toISOString(),
  sourceCompleteness: {
    discussions: live.records.length,
    completeBodies: live.records.filter(record => typeof record.body === 'string').length,
    topLevelComments: live.records.reduce((sum, record) => sum + record.comments.length, 0),
    replies: live.records.reduce((sum, record) => sum + record.comments.reduce((inner, comment) => inner + comment.replies.nodes.length, 0), 0),
  },
  verdictCounts,
  conclusion: {
    pi2dshStandardAbiGaps: 0,
    readyReplies: items.filter(item => item.verdict === 'ready_reply').map(item => item.number),
    e2eMatrices: matrixDefinitions.length,
    e2eThreads: matrixDefinitions.reduce((sum, item) => sum + item.numbers.length, 0),
    developmentTasks: taskDefinitions.length,
    developmentThreads: taskDefinitions.reduce((sum, item) => sum + item.numbers.length, 0),
    dshUpstreamThreads: items.filter(item => item.verdict === 'dsh_upstream').map(item => item.number),
    removedCandidates: items.filter(item => item.verdict === 'candidate_error').map(item => item.number),
    answerDisposition: {
      selectedAnswer,
      resolvedUnanswered,
      wrongProductLine,
      insufficientInformation,
      duplicateCanonical,
      directReadyUnanswered,
      replyQueue,
    },
    e2eDisposition: {
      validationOnly,
      protocolQualification,
      rule: 'qualification failures move to pi_provider_product_gap or dsh_upstream; they are not pre-declared compatible',
    },
  },
  developmentTasks: taskDefinitions.map(expand),
  e2eMatrices: matrixDefinitions.map(expand),
  items,
}
await writeFile(resolve(root, 'provider-78-final.json'), `${JSON.stringify(output, null, 2)}\n`)

const linkList = numbers => numbers.map(number => `[#${number}](${byNumber.get(number).url})`).join(' · ')
const lines = []
lines.push('# Provider 78 — live full-thread review and developer handoff')
lines.push('')
lines.push(`Fetched ${output.sourceCompleteness.discussions} complete live Discussions at ${live.fetchedAt}: ${output.sourceCompleteness.topLevelComments} top-level comments and ${output.sourceCompleteness.replies} replies. No body truncation.`)
lines.push('')
lines.push('## Final correction')
lines.push('')
lines.push('| Verdict | Threads |')
lines.push('|---|---:|')
for (const verdict of verdictOrder) lines.push(`| ${verdict} | ${verdictCounts[verdict]} |`)
lines.push('')
lines.push('**There are zero newly discovered generic pi2dsh Host-ABI gaps in these 78 threads.** The four machine-suspected gaps (#1146/#2822/#3090/#3112) were verified against source and all belong to official DSH llm-pi-ai/llm-deepseek packages.')
lines.push('')
lines.push(`- Ready replies (${output.conclusion.readyReplies.length}): ${linkList(output.conclusion.readyReplies)}`)
lines.push(`- DSH upstream (${output.conclusion.dshUpstreamThreads.length}): ${linkList(output.conclusion.dshUpstreamThreads)}`)
lines.push(`- Removed/misclassified/resolved/insufficient (${output.conclusion.removedCandidates.length}): ${linkList(output.conclusion.removedCandidates)}`)
lines.push('')
lines.push('## Answer-aware outreach disposition')
lines.push('')
lines.push(`- Selected Answer — skip (${selectedAnswer.length}): ${linkList(selectedAnswer)}`)
lines.push(`- Resolved but no selected Answer — reply (${resolvedUnanswered.length}): ${linkList(resolvedUnanswered)}`)
lines.push(`- Ready capability, no Answer, and no existing weijiafu14 comment (${directReadyUnanswered.length}): ${linkList(directReadyUnanswered)}`)
lines.push(`- Wrong product line — move, do not discard (${wrongProductLine.length}): ${linkList(wrongProductLine)}`)
lines.push(`- Insufficient information (${insufficientInformation.length}): ${linkList(insufficientInformation)}`)
lines.push(`- Duplicate/canonical thread (${duplicateCanonical.length}): ${linkList(duplicateCanonical)}`)
lines.push(`- Effective reply queue (${replyQueue.length}): ${linkList(replyQueue)}`)
lines.push('')
lines.push('## E2E disposition — dedicated plugin is not always required')
lines.push('')
lines.push(`- Existing generic/built-in route, validation only (${validationOnly.length}): ${linkList(validationOnly)}`)
lines.push(`- Protocol/root-cause qualification first (${protocolQualification.length}): ${linkList(protocolQualification)}`)
lines.push('- A qualification failure is reclassified as Provider product work or DSH upstream. “No dedicated plugin” does not mean compatibility is assumed.')

lines.push('')
lines.push('## Product-development tasks')
lines.push('')
lines.push(`Pi package availability: exact existing ${packageAuditSource.summary.existingExact}; partial/reusable ${packageAuditSource.summary.existingPartial}; no exact package ${packageAuditSource.summary.noExactPackage}.`)
for (const task of output.developmentTasks) {
  lines.push('')
  lines.push(`### ${task.id} — ${task.numbers.length} thread(s)`)
  lines.push('')
  lines.push(`Owner: **${task.owner}**`)
  lines.push('')
  lines.push(`Pi package status: **${task.packageAvailability.availability}**`)
  if (task.packageAvailability.packages.length > 0) {
    lines.push('')
    lines.push(`Packages: ${task.packageAvailability.packages.map(item => `\`${item.name}@${item.version}\``).join(' · ')}`)
  }
  lines.push('')
  lines.push(`Next action: ${task.packageAvailability.nextAction}`)
  lines.push('')
  lines.push(task.objective)
  lines.push('')
  lines.push(`Threads: ${linkList(task.numbers)}`)
  lines.push('')
  lines.push('Acceptance:')
  for (const check of task.acceptance) lines.push(`- ${check}`)
}

lines.push('')
lines.push('## E2E-only matrices')
for (const matrix of output.e2eMatrices) {
  lines.push('')
  lines.push(`### ${matrix.id} — ${matrix.numbers.length} thread(s)`)
  lines.push('')
  lines.push(matrix.objective)
  lines.push('')
  lines.push(`Threads: ${linkList(matrix.numbers)}`)
  lines.push('')
  lines.push('Acceptance:')
  for (const check of matrix.acceptance) lines.push(`- ${check}`)
}

lines.push('')
lines.push('## Per-thread ledger')
for (const item of items) {
  lines.push('')
  lines.push(`### [#${item.number}](${item.url}) — ${item.verdict}`)
  lines.push('')
  lines.push(`- Problem: ${item.actualProblem}`)
  lines.push(`- Latest state: ${item.latestThreadState}`)
  lines.push(`- Missing layer: ${item.missingLayer}`)
  lines.push(`- Pi semantic: ${item.piPublicSemantic}`)
  lines.push(`- DSH seam: ${item.dshPublicSeam}`)
  lines.push(`- pi2dsh gap: ${item.currentPi2dshGap}`)
  lines.push(`- Task: ${item.implementationTask}`)
  lines.push(`- Reply condition: ${item.replyCondition}`)
}

await writeFile(resolve(root, 'provider-78-report.md'), `${lines.join('\n')}\n`)
process.stdout.write(`${JSON.stringify({ verdictCounts, tasks: output.conclusion.developmentTasks, taskThreads: output.conclusion.developmentThreads, matrices: output.conclusion.e2eMatrices, e2eThreads: output.conclusion.e2eThreads, report: resolve(root, 'provider-78-report.md') })}\n`)
