Thanks for this PR — it's a high-quality contribution and we want it (or rather, what it's really after) to land. Before anything else: we pulled the branch and verified your claims hold up. It's rebased on yesterday's `main`, `tsc` is clean, your two tests pass, our full suite (284) stays green, and the two facts your design leans on are real — `runtimeInternals.isSubagentOrigin` is exported with a compatible signature, and the stock rc.2 registry does expose `list()` with graceful degradation when absent. The honest cost/leak disclosure in the description is appreciated; it's rarer than it should be.

Reviewing it sent us back to the Pi sources, and that turned up something that changes the picture in your favor — and against this particular implementation shape:

**Your need is not an extension of Pi semantics. It IS Pi semantics, and the actual gap is on our side.** In real Pi, `pi-subagents` children load extensions by default: `extensions: true` → a fresh `DefaultResourceLoader` discovery → `session.bindExtensions(...)` on the child session, so MCP tool surfaces and memory extensions genuinely work inside subagents — gated per agent *type* (`extensions:`, `exclude_extensions:`, `ext:` selectors, `isolated`). Our bridge stubs `PiBridgedAgentSession.bindExtensions()` as an accepted no-op (`src/subagent-bridge.ts:601`), which severs exactly the chain you hit. So subagents-without-Pi-capabilities is a pi2dsh compatibility bug, not a missing feature — thank you for surfacing it with real measurements.

That also reframes where the fix belongs. An engine-level global flag serves *every* subagent-origin session a full per-child Pi host. That's coarser than Pi (which decides per agent type, at the `createAgentSession` call), it reaches DSH-native children that never went through Pi's contract, and it pays the costs your own description quantifies: ~11 MB retained per spawn with no teardown path, a fresh package load + MCP listing per child, ~90 schemas on every model call. Those aren't implementation debts to fix later — they're consequences of the "clone a host per child" shape itself.

The shape we intend to build (and would love your review on): **make `bindExtensions` real** — when a Pi creator spawns a child, project the *already-mounted* packages' tool surfaces into the child's scope through DSH's official scoped-tools seam, honoring the creator's `extensions` config, and let the one existing runtime observe the child session for prompt contributions. Pi's semantics, shared-runtime cost: no per-child package load, no leak, no schema duplication, recursion stays under the creator's control — and your remnic/recall/depth-2 verification becomes the falsifiable E2E scenario for it.

On process: we'd like your contribution to be part of this rather than parallel to it. Two options, your pick:

1. If you enable "allow edits by maintainers" on this PR, we'll push the rework onto your branch — your commit stays, the follow-ups land on top, and this PR merges.
2. Otherwise we'll branch from your commit (keeping your authorship) and open the rework referencing this PR, with you as reviewer.

Either way the test you wrote (the gated/ungated assembly probe is a genuinely good falsifiable design) and your live measurements carry straight over. If you'd rather rework it yourself along the `bindExtensions` line, that works too — happy to sketch the seam details in a follow-up comment.

---
存档信息：2026-08-25 发于 https://github.com/weijiafu14/pi2dsh/pull/2#issuecomment-5406320776
背景：PR #2（serveSubagents 引擎全局开关）审核回复。审核结论：需求=真 Pi 语义
（pi-subagents 子代理默认 bindExtensions 加载扩展），真缺口=我们桥的
bindExtensions no-op（src/subagent-bridge.ts:601）；正解=bindExtensions 真实现
（一份运行时、scope 授权、Pi 的 extensions 配置语义），已向作者提供两条合入路径
（maintainer edits 推 rework / 保留署名另开分支），等作者回应。
