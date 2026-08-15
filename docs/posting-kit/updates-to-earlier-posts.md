# Updates for earlier threads

Don't edit the original comments — they were accurate for the version they were
written against (0.3.x). Post each of these as a **new short reply** in its
thread. The reason an update is needed everywhere: those replies teach an
install flow that no longer exists.

**Stale in every earlier reply:**

```sh
npx pi2dsh@0.3.4 host --packages <pkg> --out <dir>   # ← no longer the way
pnpm dsh plugin --profile <p> add file:<dir>
```

**Current install (0.10.0):**

```sh
dsh plugin --profile <p> add pi2dsh     # the engine, once
dsh plugin --profile <p> add <pkg>      # the Pi package, as published
```

---

## Shared paragraph (the base of every update)

> **更新（pi2dsh 0.10.0）**：安装方式已经简化，之前这条回复里的 `npx pi2dsh host --packages …` 生成 bundle 的步骤不再需要了。现在装一次引擎、之后直接装 npm 上的 Pi 插件原包，全程只有 DSH 官方命令：
>
> ```sh
> dsh plugin --profile <你的profile> add pi2dsh
> dsh plugin --profile <你的profile> add <Pi插件包名>
> ```
>
> 装完重启 dsh 即可；升级引擎和升级插件互不影响。详见 README：https://github.com/weijiafu14/pi2dsh

---

## #14 — cross-session memory (pi-hermes-memory)

Base paragraph, then:

> 另外这一版把会话相关能力做到了 DSH 官方接口上（新建/fork/切换会话、压缩摘要、插件热重挂），跨会话记忆的链路不受影响，仍然是之前那条实测结论：会话 1 存、全新进程的会话 2 读得回来。

## #218 — built-in memory vs. plugin

Base paragraph, then:

> 之前回复里 `memory_add` / `memory_search` 显式调用与 background learning 自动沉淀的分层没有变化，仍然按 Pi 上的行为运行。

## #421 — model-reviewed automatic approval (pi-approval-guardian)

Base paragraph, then:

> 审批链路本身没有变化：每个工具调用先交给审查模型判定，安全放行、可疑拦截，全程无人工确认。这一版新增的是"能力缺口分级处置"——插件用到的能力如果 DSH 上确实没有，会按插件给出一次明确提示（说明哪个功能不可用、其余功能照常），不再是一句笼统报错。

## #759 — progress thread

This one is a progress post, so make the update a progress entry rather than a correction:

> **进展更新（0.10.0）**：
> - 安装收敛成两条 DSH 官方命令（`add pi2dsh` 装引擎，之后 `add <Pi插件原包>`），不再需要生成 bundle 的中间步骤；
> - 会话控制（新建 / fork / 树导航 / 切换）、`ctx.compact()`、插件热重挂改为走 DSH 官方接口真实执行，不再是"显式失败"；
> - 能力缺口改为分级处置：能真做的做，Pi 协议自带拒绝通道的走协议，只有伪造返回值才会报结构化错误，并且按插件向用户提示一次；
> - CLI 与 Web 双端端到端复验通过，92 项契约测试 + 裸环境从 npm 安装全流程验证。
> README：https://github.com/weijiafu14/pi2dsh

## #1120 — side conversations (pi-btw)

**This one is a correction, not just an update.** Post it even if the others are skipped.

Verified on 2026-08-15 with pi2dsh 0.10.0 + pi-btw on a real DSH web session:
the plugin mounts, all 8 commands appear in the DSH command palette
(`/btw`, `/btw-tangent`, `/btw-inject`, …), but running `/btw <question>`
fails with `Cannot set properties of undefined (setting 'messages')`. Root
cause: pi-btw seeds its side thread by assigning to `session.agent.state.messages`
— Pi's internal agent runtime state — which DSH has no equivalent for (DSH's
history is an append-only durable log; seeding happens at session creation,
not by assignment). The failure is loud and visible in the UI, and the main
thread keeps working, but the feature itself does not work.

> **更正（pi2dsh 0.10.0 实测）**：这条回复当时说 pi-btw "挂上去就能用"，说早了，这里更正。
>
> 现在的实测结论：插件能装能挂载，8 个命令也都出现在 DSH 命令面板里，但真执行 `/btw <问题>` 会失败（`Cannot set properties of undefined (setting 'messages')`）。原因是 pi-btw 用 `session.agent.state.messages` 直接写 Pi 内部 agent 运行时状态来播种侧边会话，而 DSH 的历史是 append-only 的持久日志、播种发生在会话创建时，没有这个可写入口。
>
> 也就是说：**`/btw` 侧边对话目前在 DSH 上不可用**，报错是明确可见的（不会静默失败），主线程不受影响。这条已经写进 README 的已知限制清单。
>
> 用 Pi 公共 API 的工具型 / 命令型 / provider 型插件不受影响，安装方式也已简化：
>
> ```sh
> dsh plugin --profile <你的profile> add pi2dsh
> dsh plugin --profile <你的profile> add <Pi插件包名>
> ```

## #1398 — automatic approval (same as #421)

Base paragraph, then:

> 与 #421 同一套方案，审批行为不变。
