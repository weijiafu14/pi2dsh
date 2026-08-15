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
  convert/host bundle 只是特例（未发布/本地/供应链冻结场景）。
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
- **Pi 扩展工厂没有参数位**（`ExtensionFactory = (pi) => void`，
  ../pi types.ts 实锤）：Pi 官方不存在"装插件给插件传参数"的通道，插件
  配置一律由插件自己定义来源（环境变量是事实标准，如 VISION_BRIDGE_*）。
  applyPiPackage 的 options.config 只喂中间层自己（visionCompanions），
  永远进不了插件视野。**此事到此为止：不需要适配、不需要预留形状、
  不需要再拿出来讨论**。中间层自己的配置一律按第二节的用户面标准走
  （引擎的 cordis 插件 config）。

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
- 映射不了的能力 fails loud，绝不伪装成功；`?.` 不许吞真实失败。

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

## 五、Examples 义务（铁律）

**每支持并验证一个能力，必须同步在 `examples/` 放一个完整可直接运行的
example**——用户克隆仓库照 example 就能用：README 步骤从零到看到效果、
所需配置模板、测试资产（如纯色探针图）、常见报错应对（如
ERR_PNPM_IGNORED_BUILDS）。example 里每条命令必须实际跑过；对外内容
不得出现内部端点/凭证（示例用 OpenRouter 等公开服务占位）。README
（双语）的 Examples 章节同步更新。

已有：examples/vision-bridge（视觉委托）、examples/custom-gateways
（DSH settings 网关配置）。存量已验证能力（guardian 审批、跨会话记忆、
OAuth /login、MCP 配置转换、host 模式）的 example 待补——补前必须按
上述判据重新端到端验证，禁止凭记忆写。

## 六、工作流程红线

- 全中文沟通；每轮汇报开头列 (a) 要求对账 (b) 本轮证据。
- 大事先汇报再动手；设计偏离单独拎出来等拍板；说人话不用黑话。
- **发现问题先全面盘点、一次对齐、一次改完**——禁止用户说一个改一个的
  挤牙膏模式；标准落地立刻写进本文件，不排队。
- **上游没有的能力 ≠ 我们的差距**：查实 Pi/DSH 官方压根没这条通道，
  正确汇报是"此事不存在，不需要做"，然后闭嘴——**禁止包装成"差距/待
  拍板项/可选方案"送到用户面前**（事故：Pi ExtensionFactory 没有参数
  位，我却把"per-Pi-包传参"报成差距并附方案，逼用户审一个不存在的
  需求）。造伪工作项等于浪费用户的判断力。
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
- BSD grep 对打包后的超长单行 .mjs 会静默失败——判 dist 内容用
  `node -e '...readFileSync(...).includes(...)'`，别信 grep 空结果。
- CLI 入口（cli.ts）与 index.ts 同款纪律：analyzer/generator（拖
  typescript optional peer）只许命令分支内动态 import——matrix/
  mcp-config/host 必须在无 typescript 安装下可跑（verify 的打包冒烟
  测这个）。
