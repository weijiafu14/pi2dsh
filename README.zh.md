# pi2dsh

[English](README.md) | **中文**

**打通 Pi 与 DeepSeek Harness 生态。** pi2dsh 致力于连接 [Pi](https://pi.dev/) 的扩展生态与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）：用一层通用的 **Pi Host ABI 兼容层**，让未经修改的 Pi 扩展作为原生 DSH 插件运行——一次开发、批量兼容，不做逐包补丁。

```sh
# 装一次引擎，然后 Pi 包直接从 npm 装
dsh plugin --profile headless add pi2dsh
dsh plugin --profile headless add @kassing/pi-vision
dsh plugin --profile headless add pi-vision-tool
```

没有转换步骤、没有生成产物：引擎自动发现你加进 profile 的每个 Pi 包，
全部经一份桥实例挂载。挂载发生在启动时——**加/卸插件后要重启 `dsh`**。
卸插件用 `dsh plugin remove <包>`（先卸插件再卸引擎，否则插件留在依赖里
没人挂载）；升级引擎 `dsh plugin add pi2dsh@latest`（插件不动），升级
插件 `dsh plugin add <包>@latest`（引擎不动）。

如果 add 报 `ERR_PNPM_IGNORED_BUILDS`（pnpm 默认拦依赖的构建脚本）：
在 profile 的 `pnpm-workspace.yaml` 里把列出的包在 `allowBuilds` 下设为
`true`（或在该目录跑 `pnpm approve-builds`），然后重跑 add。

## 架构

桥只实现**一次** Pi 的公共扩展面，把每个调用映射到 DSH 原生服务。只用公共 API 的包原样运行；无法安全映射的能力显式失败，绝不伪装成功。

```
Pi 包（未经修改的 npm 依赖）
  │  原样加载：default 导出工厂函数，package.json 的 pi.extensions
  ▼
┌────────────────── Pi Host ABI（pi2dsh）─────────────────────┐
│ registerTool / setActiveTools → DSH tools + 按 agent restrict │
│ 33 个 Pi 生命周期事件          → DSH durable 事件与 hook 缝   │
│ exec                          → DSH subprocess（local / E2B） │
│ sendMessage / sendUserMessage → DSH inject / steer / followup │
│ ui.select/confirm/input       → DSH userQuestions（真实等待） │
│ 会话 entry / label / name     → durable sidecar + 日志投影    │
│ 图片                          → DSH attachments（引用非 base64）│
│ pi-tui / pi-coding-agent / pi-ai 导入 → vendored/headless shim │
│   （宽度/按键/会话数学与 Pi 字节一致，MIT 保留版权）           │
│ setModel / setThinkingLevel   → agent/request 缝按 agent 覆盖 │
└────────────────────────────────────────────────────────────────┘
  ▼
DeepSeek Harness 原生服务（Cordis 组合）
```

使用方式：

| 方式 | 作用 |
|---|---|
| **引擎**（默认） | `dsh plugin add pi2dsh` 装一次桥。之后每个 `dsh plugin add` 的 Pi 包都会从 profile 的依赖清单被发现（清单里每一项都是你显式 add 的——绝不扫 node_modules）并经**一份**桥实例挂载：一个模型目录、一个 `/login`、一个凭证存储、一个升级单元 |
| **Host bundle** | 生成一个固定包清单的 DSH bundle——适合钉死版本、可复现的组合 |
| **Convert** | 逐包可审查产物：vendored 源码快照 + 机器可读兼容报告，适合供应链敏感或未发布/本地包 |
| **MCP 配置转换** | Pi 的六层 `mcpServers` 配置 → 官方 `@deepseek-ai/dsh-mcp-client` patch 条目。不运行 pi-mcp-adapter 的代码；`$VAR` 转成 `!!js process.env.VAR`，字面量密钥会告警 |

引擎可选配置（profile 的 `cordis.patch.yml`）：`packages: [a, b]` 只挂
指定清单（跳过发现）；`exclude: [c]` 排除个别依赖。

**插件升级与兼容。** 已装插件的版本被 pnpm lockfile 锁定——插件永远不会
背着你升级，只有显式 `dsh plugin add <包>@latest` 才会动。升级前先跑
`pi2dsh inspect <包>@<版本>` 看兼容报告。桥拦截了 Pi 运行时 import
（`pi-coding-agent`/`pi-tui`/`pi-ai` 由 shim 提供），插件自己锁的 Pi 依赖
版本根本不会被加载——唯一可能咬人的漂移是插件用了桥还没覆盖的 Pi 新
API，这在报告里能看到，运行时也会按包隔离、显式报错。

保持通用性的三条硬规则：

1. 核心**没有任何 `if (packageName === …)`** 包名分支。
2. 每项能力有**公共 API 契约测试**（`pnpm test`，55 个）；"某个插件能加载"从不作为成功标准。
3. 前 50 只做**黑盒验收**：失败产生公共 ABI 缺口工单，修一个缺口、同类包一起解锁（例：一次 jiti 子路径 alias 修复同时解锁 4 个包）。

## 进度：Pi 官方目录下载量前 50

以 2026-08-14 为准。静态分析只做筛查，黑盒真跑才算认证。逐包机器可读证据在 [community/](community/)。

| 档位 | 数量 | 含义 |
|---|---|---|
| ✅ **已测可用** | **49 / 50** | 在真实 DSH runtime 挂载且**真实执行**验证：42 个成功返回，7 个业务逻辑端到端真跑（拒绝了合成探针参数）；49 个中有 2 个经 host 模式验证。一路覆盖的真实服务包括：真 LSP 子进程、真搜索/抓取、PNG 真落盘、真 MCP stdio server 端到端桥接、真子 `pi` 进程派发并由真实模型应答、用真实凭证跑 DeepSeek 搜索、官方 `dsh plugin` 安装/激活/卸载全流程 |
| 🟡 **能接入、未全测** | **1 / 50** | `@alexanderfortin/pi-deepseek-usage`——纯事件钩子包：4 个生命周期订阅全部接上，但每个 handler 都以"当前在 DeepSeek 模型会话中"为门槛（它拉计费用量并渲染 footer），黑盒探针没有可安全触发并断言的调用面。这是探针方法论的边界，不是包或桥的缺口 |
| ❌ **尚未接入** | **0 / 50** | 最后 4 个 Pi 内部运行时包已全部桥接：内建工具构造器 vendored、provider 工厂、真语义 `ExtensionRunner` 门面、`createAgentSession` 驱动真实 DSH 子代理 |
| **今天即可挂载** | **50 / 50** | 48 个经 convert/host bundle 直接挂载；2 个快照受限包经 host 模式（[证据](community/host-mode-results.json)） |

v6 版黑盒装置同时强化了探测方法论本身：桥自带的宿主固有面（例如内建的 `/login` 命令）通过挂载一个零贡献 fixture 扩展测出，并从每个包的探测面里扣除——档位只反映包自己的增量；不安全工具名筛查改为分词级匹配（`litellm_skill_list` 不是 "kill" 工具）；fixture 环境提供真 MCP stdio server、LiteLLM 网关形状的 skills API、按 Pi config-dir 约定放置的图像模型配置，以及（经 `PI2DSH_BLACKBOX_PI_BIN` + `DEEPSEEK_API_KEY` 显式开启）由真实模型应答的子 `pi` 派发。

另有两层验证：**host bundle** 合装两个原样 Pi 包走完官方插件管理器全流程；**真实模型**（deepseek-v4-flash）调用迁移后的 Pi 工具，durable 会话日志逐项断言、凭证零落盘（[证据](community/live-deepseek-results.json)）。

### 最后 4 个内部运行时包是怎么桥接的

每个都落成了可复用的公共面桥，不是逐包补丁：`pi-landstrip` 与 `pi-fabric` 跑在 vendored 字节级的 Pi 内建工具构造器上（bash/read/edit/write/grep/find/ls 及其纯逻辑闭包）；`pi-provider-litellm` 跑在 vendored 的 pi-ai `createProvider` 工厂上——provider 按 `id` 入注册表，注册表的 `getProviderAuth` 跑 Pi 完整凭证链（已存 OAuth → 已存 key → 包自己的环境变量解析），模型传输始终归 DSH llm 原生；`pi-fabric` 另挂真语义 `ExtensionRunner` 门面——patch `prototype.getAllRegisteredTools` 能真实过滤工具目录，与 Pi 下行为一致；`@tintinweb/pi-subagents` 跑在 `createAgentSession` → 真实 DSH 子代理桥上（经 `ctx.agents` 走宿主 loop 工厂）——桥不自带模型循环，无 loop 的组合显式失败，绝不假装跑了子代理。

### 筛查器如何判定兼容性

筛查器区分**加载期与惰性可达**：只有加载期静态闭包上解析不了的依赖才会阻断一个包——函数体内的动态 import、仅经动态 import 可达的文件、worker/数据资源都是惰性路径，与 Pi 下行为完全一致，只标记为可审阅、绝不判死。`bun:*` 与 `node:*` 同等对待（Pi 官方发行版是 Bun 编译二进制的宿主内建），快照逐字节保留发布文件布局。这些规则有契约测试钉着；在这套规则下，混用 Bun 分支、可选重依赖、打包器生成 worker 路径的包——`pi-hermes-memory`、`@mjasnikovs/pi-task`、`pi-harness-runtime`、`mitsupi`、`pi-lens`——全部按发布原样挂载可用，上游无需任何改动。

### 路线图

1. ✅ 已完成：9 个"能接入、未全测"提级——8 个达到已测可用（带凭证的 fixture、真 MCP stdio server、userQuestions 的 live agent 探针链路、Pi config-dir 配置、真子 `pi` 派发，外加桥内两处注册表语义修正：provider 按 `id` 入表、`getProviderAuth` 跑 Pi 完整凭证链而非仅 OAuth）；剩下 1 个是纯事件钩子包，如实定档为无可探测面。
2. ✅ 已完成：交互式 OAuth host seam——Pi provider 的 `oauth.login/refreshToken/getApiKey` 流跑在 DSH 原生交互上，凭证按 Pi `auth.json` 语义持久化并带双检锁刷新，四条官方流内建；已用真实 ChatGPT Pro 账号端到端验证（见上文"交互式 OAuth"）。
3. ✅ 已完成：4 个 Pi 内部运行时包全部桥接（见上）——前 50 全部可挂载。
4. ✅ 已完成：2 个快照受限包经 host 模式实测通过（[证据](community/host-mode-results.json)）。
5. ✅ 已完成：加载期/惰性可达筛查规则落地；由此解锁的 5 个包全部可挂载、4 个已测可用（见上）。

## 快速开始

需要 Node.js 22.19+ 与 DeepSeek Harness。

```sh
# 引擎（默认）：装一次，然后直接加 Pi 包
dsh plugin --profile headless add pi2dsh
dsh plugin --profile headless add @kassing/pi-vision

# 可选 CLI（inspect / convert / host / mcp-config）
npx pi2dsh inspect @narumitw/pi-lsp                 # 兼容报告
npx pi2dsh convert @narumitw/pi-lsp --out ./dsh-pi-lsp   # vendored 快照
npx pi2dsh host --packages 'pi-simplify' --out ./pi-host # 钉版本 bundle
npx pi2dsh mcp-config                               # Pi mcpServers → DSH patch
```

## Examples：每个能力都有完整可跑的示例

**每个已验证的能力，都在 [`examples/`](examples/) 下有一份完整可直接运行的示例**——克隆仓库，照任意一个示例的 README 从零走到看到效果。示例里的每条命令都在真实 DSH loop（CLI 和 Web 双端）上实际执行过才收录，没有"理论上可以"的内容。

| 示例 | 你得到什么 |
|---|---|
| [`examples/vision-bridge`](examples/vision-bridge/) | 纯文本模型回答图片问题：消息里带图片路径，配置的视觉模型识图，分析结果注入对话（CLI 与 DSH Web 都能用；附探针测试图） |
| [`examples/custom-models`](examples/custom-models/) | 在 Pi 标准 `models.json` 里定义一次 provider——它成为原生 DSH llm 路由：出现在 DSH Web 模型选择器、可当主模型对话、所有 Pi 插件经同一个目录可见可调 |

更多已验证能力（审批 guardian、跨会话记忆、交互式 OAuth、MCP 配置转换、host 模式）的示例，将按同一标准逐个重新端到端验证后补齐。

## 交互式 OAuth：用你的订阅账号登录

DSH 原生只有静态 HTTP headers；pi2dsh 把 Pi 生态的交互式 OAuth 层带了过来。任何注册了 `oauth` 块的 Pi provider 包，在 DSH 上都直接获得可用的 `/login <provider>` 命令，登录流程由包自己的协议代码驱动。Pi 的四条官方流内建（vendored 字节级）：**OpenAI Codex（ChatGPT Plus/Pro）**、**Anthropic**、**GitHub Copilot**、**Kimi Code**。

```sh
# 在挂载了 pi2dsh host bundle 的 DSH 会话里
/login openai-codex     # 打印授权 URL，同时拉起 localhost 回调服务
# → 浏览器里点击授权；凭证落盘 auth.json（0600）
```

端到端你得到的是：PKCE + `localhost:1455` 回调（无头环境有 device-code 备选）、凭证按 Pi 的 `auth.json` 格式持久化——所以 `@narumitw/pi-accounts` 这类包管理的就是它们熟悉的同一份文件——自动刷新走 Pi 的双检锁轮换（5 分钟过期窗口，轮换后的 token 先落盘再放锁）、扩展注册表的 `getProviderAuth`/`getApiKeyForProvider` 返回真实可用的 key。

**而且 token 直接驱动 DSH 原生链路的真实模型调用。** `pi2dsh/credentials-oauth` 是一个标准 `dsh-credentials` provider：形如 `PI2DSH_OAUTH_<PROVIDER>` 的引用每次请求都从 `auth.json` 解析（途中跑刷新轮换），其余引用回落环境变量。把官方 `@deepseek-ai/dsh-llm-pi-ai` 的 route 指向它，`ctx.llm.stream()` 就跑在你的订阅上：

```yaml
- id: llm
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openai-codex:
        apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX
        models:
          - id: gpt-5.6-luna
```

两层都已用真实 ChatGPT Pro 账号验证：浏览器授权 → 回调 → 换 token → 落盘 → 可刷新的 key（`scripts/verify-oauth-e2e.mjs`），然后 credentials provider → 官方 pi-ai route → DSH 原生 `ctx.llm.stream()` → 订阅上的真实模型回复（`scripts/verify-oauth-llm-e2e.mjs`）。需要代理的网络下两个脚本都尊重 `HTTPS_PROXY`。

## 兼容边界（显式声明，绝不静默）

| 领域 | 映射 |
|---|---|
| 工具 | 原生 DSH 工具；Pi 的 `tool_call` 原地改参对 Pi 自有工具生效（DSH 原生工具拒绝——DSH 有意先记日志后跑策略） |
| 会话 | 消息从 DSH durable 日志投影；Pi 自定义 entry/label/name 持久化在 pi2dsh sidecar（DSH 目前没有第三方插件事件通道） |
| Pi TUI | 纯逻辑 vendored 字节一致；组件类同签名 headless 构造；`ui.custom` 与 Pi 官方 rpc 模式一样返回 undefined |
| Provider/OAuth | 交互式 OAuth 已可用：`/login <provider>` 跑包自己的流程，凭证按 Pi `auth.json` 持久化并自动刷新；模型传输仍由 DSH `llm` 原生持有 |
| 模型运行时 | `modelRegistry` 把 DSH llm 实时目录投影为 Pi Model 对象（`llm/adapters-updated` 时刷新）；`ctx.model` 反映 agent 真实路由；`setModel`/`setThinkingLevel` 经 `agent/request` waterfall 真切换 loop；pi-ai `complete()`/`stream()` 经 `ctx.llm.stream()` 发起**真实**模型调用并双向转换消息（已对真实模型验证：`scripts/verify-model-bridge-e2e.mjs`） |
| 会话树写操作 | `fork`/`navigateTree`/`switchSession` 显式失败（DSH 官方将 pi 式 entry tree 列为 deferred） |
| 终端装饰 | footer/statusline/快捷键注册成功但永不触发——与 Pi 自己的非 TUI 模式一致 |

完整机器可读矩阵：`pi2dsh matrix --json`。十项能力逐项验收证据：[docs/acceptance.md](docs/acceptance.md)。114 项 Pi 暴露面 → DSH 语义完整判决（红 3 / 黄 21 / 绿约 90）：[docs/pi-abi-coverage.md](docs/pi-abi-coverage.md)。

## 开发与验证

```sh
pnpm verify                                   # 类型检查 + 55 契约测试 + 打包检查
pnpm audit:community                          # 前 50 静态筛查
node scripts/blackbox-community.mjs community/blackbox-results.json --exercise
#   前缀 DEEPSEEK_API_KEY=… PI2DSH_BLACKBOX_PI_BIN=$(command -v pi) 可开启
#   带凭证探测与真子 pi 派发（key 仅从环境读）
pnpm test:community                           # 深链路 + 官方插件管理器 + host e2e
DEEPSEEK_API_KEY=… pnpm test:live             # 真实模型验收（key 仅从环境读）
```

## License

MIT。Vendored 的 Pi 源码保留其上游 MIT 许可（`src/compat/vendor/PI-LICENSE`）；生成的 bundle 保留上游 license/notice 文件。
