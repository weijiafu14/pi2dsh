# Issue #10：DSH 0.2.2 / Pi 1.4 本地候选验收

**当前状态另见 [next.1 发布验收](../release-0.28.0-next.1/README.md)。**
初始 next.0 已发布并推送；npm 回归发现全新 alpha.2 宿主内部依赖漂移，
详见 [next.0 发布后记录](../release-0.28.0-next.0/README.md)。以下保留最初本地验收，
不是当前 npm 包全量通过声明。

目标：stock npm `@deepseek-ai/dsh@0.2.2-alpha.2`，Pi `1.4.0`。
预览线：引擎 `pi2dsh@0.28.0-next.0`、Web 套件 `dsh-work-x@0.7.0-next.0`，
使用 `next` 通道；`latest` 保留旧宿主兼容线。发布和发布后验收状态以本目录记录为准。
旧 npm 0.27.1 不具备新宿主兼容声明。

## 2026-11-03 已取得的证据

- 最终 `pnpm verify` exit 0：43 文件 / 405 tests；类型检查、同代依赖图、生成文档、
  publint 和打包后安装均通过。版本、产物散列见 `verification.json`。
- 完整 examples exit 0：20 个场景，13 passed / 1 partial / 6 skipped / 0 failed。
  原始逐项结果见 `full-examples.json`。命令面板截图时机修正后单独补跑 dsh-x，
  同样通过，合并只替换该项结果；没有抹掉其它场景的证据。
- custom-gateways：干净 profile 走官方 plugin add；Pi 目录看到宿主网关配置，真实模型
  请求确实走该网关。证据 `custom-gateways.json`。
- side-conversation：真实 Web + 原样 pi-btw，主线程无侧聊答案，侧聊显示 Frank Herbert；
  截图已目检。证据 `side-conversation.json`、`assets/side-conversation.png`。
- headless-subagents 强化断言后重跑通过：原样 `@tintinweb/pi-subagents@0.20.0`；父会话
  工具列表只有 Agent；子会话 bash 参数同时包含目标路径与随机标记，工具成功、文件
  内容相符。不将它扩大为全部 TUI 子代理生命周期验收。证据 `headless-subagents.json`。
- step-seams 真实模型回归通过：参数 coercion、当轮系统提示覆盖、tool_execution_end
  与 turn_end 顺序、每模型调用的真实工具结果通过。证据 `step-seams.json`。

以上是发布前的本地候选验证，不替代 npm 正式包回归；发布后结果单独归档。

## 已解除的环境阻碍与保留边界

完整 examples 电池在启动前被磁盘保护门拒绝：临时卷不足 4 GiB（实读 3.82 GiB），
20 个场景未因此执行。这不是 20 个产品回归，也不是通过；安全门没有被调低。
用户随后批准官方 npm/pnpm 缓存清理。已执行 npm 官方缓存清理，恢复到约 5.2 GiB；
未清理 pnpm store，源码、会话、凭证和已安装依赖未动。完整电池已重新串行跑完。

四个缺配置跳过项：Alibaba Token Plan、Vision CLI、Vision Web、Codex 生图。
subscription-login 为 partial：登录前发现和原生路由已过；缺 CODEX_AUTH_FILE，未验证
登录后的模型选择器。其余两个 skipped 是 TUI MCP 和 TUI 子代理生命周期，原因如下。

第三方终端：核对 npm `@deepseek-harness-tui/dsh-tui@0.18.0`、
`@xmoon76/dsh-pi-tui@0.5.5` 的 peer 声明，均未覆盖目标 alpha；前者到 rc.5，后者普通
下界不自动包含新元组 prerelease，Cordis 声明也不同。不用 overrides/allow-version
冒充终端兼容。TUI 受阻不阻止 headless/Web 独立验收。

## 范围

按 2026-10-30 确认的规则，不 fork DSH，不另建模型系统。新增非聊天模型操作使用
Pi 的错误结果通道明确拒绝。虚拟模型、可编辑轮次边界、完整 loadout 等尚未完成的
映射逐项列于运行时能力目录；不能把“切到了 1.4 依赖”写成“所有 Pi 1.4 能力完整”。
实际改动及架构归因见 [架构记录](../../docs/architecture-mapping-matrix.md)。

## 截图与收尾

截图在 `assets/`：包括真实侧聊、按需注入、主线程保存、MCP 多工具发现、代码导航、
跨会话记忆、后台任务运行/取消、状态组件及真正展开的命令面板。关键画面已目检。

测试进程由测试专属进程组/终端 socket 管理；浏览器是独立 Playwright 实例，Web 带
`--no-open`。临时 profile 按场景收尾；归档后已清理本轮临时 CLI 和源码参照，
检查未发现本轮遗留测试进程。源码、凭证、用户会话及其它任务的工作目录未删除。
