# pi2dsh 0.27.0 / dsh-work-x 0.6.0

状态：发布前验收通过，npm 发布及正式包回归待完成。

目标：DSH **0.2.1-rc.2**，Pi 公开 ABI 继续固定 **0.84.1**。对应
[#7 的新版桌面安装报告](https://github.com/weijiafu14/pi2dsh/issues/7#issuecomment-6259660360)。
DSH 0.2.0-rc.2 用户保留 pi2dsh 0.26.0 / dsh-work-x 0.5.0 检查点。

本轮发布范围经用户 2026-10-19 确认：不等待第三方 `@xmoon76/dsh-pi-tui`。
其 0.5.1 的真实启动仍引用已删除的 `dsh-invariants` 与 preset invariant 入口，
并在 persona 模板使用已移除的 `{{cwd}}` 变量；下一渠道 0.5.2-rc.1 也仍声明旧
invariant 组合。保留失败证据，不修改第三方实现，不计入通过；发布回归以明确原因
跳过该组合。另一终端 `@deepseek-harness-tui/dsh-tui@0.16.1` 仍在验收范围内。

## 变化范围

- 引擎 peer/devDependencies 对齐新宿主，Cordis 对齐 4.0.5。
- Web 套件依赖新引擎，原六个 Pi 能力包版本不变。
- 移除未使用且新版已不再发布的 `dsh-invariants` 测试依赖。
- 测试依赖树的自动 peer 统一到实际 CLI 同代，并在 `verify` 加入
  `check:host`，拒绝“直接依赖已升级、传递 peer 仍是旧版”的混装验收。
- 验收脚本的默认宿主版本同步；专项父子回合脚本从 manifest 读取验收版本，
  不再把旧版本号和某台机器的 CLI 路径写死。

没有 fork/修改 DSH、TUI 或 Pi 包。是否需要运行时适配由本轮真实回归决定，
不从版本号差异猜测接口已经破坏，也不使用 `allow-version` 绕过安装检查。

本轮没有修改桥的生产运行时。新增测试调整为：新版 Web 从真正发布的会话行继续操作，
不误选空白 New Session 占位行；设置页使用宿主公开快捷键；dsh-TUI 首页切换模型后
允许仍停在首页输入框，实际路由继续用父子请求日志断言。测试错误中的 launch token
脱敏；并发场景的截图单独保留，临时 profile 仍可清理。

## 接口复核

基于两版 npm 包的公开声明及所带实现对照，不以本地 DSH 源码 checkout 代替发布包。

- `agent/created` 及逐 Agent 作用域、V4 `role: tool`、user-questions 接口仍承载现有调用。
- LLM `prepareCall` 新增可选 `ConfigureCall`，原调用仍合法；新增 image request target
  方法有基类默认实现。未据此宣称 Pi 获得新的 wire hook。
- tools 删除 `both` 呈现模式；引擎不配置该模式，真实测试继续验证 native/PTC 边界。
- Session 增加 `appendPluginRecord`/`pluginRecordOf`，文档标为 experimental，
  对格式迁移的保留是 best-effort。当前 Pi 持久化映射没有因此自动升级为原生承接；
  替换现有档案需要独立验证其恢复/分支/迁移语义，本轮不夹带迁移。
- invariant companion 被移除，非桥的运行时依赖。

## 验证

发布前：373 契约测试、类型/文档/打包检查通过；测试图中的 89 个 DSH 包全部同代，
peer 检查无问题。完整示例为 15 passed / 1 partial / 4 skipped / 0 failed，
子代理 8 场景全部通过，step-seams 真实模型轮通过。见 `examples-prepublish.json`、
`subagents-prepublish.json`、`step-seams-prepublish.json`。

首次 Web 失败保留为测试交互不符的排查背景，不算产品通过。一次独立的显式模型
专项中，模型只回复状态文本而没有执行文件工具，文件断言正确失败；未放宽断言，
随后全新完整轮中该场景通过。见 `model-follow-first-attempt.json`。

契约、完整示例、子代理生命周期、终端组合、发布后 npm 安装结果分别保存。
缺少账号/视觉端点的项目必须保留 skipped/partial 和原因，不能计入通过。
本轮使用官方 npm CLI，独立 DSH_HOME；凭证仅从进程环境提供，不进入本目录。
