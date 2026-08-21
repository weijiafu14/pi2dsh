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
| `DSH-ARCH-001` | 仓外插件写 namespaced、可安全回放的自定义 session 事实 | pi-btw 自定义 entry 只能进入 sidecar，因此该项只有 3 级 |
| `DSH-ARCH-003` | 已有 adapter 最终 request/response 周围的通用 middleware | 插件只能拥有整条 transport，不能增强已有 adapter |
| `DSH-ARCH-004` | 压缩执行前的取消/替换 waterfall | 插件只能知道压缩已经发生，不能改变压缩决定 |
| `DSH-ARCH-005` | 早于项目资源加载的 trust policy | 普通仓外插件挂载后再判断信任已经太晚 |

只有同时具备真实消费者、从 Pi 调用到用户结果的五层证据、公开 seam 倒推和最小复现，
才允许新增 `DSH-ARCH-*`。sidecar 能用或另一条 adapter 能绕通，不等于原来的 DSH seam
已经完整。

## 已由上游修复的历史缺口

| ID | 原问题 | 当前结论 |
|---|---|---|
| `DSH-ARCH-002` | rc.6 的配置型 provider schema 无法表达 `supportsDeveloperRole`、`maxTokensField` 等 wire compat | **rc.8 已修复**：官方 `llm-pi-ai` profile 开放按协议校验的 compat、输入模态与 `reasoningEfforts`；pi2dsh 已改为字段级翻译并保留 vendor-owned 字段边界 |

编号保留，避免历史讨论和证据链接失效；它不再计入当前 DSH 缺口。
