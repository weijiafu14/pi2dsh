# DSH 0.1.5-rc.2 增量核验

2026-09-14 查询 npm：`latest = 0.1.5-rc.1`，`next = 0.1.5-rc.2`。
目标为官方 npm `@deepseek-ai/dsh@0.1.5-rc.2`，引擎为当前未发布的 pi2dsh 本地源码
（包版本仍为 0.24.0），Pi 插件固定为原包 `pi-code@1.0.47`。

## 判断依据

完整 tag diff 的实际产品变化集中在反馈交互、文件卡片、图标和间距。我们依赖的
服务端能力接口及客户端加载/会话/工具/附件接入没有变化；当前 DSH peer 范围经
semver 检查已全部接受 rc.2。因此本轮没有修改桥运行时或能力等级。

- [发布包字节比较](published-byte-comparison.json)：比较本机保留的官方 rc.1 CLI
  安装与本轮官方 rc.2 CLI 安装；记录的 13 个核心/客户端包 `lib` 文件全部逐字节相同。
  只对列出的包下结论，不把未比较的包算入。
- [实际安装树](installed-stack.json)：从 CLI 的真实依赖/peer 图回读，所列 231 个 DSH
  包全部为 rc.2，没有混入 rc.1；不是从本地上游源码 checkout 推断。
- [引擎指纹](engine-fingerprint.json)：固定这次测试使用的本地源码与构建产物，避免把
  同名 npm 0.24.0 当成本地修复。

## 实跑结果

[Web 原始结果](web.json) 来自全新 DSH_HOME、官方 `dsh plugin add` 安装流程和真实
DeepSeek 模型。环境变量、PreToolUse hook、CLAUDE.md 导入、技能发现、斜杠命令和文件
引用往返六组断言均通过。文件随机码来自真实文件工具结果，Pi context hook 修改
周边文字后，DSH 日志仍保留原生 file 引用。

[项目信任对话框](01-trust-question.png) 和 [文件结果](05-file-attachment.png)
均已目检。`trustQuestionInLog: false` 是持久日志观察值，不用于推断对话框是否出现；
浏览器实际应答及截图作为该呈现的证据。

首次 CLI 安装因 npm 下载连接重置失败；降低下载并发、复用缓存后干净安装完成。
这次是 rc.2 的定向 Web 回归，不宣称重跑了 rc.1 的全量示例；构建通过，本轮未重新
执行完整单测，也没有修改运行时。跨版本旧数据迁移仍不在范围内。

源码判定及接口影响见 [架构审计](../../docs/dsh-architecture-audit.md#2026-09-14dsh-015-rc2-增量核验)。
