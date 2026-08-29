# Pi → DSH 架构结论

本页只汇总结论，不重复架构模型和插件过程：

- 判断方法见 [`architecture-mapping-standard.md`](architecture-mapping-standard.md)；
- Pi/DSH 知识树与理论映射见
  [`architecture-mapping-matrix.md`](architecture-mapping-matrix.md)；
- 真实插件五层证据见 [`plugin-validation-matrix.md`](plugin-validation-matrix.md)；
- 缺口复现和历史边界见 [`dsh-architecture-audit.md`](dsh-architecture-audit.md)。

没有真实插件证据的能力不进入本页，只在架构模型中保留为“理论可行、尚未实证”。当前
结论不是全覆盖声明；它只对已经盘点并走完证据链的分支负责。

## 已经由真实插件证明的映射

- **命令注册**：pi-btw 证明 Pi 命令可进入 DSH `ctx.commands`，达到 1 级原生承接。
- **会话创建与分支**：pi-btw 的 side conversation 是真实 DSH child agent/session，能被
  宿主打开、恢复和续聊，达到 1 级。
- **客户端扩展**：pi-btw 面板证明仓外插件可通过 client module 和 slot 扩展 Web，Pi
  终端呈现被可靠翻译为 DSH 浏览器呈现，达到 2 级。
- **多终端表面**：同一 Pi Host ABI 已在 dsh-TUI、Web 和 dsh-pi-tui 上承载真实
  `ctx.ui.custom` 消费者。dsh-pi-tui 组合中原 MCP 管理器、MCP 真工具回合、Pi Agents
  交互和真 child 回合同时成立；表面通过 public capability 选择，业务状态仍在 DSH，
  达到 2 级可靠翻译。其未来 Server/Client 迁移由可序列化 relay 隔离，不需要第二 runtime。
- **模型 adapter**：pi-provider-litellm 证明自带 transport 的 Pi provider 可以注册为
  DSH 原生 route；pi-provider-alibaba 的 Token Plan（中国区）E2E 进一步证明标准鉴权、
  协议 factory、动态模型目录、冷启动首次使用与重启后的工具闭环都能沿同一 seam 成立。
  Provider 注册 1 级，鉴权、动态目录与模型形状投影 2 级；Coding Plan 因凭证与 Token
  Plan 隔离，不从本结论外推。
- **配置型模型 provider**：DSH rc.8 的官方 `llm-pi-ai` profile 已能承载协议、输入
  模态、推理档位和按协议开放的 compat；pi2dsh 的 catalog-only 翻译达到 2 级。
- **OAuth 模型链**：Pi 内建 openai-codex 流程证明登录、凭证发布、模型目录、模型选择和
  DSH 原生 LLM 调用可以连成一条链，达到 2 级。
- **伴生模型与上下文注入**：@kassing/pi-vision 证明 Pi 插件可以组合 DSH 模型 route 与
  pre-step，为文本模型注入图片分析结果，达到 2 级。

这些结论只证明对应公开 seam 和真实场景，不自动扩张成整个能力域都已兼容。

## DSH 已有能力，但 pi2dsh 还没接好的

- `resources_discover` 理论上可翻译成具有生命周期的 skill/MCP/resource provider；当前
  是桥欠账。
- `getContextUsage()` 理论上可读取 DSH token-meter、模型窗口与 session projection；
  当前是桥欠账。
- Pi `input` 事件理论上应接在用户消息成为 step 前的 `agent/pre-step`；当前是桥欠账。
- session switch/fork/tree 由桥发起时可观察，但宿主 UI 发起时尚未证明进入同一套
  pre/post 生命周期；完成倒推前记桥欠账，不甩给 DSH。

## 有真实场景和证据支撑的 DSH 缺口

| ID | 缺少的公开能力 | 真实后果 |
|---|---|---|
| `DSH-ARCH-001` | 仓外插件写 namespaced、可安全回放的自定义 session 事实 | pi-btw 自定义 entry 只能进入引擎的 per-session Pi 格式档案（2026-08-24 起为真 Pi 格式，此前是私有 sidecar 记录），仍非原生日志，因此该项只有 3 级 |
| `DSH-ARCH-003` | 已有 adapter 最终 request/response 周围的通用 middleware | 插件只能拥有整条 transport，不能增强已有 adapter |
| `DSH-ARCH-004` | 压缩执行前的取消/替换 waterfall | 插件只能知道压缩已经发生，不能改变压缩决定 |
| `DSH-ARCH-005` | 早于项目资源加载的 trust policy | 普通仓外插件挂载后再判断信任已经太晚 |

只有同时具备真实消费者、从 Pi 调用到用户结果的五层证据、公开 seam 倒推和最小复现，
才允许新增 `DSH-ARCH-*`。sidecar 能用或另一条 adapter 能绕通，不等于原来的 DSH seam
已经完整。

## 0.1.2-alpha.1 冲击审计（2026-08-29，npm 未发布）

上游 0.1.2-alpha.1（GitHub tag，npm `latest` 仍为 0.1.1-rc.2）经三源交叉核验
（官方笔记 diff、社区分析、我方源码自查 + 真机预检）。机制级代际差异清单的权威在
CLAUDE.md 的预检段，本节只记架构层结论，按三类分：

**上游原生化、我们让位或降级为兜底的**：

- 原生子代理修复了 request-time model selection 的 stale-model 与派遣参数
  （`aefc083b`）——我们此前对该缺陷的规避文案降为 rc 线专用，相关社区回帖已更正。
- 宿主 dispatch 自己处理文本模型收图（显式 `[image omitted …]` 占位）与附件重编码
  （WebP + 像素预算缩放）——桥的拒绝 guard 从主路径降为兜底，断言改按容器与预算分支。
- pi-ai catalog 登录：官方明写因 ToS **主动腾位** out-of-tree 插件，并配套开出
  `settings.models.provider-card`/`footer` 座位——这不是被抢走，是给位。

**上游开出新座位、我们更有机会接插件能力进来的**：

- Models 页两座位已落中间层登录卡（签入目录 + 已登录行扩展；见 matrix
  「Provider OAuth 登录面」alpha 分支与 `tests/login-card-routes.spec.ts`）。
- user-questions 从 provider 槽改为 agent-scoped `user-questions/request`
  waterfall——应答者面更干净，hasUI 探针已双代分支。
- session 事件词汇 fail-closed 化并明写"等一个真实仓外事件消费者"——`DSH-ARCH-001`
  的上游注册机制之门首次打开，跟进提案已发（audit 文档 ARCH-001 段有复现与链接）。
- llm-pi-ai compat 新增三个 completions 字段——catalog-only provider 的配置翻译面
  变宽（已入字段级翻译与双代漂移闸）。

**未变的**：四个 `DSH-ARCH-*` 缺口在 alpha 一个都没解锁（001 反而更硬）；上游
#4334（closing-message）仍未修；桥的全部承重 seam（agent/created、assemble、
tools 管线、prepareCall、sessions、webServer、client slots 等）实证存活。适配
等级：契约级双代全绿 + alpha 真机 smoke 与登录卡场景已过；**全量 examples 回归
在 alpha 线尚不可做**（alpha 未上 npm，用户装不到的路不测），上游发 npm 后立即补。

## 已由上游修复的历史缺口

| ID | 原问题 | 当前结论 |
|---|---|---|
| `DSH-ARCH-002` | rc.6 的配置型 provider schema 无法表达 `supportsDeveloperRole`、`maxTokensField` 等 wire compat | **rc.8 已修复**：官方 `llm-pi-ai` profile 开放按协议校验的 compat、输入模态与 `reasoningEfforts`；pi2dsh 已改为字段级翻译并保留 vendor-owned 字段边界 |

编号保留，避免历史讨论和证据链接失效；它不再计入当前 DSH 缺口。
