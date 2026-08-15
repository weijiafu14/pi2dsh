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

**Current install (0.11.0):**

```sh
dsh plugin --profile <p> add pi2dsh     # the engine, once
dsh plugin --profile <p> add <pkg>      # the Pi package, as published
```

---

## Shared paragraph (the base of every update)

> **更新（pi2dsh 0.11.0）**：安装方式已经简化，之前这条回复里的 `npx pi2dsh host --packages …` 生成 bundle 的步骤不再需要了。现在装一次引擎、之后直接装 npm 上的 Pi 插件原包，全程只有 DSH 官方命令：
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

> **进展更新（0.11.0）**：
> - 安装收敛成两条 DSH 官方命令（`add pi2dsh` 装引擎，之后 `add <Pi插件原包>`），不再需要生成 bundle 的中间步骤；
> - 会话控制（新建 / fork / 树导航 / 切换）、`ctx.compact()`、插件热重挂改为走 DSH 官方接口真实执行，不再是"显式失败"；
> - 能力缺口改为分级处置：能真做的做，Pi 协议自带拒绝通道的走协议，只有伪造返回值才会报结构化错误，并且按插件向用户提示一次；
> - Pi 插件的侧边对话（`/btw` 一家）跑成了 DSH 真子会话，直接用 DSH 原生的子代理界面，主会话保持干净；
> - CLI 与 Web 双端端到端复验通过，95 项契约测试 + 裸环境从 npm 安装全流程验证。
> README：https://github.com/weijiafu14/pi2dsh

## #1120 — side conversations (pi-btw)

**This one is a correction, not just an update.** Post it even if the others
are skipped: the earlier reply said pi-btw "mounts and works", which was said
too early — at the time `/btw` mounted but failed on execution.

Verified on 2026-08-16 with pi2dsh 0.11.0 + pi-btw on a real DSH web session:
`/btw <question>` runs the side thread, the answer stays out of the main
conversation, `/btw-inject` merges it on request, and `/btw --save` records the
plugin's own note. Two ABI gaps had to be closed for this, both general rather
than package-specific: Pi's public, settable `AgentState.messages` (pi-btw
seeds its side thread by assigning a transcript), and an input descriptor on
every bridged command (without it the web app parsed `/btw <question>` as chat
instead of a command).

> **更新（pi2dsh 0.11.0 实测）**：这条回复当时说 pi-btw "挂上去就能用"，说早了——那会儿 `/btw` 能挂载但一执行就报错。现在这个能力真的通了，更正如下。
>
> `/btw <问题>` 会开一条侧边线程：它在 DSH 上是一个**真的子会话**，出现在 DSH 原生的子代理下拉里，点开是独立视图、带自己的输入框、可以继续追问；**主会话里除了命令自己的一行状态什么都不会多出来**。想把结论并回主线时再敲 `/btw-inject`，`/btw --save <问题>` 则会把答案记成插件自己的笔记。CLI 和 Web 双端都实测过。
>
> 为此补了两个**通用** ABI 缺口（不是给某个包打补丁）：Pi 公开可写的 `AgentState.messages`（pi-btw 靠给它赋值来播种侧边线程），以及给每条桥接命令声明输入描述符（否则 Web 上 `/btw <问题>` 会被当成聊天消息发出去）。任何用同样方式开侧边会话的 Pi 插件都一起解锁了。
>
> 完整可跑示例：https://github.com/weijiafu14/pi2dsh/tree/main/examples/side-conversation

## #1398 — automatic approval (same as #421)

Base paragraph, then:

> 与 #421 同一套方案，审批行为不变。
