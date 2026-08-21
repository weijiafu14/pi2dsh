# Host ABI 十项能力验收映射

每项能力对应：实现位置 → 公共 API 契约测试 → 真实 DSH 场景证据。
契约测试跑法：`pnpm test`。真实场景证据由 `pnpm audit:community`（静态筛查）、
`node scripts/blackbox-community.mjs [--exercise]`（黑盒加载认证；`--exercise`
进一步用 schema 派生参数真实调用每个包的代表性工具/命令并分级）、`pnpm test:community`
（4 包深链路 + 官方插件管理器）、`DEEPSEEK_API_KEY=… pnpm test:live`
（真实模型）生成，产物在 `community/*.json`。安装形态只有一种：`dsh plugin add
pi2dsh` 装引擎，再 `dsh plugin add <Pi 包>` 直装原包——转换/host bundle 那条路
已整体删除（见 docs/STANDARDS.md）。

| # | 能力 | 实现 | 契约测试 | 真实场景证据 |
|---|---|---|---|---|
| 1 | 工具动态注册、注销、启停 | `src/runtime.ts` `registerTool`/`unregisterTool`/`setActiveTools`（agent 作用域 `tools.restrict`，AsyncLocalStorage 保证单 agent 边界） | `tests/dsh-runtime.spec.ts`（`pi_dynamic_removed` 注销、`setActiveTools` 作用域） | `community/runtime-results.json`（lsp/web/image 工具真执行）；`community/live-deepseek-results.json`（真模型调用 durable 记录） |
| 2 | MCP 配置与能力包 | 两条互不冒充的路径：仅有 `mcpServers` 配置时，`src/mcp-config.ts` + CLI `pi2dsh mcp-config` 把 Pi 六层配置翻译成官方 `@deepseek-ai/dsh-mcp-client` patch；用户显式安装自带 MCP 运行时的 Pi 能力包时，包继续拥有 transport/cache/OAuth/resources/prompts，`src/tui-surfaces.ts` 与公共 Host ABI 只把管理界面、状态、命令、工具、交互、附件与模型回调投影进 DSH。dsh-TUI 原生 `/mcp` 保留，冲突的包命令为 `/pi-mcp` | `tests/mcp-config.spec.ts`（配置路径）；`tests/tui-surfaces.spec.ts`、`tests/tui-extension-contract.spec.ts`（真实公共 Pi API → DSH CommandRuntime → dsh-TUI 公共服务契约，含异步 session_start/reload） | [`docs/mcp-compatibility.md`](mcp-compatibility.md) + `examples/tui-mcp`：干净 profile 从 npm 装真实 `pi-mcp-adapter@2.26.1`，管理 scene、三种 transport、发现、direct/proxy/script、resources/prompts、图片/结构化内容、MCP Apps（AppBridge + DSH subprocess + iframe HTML）、审批、elicitation、sampling、取消、重连与 session restart 全链通过；上游串行 1159/1159、OAuth 137/137、conformance 26/26 |
| 3 | `pi.exec` → DSH 沙箱执行 | `src/runtime.ts` `exec` → `ctx.subprocess`（resolveExecutable + spawn，树级终止；local/E2B 由组合层选择，运行时代码不变） | `tests/dsh-runtime.spec.ts`（`pi_exec_probe` 走 `dsh-subprocess-local` 真子进程） | `community/runtime-results.json`（pi-lsp 经 exec 启动真实 LSP 子进程） |
| 4 | 会话持久化与自定义 entry | `src/session-bridge.ts`：sidecar JSONL（appendEntry/label/name）+ DSH durable log 投影为 Pi entry 链；`ctx.sessionManager` = Pi 精确 14 方法面 | `tests/session-bridge.spec.ts`（跨进程恢复、投影链、context 规则）；`tests/abi-contract.spec.ts` | `community/blackbox-results.json`（依赖 sidecar API 的包真实加载） |
| 5 | sendMessage / sendUserMessage | `src/runtime.ts` → DSH `inject`/`steer`/`followup`（带 plugin 来源标记） | `tests/dsh-runtime.spec.ts`（三种投递逐一断言） | `community/live-deepseek-results.json`（消息进入真实会话日志） |
| 6 | AskUser 原生交互 | `src/runtime.ts` `ui.select/confirm/input/editor` → `ctx.userQuestions.ask`（真等待答案） | `tests/dsh-runtime.spec.ts`（`pi_ask_probe` 收到 provider 答案） | `community/runtime-results.json`（pi-ask-user 包安装并按其 headless 语义答复） |
| 7 | Web、附件、图片 | 图片：`piToDshContent` → `ctx.attachments.saveImage`（引用进日志，不落 base64）；Web：包内实现直通 Node 网络栈 | `tests/dsh-runtime.spec.ts`（`pi_image_probe` 附件真持久化） | `community/runtime-results.json`（rpiv-web-tools 真搜索/抓取；pi-image-gen 生成 PNG 落盘） |
| 8 | Pi TUI 与展示面 | `src/compat/pi-tui.ts`：纯逻辑 vendor 自 Pi（宽度/换行/按键/模糊/键位表字节一致）；无 TUI service 时组件同签名 headless；存在 dsh-TUI 时，`src/tui-surfaces.ts` 把 `ui.custom` 与 `setStatus` 投影到公开 `tuiScenes`/`tuiStatus`，不按包名分支 | `tests/compat-shims.spec.ts`（CJK/ANSI/光标标记宽度、真实按键解析）；`tests/tui-surfaces.spec.ts`、`tests/tui-extension-contract.spec.ts` | `examples/tui-mcp`：真实 `pi-mcp-adapter` 管理器在 dsh-TUI 全屏渲染、接收输入并按生命周期关闭；`community/blackbox-results.json`（无 TUI 壳时依赖 pi-tui 的包仍可加载） |
| 9 | Subagent | `src/subagent-bridge.ts`：`createAgentSession` 经 `ctx.agents` 建**真 DSH 子代理**，Pi 公共 AgentSession 面桥在其上（无 loop factory 的组合显式失败，不伪装） | `tests/subagent-bridge.spec.ts` | `examples/side-conversation` + `community/examples-e2e.json`（侧边会话真实运行） |
| 10 | Provider / 模型 / 凭证 | `setModel`/`setThinkingLevel` → per-agent override 经 `agent/request` waterfall 在下一请求生效；`registerProvider`：带自有 transport 的包注册为**真 DSH adapter**（路由归属裁决），目录型翻译为官方 `llm-pi-ai` profile；真实调用与密钥始终由 DSH `llm`/`credentials` 持有 | `tests/provider-adapter.spec.ts`、`tests/dsh-runtime.spec.ts` | `community/live-deepseek-results.json`（真实模型调用；key 仅环境变量）；`examples/gateway-compat`、`examples/subscription-login` |

## 防"逐包打补丁"的三条硬约束（执行状态）

1. **核心禁止按包名分支**：`src/` 下无任何 `if (packageName === …)`；唯一的包名映射是三个 Pi 宿主包 → shim 的 import 重定向（对所有包一致）。
2. **能力以公共 API 契约测试为准**：`tests/` 每项能力有独立断言，不以"某个插件能加载"作为成功标准。
3. **前 50 只做黑盒验收**：`scripts/blackbox-community.mjs` 输出加载结果与失败归因（`gapHistogram`）；失败只产生公共 ABI 缺口工单，修复后同类包一起受益（示例：jiti 子路径 alias 修复一次性解锁 4 个包，`#imports` 支持一次性摘掉多个包的 fatal 误判）。

## 边界（显式声明，不静默装成功）

每个 Pi 面的**当前真实行为**（含哪些面显式失败）以 [`capabilities/`](capabilities/README.md)
生成页为准，本页不再抄写——本页曾抄的四条边界里有三条后来升级成了真实现
（`createAgentSession` 桥到真 DSH 子代理；`fork`/`navigateTree`/`switchSession` 经
`ctx.sessions` 实现；`compact` 经 `compaction.compactNow` 实现；
`before_provider_request` 的包持传输半边也已桥通），而本页没跟上，正是
"同一事实只写一处"要防的漂移。仍然成立的结构性边界：插件源码 import 宿主基建
符号（`ModelRuntime`/`DefaultPackageManager` 等）在挂载期检测告知，setup 期撞
缺口整包标 unusable（判定顺序见 CLAUDE.md 第三节"能力缺口分级处置"）。

## 给 DSH 上游的能力缺口（本项目实测发现）

编号缺口（`DSH-ARCH-*`）的权威清单在
[`dsh-architecture-conformance.md`](dsh-architecture-conformance.md)，证据细节在
[`dsh-architecture-audit.md`](dsh-architecture-audit.md)，本页不再复述。此外还有
一条未编号的观察：**MCP resources/prompts 消费链路**——官方 mcp-client 只桥接
tools（我们的 mcp-config 翻译因此也只覆盖 tools）。显式安装的 MCP 能力包可以在
自己的运行时与管理面内保留 resources/prompts，但这不等于 DSH 官方客户端已经有了
对应的原生消费 seam。
