# DSH 客户端 slot 座位清单（实测，2026-08-26）

**取证方式**：从真实安装树里读官方客户端包的 `interface SlotMap` 声明合并
（`@deepseek-ai/dsh-client-ui-{layout,conversation,settings,input-trigger}` @0.1.1-rc.2
＋ `@deepseek-ai/dsh-client-ui-sidebar@0.1.1-rc.2`，后者该 profile 被
dsh-better-sidebar 顶掉了，单独 npm pack 补齐）。**不是推测，是包里的公开契约。**

**仓外插件确实能用**：dsh-work-x/client.js 实际注入
`conversation.composer.dock` / `conversation.input.dock` /
`conversation.session.header.utilities`；dsh-better-sidebar 注入
`conversation.chat.node` / `conversation.chat.turnTail`。list / keyed / chain
三种 kind 都有仓外先例。

## 全部 43 个座位

| 座位 | kind | scope |
|---|---|---|
| root | single | root |
| sidebar | single | root |
| sidebar.brand.mark | single | root |
| sidebar.brand.name | single | root |
| sidebar.workspaces | single | root |
| sidebar.settings | single | root |
| **sidebar.footer.action** | **list** | root |
| conversation | single | session-maybe |
| **conversation.view** | **list** | session |
| conversation.session | single | session |
| conversation.session.header | single | session |
| **conversation.session.header.actions** | **list** | session |
| **conversation.session.header.utilities** | **list** | session |
| conversation.session.header.lineage | single | session |
| conversation.chat.node | keyed | session |
| conversation.chat.commandview | keyed | session |
| conversation.chat.turnTail | chain | session |
| **conversation.chat.assistant-actions** | **list** | session |
| conversation.composer | chain | session |
| conversation.composer.bar | single | session-maybe |
| **conversation.composer.dock** | **list** | session |
| **conversation.input.dock** | **list** | session |
| **conversation.input.left** | **list** | session |
| **conversation.input.right** | **list** | session |
| **conversation.input.overlay** | **list** | session |
| conversation.input.attachments | single | session-maybe |
| conversation.input.model | single | session |
| conversation.input.plan | single | session |
| conversation.message.images | single | session |
| conversation.details.tool | single | session |
| conversation.hero.agentPreset | single | root |
| conversation.hero.brand.mark | single | root |
| conversation.hero.workspace | single | root |
| details | single | session |
| **shell.overlay** | **list** | root |
| **settings.section** | **list** | root |
| **settings.plugins.tab** | **list** | root |
| **settings.general.item** | **list** | root |
| **settings.action** | **list** | root |
| **settings.onboarding** | **list** | root |
| settings.header | single | root |
| settings.close | single | root |
| settings.trigger | single | root |

（粗体 = list 座位，追加不替换，仓外插件可安全占用。）

## 对判定的直接影响

### ✅ 成立：自有会话视图 tab（这是最大的一条）
`conversation.view` 是 **list**，官方注释原话是"会话视图环：每个视图 tab 一个
list 条目（chat 在此；trajectory/waterfall 来自 ui-trajectory），由会话主体按
`only: <active id>` 一次渲染一个"。

**即：仓外插件可以加一个与"聊天/轨迹"并列的会话视图 tab。** 于是下列判定
从"前置未核实"升为**座位确实存在**：
- 文件树 / 文件浏览编辑预览面板
- 轨迹 / 统计 / 用量视图
- 会话目录（用户提问导航）
- 分支树可视化
- 内嵌终端面板

### ✅ 成立：composer 附近的自有条目
`conversation.input.dock`（list，"整行自成一行，适合 queue 行、todo 条、goal 条"）、
`conversation.composer.dock`（list，输入卡下方的环境读数带）、
`conversation.input.left` / `.right`（list，卡内工具行里的小控件）。
→ 拖放投放条、上传入口、预算/熔断读数、语音听写按钮**都有干净的追加座位**。

### ⚠️ 有代价：附件/拖放区是 single
`conversation.input.attachments` 注释原话包含 "drop target"，但 kind 是
**single** —— 注册进去等于**替换**官方的草稿图片轨，得自己重实现图片预览。
所以"非图片文件拖放"的正解不是抢这个座位，而是在
`conversation.input.dock` 加一条自己的投放区。

### ⚠️ 更正：markdown 内的 fence 渲染——没有 slot，但有人绕过去了
`conversation.chat.node` 是 **keyed，按 `ChatConversationViewNode.kind` 分发**，
即"整个节点按种类换渲染器"，不是"assistant 文本里的某个代码块换渲染器"。
所以**没有 fence 渲染的 slot**——这一半是对的。

**但"因此做不到"是错的**（2026-08-26 自查更正）：客户端插件可以占 `root` 入口、
对渲染后的 DOM 做后处理。`@puji4810/dsh-mermaid` 已上线并这么工作：按
`language-mermaid` class 匹配已 settle 的代码块 → 就地替换成 SVG → 跟随
`prefers-color-scheme` → 逐图超时保护 → 失败保留源码。
`@puji4810/dsh-tikz` 是同族。

判据更新：**"没有 slot" ≠ "做不到"**。客户端插件的 `root` 入口 + DOM 后处理是
一条真实存在的路，代价是它不是官方契约、宿主改 DOM 就会坏。
下这类结论前要先搜一遍 npm 有没有人已经做了。

### ✅ 成立：每条消息旁加操作、会话头加操作
`conversation.chat.assistant-actions`（list，"附着在一条已完成 assistant 消息上的
操作条"）、`conversation.session.header.actions` / `.utilities`（list）。
→ 重跑、导出、发去子会话、分叉入口都有座位。
（注意：**有按钮 ≠ 有权威写面**。归档/删除会话仍受"不写别人的权威 store"约束。）

### ✅ 成立：设置页与侧栏页脚
`settings.section` / `settings.plugins.tab` / `settings.general.item` /
`settings.action` / `settings.onboarding` 全是 list（我们已在用 settings.section）；
`sidebar.footer.action` 是 list —— #1795 提帖人说它是 sanctioned 座位，属实。
