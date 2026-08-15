## 进展更新（v0.3.5）

这段时间按论坛里大家的真实需求，逐个把 Pi 生态插件挂到 DSH 上做**端到端**验证（真机 + 真模型，不是"能加载"就算数）。几个已经跑通并在对应帖子回复的：

**模型自动审批**（#421 / #1398）：[pi-approval-guardian](https://www.npmjs.com/package/pi-approval-guardian) 零改动挂上，full access 下危险命令（`sudo rm -rf` 系统路径）被审查模型自动拦、良性命令放行，全程无人工介入。

**跨会话长期记忆**（#14 / #218）：[pi-hermes-memory](https://www.npmjs.com/package/pi-hermes-memory) 挂上，一个会话里 `memory_add` 存的事实，**另起一个进程**能 `memory_search` 从磁盘读回。

**视觉 / 识图**（#1487 / #1464 等）：[pi-vision-tool](https://www.npmjs.com/package/pi-vision-tool) 这类"给文本模型加视觉"的插件，`describe_image` 工具、schema、凭证解析链路都适配通了；配一个 vision 模型（`models.json`）就能让 DeepSeek 委托识图。

**修复（0.3.5）**：vendor 了 `createExtensionRuntime`，自绘运行时的 Pi 扩展命令执行不再报 "is not a function"。

**一条诚实的边界**：自绘**终端 TUI overlay** 的插件（如 pi-btw 的 `/btw` modal），命令注册和后端逻辑能桥过来，但 overlay 的界面渲染依赖 Pi 的终端 TUI（`ctx.ui.custom`）——DSH web/headless 呈现不了（Pi 自己的非终端模式也一样）。这类 UI 超出 ABI 兼容层的范围，会在文档里如实标注。

装法不变：`npx pi2dsh host --packages <pi-package> --out bundle` → `dsh plugin add file:bundle`。仓库 https://github.com/weijiafu14/pi2dsh
