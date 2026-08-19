# pi2dsh：给 DeepSeek Harness 接上 Pi 生态；Codex 订阅生图/改图已跑通

分享一下 [pi2dsh](https://github.com/weijiafu14/pi2dsh)：它不是把某一个 Pi 插件重写成 DSH 插件，而是在 DeepSeek Harness 上实现一层 Pi Host ABI。引擎安装一次，之后直接安装 Pi 社区发布的原包。

这次跑通的是一个很直观的例子：把 [`@crazygit/pi-codex-image-gen`](https://github.com/crazygit/pi-codex-image-gen) 原包装进 DSH，使用 ChatGPT Plus/Pro 的 Codex OAuth 登录态直接调用 `gpt-image-2` 生图和改图，不需要再买图片 API Key。

## 安装

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
```

重启 DSH，然后在对话框运行：

```text
/login openai-codex
```

完成浏览器授权后，OpenAI (ChatGPT Plus/Pro) 会出现在 DSH 原生模型选择器里。选择 Codex 模型后直接说“生成一张……”，Agent 会调用 `codex_generate_image`。

完整链路是：

```text
DSH /login
  → Pi 的 openai-codex OAuth 流程
  → DSH credentials + 原生模型路由
  → Codex 模型调用 Pi 图片工具
  → gpt-image-2 返回 PNG
  → DSH 原生附件落库
  → Web 工具卡直接显示图片
```

改本地图片时，插件原有的 `ctx.ui.confirm` 会变成 DSH 的确认框，明确列出即将上传的文件；用户确认后才会把参考图发给 Codex。

## 不是只为这一个插件写的转换器

同一兼容层目前已经在真实 DSH CLI/Web 链路跑通过这些能力：

- `@kassing/pi-vision`：给纯文本 DeepSeek 增加图片分析伴生路由，Web 直接贴图；
- `pi-btw`：侧边问题进入真实 DSH 子会话，不污染主对话，需要时再合并；
- Pi provider/OAuth：登录后进入 DSH 原生模型选择器和模型调用链；
- Pi tools、commands、skills、生命周期事件、会话控制、子代理和图片附件。

Pi 插件的功能代码保持原样；pi2dsh 负责把公共宿主能力映射到 DSH。浏览器展示需要宿主 UI 的地方，则由 pi2dsh 在插件挂载时注册对应的 DSH client surface。

## 可复现材料

- 项目：<https://github.com/weijiafu14/pi2dsh>
- Codex 生图/改图完整步骤：<https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>
- OAuth 订阅登录：<https://github.com/weijiafu14/pi2dsh/tree/main/examples/subscription-login>
- npm：<https://www.npmjs.com/package/pi2dsh>

如果你手里有一个 Pi 插件，希望它直接跑在 DeepSeek Harness 上，可以把包名或实际报错贴过来。能映射到 DSH 标准能力的缺口，我们会按通用 ABI 补，不要求插件作者维护一个 DSH fork。

欢迎试用和 Star ⭐
