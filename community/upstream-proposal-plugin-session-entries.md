# 上游提案草稿：仓外插件的会话自定义条目通道（ignorable append）

状态：**提案已在上游存在，无需再发**——
[deepseek-harness Discussion #2708](https://github.com/deepseek-ai/deepseek-harness/discussions/2708)
（2026-08-17 发出，标题即本提案，附真机实验跟帖：往真实会话日志注入
带/不带 ignorable 的未知类型、在 dsh web 里真点验证读路径行为）。
本文件保留为内部归档与后续跟进底稿；如需追帖，先对 #2708 现状再拍板。

## 背景（内部说明，不随提案发出）

- DSH `dsh-session` 的 `KNOWN_SESSION_EVENT_TYPES` 注释原文明说：
  *"Downstream (out-of-repo) plugin events are outside this list by
  construction; a registration surface for them is deferred **until such a
  consumer exists**."* —— 上游在等真实消费者，我们就是。
- 机制上游也已预留：信封的 `SessionEvent.ignorable` 标记（设计注释：
  *"Adding an ordinary event type does not bump [the format version] — the
  per-event ignorable guard covers vocabulary growth instead"*），持久化读
  路径对带 `ignorable: true` 的未知类型是跳过而非拒绝；seed 校验也接受该
  信封键。缺的只有一件事：**`Session.append()` 没有让调用者设置 ignorable
  的参数**（现有 opts 只透 `sourceEventSeqs`/`surfaceOp`）。
- 我们的真实消费者：`@tintinweb/pi-subagents@0.18.0` 每个子代理完工时
  `pi.appendEntry("subagents:record", {...})` 持久化历史（源码注释
  "Persist final record for cross-extension history reconstruction"）；经
  pi2dsh 桥接后这类条目目前只能落在引擎自己的 per-session Pi 格式档案文件
  里。DSH 原生日志装下它们之后，插件会话状态与对话正文同库、同生命周期、
  同备份面。
- 实证过的反面：不带 ignorable 硬写未知类型 = 当场成功、**重启后读路径
  拒绝解释整份日志**（`KNOWN_SESSION_EVENT_TYPES` 门）。

## 拟发正文（英文草稿）

> **Title: Let out-of-repo plugins append ignorable session events (the
> deferred registration surface has its consumer now)**
>
> `dsh-session`'s `KNOWN_SESSION_EVENT_TYPES` comment says plugin events are
> outside the vocabulary by construction and that a registration surface for
> them is *"deferred until such a consumer exists."* We are such a consumer
> and would like to start that conversation.
>
> **Use case.** pi2dsh bridges Pi-ecosystem plugins onto DSH.
> `@tintinweb/pi-subagents` persists one small record per finished subagent
> ("cross-extension history reconstruction" — id, status, result summary).
> Pi's ABI stores such extension entries in the session itself. On DSH we
> currently keep them in an engine-owned per-session file, because the native
> log cannot hold them: the persistence read path (correctly!) refuses logs
> carrying out-of-vocabulary event types, and `Session.append()` offers no way
> to set the envelope's `ignorable: true` escape hatch that the read path
> already honours.
>
> **Smallest proposal.** Allow appends to opt in to the existing guard:
>
> ```ts
> session.append('plugin/<namespace>/<type>', data, { ignorable: true })
> ```
>
> - `ignorable` rides the envelope exactly as the format-versioning design
>   already specifies ("the per-event ignorable guard covers vocabulary
>   growth"); older builds reading such a log skip these events instead of
>   refusing the log — behaviour the read path implements today.
> - A required namespace prefix (e.g. `plugin/`) keeps the host vocabulary
>   unambiguous and lets surface folding ignore these events wholesale.
> - No surface semantics requested: these entries are state-only for the
>   appending plugin; they should never enter the model-visible fold.
>
> A richer registration surface (declared types per plugin, validation) would
> be welcome too — the ignorable-append is the minimal version that unblocks
> real plugins today, and we are happy to validate a draft against a live
> consumer and report back.

## 我们这边的落地承诺（内部说明）

提案被接受后：pi2dsh 把 custom/label/branch_summary 三类条目从 per-session
档案文件迁入原生日志（`plugin/pi2dsh/...` 命名空间），档案文件退化为纯
存在位（Pi 的 `getSessionFile()`/`existsSync` 契约仍需要一个真实 inode），
投影随之 100% 单源。迁移含一次性回填：加载时把旧档案条目按 ignorable
append 重放进原生日志并标记档案已迁移。
