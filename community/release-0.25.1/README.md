# pi2dsh 0.25.1 / dsh-work-x 0.4.2

本补丁修复 0.25.0 截图审核发现的侧聊显示问题：隐藏的宿主上下文不应出现在聊天
面板；已经声明浏览器产品呈现的命令不应因 `ui.custom` 误报终端组件不可用。

修复使用既有 `browserPresentation` 配置和 Pi `display` 标志，不改变模型输入或
原生日志；裸 Web 的原包非终端 fallback 保留。套件要求 pi2dsh `^0.25.1`。

发布前 `pnpm verify` 通过：35 个文件、365 个测试，类型检查、覆盖率、文档校验、
publint 与真实 tarball 安装检查全部通过。

同一侧聊流程已使用本地构建在两版官方 DSH 上验证：

- [0.1.5-rc.2 结果](side-local-new.json)、[实际界面](side-local-new.png)
- [0.1.1-rc.2 结果](side-local-old.json)、[实际界面](side-local-old.png)

断言检查侧答只进入子会话、侧窗实际可见、没有隐藏上下文或终端组件错误；两张截图
均已目检。旧版负面截图和原始发布记录保留在 [0.25.0 记录](../release-0.25.0/README.md)。

以上保留为发布前本地构建证据。

## 正式发布与 npm 产物验证

2026-09-15 已发布 [pi2dsh 0.25.1](https://www.npmjs.com/package/pi2dsh/v/0.25.1)
和 [dsh-work-x 0.4.2](https://www.npmjs.com/package/dsh-work-x/v/0.4.2)。
[源码 623db1f](https://github.com/weijiafu14/pi2dsh/commit/623db1f0abe2fc5ba32687b4c3508b993cc5993d)
与标签 `v0.25.1` 已推送；[GitHub CI](https://github.com/weijiafu14/pi2dsh/actions/runs/34929253911)
通过。[发布元数据](published.json)中的 npm 完整性值与本地已验证 tarball 一致。

发布后全部从 npm 安装 `pi2dsh@0.25.1` 与 `dsh-work-x@0.4.2`，使用官方 DSH
`0.1.5-rc.2`、全新 DSH_HOME、真实模型与浏览器。完整示例加补跑最终为
**19 项通过 / 1 项跳过**，唯一跳过项为缺少 Alibaba Token Plan 凭证。

- [最终 20 项结果](examples-final.json)、[首次完整运行](examples-initial.json)
- [记忆/任务安装补跑](work-x-memory-tasks-recheck.json)、[侧聊安装补跑](side-published-recheck.json)
- [逐轮模型/工具决策点](seams.json)：通过
- [旧版 DSH 0.1.1-rc.2 的原生 Pi TUI 组合](pi-tui-old.json)：登录目录、原包 MCP
  管理器、Agents 界面、真实子代理与 MCP 工具调用通过
- [实际 npm 侧聊画面](side-published.png)、[MCP 应用资源](mcp-app-resource.png)、
  [新版代码导航](code-navigation-web.png)

套件被 npm 接收后曾处于处理阶段；首次运行中两项在版本尚未可查询时安装失败。
待实际可安装并核对完整性后，使用原封不动的发布包补跑通过。原始失败保留，
没有覆盖为成功，也没有再次修改或重发 0.25.1 / 0.4.2。

MCP 的详细矩阵包含 DSH 服务契约检查，其中 sampling 使用 fixture adapter；
该项不冒充完整原生模型回合。真实 CLI MCP/子代理回合由上述 Pi TUI 和其它真实
示例分别取证。MCP 应用截图只证明实际资源加载显示，静态 fixture 没有完整交互协议。
侧聊截图已核对问答实际可见、主命令正常完成，且没有隐藏上下文和终端组件错误。
