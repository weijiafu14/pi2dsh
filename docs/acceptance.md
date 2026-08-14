# Host ABI 十项能力验收映射

每项能力对应：实现位置 → 公共 API 契约测试 → 真实 DSH 场景证据。
契约测试跑法：`pnpm test`。真实场景证据由 `pnpm audit:community`（静态筛查）、
`node scripts/blackbox-community.mjs`（黑盒加载认证）、`pnpm test:community`
（4 包深链路 + host bundle + 官方插件管理器）、`DEEPSEEK_API_KEY=… pnpm test:live`
（真实模型）生成，产物在 `community/*.json`。

| # | 能力 | 实现 | 契约测试 | 真实场景证据 |
|---|---|---|---|---|
| 1 | 工具动态注册、注销、启停 | `src/runtime.ts` `registerTool`/`unregisterTool`/`setActiveTools`（agent 作用域 `tools.restrict`，AsyncLocalStorage 保证单 agent 边界） | `tests/dsh-runtime.spec.ts`（`pi_dynamic_removed` 注销、`setActiveTools` 作用域） | `community/runtime-results.json`（lsp/web/image 工具真执行）；`community/live-deepseek-results.json`（真模型调用 durable 记录） |
| 2 | MCP 生命周期与配置映射 | `src/mcp-config.ts` + CLI `pi2dsh mcp-config`：Pi 六层 `mcpServers` → 官方 `@deepseek-ai/dsh-mcp-client` patch 条目；**不运行 pi-mcp-adapter** | `tests/mcp-config.spec.ts`（层级优先级、disabled 翻转、`$VAR → !!js process.env`、字面量密钥告警） | 转换产物直接由 DSH 官方 MCP 客户端消费（stdio 与 streamable-http 均为官方实现） |
| 3 | `pi.exec` → DSH 沙箱执行 | `src/runtime.ts` `exec` → `ctx.subprocess`（resolveExecutable + spawn，树级终止；local/E2B 由组合层选择，运行时代码不变） | `tests/dsh-runtime.spec.ts`（`pi_exec_probe` 走 `dsh-subprocess-local` 真子进程） | `community/runtime-results.json`（pi-lsp 经 exec 启动真实 LSP 子进程） |
| 4 | 会话持久化与自定义 entry | `src/session-bridge.ts`：sidecar JSONL（appendEntry/label/name）+ DSH durable log 投影为 Pi entry 链；`ctx.sessionManager` = Pi 精确 14 方法面 | `tests/session-bridge.spec.ts`（跨进程恢复、投影链、context 规则）；`tests/abi-contract.spec.ts` | `community/blackbox-results.json`（依赖 sidecar API 的包真实加载） |
| 5 | sendMessage / sendUserMessage | `src/runtime.ts` → DSH `inject`/`steer`/`followup`（带 plugin 来源标记） | `tests/dsh-runtime.spec.ts`（三种投递逐一断言） | `community/live-deepseek-results.json`（消息进入真实会话日志） |
| 6 | AskUser 原生交互 | `src/runtime.ts` `ui.select/confirm/input/editor` → `ctx.userQuestions.ask`（真等待答案） | `tests/dsh-runtime.spec.ts`（`pi_ask_probe` 收到 provider 答案） | `community/runtime-results.json`（pi-ask-user 包安装并按其 headless 语义答复） |
| 7 | Web、附件、图片 | 图片：`piToDshContent` → `ctx.attachments.saveImage`（引用进日志，不落 base64）；Web：包内实现直通 Node 网络栈 | `tests/dsh-runtime.spec.ts`（`pi_image_probe` 附件真持久化） | `community/runtime-results.json`（rpiv-web-tools 真搜索/抓取；pi-image-gen 生成 PNG 落盘） |
| 8 | Pi TUI 无界面壳 | `src/compat/pi-tui.ts`：纯逻辑全部 vendor 自 Pi（宽度/换行/按键/模糊/键位表字节一致）；组件类同签名 headless；`ui.custom` 对齐 Pi 官方 rpc 语义返回 undefined | `tests/compat-shims.spec.ts`（CJK/ANSI/光标标记宽度、真实按键解析）；`tests/abi-contract.spec.ts`（矩阵↔导出一致性） | `community/blackbox-results.json`（依赖 pi-tui 导出的包批量加载） |
| 9 | Subagent | DSH 原生 `ctx.subagents` 在组合中可用；Pi 公共 API 无 subagent 概念——社区包经 `createAgentSession` 等 **Pi 内部运行时** 自建，该面为显式失败 stub（见下方"边界"） | `tests/abi-contract.spec.ts`（stub 显式失败且不 crash 加载） | `community/blackbox-results.json` 中此类包的失败被归因为内部 API 依赖证据 |
| 10 | Provider / 模型 / 凭证 | `setModel`/`setThinkingLevel` → per-agent override 经 `agent/request` waterfall 在下一请求生效；`registerProvider` 声明被记录；真实调用与密钥始终由 DSH `llm`/`credentials` 持有 | `tests/dsh-runtime.spec.ts`（thinking 全局默认、加载期语义） | `community/live-deepseek-results.json`（真实 DeepSeek 调用；key 仅环境变量，证据文件含无泄漏断言） |

## 防"逐包打补丁"的三条硬约束（执行状态）

1. **核心禁止按包名分支**：`src/` 下无任何 `if (packageName === …)`；唯一的包名映射是三个 Pi 宿主包 → shim 的 import 重定向（对所有包一致）。
2. **能力以公共 API 契约测试为准**：`tests/` 每项能力有独立断言，不以"某个插件能加载"作为成功标准。
3. **前 50 只做黑盒验收**：`scripts/blackbox-community.mjs` 输出加载结果与失败归因（`gapHistogram`）；失败只产生公共 ABI 缺口工单，修复后同类包一起受益（示例：jiti 子路径 alias 修复一次性解锁 4 个包，`#imports` 支持一次性摘掉多个包的 fatal 误判）。

## 边界（显式声明，不静默装成功）

- **Pi 内部运行时**（`createAgentSession`、`createCodingTools`、`wrapRegisteredTool`、`DefaultResourceLoader` 等）：可 import、构造/调用时显式报错。依赖它们实现核心功能的包属于用户预判的"少量专用适配"范围。
- **会话树写操作**（`fork`/`navigateTree`/`switchSession`）：DSH 官方将 pi 式 entry tree 列为 deferred；这些调用显式失败，观察型树事件注册被接受但不触发。
- **compaction 主动控制**（`ctx.compact()`）：显式失败；压缩事件从 DSH durable log 投影为通知。
- **provider 请求改写**（`before_provider_request/headers`、`context`）：属于 DSH LLM adapter 职权，handler 被接受但不触发。

## 给 DSH 上游的能力缺口（本项目实测发现）

1. **out-of-repo 插件的 session 事件注册面**：`KNOWN_SESSION_EVENT_TYPES` 是仓内生成清单，且 `Session.append()` 无 `ignorable: true` 写入通道——第三方插件目前无法安全地把自定义事件写入主日志（未知类型会让其它 build 拒绝重载会话）。pi2dsh 因此使用 sidecar。DSH README 自己标注 "a registration surface for them is deferred until such a consumer exists"——pi2dsh 就是那个 consumer。
2. **MCP resources/prompts 消费链路**：官方 mcp-client 只桥接 tools。
