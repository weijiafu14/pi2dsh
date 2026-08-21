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
- [目录模型的指定调用](architecture-mapping-matrix.md#pi-model-designated-call)
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
- 外部 OpenAI-compatible 视觉端点：**2 级，可靠翻译**；既有 CLI/Web 实证仍成立。
- `pi-registry` 复用 DSH 已登录的 `openai-codex` 视觉模型：**4 级，当前缺失**。
  2026-08-20 在 DSH rc.8 上真实运行时，模型可由 `modelRegistry.find()` 找到，但
  `getProvider("openai-codex")` 没有可用 `stream`，插件无法发出识图请求。这是
  pi2dsh 尚未把“目录可见”接成“指定模型可带图调用”的欠账，不是 DSH 缺公开 seam。

结论：证明 Pi 插件可以组合外部视觉 route 与 pre-step，为 DSH 文本模型增加识图能力，
没有引入第二个 Agent runtime；同时证明模型目录投影不能等同于完整 Provider ABI，
`pi-registry` 分支在补齐 route stream 与图片 attachment 转换前不得宣传为已通过。

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

结论：证明“插件拥有完整 transport”时 DSH adapter seam 足够；它本身不证明官方配置型
provider。后者由下一条 rc.8 场景单独验证。

证据：[`examples/gateway-compat`](../examples/gateway-compat/)、
[`scripts/verify-community-scenarios.mjs`](../scripts/verify-community-scenarios.mjs)。

## pi-provider-alibaba

场景：原版 `pi-provider-alibaba@1.0.1` 用 Pi 公开 `createProvider`、`envApiKeyAuth`、
`openAICompletionsApi` 和动态 `fetchModels`，把阿里云百炼 Token Plan（中国区）订阅注册成
DSH 原生模型 route，并在冷启动第一条请求上直接使用动态目录模型。

使用的 Pi 架构分支：

- [Provider 注册](architecture-mapping-matrix.md#pi-model-provider-registration)
- [模型目录视图](architecture-mapping-matrix.md#pi-model-registry)
- [目录模型的指定调用](architecture-mapping-matrix.md#pi-model-designated-call)
- [模型与推理档位选择](architecture-mapping-matrix.md#pi-model-selection)

理论对应：

- DSH `llm.registerAdapter` 与权威模型目录
- Pi provider 自有 transport 与凭证链
- DSH 原生 agent loop、工具执行和 session log

实际五层：

```text
pi-provider-alibaba 注册 auth、OpenAI-completions transport、fallback 与动态模型目录
→ pi2dsh 提供 Pi 0.84.1 Host ABI，合并启动/首次使用的目录刷新并包装 transport
→ DSH llm.registerAdapter + model catalog + 原生 agent loop
→ alibaba-token-cn/deepseek-v4-pro 成为 DSH 权威 route，工具事实进入原生 session log
→ 用户从 DSH 选择百炼模型；模型调用工具、消费结果并完成最终回答，重启后仍成立
```

实际结果：

- Provider 注册：**1 级，原生承接**。
- 鉴权与 package-owned transport：**2 级，可靠翻译**；key 只从环境进入 Pi 凭证链。
- 动态模型目录首次使用：**2 级，可靠翻译**；刷新任务是 host 级单份，完整模型仍进入
  DSH 的同一个 route，不产生第二份目录。
- 工具调用与重启：**1 级，原生承接**；callId、tool result、第二次模型请求均在 DSH
  原生 session log 对账。

2026-08-21 使用发布到 npm 的 `pi2dsh@0.13.3` 做冷启动裸环：全新 `DSH_HOME`，从 registry
安装引擎和未修改的 `pi-provider-alibaba@1.0.1`，选择
`alibaba-token-cn/deepseek-v4-pro`，第一条请求与重启后的第二条请求都完成完整工具闭环；
扫描整个测试 home，精确 Plan key 命中 0 个文件。Web 同日真机选择同一动态模型也完成
两步工具链。

负向对照：Token Plan 与 Coding Plan 的专属 key 都可能以 `sk-sp-` 开头，但官方要求与
各自 Base URL 配对、不可混用。同一枚 Token Plan key 请求 Coding Plan `/models` 返回
200，真实 completion 随后返回 `401 invalid access token`。因此本记录只给 Token Plan
分级；`alibaba-coding-cn` 必须取得真正的 Coding Plan key 后另做 E2E，不能由前缀或目录
探活推断通过。

结论：这是通用 transport-owning Provider ABI 的真实消费者，不是 Alibaba 特判，也不
等于修复了 hand-declared `llm-pi-ai` profile；它通过另一条官方开放的 adapter seam
保留 provider 自己的 wire 语义。

证据：[`examples/alibaba-token-plan`](../examples/alibaba-token-plan/)、
[`tests/provider-adapter.spec.ts`](../tests/provider-adapter.spec.ts)、
[`tests/compat-shims.spec.ts`](../tests/compat-shims.spec.ts)、
[`scripts/verify-examples-e2e.mjs`](../scripts/verify-examples-e2e.mjs)。

## catalog-only Pi provider / gateway compat

场景：Pi 插件只声明 provider 目录，不带自己的 stream；其中包含私有网关需要的
`supportsDeveloperRole`、`maxTokensField`、推理档位和图片输入能力。

使用的 Pi 架构分支：

- [Provider 注册](architecture-mapping-matrix.md#pi-model-provider-registration)
- [模型与推理档位选择](architecture-mapping-matrix.md#pi-model-selection)

理论对应：

- DSH rc.8 `llm-pi-ai` provider profile
- DSH settings / credentials / model directory

实际五层：

```text
Pi provider 声明目录、协议、能力与 compat
→ pi2dsh 按协议白名单翻译 profile，不实现 HTTP
→ 官方 llm-pi-ai 从 settings 解析 route
→ DSH 权威模型目录与官方 adapter 组装真实请求
→ 用户在 DSH 选择模型；录制代理观察到 system role、max_tokens 与推理档位
```

实际结果：

- Provider 配置翻译：**2 级，可靠翻译**。
- 模型输入模态与推理档位：**2 级，可靠翻译**。
- `DSH-ARCH-002`：**上游 rc.8 已修复**；vendor-owned compat 仍按官方边界不透传。

证据：[`examples/gateway-compat`](../examples/gateway-compat/)、
[`tests/dsh-runtime.spec.ts`](../tests/dsh-runtime.spec.ts)。

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

2026-08-20 在 DSH `0.1.0-rc.8`（`141eb6f`）做了严格冷启动复跑：全新
`DSH_HOME`、只安装 pi2dsh、确认没有 `auth.json` 和宿主 credentials 后，从 Web
执行 `/login openai-codex`，选择 Browser login，经 DSH 短链接进入 OpenAI 授权并完成
localhost 回调。登录结果写入 0600 的内部 auth store、DSH credentials 与 settings；
模型选择器立即出现 7 个 ChatGPT Plus/Pro 模型。选择 GPT-5.6 Sol 后，DSH session log
记录 `provider=openai-codex`、`model=gpt-5.6-sol`，真实返回验收标记；同一新凭证在
headless profile 重启恢复后也完成真实回复。

这次复跑同时确认一项 pi2dsh 欠账并当场修复：零社区插件时 engine 曾提前返回，导致
内建 `/login` 没有挂载。DSH 的 commands/settings/credentials/llm seam 都在，问题不
属于 DSH 架构缺口；修复是在空清单分支仍挂一个无包级资源的 host runtime，并用 engine
契约测试锁住“零社区包也有 login”。

证据：[`examples/subscription-login`](../examples/subscription-login/)、
[`scripts/verify-oauth-llm-e2e.mjs`](../scripts/verify-oauth-llm-e2e.mjs)。

## stnly/pi-grok

场景：原版社区插件把 SuperGrok 订阅注册成 DSH 模型 route，运行 xAI 设备码登录，并在
它自己拥有的 transport 发请求前清洗最终 payload。

使用的 Pi 架构分支：

- [Provider 注册](architecture-mapping-matrix.md#pi-model-provider-registration)
- [Provider 网络请求生命周期](architecture-mapping-matrix.md#pi-model-wire)
- [模型目录视图](architecture-mapping-matrix.md#pi-model-registry)
- [阻塞式用户提问](architecture-mapping-matrix.md#pi-ui-questions)

理论对应：

- DSH `llm.registerAdapter` 与权威模型目录
- Pi transport `onPayload` → pi2dsh waterfall
- DSH `ctx.userQuestions` 与命令取消信号

实际五层：

```text
pi-grok 注册 xai-oauth、设备码 OAuth 与 before_provider_request
→ pi2dsh 提供旧版真实 transport export，包装 package-owned transport，投影事件与问题框
→ DSH llm.registerAdapter + model catalog + userQuestions
→ xai-oauth route 进入 DSH 目录，设备码进入当前命令的实时问题状态
→ 用户能打开 xAI 登录页、看到 30 分钟有效码，并从面板取消轮询
```

实际结果：

- 原包加载与 Provider route：**1 级，原生承接**。
- 设备码登录到用户授权前：**2 级，可靠翻译**；2026-08-20 真机完成 OIDC discovery、
  设备码签发、Web 实时呈现与取消，未使用伪造端点。
- `before_provider_request` 通用桥：**2 级，可靠翻译**；真实 DSH `llm.stream` 契约已证明
  handler 收到并改写 package-owned transport 的最终 payload。
- SuperGrok 授权完成、刷新、模型目录与真实回复：**尚未分级**；当前没有该订阅，不能用
  “插件挂载成功”替代账户闭环。

结论：这不是把 xAI 写死进 pi2dsh。原包仍拥有协议、OAuth、目录、transport 与 sanitizer；
pi2dsh 补的是所有 transport-owning Pi provider 共用的 legacy helper、payload waterfall 和
device-code UI seam。它同时再次确认 DSH-native adapter 仍没有通用 request-body middleware。

证据：[`examples/subscription-login`](../examples/subscription-login/)、
[`tests/provider-adapter.spec.ts`](../tests/provider-adapter.spec.ts)、
[`tests/dsh-runtime.spec.ts`](../tests/dsh-runtime.spec.ts)、
[`tests/oauth-bridge.spec.ts`](../tests/oauth-bridge.spec.ts)。

## pi-mcp-adapter（Agent 级实例作用域，stock 全栈）

场景：在完全 stock 的栈（npm `@deepseek-ai/dsh@0.1.0-rc.8` CLI、npm
`@deepseek-harness-tui/dsh-tui@0.8.7`，零 fork）上，启动 Agent A 与 `/new` 的
Agent B 各自获得独立的 pi-mcp-adapter 实例：各自 `/pi-mcp` 管理面板 everything
23/23，各自完成一次真 DeepSeek `everything_echo` 工具回合，B 的结果不出现在 A
的会话日志里。

使用的 Pi 架构分支：

- [扩展实例作用域（每会话一份）](architecture-mapping-matrix.md#pi-extension-instance-scope)
- [Agent 与轮次生命周期](architecture-mapping-matrix.md#pi-agent-lifecycle)
- [自定义 TUI 组件](architecture-mapping-matrix.md#pi-ui-chrome)

理论对应：

- DSH `agent/created`（每条发布路径、loop 前）+ 公开 `agent.ctx`
- DSH `system-prompt/assemble` / `tools/pre-execute` awaited waterfalls（就绪门）
- dsh-TUI 公开 `tuiScenes`（管理面板场景）

实际五层：

```text
pi-mcp-adapter 工厂每 session 实例化、session_start 里建 MCP 连接
→ pi2dsh 在 agent/created 时把 prepared 包挂进该 agent.ctx，assemble/pre-execute 门等就绪
→ agent.ctx.tools / commands / tuiScenes（全部官方公开 seam）
→ 工具进入该 Agent 的 assembly.tools 与 ToolRuntime 权威；A 销毁只 unwind A 的 scope
→ A、B 面板各 23/23；两个真模型回合的 tool/result 落在各自 session 权威日志；互不泄漏
```

实际结果：

- 每 Agent 实例化：**2 级，可靠翻译**（挂载点从发布前 setup 平移到发布后
  官方事件 + awaited 门；Pi 的"第一轮前就绪"保证逐字保持）。
- 工具/命令注册与执行：**1 级，原生承接**。
- 管理面板场景：**2 级，可靠翻译**（tuiScenes 公开服务）。

结论：Pi 的每会话实例语义在所有 DSH surface 上由同一条路径承接，不需要任何
surface 开放 setup 扩展点；DSH 缺"root 插件可达的发布前组合 seam"仍是真实
缺口（正解形状：AgentRegistry 级 serial contributor，留作上游提案），但它不再
阻塞任何已验证能力。

证据：[`scripts/verify-tui-singlepath-e2e.mjs`](../scripts/verify-tui-singlepath-e2e.mjs)、
`community/tui-singlepath-e2e.json`（含安装到的每个版本与"无 fork"断言）、
[`tests/agent-scoped-mount.spec.ts`](../tests/agent-scoped-mount.spec.ts)。

## 继续新增记录时

复制一个插件块，补齐“使用的架构分支、理论对应、实际五层、逐项等级、结论、证据”。
没有真实插件跑过的分支只能写“理论可行、尚未实证”；契约测试、import 成功和挂载成功
不能代替本页的实践记录。
