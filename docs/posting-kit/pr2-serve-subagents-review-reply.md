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

---
第二轮回复存档：2026-08-26 发于 https://github.com/weijiafu14/pi2dsh/pull/2#issuecomment-5412672003
背景：作者澄清其场景是 DSH 原生子代理（不经 createAgentSession），a8b7a0a 未覆盖；
提出基于我们 per-child 机制的收窄 rework。我方接受并给出设计四条：
① 按出身分流不按开关接管（Pi 造的孩子永远走桥听创建者配置；开关只管原生的）
② 分流器=一行血缘判据（pi2dsh-sub- 会话号前缀），缺它必双挂载，须契约测试钉死
③ 复用 ChildExtensionCatalog.mount（per-child 实例+dispose unwind+逐扩展隔离白拿）
④ 命名 serveNativeSubagents + 验收清单（默认关零变化/双挂载测试/unwind 测试/
真机 E2E/上游 feature 文档）。等作者按此 rework。

---

## 第三轮回复（合并通告 + 我方跟进）

**Merged** — `99175a7`, rebased onto `main` with your authorship intact. Full suite stays green (314). Thanks for three rounds of rework and for doing the live verification yourself; the two things you found on real machines (the runtime-root partition and the first-turn race) were both real, and neither would have come out of code review.

Three follow-ups landed on `main` afterwards (`5b11534`), all on top of your design — no behavior of yours was changed:

**1. The double-serve test could not fail.** I re-checked it by mutation: deleted the `isRootAgent(agent)` skip from the native path and ran your test — still green. Cause: a second `applyPreparedPiHost` onto the same scope hits DSH's duplicate prompt-section rejection (`pi2dsh:tool-guidance:<pkg>` is already registered in that scope), so the second mount unwinds itself and the survivor is indistinguishable from a single mount. Every registry-side oracle is blind to this — name counts, and also the per-mount numbered names I first tried. What a double serve does leave behind is a second *factory invocation* and the loser's warning, so the probe extension now appends a line to an on-disk ledger on every invocation and the test asserts exactly +1 per package around the child's creation, plus no mount-failure warning in that window. Mutation now goes red, restore goes green. Your partition itself was correct; only its proof was.

**2. Docs.** `docs/STANDARDS.md` §3.6 now records all three v3 mechanisms (the runtime-root partition with its fail-open/fail-closed mirroring, the scope-keyed mount memo, the first-turn gates) and the self-unwind pathology above, so the next person doesn't re-derive it. README (en + zh) gained the two user-visible promises: served exactly once whichever path DSH created the child through, and the mount is guaranteed for the child's first turn.

**3. Our own reproducible real-machine E2E** — `scripts/verify-native-subagents-e2e.mjs`. Stock `@deepseek-ai/dsh@0.1.1-rc.2`, the engine, and a probe Pi package, with **no Pi subagent package installed at all**: the model delegates through DSH's own native `subagent` tool, real DeepSeek on both parent and child turns. Flag-on asserts a callId-linked non-error `probe_touch` result in the *child's* durable log, with the child's session header showing `origin: subagent`, no `pi2dsh-sub-` prefix, and `parentSession` pointing back at the delegating parent; the parent is asserted clean of both `probe_touch` and `bash`. Flag-off asserts delegation still happened but no child produced a successful `probe_touch`. Both pass; evidence in `community/native-subagents-e2e.json`.

One note from that E2E worth passing on: my first flag-off assertion was "the probe file must not exist", and it failed — the unserved child simply improvised the file with its native `write` tool. File existence tests the model's obedience, not our mount; only the callId-linked tool result in the durable log decides it.

If you want to keep going: the natural next pieces are Web-surface presentation for these children, and depth-2 coverage in the automated script (your live run had it, ours does not yet).

---
第三轮回复存档：2026-08-26 发于 https://github.com/weijiafu14/pi2dsh/pull/2#issuecomment-5419869254
背景：作者 v3（按出身分流 + runtime-root 分区 + scope 键 memo + 首轮 gate）已合并
（99175a7，rebase 保留署名）。本帖通告合并并交代我方三项跟进（5b11534）：
① 双伺候测试换可证伪判据（工厂调用落盘台账 + 挂载失败 warn 捕获）——原判据被变异
证伪：第二次挂载撞重复 prompt-section 名自我 unwind，注册表侧信号全盲；
② STANDARDS §3.6 + README 双语补 v3 三机制与自 unwind 病理；
③ 我方可复现真机 E2E（stock CLI + 引擎 + probe 包、不装任何 Pi 子代理包、走 DSH
原生 subagent 委派、真模型，旗开旗关双绿）。并回传一条判据教训：旗关场景不能用
"探针文件不存在"当断言（未被伺候的孩子会用原生 write 自己造文件），只有会话日志里
callId 关联的工具结果算数。后续可做：Web 呈现、脚本补 depth-2。
