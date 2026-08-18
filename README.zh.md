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

这是桥，不是终点。你在这里用到的每一项能力，DSH 自己的生态早晚都会有原生实现；
哪天某个能力出现了更原生、更好的插件，你就应该换过去——那正说明这座桥起到了作用。

## 安装

一次引擎，之后想装谁装谁：

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @kassing/pi-vision
```

然后**重启 `dsh`**——插件在启动时挂载。

> **profile 名字请用 `web` 或 `headless`。** DSH 只为这两个名字内置了模板，
> 每个都带一个界面层（网页应用 / 一次性执行器）。`dsh plugin --profile <别的
> 名字>` 建出来的 profile **没有任何界面层**，起来之后会**直接挂住、不报任何
> 错**——这跟 pi2dsh 无关，但第一次装的时候很容易撞上。确实想用别的名字，就
> 自己往它的 `dsh.profile.bundles` 里加界面 bundle。

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

## 走一遍：让纯文本模型能看图

这个例子最能说明这座桥值什么。DeepSeek 系列是纯文本模型，DSH 没法把图片发给它。
Pi 生态里正好有插件干这件事：把图片交给你指定的视觉模型，再把分析结果注入回对话。

### 1. 装插件

```sh
dsh plugin --profile web add @kassing/pi-vision
```

### 2. 给它配一个多模态模型

**这一步是关键**——插件需要它自己的视觉模型，这个模型和你聊天用的那个不是同一个。
任何 OpenAI 兼容的视觉端点都行（OpenRouter、DashScope/Qwen-VL、自建 vLLM……）。

插件从环境变量读自己的配置——这是 Pi 插件生态的主流做法，对你来说就是一个纯粹的
DSH 侧动作：

```sh
export VISION_BRIDGE_BASE_URL=https://openrouter.ai/api/v1
export VISION_BRIDGE_MODEL=qwen/qwen2.5-vl-72b-instruct
export VISION_BRIDGE_API_KEY=$OPENROUTER_API_KEY
```

配到这里就能用了。如果你还想让这个视觉模型出现在 DSH 自己的模型选择器里（这样
你也能直接和它聊），就再把它按普通 DSH 路由配一份——`$DSH_HOME/settings.yaml`
的 `llm-pi-ai:` 段：

```yaml
llm-pi-ai:
  providers:
    openrouter:
      baseUrl: https://openrouter.ai/api/v1
      apiKeyEnv: OPENROUTER_API_KEY
      models:
        - id: qwen/qwen2.5-vl-72b-instruct
```

这两处都是普通的 DSH 配置。桥自己不持有任何模型配置，也没有任何需要你手写的
Pi 格式文件。

视觉后端别选 GPT-5/o 系列：那一代模型会拒绝非默认的 `temperature`，而有些视觉
插件会带这个参数。

### 3. 问一张图

CLI 里直接提路径：

```sh
dsh --profile web "$PWD/photo.png 这张图是什么颜色？只答一个词。"
```

Web 里**直接粘图**——哪怕你的主模型是纯文本的。DSH 正常情况下会拒绝给纯文本模型
上传图片，所以引擎会给模型目录里**每一个纯文本路由**自动注册一个贴图伴生路由，
名字是 `<路由>-vision`。在模型选择器里选它（显示为 “+ Vision Bridge” 分组），
粘图，提问。

你会看到：你消息里的图片块变成引导文本，一行 `pi2dsh:@kassing/pi-vision` 的
上下文注入带着分析结果，然后你的纯文本模型照常回答图片内容。像素从没进过纯文本
那条线。

伴生路由是全自动的。想关掉、或者只给某些路由开，在引擎的插件配置里设
`visionCompanions`（`$DSH_HOME/profiles/web/cordis.patch.yml`）：

```yaml
- id: pi2dsh
  config:
    visionCompanions: false
```

完整可跑版本（含纯色探针图）：[`examples/vision-bridge`](examples/vision-bridge/)。

## 现在到底哪些真能用

分两级，这两件事不是一回事。

### 第一级——端到端实测过，配可跑示例

有人真坐下来，在真实 DSH loop 上用了这个插件的真功能，亲眼看到它工作。
**要信就信这张表。**

| 插件 | 验证了什么 | 在哪验的 | 示例 |
|---|---|---|---|
| [`@kassing/pi-vision`](https://www.npmjs.com/package/@kassing/pi-vision) | 图片委托给视觉模型；贴图伴生路由；分析结果注入纯文本模型的这一轮 | CLI + Web | [`vision-bridge`](examples/vision-bridge/) |
| [`pi-btw`](https://www.npmjs.com/package/pi-btw) | `/btw <问题>` 跑成 DSH 子代理界面里的真子会话；`/btw-inject`；`/btw --save`；主会话保持干净 | CLI + Web | [`side-conversation`](examples/side-conversation/) |
| [`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) | 终端状态条（模型、思考档位、项目、上下文用量）画进 DSH 的 widget dock，带颜色 | Web | [`presentation-surfaces`](examples/presentation-surfaces/) |
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
| **子代理与后台任务** | `@tintinweb/pi-subagents` · `@gotgenes/pi-subagents` · `pi-background-tasks`² · `@mjasnikovs/pi-task` |
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

- **DSH 已经有的东西，绝不再造一遍。** 工具进 DSH 的工具注册表，模型进 DSH 的
  llm 配置，MCP 交给 `dsh-mcp-client`，skills 交给 `dsh-skill-filesystem`，
  提问交给 DSH 的 user questions。桥做的是配置翻译，不是另起一套运行时。
- **你面前永远没有 Pi。** 你要配的、要读的、要敲的，全是 DSH 形状：DSH 设置、
  DSH 命令、DSH 凭证。Pi 的词汇只活在插件自己的视野和桥的内部实现里。
- **零逐包特判。** 核心里没有任何 `if (packageName === …)`。修一个 ABI 缺口，
  撞上它的包一起解锁。
- **绝不伪装成功。** 映射不了的能力会**如实告诉你**——同一个插件同一项能力只提示
  一次，讲人话。如果某个插件在启动期就需要这样一项能力，它会被整包标成不可用并
  给出卸载建议，而不是半死不活地跑着。
- **验证过才算数。** 每项能力都有公开 API 契约测试，并且必须在真实 DSH loop 上
  端到端跑通——CLI **和** Web 双端——才会发布。

## Pi 的开放能力在 DSH 上怎么落

Pi 包能碰到的每一个面，以及它落到 DSH 的什么位置。下面这些表是从桥在运行时真正
查的那份规则生成的，所以不会和代码脱节。

<!-- capability-table:start -->
| 能力域 | Pi 面数 | 状态 |
|---|---|---|
| [工具](docs/capabilities/tools.md) | 12 | 3 语义一致 · 9 已映射并写明差异 |
| [命令、flag、编辑器输入](docs/capabilities/commands.md) | 13 | 13 已映射并写明差异 |
| [消息、上下文、agent 循环](docs/capabilities/conversation.md) | 20 | 9 语义一致 · 11 已映射并写明差异 |
| [会话与侧边对话](docs/capabilities/sessions.md) | 24 | 6 语义一致 · 18 已映射并写明差异 |
| [模型、provider、凭证](docs/capabilities/models.md) | 15 | 1 语义一致 · 11 已映射并写明差异 · 3 不提供 |
| [向用户提问与渲染](docs/capabilities/interaction.md) | 24 | 4 语义一致 · 20 已映射并写明差异 |
| [项目环境与资源](docs/capabilities/environment.md) | 4 | 1 语义一致 · 1 已映射并写明差异 · 2 不提供 |
| **合计** | **112** | **24 语义一致 · 83 已映射并写明差异 · 5 不提供** |
<!-- capability-table:end -->

另外还有 Pi 三个运行时包（`pi-coding-agent`、`pi-tui`、`pi-ai`）的 **202 个
导入符号**，由 vendored 或 headless shim 提供——所以插件自己钉的 Pi 版本永远不会
被加载，清单见[导入的 Pi 运行时符号](docs/capabilities/imports.md)。

每个能力域页面对每一个面都写两件事：它在 DSH 上做什么，以及**它是怎么实现的**
——这条映射落在哪个 DSH seam、服务或 waterfall 上，好让读者能对着 harness 核实，
而不是只能选择相信。

从[能力索引](docs/capabilities/README.md)开始看。机器可读版：`pi2dsh matrix --json`。

**用订阅登录**也能用：DSH 本身只提供静态 HTTP header，桥补上了 Pi 生态的交互式
OAuth 层。任何声明了 `oauth` 块的 Pi provider 包都会得到一条可用的
`/login <provider>`，跑的是这个包自己的协议代码——Pi 官方的四条流程（OpenAI
Codex、Anthropic、GitHub Copilot、Kimi Code）内置。凭证按 Pi 的 `auth.json`
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
| [`side-conversation`](examples/side-conversation/) | `/btw <问题>` 在 DSH 原生子代理界面里开一条侧边线程，主会话保持干净 |
| [`presentation-surfaces`](examples/presentation-surfaces/) | 真插件（`pi-powerline-footer`）的终端界面画进 DSH Web 座位，附 top50 里哪些 Pi 插件会画界面 |
| [`subscription-login`](examples/subscription-login/) | 用 ChatGPT / Claude / Copilot / Kimi 订阅账号当 DSH 的模型：`/login`、登录后自动建路由与凭证 |
| [`gateway-compat`](examples/gateway-compat/) | 私有 / 国内 / 代理网关拒收 `developer` 角色：为什么一开推理就 400，以及用 Pi provider 插件怎么绕过去（附透传录制代理，能看到我们真正发出去的请求体） |
| [`custom-gateways`](examples/custom-gateways/) | 按 DSH 官方方式接任何 OpenAI 兼容网关，每个 Pi 插件都能看到它 |

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
```

逐项能力的验收证据：[docs/acceptance.md](docs/acceptance.md)。
工作标准：[CLAUDE.md](CLAUDE.md) 与 [docs/STANDARDS.md](docs/STANDARDS.md)。

## 许可

MIT。vendored 的 Pi 源码保留其上游 MIT 许可
（`src/compat/vendor/PI-LICENSE`）；生成的 bundle 保留拷贝过来的上游许可与声明
文件。
