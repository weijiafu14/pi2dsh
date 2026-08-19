小红书发帖素材：Codex 订阅生图 / 改图

标题
我的 DeepSeek Harness 能生图了！Codex 订阅直接用

封面大字
我的
DeepSeek Harness
能生图了

正文（1000 字以内，发布时直接复制）

我的 DeepSeek Harness 现在真的能生图、改图了，而且直接使用 ChatGPT Plus/Pro 的 Codex 登录，不用再单独买图片 API。

项目先放前面：GitHub 搜索 weijiafu14/pi2dsh，欢迎 Star ⭐

这次把 Pi 生态的 @crazygit/pi-codex-image-gen 原包接进了 DeepSeek Harness。

第一步，安装兼容引擎和图片插件：
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen

只要这两个包，不需要第三个 OAuth provider 插件：openai-codex 登录已内置在 pi2dsh，标准 Web profile 直接使用 DSH 自带的 llm-pi-ai。

第二步，重启 DeepSeek Harness，必须先在对话框输入：
/login openai-codex

按提示完成 ChatGPT Plus/Pro 浏览器授权。主会话可以继续用 DeepSeek，也可以选 Codex；图片工具只复用这份登录态。没登录会报 AUTH_MISSING。不要求安装 Codex CLI。

第三步，直接说“再来一张龙珠图”或者“把这张图改成……”。Agent 会调用 codex_generate_image，结果直接显示在 Web 工具卡里。

编辑本地图片时会先弹出确认框，列出要上传的图片，同意后才发送。结果直接显示在 Web 工具卡里，不再是一段 JSON。

我已经用真实 Codex OAuth 账号跑通完整链路：模型调用工具 → 图片生成 → DSH 原生附件落库 → Web 显示；改图链路也跑通了本地文件审批和真实参考图编辑。

#DeepSeek #DeepSeekHarness #Codex #ChatGPT #AI生图 #AI编程 #开源项目 #Agent

建议配图顺序

1. 封面：assets/xiaohongshu-cover-codex-image-v3.png（真实 DeepSeek Harness 生图会话二次排版）
2. 真实效果：assets/codex-image-gen/dragonball-dsh-result-v2.png（DSH 工具卡直接显示龙珠结果）
3. 原图：assets/codex-image-gen/dragonball-generated.png（Codex 实际生成的 1254×1254 PNG）
4. 登录后模型选择器：assets/11-model-picker-after-login.png

可公开证据

- codex-image-gen/dragonball-dsh-result-v2.png
- codex-image-gen/dragonball-generated.png
- 11-model-picker-after-login.png

宣传边界

- 只说已验证的 @crazygit/pi-codex-image-gen，不泛化成所有图片插件都已验证。
- 可以说没有单独图片 API Key；前提是用户已有可用的 Codex OAuth 订阅登录。
- 不展示 OAuth token、auth.json、内部代理地址或本机用户名路径。
- 自动回归的审批截图包含本机绝对路径，不公开；若需要展示审批框，发布人用中性演示路径重新截图。
