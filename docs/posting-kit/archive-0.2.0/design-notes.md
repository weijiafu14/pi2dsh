# pi2dsh Host ABI 改造 — 盘点结论（2026-08-14）

## 目标（用户拍板，不可缩水）
- 单一 Pi Host ABI 兼容层（PiHostOnDSH），一次开发批量解锁；禁止逐包补丁（核心禁 `if (packageName === ...)`）
- 十项能力 + 每项公共 API 契约测试 + 十项真实 DSH 场景验收
- top50 全量黑盒跑，产出：成功场景 / ABI 缺口 / 私有 API 证据
- MCP 特殊：不跑 pi-mcp-adapter，做 Pi MCP 配置 → DSH 官方 mcp-client 配置转换
- 静态扫描只做发现/报告，不做"兼容"判据

## 现状基线
- pi2dsh@0.1.2，仓库 `<local-worktree>/pi2dsh`
- 测试基线全绿：6 文件 29 测试（vitest），build ok
- GitHub: github.com/weijiafu14/pi2dsh（README 称已开源）
- 兄弟目录：../pi（Pi 官方源码）、../deepseek-harness（DSH 官方源码，有自己的 .claude/skills 贡献规范）

## codex 已实现（runtime.ts，通用无 if-package ✓，可保留）
- registerTool/unregisterTool + disposer；setActiveTools→agent.ctx.tools.restrict({allow})（AsyncLocalStorage agentScope 保证单 agent 边界，pendingActiveTools 处理无 agent 时点）
- sendMessage/sendUserMessage→inject/steer/followup（createUserMessage source:{kind:'plugin'}）
- ui.select/confirm/input→ctx.userQuestions.ask；notify→命令结果+日志
- exec→ctx.subprocess.resolveExecutable+spawn（64MiB cap，timeout/signal 合并）
- registerCommand→ctx.commands；prompts（frontmatter+$ARGUMENTS 展开）→commands；skills→dsh-skill-filesystem
- 生命周期：agent/session-start→session_start；agent/disposed→session_shutdown；session/event turn/start→agent_start+turn_start；tool/call→tool_execution_start；turn/end→turn_end+agent_end+agent_settled；tools/result→tool_execution_end
- 拦截器：tools/pre-execute→tool_call（block 支持/mutation 拒绝）；tools/post-execute→tool_result（文本替换+错误化）；system-prompt/assemble→before_agent_start（替换 systemPrompt）
- 图片：piToDshContent→ctx.attachments.saveImage（测试没补完）
- 事件总线 events.emit/on（包内）

## 明确缺失（= 46 blocked 靶子）
### compat shims 缺导出（高频 host-import blockers）
- pi-tui：visibleWidth(19包!)、Box、Input、SettingsList、isKeyRelease、isKeyRepeat、getKeybindings、stripTerminalSequences...
- pi-coding-agent：SessionManager(8)、SettingsManager(7)、withFileMutationQueue(8)、DynamicBorder(6)、getSettingsListTheme(6)、copyToClipboard、resizeImage、estimateTokens、buildSessionContext、convertToLlm、createAgentSession、DefaultResourceLoader、CURRENT_SESSION_VERSION、getPackageDir、DefaultPackageManager、CustomEditor、createCodingTools、createReadOnlyTools、getShellConfig...
- pi-ai：isContextOverflow、isRetryableAssistantError、clampThinkingLevel...
- **本地有 Pi 官方源码（../pi），纯函数可对照实现/搬运语义（MIT）**
### API unsupported 待翻转（compatibility.ts）
- appendEntry(14)、setSessionName/getSessionName/setLabel、setModel、getThinkingLevel(13)/setThinkingLevel、registerProvider(6)、registerMessageRenderer(9)/EntryRenderer/MarkdownTransformer、registerShortcut(8→改 partial no-op 不 block)
### ctx 面
- ctx.ui.theme(12)、ctx.ui.editor(8)、ctx.abort、ctx.compact、ctx.newSession、ctx.fork、ctx.navigateTree、ctx.switchSession、ctx.reload、ctx.shutdown、ctx.ui.addAutocompleteProvider、ctx.ui.setEditorText、ctx.ui.pasteToEditor、sessionManager.getEntries(现在返回假[])
### 事件
- session_tree(14)/session_compact(14)/session_before_compact(11)、model_select(12)、input(7)、message_update(7)、resources_discover、before_provider_request/headers、after_provider_response、thinking_level_select、context、user_bash、session_before_switch/fork/tree
### 非 ABI 类 blocker（照实报告）
- invalid-resource-manifest（pi-lens）、undeclared-runtime-dependency（bun:sqlite 等）

## 判定/管道
- analyzer.ts：TS AST 扫描（ExtensionAPI receiver 识别 pi/extensionApi 参数名），fail-closed
- audit-community.mjs：corpus.json（top50 by downloads）→ analyzePackage → audit-results.json（结果=静态！用户否定其作为兼容判据）
- verify-community.mjs：4 包固定管道（fixture LSP/SearXNG/图片端点），generateBundle→Cordis 组装官方插件栈→execute 工具→官方 dsh plugin add/activate/remove（node --import tsx apps/cli/src/bin.ts，DSH_HOME 隔离，pnpm shim）
- verify-live-deepseek.mjs：真模型调工具（DEEPSEEK_API_KEY env）
- dsh-runtime.spec.ts：Cordis Context+SessionStore/SystemPrompt/ToolRuntime/CommandRuntime/SkillRegistry/AgentRegistry/LocalAttachmentStore/LocalSubprocessRuntime/UserQuestionService 完整組装样板

## 架构决定（待实现）
1. 新增 host 模式：单一 DSH 插件动态加载 Pi 包（npm 拉取+jiti alias 重定向），convert 保留为离线打包
2. compat shims 扩成完整 ABI：pi-tui/pi-coding-agent/pi-ai 全公共导出（对照 ../pi 源码）
3. 黑盒验收改为：host 加载真包→注册面 snapshot→可用工具真执行→ABI 缺口自动归因（不再拿静态 audit 当结论）
4. MCP：识别 pi-mcp-adapter 类配置（.pi/mcp.json?待确认）→转 DSH mcp-client 配置的独立工具（pi2dsh mcp-config）
5. DeepSeek key 仅通过环境变量注入；任何值或片段都不写入仓库与测试产物

## 用户风格红线
- 全中文汇报；每轮开头列(a)要求(b)证据对账
- 不吹不糊弄，做不到的显式降级并写报告；缺数据问人别留 TBD
- 别把静态扫描包装成成果；宣传等真做完

## 进度快照（第二轮黑盒启动时）
- 提交历史：c067bee(ABI层) → fea5e76(host/mcp/判定) → 8f8e5ab(黑盒管道)。工作区还有未提交：缺口修复批（jiti子路径alias/setActiveTools降级/扩展错误隔离/命令名规范化/skill冲突去重/#imports支持/readStoredCredential/parseSkillBlock/verify symlink EEXIST）
- 静态筛查：blocked 46→10，review 40
- 黑盒第一轮：24 loaded / 15 load-failed / 11 fatal；缺口已归因并修复一批，第二轮跑中（任务 blkp07b6y）
- 4包深链路+官方install/activate/remove 全过（community/runtime-results.json）；host e2e 段已加入 verify-community（EEXIST 已修，还没重跑成功一次）
- live 真模型测试跑中（任务 blqrwu3cz，key 经 env 注入不落盘）
- 待办：第二轮黑盒结果分析→可能再修一轮→重跑 audit+blackbox 出最终数字→README 全面重写（中文结论+四表：静态筛查/黑盒/深链路/live）→缺口报告 docs（含给 DSH 的上游贡献点：out-of-repo session event 注册面+ignorable通道）→提交推送 GitHub
- verify-community 重跑（含host段）还没绿过一次——黑盒结束后跑
- 用户验收十项对应证据映射要写进 README 或 docs/acceptance.md

## 终跑等待中（10:05）
- 提交至 7d60c23；audit 终版 blocked 5/review 45（证据：pi-lens资源越界、pi-fabric asset分发缺陷、bun:sqlite×2、playwright undeclared）
- typebox 宿主链路踩了两跳：exports 无 ./package.json（resolve 换逐 entry）+ bundle deps 自带 typebox
- verify host 段两跳：pacote 顶层 import 改 lazy、host deps 加 tinyglobby
- 私有API包清单（audit degraded 提取）：piolium/tintinweb-subagents/fabric/mjasnikovs-task/gotgenes-subagents/pi-btw/mitsupi → createAgentSession/DefaultResourceLoader/createCodingTools/wrapRegisteredTool/DefaultPackageManager/createExtensionRuntime/complete
- 待：黑盒终数字(be9o3hx95)+verify终版(br6fkjrvz) → README 重写 → 提交推送 origin
