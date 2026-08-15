楼上给的 DSH 原生桥接插件是一条路。补一个 Pi 生态里很成熟的选项：[pi-hermes-memory](https://www.npmjs.com/package/pi-hermes-memory)（跨会话持久记忆 + SQLite FTS5 全文搜索 + 密钥扫描，732 个测试），通过 pi2dsh 中间层零改动挂到 DSH 上就能用——不用重写，Pi 上怎么用 DSH 上就怎么用。

刚在 DSH 上真机跑通的跨会话记忆（headless + deepseek-v4-flash，两个独立进程）：

会话 1，让 agent 记一件事：

```
> Use your memory_add tool to remember: my preferred package manager is pnpm, never npm or yarn.
Saved! I've permanently recorded that your preferred package manager is pnpm...
```

它落到磁盘（`~/.pi/agent/pi-hermes-memory/USER.md`）：

```
Preferred package manager is pnpm. Never use npm or yarn. <!-- created=2026-08-14 -->
```

会话 2（**另起一个进程**，没有任何上一会话的内存状态）：

```
> What is my preferred package manager? Use memory_search to recall.
Your preferred package manager is pnpm — and per what you told me previously, never npm or yarn.
```

装载日志：`loaded pi-hermes-memory: 6 tools, 11 commands`（memory_add / memory_search / session_search 等全部注册）。

关于你问的"迁移 codex / claude code 的记忆"：pi-hermes-memory 自带 `/memory-index-sessions`（索引历史会话）和 `/memory-sync-markdown`（把旧 Markdown 记忆导入搜索库）。要把 Claude Code 的 CLAUDE.md / Codex instructions 直接搬进来，可以配合楼上 @YYTbit 的 bridge 插件，两者不冲突。

复现：

```bash
npx pi2dsh@0.3.4 host --packages pi-hermes-memory --out mem-bundle
pnpm dsh plugin --profile <你的profile> add file:mem-bundle
```

pi2dsh 是把 Pi 插件桥接到 DSH 上原样运行的中间层：https://github.com/weijiafu14/pi2dsh
