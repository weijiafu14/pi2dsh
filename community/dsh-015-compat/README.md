# DSH 0.1.5 适配验收证据

目标：同一份 pi2dsh 承接 Pi 0.84.1 插件契约，适配 DSH 0.1.5-rc.1，并保留旧宿主能力路径。
只验新建数据和同版本重启。用户明确排除跨版本旧数据迁移，本轮没有改写旧会话或迁移旧序号引用。

同一源码支持 DSH `0.1.1-rc.2` / `0.1.5-rc.1`，peer 范围已更新。仓库构建版本仍为
`0.24.0`，本轮没有发布 npm，不能将同名已发布包当作含这些修复。
`pnpm verify` 已通过：35 个测试文件 / 363 个测试，覆盖率检查、生成文档校验和真实
tarball 安装检查均通过。新版示例最终为 19 过 / 1 跳过。

| 宿主版本 | 合并后专项实证 |
|---|---|
| DSH 0.1.1-rc.2 | Pi-code CLI/Web、原包 provider 系统提示词与工具、逐轮事件/决策点、子代理控制/恢复/模型/隔离均通过 |
| DSH 0.1.5-rc.1 | 原包 provider 系统提示词与工具、逐轮事件/决策点、Pi-code Web 配置/命令及文件引用往返均通过；完整示例与子代理全项另保留本轮合并前证据 |

- `new-examples.json`：首次完整示例运行，保留原始失败/跳过记录。
- `new-examples-final.json`：完整运行加对应单项补跑；补跑文件保留具体证据。
- `new-provider-system.json`：原版 pi-provider-litellm 2.3.0 自带传输，真实 DeepSeek HTTP 请求中有系统提示词，且完成真实工具往返。透传器不改请求、不合成回复。可选 LiteLLM Skills/MCP 产品未测试。
- `new-pi-code-*.json`：原版 pi-code 1.0.47 的 CLI/Web 配置链路；Web 文件场景还保留了 Pi context hook 修改周边文本后的原生附件引用，并从真实文件工具结果取随机码。
- `new-subagents-lifecycle.json`：原版 pi-subagents 0.18.0 的控制、恢复、模型和子插件隔离。
- `new-codex-image-recheck.json`：真实 Codex OAuth、生成、原生附件、Web 上传确认、参考图编辑及可解码的图片展示。
- `integration-*.json`：与主工作区并行的 Hermes/Pi CLI 修改合并后的专项复验，文件名明确宿主版本线。
- `integration-old-subagents-final.json`：完整旧版运行加 steer 单项补跑的汇总；原始失败与补跑分开保留。
- `web-file-context.png`、`web-image-result.png`：已目检的真实浏览器结果；图片工具结果已展开，断言同时检查实际图片解码。

旧版 steer 用例通过公开 `tools/pre-execute` 测试门等待真实 child `request/header`，再放行原版 `steer_subagent`。
该测试门只控制介入时机，不改参数、结果、模型回答，避免把启动前排队误当作运行中插话。
补跑要求 `gateObserved: true`，且从原生日志再次断言插话在首次请求之后。

`new-*` 完整示例来自本轮独立适配源码，`integration-*` 专项复验来自合并后的源码。
后者重新验证模型系统提示词/工具、逐轮决策点、Web 配置及文件上下文；旧版另覆盖完整
子代理控制与恢复。图片生成记录中的 `terminated-after-durable-turn` 只证明生成结果
已持久化，不证明 headless 自然退出。

JSON 保存执行结果，不生成架构等级；逐能力五层路径与判级见 `docs/plugin-validation-matrix.md`。
未提供 Alibaba 凭证的场景明确跳过。pi-code 的完整 Task/JSON CLI 契约缺口不计入通过项。
