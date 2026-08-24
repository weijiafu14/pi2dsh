# pi2dsh

[English](README.md) | **中文**

**让 Pi 生态的插件原样跑在 DeepSeek Harness 上。**

```sh
dsh plugin add pi2dsh          # 装一次
dsh plugin add <任意 Pi 插件>   # 之后想装谁装谁，直接用 npm 原包
```

## 为什么有这个项目

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的
理念值得押注——可重建的持久会话日志、干净的服务组合、一条真能讲清楚的 agent
循环。它现在缺的是插件生态：还处在早期，而大家开箱就想要的那些能力——联网搜索、
记忆、代码导航、子代理、看图——大多还没人为它写。

[Pi](https://pi.dev/) 的生态已经成熟：几百个已发布的包，很多都有真实用户。

pi2dsh 是一层兼容层，把 Pi 的公开扩展 ABI 实现在 DSH 的原生服务之上，让 Pi 包
**以发布的原样**跑在 DSH 上——不 fork、不打补丁、不为每个包写适配器。你像装任何
DSH 插件一样装一个 Pi 插件，它就能用。

同时，pi2dsh 也是对 DSH 架构的一次覆盖完整能力面的持续实战检验。我们不是为单个插件
打补丁，而是在检验：Pi 插件依赖的模型、工具、会话、交互、资源和客户端能力，能否
只通过 DSH 对外开放的服务与扩展点，保持原有逻辑和生命周期。如果这些能力都能在 DSH
上成立，就说明 DSH 为构建 Agent 及其插件生态所设定的架构目标，至少在这个方向上
经受住了真实生态的验证；任何必须旁路、降级或无法表达的地方，也会准确暴露它仍缺少的
架构能力。

## 安装

一次引擎，之后想装谁装谁：

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-mcp-adapter
```

然后**重启 `dsh`**——插件在启动时挂载。

> **profile 必须带一个界面 bundle。** DSH 内置模板是 `web` 与 `headless`；产品
> 自己装了界面的自定义 profile 也完全有效，例如 `dsh-tui` profile 里的
> `@deepseek-harness-tui/dsh-tui`。只有随手新建、没装任何界面层的空 profile 才会
> 启动后没人驱动；这种情况先把目标界面加进 `dsh.profile.bundles`。

就这一种方式。没有转换步骤，没有生成产物，不用构建。引擎会读出你 profile 里的
Pi 包（每一个都是你显式装的），用同一个桥实例挂载它们：一个模型目录、一个登录、
一个凭证存储、一个升级单元。

日常操作：

| 要做的事 | 命令 |
|---|---|
| 装插件 | `dsh plugin add <包名>`（然后重启 dsh） |
| 卸插件 | `dsh plugin remove <包名>`——先卸插件，再卸引擎 |
| 升级插件 | `dsh plugin add <包名>@latest`，引擎不动 |
| 升级引擎 | `dsh plugin add pi2dsh@latest`，插件不动 |
| 升级前先体检 | `npx pi2dsh inspect <包名>@<版本>` |

两条安装期提示值得提前知道：

- **`ERR_PNPM_IGNORED_BUILDS`**：pnpm 默认拦截依赖的构建脚本。在
  `$DSH_HOME/profiles/web` 里跑 `pnpm approve-builds`，或者把提示
  里的包在该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下设成 `true`，
  然后重跑 add。（这是你的决定权，桥不会绕过它。）
- **刚发版后 add 装到了旧版本**：pnpm 的 `minimumReleaseAge` 会跳过刚发布不久
  的版本。显式钉版本即可：`dsh plugin add pi2dsh@<版本>`。

需要 Node.js 22.19+ 和 DeepSeek Harness。

## 走一遍：终端里的进阶 MCP

这个例子最能说明这座桥值什么。dsh-TUI 自带原生的 `/mcp` 命令（DSH 官方 MCP
客户端）——它能用，也原封不动。而 Pi 生态里有一个功能强得多的 MCP 利器：全屏
服务器管理器、工具懒加载、用一个代理工具代替把几十个工具塞满模型上下文、用
JavaScript 编排多次 MCP 调用、OAuth 登录、资源与提示词。装上桥，这个包原样就能跑。

### 1. 安装

```sh
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui   # profile 已存在则跳过
dsh plugin --profile dsh-tui add pi2dsh
dsh plugin --profile dsh-tui add pi-mcp-adapter
```

然后重启 `dsh`——插件在启动时挂载。

### 2. 配置你的 MCP 服务器

在 dsh-TUI 里运行：

```text
/pi-mcp setup
```

setup 流程可以把你已有宿主配置里的 MCP 服务器定义收编进 adapter 自己的标准
`mcp.json`。不存在任何桥专属的配置——你接触到的一切都是这个包自己的界面。

### 3. 用起来

```text
/pi-mcp
```

打开全屏交互式服务器管理器——底栏写着启用/停用、重连、OAuth 登录的按键。模型
经 DSH 的正常工具注册表拿到 adapter 的 `mcp` 与 `mcpScript` 工具；每个 Agent
（包括 `/new` 开的）都有自己独立、完整连接的一份实例。

dsh-TUI 的原生命令保持独立，两者共存：

```text
/mcp       # 原生 DSH MCP 客户端状态
/pi-mcp    # 装入的 Pi adapter 管理器
```

这条走查背后验证过什么：16 项宿主可影响的能力在 stock npm 全家桶上端到端跑通——
三种真实传输、发现、代理与热加载直连工具、`mcpScript`、资源、提示词、MCP 图片
变成真实 DSH 附件、MCP Apps、经 DSH 官方问答的工具审批、elicitation、对着真实
DSH 模型运行时的 sampling、取消与会话重启。完整证据矩阵：
[`docs/mcp-compatibility.md`](docs/mcp-compatibility.md)。

完整可跑版本：[`examples/tui-mcp`](examples/tui-mcp/)。

## 现在到底哪些真能用

分两级，这两件事不是一回事。

### 第一级——端到端实测过，配可跑示例

有人真坐下来，在真实 DSH loop 上用了这个插件的真功能，亲眼看到它工作。
**要信就信这张表。**

| 插件 | 验证了什么 | 在哪验的 | 示例 |
|---|---|---|---|
| [`@kassing/pi-vision`](https://www.npmjs.com/package/@kassing/pi-vision) | 图片委托给视觉模型；贴图伴生路由；分析结果注入纯文本模型的这一轮 | CLI + Web | [`vision-bridge`](examples/vision-bridge/) |
| [`@crazygit/pi-codex-image-gen`](https://www.npmjs.com/package/@crazygit/pi-codex-image-gen) | ChatGPT/Codex OAuth 调 `gpt-image-2` 生图；本地参考图走 DSH 审批后上传；编辑图片；原生附件存储并在 Web 内直接显示 | CLI + Web | [`codex-image-gen`](examples/codex-image-gen/) |
| [`pi-btw`](https://www.npmjs.com/package/pi-btw) | `/btw <问题>` 跑成 DSH 子代理界面里的真子会话；`/btw-inject`；`/btw --save`；主会话保持干净 | CLI + Web | [`side-conversation`](examples/side-conversation/) |
| [`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) | 终端状态条（模型、思考档位、项目、上下文用量）画进 DSH 的 widget dock，带颜色 | Web | [`presentation-surfaces`](examples/presentation-surfaces/) |
| [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | 完整管理界面画进 dsh-TUI；stdio/Streamable HTTP/SSE；发现、直连/代理/脚本调用、resources、prompts、图片、结构化内容、MCP Apps、审批、elicitation、sampling、取消与重启全部穿过 DSH 运行时；原生 `/mcp` 与 `/pi-mcp` 共存 | dsh-TUI | [`tui-mcp`](examples/tui-mcp/) · [证据矩阵](docs/mcp-compatibility.md) |
| [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents) | 模型自己带团队：派子代理（真宿主原生工具）、后台跑+完成通知、运行中转向、等结果、带记忆续命、真停得住的打断、`/pi-agents` 管理面、跨重启按归档身份重开——每个子代理都是原生 DSH 会话 | CLI + dsh-TUI | [`subagents`](examples/subagents/) · [验收报告](community/subagents-acceptance-report.md) |
| [`pi-provider-alibaba`](https://www.npmjs.com/package/pi-provider-alibaba) | 阿里云 Token Plan（中国区）专属 key：实时目录、冷启动动态模型、完整工具闭环与重启均已实测；包也声明 Coding/API 路由，但必须分别使用不可混用的专属凭证 | CLI + Web | [`alibaba-token-plan`](examples/alibaba-token-plan/) |
| [`pi-vision-tool`](https://www.npmjs.com/package/pi-vision-tool) | 工具注册，且带一个 DSH 需要转换的 JSON Schema 形状（`anyOf` → `oneOf`） | CLI + Web | — |
| [`pi-approval-guardian`](https://www.npmjs.com/package/pi-approval-guardian) | 每次工具调用先由第二个模型审批；放行与拒绝两条路都看到了 | CLI（裸环境） | — |
| [`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory) | 跨会话记忆：一个进程写入，另一个全新进程读回 | CLI | — |

后三个的示例还没写。按本项目自己的规矩，补示例前必须重新端到端验证一遍，所以
这张表如实标出今天谁有示例。

### 第二级——能挂载，且注册面能被探针调起来

Pi 目录里**月下载量前 50 的包**，每个都在真实 DSH 运行时里挂载，然后用黑盒探针
调用。状态截至 2026-08-14；逐包的机器可读证据在 [`community/`](community/)。

**50 个里 47 个探针调用成功 · 1 个没有可探测面 · 2 个待复跑。**

**这一级不能说明的事**：不能说明这个插件的真功能按你的用法能跑通。探针是拿合成
参数去调一个注册面，用户跑的是一整条工作流。`pi-btw` 就是最好的反例——它在这张
表里挂着"working"挂了好几周，而真实会话里 `/btw <问题>` 是直接失败的：这个功能
需要补两个 ABI 缺口（Pi 公开可写的 `AgentState.messages`，以及给桥接命令声明输入
描述符），而任何探针都不会碰到它们。两个缺口都在 0.11.0 修好了，而且都是通用修
复——同样用法的插件一起解锁。

所以下面这张表请读成**"桥覆盖了这个插件用到的面"**，而不是"这个插件已知可用"。
你要是试了哪个，不管成没成，反馈回来都有用。

| 能力 | 插件 |
|---|---|
| **MCP** | `pi-mcp-adapter` · `pi-mcp-extension` |
| **联网搜索与抓取** | `pi-web-access` · `pi-deepseek-search` · `pi-web-search` · `@ollama/pi-web-search` · `@juicesharp/rpiv-web-tools` |
| **代码导航与编辑** | `pi-lens`（ast-grep）· `@narumitw/pi-lsp` · `pi-readseek` · `@ff-labs/pi-fff` · `pi-landstrip` · `pi-hashline-edit-pro`¹ |
| **子代理与后台任务** | `@gotgenes/pi-subagents` · `pi-background-tasks`² · `@mjasnikovs/pi-task` |
| **记忆** | `pi-hermes-memory` · `pi-goosedump` |
| **计划与目标** | `@narumitw/pi-goal` · `pi-goal-list-loop-audit` · `@narumitw/pi-plan-mode` · `@juicesharp/rpiv-todo` |
| **问你 / 审批** | `@juicesharp/rpiv-ask-user-question` · `pi-ask-user` · `@gotgenes/pi-permission-system` · `@juicesharp/rpiv-advisor` |
| **侧边对话** | `pi-btw` · `@narumitw/pi-btw` |
| **模型与 provider** | `pi-provider-litellm` · `pi-llama-cpp` · `pi-prompt-template-model` · `@vigolium/piolium` |
| **图像** | `@kassing/pi-vision`（见上文）· `@amaster.ai/pi-image-gen` |
| **外部集成** | `@llblab/pi-telegram` · `pi-cursor-sdk`² · `@howaboua/pi-codex-conversion` · `pi-agent-browser-native`² · `pi-harness-runtime` |
| **提示词与工作流** | `pi-simplify` · `pi-fabric`² · `mitsupi` · `pi-cc-extensions` · `pi-rtk-optimizer` · `pi-interview`¹ |
| **终端装饰** | `pi-powerline-footer` · `@narumitw/pi-statusline` · `pi-zentui` |
| **语音** | `@juicesharp/rpiv-voice` |
| **用量统计** | `@alexanderfortin/pi-deepseek-usage`³ |

¹ 能挂载，调用验证待复跑（装置侧的失败，不是包或桥的问题）。
² 业务逻辑真跑到底了，然后拒绝了合成的探针参数——属于正常工作、参数校验正确。
³ 纯事件钩子包：四个订阅全都挂上了，但每个处理器都要求有活的 DeepSeek 计费会话
（它拉账单用量并渲染 footer），黑盒探针没有可安全断言的调用面。

前 50 之外的包不是另一类情况——桥里没有任何逐包代码。哪个包撞上 ABI 缺口，补上
那个缺口，撞同一处的包一起解锁。

第一级是靠一个一个啃第二级长出来的。完整的验证阶梯、以及每一级分别能证明什么、
不能证明什么：[support matrix](docs/posting-kit/support-matrix.md)。

## 技术架构

三层，谁也不跨谁：

```
┌─ Pi 插件 ───────────────────────────────────────────────────┐
│ 原样的 npm 包。它看到的是一个完整的 Pi 宿主：三个 Pi 运行时  │
│ 导入、registerX、ctx.*、33 个生命周期事件。它永远不知道      │
│ DSH 的存在。                                                │
└──────────────────────────┬──────────────────────────────────┘
                           │  Pi 的公开 ABI
┌──────────────────────────▼──────────────────────────────────┐
│ pi2dsh——翻译官，也是唯一同时懂两边词汇的地方。目录投影、    │
│ 事件桥、会话与子代理桥、凭证、vendored 的 Pi 逻辑。          │
└──────────────────────────┬──────────────────────────────────┘
                           │  一个普通 DSH 插件 + llm adapter
┌──────────────────────────▼──────────────────────────────────┐
│ DeepSeek Harness。它只看到一个普通插件，永远不知道 Pi 的存在。│
└─────────────────────────────────────────────────────────────┘
```

DSH 有两半，桥也有两半。上面那根柱子是服务端；浏览器壳有自己的插件面，
**当一个 Pi 能力是"形态"而不是"行为"时，它落在那边**：

```
┌──────────── DSH 服务端（cordis） ───────────┐  ┌──────── DSH 浏览器壳 ────────────┐
│ 服务 · waterfall · durable 事件             │  │ dsh.client + exports "./client"   │
│                                             │  │ slot 注册表（ui-slots）           │
│ pi2dsh 引擎                                 │  │   shell.overlay  ← 浮层与 pill    │
│   工具 · 命令 · 模型 · 会话                  │  │   header.utilities ← 头部文本     │
│   子代理桥 ───────────────────┐             │  │   input.dock ← widget             │
│   browser-state 注册表        │             │  │   composer.dock ← working/底部    │
│     GET /pi2dsh/browser-state┼── 自有通路 ─┼──┼─▶ 四个座位，共用一个轮询           │
└───────────────────────────────┴─────────────┘  └───────────────────────────────────┘
```

浏览器半边用的数据走**本包自己的路由**，不走 DSH 的 typed Remote 体系——那是
一等公民的代码生成契约，仓外插件跟自己的 UI 说话就该自带通道。一个会话一个
payload，喂给所有座位：侧边对话浮层，以及 Pi 的呈现面（status、widget、header、
footer、title、working/thinking 类），都画在宿主自己的 slot 座位里，而不是再造
一套。另外两条宿主规则决定浏览器半边能不能被装载：包必须导出 `./package.json`
（宿主按子路径解析清单），`./client` 产物必须是闭包工厂格式而不是普通 ESM。

保证它靠谱的几条标准：

- **DSH 已经有的东西，桥绝不再造一遍。** 工具进 DSH 的工具注册表，模型进 DSH 的
  llm 配置，只有 server 配置的 MCP 交给 `dsh-mcp-client`，skills 交给
  `dsh-skill-filesystem`，提问交给 DSH 的 user questions。用户显式安装的 Pi
  能力包可以保留它自己拥有的行为；桥只映射公开宿主面，不抄它的 transport。
- **不造桥私有的用户世界。** 常规配置仍然全是 DSH 形状：DSH 设置、命令、凭证。
  如果一个被安装的能力包明确自带管理面，就保留并在冲突时标出来源——dsh-TUI 的
  `/mcp` 不动，Pi 管理面叫 `/pi-mcp`。
- **零逐包特判。** 核心里没有任何 `if (packageName === …)`。修一个 ABI 缺口，
  撞上它的包一起解锁。
- **绝不伪装成功。** 映射不了的能力会**如实告诉你**——同一个插件同一项能力只提示
  一次，讲人话。如果某个插件在启动期就需要这样一项能力，它会被整包标成不可用并
  给出卸载建议，而不是半死不活地跑着。
- **验证过才算数。** 每项能力都有公开 API 契约测试，并且必须在它声称支持的每个
  DSH 界面上端到端跑通才会发布。

## 这件事正在检验 DSH 什么

pi2dsh 同时也是一套会执行的 DSH 插件架构压力测试。Pi 提供的不是为了迎合 DSH
现编的几个 demo，而是一套已经被大量真实插件用过的公开 ABI，所以它很适合回答：
DSH 所说的“能力由插件自由组合”，到底走到了哪一步。

目前的结论不是简单的“好”或“不好”，而是边界已经很清楚：

- DSH 对**替换一整项能力**的公开 seam 是成立的：工具、命令、模型 adapter、用户
  提问、原生子会话和浏览器 slot 都已经承接住真实 Pi 能力。
- 压力集中在**从内部扩展已有能力**：仓外插件新增一种持久会话事件、拦截真正发出的
  provider 请求/响应、在压缩发生前改变决定、在项目资源加载前参与 trust。
- pi2dsh 用 sidecar 或另一条 adapter 把功能绕通，对用户有价值，但**不能算 DSH
  原生架构已经承接成功**。我们会把“功能可用”和“宿主 seam 完整”分开记。

一个容易说错的例子：`pi-btw` 的回答已经是真正的 DSH child session，宿主能打开、
续聊和恢复；sidecar 存的是 Pi 自定义 entry 等 DSH 仓外插件目前无法写进原生日志的
事实，不是把整个子会话伪造了一遍。模型侧也一样：自带 transport 的 Pi provider
可以注册成原生 DSH route；从 DSH rc.8 开始，只声明目录的 provider 也有了完整的官方
路径——pi2dsh 把端点、输入模态、推理档位和 DSH 已开放的协议 compat 翻译成
`llm-pi-ai` profile，真正请求仍由 DSH 发出。

项目采用一套统一的 **[Pi → DSH 架构映射标准](docs/architecture-mapping-standard.md)**：
具体 Pi 接口 → Pi 能力契约 → DSH 承载机制 → 公开 seam → 真实插件验证 → 五级结论。
这是一条统一推理路线，不是额外的运行时层。可扩展的分支维护在手写的
**[架构模型知识树](docs/architecture-mapping-matrix.md)**，真实场景维护在
**[逐插件验证记录](docs/plugin-validation-matrix.md)**，三类总体判断维护在
**[架构结论](docs/dsh-architecture-conformance.md)**。架构分类不再由 JSON 总账或生成器
产生；曾经观察到的 111 条 Pi 规则和 45 个 DSH 子系统只是带版本的调查快照，不是固定
总量或完整性证明。这样既能从总体看到已经适配的能力，也能从任一插件下钻到它用了哪些
Pi 能力、落到哪些 DSH 机制、实际达到哪一级。
当前仍有 4 个 DSH 缺口；第 5 个历史缺口 `DSH-ARCH-002` 已由 rc.8 上游修复。
这些是已经坐实的发现，**不是已经完成全覆盖**。
当前已向上游提交的实证包括
[#2708：让仓外插件安全写持久事件](https://github.com/deepseek-ai/deepseek-harness/discussions/2708)
和
[#3076：`llm-pi-ai` 丢 provider compat 字段](https://github.com/deepseek-ai/deepseek-harness/discussions/3076)；
后者已在 rc.8 的 profile schema 中解决。

## Pi 的开放能力在 DSH 上怎么落

Pi 包能碰到的每一个面，以及它落到 DSH 的什么位置。下面这些表是从桥在运行时真正
查的那份规则生成的，所以不会和代码脱节。

针对固定的 Pi 0.84.1，当前生成目录有 **111** 条上游形状的规则行。桥另外保留了一个
兼容扩展 `unregisterTool`；它会出现在工具细表中，但明确不计入这个总数。
`sessionManager` 等嵌套对象仍可能用一行代表多个方法，架构审计会明确写出这层边界。

<!-- capability-table:start -->
| 能力域 | Pi 面数 | 状态 |
|---|---|---|
| [工具](docs/capabilities/tools.md) | 11 | 2 语义一致 · 9 已映射并写明差异 |
| [命令、flag、编辑器输入](docs/capabilities/commands.md) | 13 | 13 已映射并写明差异 |
| [消息、上下文、agent 循环](docs/capabilities/conversation.md) | 20 | 9 语义一致 · 11 已映射并写明差异 |
| [会话与侧边对话](docs/capabilities/sessions.md) | 24 | 7 语义一致 · 17 已映射并写明差异 |
| [模型、provider、凭证](docs/capabilities/models.md) | 15 | 1 语义一致 · 12 已映射并写明差异 · 2 不提供 |
| [向用户提问与渲染](docs/capabilities/interaction.md) | 24 | 5 语义一致 · 19 已映射并写明差异 |
| [项目环境与资源](docs/capabilities/environment.md) | 4 | 1 语义一致 · 1 已映射并写明差异 · 2 不提供 |
| **合计** | **111** | **25 语义一致 · 82 已映射并写明差异 · 4 不提供** |
<!-- capability-table:end -->

另外还有 Pi 三个运行时包（`pi-coding-agent`、`pi-tui`、`pi-ai`）的 **203 个
导入符号**，由 vendored 或 headless shim 提供——所以插件自己钉的 Pi 版本永远不会
被加载，清单见[导入的 Pi 运行时符号](docs/capabilities/imports.md)。

每个能力域页面对每一个面都写清它属于哪个 Pi 能力契约、理论上应落到哪个 DSH 承载
机制与公开 seam、当前代码实际上如何实现。新增接口如果没有能力归属或理论映射，文档
检查会直接失败。

从[能力索引](docs/capabilities/README.md)开始看。机器可读版：`pi2dsh matrix --json`。

**用订阅登录**也能用：DSH 本身只提供静态 HTTP header，桥补上了 Pi 生态的交互式
OAuth 层。任何声明了 `oauth` 块的 Pi provider 包都会得到一条可用的
`/login <provider>`，跑的是这个包自己的协议代码——Pi 官方的四条流程（OpenAI
Codex、Anthropic、GitHub Copilot、Kimi Code）内置；只装好引擎、还没装第一个社区
Pi 包时也能直接使用。凭证按 Pi 的 `auth.json`
语义持久化，并通过标准的 `dsh-credentials` provider 按请求解析，所以你的订阅能
驱动 DSH 原生 llm 路径上的真实调用。细节见[模型](docs/capabilities/models.md)。

**哪些是刻意不提供的**，以及为什么：运行时装包和独立模型运行时属于宿主及其安全
门；provider 的 payload/header/response 拦截应该写成 DSH llm adapter；项目信任
是宿主的决定。见[模型](docs/capabilities/models.md)与
[项目环境](docs/capabilities/environment.md)。

**我们自己欠的那一块**：插件自绘卡片。Pi 插件可以自带渲染器，目前这类注册我们接
下来但不调用，所以这种笔记会显示成原生的上下文注入行——内容你和模型都拿得到，
只是没有插件自己的样式。客户端半边已经在并占着四个座位（侧边对话浮层、头部、
widget 区、working 区）——卡片渲染器正是它还没画的那部分。

## 示例

每一项验证过的能力都配一个完整可跑的 example。example 里的每条命令都在真实 DSH
loop 上实际跑过才会进来。

| 示例 | 你能得到什么 |
|---|---|
| [`vision-bridge`](examples/vision-bridge/) | 纯文本模型回答图片问题——CLI 与 Web 双端，附探针图 |
| [`codex-image-gen`](examples/codex-image-gen/) | 用 ChatGPT/Codex 订阅生图和改图，包含 DSH 上传审批与 Web 内直接显示结果 |
| [`side-conversation`](examples/side-conversation/) | `/btw <问题>` 在 DSH 原生子代理界面里开一条侧边线程，主会话保持干净 |
| [`presentation-surfaces`](examples/presentation-surfaces/) | 真插件（`pi-powerline-footer`）的终端界面画进 DSH Web 座位，附 top50 里哪些 Pi 插件会画界面 |
| [`subscription-login`](examples/subscription-login/) | 用 ChatGPT / Claude / Copilot / Kimi 订阅账号当 DSH 的模型：`/login`、登录后自动建路由与凭证 |
| [`gateway-compat`](examples/gateway-compat/) | 私有 / 国内 / 代理网关拒收 `developer` 角色：rc.8 官方 profile 如何把 Pi compat 声明送到真实请求（附透传录制代理） |
| [`alibaba-token-plan`](examples/alibaba-token-plan/) | 通过原版 Pi provider 使用阿里云百炼 Plan；包含动态 DeepSeek 模型、工具闭环与重启验证 |
| [`custom-gateways`](examples/custom-gateways/) | 按 DSH 官方方式接任何 OpenAI 兼容网关，每个 Pi 插件都能看到它 |
| [`tui-mcp`](examples/tui-mcp/) | 保留 dsh-TUI 原生 `/mcp`，把 Pi 生态管理面作为 `/pi-mcp` 加进来，并让完整的宿主相关 MCP 功能面穿过 DSH 运行时 |
| [`subagents`](examples/subagents/) | 模型自己带小团队：派单、后台、中途转向、收结果、带记忆续命、真停得住、`/pi-agents` 管理、跨重启重开 |

## 其它工具

除了引擎，CLI 还有几个辅助命令：

```sh
npx pi2dsh inspect <包名>@<版本>   # 升级前的兼容性报告
npx pi2dsh matrix --json           # 完整能力矩阵
npx pi2dsh mcp-config              # Pi 的 mcpServers 配置 → DSH 官方 MCP 条目
```

## 开发与验证

```sh
pnpm verify                 # 类型检查 + 契约测试 + 打包检查
pnpm audit:community        # 前 50 静态筛查
pnpm test:community         # 深度运行时 + 官方插件管理器 + e2e
DEEPSEEK_API_KEY=… pnpm test:live    # 真实模型验收（key 只从环境读）
CODEX_AUTH_FILE=… pnpm test:codex-image # 真 OAuth 生图 + 参考图编辑 + Web 像素显示
```

逐项能力的验收证据：[docs/acceptance.md](docs/acceptance.md)。
工作标准：[CLAUDE.md](CLAUDE.md) 与 [docs/STANDARDS.md](docs/STANDARDS.md)。

## 许可

MIT。vendored 的 Pi 源码保留其上游 MIT 许可
（`src/compat/vendor/PI-LICENSE`）；生成的 bundle 保留拷贝过来的上游许可与声明
文件。
