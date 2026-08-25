# pi2dsh 标准全集（详细版，含事故档案）

本文是 [CLAUDE.md](../CLAUDE.md) 各条标准的完整版：每条标准配它的由来
——真实发生过的事故。改任何标准前先读对应事故；想再犯一遍的冲动，通常
就是当初犯它的那个理由。

**总纲：对用户，一切是 DSH；对插件，一切是 Pi；中间层是唯一的翻译官，
且能借 DSH 官方的力就绝不自己造。**

---

## 一、用户安装使用标准

### 1.1 引擎形态是唯一默认姿势

```sh
dsh plugin --profile p add pi2dsh              # 装一次引擎
dsh plugin --profile p add @kassing/pi-vision  # 之后装谁用谁（npm 原包）
dsh plugin --profile p remove <pkg>            # 卸载
dsh plugin --profile p add pi2dsh@latest       # 升引擎（插件不动）
```

零转换、零生成产物 —— 而且**代码里也不再有第二条路**：`convert` /
`host` 两个命令、`generateBundle` / `generateHostBundle` 两个导出、
`src/generator.ts` 整个文件，连同只测它们的两个测试文件，全部删除。

留着它们的代价不是"多一个特例"，是**验证会架在错的路上**：主集成测试和
真机端到端曾经都在装转换产物，跑得再绿也证明不了用户那条路。开发和测试
必须走同一条路，而那条路只有一条。

**事故档案（0.5.x 及以前，代码已删除）**：最初的形态是逐包 `pi2dsh convert` 生成
bundle 再 `add file:...`——N 个插件 = N 个 bundle = N 份桥运行时拷贝。
桥升级要把每个 bundle 重转重装；多份桥实例各自注册，`/login` 撞出
`/login-2`、models.json 路由重复注册（"already has a live adapter"）、
跨 bundle 状态不一致（伴生映射只在赢得注册的那份里，另一份的 ctx.model
投影失效导致视觉插件不激活）。业界调研（Vite/oclif/Homebridge/
Claude Code）无一家让用户"先转换再装自制品"。

### 1.2 一份引擎，host 级资源单份

一个 host 里只有：一个模型目录、一个 /login、一个凭证存储、一个 catalog
投影、一份伴生映射（runtime.ts 的 `SharedHostState`，跨包共享）。包级
资源（tools/commands/events/runner）各归各。旧的独立 bundle 形态各带
模块图，天然各持一份，行为不变。

**发现到零个社区包，不等于不需要 host 运行时。** 内建 OAuth provider、
`/login`、已存凭证恢复和伴生路由都是引擎自己的能力；只安装 `pi2dsh` 时也必须
挂载。2026-08-20 的 rc.8 冷启动实测抓到过反例：engine 的空清单分支只注册伴生
路由就提前返回，导致 `/login openai-codex` 未注册，被 DSH 当普通 prompt 送给默认
模型。修复后的判据是：全新 DSH_HOME、profile 只有 pi2dsh 依赖时，命令目录必须已有
`login`；从 Web 授权得到的凭证必须立刻进入 DSH settings、credentials 和模型目录。

### 1.3 发现 = 清单驱动 + 官方标记，绝不扫目录

引擎读 profile package.json 的**直接依赖**（每一项都是用户显式
`dsh plugin add` 的，意图明确），用 Pi 官方 `pi` 字段（次选目录约定）
判定是否 Pi 包；`dsh.bundle` 声明者是 DSH 插件层，排除。config
`packages`（显式清单）/`exclude`（排除）兜底。

**先例依据**：Prettier 3.0 移除了 node_modules 目录扫描式插件发现
（包管理器布局下不可靠、不透明）；Homebridge 用包自我声明的 keyword。
清单驱动 + 标记判定各取两家之长。

### 1.4 引擎依赖必须干净

- **不带安装脚本**：pnpm 对**传递依赖**的安装脚本是报错性拦截
  （exit 1），直接依赖只警告——引擎依赖树里任何一个带 postinstall 的
  传递依赖都会让用户第一条命令失败。
- **不拖 CLI-only 大件**：CLI 静态分析用的 typescript（23MB）是
  optional peer + 懒加载（index.ts 对 analyzer/generator 动态 import
  分包）；改依赖后必须验证 dist/index.mjs 的静态 import 闭包不含它。

**事故档案（0.6.x）**：为给 models.json 路由提供传输，把
`@earendil-works/pi-ai` 整包放进引擎依赖——它拖 `@google/genai`（14MB，
我们根本不用 Gemini）→ `protobufjs`（带 postinstall）→ 用户
`dsh plugin add pi2dsh` 第一条命令被 pnpm 拦下报
ERR_PNPM_IGNORED_BUILDS。第一版"处理"是在 README 教用户自己改 profile
的 pnpm-workspace.yaml——**把自己的选型失误转嫁成每个用户的手工作业，
被正确地骂了**。根治 = 依赖树里根本不该有它（见 3.1 官方件标准）。
装引擎从 129 包降到 84 包。

### 1.5 宿主安全门不绕

用户装的**插件**若传递依赖带安装脚本，同样被 pnpm 拦——这是 pnpm/DSH
的供应链安全设计（构建脚本必须用户拍板，DSH 已把待批包名写进 profile
的 pnpm-workspace.yaml 占位）。桥绕过它 = 替用户做安全决定。只做：文档
写清一次性应对（allowBuilds 设 true 或 approve-builds）。

### 1.6 其它安装语义

- 挂载在启动时：加/卸插件后重启 dsh。
- 卸载顺序：先卸插件再卸引擎（否则插件成无人挂载的死依赖）。
- 伴生路由等引擎配置是 per-profile 的；DSH 的默认模型选择却是
  DSH_HOME 级共享——在 A profile 选了伴生路由、B profile 没配伴生，
  B 端会 NO_ADAPTER（DSH 对一切缺失路由的标准行为）。每个用到的
  profile 配一份。
- lockfile 语义：插件永不被动升级；升级前 `pi2dsh inspect
  <pkg>@<version>` 看兼容报告（桥拦截了 Pi 运行时 import，插件锁的
  Pi 依赖版本不会被加载，唯一漂移风险是插件用了桥未覆盖的新 Pi API，
  报告可见、运行时按包隔离显式报错）。

---

## 二、Pi 插件处理标准（用户面界线）

### 2.1 界线本体

**插件说 Pi 话，用户说 DSH 话，中间层负责翻译。用户面前永远没有 Pi。**

用户接触面 = 要动手写的配置文件、要看的文档教程、要敲的命令、报错里的
指引。这些**一律 DSH 形状、DSH 官方机制**：

| 用户要做的事 | 用的 DSH 机制 |
|---|---|
| 配自定义模型网关 | `$DSH_HOME/settings.yaml` 的 `llm-pi-ai:` 段（官方通用适配器，热生效） |
| 配图片准入伴生路由 | profile `cordis.patch.yml` 的 `- id: pi2dsh` config（`visionCompanions`） |
| 配凭证 | `apiKeyEnv` 等 DSH credentials 引用（密钥不进文件） |
| 装/卸/升级 | `dsh plugin add/remove` |

Pi 形状只允许活在两处：**插件视野**（compat shim、registry/ctx/事件
投影）与**中间层内部实现**（vendored 源码、auth.json 等内部存储——
用户不编辑的不算用户面）。

**判据：用户需要亲手读写的东西里出现 Pi 词汇或格式 = 泄漏 = 返工。**

### 2.2 事故档案（0.4.x–0.7.x：models.json）

把 Pi 的标准配置文件 models.json（`~/.pi/agent/models.json`）作为
"Pi 标准配置入口"搬进 DSH 用户世界（重定向到
`$DSH_HOME/pi2dsh/agent/models.json`），文档教 DSH 用户写 Pi 格式的
JSON 配模型、用 Pi 的 modelOverrides 语义配伴生路由。辩护理由是
"Pi 生态教程照搬可用"——方向性错误：**兼容的对象是插件代码，不是把
Pi 的用户习惯搬给 DSH 用户**。后果链：为它自建了配置解析（vendored
三个 Pi 源文件）、路由注册、三族凭证解析、投影账本，然后为传输引爆了
1.4 的依赖事故，然后为"配置到底写哪"制造了双入口困惑。0.8.0 全链删除
（-2454 行），用户配置回归 DSH 官方 settings。

### 2.3 插件功能如何到达用户（正确的样子）

插件的能力经 DSH 原生面呈现：斜杠命令进 DSH 命令面板、注入以 DSH
"上下文注入"行显示、工具进 DSH 工具系统、模型路由进 DSH 选择器。用户
全程在用 DSH，感知不到底下有个 Pi 生态在运转。

---

## 三、中间层开发标准

### 3.1 先查官方，配置翻译 + 官方实现

**DSH 已有官方能力，一律"配置翻译 + 官方实现"，禁止自建平行运行时/
传输/第二套配置入口。动手前先查 DSH 官方有什么。**

已知官方件清单（动手前对照）：
- `@deepseek-ai/dsh-llm-pi-ai`：通用模型适配器，任意 OpenAI 兼容网关
  = settings 纯配置（三种 wire 协议全支持，在 base 默认组合里）
- `@deepseek-ai/dsh-mcp-client`：配置型 MCP server（我们的 mcp-config 就是
  范例：只做配置翻译，零运行时）
- `@deepseek-ai/dsh-skill-filesystem`：skills 挂载
- settings / credentials seam：用户配置与凭证引用

**事故档案（0.6.x–0.7.x）**：给 models.json 路由自建传输，两版皆废——
第一版背 pi-ai 全家桶（引爆 1.4 安装事故），第二版自写 openai-completions
wire client（500 行 + 契约测试，发版 0.7.0）。而官方 llm-pi-ai 从头就在
默认组合里，"an OpenAI-compatible gateway … is configuration rather
than a code change" 是它 README 的原话。两版全部删除。教训写成三个字：
**先查官方**。

这里必须区分“配置”与“能力包”：如果用户只迁移 MCP server 定义，必须走
官方 `dsh-mcp-client`；如果用户显式安装的 Pi 包本身就是一个能力运行时，且它拥有
官方客户端没有的管理面、lazy proxy、脚本编排、OAuth、resources/prompts 等行为，
兼容层应保留这个已发布包的运行时，只把它使用的**公开 Host ABI** 映射到 DSH，
不能把 transport/cache/auth 再抄一份。宿主已有同名命令时保留宿主原命令，并为
外来命令提供有来源含义的别名（dsh-TUI：原生 `/mcp` 保留，Pi 包为 `/pi-mcp`）。
这不是“桥自建第二套 MCP”，而是“用户安装的能力包原样运行”；核心仍禁止按包名
实现 transport 或业务逻辑。

能力包验收必须按**归属边界**拆证据，不能拿一条工具 smoke test 冒充完整支持：

- 一切可能受 Host ABI 影响的面（生命周期、命令、TUI、动态工具、交互、附件、
  模型回调、取消）必须由真实包穿过真实 DSH runtime 做 E2E；
- 包内部的 transport/OAuth/cache/protocol 分支使用**同版本上游完整测试与协议一致性
  套件**作为基线，不在桥里复制实现，也不拿自制 mock 重演一遍；
- 两份证据的版本与已知降级必须写进一张可复核矩阵。`pi-mcp-adapter@2.26.1`
  的落地范本见 [`mcp-compatibility.md`](mcp-compatibility.md)。

终端形态同样只走公开 seam：Pi `ui.custom`/`setStatus` 映射到 dsh-TUI 公开的
`tuiScenes`/`tuiStatus`；有服务才挂载，无服务保持 headless。桥只识别能力与命令
所有权，不识别插件包名。宿主保留命令与外来命令冲突时，宿主命令不动，外来命令
获得有来源含义的别名。

### 3.2 三层零跨层

（见 CLAUDE.md 架构图。）插件需要的一切只来自中间层：三包 import 被
jiti alias 截获；registerX/事件/ctx 全是投影；插件视野 100% Pi 词汇，
连字符串都不出现 DSH 概念（宿主托管路由的 api 用 Pi 官方词 'faux'）。
DSH 看到的只是普通 cordis 插件与普通 llm adapter。

### 3.3 单一目录、单一调用路径

- 运行时模型目录只有 DSH llm 目录；Pi registry 是其精确投影。包注册
  路由的出口 restore 完整 Pi 形状（api/baseUrl/cost/…）——Pi 元数据
  账本是中间层本职。
- 插件一切标准模型调用（registry.complete、getProvider().stream、
  pi-ai 顶层 complete/stream、createAgentSession）必经中间层转给 DSH
  llm 路由。插件面永远拿不到直连传输；wire 层只属于路由供应商内部
  （DSH 自家 adapter 也如此）。
- 包注册 provider 的投影存在性由路由归属裁决：路由名没拿到（冲突/
  无 llm）＝不在投影里，绝不让别人路由的模型穿这份注册的 baseUrl。
- 只声明目录、不带自有 stream 的包注册 provider：翻译成官方 `llm-pi-ai`
  profile（协议、端点、凭证引用、模型容量/模态/推理档位、官方开放的 compat），
  不给桥合成传输；真实请求由 DSH 官方 adapter 发出。

**事故档案**：跨层调用曾出现三处——getProvider 携带 wire 传输绕过
DSH llm、registry.complete 缺失、DSH 原生路由 getProvider 返回
undefined——被"别让我看见跨层的东西，跨层就会导致不一致性"钉死后统一
收敛到 dshRoutedStream 单一路径。

**事故档案（2026-08-21：Pi 运行时挂载双路径）**：为让 dsh-TUI 上做到
每 Agent 一份 Pi 实例，先是越界 fork 了 DSH Core（AgentRegistry 加
`agent/setup` serial——被用户当场喝止"我让你 fork TUI 你把 DSH 给我改
了"），改回 TUI fork 的 `tui/agent-setup` seam 后，又在引擎里做了能力
握手：surface 声明 seam 才逐 Agent，否则 Web/headless 退回全局单例。
同一个 Pi ABI 两种语义，被用户毙掉（"还能分裂两套的？？"）。返工用
倒推法重查 stock 官方面：`agent/created` 在每条发布路径必触发（含
setup 路线覆盖不到的 config 声明式 Agent）、`agent.ctx` 是公开
agent-local 契约（DSH 自家 schedule 插件同款用法）、awaited 的
`system-prompt/assemble` + `tools/pre-execute` waterfall 提供首轮就绪
门（`assembly.tools` 在 waterfall 前快照，门内用官方 `tools.schemas`
补齐）。据此收敛为唯一路径：每个 root Agent 一份、全 surface 无条件
一致、零 fork 依赖；stock npm CLI + stock npm dsh-TUI 真机 E2E 两个
Agent 双真模型回合验证（scripts/verify-tui-singlepath-e2e.mjs）。TUI
fork 的 seam 提交作废；core patch 的形状仅留作上游 PR 提案。教训：
"为一个 surface 谈下来的专用接缝"是把架构押给单点，先问"官方已发布
的面能不能组合出同一保证"。

**事故档案（2026-08-22：全局/会话归属没先立判据）**：单路径重构落地后
用户追问"你这个分身对齐 pi 的机制了么"，通盘对照真 Pi 源码才发现：分层
是凭感觉分的，Pi 的语义模型（磁盘持久 / 会话共享 / 扩展私有三层；运行时
无跨会话全局层，每次 /new、fork、resume 都整套重建并重跑工厂）从来没被
钉成标准。后果三处：① pi.events 每包一条 EventEmitter——Pi 里是同会话
全扩展共享一条总线，我们让同会话两个包互相听不见（theme 同族）；
② provider 账本做成"占位整体顶替 + 包对包先到先得"——Pi 是 builtin
底座 + 扩展覆盖层的字段级组合、后到覆盖、注销还原底座（①②均已按 Pi
语义修复并有契约测试与真机回归钉死，0.15.0）；③ 审计中我一度
把锚判成"偏差、Pi 无对应物"并提出"沉淀式"（工厂只在会话里跑）去凑
工厂次数的整齐——被用户一句"不跑插件你怎么知道里面有什么"击毙：Pi 无
声明清单，宿主要在零会话时知道插件内容只有跑工厂一条路，"沉淀式"的
真实后果是装了插件系统面上看不见。零会话时刻的最终世界形状（完整模拟
单会话+产品调整 vs 锚）作为开放决策记录在
architecture-mapping-matrix.md 的"生命周期语义模型"章节。教训：跨生态
分层前先把对方的生命周期语义读成显式模型再动手；"机制数字一致"不是
对齐目标，"插件与用户可观察行为一致"才是；这种量级的理论模型落架构
文档，工作准则只留操作判据。

### 3.4 实现纪律

- 零 patch、零 hacky、零私有 API；核心转换器禁止
  `if (packageName === ...)` 逐包特判——修公共 ABI 缺口，同类包一起
  解锁（一次 jiti 子路径 alias 修复同时解锁 4 个包）。**当前唯一成文
  例外**：runtime.ts 的 `KNOWN_IMAGE_TOOLS_BY_PACKAGE`（2026-08-20
  审计成文）——Pi 没有"工具会输出图片"的声明机制，浏览器图片卡只能对
  逐包核证过输出契约的工具开放；这是缺口标记不是可扩展方案，正解是
  推动 Pi 上游加图片输出声明。新增逐包例外必须先写进 CLAUDE.md 对应
  条款。
- **Pi 兼容面钉死单一上游版本**（当前 Pi 0.84.1；2026-08-20 拍板）：
  上游发新版不自动跟，升级快照是一次显式决策（重盘声明 diff、逐条归类
  新面、更新规则/文档/vendored 来源 commit）。由来：追上游的"发现新
  接口"环节纯靠人、无自动提醒（标准又禁止固定数量校验），与其无声
  漂移不如锁死；插件锁的 Pi 依赖本就不被加载（jiti alias 截获），锁死
  对用户无感。
- 语义对齐以真 Pi 源码为准（../pi 是源码参照）；vendored 文件字节级/
  节选搬运并注明来源 commit，logic unchanged。
- 同名不同义的行为必须写进 src/compatibility.ts 判定文案（例：
  registerCommand 撞名编号 /name-2 vs Pi 的 :1/:2；伴生路由选择下
  ctx.model 报原身路由——生成模型的真身是原路由，这是视觉插件激活
  判定需要的真相）。
- 插件自身的 bug（真 Pi 同版本同样坏）不 patch，如实归因即为界（例：
  kassing pi-registry 模式在 pi-ai 0.84 的收流 bug）。
- 跨目录通道透传字段用白名单，禁止裸展开。**事故档案**：Pi 的
  `reasoning: false`（boolean）裸穿 DSH 目录撞上 DSH 的
  `reasoning.efforts.length`（对象契约），web 模型菜单当场炸。
- 能力缺口分级处置，禁止无脑报错。**事故档案（0.10.0 返工）**：ctx 的
  shutdown/compact/newSession/fork/navigateTree/switchSession/reload 全部
  裸 throw 炸 turn，被斥"这可能带来的影响是未知的，你报错了就完了？插件
  还能不能用？有人知道么？"。第一轮改成 `{cancelled:true}` 拒绝，又被
  追问"用 dsh 的开放能力不能组合出来？先讨论清楚是不是真的 dsh 没开放
  能力"——逐条查证后打脸：ctx.sessions.create/fork（含血统+open-turn
  校验）、compaction.compactNow、cordis 重挂全是现成官方面，Pi 自己的
  rpc 模式（无 TUI）里这些也全是真语义。最终标准写进 CLAUDE.md 第三节：
  先查双方官方→真实现；Pi 官方拒绝/吸收通道优先于报错；只有伪造返回值
  才结构化报错+CapabilityLedger 一次性告知；真不支持的启动期撞
  （import 检测+setup 期 unusable），且每发现一个此类包必须写 README
  并告知用户。
- 兜底：绝不伪装成功；`?.` 不许吞真实失败（吞错曾让排查多绕三轮）。

### 3.5 把兼容层当作 DSH 架构检验装置

本项目的唯一映射标准是
[`architecture-mapping-standard.md`](architecture-mapping-standard.md)。架构事实与判断只用
普通 Markdown 按分支维护：

1. [`architecture-mapping-matrix.md`](architecture-mapping-matrix.md)：Pi 已知接口经能力
   契约到 DSH 承载机制与具体 seam 的可扩展 Markdown 知识树；
2. [`plugin-validation-matrix.md`](plugin-validation-matrix.md)：按真实插件分块引用架构分支，
   记录五层流转与五级结果；
3. [`dsh-architecture-conformance.md`](dsh-architecture-conformance.md)：从理论、实现和验证
   总结已成立、桥欠账、DSH 缺口、宿主差异和尚未实证。

旧 compatibility matrix 只是 Pi 叶子接口的当前运行时行为，不得直接当架构得分。111 条
Pi 规则与 45 个 DSH subsystem 只是特定版本和扫描口径下的快照，不是永恒总量，更不能
靠数字相等证明完整。抽象必须能下钻到已发现接口，接口也必须能向上归入抽象；发现新叶子
就追加，现有抽象装不下就允许拆分。

**事故档案（2026-08-19，架构总审）**：能力总表把 83 项统一写成“已映射并写明
差异”。这个运行时分类本身没有错，但拿它回答架构问题会严重失真：

- `appendEntry` 写 sidecar，和 `ctx.sessions.create` 创建原生 DSH session，都叫 mapped；
- `session_before_compact` 只能收到事后事实通知，和真正可修改权威请求的
  `system-prompt/assemble` waterfall，都叫 mapped；
- 注册后永不触发的 Pi tree 事件、桥内保存的 thinkingLevel、DSH 原生 tools seam，
  也全被塞在同一栏。

结果是数字会随着兼容层兜底越来越漂亮，DSH 真正缺的 seam 反而越来越看不见。由此
立下三条硬标准：

1. **运行时矩阵和架构判定分账**：matrix 回答插件拿到什么行为；架构账本回答 DSH
   是否原生承接。不得用前者的 mapped 数量给后者背书。
2. **第二份权威状态自动降级**：只要模型、凭证、会话、资源或 UI 事实需要 sidecar/
   bridge-local store 才活得下来，就标“旁路完成”，并写明宿主导出、回放、原生界面
   会失去什么。
3. **绕通和修好分开说**：替换整个 adapter 绕开官方 profile schema，只证明 adapter
   seam 能用；它不等于 profile schema 修好。桥能把动态资源翻成 DSH provider 而还没
   做，则是桥欠账，不得反过来说 DSH 无法支持。

**第二次总账事故（2026-08-19，覆盖口径）**：生成表宣称 112 个 Pi surface，但对固定的
Pi 0.84.1 declarations 逐项对照后，当前规则的上游形状行应是 111 个：25 个非事件 API、
33 个事件、24 个非 UI context、28 个 UI，再加单列的
`modelRegistry.hasConfiguredAuth`。多出来的 `unregisterTool` 是桥自己的兼容扩展，Pi 源码没有；
旧 `pi-abi-coverage.md` 还把 202 个 import symbol 压成“3 个 host 包”混入总数，并得出
“只缺 3 项”。这证明“每条规则都被生成进文档”仍不等于“规则全集等于上游全集”。

同时，111 不是“每个嵌套 callable 都拆开”的数：`sessionManager`、`modelRegistry` 等对象
仍有一行代表多方法合同。后续 drift check 必须深入这些对象，不能只盯总数相等。

从此完整性由一条可追踪链保证，而不是三张并列表：

```text
每条 Pi 接口 → Pi 能力契约 → 理论映射 → DSH 承载机制 → 具体公开 seam
                                      ↓
                              真实插件五层验证与五级结论
```

这次也明确否决“JSON 架构总账 + 生成器 + 固定数量校验”的做法：它会把尚未穷举的调查
对象伪装成封闭 schema，新增接口时被迫先迁移程序，最后架构判断反而服务于生成器。
自动化只允许生成 `src/compatibility.ts` 可直接推导的运行时能力页；能力契约、理论映射、
插件等级和 DSH 归因必须由证据驱动、人工维护。Cordis 卸载、重绑、隔离和失败回滚属于
相关映射的生命周期维度，不另起一张与映射脱节的成绩单。

当前四个 active `DSH-ARCH-*` 和一个上游已修复的历史编号只是证据闭环的发现，不是穷举完成。像 `input`、message replacement、
原生工具 update、宿主发起的 session tree 生命周期等，未完成数据流倒推前记“待判级”；
找到公开 seam 就归桥，证明权威时机不开放才新增上游编号。

以后每补一项能力，同一变更必须更新对应 Markdown 架构分支：给叶子接口归能力契约，
补或复用理论映射，记录真实消费者、五层流转、五级判定、单一权威位置、契约/E2E 证据
与问题归属。若归属 DSH，建稳定 `DSH-ARCH-*` 编号，给最小复现和上游链接；修复后保留
记录并改状态，不删除历史证据。

### 3.6 子代理血统路由：一条血统判据，每 Agent 至多一次扩展挂载

**每个子 Agent 的 Pi 扩展挂载由创建血统唯一决定，判据在 `agent/created`
一处一次判定：**

- **Pi 血统（桥创建）**：`@tintinweb/pi-subagents` 一类 Pi 子代理包经
  subagent bridge 创建的孩子，会话 id 带 `pi2dsh-sub-` 前缀（桥铸造，
  持久化 resume 后不变）。这类孩子**永远**走创建方包自己的 per-spawn
  loader 挂载（上游 a8b7a0a 路径）——引擎不碰它们。
- **DSH 原生血统**：DSH 自己的 subagent 委派创建的孩子（会话 meta 带
  `origin: subagent`、无桥前缀）。引擎侧 opt-in 开关
  `serveNativeSubagents`（默认关）：开时这类孩子拿全量发现集（无 loader
  路径 = Pi 的默认发现语义），挂在孩子**自己的** agent scope 上，随孩子
  卸载；关时就是普通 DSH agent，与引入前行为完全一致。

**判据**：同一孩子身上出现第二次扩展挂载 = 违约。契约测试
（`tests/native-subagents.spec.ts`）用"每次挂载自增命名"的探针包把双挂
变成可见的第二个工具名——工具撞名会被注册表按名归并，双挂在计数上看不
见，只有 per-mount 唯一命名才露馅。三条断言：默认关零变化；旗开后原生
孩子恰好每包一个实例、名字与根不重名、execute 走孩子自己的挂载、dispose
随孩子卸载；桥前缀孩子只被桥挂一次，后续 tick 不出现第二组。

**由来（2026-08-25 上游返工四要点）**：初版 PR 对所有 subagent 血统无差
别挂全量发现集——桥孩子本来就有创建方 loader 挂载，两条路径叠加即每包
双挂（撞名被注册表归并，计数看不见）。上游拍板：按血统路由、判据收在
`agent/created` 一处、桥前缀覆盖创建与 resume 两条路、开关只管 DSH 原生
血统且默认关零变化。教训与 3.3 同源："每 Agent 一份"的纪律同样适用于
扩展挂载——先问"这个孩子的扩展谁负责"，答案是唯一的，才许挂。

---

## 四、完成判据

- 每项能力有**公共 API 契约测试**（tests/）；"某插件能加载"从不是成功
  标准。
- 真 DSH loop **双端**亲眼跑通：CLI（headless）+ Web（浏览器真点）。
  能挂载≠完成、单测绿≠完成、mock 不算。**事故档案**：Web 一点就炸而
  headless 测不出（reasoning 裸穿炸模型菜单）。
- 教程里每条配置语法对着 DSH 源码或真机核实。**事故档案**：patch yml
  臆写了不存在的 `- update:` 操作，真实语法是 id-targeted 覆盖
  （vendor include 的 PatchOptions）。
- `pnpm verify` 全绿才许提交；npm 发版后裸环终验（干净 DSH_HOME 走
  完整用户流程，exit code 与关键日志逐项断言）。**事故档案**：裸环
  第一轮就抓出 add 失败但 turn 假阳性通过的组合——判据必须是"引擎真
  进了 bundles + 关键日志出现"，不是"命令有输出"。

## 五、Examples 义务

每支持并验证一个能力，同步在 `examples/` 放完整可跑 example：README
从零到看到效果、配置模板、测试资产（纯色探针图，文件名不泄露答案）、
常见报错应对。每条命令必须实际跑过；对外内容不得出现内部端点/凭证
（用 OpenRouter 等公开服务占位）。双语 README 的 Examples 章节同步。

## 六、工作流程红线

- 全中文；每轮汇报开头 (a) 要求对账 (b) 本轮证据。
- 大事先汇报再动手；设计偏离单独拎出来等拍板。
- **发现问题先全面盘点、一次对齐、一次改完**；标准落地立刻写进
  CLAUDE.md，不排队。**事故档案**：挤牙膏式"用户说一个改一个"与
  "把标准写入排在动作清单第 5 步"都被骂过。
- **同一事实只写一处**：清单和数字类事实指定唯一权威位置，其它文件
  只指路、不抄写；不为此新增自动生成（标准用非结构化 Markdown 是有意
  选择，表达力优先，防漂靠"不抄写"不靠生成器）。**事故档案
  （2026-08-20 审计）**：CLAUDE.md 手抄 examples 清单漏了
  codex-image-gen、subscription-login 两个，待补清单里还躺着已整体
  删除的 host 模式；pi-abi-coverage.md 手写的运行时标签数字在
  `before_provider_request` 升级（ee73dc3）后全部过期，而自动生成的
  capabilities 页同一时刻是对的——漂的全是手抄份。
- 凭证只经环境变量注入，永不落盘/入提交/回显。
- git 操作前确认 cwd。**事故档案**：一次 commit 跑进了旁边的
  deepseek-harness 仓库——version 被误改、暂存区被污染，靠它的
  pre-commit lint 拦下才没提交成型，事后逐项还原。
