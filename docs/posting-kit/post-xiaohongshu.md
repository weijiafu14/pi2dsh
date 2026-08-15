# 小红书宣传稿

**标题：** 给 DeepSeek Harness 装上看图的眼睛

**封面：** `assets/xiaohongshu-cover-v2.png`

---

给 DeepSeek Harness 装上看图的眼睛，不需要改 DeepSeek 模型接口。

我最近把 Pi 的插件生态接进了 DeepSeek Harness，做成了一个通用兼容引擎：**pi2dsh**。

它不是给每个插件单独写适配，也不需要 fork 或修改插件源码。引擎装一次，后续 Pi 插件直接按 npm 原包安装：

```sh
dsh plugin --profile web add pi2dsh@0.11.0
dsh plugin --profile web add @kassing/pi-vision
```

装完重启 DeepSeek Harness，纯文本模型会自动多出一个 **DeepSeek + Vision Bridge** 分组。Web 里可以像使用原生多模态模型一样直接粘贴图片。

视觉模型需要单独配置。最简单是接一个公开的 OpenAI-compatible 视觉端点，例如 OpenRouter：

```sh
export OPENROUTER_API_KEY='<你的OpenRouter Key>'
export VISION_BRIDGE_BASE_URL=https://openrouter.ai/api/v1
export VISION_BRIDGE_MODEL=qwen/qwen2.5-vl-72b-instruct
export VISION_BRIDGE_API_KEY=$OPENROUTER_API_KEY
```

OpenRouter 只是示例，也可以换成 DashScope/Qwen-VL、自建 vLLM 或其他兼容端点。配置只从环境变量读取，不写进 pi2dsh 源码。

目前跑通了两种识图方式：

1. **自动识图**：`@kassing/pi-vision` 在 DeepSeek 推理前调用独立视觉模型，把识图结果注入上下文，主模型直接回答，零工具调用。
2. **Agent 主动识图**：`pi-vision-tool` 提供 `describe_image`，由 Agent 自己决定什么时候看图，并控制提示词、压缩和推理深度。这种方式先把视觉模型按 DSH 官方 `llm-pi-ai` 配进 `~/.dsh/settings.yaml`，再用 `PI_VISION_PROVIDER` 和 `PI_VISION_MODEL` 选择它。

图片不会被硬塞给 DeepSeek 的纯文本接口。视觉模型负责看，分析结果以文字进入上下文，DeepSeek 继续负责推理。

CLI 和 Web 两端都已经真实跑通：粘贴图片、视觉分析注入、纯文本 DeepSeek 正确回答，完整链路都能在会话里看到。

识图只是一个例子。pi2dsh 的目标是让 Pi 生态的工具、命令、Skills、OAuth、记忆、审批和子代理能力，都可以直接运行在 DeepSeek Harness 上。

项目已经开源：GitHub 搜索 **weijiafu14/pi2dsh**。

如果你也想让 DeepSeek Harness 直接使用 Pi 插件，欢迎来试，也欢迎给项目点一个 Star ⭐

#DeepSeek #DeepSeekHarness #PiAgent #AI编程 #开源项目 #Agent #程序员工具
