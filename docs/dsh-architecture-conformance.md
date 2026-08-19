# pi2dsh 对 DeepSeek Harness 的架构检验

pi2dsh 不只把 Pi 插件搬到 DeepSeek Harness（下文简称 DSH），也用 Pi 生态真实依赖的
能力检验 DSH 的插件架构。本文是当前结论；方法与强制口径见
[`architecture-mapping-standard.md`](architecture-mapping-standard.md)。

## 第一部分：架构模型

### Pi 有哪些能力契约

Pi 的接口不是一张扁平 API 表，而是三层模型：

```text
能力域 → 能力契约 → 具体 API / 事件 / context 方法
```

当前固定 Pi 0.84.1，共有 111 条上游形状规则，全部归入 26 个能力契约：

| Pi 能力域 | 主要能力契约 |
|---|---|
| 工具与执行 | 工具注册、可见性、执行生命周期、进程执行 |
| 命令与输入 | 命令注册、flag/快捷键、用户输入预处理 |
| 消息与 Agent | 消息注入、消息生命周期、Agent/turn 生命周期、控制、上下文检查 |
| 会话 | 持久事实与元数据、创建/分支/导航、压缩、宿主上下文与 reload |
| 模型 | provider/模型目录、模型与推理档位选择、网络请求生命周期 |
| 交互与呈现 | 用户提问、通知、宿主框架、编辑器、渲染与主题 |
| 项目环境 | 项目信任、动态资源发现、包内事件总线 |

每条接口的具体归属、当前实现和理论映射都在自动生成的
[`architecture-mapping-matrix.md`](architecture-mapping-matrix.md) 与
[`capabilities/`](capabilities/README.md) 中。桥扩展 `unregisterTool` 和 202 个 import
symbols 单列，不混入 111 的上游 ABI 分母。

### DSH 有哪些承载机制

DSH 同样不是 45 个模块的平铺清单，而是：

```text
架构域 → 承载机制 → subsystem / service / provider / waterfall / event / client slot
```

当前把官方 45 个 subsystem 全部归入 8 个承载机制：

| DSH 承载机制 | 负责什么 |
|---|---|
| 插件组合与策略 | Cordis 生命周期、service/provider、scope、waterfall、配置与权限 |
| 持久会话与上下文投影 | session log、存储、投影、查询、压缩、遥测 |
| 模型运行时 | 模型目录、adapter、stream、凭证、token、system prompt |
| 工具、执行与隔离 | tools、subprocess、filesystem、sandbox、approval、terminal |
| 工作区资源 | attachment、skills、web、workspace、LSP |
| Agent 编排 | agent、subagent、goal、plan、jobs、schedule、workflow |
| 命令与人机交互 | commands、user questions、feedback |
| 客户端与 Web | client module、slot、web route、typert |

45 个模块逐项归属和公开 seam 见
[`architecture-mapping-matrix.md`](architecture-mapping-matrix.md)。这张全表保证 DSH
侧没有漏面，但“模块被列到”不等于“已经被真实插件验证”。

### Pi 到 DSH 按什么原则映射

每个 Pi 能力契约必须映射到具体 DSH 承载机制和公开 seam，并比较五件事：用户目标、
介入时机、权威状态、生命周期、原生呈现。理论结论分为直接承接、组合承接、宿主语义
翻译、缺公开 seam。

```text
Pi 具体接口
  → Pi 能力契约
  → DSH 承载机制
  → DSH 具体公开 seam
```

这样既可以从 111 条接口向上检查抽象是否完整，也可以从一个能力契约向下找到实际要用
的 DSH API。不能用同名接口代替语义比较，也不能只写抽象而不给实际落点。

### DSH 的设计目的

人话说，DSH 是一块运行中还能换件的 Agent 主板：profile 是装机单，service definition
是插座，provider 是零件，agent 是运行中的发动机，session log 是飞行记录仪，waterfall
是决定落地前的检查站，client module/slot 是浏览器半边，Cordis fiber/effect 负责依赖、
启停和拆卸清理。

它的核心哲学是：模型只是 harness 的一个可换部件；已发生的事实与尚未决定的策略分开；
消费者依赖能力而不是实现；插件组合在运行中仍可变化。

DSH 官方直接引用的 Cordis 论文
[_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)
解释运行时换件、清理、重绑与回滚。相关但非 DeepSeek 官方的
[_Agent Systems with Harness Engineering_](https://github.com/RUCAIBox/awesome-agent-harness)
解释模型外面为什么需要循环、工具、记忆、workspace、skills、多 Agent、安全和评估。

## 第二部分：验证矩阵

理论映射回答“应该怎么接”，真实插件回答“实际上有没有接住”。每项真实能力沿固定五层
取证：

```text
Pi 插件调用
  → pi2dsh 翻译
  → DSH 公开 seam
  → DSH 原生权威状态
  → 用户可以观察、恢复和回放的结果
```

实践结果只给一个五级判定：原生承接、可靠翻译、旁路完成、降级/缺失、宿主专属不计分。
一个插件可以验证多个能力，每项能力分别判级，禁止给整包一个模糊的“通过”。

当前真实插件与场景记录见自动生成的
[`plugin-validation-matrix.md`](plugin-validation-matrix.md)。例如：

- pi-btw 的 child session 是原生承接，Web 侧边面板是可靠翻译，自定义 session entry
  仍是旁路完成；
- `pi-provider-litellm` 自带 transport 注册成 DSH route 是原生承接；
- Codex OAuth 登录、凭证发布、模型选择和 DSH 原生调用属于可靠翻译；
- `@kassing/pi-vision` 的伴生模型分析与主模型上下文注入属于可靠翻译。

没有进入验证矩阵的理论映射只能写“理论可行、尚未实证”。契约测试、挂载成功和 import
成功可以作为实现证据，但不能代替真实插件走完五层。

## 第三部分：架构结论

### 已经证明成立

DSH 对“替换或注册一整项能力”的公开 seam 有较强承载力。真实场景已经证明工具、命令、
用户提问、模型 adapter、原生模型调用、child session、MCP/skills 复用和 Web client slot
可以被仓外插件使用。pi2dsh 可以在不运行第二个 Pi agent runtime 的前提下，把这些能力
落回 DSH 的模型、会话、工具和界面权威。

### 属于 pi2dsh 的欠账

以下能力理论上已有合理 DSH seam，但桥尚未完整接入：`resources_discover` 到资源
provider、`getContextUsage()` 到 token-meter、Pi `input` 到 `agent/pre-step`，以及部分
宿主发起的 session tree 生命周期观察。它们在完成数据流验证前不能甩给 DSH。

### 已确认的 DSH 缺口

当前只有完成理论归因、真实消费者和最小复现的项目才编号：

| ID | 缺少的公开架构能力 | 实际后果 |
|---|---|---|
| `DSH-ARCH-001` | 仓外插件写 namespaced、可安全回放的自定义 session 事实 | Pi 自定义 entry 只能进入 sidecar |
| `DSH-ARCH-002` | 配置型 provider 的完整 wire compat schema | 私有网关需要改 role/字段时，配置会被提前丢弃 |
| `DSH-ARCH-003` | 已有 adapter 的真实 request/response middleware | 只能拥有整条 transport，不能增强现有 adapter |
| `DSH-ARCH-004` | 压缩执行前的取消/替换 waterfall | 插件只能事后知道压缩发生，不能改变决定 |
| `DSH-ARCH-005` | 早于项目资源加载的 trust policy | 普通插件挂载后再判断信任已经太晚 |

详细复现与上游讨论见 [`dsh-architecture-audit.md`](dsh-architecture-audit.md)。这五项是
已确认缺口，不代表已经穷举所有 Pi 能力或 DSH 模块。

### 如何回答总体与单插件问题

总体情况从同一份总账按 Pi 能力契约、DSH 承载机制、实现状态和验证等级聚合；单个插件
则固定报告它使用了哪些 Pi 能力契约、理论应落到哪些 DSH 机制、实际五层走到哪里、每项
达到哪一级，以及结论属于已成立、桥欠账、DSH 缺口还是宿主差异。无需再翻历史聊天记录。
