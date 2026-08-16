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
- `@deepseek-ai/dsh-mcp-client`：MCP（我们的 mcp-config 就是范例：只做
  配置翻译，零运行时）
- `@deepseek-ai/dsh-skill-filesystem`：skills 挂载
- settings / credentials seam：用户配置与凭证引用

**事故档案（0.6.x–0.7.x）**：给 models.json 路由自建传输，两版皆废——
第一版背 pi-ai 全家桶（引爆 1.4 安装事故），第二版自写 openai-completions
wire client（500 行 + 契约测试，发版 0.7.0）。而官方 llm-pi-ai 从头就在
默认组合里，"an OpenAI-compatible gateway … is configuration rather
than a code change" 是它 README 的原话。两版全部删除。教训写成三个字：
**先查官方**。

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
- 只声明目录、不带自有 stream 的包注册 provider：fails loud，指引配
  宿主 llm settings（不给桥合成传输）。

**事故档案**：跨层调用曾出现三处——getProvider 携带 wire 传输绕过
DSH llm、registry.complete 缺失、DSH 原生路由 getProvider 返回
undefined——被"别让我看见跨层的东西，跨层就会导致不一致性"钉死后统一
收敛到 dshRoutedStream 单一路径。

### 3.4 实现纪律

- 零 patch、零 hacky、零私有 API；核心转换器禁止
  `if (packageName === ...)` 逐包特判——修公共 ABI 缺口，同类包一起
  解锁（一次 jiti 子路径 alias 修复同时解锁 4 个包）。
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
- 凭证只经环境变量注入，永不落盘/入提交/回显。
- git 操作前确认 cwd。**事故档案**：一次 commit 跑进了旁边的
  deepseek-harness 仓库——version 被误改、暂存区被污染，靠它的
  pre-commit lint 拦下才没提交成型，事后逐项还原。
