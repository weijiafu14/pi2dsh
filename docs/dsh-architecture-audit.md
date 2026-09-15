# DSH 架构检验：证据附录

本页保存 [`architecture-mapping-standard.md`](architecture-mapping-standard.md) 与
[`dsh-architecture-conformance.md`](dsh-architecture-conformance.md) 的历史复现、边界说明和
Cordis 生命周期待测项。当前接口归属与理论映射见
[`architecture-mapping-matrix.md`](architecture-mapping-matrix.md)，插件实证见
[`plugin-validation-matrix.md`](plugin-validation-matrix.md)；本页用于复核，不另建分类。

当前基线：2026-08-20，pi2dsh 0.13.x、Pi 0.84.1、DSH 0.1.0-rc.8。

## 当前调查的三个快照边界

| 完整性边界 | 当前事实 | 不能扩大成什么 |
|---|---|---|
| Pi 公共 ABI | 当前扫描到 111 条上游形状规则；另有 202 个可 import 符号 | 111 不是固定总量，也不是把嵌套对象每个 callable 都拆开的语义全覆盖 |
| DSH 官方子系统 | 当时官方索引观察到 45 个 | 45 不是固定总量；Pi 插件能运行也不等于这些模块都被验证 |
| Cordis 生命周期 | 已覆盖部分注册清理和包内 reload | 不能据此声称依赖重绑、隔离和失败回滚都成立 |

111 条上游规则由 25 个非事件 API、33 个事件、24 个非 UI context、28 个 UI 面和
单列的 `modelRegistry.hasConfiguredAuth` 组成。桥保留的 `unregisterTool` 不是 Pi 0.84.1
公共 API，不计入分母。具体逐项矩阵见 [`capabilities/`](capabilities/README.md) 和
[`pi-abi-coverage.md`](pi-abi-coverage.md)。

## rc.8 升级对架构映射的影响

| 变化 | 兼容性质 | pi2dsh 的处理 |
|---|---|---|
| `CommandRuntime.execute(agent, line, images, signal)` | 调用 ABI 不兼容；第三参从 signal 前插入图片数组 | 所有低层调用显式传 `[]`；命令附件成为 DSH 交互分支的正式 seam |
| `llm-pi-ai` profile 增加 input、`reasoningEfforts`、协议 compat | 新公开能力 | catalog-only Pi provider 逐字段翻译到官方 adapter；`DSH-ARCH-002` 关闭 |
| LLM finish 可带 `ReplayEnvelope`，取消后的部分回答可记 interrupted | 加法能力 | 当前桥不伪造 replay state；把它记入会话/持久化分支，等真实 Pi 消费者再验证 |
| client dynamic module graph；manifest `dsh.client.inject` 表示包依赖 | 声明语义收紧 | 清掉把 `slots` 当包名的旧声明；Cordis service 仍由客户端源码 `inject` 声明 |
| SQLite persistence schema 17 | 选择该 provider 时的数据格式不兼容 | 默认组合不受影响；把物理存储迁移与逻辑 session ABI 分开记录，不替用户迁库 |

这张表只回答“新版本改变了哪条既有映射”。新增叶子仍归入上面的架构模型，真实插件
结果仍归入验证矩阵，不另建一套 rc.8 分类。

## DSH 模块完整性

当前已知 subsystem 到承载机制的归属，以及每个机制对仓外插件开放的 seam，维护在
[`architecture-mapping-matrix.md`](architecture-mapping-matrix.md)。它是可以继续追加和
拆分的 Markdown 架构树，不靠固定 45 个模块或生成器证明完整。本页不再维护另一张
“明确落点 / 随链经过”平行表，避免模块覆盖状态与插件验证矩阵发生漂移。

仍需记住的边界是：pi-btw 使用 `ctx.agents` 不等于验证 `subagent` provider；Pi 插件自己
联网不等于验证 DSH `web`；Pi 工具直接调用 Node 不自动继承 DSH sandbox；插件自己保存
goal/plan/job 也不等于验证 DSH 的同名 subsystem。这些结论应作为具体映射或验证记录，
不能重新长成一套平行分类。

## 当前四个缺口与一个已修复历史缺口的证据

### DSH-ARCH-001：仓外自定义持久事件

- **Pi 消费面**：`appendEntry(customType, data)`、自定义 renderer、label 和部分分支信息。
- **卡点**：未知事件需要 `ignorable: true` 才能安全前向读取，但仓外插件不能通过公开
  `Session.append()` 设置它，也没有运行时 `registerEventType()`。
- **当前旁路**（2026-08-24 起新形态）：per-session **Pi 格式档案文件**（真 Pi
  header 行 + Pi entry 行，Pi 自家 `SessionManager` 可直接解析；对话正文不复制，
  始终活投影自原生日志）。此前的私有 JSON 记录格式已废弃（读兼容保留）。
  消费者需求因此在桥内就地满足；本缺口的意义从"必需"降为"终局单源"——
  条目进原生日志后档案文件退化为纯存在位（Pi 的 existsSync 契约仍需真 inode）。
- **最小上游能力**：开放 ignorable append，或提供有命名空间的事件类型注册。
  提案已发出并带真机实验：[DSH Discussion #2708](https://github.com/deepseek-ai/deepseek-harness/discussions/2708)；内部底稿存 [`community/upstream-proposal-plugin-session-entries.md`](../community/upstream-proposal-plugin-session-entries.md)。
- **证据**：[`verify-out-of-repo-event-type.mjs`](../scripts/verify-out-of-repo-event-type.mjs)、
  [DSH Discussion #2708](https://github.com/deepseek-ai/deepseek-harness/discussions/2708)。
- **0.1.1-rc.2 源码复核（2026-08-22）**：seam 仍缺，且三处坐标钉死——
  ① 读取门禁是**生成的封闭清单** `packages/core/session/src/known-event-types.ts`
  （`KNOWN_SESSION_EVENT_TYPES`，由 `gen-persistence-catalog` 从仓内
  `SessionEventMap` 声明生成），清单外且不带 `ignorable` 的类型让**任何 build
  （包括写入者自己）拒载整个会话**；② `Session.append()` 的活跃写入路径仍无
  `ignorable` 口子（该信封字段只在 seed 导入校验中被接受）；③ 官方在该文件
  注释中明示：“Downstream (out-of-repo) plugin events are outside this list by
  construction; **a registration surface for them is deferred until such a
  consumer exists**” —— pi2dsh（承载 pi-btw 等一切 appendEntry 消费者）就是
  那个 consumer，上游提案时机已到。注意：`SessionEventMap` 的
  declaration-merge 可扩展性只服务**仓内**插件（生成清单收录它们），不构成
  仓外通道；据此 sidecar 旁路与本缺口分级维持不变。
- **0.1.2-alpha.1 跟进（2026-08-29）**：alpha 的官方笔记把该缺口显式化为
  fail-closed（仓外 `SessionEventMap` 成员运行期可写、reload 时
  `SessionFormatUnsupportedError` 拒载整个会话），并明写"until a real
  external-event consumer justifies a registration mechanism"。已发跟进提案
  [DSH Discussion #5011](https://github.com/deepseek-ai/deepseek-harness/discussions/5011)
  （内部底稿 [`community/upstream-proposal-session-event-registration-alpha.md`](../community/upstream-proposal-session-event-registration-alpha.md)），
  附 alpha 真机复现：克隆健康会话工件、追加一条 `pi2dsh/probe`（seq 45）仓外
  事件，web 端点开该会话即得 "contains event type … unknown to this harness;
  refusing to interpret the log" 的用户可见拒载（截图
  `community/seam-evidence/46-arch001-open-clone.png`）。提案形状：namespaced
  注册 + 注册期声明 surface 姿态 + 声明包持有 decoder，保持 fail-closed 语义、
  只把边界从"仓内成员资格"挪到"注册"。
- **0.1.2-alpha.2 跟进（2026-08-31，半采纳）**：上游**回退了 ignorable 信封
  语义的移除**，理由原话 "retained for a repository-external plugin that
  appends its own event types"——指的就是本桥这类消费者，#2708/#5011 的诉求
  被读侧承认。实证（`git show dsh-v0.1.2-alpha.2:packages/core/session/src/index.ts`）：
  ① seed/信封校验重新接受 `ignorable` 键，SQLite schema 19→20 保留该列，
  官方注释明写 "removable only after a replacement supports the current
  third-party plugin"；② **`Session.append()` 的活跃写入路径仍然没有
  ignorable 参数**——写通道还是闭的，缺口分级不变（读侧前向兼容有了，
  仓外事件的合法写入面还没有）。跟进动作：在 #5011 里报读侧回退已见、
  写侧仍缺（等用户拍板后发）。

### DSH-ARCH-002：模型 compat schema 丢字段（rc.8 已修复）

- **Pi 消费面**：`supportsDeveloperRole`、`maxTokensField` 等 model compat。
- **历史卡点**：rc.6 的官方 `llm-pi-ai` 使用 pi-ai，但 settings schema 没有把完整
  compat 传进去。
- **rc.8 结论**：官方 profile 已开放按协议校验的 compat、输入模态和
  `reasoningEfforts`，并明确拒绝 vendor-owned/未知字段。pi2dsh 将 catalog-only Pi
  provider 逐字段翻译到这条官方路径，桥不再需要用“必须自带 transport”绕过该缺口。
- **仍有边界**：`openRouterRouting`、session affinity、grammar/tool-search 等厂商目录
  自有字段不属于通用 profile；任意最终 wire middleware 是另一个问题
  `DSH-ARCH-003`，不能混算成 compat schema 未修。
- **证据**：[`examples/gateway-compat`](../examples/gateway-compat/)、
  [DSH Discussion #3076](https://github.com/deepseek-ai/deepseek-harness/discussions/3076)。

### DSH-ARCH-003：已有 adapter 没有 wire 生命周期 hook

- **Pi 消费面**：`before_provider_headers`、`before_provider_request`、
  `after_provider_response`。
- **卡点**：`llm/stream` 外层看不到 adapter 最终发出的 headers/body 和原始响应。
- **最小上游能力**：adapter transport middleware 或等价的请求/响应 waterfall。
- **证据**：[`capabilities/models.md`](capabilities/models.md)。

### DSH-ARCH-004：压缩前没有决策 waterfall

- **Pi 消费面**：`session_before_compact` 的 cancel/replace。
- **卡点**：`compaction/start` 是决定完成后的持久事实，返回值无法送回 compactor。
- **最小上游能力**：压缩执行前返回继续、取消或替换摘要的 async waterfall。
- **证据**：[`capabilities/sessions.md`](capabilities/sessions.md)。

### DSH-ARCH-006：插件无法声明对另一插件 bundle 的依赖

- **消费面**：套件/发行版形态的 DSH 插件（真实消费者 `dsh-work-x`：需要携带
  `dsh-better-sidebar` 作为展示层搭档，以及自己的 pi2dsh 引擎）。
- **卡点（五层证据，2026-08-25 全部真机实测）**：① 官方 in-box meta-bundle
  （dsh-base 一个条目带出全家）能工作靠的是**安装树特权**——成员包名的模块
  解析落在 CLI 安装树的 pnpm 隐藏 hoist（`resolveBundleDir` 注释明言 in-box
  bundle 永远来自 dsh 安装树）；② 第三方 bundle 的传递依赖从 profile 根
  `ERR_MODULE_NOT_FOUND`（loader `Entry._init` 实测栈）；③ `dsh.profile.bundles`
  是 profile 侧清单，reconcile 只记用户显式 add 的包名，**包侧不存在"被装时
  请一并挂载我的搭档"的声明字段**（app-boot 通读）；④ client-modules 扫组合
  树行但行名解析同撞 ①；⑤ 旁路代价：pi2dsh 引擎经套件薄入口 re-export +
  client 产物内嵌才能随套件工作，而 7MB 级独立 client 插件（better-sidebar）
  无法也不应内嵌——只能教用户一条命令装两个包。
- **最小上游能力**：`dsh.bundle` 增加 companion/依赖 bundle 声明（`dsh plugin
  add` 时展开），或 loader/client-modules 对 bundle 行的模块解析增加"声明
  bundle 自身目录"锚点（等价于把 in-box 的安装树特权泛化给第三方）。
- **证据**：`dsh-x/`（套件旁路全套）、本仓库 2026-08-25 真机解析探针记录。

### DSH-ARCH-007：宿主没有"侧线会话"语义（ephemeral / 非任务型子会话）

- **消费面**：用户侧问类 Pi 包（真实消费者 `pi-btw`：`SessionManager.inMemory()`
  的临时侧线，阅后即焚，留存只经 `--save`/`btw:inject` 显式写回主线）。生态
  同类物：CC/dsh-TUI 的 /btw 压根不建会话；better-sidebar Side Chat 建真子
  会话后靠自定义 `Side: ` label 前缀把它从自家任务列表滤掉。
- **卡点（五层证据，2026-08-26 真机实测）**：① Pi 调用 `createAgentSession({
  sessionManager: SessionManager.inMemory() })` 声明临时性；② 桥必须经官方
  `agents.create` 才能给 child 跑真轮次，而 create 无 ephemeral 选项——
  `CreateAgentOptions.meta` 只有 `cwd/parentSession/seedLength/origin:
  'subagent'/delegationDepth/agentPreset`（dsh-agent 类型通读），`origin` 是
  单值枚举，无"侧线"一档；③ SessionStore 本身内存态，但持久化插件订阅
  `session/event` 无条件落盘，无按会话退订约定；`prepare/enter` 不 announce
  的路径被 agents.create 的创建事务封死，绕开即自建平行运行时（本仓库铁律
  禁止）；④ 权威状态：child 进宿主 sessions 存储与树；⑤ 用户结果：一次
  侧问在顶栏"1 个子代理"chip 计数、会话树留下持久条目——用户没有派任务，
  却得到任务型痕迹。产品面能自救的一半已用生态约定关掉（`Side: ` 前缀，
  better-sidebar 任务列表实测过滤生效）；**宿主自带的 chip/树没有任何公开
  过滤契约**，label 前缀对它们无效。
- **最小上游能力**：`CreateAgentOptions.meta.origin` 增加 `'side'` 一档（或
  独立 `ephemeral: true`），宿主自己的子代理呈现面（chip/树）与持久化插件
  按它分流；退一步，仅在子代理呈现面承认 `Side: ` label 前缀这一既有生态
  约定也能关掉用户可见的那半。
- **证据**：`src/subagent-bridge.ts` 的 sideline 判据与 label 约定、
  `tests/subagent-bridge.spec.ts` 契约、2026-08-26 demo web 真机（Tasks 页
  过滤生效 vs 顶栏 chip 仍计数）。

### DSH-ARCH-005：资源加载前没有 trust policy

- **Pi 消费面**：`project_trust`、`isProjectTrusted`。
- **卡点**：普通插件挂载晚于项目发现和资源加载的安全决策时机。
- **最小上游能力**：由宿主持有、早于项目资源加载的 trust provider/policy。
- **证据**：[`capabilities/environment.md`](capabilities/environment.md)。

## 尚未判定归属

这些能力不完整，但还不能编号为 DSH 缺口：

| 能力 | 当前损失 | 下一步 |
|---|---|---|
| `input` | 注册后不触发 | 用 `agent/pre-step` 做真实输入变换；能做就是桥欠账 |
| `message_end` replacement | 能观察，不能替换 | 验证 stream 包装能否同时保持 UI、日志和消息一致 |
| `tool_execution_update` | 只覆盖迁移 Pi 工具自己的 update | 检查 DSH tools/jobs 是否有统一 partial-result 通道 |
| session switch/fork/tree 事件 | 桥发起的操作可见，宿主 UI 发起的不可见 | 倒推 UI 到 host 的统一 pre/post seam |
| Pi component/Markdown transformer | 文本投影或 no-op | 按用户目标判断应重画 Web slot 还是属于 TUI 宿主实现 |

只有完成“真实消费者、DSH 数据流倒推、最小复现”，并证明权威数据或决策时机确实位于
公开 seam 之外，才新增 `DSH-ARCH-*`。

## Cordis 生命周期验证账本

| Cordis 承诺 | 已有证据 | 仍需验证 |
|---|---|---|
| 卸载撤销副作用 | 部分 tool、provider、side-panel 注册可 dispose | 真 profile 中安装、使用、卸载、同名重装；检查命令、路由、监听器、进程残留 |
| 依赖变化只影响相关组件 | 尚无系统证据 | 运行中移除/替换 llm、questions、subprocess provider，再恢复 |
| 隔离域不串状态 | per-agent tool scope 和子会话有部分测试 | `ctx.isolate` 下同名 provider、多 profile、父子销毁顺序 |
| intercept 只改使用方式 | 未验证 | 对单棵子树施加策略，确认不污染兄弟树 |
| 配置协调与 HMR 回滚 | Pi 包 reload 成功路径有测试 | DSH loader 导入失败后旧组件继续服务，修复后重新收敛 |
| 只有框架内副作用可逆 | `ctx.exec` 可由 subprocess provider 回收 | 直接 `node:fs`、child process 和网络属于可信代码边界，需信任或进程隔离 |

只测“安装后能调用”，最多证明 DSH 是插件加载器。把卸载、重绑、隔离和失败回滚跑通，
才能评价 Cordis 所说的时空可组合性。

## 每次更新的证据格式

每项新增能力必须留下同一条链：

1. 真实 Pi 消费者和用户目标；
2. pi2dsh 翻译位置；
3. DSH 公开 seam 与权威数据源；
4. 五级判定；
5. 单一权威检查；
6. 契约测试，以及需要时的真 DSH CLI/Web E2E；
7. 归属：pi2dsh 待办、DSH 缺口或宿主专属；
8. 涉及安装、卸载、provider 变化或 reload 时的 Cordis 生命周期回归。

## 2026-09-10：DSH 0.1.5-rc.1 适配预检

范围：pi2dsh 当前 HEAD `52f7841`，package/npm 仍为 `0.24.0`，开发依赖 DSH
`0.1.1-rc.2`、Pi `0.84.1`；已有 DSH 预检证据到 `0.1.2-alpha.3`。
2026-09-10 查询 npm：DSH `latest`/`next` = `0.1.5-rc.1`，`alpha` =
`0.1.5-alpha.2`。目标应固定 `0.1.5-rc.1`，不能沿用 9 月 8 日的版本判断。

本节是**源码适配预检与一项真实翻译函数的局部复现**，不是新版本真实插件 E2E
结论，不修改既有插件等级。核对了官方 release、目标 tag 下的相关实现/公开类型、
桥的实际调用点，以及 #2708/#5011/#4190/#4334 的讨论记录。没有升级依赖、修改运行时、
启动用户 DSH_HOME、发布包或向上游发帖。

官方总览：[0.1.5-rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)。

### 必须修改或补验的承重映射

沿现有映射分支记账，不增加平行分类：

| 现有映射分支 | 目标 DSH 变化 | 当前桥的实际消费与后果 | 适配办法 |
|---|---|---|---|
| [模型调用](architecture-mapping-matrix.md#pi-model-registry)、[消息](architecture-mapping-matrix.md#pi-messages-injection) | loop 的系统提示词迁到 `messages` 中的 `system` 消息；`GenerateOptions.system` 只保留给一次性调用 | `src/model-bridge.ts:dshRequestToPiContext` 忽略 system role，只读 `options.system`；Pi 包自带 transport 的正常 loop 请求会丢系统提示词，局部复现已确认 | 按官方 llm-pi-ai 的 `splitSystem` 规则处理：显式 `options.system` 优先，否则取首条 system；转成 Pi 单个 `systemPrompt` 并从普通消息中剥离。旧 Pi transport 不虚报 `systemPromptUpdate: 'in-history'`，让 DSH 选兼容的系统头替换路径 |
| [会话与持久化](architecture-mapping-matrix.md#dsh-session) | `Session.events` 删除，使用 `seq`、`eventAt()`、`snapshotEvents()` | `session-bridge.ts:sessionEvents` 与 runtime 的路由读取、启动补放、`turn_end`、fork/navigation、prompt 提取等仍读旧字段；多个 `?? []` 会将真实历史误判为空 | 集中做版本能力探测的事件读取适配；全量投影用 snapshot，定位/增量场景用 seq 范围与 eventAt；没有任何受支持接口时明确报错，不能用空历史掩盖 |
| [消息流](architecture-mapping-matrix.md#pi-messages-stream) | `assistant/chunk` 不再作为顶层持久事件；实时改为 `agent/assistant-stream`，最终 message/attempt 嵌入 stream | runtime 的 `message_update` 和 `subagent-bridge.ts` 的订阅都只等 `assistant/chunk`，新版上不会收到原来的增量 | 实时订阅 start/chunk/end frame，按 agent/session/attempt 区分；完成消息仍取持久事实。恢复时读取已结算 stream，不能把历史回放当成又一次实时执行；检查补放与实时接入是否重复/漏帧 |
| [子代理/生命周期](architecture-mapping-matrix.md#pi-extension-instance-scope) | `ctx.agent` 删除，`setup(agentCtx, agent)` 显式给出创建中的 Agent | `subagent-bridge.ts:setup` 从 `childCtx.agent.session` 写委托策略；`childSchemas` 同样依赖它，缺失后退回全局 schemas，可能丢子作用域工具或错误裁剪 allowlist | setup 接收第二参数；策略用 `childAgent.session`，工具查询用 `schemas(childAgent)`；旧线仅在缺第二参数时回退旧字段。事件 payload 与 AssembleContext 的 `agent` 仍存在，不要误删这些使用 |
| [子代理/生命周期](architecture-mapping-matrix.md#pi-extension-instance-scope) | create/resume 新增显式 `parentAgent`；持久 parentSession 与实时 owner 分开 | 桥 create/resume 传 parentSession/origin，但不传 parentAgent；持久血缘不能替代实时父子归属，可能被宿主当根 Agent 对待 | 真正的 child create/resume 传当前父 Agent；核验父销毁、子重开、定时/根 Agent 分类和同 session 重复恢复。已有 `await agents.create/resume` 可保留，不把异步化本身当成新故障 |
| [控制](architecture-mapping-matrix.md#pi-agent-control) | Inbox 公开面保留 `nextStep`、`nextTurn`，删除 `hasPending`、`claim`，运行时类变为接口 | `ctx.hasPendingMessages` 读 `.hasPending === true`，新接口下会错报 false | 读取两队列长度；消息投递继续用官方 agent/inbox 方法。claim 是驱动器职责，不在桥重造。`agent/inbox/claimed` 事件仍存在，before_agent_start 的领取时机监听继续可用 |
| [会话与持久化](architecture-mapping-matrix.md#dsh-session) | SessionHandle 独占写所有权，日志升级 V3；迁移会插入 system 事件、重排 seq，并把 surface replace 的端点改为 startSeq/endSeq | 桥通过 agents.resume 的路径可以继续让宿主管迁移，但直接 SessionStore 创建/fork 是否进入持久化需重验；Pi 档案 label/fromId 使用 `dsh-<seq>`，跨格式迁移可能指向错误条目；测试脚本常读旧文件名/header.system/chunk | 通过宿主公开恢复与持久化接口读当前逻辑格式；测试读取 versioned generation。消息引用优先关联稳定 message id；旧 seq 标签必须结合源格式/迁移映射或明确拒绝歧义，不让它静默指向新位置。检查 SessionStore-only 操作的真实持久/可恢复结果，必要时走 agents.create 的官方创建链 |
| [模型与配置](architecture-mapping-matrix.md#pi-model-registry) | DSH 最新 prerelease tuple 为 0.1.5；内置 pi-ai 为 0.85.1 | 现有 peers 只列到 `^0.1.2-alpha.1`，不能据此声明接受 0.1.5-rc.1；开发测试仍只装 rc.2 | 验证后增加目标 peer range；用隔离安装验证新旧宿主，禁止 profile 带入第二份 DSH core。此次不必同步迁移 Pi V2 插件协议 |

源码依据：

- [新请求形状](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/llm/llm/src/types.ts)、[官方 Pi 转换](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/llm/llm-pi-ai/src/context.ts)。
- [Session 读写实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/core/session/src/index.ts)、[V2→V3 迁移约束](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v2-to-v3/README.md)。
- [create/resume/setup](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/core/agent/src/index.ts)、[Inbox/实时事件](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/core/agent/src/runtime-types.ts)。

**系统提示词局部复现**：通过 jiti 直接调用当前源码导出的 `dshRequestToPiContext`，输入
`messages=[{role:'system',content:[{type:'text',text:'SYSTEM_PROMPT_PROBE'}]},
{role:'user',content:[{type:'text',text:'USER_PROBE'}]}]`，按目标类型提供 message id/source，
不提供旧 `options.system`。实际输出 `systemPrompt` 缺失、messages 只剩 user，
`SYSTEM_PROMPT_PROBE` 完全消失。这是翻译函数执行证据，不冒充真模型/真插件验收。

### 新能力及实际收益

- **系统提示词原生历史化与缓存友好更新**：支持的模型声明 `systemPromptUpdate: 'in-history'`，
  上游便能在历史后追加更新，避免重写缓存前缀。Pi 的 per-turn system prompt override 仍在
  assemble 时完成，由 DSH 决定日志与模型表达；不能把这一新增能力算成 wire middleware。
- **子代理控制增强**：原生持续子代理已有排队、编辑、删除、steer、停止、双向消息和冷恢复
  归属处理，Agent Teams 包可以显式安装。应用于 pi-subagents 前需核对模型独立、队列与
  stop/resume 的具体契约，不能从官方 UI 有按钮推导 Pi 插件已经接好。
- **文件与展示**：上传任意文件、read_image 结果展示、交付文件、原生右侧文档预览、全局
  `sidebar.panellist` + `main` keyed 面板，是可使用的新承载能力；与 Pi `ui.custom` 的任意
  TUI 组件不等价。文件块由宿主按已保存路径投影给模型，必须验证桥不丢失文件定位文本。
- **默认模型与工具**：新的 `deepseek-flash` 原生支持图片；原生视觉路由不再需要视觉伴生
  来获得读图能力。Headless/SDK/ACP 默认 read/write/edit，minimal 改为只有持久 shell；
  插件需要文件工具时应通过 preset/工具配置声明，不把“minimal 没工具”归咎于桥。

### 等待中的缺口逐项回查

以下仍沿用既有 ID；这是目标版公开接口复核，**没有新增已完成的真实插件映射**。

| 既有 ID | 0.1.5-rc.1 公开面复核 | 下一步 |
|---|---|---|
| DSH-ARCH-001 自定义持久事件 | `ignorable` 仍保留；`Session.append` 仍只能传 surface 参数，不能设置它。known-event-types 注释明确不采纳单纯事件名注册；跨历史格式迁移仍可能拒绝未知事件 | 保留 Pi 档案旁路与 3 级判断；上游诉求聚焦可写的 omission-safe 信封和迁移契约，不再泛泛要求 registerEventType。#5011 未见新答复 |
| DSH-ARCH-003 wire hook | `llm/stream` 仍围绕规范化 GenerateOptions/StreamChunk；未发现覆盖既有 adapter 最终 headers/body/raw response 的通用公开 hook | 包自带 transport 的现有路径保留；不能将 system/message 或新版模型目录当成此缺口已解决 |
| DSH-ARCH-004 压缩前取消/替换 | CompactionEngine 仍由 provider 实现 compactIfNeeded/compactNow/compactRange；没有旁挂插件取消/替换已有 compactor 决策的 waterfall | 保留通知型降级。替换整套 compactor 不算补齐原 seam |
| DSH-ARCH-005 项目 trust | instruction discovery/refresh 仍未提供项目资源加载前、供仓外插件决策的统一 trust policy | 保留边界；目录 I/O 错误修复不算 trust seam |
| DSH-ARCH-006 bundle 搭档依赖 | profile 仍显式列 bundles；app-boot 仍解析安装锚点/当前 profile，未见包侧 companion 声明或泛化的声明包解析锚点 | dsh-work-x 套件如要覆盖此次升级，搭档安装仍单独验证，暂不撤销旁路 |
| DSH-ARCH-007 临时侧线会话 | create 的 origin 仍只有 subagent；新 parentAgent 解决实时所有权，未增加 side/ephemeral | 保留“临时侧问会留下原生子会话痕迹”的边界，不能把父子归属修复当作 ephemeral 支持 |

读侧保留说明：[上游 ignorable 决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md)。
其他判断依据为本节链接的目标版 agent/session/llm 实现，以及
[compaction](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/compaction/compaction/src/index.ts)、
[instructions](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/context/agent-instructions/src/index.ts)、
[profile](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/boot/app-boot/src/profile.ts)。

### 不应误判为需要重写的面

- `system-prompt/assemble`、complete section、`agent/pre-step`、`agent/request`、
  `tools/pre-execute`、`tools/post-execute` 仍存在；complete section 在 alpha.2 已有，
  不能重复当成新开放能力。
- `ctx.agent` 被删不代表 event payload.agent、AssembleContext.agent 被删，它们仍有明确
  类型。engine 的 assembly 挂载门不应按字段名批量误改。
- 核心桥实际用的 `shell.overlay`、`conversation.session.header.utilities`、
  `conversation.input.dock`、`conversation.composer.dock`、`conversation.chat.turnTail`、
  `tool.call.toolview` 仍在目标版声明。改的是顶层 `conversation` → `main` keyed 入口，
  主桥不直接占它；故先做新壳组合回归，再决定是否迁移浮窗到 sidebar，而非先重写 UI。
- subprocess handle 删除 pid：当前 src 中找到的 pid 消费是 Node 子进程/临时文件逻辑，
  没有据此确认一处直接依赖 DSH handle.pid 的断点；不为 release 每一行虚构桥修改。
- persona 拆 prefix/suffix：桥的 complete section 不依赖旧 PERSONA_SECTION 常量；检查
  examples/用户 overlay 的 persona 配置，不必改写通用 ABI。
- #4190 的第三方参考修复和 #4334 的其他实现绕行不代表原 seam 已修；新宿主上分别重跑
  Codex headless 自然退出与原生子代理失败原因回传对照，不能用 discussion 状态代替执行证据。

### 适配顺序与验收（预检时计划，执行结果见下节）

1. **先修确定的翻译断点**：system message → Pi systemPrompt；统一 session 读取；实时
   assistant-stream；setup 第二参数、parentAgent；Inbox 队列判断。保持 Pi 0.84.1
   目标契约不动，将 DSH 升级与 Pi V2 迁移分开。
2. **再处理恢复与格式边界**：V3 历史/压缩/分支；Pi archive 的旧 seq 引用；官方 handle
   所有权与 parent teardown；修正 E2E 的 generation 文件发现、stream 和 system 断言。
3. **真用户链路验收**：固定 npm DSH 0.1.5-rc.1、一次性 DSH_HOME、原版 Pi 插件：
   OAuth/provider 真请求含 system + 工具；pi-code 的 CLAUDE.md/rules/commands/MCP；
   pi-mcp-adapter 真工具回合；pi-subagents 的独立模型、真实工具、steer/stop/resume、父子
   清理；pi-btw 的侧问与重启恢复；Web/TUI 的对话框、组件、流式显示与切换会话。
   其中跨版本旧会话迁移后来由用户明确排除；本轮只验新建数据及同版本恢复。
4. **发布收尾**：选旧支持线做对照，声明并验证新 peers；同改更新 compatibility.ts、
   对应 Markdown 映射/插件验证记录，运行 pnpm verify 和真正的 CLI/Web 回归。runtime
   inventory 变更时才重生成能力页。没有真机结果前，不宣布 0.1.5 已兼容，也不升级等级。

### 本轮实现与实证

上述 system、Session 读取、文字流、setup/parentAgent、Inbox 断点均已在通用桥修复。
Session 读面集中在 `src/session-events.ts`：优先 snapshotEvents，兼容旧 events；
无法读取的对象明确报错。新版文字流按 attempt/index 防重与丢弃过期帧，输出 Pi
`text_delta`；推理、工具等完整 Pi 流元数据仍未补齐，保留部分支持口径。

真实文件场景另补两处桥欠账：上下文使用公开 fileHandleText/路径转换，Pi hook 改写
周边文本后仍保留原生 file 引用；图片工具卡使用宿主 owner.loadImage，兼容旧附件
加载面。Web 上传、文件随机码读取、Codex 生成/参考图编辑和图片实际解码均有证据。

同一实现保留 `0.1.1-rc.2` 并接入 `0.1.5-rc.1`，peer 范围已标注，无需按这两版拆桥包。
新版完整示例及对应补跑为 19 过 / 1 跳过，跳过项缺 Alibaba 凭证；原始失败记录保留，
没有覆盖为成功。Pi provider 自带 transport 的系统提示词由真实 HTTP 请求和工具往返
验证。Pi-code Task/JSON 子进程完整契约仍不计通过；等待中的 DSH 缺口未因本轮绕行关闭。
详情见[逐能力五层记录](plugin-validation-matrix.md#dsh-015-rc1-新建数据回归2026-09-10)
和[原始运行证据](../community/dsh-015-compat/)。

**用户确定的范围**：不实现跨版本旧数据迁移、旧 seq 标签重映射；保留新建会话和同版本
关闭重开验收。源码仍为未发布的本地构建，不能将现有 npm `pi2dsh@0.24.0` 视为已含此修复。

# 2026-09-10：DSH-ARCH-008 退出期模型调用

真实消费者：npm `pi-hermes-memory@0.9.8` 的 `session_shutdown` handler 在退出时读取
`sessionManager.getBranch()`，通过 `completeSimple()` 总结并保存记忆。Pi 会 await 该
handler 后再结束运行时；只等待插件清理而同时卸载模型服务不能保留这一契约。

倒推结果（stock npm DSH `0.1.5-rc.1`）：

```text
Pi session_shutdown → pi2dsh 的 async Cordis disposer
→ 公开 ctx.effect 的 awaited cleanup
→ 根应用同时卸载 settings、adapter 等服务
→ 回调还在执行，但后续模型调用已返回 NO_ADAPTER，退出总结无法完成
```

原生最小复现位于 [`fixtures/native-shutdown-probe`](../fixtures/native-shutdown-probe/)，
不安装 pi2dsh、不导入 Pi、不替换 adapter。一次正常 headless 回答证明模型可用；
公开 async disposer 使用事先取得的公开 `llm` / `credentials` / `settings` 服务引用。
实测：退出开始时 provider 目录仍有 `deepseek-official`，凭证仍能解析，但 settings
namespace 已消失；随后 `llm.stream()` 返回 `NO_ADAPTER`。因此不是桥没有保存服务引用
或不会取凭证造成的。CLI 另有 5 秒退出上限，也不能承诺完成插件最长 10 秒的总结。

缺少的 seam 是**在模型与凭证等依赖卸载之前执行、并等待插件完成的关闭阶段**。
`agent/disposed` 明确在 scoped-registration unwind 之后；`ctx.effect` 虽然等待自己的
disposer，但不把整个服务树的卸载串行化。重新创建 adapter、直接访问模型端点或把总结
提前到每一轮，都不能证明原关闭契约得到修复。当前此项为 **4 级**，仅声明该版本实证。

补充对照：同一原生 probe 也测试了公开 `prepareCall()`。**在服务仍存活时预绑定**的
单次请求确实能在 disposer 中继续执行并返回 `stop`。因此这里不是声称“退出期间任何
模型调用都不可能”，而是缺少供关闭回调**即时选择并发起新请求**的通用保活阶段。
预绑定请求是已确定配置的一次性能力，不能恢复已卸载的目录/设置，也不能突破 CLI 的
5 秒退出上限；预留未知未来调用或改走另一 adapter 不算修复原关闭契约。

## 2026-09-14：DSH 0.1.5-rc.2 增量核验

查询 npm 的结果为 `latest = 0.1.5-rc.1`、`next = 0.1.5-rc.2`、
`alpha = 0.1.5-alpha.2`。本次对照 rc.1 → rc.2 的完整 tag diff，不把 GitHub
compare API 截断的前 300 个文件当作全部变化。

**结论：当前尚未发布的 rc.1 适配代码不需要再做一轮 ABI 修改。**

- Agent、Session、LLM、工具、子代理、附件、压缩、上下文、启动和 API 这些宿主
  能力目录只有包版本号变化；客户端模块加载、会话、工具、附件和 slot 的接入实现未改。
  服务端另有一处反馈类型的注释更新，没有新增接口或生命周期阶段。
- 产品代码变化集中在反馈弹窗、文件卡片布局、代码文件图标和聊天间距。反馈客户端
  确实有 `toggle → retract`、`openDialog` 增加 rating、新增 `dismissFailure`
  等接口变化；pi2dsh 与 dsh-work-x 没有消费这些接口，因此没有桥内调用需要迁移。
- 当前 13 个 DSH peer 范围均经 semver 执行检查接受 `0.1.5-rc.2`，无需追加重复范围，
  也无需为 rc.2 拆一个桥版本。此前已确认的 DSH 缺口维持原结论。

公开依据：[rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)、
[完整源码差异](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2)。
本轮运行证据单独归档到 [`community/dsh-015-rc2-20260914`](../community/dsh-015-rc2-20260914/)，
不将 rc.1 的完整示例结果改写成 rc.2 全量验收，也不改变现有能力等级。
