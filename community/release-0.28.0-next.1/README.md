# 0.28.0-next.1 / 0.7.0-next.1：npm 发布后验收

目标为 stock DSH `0.2.2-alpha.3`、Cordis `4.0.6-alpha.2`、Pi `1.4.0`，Node.js 24.9+。
沿用 `next` 预览通道，不改变稳定线 `latest`。

本轮修复配置写入错误被误判为适配器缺失的问题；契约覆盖错误保留与不二次挂载。
新增精确 Cordis prerelease 兼容门，防止未经验证的内部 alpha 自动进入支持声明。

发布前本地 verify 通过（410 tests）；完整 examples 退出码 0，13 passed / 1 partial /
6 skipped / 0 failed。网关和 Web 配置写入失败已不再出现。

两个包已发布 npm `next`，代码与 `v0.28.0-next.1` 已推送；registry 散列与本地产物
一致，旧 `latest` 不变。详情见 `published.json`。

## 最终正式包回归

- **`pnpm verify:release` exit 0**：416 tests / 44 files，依赖图、类型、文档和打包检查通过。
- **完整 20 项 examples**：13 passed / 1 partial / 6 skipped / 0 failed。每项有引擎信息的
  结果均回读为 npm `pi2dsh@0.28.0-next.1`；Web 套件同时回读为 npm `dsh-work-x@0.7.0-next.1`。
  见 `examples-npm.json`，不是本地 file 包或重新拼装的套件。
- **step-seams 真模型通过**：参数转换、当轮系统提示覆盖、执行结束/轮次结束的顺序和
  每模型调用的真实工具结果；见 `step-seams-npm.json`。
- **子代理独立补验通过**：npm 引擎 + 原样 `@tintinweb/pi-subagents@0.20.0`；父会话
  只调用 Agent，子会话实际调用 bash/read，随机标记真实落盘。见 `subagents-npm.json`。
  这不冒充被跳过的第三方 TUI 生命周期矩阵。
- **GitHub CI 通过**：[运行记录](https://github.com/weijiafu14/pi2dsh/actions/runs/41639373959)。
  CI 使用 Node 24 与锁定的 npm 宿主图，不再安装未被测试代码使用的旧宿主源码树。
- **截图**：`assets/` 保留本次 npm Web 回归的 14 张原图；关键侧聊、命令、记忆、任务、
  代码导航与 MCP 画面已目检。

版本/命令级汇总见 `verification.json`；实际 CLI 图与 lockfile 散列见 `host.json`。

## 未实测与未完成不是同一件事

- 缺凭证而跳过：Alibaba Token Plan、Vision CLI、Vision Web、Codex 生图。
- subscription-login 为 partial：登录前目录/原生路由已过，缺 Codex 登录态的后半段未测。
- 第三方 TUI 的 MCP/子代理场景跳过：所查 `dsh-tui@0.18.0` 与 `dsh-pi-tui@0.5.5`
  均未声明支持目标宿主，不使用兼容覆盖或源码 patch。独立 TUI 记录见 `pi-tui-npm.json`。
- 实现仍不完整：Pi 虚拟模型、完整 codemode/loadout、可编辑 transcript/轮次边界，
  新的非聊天模型操作等，见[现行架构边界](../../docs/architecture-mapping-matrix.md)。
  已有工作流通过不代表 Pi 1.4 的所有新接口都已等价实现。

## npm 首轮与测试装置修正

首轮完整 examples 的原始结果保留在 `examples-first-run.json`：12 passed / 1 partial /
6 skipped / 1 failed。唯一失败为 MCP 超时断言：原来的 `.find()` 只检查参数文本包含
`slow_task` 和 `timeoutMs`，因此可能选中先执行的**工具搜索脚本**，而不是后续调用。
这个失败记录不被覆盖，也不反向改写成产品已通过。

相同 npm 包、相同原样 Pi 插件、不修改产品实现，独立重跑通过；读取真实 session log
确认 `tools.call("many-tools_slow_task", {})` 的结果为 `mcpScript timed out after 5000ms`。
随后修正装置：同时要求精确预算、真实超时工具结果、服务端 handler 的独立开始记录、
超时后的成功代理调用、总耗时边界。搜索、普通错误或模型自述都不能代替它们。
6 项反证测试通过；完整自动测试增为 416 项。最终 npm 全链已重新跑完并退出成功，
新的 MCP 实证包含真实 serverSlowStarts=1、5 秒超时结果，以及超时后 tool_001 继续应答。

服务端见证仅在设置 `PI2DSH_MCP_CALL_LOG` 时记录调用 id、工具名、阶段和时间，
不记录参数、模型请求或凭证，不改变 MCP 工具返回值。它是测试资产，不是桥或 Pi 包补丁。

## 测试资源

测试默认串行；Web 通过 `--no-open` 启动并使用独立 Playwright 浏览器，场景结束关闭服务。
本轮临时 CLI/profile 在证据归档后清理，不清理用户浏览器、真实会话、凭证或项目依赖。
