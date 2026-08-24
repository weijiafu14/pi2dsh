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
  提案草稿：[`community/upstream-proposal-plugin-session-entries.md`](../community/upstream-proposal-plugin-session-entries.md)（未发出，等拍板）。
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
