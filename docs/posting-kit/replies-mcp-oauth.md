# MCP OAuth community replies

## deepseek-ai/deepseek-harness #2017（中文）

这个场景现在可以不再自建 OAuth 转发桥。我们已经用 `pi2dsh` 把原版
`pi-mcp-adapter` 作为普通 DSH 插件能力包接入，插件仍然自己负责 MCP
transport、OAuth、缓存和刷新；pi2dsh 只把它的公开 Host ABI 翻译到 DSH 的
commands、userQuestions、tools 与模型调用链。

安装仍然只用 DSH 官方插件命令：

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-mcp-adapter
```

重启后，在标准 `.mcp.json` 中声明远程服务器（例如 Atlassian 的
`https://mcp.atlassian.com/v1/mcp/authv2`，`auth: "oauth"`），然后在 dsh-TUI
或 Web 执行：

```text
/mcp-auth atlassian
```

刚完成的真实验收不是 mock：Atlassian 授权服务器发现、动态客户端注册、PKCE、
浏览器 localhost 回调、安全凭证存储、MCP 重连与 26 个工具发现全部通过；随后
DeepSeek 在 DSH Web 和 dsh-TUI 中都真实调用了只读的
`atlassian_atlassianUserInfo`，持久会话日志里的 `tool/result` 为
`isError:false`。正常本机回调会自动完成并撤掉粘贴框；只有 SSH/跨机器浏览器无法
访问回调端口时才需要手动粘贴 URL。`/pi-mcp logout atlassian` 会清除凭证。

这是一条现在即可安装的生态兼容路径，不代表官方 `dsh-mcp-client` 已被修改；后续
官方原生 OAuth 完善后，两条路径可以按需要替换。

项目与复现步骤：

- https://github.com/weijiafu14/pi2dsh
- https://github.com/weijiafu14/pi2dsh/tree/main/examples/tui-mcp

## Posted follow-ups across the MCP discussion set

- OAuth-protected remote MCP: [#2017](https://github.com/deepseek-ai/deepseek-harness/discussions/2017#discussioncomment-18114702), [#3813](https://github.com/deepseek-ai/deepseek-harness/discussions/3813#discussioncomment-18114703), [#3997](https://github.com/deepseek-ai/deepseek-harness/discussions/3997#discussioncomment-18114810)
- First-turn readiness: [#1239](https://github.com/deepseek-ai/deepseek-harness/discussions/1239#discussioncomment-18114786)
- Status/observability: [#1300](https://github.com/deepseek-ai/deepseek-harness/discussions/1300#discussioncomment-18114788)
- MCP 2026 protocol negotiation: [#1757](https://github.com/deepseek-ai/deepseek-harness/discussions/1757#discussioncomment-18114791)
- Resource content preservation: [#2025](https://github.com/deepseek-ai/deepseek-harness/discussions/2025#discussioncomment-18114796)
- Large tool catalogs / lazy disclosure: [#2588](https://github.com/deepseek-ai/deepseek-harness/discussions/2588#discussioncomment-18114798)
- Configuration examples and setup: [#2732](https://github.com/deepseek-ai/deepseek-harness/discussions/2732#discussioncomment-18114801), [#2815](https://github.com/deepseek-ai/deepseek-harness/discussions/2815#discussioncomment-18114806)
- Interactive manager: [#2807](https://github.com/deepseek-ai/deepseek-harness/discussions/2807#discussioncomment-18114803)
- Per-tool/server approval: [#3904](https://github.com/deepseek-ai/deepseek-harness/discussions/3904#discussioncomment-18114808)
- Legacy SSE transport: [#3991](https://github.com/deepseek-ai/deepseek-harness/discussions/3991#discussioncomment-18114809)

## Audited but not advertised: current gaps

| Discussions | Why pi2dsh + pi-mcp-adapter is not yet a complete answer |
|---|---|
| [#247](https://github.com/deepseek-ai/deepseek-harness/discussions/247) | The package has request timeouts, but no proven single total budget covering transport start plus every discovery page. |
| [#314](https://github.com/deepseek-ai/deepseek-harness/discussions/314) | Streamable HTTP works in our macOS/Linux acceptance paths; the reported failure is Windows-specific and has not been reproduced through this stack. |
| [#597](https://github.com/deepseek-ai/deepseek-harness/discussions/597), [#941](https://github.com/deepseek-ai/deepseek-harness/discussions/941) | ACP-carried and workspace-owned MCP require host lifecycle/ownership seams, not only a compatible MCP package. |
| [#618](https://github.com/deepseek-ai/deepseek-harness/discussions/618) | The official client's atomic list-changed swap bug is a different implementation; our dynamic direct-tool conflict/rollback path has not been proven equivalent. |
| [#2285](https://github.com/deepseek-ai/deepseek-harness/discussions/2285), [#3660](https://github.com/deepseek-ai/deepseek-harness/discussions/3660) | `pi-mcp-adapter` also follows `nextCursor` without a seen-cursor/page/catalog budget; it needs the same defensive capability before promotion here. |
| [#3489](https://github.com/deepseek-ai/deepseek-harness/discussions/3489) | Package recovery covers spec 404 and narrowly known `-32000 Server not initialized`, not the reported `-32001 Unknown or expired MCP session`. |
| [#3821](https://github.com/deepseek-ai/deepseek-harness/discussions/3821) | Standard MCP roots support is explicitly not implemented upstream in the package. |
| [#3905](https://github.com/deepseek-ai/deepseek-harness/discussions/3905) | MCP `readOnlyHint` is not yet projected into DSH `isConcurrencySafe`; read tools cannot be advertised as safely parallel through this route. |
| [#3998](https://github.com/deepseek-ai/deepseek-harness/discussions/3998) | Image bytes survive as DSH attachments, but generic `structuredContent.ui_url` presentation and a universal MCP result card are not fully implemented/proven. |

## deepseek-ai/deepseek-harness #3813 (English)

There is now an installable ecosystem path for this without maintaining a
local OAuth forwarding bridge. `pi2dsh` runs the unmodified
`pi-mcp-adapter` package as a DSH plugin: the package continues to own MCP
transport, OAuth, cache, and refresh behavior, while pi2dsh maps its public
Host ABI onto DSH commands, user questions, tools, and the native model loop.

Installation still uses only the official DSH plugin workflow:

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-mcp-adapter
```

After declaring the remote server in the standard `.mcp.json` format (for
Atlassian, `https://mcp.atlassian.com/v1/mcp/authv2` with `auth: "oauth"`),
restart the profile and run this in either dsh-TUI or Web:

```text
/mcp-auth atlassian
```

The acceptance run used the real Atlassian service, not a mock: authorization
server discovery, Dynamic Client Registration, PKCE, the browser localhost
callback, secure credential persistence, MCP reconnect, and discovery of 26
tools all completed. DeepSeek then called the read-only
`atlassian_atlassianUserInfo` tool from both DSH Web and dsh-TUI; the durable
DSH session log contains a non-error `tool/result`. On a local machine the
callback completes automatically and withdraws the fallback paste prompt;
manual URL paste is only needed for SSH/cross-machine browsers that cannot
reach the callback listener. `/pi-mcp logout atlassian` removes the stored
credential.

This is an immediately usable ecosystem compatibility route; it does not claim
that the official `dsh-mcp-client` implementation has been changed. A future
first-party OAuth path can replace it cleanly.

- https://github.com/weijiafu14/pi2dsh
- https://github.com/weijiafu14/pi2dsh/tree/main/examples/tui-mcp
