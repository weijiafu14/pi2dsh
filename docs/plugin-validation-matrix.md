# 真实插件验证

本页按真实插件逐块记录，不生成总分。每块都从
[`architecture-mapping-matrix.md`](architecture-mapping-matrix.md) 引用架构分支，沿
“Pi 调用 → pi2dsh 翻译 → DSH 公开 seam → DSH 权威状态 → 用户结果”五层取证，再按
[`architecture-mapping-standard.md`](architecture-mapping-standard.md) 的五级标准逐项判定。

## pi-btw

场景：运行一段 side conversation，问题与答案不污染主会话，但用户能在 Web 浮层查看并
进入子会话续聊。

使用的 Pi 架构分支：

- [命令注册](architecture-mapping-matrix.md#pi-commands-registry)
- [会话创建、分支与导航](architecture-mapping-matrix.md#pi-session-operations)
- [自定义持久事实](architecture-mapping-matrix.md#pi-session-custom-facts)
- [宿主框架与工具展开状态](architecture-mapping-matrix.md#pi-ui-chrome)

理论对应：

- DSH `ctx.commands`
- DSH `ctx.agents` / session
- DSH durable session events
- DSH client module / slot registry

实际五层：

```text
pi-btw 注册命令并创建侧边会话
→ pi2dsh 翻译命令、child agent/session 和面板数据
→ ctx.commands + ctx.agents + client slot；自定义 entry 进入 sidecar
→ 子会话本体进入 DSH session 权威，Pi 自定义事实没有进入原生日志
→ 主会话保持干净，浮层可见答案，子会话可打开和续聊
```

实际结果：

- 命令注册：**1 级，原生承接**。
- 子会话：**1 级，原生承接**。
- Web 面板：**2 级，可靠翻译**。
- 自定义 entry：**3 级，旁路完成**。

结论：证明 DSH commands、agent/session 和 client slot 能承载真实 Pi 能力；同时暴露仓外
插件缺少 durable custom event 入口，即 `DSH-ARCH-001`。

证据：[`examples/side-conversation`](../examples/side-conversation/)、
[`scripts/verify-examples-e2e.mjs`](../scripts/verify-examples-e2e.mjs)。

## @kassing/pi-vision

场景：分析用户附件图片，把视觉结果注入文本模型的当前轮次。

使用的 Pi 架构分支：

- [Agent 与轮次生命周期](architecture-mapping-matrix.md#pi-agent-lifecycle)
- [模型目录视图](architecture-mapping-matrix.md#pi-model-registry)
- [消息注入](architecture-mapping-matrix.md#pi-messages-injection)

理论对应：

- DSH Agent waterfalls / durable turn events
- DSH 权威模型目录与伴生 route
- DSH `agent/pre-step` 与 session message projection

实际五层：

```text
Pi vision 插件读取图片并请求视觉模型
→ pi2dsh 把伴生模型映射回 DSH route，把识图结果翻成上下文注入
→ DSH model runtime + agent/pre-step
→ 模型选择和主轮次仍由 DSH 掌权
→ 文本模型在没有像素输入的情况下依据注入结果正确回答图片内容
```

实际结果：

- Agent 生命周期：**2 级，可靠翻译**。
- 模型目录与伴生路由：**2 级，可靠翻译**。
- 消息注入：**2 级，可靠翻译**。

结论：证明 Pi 插件可以组合 DSH 模型 route 与 pre-step，为 DSH 文本模型增加识图能力，
没有引入第二个 Agent runtime。

证据：[`examples/vision-bridge`](../examples/vision-bridge/)、
[`scripts/verify-examples-e2e.mjs`](../scripts/verify-examples-e2e.mjs)。

## pi-provider-litellm

场景：把自带 transport 的 Pi provider 注册成 DSH 原生模型 route，并保留 provider 自己的
wire compatibility 行为。

使用的 Pi 架构分支：

- [Provider 注册](architecture-mapping-matrix.md#pi-model-provider-registration)
- [模型与推理档位选择](architecture-mapping-matrix.md#pi-model-selection)

理论对应：

- DSH `llm.registerAdapter`
- DSH 模型目录与 request-level reasoning options

实际五层：

```text
Pi provider 声明模型并拥有 HTTP transport
→ pi2dsh 投影模型目录、推理档位并包装 adapter
→ llm.registerAdapter + DSH model catalog
→ 模型 route 和选择状态进入 DSH 权威目录
→ 用户可在 DSH 选择模型，真实请求由该 provider transport 发出
```

实际结果：

- Provider 注册：**1 级，原生承接**。
- 模型与推理档位选择：**2 级，可靠翻译**。

结论：证明“插件拥有完整 transport”时 DSH adapter seam 足够；它不证明官方配置型
provider 会保留完整 compat schema，后者仍是 `DSH-ARCH-002`。

证据：[`examples/gateway-compat`](../examples/gateway-compat/)、
[`scripts/verify-community-scenarios.mjs`](../scripts/verify-community-scenarios.mjs)。

## Pi 内建 openai-codex OAuth 流程

场景：用 ChatGPT 订阅登录，凭证进入 DSH 可解析的存储，模型出现在选择器中并通过 DSH
原生调用链完成请求。

使用的 Pi 架构分支：

- [Provider 注册](architecture-mapping-matrix.md#pi-model-provider-registration)
- [模型目录视图](architecture-mapping-matrix.md#pi-model-registry)
- [模型与推理档位选择](architecture-mapping-matrix.md#pi-model-selection)
- [阻塞式用户提问](architecture-mapping-matrix.md#pi-ui-questions)

理论对应：

- DSH model runtime / `llm-pi-ai`
- DSH credentials 与 settings
- DSH model selector
- DSH `ctx.userQuestions`

实际五层：

```text
Pi OAuth 流程发起登录并获得可刷新凭证
→ pi2dsh 发布 provider route 与宿主凭证引用
→ DSH settings + credentials + llm-pi-ai + user questions
→ 路由、凭证解析和模型选择进入 DSH 权威状态
→ 用户选择 Codex 模型并从 DSH 原生 llm 调用链得到回复
```

实际结果：

- OAuth 交互：**2 级，可靠翻译**。
- Provider/凭证接入：**2 级，可靠翻译**。
- 模型目录与选择：**2 级，可靠翻译**。

结论：证明 Pi OAuth provider 可以接入 DSH 原生模型调用链；不是只把 token 存下来，也
不是在 DSH 外另起一条聊天链路。

证据：[`examples/subscription-login`](../examples/subscription-login/)、
[`scripts/verify-oauth-llm-e2e.mjs`](../scripts/verify-oauth-llm-e2e.mjs)。

## 继续新增记录时

复制一个插件块，补齐“使用的架构分支、理论对应、实际五层、逐项等级、结论、证据”。
没有真实插件跑过的分支只能写“理论可行、尚未实证”；契约测试、import 成功和挂载成功
不能代替本页的实践记录。
