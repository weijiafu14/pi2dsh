# GitHub community replies — subagents lifecycle (2026-08-24)

Context: pi2dsh 0.16.2 shipped the full subagent lifecycle acceptance
(steer / resume / stop / cross-restart reopen) with the live-model-route
inheritance fix. Replies below deliberately do NOT claim to fix DSH's native
subagent bugs — they offer the Pi-plugin subagent route as a verified
alternative, plus the same-shape pitfall we hit and how it was caught.

## deepseek-harness #455 (子代理继承"创建时默认"而非"会话当前模型")

https://github.com/deepseek-ai/deepseek-harness/discussions/455#discussioncomment-18129967

这条根因（子代理拿到"创建时默认"而不是"会话当前模型"）我们在另一条路线上也撞到过同形状的坑，修好并做了端到端实证，供参考——**不是修 DSH 原生 subagent，而是 Pi 插件生态那条子代理路线**：

```sh
dsh plugin --profile main add pi2dsh
dsh plugin --profile main add @tintinweb/pi-subagents
```

重启后模型获得 Agent / steer_subagent / get_subagent_result 工具。关键机制一句话：pi2dsh 桥在派生子代理时解析的是**调用者的实时路由**（会话内 `/model` 切换的选择优先，创建时快照只作兜底），所以第三方 provider 会话里派出的子代理跟着当前路由走，不会回落到 `deepseek-official` 找不存在的 key。我们第一版实现恰好也犯了"只读 `agent.options` 创建快照"这个错，靠"子代理会话日志里 request/header 的 provider 必须等于父会话当前 provider"这条断言抓出来的——和本帖源码定位是同一条链。

每个子代理是原生 DSH 会话（带官方 subagent/descriptor 与父血缘），宿主可列可续。完整可跑示例与真机验收（steer / resume / stop / 跨重启重开四场景，stock CLI + 真模型）：
https://github.com/weijiafu14/pi2dsh/tree/main/examples/subagents

## deepseek-harness #2006 (Subagent 未正确继承父 Agent 的模型配置)

https://github.com/deepseek-ai/deepseek-harness/discussions/2006#discussioncomment-18129977

补一条已实证可用的替代路线（Pi 插件生态的子代理，不是对原生 subagent 的修复）：

```sh
dsh plugin --profile main add pi2dsh
dsh plugin --profile main add @tintinweb/pi-subagents
```

这条路线上"继承"与"显式指定"两种都过了端到端：不指定模型的子代理继承**调用者实时路由**（会话内切换优先于创建时快照——我们第一版也犯过只读 `parent.options` 快照的错，和本帖 `resolveChildAgentOptions` 的定位同形状）；Agent 工具的 `model` 参数可 per-child 显式指定（"provider/modelId" 或模糊名）。每个子代理是原生 DSH 会话，宿主可列可续聊。

示例与真机验收（stock CLI + 真模型，含 steer/resume/stop/跨重启四场景）：
https://github.com/weijiafu14/pi2dsh/tree/main/examples/subagents

## deepseek-harness #1493 (subagent attribution & observability envelope)

https://github.com/deepseek-ai/deepseek-harness/discussions/1493#discussioncomment-18129978

A data point from a parallel line that may be useful as a reference implementation for the "durable pointer" half of this proposal.

In pi2dsh (the Pi-ecosystem bridge), every subagent a plugin spawns is a **native DSH session**: it carries the official `subagent/descriptor` event (mode `continuable`) plus `parentSession` lineage in its header, so the host's own catalog lists, reopens and continues it — no sidecar store. We also verified the durable identity end-to-end across process restarts: process 1 records the child's archive identity, process 2 reopens exactly that session through the registry's official persisted-resume seam (`resume({resumeSessionId, setup})`) and the child continues with its memory intact — same session log grown from one turn to two, asserted on a fresh DSH_HOME with the stock npm CLI and a real model.

So at least for in-process subagent providers, the attribution envelope this proposal wants (a durable, host-readable pointer from the run to its session artifact) is expressible today with existing public seams: descriptor + lineage in the child's own log, and persisted-resume as the reopen path. The gap this proposal addresses for *external* providers (codex app-server one-shot threads) remains real — the above may serve as the shape the envelope could normalize to.

Repro: https://github.com/weijiafu14/pi2dsh/tree/main/examples/subagents
