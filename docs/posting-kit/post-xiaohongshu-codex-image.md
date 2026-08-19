小红书发帖素材：Codex 订阅生图 / 改图

标题
DeepSeek Harness 接上 Codex 订阅后，连生图改图都能用了

封面大字
DeepSeek Harness
用 Codex 订阅生图、改图

封面散点词
ChatGPT Plus / Pro
OAuth 登录
不用另买图片 API
原图编辑
上传前确认
Web 直接看结果

正文（1000 字以内，发布时直接复制）

项目先放前面：GitHub 搜索 weijiafu14/pi2dsh，欢迎 Star ⭐

DeepSeek Harness 现在可以直接复用 Codex OAuth 登录做生图和改图了。

这次接入的是 Pi 生态里的 @crazygit/pi-codex-image-gen。插件原包不改，由 pi2dsh 把它需要的 OAuth、工具、审批、附件和 Web 展示能力接进 DeepSeek Harness。

安装只要两条：
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen

重启后，在对话框输入 /login，选择 OpenAI (ChatGPT Plus/Pro) 完成登录，再选择 OpenAI 分组里的 Codex 模型。之后直接说“生成一张……”就会调用 codex_generate_image；也可以给本地图片的绝对路径，让它按要求编辑。

编辑本地图片时，DeepSeek Harness 会先弹出确认框，明确告诉你将上传哪张图；同意后才发送。生成或编辑完成后，图片不是一段 JSON，也不用自己翻文件夹，会直接显示在 Web 工具卡里。

我已经用真实 Codex OAuth 账号跑通完整链路：模型决定调用工具 → 图片生成 → DSH 原生附件落库 → Web 显示；改图链路还跑了本地文件审批和真实参考图编辑。

不用单独配置图片模型，不用额外填写图片 API Key。图像请求由插件使用同一份 Codex OAuth 登录完成。

#DeepSeek #DeepSeekHarness #Codex #ChatGPT #AI生图 #AI编程 #开源项目 #Agent

建议配图顺序

1. 封面：assets/xiaohongshu-cover-codex-image-v1.png
2. Web 工具卡直接显示编辑结果
3. 实际生成的 DSH 蓝色图标
4. 原始蓝图与编辑后的橙色星形图对比

可公开证据

- codex-image-gen/codex-image-edit-result.png
- codex-image-gen/codex-generated.png
- codex-image-gen/codex-edited.png

宣传边界

- 只说已验证的 @crazygit/pi-codex-image-gen，不泛化成所有图片插件都已验证。
- 可以说没有单独图片 API Key；前提是用户已有可用的 Codex OAuth 订阅登录。
- 不展示 OAuth token、auth.json、内部代理地址或本机用户名路径。
- 自动回归的审批截图包含本机绝对路径，不公开；若需要展示审批框，发布人用中性演示路径重新截图。
