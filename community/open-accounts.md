# 挂账本 —— 我们解决不了的东西

用户 2026-08-31 立：回帖长跑里凡是"测了但解决不了"的，都记这里，回头对总账。
判据：**每条必须写清"卡在哪个具体符号/策略上"**——说不出断点的不算挂账，算没查完。

分类：
- **A 上游 pi 缺口**（已报或待报 earendil-works/pi）
- **B DSH 宿主策略或缺口**（无诚实插件路径；可能是有意策略而非 bug）
- **C 我们的欠账**（有合理 seam、桥没接，该我们修）
- **D 证据不足**（没有真实消费者/无法复现，不许硬下结论）

---

## A. 上游 pi 缺口

| 项 | 断点（具体符号） | 状态 |
|---|---|---|
| markdown 围栏包裹的 tool-call `arguments` 静默降级成 `{}` | `packages/ai/src/utils/json-parse.ts` `parseStreamingJson()` 三段修复管线全漏 → 终点 `return {}`；`repairJson` 只修串内转义 | 已报 [pi#8858](https://github.com/earendil-works/pi/issues/8858)（0.84.1/0.84.4 复现），提了两档修法，愿发 PR |
| 两个调用共用一个 `index` 时第二个被静默吞 | `openai-completions` 累加器 index-first 键控，非空 id 冲突时不开新块 | 已报 [pi#8861](https://github.com/earendil-works/pi/issues/8861)；与社区 #4091 对 llm-deepseek 的机械证明成对 |
| 请求体任意字段透传（如 `user`、审计标识） | pi-ai 无 extraBody/body-passthrough 面；`headers` 有、body 没有 | **待报**：社区 #3761 是真实消费者（NewAPI/OneAPI 企业网关按 user 计费）。`prompt_cache_key` 已有替代（cacheRetention + supportsLongCacheRetention），`user` 无 |
| 文本形态工具调用（`<invoke>` / `<tool_call>` 内联在 content）全链零检测 | 累加器实测落为纯文本块、无 toolCall、turn 正常结束（transport-classify case `invokeTagInContent`） | **不报为 bug**：这是设计策略问题（要不要解析散文），社区 #2158/#3609 在推设计；我们只提供了现状测量 |

## B. DSH 宿主策略或缺口

| 项 | 断点 | 判定 |
|---|---|---|
| 自定义路由无法按会话归属用量（#599） | pi-ai **有**通道（`compat.sendSessionAffinityHeaders` → `session_id`/`x-client-request-id`/`x-session-affinity`，openrouter 格式 → `x-session-id`；实测见 provider-headers-results.json），但 DSH `llm-pi-ai` **有意 withhold** 该键（README 明写："需要某厂商专属开关的路由，本就该是一条以该厂商命名的 catalog 路由"）。profile 的 `headers` 是静态字符串，装不了逐会话的值 | **有意策略，非 bug**。诚实结论：settings 路由今天做不到；这是设计权衡的重新讨论，不是插件能补的洞 |
| 思考模式历史回放要求的 `reasoning_content` 字段 | 两条路都不产：`llm-deepseek` 丢字段（社区已隔离 #3857/#1850），pi-ai transform 从设计上内联进 content 不建字段（reasoning-history 双代实测） | 我们排除了"换路由绕行"，修复位只能在官方 adapter。**桥补不了** |
| 内建工具名与 provider 保留名冲突（`web_search`，#1113/#4597） | 名字空间无隔离；`assembly.tools` 可改写是绕行不是修复 | 干净解在上游（给内建工具加前缀或 per-provider 保留名 compat 位） |
| headless codex 路由跑完滞留约 5 分钟（#4190） | 疑似会话级 WebSocket 缓存定时过期；我们的验收装置用 SIGTERM 兜底（`stopChild` → `terminated-after-durable-turn`） | 未定位到具体符号（只到"疑似"）——按判据这条**属于 D 类证据不足**，等上游或他人给出精确断点 |

## C. 我们的欠账

| 项 | 状态 |
|---|---|
| 零包 profile 的存量 OAuth 登录丢路由 | **已修**（2026-08-30，commit 6341cfd）：`restoreLoggedInRouteWhenReady` 改官方 inject 等 credentials 服务；契约测试 + 真机零包双验；教训进 CLAUDE.md |
| （当前无其它已知欠账） | 每轮发现即追加 |

## D. 证据不足 / 不硬下结论

- **#4190 headless 滞留**：见上，只到"疑似 WebSocket 缓存"，没追到符号。
- **#1171**：帖身与标题不符（语料陈旧），未回。
- **#3387**：maintainer 已关闭并入 #2017，回帖=噪音。
- **vLLM 0.82.1 侧 reasoning 字段分类**：0.82.1 的注入 seam 不存在（stream 无 fetch 选项），只能测 0.84.1，已在 #199 回帖里如实写明"不可测"。
- **大量截图型贴**（#931/#695/#4496 等）：只能给症状族二分 + 自查方法，不能定论；回帖已明写边界。

---

## 待办（下轮）

- [ ] `user` 字段透传：给 pi 上游开第三个 issue（消费者 #3761/#599 已有真实场景）
- [ ] ui_client_extension 133 条按 dsh-work-x 现有能力对照，能答的答
- [ ] 新贴池剩余 ~800 虚位继续扫（General 未筛部分 + Ideas 198）
