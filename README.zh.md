# pi2dsh

[English](README.md) | **中文**

**打通 Pi 与 DeepSeek Harness 生态。** pi2dsh 致力于连接 [Pi](https://pi.dev/) 的扩展生态与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）：用一层通用的 **Pi Host ABI 兼容层**，让未经修改的 Pi 扩展作为原生 DSH 插件运行——一次开发、批量兼容，不做逐包补丁。

```sh
# 一个 bundle 装任意 Pi 包，零转换
pi2dsh host --packages '@juicesharp/rpiv-web-tools@2.4.0,pi-simplify@0.2.3' --out ./my-pi-host
dsh plugin --profile headless add file:$PWD/my-pi-host
```

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

三种使用方式：

| 方式 | 作用 |
|---|---|
| **Host bundle**（推荐） | 单一可安装 DSH bundle，把任意 Pi 包列表作为普通 npm 依赖挂载 |
| **Convert** | 逐包可审查产物：vendored 源码快照 + 机器可读兼容报告，适合供应链敏感场景 |
| **MCP 配置转换** | Pi 的六层 `mcpServers` 配置 → 官方 `@deepseek-ai/dsh-mcp-client` patch 条目。不运行 pi-mcp-adapter 的代码；`$VAR` 转成 `!!js process.env.VAR`，字面量密钥会告警 |

保持通用性的三条硬规则：

1. 核心**没有任何 `if (packageName === …)`** 包名分支。
2. 每项能力有**公共 API 契约测试**（`pnpm test`，41 个）；"某个插件能加载"从不作为成功标准。
3. 前 50 只做**黑盒验收**：失败产生公共 ABI 缺口工单，修一个缺口、同类包一起解锁（例：一次 jiti 子路径 alias 修复同时解锁 4 个包）。

## 进度：Pi 官方目录下载量前 50

以 2026-08-14 为准。静态分析只做筛查，黑盒真跑才算认证。逐包机器可读证据在 [community/](community/)。

| 档位 | 数量 | 含义 |
|---|---|---|
| ✅ **已测可用** | **32 / 50** | 在真实 DSH runtime 挂载且**真实执行**验证：29 个成功返回，3 个业务逻辑端到端真跑（拒绝了合成探针参数）；其中 4 个另通过深度验证：真 LSP 子进程、真搜索/抓取、PNG 真落盘、官方 `dsh plugin` 安装/激活/卸载全流程 |
| 🟡 **能接入、未全测** | **7 / 50** | 在真实 DSH runtime 加载并注册出工具/命令/skill；完整执行还需用户凭证或外部服务（3 个）、纯事件钩子包没有可探测调用面（3 个）、测试装置限制（1 个：userQuestions 严格校验 live agent 身份——同一链路在深度验证层已通过） |
| ❌ **尚未接入** | **11 / 50** | 逐个归因见下——全部在路线图上 |
| **今天即可挂载** | **39 / 50** | |

另有两层验证：**host bundle** 合装两个原样 Pi 包走完官方插件管理器全流程；**真实模型**（deepseek-v4-flash）调用迁移后的 Pi 工具，durable 会话日志逐项断言、凭证零落盘（[证据](community/live-deepseek-results.json)）。

### 尚未接入的 11 个，逐个归因

**依赖 Pi 内部运行时（4 个）——需要专用适配，路线图下一步：**
`@tintinweb/pi-subagents`（加载即调 `createAgentSession`/`createCodingTools`）、`pi-landstrip`（调 `createBashToolDefinition` 等 Pi 内建工具构造器）、`pi-provider-litellm`（要 Pi 的 provider SDK 工厂；DSH 里模型路由属于原生 llm adapter 职权）、`pi-fabric`（用 `wrapRegisteredTool` 内部 API + 引用发布包里根本不存在的构建期生成文件）。

**包自身缺陷，换任何宿主都一样（5 个）——将向上游提 issue：**
`pi-lens`（资源清单越界逃出包根）、`pi-hermes-memory` 与 `@mjasnikovs/pi-task`（Bun 专属 `bun:sqlite`）、`pi-harness-runtime`（import 了未声明的 playwright）、`mitsupi`（import 了未声明的 googleapis/ws）。

**Convert 快照模式限制（2 个）——host 模式已可覆盖：**
`pi-hashline-edit-pro`、`pi-interview`（运行时读包内文件，静态闭包证不出来；host bundle 保留整包目录即可用）。

### 路线图：50 个全部接入

1. 把 7 个"能接入、未全测"提升为"已测可用"（带凭证的 fixture、按包定制探针参数）。
2. 做 Pi 内部 `AgentSession`/工具构造器面 → DSH 原生服务的桥，解锁 4 个内部运行时包。
3. 给 5 个包缺陷向上游提 issue，跟进修复。
4. 2 个快照受限包默认走 host 模式。

## 快速开始

需要 Node.js 22.19+ 与 DeepSeek Harness。

```sh
git clone https://github.com/weijiafu14/pi2dsh.git && cd pi2dsh
corepack pnpm@11.7.0 install && pnpm build

node dist/cli.mjs inspect @narumitw/pi-lsp          # 兼容报告
node dist/cli.mjs convert @narumitw/pi-lsp --out ./dsh-pi-lsp
node dist/cli.mjs host --packages 'pi-simplify' --out ./pi-host
node dist/cli.mjs mcp-config                        # Pi mcpServers → DSH patch
dsh plugin --profile headless add file:$PWD/pi-host
```

## 兼容边界（显式声明，绝不静默）

| 领域 | 映射 |
|---|---|
| 工具 | 原生 DSH 工具；Pi 的 `tool_call` 原地改参对 Pi 自有工具生效（DSH 原生工具拒绝——DSH 有意先记日志后跑策略） |
| 会话 | 消息从 DSH durable 日志投影；Pi 自定义 entry/label/name 持久化在 pi2dsh sidecar（DSH 目前没有第三方插件事件通道） |
| Pi TUI | 纯逻辑 vendored 字节一致；组件类同签名 headless 构造；`ui.custom` 与 Pi 官方 rpc 模式一样返回 undefined |
| Provider/OAuth | 声明被记录；传输与密钥始终由 DSH `llm`/`credentials` 原生持有 |
| 会话树写操作 | `fork`/`navigateTree`/`switchSession` 显式失败（DSH 官方将 pi 式 entry tree 列为 deferred） |
| 终端装饰 | footer/statusline/快捷键注册成功但永不触发——与 Pi 自己的非 TUI 模式一致 |

完整机器可读矩阵：`pi2dsh matrix --json`。十项能力逐项验收证据：[docs/acceptance.md](docs/acceptance.md)。

## 开发与验证

```sh
pnpm verify                                   # 类型检查 + 41 契约测试 + 打包检查
pnpm audit:community                          # 前 50 静态筛查
node scripts/blackbox-community.mjs community/blackbox-results.json --exercise
pnpm test:community                           # 深链路 + 官方插件管理器 + host e2e
DEEPSEEK_API_KEY=… pnpm test:live             # 真实模型验收（key 仅从环境读）
```

## License

MIT。Vendored 的 Pi 源码保留其上游 MIT 许可（`src/compat/vendor/PI-LICENSE`）；生成的 bundle 保留上游 license/notice 文件。
