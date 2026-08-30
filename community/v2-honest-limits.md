# 诚实清单（v2）— 2025 条 `no_dsh` 里到底是什么

判 `no_dsh` 的门槛：**先回答"这个人要的结果有没有第二条路"，答不出来才结案。**
这一节是回帖时"我们做不到"那句话的依据——**不许把它说成"社区没需求"，
它恰恰是社区最痛的地方。**

## 一、按 DSH 组件归族

| 组件族 | 条数 | ↑合计 |
|---|---|---|
| Web 客户端本体（渲染 / 滚动 / IME / 崩溃 / 会话侧栏） | 536 | 703 |
| Windows 原生层（目录选择器 UTF-16 截断、沙箱 ACL、原子写无重试、进程树） | 281 | 369 |
| 会话日志持久化（seq 撞号、单文件损坏拖垮全局、无 delete/forget） | 213 | 266 |
| 沙箱执行策略（写白名单、逃逸、提权审批） | 102 | 142 |
| `dsh-llm-deepseek` 流式累加器 / 序列化 | 91 | 118 |
| agent-loop / inbox / 竞态 | 55 | 69 |
| apiproxy / typert / 连接层 | 47 | 92 |
| settings / credentials 写面与命名空间 | 47 | 56 |
| 其它 / 散件 | 653 | — |

这份分布本身是有价值的情报：**社区一半以上的痛点集中在 Web 客户端本体和
Windows 原生层**，这两块我们碰不到，也不该假装碰得到。

## 二、其中 273 条是有第二条路的

- **160 条等级一** —— workaround 本身是我们真机端到端跑过的（换 MCP 运行时、
  换子代理运行时、换 provider 路由、自建配置面、guardian 拦截）。
  回帖口径固定：**"你这个 bug 成立、该官方修；在那之前有条能用的路。"**
- **109 条 `结构性成立/行为未测`** —— 绝大多数是"走我们的路由绕开
  `dsh-llm-deepseek` 的累加器"。**结构上确实不经过那段代码，但 pi-ai 自己的
  累加器扛不扛得住那些畸形报文，我们一次没测过。**
  口径只能是"这条路不走那个解析器，值得一试"，**不许说成已解决**。
  → 路线图 R1 的第一步就是把这件事测掉。
- 剩下 4 条是等级二或混合等级，逐条看备注。

## 三、真的一点办法都没有的部分

以下几类，**连第二条路都答不出来**，回帖时必须直说：

1. **恢复归档 / 永久删除会话**。`archiveSession` 有公开写面，但
   **没有 unarchive 对等方法**，`archivedSessionIds` 是只读 getter，
   `SessionPersistence` 也没有 delete/forget。（#3892 的提帖人说得比我们准。）
2. **沙箱写白名单 / 多根工作区的写授权**。`ctx.sandboxPolicy` 只有
   `resolve` / `overrideOf`，**没有 set**。
3. ~~markdown 正文里的 fence 渲染~~ —— **这条我判错了，2026-08-26 自查更正。**
   `conversation.chat.node` 确实是 keyed、够不到 assistant 文本内部的代码块，
   **但那不是唯一的路**：客户端插件可以占 `root` 入口、对渲染后的 DOM 做后处理。
   `@puji4810/dsh-mermaid` 就是这么干的——按 `language-mermaid` class 找到已 settle
   的代码块，就地换成 SVG，跟随 `prefers-color-scheme`，带超时与失败回退。
   → mermaid 一族**已被社区解决**，回帖应指过去，不是说"做不到"。
   保留的边界：DOM 后处理**不是官方契约**，宿主改 DOM 结构就会坏，
   所以它是"有人做成了"，不是"DSH 开了这个面"。
4. **改模型已发出的 arguments**。`tools/pre-execute` 对 DSH 原生工具硬拒，
   理由是核心在策略之前就把 arguments 记进日志了——**这是有意为之，不是 bug**。
5. **Windows 原生层与 Web 客户端本体的一切**。

## 四、不要在这些帖子下做的事

- 不要把"我们有另一条路"说成"这个 bug 解决了"。
- 不要在安全类帖子（沙箱逃逸、审批旁路）下拿 `pi-approval-guardian` 当缓解措施——
  **模型审批不是安全边界**，在安全帖上这么说代价太高。
- 不要重复社区已经答得很好的根因（ylwl1997 / DRAG0NM / zoahdev /
  Electricitysheep / ciceroyang / argszero 承包了相当一部分高质量回答）。
- 不要往带完整根因分析和 fork 分支的帖子里塞产品图。

## 五、带第二条路且有热度的（↑≥1）

| # | ↑ | 标题 | 第二条路 | 该 workaround 的核证等级 |
|---|---|---|---|---|
| [#4013](https://github.com/deepseek-ai/deepseek-harness/discussions/4013) | 2 | dsh 0.1.1 upgrade breaks third-party plugins | 他崩的那件事本身是视觉路由：pi2dsh 的伴生视觉路由（@kassing/pi-vision，贴图自动走视觉模型再回灌文本模型）在 0.1.0-rc.8 与  | 1 |
| [#4006](https://github.com/deepseek-ai/deepseek-harness/discussions/4006) | 2 | Two defects in llm-pi-ai on 0.1.1-rc.2: a ro | 自带传输的 Pi provider 包经 pi2dsh 注册成原生 DSH 路由，不经过 llm-pi-ai 的 toRecord / reuseCatalog | 1 |
| [#3821](https://github.com/deepseek-ai/deepseek-harness/discussions/3821) | 2 | [Upstream Issue] dsh-mcp-client 不发送 MCP root | 把这台 MCP 交给 pi-mcp-adapter（经 pi2dsh）接：它有自己的 MCP 客户端与项目级 .mcp.json 配置层（dsh-work-x  | 1 |
| [#3789](https://github.com/deepseek-ai/deepseek-harness/discussions/3789) | 2 | 「续 #3379」建议：supportsDeveloperRole 默认改为 false | 包注册 provider 经 pi2dsh 翻译成官方 llm-pi-ai profile 时 compat 三字段是显式写入的，不吃 detectCompat | 1 |
| [#3468](https://github.com/deepseek-ai/deepseek-harness/discussions/3468) | 2 | Session titles silently fail to generate on  | 用自带传输的 Pi provider 包注册一条 reasoning 档位由包定义(可为 off)的路由，再把 session-title-llm 的 prov | 1 |
| [#3437](https://github.com/deepseek-ai/deepseek-harness/discussions/3437) | 2 | [Proposal] WebUI 应具备插件故障隔离：非核心插件加载失败不应导致整个 W | 经 pi2dsh 挂载的 Pi 插件，其挂载失败由引擎按能力缺口分级捕获、不炸启动也不炸 Agent；但这只覆盖走桥的 Pi 插件，DSH 原生 cordis  | 1 |
| [#3225](https://github.com/deepseek-ai/deepseek-harness/discussions/3225) | 2 | [Feature] 支持统一配置白标 User-Agent（appIdentity），对 | 改用自带传输的 Pi provider 包做路由：请求由该包自己发出，不经 llm-pi-ai 的保留头剥离，UA 由包侧决定；但「一个配置点管住所有 prov | 2 |
| [#3052](https://github.com/deepseek-ai/deepseek-harness/discussions/3052) | 2 | Bug Report: All tool calls fail with unknown | 换一条自带传输的 Pi provider 包路由（经 pi2dsh 成为原生 DSH llm 路由）：流式解析在包内完成，不经这段装配器；provider 全链 | 1 |
| [#2979](https://github.com/deepseek-ai/deepseek-harness/discussions/2979) | 2 | An empty id/name in a later tool-call delta  | 换一条自带传输的 Pi provider 包路由：流式装配在包内完成，不经宿主这段累加器；provider 全链含完整工具循环我们端到端实测过 | 1 |
| [#2919](https://github.com/deepseek-ai/deepseek-harness/discussions/2919) | 2 | Sandbox escalation can be approved without a | pi-approval-guardian：第二个模型在每次工具调用执行前逐次审批（含带 sandbox_permissions 的那次），能挡住模型投机性提权； | 1（无 example） |
| [#2758](https://github.com/deepseek-ai/deepseek-harness/discussions/2758) | 2 | 工作空间好像没有用？ | pi-mcp-adapter + 一个 filesystem MCP server 指向那个目录：模型能真读写到该目录（这条只给到『能操作那个文件夹』的结果，不 | 1 |
| [#2273](https://github.com/deepseek-ai/deepseek-harness/discussions/2273) | 2 | SDK runtime: dsh-mcp-client missing from the | MCP 那一半可以不依赖闭包里的 dsh-mcp-client：pi-mcp-adapter 自带 transport（stdio/Streamable HTT | 1 |
| [#2192](https://github.com/deepseek-ai/deepseek-harness/discussions/2192) | 2 | [Bug Report] Continuable 子代理 settle 时重复投递：se | 要的若是『后台子代理交付一次、按时序到达』这个结果：@tintinweb/pi-subagents 是一套独立的子代理运行时（每个子代理是真 DSH 会话，前台 | 1 |
| [#2069](https://github.com/deepseek-ai/deepseek-harness/discussions/2069) | 2 | 显式说明 web_search 搜索模型使用：搜索结果卡片显示实际计费模型，设置卡片可配 | 若只是不想被隐式计费：@juicesharp/rpiv-web-tools 提供独立的 web_search/web_fetch，检索走你自己选的 Brave/ | 2 |
| [#1920](https://github.com/deepseek-ai/deepseek-harness/discussions/1920) | 2 | Proposal: first-class file snapshot + /rewin | pi-approval-guardian 能补上他要的'事前闸'那一半：第二个模型逐次审查工具调用（含批量写文件的 bash）后才放行，allow/deny 都 | 1(无 example) |
| [#1263](https://github.com/deepseek-ai/deepseek-harness/discussions/1263) | 2 | **Title:** [Bug] INVALID_REPLAY_STATE "block | 改用自带传输的 Pi provider 包（经 pi2dsh 注册为原生 DSH 路由）——这条路由不经过 llm-pi-ai 的 replayState 投影 | 1 |
| [#1244](https://github.com/deepseek-ai/deepseek-harness/discussions/1244) | 2 | 【Bug】达到最大输出长度时会话被永久写坏：后续每轮都报 invalid pi-ai r | 同 #1263：换用自带传输的 Pi provider 包（pi2dsh 注册的原生路由），不经过 llm-pi-ai 的 replayState 投影 | 1 |
| [#1236](https://github.com/deepseek-ai/deepseek-harness/discussions/1236) | 2 | 【bug】file changed since it was read 的硬性拒绝可被截 | pi-approval-guardian（第二模型逐次审批工具调用，deny 会真的阻止执行）可以在覆盖类写入前加一道独立闸门；但它是模型判断而非硬规则，与他要 | 1（无 example） |
| [#1198](https://github.com/deepseek-ai/deepseek-harness/discussions/1198) | 2 | 【Bug】工具调用循环中思考内容直接混入正文显示（deepseek-v4-flash 经 | 改用自带传输的 Pi provider 包接同一模型：该路由由包自己构造请求，不经过 llm-pi-ai 的回放/回传投影；但我们没有在他这个模型+网关组合上实 | 1 |
| [#1124](https://github.com/deepseek-ai/deepseek-harness/discussions/1124) | 2 | 任务已执行结束，但任务列表仍显示任务在执行中，状态不一致 | @tintinweb/pi-subagents 经 pi2dsh 提供另一套子代理链路：自带交互式管理器、完成通知、wait-for-result、停了就是停了 | 1 |
| [#906](https://github.com/deepseek-ai/deepseek-harness/discussions/906) | 2 | ds你自己都不在源码上支持切换思维等级。本轮运行失败The `reasoning_con | 改用自带传输的 Pi provider 包（pi-provider-* 形态）注册的路由：请求由包自己发出、不经过 llm-deepseek 的装配与回放，re | 1 |
| [#885](https://github.com/deepseek-ai/deepseek-harness/discussions/885) | 2 | [Bug Report] llm-deepseek SSE 装配用 `!== void  | 同一网关改成由自带传输的 Pi provider 包注册路由：SSE 装配在包内完成，完全不经过 llm-deepseek 这两行；自建/非规范网关的 comp | 1 |
| [#879](https://github.com/deepseek-ai/deepseek-harness/discussions/879) | 2 | [bug]llm-deepseek: SSE tool_calls id/name ov | 用自带传输的 Pi provider 包把这个网关注册成 DSH 原生路由，SSE 装配走包自己的实现，绕开该装配点；私有/非规范网关（含拒绝 develope | 1 |
| [#725](https://github.com/deepseek-ai/deepseek-harness/discussions/725) | 2 | DeepSeek-V4-Flash 流式模式下所有工具调用报 `unknown tool | 同一个模型端点改用自带传输的 Pi provider 包（经 pi2dsh 装，路由不经过 llm-deepseek 的 translate），分块累加由包自己 | 1 |
| [#684](https://github.com/deepseek-ai/deepseek-harness/discussions/684) | 2 | 后台子代理完整汇报晚于最终答复送达，导致最终答复后出现一串追加确认回合 | 改用 @tintinweb/pi-subagents 这套并行的子代理运行时（经 pi2dsh 装）：前台/后台、完成通知、wait-for-result 收齐 | 1 |
| [#566](https://github.com/deepseek-ai/deepseek-harness/discussions/566) | 2 | 用其他模型(GLM-5.2) 中文经常乱码 | 同一端点改用自带传输的 Pi provider 包经 pi2dsh 接入，解码在包自己的 transport 里完成、不经宿主原生 adapter；这条路由机制 | 1 |
| [#530](https://github.com/deepseek-ai/deepseek-harness/discussions/530) | 2 | [Bug] `WebSocket error` 被归类为 `PI_AI_ERROR`，导 | 他用的正是 openai-codex：改用 Pi 包自带传输的 provider 路由（Codex OAuth 订阅登录已核证等级一），请求不经过 llm-pi | 结构性成立/行为未测 |
| [#476](https://github.com/deepseek-ai/deepseek-harness/discussions/476) | 2 | [bug] Subagent sessions that did not termina | 改用 @tintinweb/pi-subagents 那套子代理：完成通知、wait-for-result、stop 保持停止、交互式管理器、跨重启 reope | 1 |
| [#471](https://github.com/deepseek-ai/deepseek-harness/discussions/471) | 2 | [Bug] Continuable subagent reports can arriv | @tintinweb/pi-subagents 的父子消息由该包自己编排，不经过 tool-subagent-report + continuation 的双  | 结构性成立/行为未测 |
| [#345](https://github.com/deepseek-ai/deepseek-harness/discussions/345) | 2 | 作为各类agent和work的重度用户,发现的一些bug和提出的一些建议(非严谨issu | 其中「Web 没有插件管理、功能少得可怜」这一条今天就能补：装 pi2dsh 后 pi-mcp-adapter（完整 MCP 管理 UI）、@tintinweb | 1 |
| [#250](https://github.com/deepseek-ai/deepseek-harness/discussions/250) | 2 | BUG: sandbox 内模型可通过 Web approval 回环通道自批准 `da | pi-approval-guardian：第二个模型在每次工具调用执行前独立审批，这道闸不经过 Web loopback approval 通道，因此不被本文的 | 1（无 example） |
| [#225](https://github.com/deepseek-ai/deepseek-harness/discussions/225) | 2 | 执行任务中所有和 Powershell 相关的调用都会触发 unknown_tool 报 | pi-mcp-adapter 接一个提供 shell 执行的 MCP server，命令走 MCP 工具而不是原生 pwsh 工具，绕开这个名字不匹配。MCP  | 1（MCP 链路本身；具体 server 未 |
| [#167](https://github.com/deepseek-ai/deepseek-harness/discussions/167) | 2 | [Feature Request] dsh --profile headless 支持打 | pi-hermes-memory：跨会话记忆，第一阶段写入的上下文能在全新进程里读回（我们真的做过跨进程写-读验证）。这不是 resume——历史消息不会回到  | 1（无 example） |
| [#121](https://github.com/deepseek-ai/deepseek-harness/discussions/121) | 2 | windows环境鬼打墙 | pi-mcp-adapter 接一个提供 shell 执行的 MCP server，让命令走 MCP 工具而不是原生 pwsh，避开这个参数契约。MCP 链路等 | 1（MCP 链路本身；具体 server 未 |
| [#4619](https://github.com/deepseek-ai/deepseek-harness/discussions/4619) | 1 | Agent 在长对话中会把内部思考泄漏到最终输出，并且提前停止任务 | 改用带自身传输的 Pi provider 包（经 pi2dsh 投影成 DSH 原生 llm 路由）：这条路由包住 Pi 包自己的 provider.strea | 结构性成立/行为未测 |
| [#4618](https://github.com/deepseek-ai/deepseek-harness/discussions/4618) | 1 | 偶尔报错invalid_request_error | 走 pi2dsh 的 provider 路由（Pi provider 包自带传输）：请求体由 Pi 包/pi-ai 构造，结构上不经过 DSH 原生 adapt | 结构性成立/行为未测 |
| [#4614](https://github.com/deepseek-ai/deepseek-harness/discussions/4614) | 1 | [Bug] MCP tools with empty/object-only input | 改用 pi-mcp-adapter（Pi 生态 MCP 全套：stdio/HTTP/SSE、OAuth、lazy proxy、resources/prompts | 结构性成立/行为未测 |
| [#4612](https://github.com/deepseek-ai/deepseek-harness/discussions/4612) | 1 | Bug report draft: native read_image tool fai | 让模型看图不走原生 read_image：pi-vision-tool（等级一、无 example）提供 Pi 侧的看图工具；贴进会话的图片则用 @kassin | 结构性成立/行为未测 |
| [#4578](https://github.com/deepseek-ai/deepseek-harness/discussions/4578) | 1 | [Bug] OpenAI provider 上下文溢出后压缩失败，原对话未改变 | 换用自带传输的 Pi provider 包做路由：容量/模态由包定义直接声明（不吃 llm-pi-ai 的 catalog 与其溢出判定），CLAUDE.md  | 结构性成立/行为未测 |
| [#4564](https://github.com/deepseek-ai/deepseek-harness/discussions/4564) | 1 | [Bug] llm.discoverModels returns build-time  | 改用自带传输的 Pi provider 包做路由：目录由包在运行时向真实端点拉取，完全不经这段短路——pi-provider-alibaba 的 live ca | 1（仅限已有对应 Pi provider 包 |
| [#4563](https://github.com/deepseek-ai/deepseek-harness/discussions/4563) | 1 | 目前DSH当历史任务过多的情况下，点击SubAgent经常会timeout | 改用 @tintinweb/pi-subagents 经 pi2dsh 承接子代理：它有自己的会话记账与交互式管理器、跨重启重开，不经 DSH 原生 subag | 1 |
| [#4548](https://github.com/deepseek-ai/deepseek-harness/discussions/4548) | 1 | `dsh-tool-lsp`: allow configuring `workspace | 经 pi-mcp-adapter 接一个 LSP MCP server（stdio）：根目录由该 server 自己的启动参数指定，完全不受 session c | 1 |
| [#4538](https://github.com/deepseek-ai/deepseek-harness/discussions/4538) | 1 | Let plugins conditionally claim tool-call re | 把 obelisk 作为 MCP server 经 pi-mcp-adapter 接入：它有自己的工具名，卡片天然与 bash 分开、不必碰 bash 键；MC | 1 |
| [#4536](https://github.com/deepseek-ai/deepseek-harness/discussions/4536) | 1 | [mcp-client] 单个工具 outputSchema 形状不规范 → 整台服务器 | pi-mcp-adapter 是另一套完整的 MCP 客户端实现（自带 transport/protocol/OAuth/cache），不经过 dsh-mcp- | 结构性成立/行为未测 |
| [#4524](https://github.com/deepseek-ai/deepseek-harness/discussions/4524) | 1 | Preserve vision and image-input capabilities | @kassing/pi-vision 伴生路由：贴的图交给你配置的视觉模型分析，分析结果注入这一轮文本模型的上下文——完全不依赖 DSH 发现阶段是否保住 vi | 1 |
| [#4503](https://github.com/deepseek-ai/deepseek-harness/discussions/4503) | 1 | [Security] All sandbox modes allow connectin | pi-approval-guardian：每次工具调用执行前由第二个模型逐次审批，可以在策略层拦住 curl --unix-socket docker.sock | 1（无 example） |
| [#4498](https://github.com/deepseek-ai/deepseek-harness/discussions/4498) | 1 | fix(llm-deepseek): unclamped defaultMaxToken | 改用自带传输的 Pi provider 包注册这个模型：请求体由包自己按其目录容量构造，结构上不经过 llm-deepseek 的 modelInfoFor/d | 结构性成立/行为未测 |
| [#4493](https://github.com/deepseek-ai/deepseek-harness/discussions/4493) | 1 | 【BUG REPORT】dsh-llm-pi-ai: Responses 回放历史时将输 | 改用自带传输的 Pi provider 包把这个网关注册成 DSH 原生路由：请求体在包内自己构造，不经过 dsh-llm-pi-ai 的 Responses  | 结构性成立/行为未测 |
| [#4483](https://github.com/deepseek-ai/deepseek-harness/discussions/4483) | 1 | DSH一个步骤payload的Json串没闭合，导致无法继续进行后续会话 | 用自带传输的 Pi provider 包建路由：请求不经 dsh-llm 的那段累加器，改由 pi-ai 自己的累加器组装（能否扛住这类残报文我们没测过）；已损 | 结构性成立/行为未测 |
| [#4431](https://github.com/deepseek-ai/deepseek-harness/discussions/4431) | 1 | OpenRouter's in_flight_budget_exhausted 402  | 改用自带传输的 Pi provider 包建的路由：请求不经 llm-pi-ai 的那段分类器；但我们的路由 adapter 最终吐什么错误码、dsh-llm- | 结构性成立/行为未测 |
| [#4427](https://github.com/deepseek-ai/deepseek-harness/discussions/4427) | 1 | BlockAssembler fuses parallel tool calls whe | 自带传输的 Pi provider 包建的路由不经这段 BlockAssembler，由 pi-ai 自己的累加器组装；pi-ai 那边能不能按 id 正确拆分 | 结构性成立/行为未测 |
| [#4417](https://github.com/deepseek-ai/deepseek-harness/discussions/4417) | 1 | 多文件夹工作区/Allows multi folders in a workspace | pi-mcp-adapter + 一个 filesystem 类 MCP server 指向额外目录：模型即可读写工作区之外的那些目录，拿到『跨多目录干活』的结 | 1 |
| [#4412](https://github.com/deepseek-ai/deepseek-harness/discussions/4412) | 1 | [Bug] 已是 danger-full-access 时重申同一模式被拒，导致非默认模 | pi-mcp-adapter + filesystem 类 MCP server：模型改用 MCP 的读写工具，完全不经过 dsh-sandbox 的升级校验， | 1 |
| [#4407](https://github.com/deepseek-ai/deepseek-harness/discussions/4407) | 1 | [fs-search] grep/glob hard-fail with SEARCH_ | pi-mcp-adapter + 一个 filesystem/ripgrep 类 MCP server：搜索工具不经过 fs-search 的 seam 上限， | 1 |
| [#4384](https://github.com/deepseek-ai/deepseek-harness/discussions/4384) | 1 | [Security]AI自行提级的潜在安全漏洞Potential security ri | pi-approval-guardian（第二模型逐次审批工具调用）能在 agent 用 shell 工具去打 127.0.0.1:3080/api 这一步上拦 | 1（无 example） |
| [#4370](https://github.com/deepseek-ai/deepseek-harness/discussions/4370) | 1 | Streamed tool-call deltas with null id/name  | 包自带传输的 Pi provider 路由不经过 dsh-llm-deepseek 那段累加器（桥的路由 adapter 包住 Pi 包的 provider.s | 结构性成立/行为未测 |
| [#4350](https://github.com/deepseek-ai/deepseek-harness/discussions/4350) | 1 | typert-generator 0.0.1-rc.1 does not recogni | 外部客户端插件不必冒充 typert Remote：pi2dsh / dsh-work-x 的浏览器半边就是用 ctx.webServer.register 自 | 1 |
| [#4338](https://github.com/deepseek-ai/deepseek-harness/discussions/4338) | 1 | Web can keep stale running subagent state un | 子代理这件事本身有另一条路：@tintinweb/pi-subagents 经 pi2dsh 跑，子代理状态与结算走它自己的管理面（dsh-work-x 的任务 | 结构性成立/行为未测 |
| [#4334](https://github.com/deepseek-ai/deepseek-harness/discussions/4334) | 1 | Subagent failure notices don't include the e | 要的若是'子代理失败能自诊断'，@tintinweb/pi-subagents 是另一套运行时（自带结算通知、wait-for-result、可中途 steer | 结构性成立/行为未测 |
| [#4322](https://github.com/deepseek-ai/deepseek-harness/discussions/4322) | 1 | 提案：为插件提供工作区域与唯一原生会话伴随栏 | 若只要『插件的整页工作区』：dsh-work-x 已经用官方 client slot 在 Web 里注册了自己的整页管理 tab（真机跑通）。但他要的『原生会话 | 1 |
| [#4265](https://github.com/deepseek-ai/deepseek-harness/discussions/4265) | 1 | Bug: llm-deepseek adapter drops tool name/id | 改用 Pi 生态里自带传输的 provider 包经 pi2dsh 成为 DSH 原生路由：桥的路由 adapter 包住包自己的 provider.strea | 结构性成立/行为未测 |
| [#4252](https://github.com/deepseek-ai/deepseek-harness/discussions/4252) | 1 | 【bug】llm-pi-ai 自定义供应商直连路由：请求把 baseURL 当作 API | 改用带自有传输的 Pi provider 包注册的路由：鉴权头由包自己发，整条请求不经过 llm-pi-ai 的 client 组装（pi-provider-a | 结构性成立/行为未测 |
| [#4251](https://github.com/deepseek-ai/deepseek-harness/discussions/4251) | 1 | User-pasted/uploaded images are silently dro | 把主路由设为文本模型 + 装 @kassing/pi-vision 走伴生路由：粘贴的图片由桥自己读 DSH 附件、送视觉模型、把分析注入本轮，完全不经过 ds | 1 |
| [#4244](https://github.com/deepseek-ai/deepseek-harness/discussions/4244) | 1 | [Bug] An incomplete custom model entry disab | 把关键路由交给带自有传输的 Pi provider 包注册：这类路由不在 llm-pi-ai 的 providers 段里，一条 settings 配错炸不掉它 | 结构性成立/行为未测 |
| [#4243](https://github.com/deepseek-ai/deepseek-harness/discussions/4243) | 1 | [Bug] A hand-declared keyless route can neve | 用带自有传输的 Pi provider 包注册本地路由：鉴权由包自己决定，keyless 天然可行，不经过 harnessApiKeyAuth。前提是有覆盖 L | 结构性成立/行为未测 |
| [#4240](https://github.com/deepseek-ai/deepseek-harness/discussions/4240) | 1 | Bug Fix | 经 pi2dsh 路由的模型，其工具调用块由桥自己的 piEventsToDshChunks 转换构造，结构上不经过 dsh-llm-deepseek 的累加器 | 结构性成立/行为未测 |
| [#4239](https://github.com/deepseek-ai/deepseek-harness/discussions/4239) | 1 | subagent: a continuable child of a non-conti | 换用 @tintinweb/pi-subagents：子代理由它自己的 manager 拥有，前台/后台、完成通知、wait-for-result、stop 保 | 1 |
| [#4217](https://github.com/deepseek-ai/deepseek-harness/discussions/4217) | 1 | [Bug] 长会话在 DeepSeek 上报 HTTP 400 INVALID_REQU | 把该模型按真实 contextWindow 显式声明成一条自定义路由（官方 llm-pi-ai 配置），压缩阈值就不再按 1M 猜；再进一步可让带自有传输的 P | 结构性成立/行为未测 |
| [#4206](https://github.com/deepseek-ai/deepseek-harness/discussions/4206) | 1 | [Bug] Missing default fallback for image bud | 经 pi2dsh 路由的模型不走 PiAiAdapter 的这条 profile 预算装配（附件由桥自己解析后交给包自带传输），但这条路径在'历史里已有 ima | 结构性成立/行为未测 |
| [#4198](https://github.com/deepseek-ai/deepseek-harness/discussions/4198) | 1 | [bug] subagent: an aborted child's closing m | 改用 @tintinweb/pi-subagents（经 pi2dsh 挂载）跑子代理：它是另一套子代理运行时，settlement 不经过 dsh-subag | 1 |
| [#4145](https://github.com/deepseek-ai/deepseek-harness/discussions/4145) | 1 | failOnStartupError: false cannot cover a con | MCP 改用 pi-mcp-adapter（经 pi2dsh 装）：server 定义由它自己的运行时管理面持有、lazy proxy 按需连接，坏条目表现为那 | 1 |
| [#4125](https://github.com/deepseek-ai/deepseek-harness/discussions/4125) | 1 | Subagent children can route through a stale  | 改用 @tintinweb/pi-subagents 经 pi2dsh 委派：子代理是真 DSH 会话，且已实测「继承父会话当前的实时模型选择」，也支持逐子代理 | 1 |
| [#4124](https://github.com/deepseek-ai/deepseek-harness/discussions/4124) | 1 | Subagents inherit the stale create-time mode | @tintinweb/pi-subagents 的委派路径已实测继承父会话的实时模型选择，可作为不受该种子影响的另一条委派路线 | 1 |
| [#4120](https://github.com/deepseek-ai/deepseek-harness/discussions/4120) | 1 | Bug: pi-ai pinned at ^0.82.1 cannot receive  | 把该网关改成一个自带传输的 Pi provider 包经 pi2dsh 建原生 DSH 路由：pi2dsh 自身不依赖 pi-ai（peer 里没有），解析用的 | 结构性成立/行为未测 |
| [#4114](https://github.com/deepseek-ai/deepseek-harness/discussions/4114) | 1 | [Feature Request]: Isolate plugin execution  | 经 pi2dsh 挂载的 Pi 插件，其挂载失败与能力缺口由引擎分级容纳（不炸 Agent、不炸 harness）——但这只覆盖 Pi 插件那一半，原生 Cor | 结构性成立/行为未测 |
| [#4108](https://github.com/deepseek-ai/deepseek-harness/discussions/4108) | 1 | Bug: parallel tool-call deltas without ids c | 把这个自定义 baseURL 网关改走自带传输的 Pi provider 包经 pi2dsh 建路由：桥的路由 adapter 包住 Pi 包自己的 provi | 结构性成立/行为未测 |
| [#4091](https://github.com/deepseek-ai/deepseek-harness/discussions/4091) | 1 | Bug: duplicate provider tool-call index sile | 该自定义 baseURL 网关改走自带传输的 Pi provider 包经 pi2dsh 建路由，不经过 dsh-llm-deepseek 的这段 index  | 结构性成立/行为未测 |
| [#4062](https://github.com/deepseek-ai/deepseek-harness/discussions/4062) | 1 | [Bug] SSE tool_calls delta 解析未防御空字符串 id/name | 改用一个自带传输的 Pi provider 包（经 pi2dsh 成为原生 DSH 路由）指向该网关：桥的路由 adapter 包住 Pi 包自己的 provi | 结构性成立/行为未测 |
| [#4033](https://github.com/deepseek-ai/deepseek-harness/discussions/4033) | 1 | Idea: allow switching to a non-vision model  | @kassing/pi-vision 的伴生路由：主模型全程停在纯文本模型，贴图由伴生视觉路由处理、分析结果注入本轮——从一开始就不需要在两个模型间来回切，也就 | 1 |
| [#4025](https://github.com/deepseek-ai/deepseek-harness/discussions/4025) | 1 | [Analysis] mcp-client activeServerNames: roo | pi-mcp-adapter（经 pi2dsh 装）自带完整 MCP 运行时——stdio/Streamable HTTP/SSE、OAuth、lazy pro | 1 |
| [#3998](https://github.com/deepseek-ai/deepseek-harness/discussions/3998) | 1 | MCP 结果的图片与 ui_url 进入 tool/result.meta，通用工具卡渲 | 改用 pi-mcp-adapter（经 pi2dsh）接同一批 MCP server：图片内容块、structured content、ui:// 的 MCP  | 1 |
| [#3984](https://github.com/deepseek-ai/deepseek-harness/discussions/3984) | 1 | [Bug] mcp-client: activeServerNames 生命周期泄漏导致 | 改用 pi-mcp-adapter（经 pi2dsh）承载这些 MCP server：一份引擎实例统一管理全部 server，不存在按 preset 逐条挂 d | 1 |
| [#3955](https://github.com/deepseek-ai/deepseek-harness/discussions/3955) | 1 | Streaming tool calls fail when later deltas  | 改走 Pi provider 包自带传输的路由：桥的路由 adapter 包住包自己的 provider.stream，再经 piEventsToDshChun | 结构性成立/行为未测 |
| [#3954](https://github.com/deepseek-ai/deepseek-harness/discussions/3954) | 1 | Continuable (fork) subagents can call ask_us | 用 @tintinweb/pi-subagents（经 pi2dsh）做委派：子代理是真 DSH 会话但由该包自己管生命周期，前台/后台、完成通知、中途 ste | 1 |
| [#3936](https://github.com/deepseek-ai/deepseek-harness/discussions/3936) | 1 | Writing simple files to workspace is difficu | 用 pi-mcp-adapter 挂一个 filesystem MCP server，让模型用该 server 的写工具落文件——路径与权限由 server 自 | 1 |
| [#3923](https://github.com/deepseek-ai/deepseek-harness/discussions/3923) | 1 | [BUG] dsh-llm-pi-ai: tool_call arguments O(n | 同一端点换成自带传输的 Pi provider 包经 pi2dsh 接入：路由 adapter 包的是包自己的 provider.stream，再经 piEve | 结构性成立/行为未测 |
| [#3919](https://github.com/deepseek-ai/deepseek-harness/discussions/3919) | 1 | write/edit tools fail on Google Drive Deskto | 用 pi-mcp-adapter 挂 filesystem MCP server 做读写：该 server 自己 open/write，不走 writeFile | 1 |
| [#3893](https://github.com/deepseek-ai/deepseek-harness/discussions/3893) | 1 | [踩坑] 直接在 settings.yaml 添加自定义模型时需要添加 API 类型和  | provider 由包自己声明的路子不用手写 settings 条目：装一个自带传输的 Pi provider 包，协议/端点/凭证引用由包的注册面给出，经 p | 1 |
| [#3832](https://github.com/deepseek-ai/deepseek-harness/discussions/3832) | 1 | Model switch fails when history contains ima | 改用自带 transport 的 Pi provider 包（pi2dsh 把它投影成 DSH 原生 llm 路由），请求由该包自己的 provider.str | 结构性成立/行为未测 |
| [#3822](https://github.com/deepseek-ai/deepseek-harness/discussions/3822) | 1 | Bug: streamed tool_call id/name clobbered by | 改用自带传输的 Pi provider 包（pi2dsh 把它变成 DSH 原生 llm 路由），该路由的流转换不经过 dsh-llm-deepseek 的这段 | 结构性成立/行为未测 |
| [#3819](https://github.com/deepseek-ai/deepseek-harness/discussions/3819) | 1 | Agent falls into infinite bash loop while in | pi-approval-guardian：第二个模型在每次工具调用执行前审批，可以在 echo 空转第 N 次时 deny，把跑飞的循环截断（不是他要的 har | 1（无 example） |
| [#3800](https://github.com/deepseek-ai/deepseek-harness/discussions/3800) | 1 | Long-running tasks frequently show "Stopped" | 把长任务交给 @tintinweb/pi-subagents 的后台子代理跑——每个子代理是独立的真 DSH 会话，父端断线不影响它继续，重启后还能 reope | 1 |
| [#3795](https://github.com/deepseek-ai/deepseek-harness/discussions/3795) | 1 | [subagent-codex] Should an omitted agentMess | 若他实际是想要一条稳的子代理链路：@tintinweb/pi-subagents 走的是真 DSH 子会话，完全不经过 subagent-codex 的 wir | 1 |
| [#3785](https://github.com/deepseek-ai/deepseek-harness/discussions/3785) | 1 | Add an injectable slot beside the running "D | Pi 状态条（pi-powerline-footer，等级一）能在 widget dock 常驻显示插件自算的信息——位置不在消息列的 Deep diving  | 1 |
| [#3807](https://github.com/deepseek-ai/deepseek-harness/discussions/3807) | 1 | [Bug] llm-deepseek loses tool name when late | 自带传输的 Pi provider 包经 pi2dsh 注册成的 DSH 原生路由，其流转换不走 dsh-llm-deepseek 的这段累加器 | 结构性成立/行为未测 |
| [#3751](https://github.com/deepseek-ai/deepseek-harness/discussions/3751) | 1 | Bug: TOOL_RUNTIME_SCHEDULER symbol mismatch  | 要的结果如果是『子代理能真的干活』：@tintinweb/pi-subagents 经 pi2dsh 的子会话走的是 ctx.agents 的官方子 agent | 1 |
| [#3714](https://github.com/deepseek-ai/deepseek-harness/discussions/3714) | 1 | Windows: one-shot pwsh collapses every exit  | 如果他要的结果是『我的危险命令在 Windows 上真的能被拦住』：pi-approval-guardian 经 pi2dsh 逐次审批工具调用，deny 走的 | 1（无 example） |
| [#3713](https://github.com/deepseek-ai/deepseek-harness/discussions/3713) | 1 | An unset value in an MCP entry env kills the | MCP 服务器改由 pi-mcp-adapter 承载（自带管理面、配置存储与 stdio/HTTP/SSE 传输），配置不经过 dsh-mcp-client  | 1 |
| [#3696](https://github.com/deepseek-ai/deepseek-harness/discussions/3696) | 1 | API key 凭据写入/读取链路不可靠 —— 两平台复现（opencode + 火山方 | 这两个平台如果有自带传输的 Pi provider 包，凭证走桥自己的存储与 /login（内部 auth.json），完全不经过设置页的 settings.m | 1 |
| [#3695](https://github.com/deepseek-ai/deepseek-harness/discussions/3695) | 1 | I find some issues when using DSH in win 2k2 | 改走 Pi provider 包自带传输的路由：桥的路由 adapter 包住包自己的 provider.stream 再经 piEventsToDshChun | 结构性成立/行为未测 |
| [#3688](https://github.com/deepseek-ai/deepseek-harness/discussions/3688) | 1 | dsh 调用工具是会出现空think的情况 | 若确实是原生 adapter 的流累加问题，走 Pi provider 包自带传输的路由不经过那段累加器 | 结构性成立/行为未测 |
| [#3684](https://github.com/deepseek-ai/deepseek-harness/discussions/3684) | 1 | Context window should follow selected model  | 改用 Pi provider 包注册的路由：模型容量由包自己的目录声明并随注册进 DSH llm 目录（我们 0.20.0 才把 resolveModelInf | 结构性成立/行为未测 |
| [#3677](https://github.com/deepseek-ai/deepseek-harness/discussions/3677) | 1 | 调用第三方key存在异常中断问题 | 若是原生 adapter 的流累加/重试问题，改用自带传输的 Pi provider 包路由可整段绕开那条链路 | 结构性成立/行为未测 |
| [#3669](https://github.com/deepseek-ai/deepseek-harness/discussions/3669) | 1 | Product subagent retries and transport fallb | 改用 @tintinweb/pi-subagents 派子代理：孩子就是真 DSH 会话，可以前台看、中途 steer、在管理器里看每个孩子的状态和模型，完成有 | 1 |
| [#3660](https://github.com/deepseek-ai/deepseek-harness/discussions/3660) | 1 | [Bug][MCP] Repeated nextCursor can make tool | MCP 改由 pi-mcp-adapter 承载：它有自己的 MCP client 与传输，完全不经过 dsh-mcp-client 的 syncTools，而 | 结构性成立/行为未测 |
| [#3600](https://github.com/deepseek-ai/deepseek-harness/discussions/3600) | 1 | Profile Bundle 安装成功但原生负载为空，首次委派才暴露失败 | 若目标只是把任务委派给自治子代理：@tintinweb/pi-subagents 经 pi2dsh 起的是 DSH 原生子会话，不依赖任何上百 MB 的平台原生 | 1 |
| [#3569](https://github.com/deepseek-ai/deepseek-harness/discussions/3569) | 1 | dsh 上下文满了就卡死了，不会compact，强制compact也卡死 | 把主模型换成一条经 pi2dsh 注册的 provider 路由（Pi 包自带传输，不经过 DSH 原生 adapter 的流式累加器），同时该路由的 cont | 结构性成立/行为未测 |
| [#3568](https://github.com/deepseek-ai/deepseek-harness/discussions/3568) | 1 | [BUG]mcp-client 工具调用参数流式传输断裂，导致空参数和死循环 | 改用 pi-mcp-adapter 经 pi2dsh 挂同一台 DBX server——不经过 dsh-mcp-client 的参数重组（stdio/HTTP/ | 1 |
| [#3566](https://github.com/deepseek-ai/deepseek-harness/discussions/3566) | 1 | Custom provider model discovery ignores reas | 把这个网关做成（或换用）一个自带传输的 Pi provider 包经 pi2dsh 注册：模型容量、模态、推理档位映射随包定义直接上线，完全不经过 discov | 1 |
| [#3561](https://github.com/deepseek-ai/deepseek-harness/discussions/3561) | 1 | Bug report + fix: image-bearing session dead | 改选一条 pi2dsh 注册的多模态路由（@kassing/pi-vision 伴生路由，或任意带图像模态的 Pi provider 包）——会话里有图片也能通 | 1 |
| [#3517](https://github.com/deepseek-ai/deepseek-harness/discussions/3517) | 1 | dsh-tui 使用 /v1/responses 时疑似每轮重发完整历史，导致上游频繁报 | 改用自带传输的 Pi provider 包做这条 Codex/responses 路由——请求体由该包自己构造、完全不经过 DSH 原生 responses a | 结构性成立/行为未测 |
| [#3489](https://github.com/deepseek-ai/deepseek-harness/discussions/3489) | 1 | [Bug] Expired MCP session causes repeated to | 同一台 MCP server 改用 pi-mcp-adapter 接入：连接生命周期、重连由该包自带传输管理，完全不经官方 dsh-mcp-client（重连已 | 1 |
| [#3482](https://github.com/deepseek-ai/deepseek-harness/discussions/3482) | 1 | Harness Intelligence: Compiling Repeated Rea | 经验持久化那一格今天可以用 pi-hermes-memory（跨会话记忆，跨进程写入-读回实测过，无 example）；晋升/评估管线没有现成件 | 1（无 example） |
| [#3446](https://github.com/deepseek-ai/deepseek-harness/discussions/3446) | 1 | [Bug] dsh-base 4处硬编码付费API默认值，models:[] 仅隐藏UI | 要的两条结果各有一条我们的路：默认模型可指向 Pi provider 包自带传输注册的原生路由（等级一，实测过 Alibaba Token Plan / Cod | 1（provider 路由）/ 2（web  |
| [#3431](https://github.com/deepseek-ai/deepseek-harness/discussions/3431) | 1 | Render composer dock stats + billing on one  | 若他只是想「那些数字随时可见」，dock 槽位可由插件自绘一条状态条——pi-powerline-footer 就在 widget dock 里工作（等级一）； | 1 |
| [#3338](https://github.com/deepseek-ai/deepseek-harness/discussions/3338) | 1 | 429 with insufficient_quota is classified as | 把这个中转网关改由自带传输的 Pi provider 包接入（经 pi2dsh 变成原生 DSH 路由），请求响应不经过 llm-deepseek 的 http | 结构性成立/行为未测 |
| [#3299](https://github.com/deepseek-ai/deepseek-harness/discussions/3299) | 1 | Bug: streaming tool_calls with empty name fr | 改用自带传输的 Pi provider 包（经桥成为原生 DSH 路由）：请求由 Pi 包自己的 provider.stream 发出、再经 piEventsT | 结构性成立/行为未测 |
| [#3281](https://github.com/deepseek-ai/deepseek-harness/discussions/3281) | 1 | Bug: streamed tool calls assembled with empt | 改用自带传输的 Pi provider 包成为原生 DSH 路由：报文由 Pi 包自己的 provider.stream 累加、再经 piEventsToDsh | 结构性成立/行为未测 |
| [#3260](https://github.com/deepseek-ai/deepseek-harness/discussions/3260) | 1 | dsh-llm-deepseek streaming: tool-call id/nam | 改用自带传输的 Pi provider 包（经桥成原生 DSH 路由）：累加发生在 Pi 包自己的 provider.stream 里，再经 piEventsT | 结构性成立/行为未测 |
| [#3244](https://github.com/deepseek-ai/deepseek-harness/discussions/3244) | 1 | /斜杠命令体系功能简陋 | 子代理管理面今天有现成的：@tintinweb/pi-subagents 经 pi2dsh 提供交互式子代理管理命令（前台/后台、中途干预、恢复），Skills | 1 |
| [#3226](https://github.com/deepseek-ai/deepseek-harness/discussions/3226) | 1 | Bug: adopted vision models lose input modali | 不走设置页采纳：Pi provider 包自带传输经 pi2dsh 注册成原生 DSH 路由时，模态/容量随包声明一起进目录（provider 全链已端到端实测 | 1 |
| [#3222](https://github.com/deepseek-ai/deepseek-harness/discussions/3222) | 1 | [Bug] HTTP 403 授权拒绝被归类为 AUTH，UI 显示 "API key  | Pi provider 包自带传输的路由不经过这两个官方分类器，错误从包自己的传输层冒上来；但“原始 provider 消息是否真能透到 UI”我们没测过 | 结构性成立/行为未测 |
| [#3209](https://github.com/deepseek-ai/deepseek-harness/discussions/3209) | 1 | dsh web behind a reverse proxy: let deployme | 提示词那一处可以由插件在官方 system-prompt/assemble waterfall 里改写（该 waterfall 的返回值权威、可改已有条目已实测 | 结构性成立/行为未测 |
| [#3178](https://github.com/deepseek-ai/deepseek-harness/discussions/3178) | 1 | [BUG] 在WSL下使用workspace write模式时，由于/dev/dxg被隐 | 经 pi-mcp-adapter 接一个本地执行类 MCP server：MCP server 是独立进程、不在 DSH 的 bwrap 沙箱里，/dev/dx | 1 |
| [#3159](https://github.com/deepseek-ai/deepseek-harness/discussions/3159) | 1 | Upstream candidates from an rc.7 plugin-heav | 仅对第 1 项：改用自带传输的 Pi provider 包，请求根本不经 dsh-llm-pi-ai，system prompt 落位由该包自己决定，不必 pa | 结构性成立/行为未测 |
| [#3158](https://github.com/deepseek-ai/deepseek-harness/discussions/3158) | 1 | Bug: pi-ai stream_read_error is treated as n | 改用自带传输的 Pi provider 包接同一网关，请求不经 dsh-llm-pi-ai 的分类器（provider 包全链本身等级一实测）；但『中途截断在我 | 结构性成立/行为未测 |
| [#3128](https://github.com/deepseek-ai/deepseek-harness/discussions/3128) | 1 | [Bug] dsh-llm-pi-ai ignores Retry-After when | 改用自带传输的 Pi provider 包直连该网关，请求不经 dsh-llm-pi-ai 的错误映射与重试委托（provider 包全链等级一实测）；但『42 | 结构性成立/行为未测 |
| [#3114](https://github.com/deepseek-ai/deepseek-harness/discussions/3114) | 1 | feat(dsh-settings): let plugins declare thei | 要的结果（自研插件的配置能在浏览器里读写）今天有另一条路：插件自带 client 半边（package.json 的 dsh.client + 导出 ./cli | 1 |
| [#3112](https://github.com/deepseek-ai/deepseek-harness/discussions/3112) | 1 | Bug: read tcp 错误被误分类为 PI_AI_ERROR，导致 session | 包自带传输的 Pi provider 经我们的路由 adapter 出去，结构上不经过 dsh-llm-deepseek/llm-pi-ai 的那段解析与分类， | 结构性成立/行为未测 |
| [#3090](https://github.com/deepseek-ai/deepseek-harness/discussions/3090) | 1 | Bug: tool calls lose their name/id when stre | 包自带传输的 Pi provider 经我们的路由 adapter 出去，结构上不经过 dsh-llm-deepseek/llm-pi-ai 的那段解析与分类； | 结构性成立/行为未测 |
| [#3073](https://github.com/deepseek-ai/deepseek-harness/discussions/3073) | 1 | Bug: pi-ai adapter misclassifies 401/403 in  | 包自带传输的 Pi provider 经我们的路由 adapter 出去，结构上不经过 dsh-llm-deepseek/llm-pi-ai 的那段解析与分类， | 结构性成立/行为未测 |
| [#3069](https://github.com/deepseek-ai/deepseek-harness/discussions/3069) | 1 | Bug: every tool call fails with `unknown too | 包自带传输的 Pi provider 经我们的路由 adapter 出去，结构上不经过 dsh-llm-deepseek/llm-pi-ai 的那段解析与分类； | 结构性成立/行为未测 |
| [#3046](https://github.com/deepseek-ai/deepseek-harness/discussions/3046) | 1 | [bug] llm-deepseek: user text serializes bef | 改用自带传输的 Pi provider 包经桥注册的路由：请求体由 Pi 包自己的序列化器产出，结构上不经过 dsh-llm-deepseek 的 serial | 结构性成立/行为未测 |
| [#3045](https://github.com/deepseek-ai/deepseek-harness/discussions/3045) | 1 | [Security] WSL2 interop 通道完全穿透 workspace-wri | pi-approval-guardian：第二模型在每次工具调用执行前审查，可拦下 powershell.exe/cmd.exe 这类 interop 调用。注 | 1（无 example） |
| [#3040](https://github.com/deepseek-ai/deepseek-harness/discussions/3040) | 1 | Web UI renders streamed UTF-8 (Cyrillic/emoj | 若解码缺陷落在 llm-pi-ai adapter 侧：自带传输的 Pi provider 包经桥注册的路由不经过官方 adapter，可当作二分手段；若在 W | 结构性成立/行为未测 |
| [#3032](https://github.com/deepseek-ai/deepseek-harness/discussions/3032) | 1 | [安全讨论] AI Agent（Harness 等）在受限环境中自动通过 explore | pi-approval-guardian：每次工具调用执行前由第二模型审查 allow/deny，可以给这类试错链条加一道独立闸门（不是用户确认，语义要说清） | 1（无 example） |
| [#3030](https://github.com/deepseek-ai/deepseek-harness/discussions/3030) | 1 | WebSocket downlinks have no heartbeat; live  | pi-approval-guardian 把工具调用的审批放到服务端由第二模型完成，不依赖 mux 帧送达浏览器——但这是把'用户批'换成'模型批'，语义不同， | 1（无 example） |
| [#3021](https://github.com/deepseek-ai/deepseek-harness/discussions/3021) | 1 | [Bug] rc.7: reasoning (thinking) intermitten | 自带传输的 Pi provider 包经桥注册的路由，reasoning/text 的分类由桥的 piEventsToDshChunks 完成，结构上不走官方  | 结构性成立/行为未测 |
| [#2997](https://github.com/deepseek-ai/deepseek-harness/discussions/2997) | 1 | [Bug] Tool-call name dropped when gateway st | 把该网关改配成自带传输的 Pi provider 包经桥注册的路由：请求/响应由 Pi 包自己的累加器处理，结构上不经过 dsh-llm-deepseek 的  | 结构性成立/行为未测 |
| [#2956](https://github.com/deepseek-ai/deepseek-harness/discussions/2956) | 1 | 使用自定义API服务，报错Anthropic stream ended before m | 把这个网关改用 Pi 生态的 provider 包接入（provider 自带传输 → 经 pi2dsh 成为原生 DSH llm 路由），报文不经过 DSH  | 结构性成立/行为未测 |
| [#2917](https://github.com/deepseek-ai/deepseek-harness/discussions/2917) | 1 | headless profile lacks services that session | 他清单里『跨会话记忆』这一类需求可以换条路：pi-hermes-memory 经 pi2dsh 挂载，记忆走 Pi 包自己的存储，不依赖 DSH 的 works | 1（无 example，且未在 headle |
| [#2916](https://github.com/deepseek-ai/deepseek-harness/discussions/2916) | 1 | [Bug] 流式 tool_calls delta 中 name/id 为 null 时 | 把这个上游改用 Pi 生态 provider 包接入（provider 自带传输 → 经桥成为原生 DSH llm 路由），报文不经过 dsh-llm-deep | 结构性成立/行为未测 |
| [#2915](https://github.com/deepseek-ai/deepseek-harness/discussions/2915) | 1 | Failed invalid pi-ai replay state: block cou | 改用自带传输的 Pi provider 包（经桥成为原生 DSH llm 路由），请求不经过 llm-pi-ai 的 replayState 投影，这个校验点根 | 1 |
| [#2913](https://github.com/deepseek-ai/deepseek-harness/discussions/2913) | 1 | Failed/interrupted assistant turn corrupts s | 改用自带传输的 Pi provider 包（经桥成为原生 DSH llm 路由），不经过 llm-pi-ai 的 replayState 投影 | 1 |
| [#2911](https://github.com/deepseek-ai/deepseek-harness/discussions/2911) | 1 | 图片上传被拒之后：拒绝信息应该告诉用户该换哪个模型，并且能一键换 | @kassing/pi-vision 伴生路由：贴的图交给视觉伴生模型分析、结论注入当轮，主模型完全不变——正好绕开他自己反对的「静默换模型会同时换掉价格/语气 | 1 |
| [#2910](https://github.com/deepseek-ai/deepseek-harness/discussions/2910) | 1 | RFC：统一资源渲染层 —— 可插拔的富输出渲染器 seam（对标 Jupyter No | 只限「生成的图要在回复里显示」这一类：@crazygit/pi-codex-image-gen 把产物存成 DSH 原生 attachment，Web 里内联渲 | 1 |
| [#2895](https://github.com/deepseek-ai/deepseek-harness/discussions/2895) | 1 | [Bug] Tool-call sessions sometimes send tool | 改用自带传输的 Pi provider 包经 pi2dsh 注册成 DSH 路由：桥的路由 adapter 包住 provider.stream 再经 piEv | 结构性成立/行为未测 |
| [#2884](https://github.com/deepseek-ai/deepseek-harness/discussions/2884) | 1 | RFC: Agent as a 24×7 Background Service — Ke | 只限「多 key 轮询」这一半：自带传输的 Pi provider 包可以把轮询逻辑写在包内、经 pi2dsh 注册成 DSH 原生路由（provider 全链 | 1 |
| [#2873](https://github.com/deepseek-ai/deepseek-harness/discussions/2873) | 1 | Feature request: additive top-level sidebar  | settings.section 能挂一个全局（非会话绑定）页面，dsh-work-x 的 Settings → MCP 全局页就是这么落的，等级一。但那是设置 | 1 |
| [#2865](https://github.com/deepseek-ai/deepseek-harness/discussions/2865) | 1 | Bug: bare 400/413 (no body) mislabeled as co | 自带传输的 Pi provider 包经 pi2dsh 注册的路由不经过 llm-pi-ai 的 mapStopReason，那条误判在结构上不会发生；但我们没 | 结构性成立/行为未测 |
| [#2859](https://github.com/deepseek-ai/deepseek-harness/discussions/2859) | 1 | DeepSeek adapter translates empty/null SSE t | 自带传输的 Pi provider 包经 pi2dsh 注册成 DSH 路由：桥的路由 adapter 包住 provider.stream 再经 piEven | 结构性成立/行为未测 |
| [#2849](https://github.com/deepseek-ai/deepseek-harness/discussions/2849) | 1 | Please bump @earendil-works/pi-ai to 0.84.x  | 自带传输的 Pi provider 包经 pi2dsh 注册为原生 DSH llm 路由，目录由包自己拉取（动态 catalog），完全不受 DSH 里 pi- | 1（同机制在 pi-provider-ali |
| [#2822](https://github.com/deepseek-ai/deepseek-harness/discussions/2822) | 1 | bug(llm-pi-ai): openai-responses 路由无法关闭 sess | 把这个网关做成'包自带传输'的 Pi provider 包经 pi2dsh 注册成原生 DSH 路由——请求由包自己的传输发出，整条链不经过 dsh-llm-p | 1（机制端到端实测过；本例的 session |
| [#2802](https://github.com/deepseek-ai/deepseek-harness/discussions/2802) | 1 | [Bug] rc.6: every tool call fails with "unkn | 经 pi2dsh 路由的模型（自带传输的 Pi provider 包）不走 DSH 原生 adapter 的那段累加器，桥自己用 piEventsToDshCh | 结构性成立/行为未测（pi-ai 自己的累加 |
| [#2755](https://github.com/deepseek-ai/deepseek-harness/discussions/2755) | 1 | Reasoning (chain-of-thought) leaks into visi | 改用带自有传输的 Pi provider 包路由（pi2dsh 把它变成原生 DSH llm 路由），报文由包自己的解析器处理，结构上不经过 DSH 原生 ad | 结构性成立/行为未测 |
| [#2725](https://github.com/deepseek-ai/deepseek-harness/discussions/2725) | 1 | [BUG_REPORT] dsh_unknown_tool delta calling | 改用自带传输的 Pi provider 包经 pi2dsh 落成原生 DSH 路由：桥的路由 adapter 包住 provider.stream 再经 piE | 结构性成立/行为未测 |
| [#2703](https://github.com/deepseek-ai/deepseek-harness/discussions/2703) | 1 | [Bug Report] 通过"添加提供方"添加新的 deepseek 并填入新 API | 把第二个 key 走「自带传输的 Pi provider 包」这条路：包自己声明凭证引用（apiKeyEnv），经桥落成独立的原生 DSH 路由，天然不与 ll | 1（样板包等级一；他的场景需要一个同款小包） |
| [#2695](https://github.com/deepseek-ai/deepseek-harness/discussions/2695) | 1 | deepseek‑v4‑flash，当 reasoningEffort=high 时，模 | 自带传输的 Pi provider 包经 pi2dsh 落成原生路由后，流式累加走的是 pi-ai 自己的累加器，结构上不经过 DSH 那段被覆盖的组装；但对「 | 结构性成立/行为未测 |
| [#2690](https://github.com/deepseek-ai/deepseek-harness/discussions/2690) | 1 | 使用deepseek harness 设计插件安装评审师agent时，出现了死循环 | 要「注册即可调用」这个结果，可以走桥：经 pi2dsh 挂载的 Pi 插件/MCP server 注册的工具会被补进当前会话的工具 schema（挂载 gate | 1 |
| [#2674](https://github.com/deepseek-ai/deepseek-harness/discussions/2674) | 1 | Bug: empty tool-call id/name wipe in llm-dee | 改用一个自带传输的 Pi provider 包（经 pi2dsh 注册成原生 DSH llm 路由）指向同一个 DeepSeek 端点：这条路由包的是 Pi 包 | 结构性成立/行为未测 |
| [#2639](https://github.com/deepseek-ai/deepseek-harness/discussions/2639) | 1 | [RFC] Re-resolve continuable child policy on | 改用 @tintinweb/pi-subagents（经 pi2dsh）：子代理是真 DSH 会话，每个子可指定模型与思考档，并且继承父会话的『当前』模型选择而 | 1 |
| [#2593](https://github.com/deepseek-ai/deepseek-harness/discussions/2593) | 1 | [Bug]Windows：Agent 用 Remove-Item $home 会清空用户 | pi-approval-guardian：第二个模型在每次工具调用执行前逐次审批（allow/deny 都实际观察到），能在执行前看到完整命令并拒绝掉 Remo | 1（等级一，但没有 example） |
| [#2584](https://github.com/deepseek-ai/deepseek-harness/discussions/2584) | 1 | agent-loop: `max-tokens` finish persists ada | 改用包自带传输的 Pi provider 经 pi2dsh 成为原生路由：这条路由不经过 llm-pi-ai 的 replayState 投影，消息按外来历史记 | 结构性成立/行为未测 |
| [#2575](https://github.com/deepseek-ai/deepseek-harness/discussions/2575) | 1 | [Bug/Feature] Task list does not update whil | 把长任务改派给 @tintinweb/pi-subagents 的子代理：它自带前台/后台、完成通知、中途 steer 和交互式管理器，运行态不依赖 DSH 的 | 1 |
| [#2540](https://github.com/deepseek-ai/deepseek-harness/discussions/2540) | 1 | Bug: tool-call id/name overwritten by empty  | 改用包自带传输的 Pi provider 经 pi2dsh 成为原生 DSH llm 路由：这条路由包住 Pi 包自己的 provider.stream 再经  | 结构性成立/行为未测 |
| [#2499](https://github.com/deepseek-ai/deepseek-harness/discussions/2499) | 1 | [Bug] 调用文件/搜索工具时触发 'Cannot read properties o | 「联网搜索」这个结果有另一条路：pi-mcp-adapter 挂一个搜索类 MCP server（或 @juicesharp/rpiv-web-tools 的  | pi-mcp-adapter 本身等级一；针 |
| [#2485](https://github.com/deepseek-ai/deepseek-harness/discussions/2485) | 1 | Windows: dsh plugin add splits paths with sp | 「工具调用前要有真正生效的拦截」这个结果有另一条路：pi-approval-guardian 在 DSH 内部逐次审批工具调用（allow/deny 都观察到） | 1（等级一，但无 example） |
| [#2470](https://github.com/deepseek-ai/deepseek-harness/discussions/2470) | 1 | [BUG] dsh subagent 在 GUI 冷恢复后默认切回 dsv4p 模型导致 | 「子代理跟着父会话真正在用的那个模型跑」这个结果有另一条路：@tintinweb/pi-subagents 的子代理继承的是父 agent 的**实时模型选择* | 1 |
| [#2414](https://github.com/deepseek-ai/deepseek-harness/discussions/2414) | 1 | 死循环 | 文件读写这一半有另一条路：装 pi2dsh + pi-mcp-adapter 后接一个 filesystem MCP server，用它自己的 read/edi | 1 |
| [#2410](https://github.com/deepseek-ai/deepseek-harness/discussions/2410) | 1 | max-tokens responses containing tool calls c | 我们的路由不经过这条 llm-pi-ai 投影：Pi provider 包自带传输时，桥的路由 adapter 包住 provider.stream 再经 pi | 结构性成立/行为未测 |
| [#2374](https://github.com/deepseek-ai/deepseek-harness/discussions/2374) | 1 | [Bug] Configuring third-party OpenAI-compati | 接第三方 OpenAI 兼容网关本身另有一条路：Pi provider 包自带传输经 pi2dsh 成为原生 DSH 路由，请求不经过 dsh-llm-deep | 1 |
| [#2373](https://github.com/deepseek-ai/deepseek-harness/discussions/2373) | 1 | 工具层进化建议：pwsh 多行命令 / 无参工具 / write 转义 / 中文 GBK | 要多行脚本 / UTF-8 输出 / 字面量写文件，可经 pi-mcp-adapter 接一个 shell 或 filesystem MCP server：脚本 | 1 |
| [#2311](https://github.com/deepseek-ai/deepseek-harness/discussions/2311) | 1 | [Bug Report] Windows sandbox: SSPI 凭据获取在受限令牌 | 沙箱内要抓 HTTPS 可用走 Node/OpenSSL 栈的工具：@juicesharp/rpiv-web-tools 的 web_fetch（无需搜索 ke | 2 |
| [#2296](https://github.com/deepseek-ai/deepseek-harness/discussions/2296) | 1 | [Bug] Trailing slash in DEEPSEEK_BASE_URL pr | 改用自带传输的 Pi provider 包（经 pi2dsh 成为原生 DSH 路由），请求 URL 由该包自己拼，完全不经过 llm-deepseek 这段拼 | 结构性成立/行为未测 |
| [#2285](https://github.com/deepseek-ai/deepseek-harness/discussions/2285) | 1 | [可用性问题] MCP tools/list 返回重复游标时会导致同步无限循环 | 把 MCP server 接到 pi-mcp-adapter（经 pi2dsh），它自带 MCP 客户端与 transport，链路上不经过 dsh-mcp-c | 结构性成立/行为未测 |
| [#2283](https://github.com/deepseek-ai/deepseek-harness/discussions/2283) | 1 | 关于修改dsh的“取消”行为的提案 | 把长任务交给 @tintinweb/pi-subagents 的后台子代理执行：子代理是真实的 DSH 会话，实测“停了就是停了”（stop that stay | 1 |
| [#2263](https://github.com/deepseek-ai/deepseek-harness/discussions/2263) | 1 | UX: the composer '+' opens a command menu (d | 他真正的痛点“纯文本模型用户粘了图直到发送才报错”不必等这个 slot：@kassing/pi-vision 的伴生路由让粘贴的图片走视觉模型、分析结果注入纯文 | 1 |
| [#2239](https://github.com/deepseek-ai/deepseek-harness/discussions/2239) | 1 | Plugin settings namespaces cannot be exposed | 不走官方 settings namespace：插件自建客户端 slot + 自有 ctx.webServer.register 路由 + 自己的配置层持久化。 | 1 |
| [#2185](https://github.com/deepseek-ai/deepseek-harness/discussions/2185) | 1 | Duplicate settle notice for background subag | 改用 @tintinweb/pi-subagents 的子代理运行时：完成通知/等待结果走它自己的投递通道，不经过宿主 subagent 工具的这两条路径 | 1 |
| [#2157](https://github.com/deepseek-ai/deepseek-harness/discussions/2157) | 1 | workspace write下删除文件 | pi-approval-guardian：让第二个模型在每次工具调用执行前审批，越界删除这类调用可以被当场拦下（allow/deny 两侧我们都观察到过） | 1（无 example） |
| [#2145](https://github.com/deepseek-ai/deepseek-harness/discussions/2145) | 1 | Subagent回复放到了排队的消息队列，用户可以修改也可以发送插话，是 BUG还是刻意 | @tintinweb/pi-subagents 的子代理有自己的完成通知与 wait-for-result 通道（前台/后台、mid-run steer 都是它 | 1 |
| [#2143](https://github.com/deepseek-ai/deepseek-harness/discussions/2143) | 1 | Truncated turn (stopReason "length") desynch | 改用自带传输的 Pi provider 包注册的路由：桥的路由 adapter 包住 provider.stream 再经 piEventsToDshChunk | 结构性成立/行为未测 |
| [#2138](https://github.com/deepseek-ai/deepseek-harness/discussions/2138) | 1 | # DeepSeek Harness Bug Report | 改用自带传输的 Pi provider 包注册的路由，请求不经过 dsh-llm-deepseek 的 serializeMessages | 结构性成立/行为未测 |
| [#2116](https://github.com/deepseek-ai/deepseek-harness/discussions/2116) | 1 | Bug：流式工具调用和 usage 的畸形字段会越过适配器校验 | 改用自带传输的 Pi provider 包（经 pi2dsh 注册成 DSH 原生路由）——请求由包自己的 provider.stream 发出、再经 piEv | 结构性成立/行为未测 |
| [#2107](https://github.com/deepseek-ai/deepseek-harness/discussions/2107) | 1 | Web profile ships compaction-basic/command-c | 用 @tintinweb/pi-subagents 把长任务的重活（大批工具调用、大段读取）派给子会话，主会话只收结果，主线上下文就不再线性膨胀——这条路不依赖 | 1 |
| [#2090](https://github.com/deepseek-ai/deepseek-harness/discussions/2090) | 1 | Bug + one-line fix: streaming tool calls los | 改用自带传输的 Pi provider 包经 pi2dsh 注册成 DSH 原生路由：请求由包自己的 provider.stream 发出、经 piEvents | 结构性成立/行为未测 |
| [#2053](https://github.com/deepseek-ai/deepseek-harness/discussions/2053) | 1 | Authoritative effective model selection for  | 如果他要的结果只是『每个子代理跑不同模型』：@tintinweb/pi-subagents 经 pi2dsh 已实测端到端可用（每子代理模型与思考档位、继承父会 | 1 |
| [#1993](https://github.com/deepseek-ai/deepseek-harness/discussions/1993) | 1 | Source launch duplicates dsh-typert-protocol | 插件自己的 HTTP 面不用 typert Remote，改用 ctx.webServer.register 注册自有路由：dsh-work-x 的 Web M | 1（自有路由方案本身等级一；『源码启动器下同 |
| [#1992](https://github.com/deepseek-ai/deepseek-harness/discussions/1992) | 1 | Custom pi-ai routes lose catalog-known modal | 换一条路由来源：用包自带传输的 Pi provider 包经 pi2dsh 变成原生 DSH llm 路由，模态/容量/推理档位由包自己声明，根本不经过 llm | 1 |
| [#1968](https://github.com/deepseek-ai/deepseek-harness/discussions/1968) | 1 | [Feature] Composer cannot steer subagent ses | 他要的「运行中的子代理能被中途改口」这件事，用 @tintinweb/pi-subagents 今天就有：它自带的交互式管理器支持 mid-run steer、 | 1 |
| [#1967](https://github.com/deepseek-ai/deepseek-harness/discussions/1967) | 1 | [Bug] Agent edit files out of Workspace, whi | 要的结果若是「越界写入不要真的发生」，pi-approval-guardian 能给一条并行的路：第二个模型在每次工具执行前逐次审批，allow/deny 都观 | 1（无 example） |
| [#1924](https://github.com/deepseek-ai/deepseek-harness/discussions/1924) | 1 | Turn silently ends right before a tool call  | 如果最终查明是原生 adapter 的流解析把 tool-call 块吞了，那么改用「带自有传输的 Pi provider 包」接同一个 OpenAI 兼容端点 | 结构性成立/行为未测（且本帖根因未定，也可能 |
| [#1915](https://github.com/deepseek-ai/deepseek-harness/discussions/1915) | 1 | [Bug] Empty tool-call id ("") from adapters  | 对「新的损坏不再发生」这半边有一条并行路：改用带自有传输的 Pi provider 包接同一个端点，我们的路由包的是 Pi 包自己的 provider.stre | 结构性成立/行为未测 |
| [#1888](https://github.com/deepseek-ai/deepseek-harness/discussions/1888) | 1 | Idea: Session-scoped plugin assembly — auto- | 只想解决「工具太多把上下文吃光、又不想预先挑插件」这一半的话：pi-mcp-adapter 经 pi2dsh 提供 lazy proxy（几十个 MCP ser | 1 |
| [#1877](https://github.com/deepseek-ai/deepseek-harness/discussions/1877) | 1 | [Ideas] Two small upstream improvements: plu | 插件的浏览器半边不依赖官方 settings 命名空间也能有自己的配置面：走自有路由（ctx.webServer.register）+ 自己的 client s | 1 |
| [#1865](https://github.com/deepseek-ai/deepseek-harness/discussions/1865) | 1 | when we press back the harness fails | 如果坏的是 stock 终端面：换用 @xmoon76/dsh-pi-tui 这条终端 surface（经 pi2dsh 实测可用）能绕开 stock TUI  | 1 |
| [#1845](https://github.com/deepseek-ai/deepseek-harness/discussions/1845) | 1 | [Feature] 将 ChatView 中硬编码的 "Deep diving..."  | 只想在界面上有一处自定义的运行态文案的话：Pi 的状态条经 pi2dsh 投影进 widget dock 是实测过的（pi-powerline-footer）— | 1 |
| [#1806](https://github.com/deepseek-ai/deepseek-harness/discussions/1806) | 1 | GitHub Copilot routes fail every streaming t | pi2dsh 把「自带传输的 Pi provider 包」注册成原生 DSH llm 路由，请求由 Pi 包自己的 provider.stream 发出，结构上 | 结构性成立/行为未测 |
| [#1782](https://github.com/deepseek-ai/deepseek-harness/discussions/1782) | 1 | Bug: Plugin registrations on the host plane  | pi2dsh 的挂载路线本身就绕开这个坑：Pi 运行时按 agent/created 逐 root Agent 挂进 agent.ctx，命令与工具都注册在该  | 1 |
| [#1780](https://github.com/deepseek-ai/deepseek-harness/discussions/1780) | 1 | Bug：切到第三方模型后，多轮对话报 400：reasoning_text must b | 改用自带传输的 Pi provider 包经 pi2dsh 注册成原生路由：请求由 Pi 包自己的 provider.stream 发出、经 piEventsT | 结构性成立/行为未测 |
| [#1773](https://github.com/deepseek-ai/deepseek-harness/discussions/1773) | 1 | 建议：为第三方插件补齐可诊断、可配置的 Web 管理面 | 「第三方插件要有自己的 Web 配置面」这个结果今天拿得到，只是不走官方白名单：dsh-work-x 的 Web MCP 管理页就是自带 client slot | 1 |
| [#1771](https://github.com/deepseek-ai/deepseek-harness/discussions/1771) | 1 | 【修复与优化】修复历史回放空指针崩溃，并支持 OpenAI 兼容端点完整 compat  | 这两处都在官方 llm-pi-ai 内部。想让 compat 开关真上线，另一条已实测的路是把网关做成自带传输的 Pi provider 包经 pi2dsh 注 | 1 |
| [#1763](https://github.com/deepseek-ai/deepseek-harness/discussions/1763) | 1 | [Bug] Tool returns "Cannot read properties o | pi2dsh 对 @deepseek-ai/* 全部走 peerDependencies、profile 里不落任何核心包拷贝（singlepath E2E 有 | 2 |
| [#1761](https://github.com/deepseek-ai/deepseek-harness/discussions/1761) | 1 | 【功能需求】请支持 URL Scheme | 「手工添模型很麻烦」这一半有现成路径：自带传输的 Pi provider 包 `dsh plugin add` 装上即出现在 DSH 模型选择器里（目录、端点、 | 1 |
| [#1759](https://github.com/deepseek-ai/deepseek-harness/discussions/1759) | 1 | PTC模式的停止问题 | @tintinweb/pi-subagents 的子代理是真 DSH 会话，stop 停住且不复活（stop that stays stopped），另有前台/ | 1 |
| [#1745](https://github.com/deepseek-ai/deepseek-harness/discussions/1745) | 1 | subagent-codex: expose Codex thread/start ex | 若他要的只是「无人值守的后台委派」而不必是 Codex 线程：@tintinweb/pi-subagents 的子代理是真 DSH 会话，前台/后台、逐子 mo | 1 |
| [#1732](https://github.com/deepseek-ai/deepseek-harness/discussions/1732) | 1 | 功能建议：Windows 支持（Python SDK）+ 官方远程沙箱 provider | 「长任务后台跑、完成通知」这一条在会话内已有现成路径：@tintinweb/pi-subagents 支持后台子代理 + 完成通知 + 等结果/中途 steer | 1 |
| [#1713](https://github.com/deepseek-ai/deepseek-harness/discussions/1713) | 1 | Streamed tool calls lose name/id against Ope | 自带传输的 Pi provider 包经 pi2dsh 注册成 DSH 原生路由时，流式由包自己的 provider.stream 产出、再经 piEvents | 结构性成立/行为未测 |
| [#1703](https://github.com/deepseek-ai/deepseek-harness/discussions/1703) | 1 | invalid pi-ai replay state: block count does | 改用自带传输的 Pi provider 包注册的原生路由（pi-provider-alibaba 全链、Codex OAuth 订阅登录都实测过），那条路不经过 | 1 |
| [#1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697) | 1 | Bug: installing any plugin that depends on @ | pi2dsh 对全部 @deepseek-ai/* 只声明 peerDependencies、profile 里不落任何核心包拷贝（我们的真机回归有断言：pro | 1 |
| [#1655](https://github.com/deepseek-ai/deepseek-harness/discussions/1655) | 1 | harness 总崩溃 | 改用经 pi2dsh 注册为原生 DSH 路由的、带自有传输的 Pi provider 包（pi-provider 全链等级一实测）：请求由包自己的 HTTP  | 结构性成立/行为未测 |
| [#1627](https://github.com/deepseek-ai/deepseek-harness/discussions/1627) | 1 | 到达输出 token 上限时，出现“本轮运行失败invalid pi-ai replay | 改用经 pi2dsh 装的、包自带传输的 Pi provider 包（pi-provider-alibaba 全链、OpenAI Codex OAuth 订阅、 | 1 |
| [#1625](https://github.com/deepseek-ai/deepseek-harness/discussions/1625) | 1 | 发现 harness 处理数据的时候遇到的bug | 改走带自有传输的 Pi provider 包路由：桥的路由 adapter 包住包自己的 provider.stream 再经 piEventsToDshChu | 结构性成立/行为未测 |
| [#1572](https://github.com/deepseek-ai/deepseek-harness/discussions/1572) | 1 | Extension point for third-party LLM provider | 若 provider 以 Pi provider 包形态发布，pi2dsh 会把它翻译成官方 llm-pi-ai 的 profile（协议/端点/凭证引用/模型 | 1 |
| [#1519](https://github.com/deepseek-ai/deepseek-harness/discussions/1519) | 1 | Bug + tested fix: truncated tool-call argume | 换成由 Pi provider 包自带传输的路由（pi2dsh 的路由 adapter 包住包自己的 provider.stream 再经 piEventsTo | 结构性成立/行为未测 |
| [#1517](https://github.com/deepseek-ai/deepseek-harness/discussions/1517) | 1 | Run workflows as managed jobs with progress  | 要的若只是「fan-out 工作后台跑、父会话不卡、能看进度能取消能续」，@tintinweb/pi-subagents 今天就给：后台子会话、完成通知、运行中 | 1 |
| [#1514](https://github.com/deepseek-ai/deepseek-harness/discussions/1514) | 1 | [Control flow] Hook continue:false is record | 若诉求落到「工具调用要能被策略真正拦下」，pi-approval-guardian 走的是另一条闸门：第二个模型逐次审批工具调用，allow/deny 都实测观 | 1（无 example） |
| [#1512](https://github.com/deepseek-ai/deepseek-harness/discussions/1512) | 1 | [Bug][Windows Sandbox] Chrome Headless 在 wor | 若诉求是「让 agent 能驱动浏览器」，可用 pi-mcp-adapter 接一个远端/Streamable HTTP 形态的浏览器 MCP server，浏 | 结构性成立/行为未测 |
| [#1510](https://github.com/deepseek-ai/deepseek-harness/discussions/1510) | 1 | 关于自定义模型 | 要「不逐个勾」这个结果的话，用官方 llm-pi-ai 段在 settings.yaml 里声明式列这套模型，或装一个自带传输的 Pi provider 包（动 | 1 |
| [#1495](https://github.com/deepseek-ai/deepseek-harness/discussions/1495) | 1 | Proposal: session-level context window overr | 只对「网关真实容量与声明不符」那一半有效：用自带传输的 Pi provider 包注册路由，或用官方 llm-pi-ai profile 声明该路由的真实模型容 | 1 |
| [#1491](https://github.com/deepseek-ai/deepseek-harness/discussions/1491) | 1 | [Feature request] Expose a provider editor s | 要的结果（第三方 provider 的 OAuth 登录 + 登录后模型出现在 DSH 模型选择器 + token 只留在 host 侧）今天就能拿到：pi2d | 1 |
| [#1471](https://github.com/deepseek-ai/deepseek-harness/discussions/1471) | 1 | 审批弹窗时灵时不灵：approval answerer 无超时导致工具调用无限挂起（附  | 若他要的只是「工具调用别再挂死、同时仍有人/模型把关」：把审批策略从 ask 换成自动放行，改由 pi-approval-guardian（经 pi2dsh 装 | 1（无 example） |
| [#1453](https://github.com/deepseek-ai/deepseek-harness/discussions/1453) | 1 | [Design/BUG] Agent Loop 的每个工具步骤都会重复携带完整上下文，缺 | 就他痛点里「MCP 工具表撑爆上下文」那一份：pi-mcp-adapter 的 lazy proxy 把几十个 server 的工具表收成少数入口工具，模型按需 | 1 |
| [#1449](https://github.com/deepseek-ai/deepseek-harness/discussions/1449) | 1 | bug 任何会话只要遇到截断在 emoji 中间的工具结果，就会永久 400 无法继续 | 新会话若改用经 pi2dsh 承接的、自带传输的 Pi provider 包路由，请求不经过 dsh-llm-deepseek 的 serialize.ts。注 | 结构性成立/行为未测 |
| [#1421](https://github.com/deepseek-ai/deepseek-harness/discussions/1421) | 1 | [Idea] goal 等待子代理时 idle 轮次过密，容易误判卡住并中断正常子代理 | 换用经 pi2dsh 装的 @tintinweb/pi-subagents 派子代理：它自带 wait-for-result（父代理阻塞等结果而不是空转轮询）、 | 1 |
| [#1419](https://github.com/deepseek-ai/deepseek-harness/discussions/1419) | 1 | 非常多的问题：unknown tool 、失败时历史内容丢失 | 新会话改用经 pi2dsh 承接、自带传输的 Pi provider 包路由，流式增量由 pi-ai 自己的累加器处理，不经过原生 adapter 那段解析。已 | 结构性成立/行为未测 |
| [#1405](https://github.com/deepseek-ai/deepseek-harness/discussions/1405) | 1 | unknown tool "" / 会话历史加载失败:流式 tool_calls 空 d | 自带传输的 Pi provider 包注册出来的 DSH 路由包住的是 Pi 包自己的 provider.stream，再经 piEventsToDshChun | 结构性成立/行为未测 |
| [#1331](https://github.com/deepseek-ai/deepseek-harness/discussions/1331) | 1 | [Security] Windows 沙箱 partial 边界对模型与运维不可见，pw | 「每条命令先过一道门」这一半有第二条路：pi-approval-guardian 经 pi2dsh 装上后对每次工具调用（含 pwsh）插入逐次审批，allow | 1（无 example） |
| [#1289](https://github.com/deepseek-ai/deepseek-harness/discussions/1289) | 1 | Idea: generic host->client push channel for  | 不必等这个白名单：插件的 host 半边用 ctx.webServer.register 开一条自有 SSE/WebSocket 路由，客户端半边（dsh.cl | 1（dsh-work-x Web 管理页的既 |
| [#1249](https://github.com/deepseek-ai/deepseek-harness/discussions/1249) | 1 | [BUG] puppeteer MCP 断连导致 dsh web 整个进程崩溃退出（Wi | 改用 pi-mcp-adapter(经 pi2dsh)承载 puppeteer 这类 stdio MCP：它自带重连、懒代理与自己的传输层，不经过 dsh-mc | 1 |
| [#1215](https://github.com/deepseek-ai/deepseek-harness/discussions/1215) | 1 | [Feedback] Windows Codex CLI integration: fo | 第①项有并行路径：@tintinweb/pi-subagents 的子代理逐子会话指定模型与思考档，并继承父会话当前选中的模型，不经过 DSH 原生子代理的继承 | 1 |
| [#1202](https://github.com/deepseek-ai/deepseek-harness/discussions/1202) | 1 | [Bug][Web GUI] Failed subagents stay visible | 改走 @tintinweb/pi-subagents 那条子代理路径：它自带交互式管理器、前后台、完成通知、停止后保持停止、跨重启重开，状态由该包自己维护，不产 | 1 |
| [#1196](https://github.com/deepseek-ai/deepseek-harness/discussions/1196) | 1 | Third-party plugins cannot expose settings n | 不进 DSH 设置页，插件自带配置面：客户端半边注册自己的 slot 条目 + 服务端 ctx.webServer.register 自有路由（dsh-work | 1 |
| [#1183](https://github.com/deepseek-ai/deepseek-harness/discussions/1183) | 1 | Allow third-party plugins to expose their ow | 插件自建配置面：客户端 slot + ctx.webServer.register 自有路由（dsh-work-x 的 Web MCP 管理页/全局视图已实测） | 1 |
| [#1146](https://github.com/deepseek-ai/deepseek-harness/discussions/1146) | 1 | 【BUG反馈】pi-ai DeepSeek 路由在回传跨 provider 历史消息时丢 | 改用自带传输的 Pi provider 包经 pi2dsh 注册成原生 DSH 路由：这条路不经过 llm-pi-ai 的 replay 投影。但跨 provi | 结构性成立/行为未测 |
| [#1144](https://github.com/deepseek-ai/deepseek-harness/discussions/1144) | 1 | [Feature]: 支持插件在注册期声明 settings 命名空间暴露（落地 202 | 插件自建配置面（客户端 slot + ctx.webServer.register 自有路由），dsh-work-x 的 Web MCP 管理页/Setting | 1 |
| [#1127](https://github.com/deepseek-ai/deepseek-harness/discussions/1127) | 1 | Fix: classify 401/403 bodies by semantics (c | Pi provider 包自带传输的路由不经过 llm-pi-ai 的 classifyPiAiError，供应商原始报错不会被 AUTH 投影覆盖 | 结构性成立/行为未测 |
| [#1015](https://github.com/deepseek-ai/deepseek-harness/discussions/1015) | 1 | 建议:补充分层 .env 与 mcp-client 环境变量语义的用户文档 | pi-mcp-adapter：MCP 服务器的连接配置与凭证由它自己的管理面维护（不依赖 host 启动期 env 求值），支持 stdio/Streamabl | 1 |
| [#997](https://github.com/deepseek-ai/deepseek-harness/discussions/997) | 1 | [Bug Report] Windows 沙箱 shell 无法建立任何 TLS/HTT | 他自己提的方案 A（宿主进程代抓取）已经有现成件：@juicesharp/rpiv-web-tools 的 web_fetch 由宿主进程发起 HTTP(S)  | 2 |
| [#984](https://github.com/deepseek-ai/deepseek-harness/discussions/984) | 1 | dsh-type-meta is missing from npm, blocking  | 换一条完全不依赖 @deepseek-ai SDK 包链的插件开发路径：按 Pi Host ABI 写扩展、发成普通 npm 包，用户 `dsh plugin  | 1 |
| [#978](https://github.com/deepseek-ai/deepseek-harness/discussions/978) | 1 | [headless] TRANSPORT: DeepSeek API stream fa | 改用自带传输的 Pi provider 包经 pi2dsh 注册成 DSH 原生路由——请求不经过 dsh-llm-deepseek 那条流，结构上是另一条链路 | 结构性成立/行为未测 |
| [#976](https://github.com/deepseek-ai/deepseek-harness/discussions/976) | 1 | 「bug？」一遇到中文路径就反复出错 | 把要读写的目录挂成 filesystem MCP server（独立进程、自己按 UTF-8 处理路径），模型走 MCP 工具而不是原生 fs 工具 | 结构性成立/行为未测 |
| [#947](https://github.com/deepseek-ai/deepseek-harness/discussions/947) | 1 | 配置网关的大模型，调用一系列工具就出现api错误：缺少必要参数missing requi | 把这个网关改由自带传输的 Pi provider 包注册成 DSH 原生路由，或用官方 llm-pi-ai 配上 compat 字段（supportsDevel | 结构性成立/行为未测 |
| [#931](https://github.com/deepseek-ai/deepseek-harness/discussions/931) | 1 | bug: v4 flash 模型跑任务，一致报错工具不可调用 | 换一条 provider 路由试：自带传输的 Pi provider 包经 pi2dsh 注册成原生路由，不走官方 adapter 的那段解析 | 结构性成立/行为未测 |
| [#903](https://github.com/deepseek-ai/deepseek-harness/discussions/903) | 1 | Third-party plugins cannot expose Web settin | 不走 DSH settings 命名空间：用客户端 slot 自建配置页 + 插件自有路由（ctx.webServer.register）承载配置读写。dsh- | 1 |
| [#902](https://github.com/deepseek-ai/deepseek-harness/discussions/902) | 1 | [Bug Report] 运行中热重载 cordis.patch.yml 插入 MCP  | 要的结果若是"加一批 MCP server"：改用 pi-mcp-adapter，服务器在插件自带的管理 UI 里增删，不改 profile 组合文件、不触发宿 | 1 |
| [#890](https://github.com/deepseek-ai/deepseek-harness/discussions/890) | 1 | [Bug Report] 子代理会话流式工具调用丢失 name/callId（`unkn | 若目标只是"子代理工具调用能用"：把模型路由改走带自带传输的 Pi provider 包（经 pi2dsh 注册为原生 DSH 路由），请求与流式装配不经过 d | 结构性成立/行为未测 |
| [#887](https://github.com/deepseek-ai/deepseek-harness/discussions/887) | 1 | 子代理会话的流式工具调用丢失 name 与 callId，执行报 unknown too | 两条并行路：① 模型路由改走 Pi provider 包自带传输（不经过那段累加器，结构性成立/行为未测）；② 子代理换用 @tintinweb/pi-suba | 结构性成立/行为未测 |
| [#805](https://github.com/deepseek-ai/deepseek-harness/discussions/805) | 1 | Web GUI: tool call arguments uniformly overw | 不走官方 llm-pi-ai 那条解析路：用自带传输的 Pi provider 包经 pi2dsh 注册成原生 DSH 路由，请求/响应由包自己的传输处理，不经 | 结构性成立/行为未测 |
| [#780](https://github.com/deepseek-ai/deepseek-harness/discussions/780) | 1 | feat(llm-pi-ai): expose OpenAI-completions c | 换一条路由：经 pi2dsh 装带自身传输的 Pi provider 包，路由的 compat 字段（supportsDeveloperRole 等三项）是真上 | 1 |
| [#741](https://github.com/deepseek-ai/deepseek-harness/discussions/741) | 1 | Error: unknown tool | 换一条路由试试：经 pi2dsh 装带自身传输的 Pi provider 包时，流式事件由包自己的累加器处理再转成 DSH chunk，结构上不经过 dsh-l | 结构性成立/行为未测 |
| [#740](https://github.com/deepseek-ai/deepseek-harness/discussions/740) | 1 | `llm.discoverModels` always fails: "no model | 要的结果是‘看到并选到这个 provider 的模型’：经 pi2dsh 装带自身传输的 Pi provider 包，包的动态目录直接成为 DSH 原生 llm | 1 |
| [#719](https://github.com/deepseek-ai/deepseek-harness/discussions/719) | 1 | LLM 流式：deepseek 适配器超时残留分片、llm-retry 幽灵重试占用重试 | 问题 1 只发生在 dsh-llm-deepseek 那段流循环里：改用自带传输的 Pi provider 包（如 pi-provider-alibaba）经  | 结构性成立/行为未测 |
| [#676](https://github.com/deepseek-ai/deepseek-harness/discussions/676) | 1 | [bug] Subagent catalog entries are never rec | 不使用 DSH 原生 subagent 目录的话不碰这条路径：@tintinweb/pi-subagents 经 pi2dsh 自带交互式管理面，子代理列表由它 | 1 |
| [#666](https://github.com/deepseek-ai/deepseek-harness/discussions/666) | 1 | 本轮运行失败API key is invalid | 改用自带传输的 Pi provider 包注册路由（可自定义 baseUrl/headers，含 User-Agent），请求不经过官方 adapter 的那段 | 结构性成立/行为未测 |
| [#618](https://github.com/deepseek-ai/deepseek-harness/discussions/618) | 1 | [bug] MCP list_changed 重同步撞上 namespace 抢占会清空 | 同一批 MCP server 改由 pi-mcp-adapter 经 pi2dsh 承接，工具注册不走官方 dsh-mcp-client 的 dispose-t | 1 |
| [#597](https://github.com/deepseek-ai/deepseek-harness/discussions/597) | 1 | ACP: support session-scoped stdio and Stream | 若他只是要那些 MCP server 在 DSH 里可用：pi-mcp-adapter 经 pi2dsh 可接 stdio/Streamable HTTP/SS | 1 |
| [#590](https://github.com/deepseek-ai/deepseek-harness/discussions/590) | 1 | 等待子代理结果时，主会话应该显示等待中状态，而不是显示为任务已完成状态 | 改用 @tintinweb/pi-subagents 那条路：子代理是真 DSH 子会话，父侧可 wait-for-result 真等待、有完成通知与交互式管理 | 1 |
| [#584](https://github.com/deepseek-ai/deepseek-harness/discussions/584) | 1 | [bug] scrubbedParentEnv 子串误伤 KEYBOARD/MONKEY | 若受影响的只是 MCP stdio server 的环境变量：pi-mcp-adapter 自带 stdio 传输，不经过 DSH 的 scrubbedPare | 结构性成立/行为未测 |
| [#545](https://github.com/deepseek-ai/deepseek-harness/discussions/545) | 1 | 工具调用文本化 | 换成自带传输的 Pi provider 包做路由：这条路不经过官方 adapter 的那段累加器，值得一试 | 结构性成立/行为未测 |
| [#524](https://github.com/deepseek-ai/deepseek-harness/discussions/524) | 1 | Provider-neutral ToolSearch: source-backed A | 若他的真实痛点是几十个 MCP server 撑爆上下文：pi-mcp-adapter 的 lazy proxy 已经端到端实测过——server 不全量进上下 | 1 |
| [#502](https://github.com/deepseek-ai/deepseek-harness/discussions/502) | 1 | Third-party settings namespaces never appear | 把配置面建在插件自己身上而不是 DSH 的 settings 面：pi2dsh 上的 Pi 包用 ui.custom 全屏管理面 + 自带斜杠命令 + 自有 w | 1 |
| [#494](https://github.com/deepseek-ai/deepseek-harness/discussions/494) | 1 | 会话统计条被截断时省略号会切在半截数字中间 | 把自己关心的统计放进独立状态条：pi2dsh + pi-powerline-footer 在 widget dock 里渲染自定义状态行（状态条本身端到端实测过 | 1 |
| [#478](https://github.com/deepseek-ai/deepseek-harness/discussions/478) | 1 | [bug] Subagent sessions orphaned by a force- | 子代理改走 pi-subagents 运行时：每个子代理是真 DSH 会话，自带交互式管理器、完成通知、停止后保持停止、跨重启重开，状态呈现不经 DSH 原生子 | 1 |
| [#422](https://github.com/deepseek-ai/deepseek-harness/discussions/422) | 1 | [Bug] 多个子任务结束后主任务返回 HTTP 400 / HTTP 400 afte | 改用 @tintinweb/pi-subagents（经 pi2dsh）派生子代理：子会话是独立的真 DSH 会话，结果以工具结果回主线，结构上不经过原生子代理 | 结构性成立/行为未测 |
| [#366](https://github.com/deepseek-ai/deepseek-harness/discussions/366) | 1 | 能不能自动切换flash和pro啊，claude都是自动选择的 | 用 @tintinweb/pi-subagents（等级一实测）把重活派给指定 pro 模型的子代理、轻活留在 flash 主线——不是自动切换，但能做到「贵模 | 1 |
| [#247](https://github.com/deepseek-ai/deepseek-harness/discussions/247) | 1 | Proposal: bound MCP connection and tool disc | 改用 pi-mcp-adapter 经 pi2dsh 接 MCP：它有自己的连接监督与 lazy proxy，服务端按需连接，不响应的 server 不会卡住插 | 1 |
| [#231](https://github.com/deepseek-ai/deepseek-harness/discussions/231) | 1 | Bug: Web UI multi-turn sessions drop reasoni | 改用自带传输的 Pi provider 包经 pi2dsh 路由：请求由包自己的 provider.stream 发出、再经 piEventsToDshChun | 结构性成立/行为未测 |
| [#199](https://github.com/deepseek-ai/deepseek-harness/discussions/199) | 1 | Bug: vLLM self-hosted deployments stream thi | 用自带传输的 Pi provider 包经 pi2dsh 注册成 DSH 路由：报文由该包自己的解析器处理，完全不经过 dsh-llm-deepseek 的 t | 结构性成立/行为未测 |
| [#198](https://github.com/deepseek-ai/deepseek-harness/discussions/198) | 1 | win(WSL)-ssh隧道访问，web部分设置按钮无响应 | 不用那个表单也能加供应方：官方 settings.yaml 的 llm-pi-ai 段直接配 OpenAI 兼容网关；或装 pi2dsh + 一个自带传输的 P | 1 |
| [#109](https://github.com/deepseek-ai/deepseek-harness/discussions/109) | 1 | 建议：为 Ralph 增加可选、有界的失败接续（failure successor） | @tintinweb/pi-subagents 能让模型自己驱动多轮 fresh child 编排（spawn / wait-for-result / mid- | 1 |
| [#97](https://github.com/deepseek-ai/deepseek-harness/discussions/97) | 1 | 遇到dsh里吐出重复字符问题 | 改用 Pi provider 包自带传输的路由（经 pi2dsh 注册成原生 DSH llm 路由），结构上不经过 dsh-llm-deepseek 的那段累加 | 结构性成立/行为未测 |
| [#80](https://github.com/deepseek-ai/deepseek-harness/discussions/80) | 1 | Flash模型的<think>块显示异常 | 改走 Pi provider 包自带传输的路由：pi2dsh 的路由 adapter 包住 provider.stream 再经 piEventsToDshCh | 结构性成立/行为未测 |