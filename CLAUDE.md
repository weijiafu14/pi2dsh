# CLAUDE.md — pi2dsh 工作准则

pi2dsh：通用 Pi Host ABI 兼容层，让 Pi 生态插件原样跑在 DeepSeek Harness (DSH) 上。
本文件是本仓库一切工作的标准。违反任何一条 = 返工。

## 架构标准（铁律）

**三层，零跨层。跨层 = 不一致性 = 返工。**

```text
第 1 层  Pi 插件（原样源码，零修改）
         它需要的一切只来自中间层：三包 import 被 jiti alias 截获到 compat
         shim；registerX/事件/ctx 面全是中间层投影；插件视野里 100% Pi 词汇，
         永远不出现 DSH 概念（连字符串都不行，宿主托管路由的 api 用 Pi 官方
         词 'faux'）。
第 2 层  pi2dsh 中间层
         compat 三 shim / ExtensionAPI 收单 / Pi 元数据账本（DSH 目录字段不
         够由中间层管理，这是本职不是妥协）/ 路由装配线 / registry 投影 /
         事件桥 / 凭证 / 会话与子代理桥。以"普通 cordis 插件"身份接 DSH。
第 3 层  DSH（不知道 Pi 存在）
         看到的只是普通插件与普通 llm adapter。
```

**单一目录、单一调用路径。**
- 配置入口可以多个（models.json、DSH 原生配置），运行时模型目录只有一个：
  DSH llm 目录。models.json 装载即注册成普通 DSH 路由；Pi registry 是该目录
  的精确投影（出口 restore 注册源的完整 Pi 形状——账本是中间层的本职）。
- 配置的存在性由路由归属裁决：路由名没拿到（冲突/无 llm）＝这份配置在投影里
  不存在，绝不让别人路由的模型穿我们配置的 baseUrl。
- 插件的一切标准模型调用（registry.complete、getProvider().stream、pi-ai 顶层
  complete/stream、createAgentSession）必经中间层转给 DSH llm 路由。wire
  client 只活在 route adapter 内部，插件面永远拿不到直连传输。
- 跨目录通道透传字段用白名单，禁止裸展开：DSH 对 reasoning/context 等名字有
  自己的语义，Pi 形状的值裸穿会炸目录契约（真实事故：Pi 的 reasoning:false
  撞 DSH 的 reasoning.efforts.length）。

**实现纪律。**
- 零 patch、零 hacky、零私有 API：一切经中间层转换 Pi 的**公开**透出。
- 核心转换器禁止 `if (packageName === ...)` 逐包特判。
- 语义对齐以真 Pi 源码为准（本仓库旁的 ../pi 是源码参照），vendored 文件
  字节级/节选搬运并注明来源 commit，logic unchanged；同名不同义的行为
  （如 registerCommand 的撞名编号 /name-2 vs Pi 的 :1/:2）必须写进
  src/compatibility.ts 的判定文案。
- 插件自身的 bug（在真 Pi 同版本上同样坏）不 patch，如实归因即为界。
- DSH 已有原生能力（MCP 等）走配置转换 + 官方实现，不塞第二套运行时。

## 完成判据（铁律）

- 每项能力必须有**公共 API 契约测试**（tests/，不以某个插件能加载为成功）。
- 场景必须在**真 DSH loop 上端到端跑通、亲眼看到运行**——CLI（headless）与
  **Web**（dsh web，浏览器真点）双端。能挂载≠完成，单测绿≠完成，mock 不算。
  Web 一点就炸而 headless 测不出的事故发生过，双端都过才算。
- `pnpm verify` 全绿（tsc + 全部测试 + publint）后才许提交。

## Examples 义务（铁律）

**每支持并验证一个能力，必须同步在 `examples/` 放一个完整可直接运行的
example**——用户克隆仓库照 example 就能用：README 步骤从零到看到效果、所需
配置模板、测试资产（如纯色探针图）、常见报错应对（如 pnpm
ERR_PNPM_IGNORED_BUILDS）。example 里的每条命令必须实际跑过；对外内容不得
出现内部端点/凭证（示例用 OpenRouter 等公开服务占位）。README（双语）的
Examples 章节同步更新。

已有：examples/vision-bridge（视觉委托）、examples/custom-models
（models.json 单一目录）。存量已验证能力（guardian 审批、跨会话记忆、OAuth
/login、MCP 配置转换、host 模式）的 example 待补——补前必须按上述判据重新
端到端验证，禁止凭记忆写。

## 工作流程红线

- 全中文沟通；每轮汇报开头列 (a) 要求对账 (b) 本轮证据。
- 大事先汇报再动手；设计偏离单独拎出来等拍板；说人话不用黑话。
- 画架构图直接 ASCII，不用工具。
- 凭证只经环境变量注入，永不落盘/入提交/回显。
- E2E 装置：DSH CLI 必须在 deepseek-harness 目录跑；bundle 里的 pi2dsh 是
  file: 拷贝，改 src 后要重新 build 并同步 dist 进 profile；发现"跑很久"先
  查结果文件而不是傻等。
