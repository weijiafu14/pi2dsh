# GitHub community replies — Codex OAuth image generation

## deepseek-harness #68

这里现在有一个可以直接跑的答案：不需要把 OAuth 插件源码改成静态 header，也不需要为每个 Pi 插件重写 DSH bundle。

`pi2dsh` 会把 Pi provider 自己的交互式 OAuth 流程投影成 DSH 的 `/login` 命令和问题框；登录完成后，轮换凭证进入 DSH credentials，对应 provider 出现在原生模型选择器并进入模型调用链。

现在连依赖这套登录态的 Pi 图片插件也跑通了：

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
```

重启后运行：

```text
/login openai-codex
```

然后可以直接在 DSH 里让 Codex 调 `gpt-image-2` 生图或编辑本地图片。图片进入 DSH 原生附件库并直接显示在 Web 工具卡里；编辑本地图片前会先显示 DSH 确认框。

完整复现：<https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>

这条链路的关键是“翻译 Host ABI”，不是把 OAuth 降级成静态配置：Pi 插件仍使用自己的 provider/OAuth 协议代码，DSH 负责问题 UI、credentials、模型目录、附件和 Web surface。

## deepseek-harness #3004

Follow-up: the same ChatGPT Plus/Pro `/login` route now covers image generation and editing as well as normal Codex model turns.

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
# restart, then in the composer:
/login openai-codex
```

After login, a Codex model can call `codex_generate_image`; the Pi package reuses that OAuth account to call `gpt-image-2`, and the returned PNG is persisted through DSH attachments and rendered inline in the Web tool card. Local reference-image edits go through a DSH confirmation dialog before upload.

No separate image API key is required. Reproduction: <https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>

## deepseek-harness #1963

如果你有 ChatGPT Plus/Pro，可以换一条不依赖当前图片 Provider 余额的路线：用 Codex OAuth 订阅在 DSH 里生图，不需要单独配置图片 API Key。

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
```

重启后在对话框运行 `/login openai-codex`，完成登录并选择 Codex 模型，直接描述要生成的图片即可。Agent 会调用 `codex_generate_image`，结果作为 DSH 原生附件直接显示在工具卡里；本地参考图编辑也支持，上传前会弹确认框。

步骤和真实端到端验证：<https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>

这不会给原来报错的 Provider 补余额，而是提供一条已经跑通的订阅替代路线。

## deepseek-harness #2995

A narrower part of this is working now for **tool-produced images**, and may be useful as an implementation reference.

With `pi2dsh` + `@crazygit/pi-codex-image-gen`, the Pi tool returns a standard image block; pi2dsh saves it through DSH's native attachment service and registers the image tool's Web result card at mount time. The completed tool row displays the pixels inline through DSH's session-authorized attachment endpoint — no local HTTP server or `data:` URL workaround.

Reproduction: <https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>

This does **not** replace the proposal here: arbitrary assistant-side `ImageBlock` rendering is still a separate host capability. It does show that plugin tool results can already use the existing attachment vocabulary and permission checks end to end.

## Pi #8090 update

Update: a provider/OAuth/attachment-heavy Pi package now runs unmodified on DSH too: [`@crazygit/pi-codex-image-gen`](https://github.com/crazygit/pi-codex-image-gen).

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
# restart, then:
/login openai-codex
```

The full path is now verified on a real DSH Web session: ChatGPT Plus/Pro OAuth login → Codex model calls `codex_generate_image` → the package calls `gpt-image-2` → returned PNG becomes a native DSH attachment → pixels render inline in the tool card. Reference-image editing also crosses Pi's `ctx.ui.confirm` into a real DSH approval dialog before the local file is uploaded.

The Pi package is unchanged. The host-specific work stays in pi2dsh: provider/model projection, OAuth credential publishing and refresh, tool ABI, attachment persistence, and the DSH browser surface.

Runnable example: <https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>

## Pi #3373

One Pi package I have been enjoying recently is [`@crazygit/pi-codex-image-gen`](https://github.com/crazygit/pi-codex-image-gen): it generates and edits images with the ChatGPT/Codex subscription you already log in to, including local-reference approval and sensible image handling.

It also turned into a useful portability test. We ran the published package unchanged inside DeepSeek Harness through [pi2dsh](https://github.com/weijiafu14/pi2dsh): OAuth login, a real Codex tool call, `gpt-image-2`, native DSH attachment storage, and inline Web pixels all work end to end.

DSH-side install:

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
```

Reproduction: <https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>
