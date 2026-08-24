# pi-subagents 完整端到端验收报告（steer / resume / stop / resume-archive / model-follow）

日期：2026-08-24。栈：stock `@deepseek-ai/dsh@0.1.1-rc.2`（npm）+ 本工作树引擎 +
stock `@tintinweb/pi-subagents@0.18.0`（npm）+ 真 DeepSeek（父子两级全真模型调用）。
装置：[`scripts/verify-subagents-lifecycle-e2e.mjs`](../scripts/verify-subagents-lifecycle-e2e.mjs)，
证据：[`subagents-lifecycle-e2e.json`](subagents-lifecycle-e2e.json)（含钉死的 CLI/引擎版本与
scratch 路径）。本报告与上一轮 P0 验收
（[`subagents-e2e.json`](subagents-e2e.json)：子代理工具经官方 setup seam、/pi-agents 撞名别名）
合起来构成 subagent 兼容的完整验收。

## 一、验收范围与判据

覆盖 pi-subagents 的三个生命周期面，外加一个跨进程重开场景（公共 Pi ABI 探针，
`fixtures/subagent-archive-probe`），每个断言按"功能坏掉时它不会照样过"设计：

| 场景 | 证明什么 | 可证伪设计 |
|---|---|---|
| steer | 运行中的 steer_subagent 真的送达子模型 | steered 文件的路径与内容**只出现在 steer 指令里**（spawn 提示词没有），且父代理被明令禁 bash 并在其日志上断言——文件落盘只能意味着 steer 中途到达了子模型 |
| resume | resume 的子代理延续同一会话与记忆 | 暗号只存在于磁盘文件（任何提示词不含）；第 1 轮子代理读文件记住，resume 后第 2 轮禁读、默写暗号到新文件。判据：新文件内容对上 + 两轮在**同一个**子会话日志（turn/start ≥ 2）+ 第 2 轮无 read 调用 + resume 提示词里没有暗号（防模型作弊，真拦下过一次） |
| stop | 父被打断时运行中的子代理连带停住并保持安静 | TUI 前台子代理跑 `sleep 90` 后写文件；Esc 重试直到父轮**持久日志**记下 aborted/user；等过 sleep 窗口后文件必须不存在（不停它必然出现）；子会话 turn/end 必须只有 aborted 没有 completed |
| resume-archive | **跨进程重启**后按归档身份重开的子代理是同一段对话 | 进程 1：探针经公共 ABI 造子代理读盘上暗号并记住，落盘其归档身份（`session.sessionManager.getSessionFile()`）；进程 2（全新 dsh 进程）：`SessionManager.open(归档)` 交回 `createAgentSession`——pi-subagents 墓碑复活的同款形状。判据：默写暗号成功 + 两轮在**同一个** DSH 子会话日志（跨两个操作系统进程增长）+ 会话号与记录的身份一致 + 身份证事件不重复 + 进程 2 零 read |
| model-follow | 用户在 DSH UI 会话中途 `/model` 切换后，新 spawn 的无模型子代理跟随**切换后的实时路由** | settings 配一个独立网关 provider（work-gw）；先把默认路由钉到官方线并跑 warmup 轮（断言 warmup 真跑在官方线上——防"本来就在 work-gw"的假阳性）；TUI 敲参数化 `/model work-gw/deepseek-chat` 切换后 spawn 子代理。判据全部读**持久会话日志的 request/header**（不认屏幕文字）：父会话先官方线后 work-gw 两条俱在 + 子会话请求只在 work-gw + 子代理写的 marker 落盘。父会话按"只有真父才有的内容"（warmup 文本 / marker 路径）选取，防同 home 多会话误配 |

双端：headless CLI（steer/resume）+ stock dsh-TUI 0.9.0 真机（stop、model-follow、/pi-agents 菜单）。
**边界声明**：dsh web 浏览器端未在本轮覆盖——pi-subagents 在 web 的面同为斜杠命令与
工具，无独立呈现面；如需 web 实证另开场景。

## 二、验收过程抓出并修复的九个桥缺陷

全部真机验收抓出、契约测试钉死（`tests/subagent-bridge.spec.ts` + `tests/session-bridge.spec.ts`，全绿）：

1. **tool_execution_end 没投影 →"0 tool uses"假象**。pi-subagents 在
   session.subscribe 的 `tool_execution_end` 上计数"N tool uses"；桥只发了
   tool_execution_start。后果：子代理真跑了工具，父模型却被告知 0 tool uses，
   不敢认账、反复重试（真机抓到 4 连重试）。修复：桥从 durable tool/result
   事件投影 Pi 官方形状 `{toolCallId, toolName, result, isError}`。真机复验
   "Tool uses: 1" 正确。
2. **preset 三级 join 缺失 → TUI 面子代理裸奔（P0 级）**。dsh-TUI 0.9.0 把全部
   模型面工具搬进 agent-presets 花名册并禁用宿主层工具行；桥原先只调
   `composeFrom` 且父 ctx 拿不到时静默跳过——headless 有宿主行兜着看不出来，
   TUI 上子代理请求带 **0 个工具**（上一轮 P0 的第二面复发）。修复：按官方
   偏好序 join——继承父的 standing 组合（composeFrom，DSH 自家 subagent 驱动
   同款）→ 花名册默认 preset 真 mount（官方 host 同款）→ 无花名册保持宿主行
   语义；三级全落空时 console+logger 双通道大声告警。限制名单的"已知工具"解析
   同步改为子代理自己的作用域视野（preset 工具在全局层之上）。
3. **abort 后子代理被晚到的工具结果再唤醒（stop 失效）**。整条停止链
   （父 Esc → exec.signal → manager.abort → session.abort → Agent.cancel）
   全部打通、子轮持久记录了我们的 cancel cause，但 DSH 的工具契约是
   "body 跑到静止才出结局"，晚到的工具结果作为 waking input 又开了一轮，
   "已停"的子代理把任务干完了（真机抓到 turn1 aborted + turn2 completed 写出
   文件）。Pi 的 abort() 契约是"停下并保持安静直到下一次 prompt"。修复：
   abort 后每个新开的子轮立即再次官方 cancel（不撒谎 cause、不 dispose——
   Pi 里 abort 后的会话仍可再 prompt），prompt() 解除压制。真机复验子会话
   只剩一条 aborted、文件不再出现。

本轮为跨进程重开补齐的四处桥能力（各配契约测试）：

4. **子会话暴露 `session.sessionManager`**（只读投影），其 `getSessionFile()` 返回
   物化在盘上的归档身份（既定 `<id>.jsonl` 约定）——此前为 undefined，导致
   pi-subagents 记不下每个子代理的档案，**"@名字 复活已归档下属"这个包的核心
   功能在桥上从未工作过**。
5. **归档身份的正反向翻译**：`archiveFileFor(id)`（保证存在，Pi 消费者用
   existsSync 判"对话还在不在"）与 `sessionIdOfArchiveFile(path)`（只认自己
   铸的路径，真 Pi 会话文件不冒领）。
6. **官方 persisted-resume 绑回原生会话**：收到"从归档打开的 SessionManager"
   时走 `agents.resume({resumeSessionId, setup})`——父子血缘、会话正文、身份
   证全读原生持久层，桥零对照表；重开不重复追加身份证事件。真机证据：两个
   独立 dsh 进程，同一份 `session.jsonl` 从 1 轮长到 2 轮，暗号凭记忆默写成功。
7. **子代理模型默认 = 调用者当前路由，且是实时路由**（Pi 语义）：无模型选项的
   子代理会在首次提示词装配的 `{{model}}` 变量上直接炸轮（真机抓到），
   pi-subagents 恰好总传模型所以从未暴露。路由解析三级：options 上的显式
   Pi 模型 → 调用者持久会话日志最后一条 `request/header` 里的路由（**DSH UI
   会话中途 `/model` 切换因此被继承**，model-follow 场景真机实证）→ 创建时
   快照兜底。第一版实现读的是创建时快照、第二版读 `currentPiModel`（对 UI
   切换仍失明，同 #455/#2006 的病灶形状）——持久日志才是路由权威。
8. **per-child thinkingLevel 经官方 agent/request waterfall 下发**：子代理自己
   的推理档位翻译成它专属的 `reasoningEffort` 注入，不外泄给兄弟或父代理
   （契约测试钉死）。
9. **steer/followUp 必须是 async 面（Pi AgentSession ABI）**：桥的 steer 原返回
   void 且没暴露 followUp，而 pi-subagents 直接 `session.steer(msg).catch(...)`
   ——同步就炸 `Cannot read properties of undefined (reading 'catch')`。投递
   Promise 早已排队所以 steer 内容照常送达（这就是"每轮 steer 都过、但输出里
   总有一条报错"的原因：工具向父模型报了错，功能却带伤工作）。正式轮输出
   尾部的这条报错暴露了它。修复：steer/followUp 均为 async、await 投递完成，
   与 Pi 上游 `agent-session.ts` 同签名（含 images 参数）。

另有两处纪律修复：abort 里对 `Agent.cancel` 缺失/抛错的静默吞错改为
console+logger 双通道告警（`?.` 不许吞真实失败）；abort 静默守护从只盯
turn/start 加宽到 step/start 与 request/header——cancel 恰在 turn/start 事件
时刻可能与驱动器认领活动竞态而 no-op（真机复现过一次侥幸通过、一次失败）。

## 三、上游发现（pi-subagents 0.18.0 自身行为，不 patch、如实归因）

- **resume 只认 Agent ID，steer/get_subagent_result 认名字**：resume 分支用
  `getRecord(id)`，其余用 `resolveAgentRef`（handle+id 都行）。且**前台完成
  文本不回显 Agent ID**（后台 spawn 才有 "Agent ID: …" 行），模型只能拿名字去
  resume → "Agent not found"。真 Pi 上同样会发生（纯包内逻辑）。绕法：后台
  spawn + get_subagent_result(wait) 拿 ID 再按 ID resume（本验收即此编排）。
- **Agent 工具 schema 对 resume 调用仍强制 subagent_type**：只带 resume 不带
  subagent_type 会被参数校验拒绝（上游 schema 就是必填），模型需重试补上。
- dsh-TUI 0.9.0 本地保留 48 个命令名（/agents、/btw、/login、/model 在内），
  包命令经版本钉死的保留名单换 `pi-` 前缀（上一轮已验，`/pi-agents` 真机可开
  包管理菜单；本轮 stop 场景再次复验）。

## 四、装置备忘

- **dist 竞态**：`dsh plugin add <项目根>` 会让 pnpm 在项目根跑 `prepare`
  （tsdown clean+build），与并发的本地 build/拷贝互相踩。E2E 安装阶段不要并发
  跑 verify/build；刷 profile 用先拷出的 `/tmp/pi2dsh-dist-stage` 快照。
- **TUI 的 Esc 会被浮层吃掉**：中断判据必须以父会话持久日志的
  `turn/end reason aborted` 为准，Esc 重试直到 durable 证据出现；单发 Esc +
  盼文件是不可证伪的（父没断时文件照样可能晚出现/不出现）。
- **复用 scratch 必须清掉上一轮的产物文件、会话扫描必须用本轮独有 RUN_TAG**：
  旧 sleeper 会话曾让 stop 场景出现一次假阳性通过，已修（场景内 rm 旧文件 +
  按 STOP_TAG 过滤会话）。

## 五、结论

steer / resume / stop / resume-archive / model-follow 五场景在全新 DSH_HOME、
stock npm 栈、真模型上全部通过（跨进程重开走公共 Pi ABI 与官方
persisted-resume seam，实时模型继承在 stock TUI 真机上以持久日志证据实证）；
连同上一轮的子代理工具 P0 与撞名别名验收，pi-subagents 的核心工作流
（spawn / 后台 / steer / 等待结果 / resume / 停止 / TUI 管理菜单）已在
headless + dsh-TUI 双端实证。0.16.1 已按用户拍板发布，发版后完整回归证据见 community/examples-e2e.json 与 step-seams-e2e.json。
