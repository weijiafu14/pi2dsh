# 缺口路线图（v2）— 296 条 `ours_gap` 的归纳

`ours_gap` 的定义：**属于我们的产品线**——Host ABI 扛得住、DSH 也开放了所需的面，
只是我们还没做。归属分三处：`engine`（pi2dsh 引擎的 ABI 翻译）/ `pi-package`
（要写或移植一个 Pi 包）/ `workx`（dsh-work-x 的产品界面与客户端半边）。

归属分布：**pi-package 134 · workx 111 · engine 48**（3 条未标注）。
热度分布：↑≥10 共 3 条 · ↑5–9 共 11 条 · ↑2–4 共 73 条 · ↑0–1 共 209 条。

> **这份表里"座位/服务存不存在"的前置问题，已由两份实测清单回答**：
> [客户端 slot 座位](seam-evidence/client-slot-inventory.md) ·
> [宿主公开服务](seam-evidence/host-service-inventory.md)。
> 下面每条都标了它依赖哪个已核实的面。

---

## 第一梯队：一个东西吃掉一整片

### R1 · 通用「自带传输的 OpenAI 兼容 provider 包」 — `pi-package`
**覆盖面最大的一条。** 相关帖遍布整份语料，形态高度一致：用户接自建/企业/聚合网关，
被 `dsh-llm-pi-ai` → `dsh-llm-deepseek` 这条官方链路上的某个细节卡住。

要在包里自己拿住的东西（每一项都对应真实帖子）：
- **wire 归一化**：tool-call delta 合并只取非空 `name`/`id`（#2982 ↑3、#2343 ↑3、
  #741、#1405、#1419 —— `unknown tool ""` 一族）
- **429 / `Retry-After` 长退避**：分钟级窗口 + 绝对上限，限流在包内消化，
  不抛给 `dsh-llm-retry` 的 10s 上限（#892 ↑6、#891 ↑3、#1455 ↑5）
- **动态目录**：运行时拉 `/models`，带 `contextWindow` / 模态 / 推理档位
  （#3957 ↑8、#2529 ↑3、#4346 ↑3、#740）
- **自定义 headers / UA**（#1455 ↑5：opencode-zen 要 `User-Agent: opencode/...`）
- **按需省略 `thinking` 字段**（#1580 ↑3、#3857 ↑3）
- **tool-call arguments 剥 markdown 围栏**，做成 `supportsDeveloperRole` 同款
  compat 开关（#3047 ↑3）
- **tool-call id 会话内唯一化**，接住每条消息重排编号的聚合网关（#4501 ↑2）

底座已核证等级一（`pi-provider-alibaba` 全链、`gateway-compat` 三个 compat 字段
真上线、Codex OAuth 订阅登录）。**缺的是包本身。**

⚠️ 注意：语料里另有约 105 条 `no_dsh` 的 workaround 写的是"走我们路由绕开官方
累加器"，等级一律是 **`结构性成立/行为未测`**——pi-ai 自己的累加器扛不扛得住那些
畸形报文，我们一次没测过。**R1 开工的第一步就是把这件事测掉**，否则这 105 条的
回帖口径永远只能是"值得一试"。

### R2 · `assembly.tools` 改写宿主工具条目 — `engine`
**已实测可行**（2026-08-26，真 DSH 组合上的探针：改 `description`、删
`parameters.properties` 里的字段，assemble 返回结果两处改动都在）。今天我们只支持
按名过滤，不支持改写已有条目。

打开后直接消掉的痛点：
- **把 `sandbox_permissions` 从原生 bash/edit/write 的 schema 里摘掉** → 模型看不见
  就不会发，那个刷屏的"升级被拒→重试"死循环从源头消失（#1069 ↑9、#201 ↑8、
  #468 ↑4、#1935、#1292、#340、#806 …… 这是全语料里重复次数最多的单一症状）
- **清洗非法 JSON Schema 字段**（`null`、属性内误写的 `required:true`），严格网关
  直接 400 的问题（#1254、#447、#129）
- **改写误导性的 description**、隐藏/改名被上游占用的工具名（#1113 的 `web_search`
  保留名冲突让 grok 4.5 完全不可用）
- 转义 description 里的字面量 `{{`（#711）

**成本最低、解锁面最大、且机制已经验过。建议第一个做。**

⚠️ 边界必须写死在代码注释里：**改 schema（模型看到什么）可行；改 arguments
（模型已发出的调用）已证伪**——`tools/pre-execute` 对 DSH 原生工具会被硬拒，
理由是"DSH 核心在策略之前就把 arguments 记进日志了，这是有意为之"。
#3874 ↑5、#4021 ↑3 押的是后者，**不成立**。

---

## 第二梯队：浏览器半边（座位已核实，不再是未知数）

`conversation.view` 是 **list 座位**，官方注释原话："会话视图环，每个视图 tab 一个
list 条目（chat 在此；trajectory/waterfall 来自 ui-trajectory）"。
**即：我们可以加一个与聊天并列的会话视图 tab。** 下面几条共用同一套装置。

### ~~R3 · Web 文件浏览 / 预览面板~~ — **撤销：社区已做**（2026-08-26 查证）
`dsh-file-browser@0.1.1` 已经上线并覆盖这一片：会话头部按钮 + 右侧抽屉、工作区
文件树、文件内容阅读、git 状态标记、选中文本向 AI 提问。声明是
`dsh.client: { inject: ["slots"], platform: "web" }`，无安装脚本。
另有 `@linxin666/dsh-client-ui-aionui-panel`（右侧面板体系）。
→ **#633 ↑5 · #798 ↑4 · #819 · #873 · #869 · #864 · #1821 · #987 改判「已被社区解决」**，
正确动作是**回帖指过去**，不是我们再造一个。
**只有 diff 视图（#744 ↑8）还空着** —— 把 edit/write 工具结果渲染成行级 diff 卡片，
先确认 dsh-file-browser 覆不覆盖，不覆盖再单做，规模比原计划小一个量级。

### ~~R4 · composer 的拖放 / 上传~~ — **撤销：社区已做**（2026-08-26 查证）
`dsh-file-upload@0.4.3` 已覆盖：Claude 式拖放 + 回形针上传、内容嗅探、
**自带文档 → Markdown 转换**（MarkItDown，20+ 格式，含图片 OCR）、文本注入输入框、
语音转文字、外加给模型用的 `read_document` 工具。
同族：`dsh-upload-button`（卡片式，不污染草稿）、`dsh-pdf`（本地 PDF 抽取）。
**它挂的正是我核出来的那两个 list 座位**（`conversation.input.dock` /
`conversation.input.left`）——座位分析是对的，只是别人先做了。
→ **#337 ↑4 · #3001 · #625 · #2816 · #3910 · #1612 · #1008 · #1969 · #2072（语音听写）
改判「已被社区解决」**；R4 只剩 **@文件引用选择器**这一小半还空着（#146 ↑11 · #813 ·
#827 · #2966 · #659），开工前先确认 dsh-file-upload 覆不覆盖。

### R4' · composer 的 @文件选择器（收窄后） — `workx`
#146 ↑11（@选择文件）· #337 ↑4（文本文件拖拽）· #813 · #827 · #2966 · #2816 · #625
· #3910 · #659 · #1612 · #1008 · #1969。
座位已核实：`inputTriggers` 是公开 service，`conversation.input.overlay` 是 list 座位
（官方 input-trigger 包自己就注册在这里）。
**拖放不要去抢 `conversation.input.attachments`**——那是 single 座位，占了就等于
替换官方的草稿图片轨、得自己重实现预览；正解是在 `conversation.input.dock`
（list，"整行自成一行"）加一条自己的投放区。

### R5 · 模型目录编辑面 — `workx`
#4044 ↑6。把 settings 里已存在但设置卡片没覆盖的字段（`inputModalities`、推理档位、
compat 开关）做成可视化编辑，经官方写面回写 provider 段。座位 `settings.section`
是 list，**我们已经在用**（dsh-work-x 的 Settings → MCP 页）。

### R6 · 后台任务面板 — `workx`
#757 · #608 · #2575。**此前判 `no_dsh` 是错的**：`ctx.jobs` 有完整的
`list / get / read / kill / wait / onJobsChanged`，枚举、详情、输出、终止、实时刷新
全都有公开面。缺的只是我们的界面。
（"清除终态记录"确实没有 remove/clear —— 那一小半仍归 DSH。）

### R7 · 会话生命周期管理面 — `workx`（**范围要收窄**）
#3546 ↑3 · #3339 ↑3 · #2772 ↑5 · #3892 ↑2 · #4441 ↑2。
**逐条核准后的实情**：`archiveSession` 有公开写面 → 归档、附着/脱离、排序、改标题
这一段是我们的缺口；但**没有 unarchive 对等方法**，`archivedSessionIds` 是只读
getter，`SessionPersistence` 也没有 delete/forget。
→ **"恢复归档"和"永久删除"给不了，这两条得如实说是 DSH 的缺口。**
别去动 `workspaceRegistry.table()` 那个原始 KV 句柄绕过语义 API——那正是标准禁止的形态。

---

## 第三梯队：单条价值高的 Pi 包

### R8 · 中文 / 自定义系统提示词覆盖包 — `pi-package`
**#320 ↑26 —— 全语料 `ours_gap` 里热度最高的单条。** 用户要 Agent 预设的系统提示词
支持中文，让中文模型按中文思考。
底座已实测：Pi 的 `before_agent_start` 覆写已桥接到官方 `system-prompt/assemble`
（async waterfall、返回值权威、当轮生效），可整段替换/翻译 persona 与 instructions。
同族还有 #519（祖先链 AGENTS.md 注入）、#1687（产品自解释上下文）、#1165（仓库结构
快照）、#1957（墙钟时间锚）、#1159（人格包）——**一个"提示词装配"小包家族**。

### ~~R9 · mermaid 渲染包~~ — **撤销：社区已做，且做法比我设想的好**（2026-08-26 查证）
`@puji4810/dsh-mermaid` 已上线：客户端占 `root` 入口，对渲染后的 DOM 做后处理，
把 `language-mermaid` 代码块**就地**换成 SVG，跟随 `prefers-color-scheme`，
逐图超时保护、失败保留源码。同作者还有 `@puji4810/dsh-tikz`。
另有 `dsh-mermaid@0.3.0`（`details` 右侧抽屉形态）与 `mermaid2aichat-dsh`（浏览器扩展）。
→ **#610 ↑14 · #1065 · #1135 · #859 改判「已被社区解决」**，回帖指过去。
→ 我原先"fence 渲染做不到"的结论**是错的**，已在
[诚实清单](v2-honest-limits.md) 与 [座位表](seam-evidence/client-slot-inventory.md) 更正。
教训写进判据：**"没有 slot" ≠ "做不到"**，下结论前先搜一遍 npm。

### R10 · 回退 / 检查点 — **从「写一个」降级为「验一个」**（2026-08-26 查证）
#200 ↑5 · #1042 · #1283 · #2357 · #4592。
`pi-rewind-hook@1.8.5` 是现成的 **Pi 扩展**，做的正是这件事：自动 git 检查点、
文件与对话恢复、rewind 元数据以隐藏条目存在会话里（跨 fork / resume / tree 导航 /
压缩都活着）、快照 commit 用单个 git ref 收敛、可配置保留策略。无安装脚本。
**开工内容变成一次核证**：① 它写的隐藏会话条目经我们的桥落盘时带不带 `ignorable`
（CLAUDE.md 明令，不带会把用户历史锁死）；② 它依赖的 `/tree` 导航在我们这边投影成
官方 `ctx.sessions.fork/navigateTree` 后行为对不对。
验过就是一条 `yes_today`，验不过才谈自己写。

### R11 · 预算 / 断路器包 — `pi-package`
#2046 ↑3（重复工具调用死循环）· #704 · #729 · #2039（作者已写好剪枝扩展、只差发 npm）。
数据源已核实：`ctx.tokenMeter.measure(session)`。拒绝通路已核证：Pi 的 tool_call
deny（`pi-approval-guardian` 上 allow/deny 都实际观察到）。
**追加一条已核实的能力**：`ctx.permissionPresets.set(session, name)` 是公开写面，
所以声明式权限策略包（#858）不必只靠 deny，能真正切 DSH 自己的 preset。

### R12 · Claude Code 形状 hook 桥接包 — `pi-package`
#1801 ↑5。工具名归一（write→Write / edit→Edit / bash|pwsh→Bash），绕开官方
`dsh-hooks-claude-code` 的小写工具名问题。

---

## 现成插件复用盘点（2026-08-26 查 npm，含核证状态）

**这一轮最省钱的发现：路线图里好几项别人已经做了。**下结论前先搜 npm，这条进判据。

| 路线图项 | 现成候选 | 状态 |
|---|---|---|
| R3 Web 文件面板 | `dsh-file-browser@0.1.1`、`@linxin666/dsh-client-ui-aionui-panel` | **已做，撤销自研**。回帖指过去 |
| R9 mermaid | `@puji4810/dsh-mermaid`（就地 SVG）、`dsh-mermaid@0.3.0`（抽屉）、`@puji4810/dsh-tikz` | **已做，撤销自研** |
| R10 回退/检查点 | `pi-rewind-hook@1.8.5`（Pi 扩展） | **降级为核证**：查隐藏会话条目的 `ignorable` + `/tree` 投影 |
| R1 通用 provider | `pi-cliproxyapi-provider`（自动模型发现）、`@indexyz/pi-provider-sub2api`、`pi-provider-mux`、`pi-provider-volcengine-agent-plan`、`@aliou/pi-cohere`、`pi-cursor-sdk` | **先各挂一遍再决定自研范围**；很可能只需补 wire 归一化与 429 退避 |
| R8 系统提示词 | `pi-system-prompt-switcher`、`pi-system-prompt-patcher`、`pi-model-sysprompt-appendix`、`pi-system-prompt` | ⚠️ **patcher 大概率不通**——它改的是 Pi 自己发请求前的 `system` 字段，而经桥的模型调用走 DSH llm 路由、不经那个点（这正是 #3940 报的缺口）。**要先挑用 `before_agent_start` 的那个**，别想当然 |

判据补充：**Pi 扩展能不能经桥工作，取决于它挂的是哪个钩子**。挂
`before_agent_start` / 工具注册 / 命令注册的都通；挂 Pi 自己 provider 发送路径的
不通（我们把模型调用交给了 DSH）。**推荐任何现成包之前先确认这一点。**

## 开工顺序建议

| 顺序 | 项 | 覆盖帖数 | 理由 |
|---|---|---|---|
| 0 | **挂现成包核证**（pi-rewind-hook / 几个 Pi provider 包 / 提示词包） | ~40 | 成本最低：不是写代码，是各挂一遍看通不通。通了直接变 `yes_today` |
| 1 | **R2** assembly.tools 改写宿主工具条目 | **~75** | 机制我实测过、改动落在引擎一处、消掉全语料重复次数最多的症状（沙箱升级死循环） |
| 2 | **R1 第一步**：测 pi-ai 累加器扛不扛畸形报文 | **~109** | 一次实验，决定 109 条 workaround 的口径能不能从"值得一试"升成"实测可用" |
| 3 | **R8** 中文/自定义系统提示词包 | ~9（但含 ↑26 的单条最高） | 底座已验、包很小、#320 是全语料 ours_gap 热度第一 |
| 4 | **R4'** composer 的 @文件选择器（拖放/上传已被社区做掉） | ~5 | 座位已核实；先确认 `dsh-file-upload` 覆不覆盖，覆盖就整条撤销 |
| 5 | **R1 全量** 通用 provider 包 | ~91 | 覆盖面最大，但要先做完第 0、2 步才知道自研范围 |
| 6 | R6 后台任务面板 · R5 模型目录编辑面 · R7 会话面（收窄版） | ~30 | 座位与服务都已核实 |

**回帖侧同步动作**：R3 / R4 / R9 撤销后腾出的那批帖子（**约 30 条**）不是消失了，
而是变成"指向社区插件"的回帖——零成本、纯善意，还能顺带认识做那些包的人。

**两轮查证下来，三项自研被社区现成插件顶掉（R3 文件面板、R4 拖放上传、R9 mermaid）。
"下结论前先搜 npm"这条判据，两轮各救回一次返工。**

**每一项落地后按 CLAUDE.md 第五节补 example，并进 `pnpm test:examples` 回归。**
