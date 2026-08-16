# CLAUDE.md — pi2dsh 工作准则

pi2dsh：通用 Pi Host ABI 兼容层，让 Pi 生态插件原样跑在 DeepSeek Harness
(DSH) 上。本文件是本仓库一切工作的标准，**任何新 session 开工前先读完**。
违反任何一条 = 返工。每条标准背后的真实事故记录在
[docs/STANDARDS.md](docs/STANDARDS.md)——改标准前先读事故。

**总纲一句话：对用户，一切是 DSH；对插件，一切是 Pi；中间层是唯一的
翻译官，且能借 DSH 官方的力就绝不自己造。**

## 一、用户安装使用标准

用户只用 DSH 官方命令，装一次引擎，之后装谁用谁，全程没有我们发明的步骤。

- 姿势：`dsh plugin add pi2dsh` 装一次引擎；之后 `dsh plugin add
  <Pi插件原包>` 直装 npm 原包。零转换、零生成产物；装了才挂、卸了就没。
  **代码里没有第二条路**：convert/host 命令、generateBundle/generateHostBundle
  导出、src/generator.ts 已整体删除（2026-08-16）。留着它们的真实代价不是
  "多一个特例"，而是**验证会架在错的路上** —— 主集成测试和真机端到端都曾
  在装转换产物，跑得再绿也证明不了用户那条路。开发和测试必须同一条路。
- **一份引擎实例挂所有插件**：一个模型目录、一个 /login、一个凭证存储、
  一个升级单元。禁止多份桥拷贝各自为政（事故：/login-2 自撞）。host 级
  资源（provider 目录/catalog/伴生映射/登录/凭证存储）经 SharedHostState
  跨包单份共享；包级资源（tools/commands/events）各归各。
- 升级解耦：升引擎不动插件、升插件不动引擎；lockfile 锁死，只有显式
  `add <pkg>@latest` 才动；`pi2dsh inspect <pkg>@<版本>` 是升级预检门。
- 发现机制 = 读 profile 依赖清单（每项都是用户显式 add 的）+ Pi 官方
  `pi` 字段/目录约定判定包身份；**绝不扫 node_modules**（Prettier 3 弃用
  目录扫描的公开教训）。config `packages`/`exclude` 显式收窄兜底。
- **引擎自身依赖必须干净**：不带任何安装脚本（pnpm 对传递依赖的安装脚本
  报错性拦截，用户第一条命令就会炸——事故：pi-ai→genai→protobufjs）、
  不拖 CLI-only 大件（事故：typescript 23MB 白下载；现为 optional peer +
  懒加载分包，改依赖后必须验证引擎 chunk 的加载路径）。
- 撞上宿主安全门（pnpm 构建脚本审批）**不绕**：那是用户拍板的权利。文档
  写清应对即可（allowBuilds 设 true / approve-builds）。
- 加/卸插件后要重启 dsh（挂载在启动时）；先卸插件再卸引擎；伴生路由等
  引擎配置是 per-profile 的，每个用到的 profile 配一份。

## 二、Pi 插件处理标准（用户面界线，铁律）

**插件说 Pi 话，用户说 DSH 话，中间层负责翻译——用户面前永远没有 Pi。**

- 用户接触面——要动手写的配置、要看的文档教程、要敲的命令、报错里的
  指引——**一律 DSH 形状、DSH 官方机制**：配模型 = DSH settings 的
  `llm-pi-ai:` 段；配伴生路由 = 引擎的 cordis 插件 config
  （cordis.patch.yml）；凭证 = DSH credentials 引用（apiKeyEnv）。
- Pi 形状只允许活在两处：**插件视野**（shim/投影/事件）与**中间层内部
  实现**（vendored 源码、内部存储如 auth.json）。
- 判据：**用户需要亲手读写的东西里出现 Pi 词汇/格式 = 泄漏 = 返工**
  （事故：models.json 作为"Pi 标准配置入口"被搬进 DSH 用户世界，教 DSH
  用户写 Pi 格式文件，最终全链删除）。
- 我们兼容的对象是**插件代码**，不是把 Pi 生态的用户习惯搬给 DSH 用户。
  "Pi 教程照搬可用"不是目标，是泄漏。
- **插件自身配置的标准**（用户怎么配好一个 Pi 插件）分三层：
  1. **环境变量**（主路径）：Pi 插件生态的主流配置面是 env
     （VISION_BRIDGE_*/PI_VISION_*），env 是宿主中立的——DSH 用户设
     env 是纯 DSH 动作，零泄漏。examples 教这条。
  2. **插件自带斜杠命令**：插件用命令管理自己的配置（/vision），命令经
     中间层进 DSH 命令面板——用户敲的是 DSH 面板里的命令。
  3. **插件内部落盘**：插件以为在写 Pi config 目录，实际被重定向到
     `$DSH_HOME/pi2dsh/` 内部目录——文件在，但**不是用户接触面**，任何
     文档都不教用户碰它（auth.json 同理）。
  判据：用户给插件配置的动作只有"设 env、敲插件命令"两种；**任何"教用户
  手工编辑 Pi 格式文件"的路径都不存在**。若未来出现只认手工配置文件的
  插件（top50 无此形态），标准处置=引擎 config 加 per-package 的 DSH
  形状配置槽由中间层翻译落盘——出现第一个消费者时按此补，不预制。
- **Pi 扩展工厂没有参数位**（`ExtensionFactory = (pi) => void`，
  ../pi types.ts 实锤）：Pi 官方不存在"装插件给插件传参数"的通道，插件
  配置一律由插件自己定义来源（环境变量是事实标准，如 VISION_BRIDGE_*）。
  applyPiPackage 的 options.config 只喂中间层自己（visionCompanions），
  永远进不了插件视野。**别为这个不存在的通道发明 per-package 透传**；
  若上游 Pi 某天给工厂加了 config 参数，再按 DSH 惯例（管理者插件
  config 按名嵌套，llm-pi-ai providers 同款）一步接上。

## 三、中间层开发标准

**三层零跨层。跨层 = 不一致性 = 返工。**

```text
第 1 层  Pi 插件（原样源码，零修改）
         它需要的一切只来自中间层：三包 import 被 jiti alias 截获到 compat
         shim；registerX/事件/ctx 面全是中间层投影；插件视野里 100% Pi
         词汇，永远不出现 DSH 概念（连字符串都不行，宿主托管路由的 api
         用 Pi 官方词 'faux'）。
第 2 层  pi2dsh 中间层
         compat 三 shim / ExtensionAPI 收单 / Pi 元数据账本 / registry
         投影 / 事件桥 / 凭证 / 会话与子代理桥 / 伴生路由。以"普通
         cordis 插件"身份接 DSH。
第 3 层  DSH（不知道 Pi 存在）
         看到的只是普通插件与普通 llm adapter。
```

- **DSH 已有官方能力，一律"配置翻译 + 官方实现"，禁止自建平行运行时/
  传输/第二套配置入口——动手前先查 DSH 官方有什么**（事故：官方
  llm-pi-ai 就在默认组合里、任意 OpenAI 兼容网关本是纯配置，却先背
  pi-ai 全家桶再自写 wire client，两版全是重复建设，全部删除）。已知的
  官方件：llm-pi-ai（模型网关）、dsh-mcp-client（MCP）、
  dsh-skill-filesystem（skills）、settings/credentials seam。
- 单一目录、单一调用路径：运行时模型目录只有 DSH llm 目录，Pi registry
  是其精确投影（包注册路由出口 restore 完整 Pi 形状——账本是中间层
  本职）；插件一切标准模型调用（registry.complete、getProvider().stream、
  pi-ai 顶层 complete/stream、createAgentSession）必经中间层转给 DSH llm
  路由；插件面永远拿不到直连传输；wire 层只属于路由供应商内部。
- 包注册 provider 的投影存在性由路由归属裁决：路由名没拿到（冲突/无
  llm）＝不在投影里，绝不让别人路由的模型穿这份注册的 baseUrl。只声明
  目录不带传输的包注册 provider fails loud，指引配宿主 llm settings。
- 零 patch、零 hacky、零私有 API：一切经中间层转换 Pi 的**公开**透出。
  核心转换器禁止 `if (packageName === ...)` 逐包特判——修一个公共 ABI
  缺口，同类包一起解锁。
- 语义对齐以真 Pi 源码为准（本仓库旁的 ../pi 是源码参照），vendored
  文件字节级/节选搬运并注明来源 commit，logic unchanged；同名不同义的
  行为（如 registerCommand 撞名编号 /name-2 vs Pi 的 :1/:2、伴生路由的
  ctx.model 报原身）必须写进 src/compatibility.ts 判定文案。
- 插件自身的 bug（在真 Pi 同版本上同样坏）不 patch，如实归因即为界。
- 跨目录通道透传字段用白名单，禁止裸展开：DSH 对 reasoning/context 等
  名字有自己的语义（事故：Pi 的 reasoning:false 撞 DSH 的
  reasoning.efforts.length）。
- **判"DSH 做不到"之前必须倒推，不许正推就收工**（事故：同一个问题三次给出
  三种结论，被斥"一会一个变"）。正推＝从我们现在用的那个 API 出发，撞到第一个
  死胡同就宣布不可能；倒推＝**从用户可见的结果出发，问这个结果的数据是从哪来
  的**，一路查到源头——数据总得从某处来，所以倒推挡不住。三次实证：
  ① `before_agent_start` 覆写晚一步，正推看 `agent/pre-step`（我们在用的）→
  "结构性不可能"；倒推问"提示词是谁装配的"→ `system-prompt/assemble` 是
  **async waterfall、装配时跑、返回值权威**，当轮就能改。
  ② `setActiveTools` 关不掉工具，正推看 `tools.restrict()`（名字最像的）→
  "DSH 的 scope 模型不给"；倒推问"模型看到的工具列表从哪来"→ `assembly.tools`，
  同一个 waterfall 里直接改。
  ③ `hasUI` 没有探针是真的，但 `registerProvider` 的 `DUPLICATE_PROVIDER`
  是文档化行为，探一次即可拿到真值。
  判据：**说"不能"之前，必须能说出"这个结果的数据流我追到了哪一步、断在哪个
  具体符号上"**；说不出来就是没查完。而且结论只认实跑，读类型不算数——上面三条
  都是在真 DSH 服务上跑出来才写进这里的。
- **能力缺口分级处置（禁止无脑报错）**。判定顺序（事故：ctx 七件全部
  裸 throw 炸 turn，被斥"影响未知、没人知道插件还能不能用"；返工后逐条
  查证，发现大半根本不该报错）：
  1. **先查双方官方**：DSH 开放能力能组合出来的一律真实现（事故：
     newSession/fork/navigateTree/switchSession 全有官方面
     `ctx.sessions.create/fork`，compact 有官方 `compaction.compactNow`，
     reload 可官方 remount，我却全标了"报错"）；Pi 侧纯逻辑可 vendored
     的真实现（findCutPoint/loadSkills/ProjectTrustStore/
     generateSummary——Pi 官方 streamFn 注入口接 DSH llm 桥）。
  2. **Pi 协议自带的拒绝/吸收通道优先于报错**：返回
     `{cancelled:true}`、host-defined 行为（shutdown）、onError 回调
     （compact）都是 Pi 官方语义，不是伪装。
  3. **只有伪造返回值=撒谎的才报错**，且必须是结构化
     PiCapabilityError（插件 catch 得住）＋记入 CapabilityLedger＋
     用户面一次性提示（同包同能力只报一次；文案讲清"哪个功能不工作、
     其余照常、若这是主要用途建议 dsh plugin remove X"——核心与否
     由用户判，中间层不猜）。
  4. **启动期撞**：真不支持的能力尽量在挂载期暴露——插件源码 import
     宿主基建符号（ModelRuntime/DefaultPackageManager）在挂载时即检测
     告知；入口 setup 期撞缺口=整包标记 unusable+建议卸载。**每发现
     一个真因启动期撞而不可用的包：写进 README 的不支持清单，并且
     必须告诉用户**（用户明令）。
- 兜底纪律不变：绝不伪装成功；`?.` 不许吞真实失败。

## 四、完成判据（铁律）

- 每项能力必须有**公共 API 契约测试**（tests/，不以某个插件能加载为
  成功）。
- 场景必须在**真 DSH loop 上端到端跑通、亲眼看到运行**——CLI
  （headless）与 **Web**（dsh web，浏览器真点）双端。能挂载≠完成，单测
  绿≠完成，mock 不算。Web 一点就炸而 headless 测不出的事故发生过。
- 教程/示例里写的每条配置语法必须对着 DSH 源码或真机核实（事故：patch
  yml 臆写 `- update:`，真实语法是 id-targeted 覆盖）。
- `pnpm verify` 全绿（tsc + 全部测试 + publint）后才许提交；发 npm 后
  必须裸环终验（干净 DSH_HOME 走完整用户流程）。

## 四点五、对外文档标准（README 是门面，铁律）

**README 只讲一种安装方式：`dsh plugin add pi2dsh` + `dsh plugin add <Pi包>`。**

- 事故：README 把 engine / host bundle / convert / mcp-config **并列成"四种
  交付模式"**摆在架构区，用户读完不知道自己该用哪个——被斥"host 你妈啊，我们
  就一种模式，你想给我们用户误导成什么样"。后续（2026-08-16）用户追问
  "什么是转换？我们不是不用转换模式了么"——**convert/host 已从代码里彻底删除**，
  不再是"内部特例"；inspect/matrix/mcp-config 只能作为"其它工具"一两行带过。
- **验证必须走用户那条路（铁律）**：写端到端/集成测试前先问"用户是怎么装的"。
  测一条我们不发的路径 = 白测。判据：脚本里出现任何"先生成再安装"的步骤，
  就是错的。
- **端到端不许用 mock（铁律）**：真 CLI、真 npm 包、真模型、真端点。假端点
  回一句固定话就"通过"，证明的是假端点会说话，不是我们的代码对。
  - 事故：gateway-compat / custom-gateways 的回归用了 `fake-endpoint.mjs`
    假网关，被斥"再让我发现你端到端测试用 mock 我就骂死你"。而且假端点
    发不出工具调用，直接把 custom-gateways 的断言逼成了永远失败。
  - **要看真实请求体又不能造假**：用**透传录制代理** —— 请求真发给上游、
    响应真streamed回来，中间只多写一份 body 到磁盘。没有任何东西被伪造，
    而且这东西对用户也有用（拿去对着自己的网关看我们到底发了什么）。
  - 判据：脚本里任何"自己造一个响应"的地方都是 mock。转发别人的响应不是。
- README 结构固定（用户拍板）：① 这是什么、为什么有它（DSH 理念好但生态早期→
  用 Pi 成熟插件补位→乐见更原生的插件替换我们）② 安装使用，**以 vision 为例
  并把"怎么配多模态模型"写到用户不会懵**（这是最容易懵的一步，必须单独讲清
  插件的视觉模型 ≠ 聊天模型）③ 已实测插件表（读者要一眼看到"能装哪些"）
  ④ 技术架构（三层 + 标准职责，大体即可）⑤ Pi 开放能力 → DSH 落点总表，每项
  超链接到 `docs/capabilities/` 分门别类的细表。
- **对外文档只写现状，不写演变史**：不许出现"过去翻译错了又改回来"这类内部
  返工过程（用户明令）。判断依据是读者要不要知道，不是我想不想解释。
- **能力清单必须按验证等级分级，禁止把"黑盒探针跑过"说成"能用"**（事故：
  README 把 top50 的 47/50 写成"verified working / 实测可用"，被用户当场
  拆穿——"你随便 check 两个比如 btw 比如 visontool，你就有这么多翻译工作
  需要补"）。铁证：**pi-btw 黑盒 grade=working 挂了好几周，而真敲
  `/btw <问题>` 直接炸**，直到补了 AgentState.messages + 命令 input
  描述符两个缺口才通。所以对外只有两级：
  ① **端到端实测过（配 example）**——有人在真 DSH loop 上用真功能亲眼看到
  它工作，这一级放**最前面**，是"能用"清单；
  ② **能挂载 + 探针能调起来**——只代表"桥覆盖了这个插件用到的面"，属于
  **待实测**，必须显式写明它不能说明什么。
  探针拿合成参数调注册面 ≠ 用户跑一整条工作流；下载量排名不是能力证据。
- `docs/capabilities/*.md` 由 `scripts/generate-capability-docs.mjs` **从
  src/compatibility.ts 的规则生成**，prose 写在脚本里，md 里绝不手改；
  `pnpm verify` 带 `check:docs` 拦截漂移。新增 Pi 面必须归入某个能力域，
  否则生成脚本 fails loud。

## 五、Examples 义务（铁律）

**每支持并验证一个能力，必须同步在 `examples/` 放一个完整可直接运行的
example**——用户克隆仓库照 example 就能用：README 步骤从零到看到效果、
所需配置模板、测试资产（如纯色探针图）、常见报错应对（如
ERR_PNPM_IGNORED_BUILDS）。example 里每条命令必须实际跑过；对外内容
不得出现内部端点/凭证（示例用 OpenRouter 等公开服务占位）。README
（双语）的 Examples 章节同步更新。

已有：examples/vision-bridge（视觉委托）、examples/custom-gateways
（DSH settings 网关配置）、examples/gateway-compat（provider compat 三坑）、
examples/side-conversation（/btw 侧边会话）。存量已验证能力（guardian 审批、
跨会话记忆、OAuth /login、MCP 配置转换、host 模式）的 example 待补——补前
必须按上述判据重新端到端验证，禁止凭记忆写。

### 五点一、examples 必须能自动回归（新增铁律）

**改了行为面就必须跑 `pnpm test:examples`**（`scripts/verify-examples-e2e.mjs`）。
每个 example 都在对读者作承诺，承诺就得能被机器复核 —— 只有契约测试绿不算数，
那批测试用的是我们自己的 fixture，不是 example 里写给用户的那条路。

回归怎么算数：
- 用**全新的临时 DSH_HOME**，不许复用本机已配好的实例 —— 否则测的是"我的机器"
  而不是用户的干净安装；
- 装的是 README 里**原话让用户装的东西**（真 npm 包、真 `dsh plugin add`）；
- 断言 example **自己宣称的那个性质**（gateway-compat 断三个 compat 字段真上线、
  side-conversation 断侧边答案不进主会话、custom-gateways 断宿主配的路由能被
  Pi 包的 modelRegistry 看见）；
- 跑不了的要**报 skipped 并写原因**，绝不能算 passed。

已由这条抓出的真问题：转换出的 bundle 少声明 5 个依赖（干净 profile 全部起不来）、
side-conversation 的 README 没写全新安装要先选工作区（输入框静默吞字符，页面上
没有任何提示）、**宿主配的 contextWindow 到不了插件**（DSH 把"目录成员"和"每条
路由的容量"拆成 listModels / resolveModelInfo 两个 seam，我们只投影了前者；Pi 的
Model 是一个对象且 getAll 同步，插件读 `model.contextWindow` 拿到 undefined 就按
内置默认猜——Pi 自家 compaction 就是 `model.contextWindow || 128000`，对 1M 窗口的
模型会早压缩一个数量级。catalog 里那个 resolve() 早写好了，但生产链路一次没接，
只有测试在调）。三条都是单测和本机开发看不见的。

## 六、工作流程红线

- 全中文沟通；每轮汇报开头列 (a) 要求对账 (b) 本轮证据。
- 大事先汇报再动手；设计偏离单独拎出来等拍板；说人话不用黑话。
- **发现问题先全面盘点、一次对齐、一次改完**——禁止用户说一个改一个的
  挤牙膏模式；标准落地立刻写进本文件，不排队。
- 画架构图直接 ASCII，不用工具。
- 凭证只经环境变量注入，永不落盘/入提交/回显。
- git 操作前确认 cwd 在 pi2dsh（事故：commit 跑进 deepseek-harness 仓库
  污染其暂存区和 version）。

## 七、E2E 装置备忘

- DSH CLI 必须在 deepseek-harness 目录跑（`node --import tsx/esm
  apps/cli/src/bin.ts`）；发现"跑很久"先查结果文件而不是傻等。
- 引擎形态是默认用户姿势；E2E 改 src 后：pnpm build，且 profile 里
  file: 装的 pi2dsh 是拷贝（pnpm file: 有缓存，update 不重拷）——必须
  手动 `rm -rf <profile>/node_modules/pi2dsh/dist && cp -R dist ...`。
- `dsh plugin` 内部调 PATH 上的 pnpm；profile 由 pnpm@11 初始化，本机
  pnpm 版本不一致会假失败（用 pnpm@11 shim）。
- 用户配置入口：模型网关写 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai:`
  段。**贴图伴生路由默认全自动**（0.9.0 起）：目录里每个纯文本路由自动
  得到 `<路由>-vision` 分身，订阅 llm/adapters-updated 热跟随（新路由补
  注册、原路由消失 dispose），sweep 防重入合并（自己注册也触发该事件）；
  `visionCompanions: false` 全关、显式 map 收窄是仅有的两个配置入口——
  "让用户手动配置每个伴生"是被否掉的旧姿势，别退回去。自动化后默认模型
  选择（DSH_HOME 级）指向伴生在所有 profile 都可解析，旧 NO_ADAPTER 坑
  消失。
- **改了 package.json 依赖后刷 profile 光拷 dist 不够**：新依赖要在
  profile 里 `npx -y pnpm@11.7.0 install --force`（file: 缓存不重解析
  依赖集；0.10.0 的 proper-lockfile 缺失就是真机才炸出来的）。
- web 真机：`node --import tsx/esm apps/cli/src/bin.ts --profile web
  --port 5178`（`web` 子命令别与 `--profile` 混用）；斜杠命令=输入框
  行首敲 `/名字` 出建议浮层点选（浏览器 key 事件不可靠，输入框用
  form_input 设值最稳）。会话四件的常驻探针包在两个 profile 的
  `pi-session-probe`（file: 依赖），命令 `/cap-sessions`。
- BSD grep 对打包后的超长单行 .mjs 会静默失败——判 dist 内容用
  `node -e '...readFileSync(...).includes(...)'`，别信 grep 空结果。
- CLI 入口（cli.ts）与 index.ts 同款纪律：analyzer/generator（拖
  typescript optional peer）只许命令分支内动态 import——matrix/
  mcp-config/host 必须在无 typescript 安装下可跑（verify 的打包冒烟
  测这个）。
