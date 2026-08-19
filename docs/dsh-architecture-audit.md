# DSH 架构检验：证据附录

本页保存 [`architecture-mapping-standard.md`](architecture-mapping-standard.md) 与
[`dsh-architecture-conformance.md`](dsh-architecture-conformance.md) 的历史复现、边界说明和
Cordis 生命周期待测项。当前结构化接口归属、理论映射和插件验证以
[`architecture-ledger.json`](architecture-ledger.json) 为准；本页用于复核，不另建分类。

当前基线：2026-08-19，pi2dsh 0.12.x、Pi 0.84.1、DSH 0.1.0-rc.6。

## 架构总账的三个完整性边界

| 完整性边界 | 当前事实 | 不能扩大成什么 |
|---|---|---|
| Pi 公共 ABI | 111 条上游形状规则；另有 202 个可 import 符号 | 111 不是把嵌套对象每个 callable 都拆开的语义全覆盖 |
| DSH 官方子系统 | 官方索引共 45 个；全部在下表列名 | Pi 插件能运行不等于 45 个模块都被验证 |
| Cordis 生命周期 | 已覆盖部分注册清理和包内 reload | 不能据此声称依赖重绑、隔离和失败回滚都成立 |

111 条上游规则由 25 个非事件 API、33 个事件、24 个非 UI context、28 个 UI 面和
单列的 `modelRegistry.hasConfiguredAuth` 组成。桥保留的 `unregisterTool` 不是 Pi 0.84.1
公共 API，不计入分母。具体逐项矩阵见 [`capabilities/`](capabilities/README.md) 和
[`pi-abi-coverage.md`](pi-abi-coverage.md)。

## DSH 45 个子系统全表

这里的状态只回答“pi2dsh 当前有没有资格评价该模块”，不是模块质量评分。

| 状态 | 数量 | DSH 子系统 | 含义 |
|---|---:|---|---|
| **明确落点** | 19 | `approval`、`attachment`、`client-modules`、`commands`、`compaction`、`core`、`credentials`、`llm-streaming`、`persistence`、`scope`、`session`、`session-title`、`settings`、`skills`、`subprocess`、`system-prompt`、`tools`、`user-questions`、`web-server` | 至少一项 Pi 能力直接使用了公开 seam |
| **随链经过** | 8 | `extensions`、`invariants`、`permission-presets`、`sandbox`、`session-projection`、`spill`、`storage`、`workspace` | 默认链路会用到，但没有独立验证替换、故障、卸载或恢复 |
| **有相邻能力，但没走原生模块** | 12 | `filesystem`、`goal`、`jobs`、`lsp`、`plan`、`schedule`、`shell`、`subagent`、`terminal`、`token-meter`、`web`、`workflow` | Pi 插件可能自己实现了相似用户功能，不能给 DSH 专用模块记成功 |
| **尚无验证** | 6 | `code-runtime`、`feedback`、`session-query`、`session-reference`、`session-telemetry`、`typert` | 当前没有自然消费者或针对性测试，不下结论 |

容易误记的边界：

- pi-btw 使用 `ctx.agents` 和 session，证明的是 `core/session`，不是 `subagent` provider。
- Pi 网页插件自行发 HTTP，不等于走了 DSH `web`。
- `ctx.exec` 走 DSH subprocess；Pi 原版工具直接调用 Node 文件系统或 child process 时，
  不会自动继承 DSH sandbox。
- Pi 插件自己保存 goal/plan/job，只证明通用插件能工作，不证明 DSH 的同名子系统。

## 五个已确认缺口的证据

### DSH-ARCH-001：仓外自定义持久事件

- **Pi 消费面**：`appendEntry(customType, data)`、自定义 renderer、label 和部分分支信息。
- **卡点**：未知事件需要 `ignorable: true` 才能安全前向读取，但仓外插件不能通过公开
  `Session.append()` 设置它，也没有运行时 `registerEventType()`。
- **当前旁路**：pi2dsh sidecar。
- **最小上游能力**：开放 ignorable append，或提供有命名空间的事件类型注册。
- **证据**：[`verify-out-of-repo-event-type.mjs`](../scripts/verify-out-of-repo-event-type.mjs)、
  [DSH Discussion #2708](https://github.com/deepseek-ai/deepseek-harness/discussions/2708)。

### DSH-ARCH-002：模型 compat schema 丢字段

- **Pi 消费面**：`supportsDeveloperRole`、`maxTokensField` 等 model compat。
- **卡点**：官方 `llm-pi-ai` 使用 pi-ai，但 settings schema 没有把完整 compat 传进去。
- **当前旁路**：自带 transport 的 Pi provider 注册为 DSH adapter。
- **最小上游能力**：开放 provider-neutral compat 字段并传进真实 model descriptor。
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
