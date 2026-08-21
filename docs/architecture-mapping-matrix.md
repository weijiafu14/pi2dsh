# Pi → DSH 架构模型

这是可扩展的 Markdown 知识树，不是接口总表，也不是 `Pi × DSH` 的机械矩阵。每个稳定
标题代表一条架构分支；接口、模块和 seam 是可以继续增长的叶子。

当前盘点快照：**2026-08-20，Pi 0.84.1，DSH 0.1.0-rc.8**。最初从 Pi 声明和运行时
规则中盘到 111 条上游形状规则，从 DSH 官方 subsystem 索引中看到 45 个模块。111 尚未
把所有嵌套对象拆成 callable，45 也不包含以后发现的全部 service、waterfall、event 和
client seam；两个数字都不表示“已经完整”。

## Pi 能力树

### 工具与执行

<a id="pi-tools-registry"></a>
#### 工具注册与可见性

- 当前接口叶子：`registerTool`、`getActiveTools`、`getAllTools`、`setActiveTools`；
  `unregisterTool` 是桥扩展，不计入上游快照。
- 理论对应：[DSH / 工具、执行与隔离](#dsh-execution)。
- 需要的公开 seam：`ctx.tools` 注册表与按 Agent 控制可见性。
- 理论判断：直接承接。

<a id="pi-tools-boundaries"></a>
#### 工具执行边界

- 当前接口叶子：`tool_execution_start`、`tool_execution_end`。
- 理论对应：[DSH / 工具、执行与隔离](#dsh-execution)与
  [DSH / 会话与持久化](#dsh-session)。
- 需要的公开 seam：工具执行生命周期与可持久化工具事件。
- 理论判断：组合承接。

<a id="pi-tools-update"></a>
#### 工具部分结果更新

- 当前接口叶子：`tool_execution_update`。
- 理论对应：[DSH / 工具、执行与隔离](#dsh-execution)与
  [DSH / 会话与持久化](#dsh-session)。
- 需要的公开 seam：对原生与迁移工具都生效的 partial-result 通道。
- 理论判断：尚待确认公开 seam 是否完整。

<a id="pi-tools-policy"></a>
#### 工具调用与结果策略

- 当前接口叶子：`tool_call`、`tool_result`。
- 理论对应：[DSH / 工具、执行与隔离](#dsh-execution)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：执行前参数策略与结果提交前策略。
- 理论判断：组合承接。

<a id="pi-tools-process"></a>
#### 进程执行

- 当前接口叶子：`exec`、`user_bash`。
- 理论对应：[DSH / 工具、执行与隔离](#dsh-execution)。
- 需要的公开 seam：`ctx.exec`、subprocess provider。
- 理论判断：直接承接。

### 命令与输入

<a id="pi-commands-registry"></a>
#### 命令注册

- 当前接口叶子：`registerCommand`、`getCommands`。
- 理论对应：[DSH / 命令与人机交互](#dsh-interaction)。
- 需要的公开 seam：`ctx.commands`。
- 理论判断：直接承接。

<a id="pi-commands-controls"></a>
#### Flag 与快捷键

- 当前接口叶子：`registerShortcut`、`registerFlag`、`getFlag`。
- 理论对应：[DSH / 命令与人机交互](#dsh-interaction)与
  [DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：命令描述符与客户端输入绑定。
- 理论判断：组合承接。

<a id="pi-input-preprocess"></a>
#### 用户输入预处理

- 当前接口叶子：`input` 事件。
- 理论对应：[DSH / 插件组合](#dsh-composition)与
  [DSH / 会话与持久化](#dsh-session)。
- 需要的公开 seam：用户输入成为持久 step 前的 `agent/pre-step`。
- 理论判断：直接承接；当前桥接仍待完成。

### 消息与 Agent

<a id="pi-messages-injection"></a>
#### 消息注入

- 当前接口叶子：`sendMessage`、`sendUserMessage`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：`agent/pre-step` 与原生 session message append。
- 理论判断：组合承接。

<a id="pi-messages-stream"></a>
#### 消息流事件

- 当前接口叶子：`message_start`、`message_update`、`message_end`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 模型运行时](#dsh-model-runtime)。
- 需要的公开 seam：LLM stream、提交前与持久化后的消息生命周期。
- 理论判断：组合承接；`message_end` replacement 仍待验证。

<a id="pi-context-transform"></a>
#### 模型上下文变换

- 当前接口叶子：`context`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：权威模型请求发出前的 context projection。
- 理论判断：组合承接。

<a id="pi-agent-lifecycle"></a>
#### Agent 与轮次生命周期

- 当前接口叶子：`before_agent_start`、`agent_start`、`agent_settled`、`agent_end`、
  `turn_start`、`turn_end`。
- 理论对应：[DSH / 插件组合](#dsh-composition)与
  [DSH / 会话与持久化](#dsh-session)。
- 需要的公开 seam：Agent waterfalls 与持久 turn/step 事件。
- 理论判断：组合承接。

<a id="pi-extension-instance-scope"></a>
#### 扩展实例作用域（每会话一份）

- 当前接口叶子：`ExtensionFactory` 每 session 实例化一次；`session_start` 异步
  handlers 在第一轮前完成；session 结束时实例随之销毁。
- 理论对应：[DSH / 插件组合](#dsh-composition)与
  [DSH / Agent 编排](#dsh-orchestration)。
- 需要的公开 seam：`agent/created`（每条发布路径必触发、loop 启动前）、
  `agent.ctx`（公开契约：注册 agent-local、dispose 自动 unwind）、
  `system-prompt/assemble` 与 `tools/pre-execute` awaited waterfalls
  （首轮就绪门；`assembly.tools` 在 waterfall 前快照，门内用官方
  `tools.schemas(agent)` 补齐）。
- 理论判断：组合承接。Pi 的保证是"第一轮前就绪"而非"发布前就绪"，
  所以发布后挂载 + awaited 门恰好等价；已在 stock rc.8 npm 包上实证
  （tests/agent-scoped-mount.spec.ts + scripts/verify-tui-singlepath-e2e.mjs）。
  注：DSH 的发布前组合 seam（`setup(agentCtx)`）是创建者独占参数、root
  插件不可达且 config 声明式 Agent 不经过——对生态插件这是真实缺口，正解
  形状是 AgentRegistry 级的 serial `agent/setup` contributor（留作上游提案，
  非本桥依赖）。

<a id="pi-agent-control"></a>
#### Agent 控制与空闲状态

- 当前接口叶子：`isIdle`、`hasPendingMessages`、`waitForIdle`、`abort`、`signal`。
- 理论对应：[DSH / 插件组合](#dsh-composition)与
  [DSH / Agent 编排](#dsh-orchestration)。
- 需要的公开 seam：队列、取消信号与 Agent 生命周期。
- 理论判断：组合承接。

<a id="pi-prompt-usage"></a>
#### 上下文用量检查

- 当前接口叶子：`getContextUsage`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)与
  [DSH / 会话与持久化](#dsh-session)。
- 需要的公开 seam：token-meter、模型窗口与 session projection。
- 理论判断：组合承接；当前桥接仍待完成。

<a id="pi-prompt-system"></a>
#### 系统提示词检查

- 当前接口叶子：`getSystemPrompt`、`getSystemPromptOptions`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)。
- 需要的公开 seam：`system-prompt/assemble` 与当前提示词投影。
- 理论判断：组合承接。

### 会话

<a id="pi-session-custom-facts"></a>
#### 自定义持久事实

- 当前接口叶子：`appendEntry`、`setLabel`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 客户端与 Web](#dsh-client)。
- 理论需要：namespaced durable session fact，能安全恢复、分支、压缩和回放。
- 当前公开 seam：没有完整入口；仓外插件不能安全注册并追加自定义持久事件。
- 理论判断：缺公开 seam。

<a id="pi-session-naming"></a>
#### 会话命名

- 当前接口叶子：`setSessionName`、`getSessionName`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：原生 session title 状态与客户端投影。
- 理论判断：直接承接。

<a id="pi-session-lifecycle"></a>
#### 会话生命周期

- 当前接口叶子：`session_start`、`session_shutdown`、`session_info_changed`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：会话生命周期事实与插件 disposal。
- 理论判断：组合承接。

<a id="pi-session-operations"></a>
#### 会话创建、分支与导航操作

- 当前接口叶子：`newSession`、`fork`、`navigateTree`、`switchSession`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / Agent 编排](#dsh-orchestration)。
- 需要的公开 seam：`ctx.sessions` create/fork/navigation。
- 理论判断：组合承接。

<a id="pi-session-navigation-events"></a>
#### 会话导航策略与事件

- 当前接口叶子：`session_before_switch`、`session_before_fork`、
  `session_before_tree`、`session_tree`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：宿主所有入口共用的 session navigation pre/post 生命周期。
- 理论判断：组合承接；宿主 UI 发起的操作仍待桥接验证。

<a id="pi-session-compaction-operation"></a>
#### 会话压缩操作与结果

- 当前接口叶子：`compact`、`session_compact`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)。
- 需要的公开 seam：compaction operation 与持久完成事件。
- 理论判断：直接承接。

<a id="pi-session-compaction-policy"></a>
#### 压缩前决策

- 当前接口叶子：`session_before_compact`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 插件组合](#dsh-composition)。
- 理论需要：压缩执行前可取消或替换摘要的 waterfall。
- 当前公开 seam：只有压缩发生后的事实事件，没有完整的事前决策入口。
- 理论判断：缺公开 seam。

<a id="pi-session-host-context"></a>
#### 会话宿主上下文与重载

- 当前接口叶子：`sessionManager`、`cwd`、`mode`、`shutdown`、`reload`。
- 理论对应：[DSH / 会话与持久化](#dsh-session)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：session service、workspace scope 与 Cordis reload。
- 理论判断：组合承接。

### 模型

<a id="pi-model-provider-registration"></a>
#### Provider 注册

- 当前接口叶子：`createProvider`、`envApiKeyAuth`、各协议的 lazy API factory、
  `registerProvider`、`unregisterProvider`、动态 `refreshModels`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：`llm.registerAdapter`、configurable provider schema、credentials、settings。
- 理论判断：组合承接。带 transport 的 provider 保留自己的协议 factory，经
  `llm.registerAdapter` 成为原生路由；首次使用动态目录里尚未出现在启动快照的模型时，
  中间层必须等待并合并 provider 的 catalog refresh，再把完整 Pi Model 交给 transport。
  只声明目录的 provider 仍翻译给官方 configurable-provider schema，不能借动态刷新之名
  偷建第二条传输。

<a id="pi-model-registry"></a>
#### 模型目录视图

- 当前接口叶子：`model`、`scopedModels`、`modelRegistry`、`hasConfiguredAuth`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)。
- 需要的公开 seam：DSH 权威模型目录与凭证可用性。
- 理论判断：直接承接。

<a id="pi-model-designated-call"></a>
#### 目录模型的指定调用

- 当前接口叶子：`modelRegistry.complete`、`modelRegistry.getProvider()`、
  `Provider.stream`、`Provider.streamSimple`、`getApiKeyAndHeaders`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)与
  [DSH / 资源与附件](#dsh-resources)。
- 需要的公开 seam：`llm.stream`、credentials、attachments，以及 Pi 内联图片与 DSH
  attachment ref 的双向转换。
- 理论判断：组合承接。模型能在目录里被找到，只证明“可发现”；只有指定调用真的带着
  文本、图片、凭证和取消信号到达该 route，才证明“可调用”。

<a id="pi-model-selection"></a>
#### 模型与推理档位选择

- 当前接口叶子：`setModel`、`getThinkingLevel`、`setThinkingLevel`、`thinkingLevel`、
  `model_select`、`thinking_level_select`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)与
  [DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：权威模型目录与 request-level reasoning options。
- 理论判断：组合承接。

<a id="pi-model-wire"></a>
#### Provider 网络请求生命周期

- 当前接口叶子：`before_provider_request`、`before_provider_headers`、
  `after_provider_response`。
- 理论对应：[DSH / 模型运行时](#dsh-model-runtime)与
  [DSH / 插件组合](#dsh-composition)。
- 理论需要：已有 adapter 最终 request/response 周围的 transport middleware。
- 当前公开 seam：插件拥有整条 transport 时，Pi 标准 stream helper 的 `onPayload` 可把
  最终请求体交给 pi2dsh waterfall，再由 DSH `llm.registerAdapter` 承载；增强 DSH 原生
  adapter 时没有通用入口。
- 理论判断：分支承接。package-owned transport 的 `before_provider_request` 可做可靠翻译；
  `before_provider_headers`、`after_provider_response` 以及 DSH-native transport 的同类增强
  仍缺公开 seam，不能伪装成已经支持。

### UI 与宿主呈现

<a id="pi-ui-questions"></a>
#### 阻塞式用户提问

- 当前接口叶子：`select`、`confirm`、UI `input`、`editor`、`custom`。
- 理论对应：[DSH / 命令与人机交互](#dsh-interaction)与
  [DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：`ctx.userQuestions` 与原生客户端渲染。
- 理论判断：组合承接。

<a id="pi-ui-notifications"></a>
#### 通知与工作状态

- 当前接口叶子：`notify`、`setStatus`、`setWidget`、`setWorkingMessage`、
  `setWorkingVisible`、`setWorkingIndicator`、`setHiddenThinkingLabel`。
- 理论对应：[DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：client module 与 shell slots。
- 理论判断：组合承接。

<a id="pi-ui-chrome"></a>
#### 宿主框架与工具展开状态

- 当前接口叶子：`setFooter`、`setHeader`、`setTitle`、`getToolsExpanded`、
  `setToolsExpanded`。
- 理论对应：[DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：client slot registry 与宿主持有的呈现状态。
- 理论判断：组合承接。

<a id="pi-ui-editor"></a>
#### 编辑器交互

- 当前接口叶子：`onTerminalInput`、`pasteToEditor`、`setEditorText`、`getEditorText`、
  `addAutocompleteProvider`、`setEditorComponent`、`getEditorComponent`。
- 理论对应：[DSH / 客户端与 Web](#dsh-client)与
  [DSH / 命令与人机交互](#dsh-interaction)。
- 需要的公开 seam：client editor slots 与 command/input bridge。
- 理论判断：宿主语义翻译。

<a id="pi-ui-rendering"></a>
#### 消息渲染与主题

- 当前接口叶子：`registerMessageRenderer`、`registerEntryRenderer`、
  `registerMarkdownTransformer`、`hasUI`、`theme`、`getAllThemes`、`getTheme`、`setTheme`。
- 理论对应：[DSH / 客户端与 Web](#dsh-client)。
- 需要的公开 seam：Web-native client modules 与 slots。
- 理论判断：宿主语义翻译；便携呈现意图与 Pi 终端组件仍需继续拆分。

### 项目环境与资源

<a id="pi-project-trust"></a>
#### 项目信任

- 当前接口叶子：`isProjectTrusted`、`project_trust`。
- 理论对应：[DSH / 插件组合](#dsh-composition)与
  [DSH / 工作区资源](#dsh-resources)。
- 理论需要：早于项目资源加载的宿主持有 trust policy。
- 当前公开 seam：普通仓外插件挂载得太晚。
- 理论判断：缺公开 seam。

<a id="pi-resources-discovery"></a>
#### 动态资源发现

- 当前接口叶子：`resources_discover`。
- 理论对应：[DSH / 工作区资源](#dsh-resources)与
  [DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：具有生命周期的 skill/MCP/resource providers。
- 理论判断：组合承接；当前桥接仍待完成。

<a id="pi-events-bus"></a>
#### 包内事件总线

- 当前接口叶子：`events`。
- 理论对应：[DSH / 插件组合](#dsh-composition)。
- 需要的公开 seam：随插件 fiber 销毁的 package-scoped event bus。
- 理论判断：直接承接。

### 当前尚未归类 / 待继续审计

- `sessionManager`、`modelRegistry` 等嵌套对象尚需继续拆 callable；
- 动态注册、不同 Pi 版本及插件私下依赖的运行时约定继续按真实消费者补充；
- 新发现的能力如果不能合理放入上述分支，先调整树，不强塞进旧分类。

## DSH 的工作机制，用人话说

DSH 像一块运行中还能换件的 Agent 主板：profile 是装机单，service definition 是插座，
provider 是可以替换的零件，agent 是发动机，session log 是飞行记录仪，waterfall 是决定
真正落地前的检查站，client module/slot 是浏览器半边；Cordis fiber/effect 负责依赖、
启停和拆卸清理。

它的核心目的不是把所有能力写死在 Agent 里，而是让模型、工具、存储、执行器、资源、
交互和客户端都能按公开 seam 组合；已经发生的事实进入持久日志，尚未决定的策略通过
provider 或 waterfall 参与。DSH 官方引用的 Cordis 论文
[_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)
解释运行时替换、清理、重绑和回滚；相关的 harness 研究索引
[_Agent Systems with Harness Engineering_](https://github.com/RUCAIBox/awesome-agent-harness)
解释模型之外为什么还需要循环、工具、记忆、workspace、skills、多 Agent、安全和评估。

## DSH 承载机制树

<a id="dsh-composition"></a>
### 插件组合与策略

- 当前模块叶子：`core`、`extensions`、`settings`、`scope`、`invariants`、
  `permission-presets`。
- 当前公开 seam：Cordis service/provider、`ctx.effect`、`ctx.inject`、waterfall、
  scope/isolate/intercept。
- 负责：插件依赖、启停清理、策略组合、配置与权限。引擎拥有的 host 级 service
  不能以“发现到社区插件”为生存条件：零个 Pi 包时也要挂 provider 目录、`/login`、
  凭证恢复等宿主能力；发现清单只决定包级 extension 是否挂载。

<a id="dsh-session"></a>
### 会话与持久化

- 当前模块叶子：`compaction`、`persistence`、`session-projection`、`session-query`、
  `session-reference`、`session-telemetry`、`session-title`、`session`、`spill`、`storage`。
- 当前公开 seam：`ctx.sessions`、`Session.append`、durable session events、compaction、
  session projection；rc.8 的 LLM 完成包可携带 `ReplayEnvelope`，被取消的部分 assistant
  输出可用 `assistant/message.interrupted` 留作持久事实。
- 负责：权威会话事实、恢复、分支、压缩、查询和展示投影。物理存储格式不是逻辑事件
  ABI：选择 SQLite persistence 时 rc.8 schema 17 与旧库不兼容，属于 provider 迁移边界，
  不改变默认 session log 的理论映射。

<a id="dsh-model-runtime"></a>
### 模型运行时

- 当前模块叶子：`credentials`、`llm-streaming`、`token-meter`、`system-prompt`。
- 当前公开 seam：`llm.registerAdapter`、`llm/stream`、credentials provider、
  `system-prompt/assemble`、`agent/request`；rc.8 的官方 `llm-pi-ai` profile 可声明模型
  输入模态、推理档位，以及按协议开放的 provider compat。
- 负责：模型目录、路由、凭证、调用、token 与提示词装配。配置型 Pi provider 应翻译
  到官方 profile；只有插件自带 transport 时才注册 adapter。catalog 厂商专属 compat
  仍由其已安装目录掌管，不能当通用网关开关透传。

<a id="dsh-execution"></a>
### 工具、执行与隔离

- 当前模块叶子：`approval`、`code-runtime`、`filesystem`、`sandbox`、`shell`、
  `subprocess`、`terminal`、`tools`。
- 当前公开 seam：`ctx.tools`、`ctx.exec`、subprocess provider、sandbox provider、
  approval policy。
- 负责：工具目录、执行、权限与隔离；插件直接调用 Node 不自动继承这些能力。

<a id="dsh-resources"></a>
### 工作区资源

- 当前模块叶子：`attachment`、`skills`、`web`、`workspace`、`lsp`。
- 当前公开 seam：attachment/skill/web/workspace/LSP providers。
- 负责：项目输入、技能、联网资源、工作区与语言服务。

<a id="dsh-orchestration"></a>
### Agent 编排

- 当前模块叶子：`goal`、`jobs`、`plan`、`schedule`、`subagent`、`workflow`。
- 当前公开 seam：`ctx.agents`、subagent provider、goal/plan/jobs/workflow providers。
- 负责：Agent 创建、任务分解、计划、后台工作与工作流。

<a id="dsh-interaction"></a>
### 命令与人机交互

- 当前模块叶子：`commands`、`feedback`、`user-questions`。
- 当前公开 seam：`ctx.commands`、`ctx.userQuestions`、feedback provider。rc.8 的命令
  执行 ABI 是 `execute(agent, line, images, signal)`；命令可以声明接收图片，handler 从
  attachments 读取，而不是把取消信号错当图片数组。
- 负责：文本/图片命令入口、阻塞提问和用户反馈。

<a id="dsh-client"></a>
### 客户端与 Web

- 当前模块叶子：`client-modules`、`typert`、`web-server`。
- 当前公开 seam：client module、slot registry、web route、typert remote surface，以及
  rc.8 动态 client module graph。
- 负责：浏览器呈现、插件客户端代码和宿主界面扩展。`dsh.client.inject` 声明的是客户
  端**包依赖**，客户端源码导出的 `inject` 才声明 `slots` 等 Cordis 运行时 service；
  `dsh.client.external` 只用于动态模块图中的外部包，不能拿 service 名来填。

### 当前尚未归类 / 待继续审计

- 后续 DSH 版本加入的 subsystem、service、waterfall、event 和 client slot；
- Cordis 卸载、provider replacement、隔离、重绑和失败回滚等生命周期语义；
- 只在源码中出现但尚未证明能被仓外插件调用的入口。

## 怎样继续维护

新增接口或模块时，直接挂到最合适的稳定标题下面；若语义放不进去，调整知识树并说明
原因。理论模型只说“应该由谁承载、需要什么公开 seam”，不在这里声称真实插件已经
跑通；实践证据统一进入 [`plugin-validation-matrix.md`](plugin-validation-matrix.md)。
