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
→ ctx.commands + ctx.agents + client slot；自定义 entry 进入 per-session Pi 格式档案
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

2026-08-22 追加官方 authorization seam 的真机验收（DSH 0.1.1-rc.2 stock CLI，
web 与 TUI 双 surface）：引用
[Provider OAuth 登录面](architecture-mapping-matrix.md#pi-provider-oauth-login)。
在按用户路径安装 pi2dsh + `pi-provider-kimi-code` 的干净 profile 上（服务经用户可用
的 profile patch 组合进来），`authorization.list()` 同列 37 条官方 llm-pi-ai flow 与
5 条 `pi2dsh/<id>` flow（kimi-coding、openai-codex、anthropic、github-copilot 与验收
包），同 id 不同 scope 并存无让位；对一个 Pi 包 flow 执行官方 `begin()` 走通包自己的
login、record 见证落地、凭证进入中间层存储，官方 `deleteRecord` 把登出镜像回存储。
判级：官方 flow 注册/begin/record 见证 **2 级，可靠翻译**。证据：
[`community/authorization-seam-e2e.json`](../community/authorization-seam-e2e.json)、
[`scripts/verify-authorization-seam-e2e.mjs`](../scripts/verify-authorization-seam-e2e.mjs)、
契约测试 [`tests/authorization-flow.spec.ts`](../tests/authorization-flow.spec.ts)。

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

## pi-mcp-adapter（Agent 级实例作用域、OAuth 与 stock 全栈）

场景：在完全 stock 的栈（npm `@deepseek-ai/dsh@0.1.0-rc.8` CLI、npm
`@deepseek-harness-tui/dsh-tui@0.8.8`，零 fork）上，启动 Agent A 与 `/new` 的
Agent B 各自获得独立的 pi-mcp-adapter 实例：各自 `/pi-mcp` 管理面板 everything
23/23，各自完成一次真 DeepSeek `everything_echo` 工具回合，B 的结果不出现在 A
的会话日志里。

使用的 Pi 架构分支：

- [扩展实例作用域（每会话一份）](architecture-mapping-matrix.md#pi-extension-instance-scope)
- [Agent 与轮次生命周期](architecture-mapping-matrix.md#pi-agent-lifecycle)
- [自定义 TUI 组件](architecture-mapping-matrix.md#pi-ui-chrome)
- [阻塞式用户提问](architecture-mapping-matrix.md#pi-ui-questions)

理论对应：

- DSH `agent/created`（每条发布路径、loop 前）+ 公开 `agent.ctx`
- DSH `system-prompt/assemble` / `tools/pre-execute` awaited waterfalls（就绪门）
- dsh-TUI 公开 `tuiScenes`（管理面板场景）
- DSH `ctx.userQuestions` 与 Web/dsh-TUI 原生问题渲染器（OAuth 场景）

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
- OAuth 人机交互：**2 级，可靠翻译**。真实 Atlassian 流程在 Web 与 dsh-TUI
  都完成 DCR + PKCE；Web 使用 Markdown 授权链接、TUI 使用 OSC 8，localhost
  回调获胜后问题框自动撤销，真实只读工具结果进入 DSH 权威会话日志。

结论：Pi 的每会话实例语义在所有 DSH surface 上由同一条路径承接，不需要任何
surface 开放 setup 扩展点；DSH 缺"root 插件可达的发布前组合 seam"仍是真实
缺口（正解形状：AgentRegistry 级 serial contributor，留作上游提案），但它不再
阻塞任何已验证能力。

证据：[`scripts/verify-tui-singlepath-e2e.mjs`](../scripts/verify-tui-singlepath-e2e.mjs)、
`community/tui-singlepath-e2e.json`（含安装到的每个版本与"无 fork"断言）、
[`tests/agent-scoped-mount.spec.ts`](../tests/agent-scoped-mount.spec.ts)。
OAuth 的真实外部服务边界与包内测试责任拆分见
[`docs/mcp-compatibility.md`](mcp-compatibility.md#real-external-oauth-acceptance)。

## @xmoon76/dsh-pi-tui + pi-mcp-adapter + @tintinweb/pi-subagents

场景：使用 npm 正式包 `@deepseek-ai/dsh@0.1.1-rc.2`、
`@xmoon76/dsh-pi-tui@0.3.4`、未修改的 `pi-mcp-adapter@2.27.0` 和
`@tintinweb/pi-subagents@0.18.0`，由当前 pi2dsh 工作树提供同一 Pi Host ABI。

实际五层：

```text
Pi 插件注册工具/命令/ctx.ui.custom/ctx.ui.select
→ pi2dsh 把业务能力投影到 DSH，并把 Pi component 放进 transport-neutral relay
→ DSH tools/agents/userQuestions + dsh-pi-tui public piTuiExtensions mountComponent
→ 模型、工具、session、child agent 仍由 DSH 权威服务持有
→ 原生 /login、原 Pi MCP 管理器、Pi Agents 选择面和两个真实模型工具回合同时成立
```

2026-08-25 真实结果：

- 启动日志没有 `command registration failed`；dsh-pi-tui 原生 `/login` 展示 43 个
  Provider，过滤 `openai codex` 得到 `OpenAI Codex — sign in`。pi2dsh 不重复注册
  fallback `/login`，但四条内建 Pi OAuth 流程仍由 authorization 服务提供。
- `/pi-mcp` 打开未修改插件的原管理器，everything server 为 **23/23**；真实
  `everything_echo` 工具结果和最终回答均为 `PI2DSH_PITUI_MCP_OK`。
- `/agents` 打开未修改 pi-subagents 的交互选择面；真实模型调用 `Agent` 工具创建
  general-purpose child，工具结果和最终回答均为 `PI2DSH_PITUI_SUBAGENT_OK`。
- dsh-pi-tui footer 通过公开 `chrome.footer.status` 同时显示 MCP 连接状态；没有复制
  MCP/Subagent 业务逻辑，也没有第二套模型、工具或 session store。

分级：工具、模型回合与 child session 为 **1 级，原生承接**；Pi raw component →
`piTuiExtensions` 为 **2 级，可靠翻译**，但消费的是上游明确标记 Unstable 的公共层，
所以通过 API level/capability 探测和独立 relay 隔离，而不是把它声明成永久稳定 ABI。

证据：[`scripts/verify-pi-tui-ecosystem-e2e.mjs`](../scripts/verify-pi-tui-ecosystem-e2e.mjs)、
[`community/pi-tui-ecosystem-e2e.json`](../community/pi-tui-ecosystem-e2e.json)、
[`tests/pi-tui-extension-surface.spec.ts`](../tests/pi-tui-extension-surface.spec.ts)、
[`examples/pi-tui-ecosystem`](../examples/pi-tui-ecosystem/)，以及
[`XMoon/dsh-pi-tui#26`](https://github.com/XMoon/dsh-pi-tui/issues/26)。

## pi-code（Claude Code 配置在 DSH 上照常生效）

场景：一个带 `.claude/` 的仓库——`settings.json` 的 `env` 与 `PreToolUse` hook、
`CLAUDE.md` 的 `@import`、`.claude/skills`——在 DSH 上被同一份未修改的 `pi-code` 包读取并生效；
首次进入项目由 DSH 原生问答框回答 "Trust this project?"。

使用的 Pi 架构分支：

- [会话生命周期与项目信任](architecture-mapping-matrix.md#pi-session-lifecycle)
- [系统提示词装配](architecture-mapping-matrix.md#pi-prompt-system)
- [工具策略拦截](architecture-mapping-matrix.md#pi-tools-policy)
- [资源发现](architecture-mapping-matrix.md#pi-resources-discovery)
- [项目信任](architecture-mapping-matrix.md#pi-project-trust)
- [指定模型调用（ModelRuntime）](architecture-mapping-matrix.md#pi-model-designated-call)
- [用户问答](architecture-mapping-matrix.md#pi-ui-questions)

理论对应：

- DSH `user-questions/request`（Yes/No 问答）
- DSH `system-prompt/assemble` waterfall + 官方 `dsh-agent-instructions` 加载器
- DSH `tools/pre-execute` / `tools/post-execute`
- DSH `skills` 注册面 + `dsh-skill-filesystem` provider
- DSH `llm` 路由（ModelRuntime.completeSimple → 唯一模型路径）

实际五层：

```text
pi-code 在 session_start 请求项目信任、读 settings.json、注册 hooks、发现 .claude/skills
→ pi2dsh 把 ctx.ui.confirm 译成原生问答；把 before_agent_start 的 systemPromptOptions
  补成 { cwd, contextFiles }（用宿主自己的指令加载器重算同一份文件集），链式覆写 systemPrompt；
  把 resources_discover 返回的技能根挂进 dsh-skill-filesystem
→ user-questions / system-prompt/assemble / tools/pre-execute / skills 注册面
→ DSH 权威：请求的 system 段含 @import 展开；技能进入会话技能目录消息；bash 子进程继承 env
→ 用户结果：不改仓库配置即可在 DSH 上得到 env、hook、@import、skills 四项行为
```

实际结果（stock `0.1.1-rc.2` 与 `0.1.2-alpha.3`，headless + web，真模型）：

- 项目信任问答：**2 级，可靠翻译**（web 原生对话框回答；headless 无对话按 pi-code 自身语义 fail-closed）。
- `settings.json` env：**2 级，可靠翻译**（bash 工具结果带值；DSH 子进程环境从 process.env 继承）。
- `PreToolUse` hook：**1 级，原生承接**（`tools/pre-execute` 上 hook 标记文件落盘）。
- `CLAUDE.md` `@import`：**2 级，可靠翻译**（展开文本进入 `request/header.system`；证据不接受模型自己 `read` 文件的路径）。
- `.claude/skills` 动态发现：**2 级，可靠翻译**（技能描述出现在 DSH 技能目录消息）。
- `.claude/output-styles` + `outputStyle` 设置：**2 级，可靠翻译**（`## Output Style: <name>` 与正文进入 `request/header.system`；Pi 的 coding-base 标记在 DSH 提示词里不存在，按 pi-code 自己的回退追加而非替换）。
- `.claude/rules`（未限定）：**2 级，可靠翻译**（规则文本进入 `request/header.system`）。
- `.claude/rules`（`paths:` 限定）：**2 级，可靠翻译**（附着在匹配文件的 `read` 结果上；依赖桥把宿主内建工具参数投影成 Pi 形状——`file_path`→`path`）。
- `.mcp.json`（stdio 服务器）：**1 级，原生承接**（pi-code 自有 MCP 客户端持有传输，工具 `probe_ping` 经 DSH 工具注册面调用；服务器是无 SDK 的真实 JSON-RPC 实现）。
- `.claude/commands`：**1 级，原生承接**（web 用户路径 `/greet` 经 DSH 命令运行时；模型路径经 `slash_command` 工具）。
- `.claude/agents` + `Task` 子代理：**4 级，缺失**（pi-code 以子进程拉起 Pi CLI，DSH 上解析成宿主自己的 bin，报 `--profile <name> is required`；属 Pi CLI 进程契约，不伪造）。
- Pi 提示词模板 / TUI 主题（resources_discover 的另两类）：**4 级，缺失**（DSH 无对应资源面，日志报告不挂载）。
- 状态条速率限制（`after_provider_response`）：**4 级，缺失**（官方 adapter 不透出响应头）。

结论：本包暴露并修正了桥的五处欠账——宿主内建文件工具参数形状未投影成 Pi 形状（`file_path`/`old_string`/`new_string`/`include` → `path`/`oldText`/`newText`/`glob`，pi-code 的路径限定规则与 hooks 的 Claude 词汇转换都依赖它）、`hasTrustRequiringProjectResources` 漏导出（Pi 公开符号）、
扩展目录扫描规则未对齐 Pi（递归扫到共享模块）、`before_agent_start` 缺 `systemPromptOptions.contextFiles`
且覆写未链式、`resources_discover` 从不触发；ModelRuntime 由"按设计不支持"改为在唯一模型路径上的真实现。
均为 pi2dsh 欠账，不涉及 DSH 缺口。

证据：[`examples/claude-code-config`](../examples/claude-code-config/)、
[`scripts/verify-pi-code-headless-e2e.mjs`](../scripts/verify-pi-code-headless-e2e.mjs)、
[`scripts/verify-pi-code-web-e2e.mjs`](../scripts/verify-pi-code-web-e2e.mjs)。

## DSH 0.1.5-rc.1 新建数据回归（2026-09-10）

本块引用前面的插件记录与现有映射分支，只补充新宿主的证据，不给整个插件重打一个总分。
旧数据跨版本迁移按用户决定不在本轮范围；同版本重启恢复仍属于验收。

引用既有分支：[模型](architecture-mapping-matrix.md#pi-model-registry)、
[消息流](architecture-mapping-matrix.md#pi-messages-stream)、
[会话](architecture-mapping-matrix.md#dsh-session)、
[子代理作用域](architecture-mapping-matrix.md#pi-extension-instance-scope)、
[客户端](architecture-mapping-matrix.md#dsh-client)。

| 插件 / Pi 能力 | 五层实际路径 | 本轮结论 |
|---|---|---|
| pi-provider-litellm 2.3.0 / provider 与 systemPrompt | 原包 createProvider → pi2dsh 的 DSH/Pi 消息翻译 → llm.registerAdapter → DSH 请求 / 原包 HTTP transport → 真实 DeepSeek 收到系统提示词并完成工具往返 | 注册 1 级；systemPrompt 翻译 2 级。透传录制器只观察请求，不改写或合成模型响应；原包的可选 LiteLLM Skills/MCP 产品未测试 |
| pi-code 1.0.47 / 配置与 hooks | 原包读取 Claude 配置 → before_agent_start / tool 参数翻译 / resources_discover → assemble、tools、skill filesystem → DSH system/message、工具结果、技能目录消息 → CLI/Web 实际配置与命令生效 | 配置、规则、hooks、skills 维持 2 级；命令注册维持 1 级；Task 启 Pi CLI 的已知缺口仍为 4 级 |
| Pi context 消费者 / 上传文件 | Web 真上传 + Pi context hook 改写周边文本 → fileHandleText 投影及引用还原 → 原生附件与文件工具 → DSH 日志仍保存 file 引用 → 模型真实读取仅在文件内的随机码，Web 保留附件卡 | 2 级可靠翻译；没有文件副本或新权限绕行；真实浏览器截图已目检 |
| pi-codex-image-gen / 图片结果 | 原包图片工具 → PiImageToolView → tool.call.toolview owner.loadImage → DSH 授权附件加载 → 真实生成与参考图编辑结果在 Web 解码显示 | 2 级可靠翻译；修复了桥继续依赖旧附件 URL 的欠账，未增加附件权威或绕过授权 |
| pi-subagents 0.18.0 / 子代理与工具 | 原包 Agent/createAgentSession → 显式 setup Agent、parentAgent 与工具限制 → agents.create/resume + 子作用域 → 原生子会话和真实工具结果 → steer、停止、继续、失败回传、模型继承/独立档位、插件隔离通过 | 创建与原生工具 1 级，控制/模型语义翻译 2 级；Pi 档案文件/自定义事实仍有既有 3 级旁路，不因此关闭 DSH-ARCH-001 |

新版真实 CLI/Web/TUI 证据归档在 `community/dsh-015-compat/`。Provider 使用真实 API；
模块挂载、类型检查或空目录探针不作为这些工作流的成功证据。

### DSH 0.1.5-rc.2 专项复验（2026-09-14）

沿用前述 pi-code 配置分支、[工具注册](architecture-mapping-matrix.md#pi-tools-registry)、
[命令](architecture-mapping-matrix.md#pi-commands-registry)、
[动态资源](architecture-mapping-matrix.md#pi-resources-discovery) 和
[客户端](architecture-mapping-matrix.md#dsh-client)，不新增能力分类。

| 能力 | Pi 调用 → 桥翻译 → DSH seam → 权威事实 → 用户结果 | 复验结论 |
|---|---|---|
| 配置与技能 | 原包读取 Claude 配置 → before_agent_start/resources_discover 与环境传播 → assemble/skills/工具执行 → 原生日志系统消息、技能目录和工具结果 → 导入码、环境值及技能描述实际生效 | 维持 2 级，六组 Web 断言中对应项通过 |
| Hook 与命令 | 原包 PreToolUse/registerCommand → hooks/命令注册 → tools/pre-execute、commands → marker 文件、command/run 和用户消息 → hook 执行且 /greet 生效 | 各维持 1 级 |
| 文件上下文 | Pi context hook 修改上传消息的文字 → 文件定位文本与原引用回译 → 公开附件/文件工具 → 日志保留 file 引用且文件工具读出随机码 → 附件卡和正确结果可见 | 维持 2 级，截图已目检 |

官方 npm rc.2、原包 pi-code 1.0.47、全新 DSH_HOME、真实 DeepSeek 请求。
[逐项结果与源码指纹](../community/dsh-015-rc2-20260914/README.md) 分开保存；
本次没有改桥运行时，未重新宣称 Task/JSON CLI 或完整 Pi 消息流获得支持。

<a id="pi-hermes-memory"></a>
## pi-hermes-memory（2026-09-10—11 原包逐能力复验）

原包为 npm `pi-hermes-memory@0.9.8`，gitHead
`34c6fe49f832e6a0957ce517586158a8bdde71a4`；stock npm DSH `0.1.5-rc.1`，
隔离 DSH_HOME，真实 DeepSeek 模型和原生 CLI/Web。桥是未发布的本地 tarball，
仍标作 0.24.0；每份新增证据记录实际依赖路径和 dist SHA256，不能当成 npm 0.24.0。
最初发布版的失败证据保留，未用修复后的结果覆盖。

| 能力 / 映射分支 | Pi 调用 → 翻译 → DSH seam → 权威状态 → 实测结果 | 独立判级 |
|---|---|---|
| [记忆与技能工具](architecture-mapping-matrix.md#pi-tools-registry) | `registerTool` → 工具参数/结果桥 → `ctx.tools` → 原生日志和插件 Markdown/SQLite → 四类记忆、CRUD、秘密拒存、skill 创建/查看/patch/update/delete 及重启读回 | **2**；插件自己的内容存储不等于另建 DSH 会话权威 |
| [技能发现](architecture-mapping-matrix.md#pi-resources-discovery) | `resources_discover` / `getCommands` → 文件 provider/原生技能元数据 → `ctx.skills` → DSH registry → 全局/项目技能重启加载、更新/删除生效，外部原生技能可见 | **2**；原 npm 0.24.0 的缺失是桥欠账 |
| [历史索引](architecture-mapping-matrix.md#pi-session-host-context) | `getBranch/getSessionFile` → `snapshotEvents` 和完整 Pi JSONL 导出 → Session / persistence 公共读接口 → DSH 日志仍为恢复权威，插件索引派生文件 → 新进程 session_search 可检索正文 | **3**；新增派生文件就是 sidecar，不因搜索成功改判 2 |
| [上下文策略](architecture-mapping-matrix.md#pi-prompt-system) | `before_agent_start` → 提示词转换 → 原生 system prompt → DSH 请求/会话记录 → legacy、policy-only、custom、none、固定指令及不同 cwd 项目隔离 | **2** |
| [后台提取与纠错](architecture-mapping-matrix.md#pi-model-designated-call) | 生命周期/getBranch/completeSimple → 原生模型桥 → `ctx.llm` → DSH 模型/凭证目录，插件保存记忆 → 前台零写工具仍保存；工具次数触发、指定模型、真实主路由失败后回退、取消均有证据 | **2**；缺 simple 导出与空 branch 均为桥欠账 |
| [子进程整理](architecture-mapping-matrix.md#pi-tools-process) | 原包 watchdog 调 `pi -p` → 受限本地协议适配 → `ctx.subprocess` + `ctx.agents` → 原生子代理模型/工具/审计 → 自动超限整理减少占用后父调用完成；超时中止无迟到写入 | **2**（本地 POSIX print/text 子集）；未支持任意 Pi CLI，Windows/远程执行不算此项通过 |
| [Web 命令](architecture-mapping-matrix.md#pi-commands-registry) | 十条 registerCommand → commands/dialogs → `ctx.commands` / 原生问题表单 → command/done/工具日志/插件文件 → 十条均核对实际结果，guide 表单提交、interview 保存、pin 新会话注入 | **2**，其中 UI 能力单列 |
| [交互管理器](architecture-mapping-matrix.md#pi-ui-custom) | `ui.custom` → 终端 renderer 或明确不支持 → 原生终端服务；裸 Web 触发原包只读清单降级 → 可见命令正文 | 完整 TUI 在裸 Web 为 **5**；清单 fallback 为 **2**。本轮没有声称完整终端管理器实测通过 |
| [压缩与单会话关闭](architecture-mapping-matrix.md#pi-agent-lifecycle) | before_compact/shutdown → 生命周期桥 → compaction 事件 / Agent dispose → 原生会话和插件记忆 → 真实长会话压缩保存、宿主存活时单会话关闭保存均通过 | 功能路径 **2**；压缩前 awaited veto/replace 语义仍 **4**，`DSH-ARCH-004` |
| [整进程退出](architecture-mapping-matrix.md#pi-session-lifecycle) | shutdown 临时发起模型请求 → disposer → native llm/settings 生命周期 → 新请求 NO_ADAPTER，提前 prepareCall 的固定请求可继续 → 无通用退出保存保证 | **4**，`DSH-ARCH-008`；原生最小复现不导入桥/原包。5 秒退出期限短于原包 10 秒预算 |
| [无会话后台任务](architecture-mapping-matrix.md#pi-session-operations) | `--no-session` → 不导出 Pi 文件/不索引 → native child → DSH 审计仍持久化 | Pi 索引隔离 **2**；真正零持久化语义 **4**，`DSH-ARCH-007` |

复现脚本：[`verify-hermes-memory-e2e.mjs`](../scripts/verify-hermes-memory-e2e.mjs)、
[`verify-hermes-full-e2e.mjs`](../scripts/verify-hermes-full-e2e.mjs)。
新增证据与失败/补测说明见 [本地验收记录](../community/hermes-memory-20260910/final/README.md)。
原始 npm 基线：[CLI](../community/hermes-memory-20260910/published-cli.json)、
[Web](../community/hermes-memory-20260910/published-web.json)。
这是一组逐能力结果；核心 CRUD 或上游单测全绿都不能代表整个包无语义缺口。

## 0.25.1 侧聊显示修复（2026-09-15）

沿用[会话上下文](architecture-mapping-matrix.md#pi-session-host-context)、
[交互组件](architecture-mapping-matrix.md#pi-ui-custom)和
[客户端](architecture-mapping-matrix.md#dsh-client)分支。原包 pi-btw 创建侧会话后调用
`ui.custom` → 桥依据既有 `browserPresentation` 声明保留 RPC 返回，并按 Pi
`display: false` 过滤呈现 → 自有 BrowserSurfaces 路由和 DSH Web slot → 原生子会话
仍持有完整上下文/回答 → 主命令正常完成，侧窗仅显示问答，主会话不含侧答。

修复前 `0.25.0` 的数据断言虽过，截图暴露了隐藏上下文和错误提示；负面证据保留在
`community/release-0.25.0/`，不覆盖成成功。修复后同一路径已在 stock DSH
`0.1.1-rc.2` 与 `0.1.5-rc.2` 本地构建上执行、检查日志并目检截图，见
[双版本证据](../community/release-0.25.1/README.md)。呈现维持 **2 级可靠翻译**，
此项为桥欠账修复，不新增 DSH 缺口或第二套权威状态。裸 Web 没有声明产品呈现时
仍保留可捕获的终端组件错误，Hermes 的非终端 fallback 不受影响。

### 发布回归的插件接口更新

pi-lens `4.1.6` 将 `lsp_diagnostics` 合入 `lens_diagnostics(source=lsp)`；
`registerTool` → 通用参数/结果翻译 → DSH tools → 原包 LSP 与原生日志 → CLI/Web
真实返回 `src/ledger.ts` 的 TS2322，工具注册和结果路径沿用原有判断。
pi-mcp-adapter `2.34.0` 把应用资源移入沙箱代理；Pi exec → DSH subprocess →
原包会话授权的 AppBridge 服务 → 真实浏览器内嵌资源显示。验证改为实际渲染，
不再解析已删除的私有 JavaScript 变量。此项只证明资源打开/加载；协议内部与
sampling fixture 的服务契约检查不冒充完整原生模型回合，真实 CLI MCP/子代理
证据另见旧宿主 Pi TUI 回归。

## 继续新增记录时

复制一个插件块，补齐“使用的架构分支、理论对应、实际五层、逐项等级、结论、证据”。
没有真实插件跑过的分支只能写“理论可行、尚未实证”；契约测试、import 成功和挂载成功
不能代替本页的实践记录。
