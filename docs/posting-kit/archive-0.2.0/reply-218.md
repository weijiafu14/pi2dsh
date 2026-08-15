官方会不会内置只能等维护者定。但"现在就要跨会话记忆、又不想只靠外部 MCP"的话，除了楼上的 DSH 原生插件，Pi 生态里的 [pi-hermes-memory](https://www.npmjs.com/package/pi-hermes-memory) 也可以通过 pi2dsh 中间层零改动挂到 DSH 上直接用。

你问的第 2 点（显式调用 vs 会话空闲自动抽取），pi-hermes-memory 正好**两者都做、而且分层**：

- **显式**：`memory_add` / `memory_search` / `session_search` 工具，agent 主动读写；
- **自动**：background learning 每 ~10 轮回顾一次，把值得记的沉淀下来，满了自动 consolidation 合并、不丢数据。

刚在 DSH 上真机验证的跨会话读写（headless + deepseek-v4-flash，两个独立进程）：

- 进程 1：`memory_add` 存"preferred package manager is pnpm, never npm/yarn" → 落盘 `~/.pi/agent/pi-hermes-memory/USER.md`；
- 进程 2（全新进程，无任何上一会话内存状态）：问同一问题，agent 用 `memory_search` 读回 "pnpm — per what you told me previously, never npm or yarn"。

装载日志 `loaded pi-hermes-memory: 6 tools, 11 commands`，工具全部注册可用。

复现：

```bash
npx pi2dsh@0.3.4 host --packages pi-hermes-memory --out mem-bundle
pnpm dsh plugin --profile <你的profile> add file:mem-bundle
```

pi2dsh：把 Pi 插件桥接到 DSH 上原样运行的中间层 https://github.com/weijiafu14/pi2dsh
