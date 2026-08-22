# Advanced MCP in dsh-TUI, from the Pi ecosystem

dsh-TUI already has a native `/mcp` command for DSH's official MCP client.
This example keeps it intact and adds the published `pi-mcp-adapter` package
for the capabilities that package owns: a full-screen server manager, lazy
tool discovery, one proxy tool instead of flooding model context, MCP-only
JavaScript orchestration, OAuth, resources and prompts.

Everything is stock: the unmodified DSH rc.8 release, the unmodified
`@deepseek-harness-tui/dsh-tui` from npm, and the unmodified `pi-mcp-adapter`
package, which still owns MCP transport, cache, authentication and behavior.
The engine gives every Agent its own Pi runtime through DSH's official Agent
lifecycle events and awaited assembly/tool waterfalls — no surface needs to
expose any extension point for it. pi2dsh only maps the package's public Pi
host surfaces onto DSH:

```text
pi-mcp-adapter               pi2dsh                    dsh-TUI / DSH
──────────────────           ───────────────────       ─────────────────────
ctx.ui.custom()       ───▶   terminal scene bridge ─▶  tuiScenes full screen
ctx.ui.setStatus()    ───▶   status bridge         ─▶  tuiStatus footer
registerCommand(mcp)  ───▶   reserved-name map     ─▶  /pi-mcp
registerTool(mcp*)    ───▶   normal tool bridge    ─▶  DSH ToolRuntime
MCP transport/cache   ───────────────────────────────▶  remains in the plugin
```

## Install

```sh
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui   # skip if the profile exists
dsh plugin --profile dsh-tui add pi2dsh
dsh plugin --profile dsh-tui add pi-mcp-adapter
```

Restart DSH after adding plugins.

## Configure and use it

Inside dsh-TUI, run:

```text
/pi-mcp setup
```

The setup flow can adopt MCP definitions from supported host configs into the
adapter's own standard `mcp.json`. Then use:

```text
/pi-mcp
```

to open the interactive server manager. Its footer documents the keys for
enable/disable, reconnect and OAuth. The model receives the adapter's `mcp`
and `mcpScript` tools through DSH's normal tool registry.

dsh-TUI's existing command remains separate:

```text
/mcp       # native DSH MCP-client status
/pi-mcp    # the installed Pi adapter's manager
```

You do not need `pi-btw` for this example; dsh-TUI already implements its own
side-question command.

## OAuth-protected remote MCP servers (TUI and Web)

The same package works in the Web profile. Install it through the same DSH
plugin workflow:

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-mcp-adapter
```

It reads the standard project `.mcp.json` format. For Atlassian Remote MCP, a
minimal entry is:

```json
{
  "mcpServers": {
    "atlassian": {
      "url": "https://mcp.atlassian.com/v1/mcp/authv2",
      "auth": "oauth"
    }
  }
}
```

Restart the selected DSH profile, then run this native DSH command in dsh-TUI
or Web:

```text
/mcp-auth atlassian
```

The authorization page opens in the browser. On a local machine the localhost
PKCE callback completes automatically and removes the fallback paste question;
manual callback-URL paste is only for a remote/cross-machine browser that
cannot reach the DSH process. Credentials stay in the operating-system secure
store, are URL-bound, refresh through the package's OAuth implementation, and
can be removed with:

```text
/pi-mcp logout atlassian
```

## What was verified

The acceptance run uses a clean profile, the stock npm DSH rc.8 CLI, the stock
npm dsh-TUI and the published Pi package — no forks, no source builds. It does
not stop at an echo smoke test. It asserts all of the following:

- dsh-TUI's native `/mcp` is still present and is not replaced;
- Agent A and the Agent created by `/new` each mount an independent package
  runtime; both show the real server fully connected, and the assertions read
  the session log's tool results, never the screen text;
- on Agent B, a real DeepSeek turn calls `everything_echo` and receives the
  exact marker from the MCP process;
- `/pi-mcp` opens the real adapter's manager and renders its configured server;
- the real `pi-mcp-adapter` connects to official
  `@modelcontextprotocol/server-everything@2026.8.18` processes over stdio,
  Streamable HTTP and legacy SSE;
- proxy discovery and calls, seven dynamically registered direct tools,
  `mcpScript`, resources, prompts, structured content and image attachments all
  cross DSH's real runtimes;
- an MCP App resource starts the adapter's authenticated AppBridge host and
  opens through DSH subprocess; both host shell and iframe HTML are fetched;
- approval and form-mode elicitation use DSH questions, while reverse MCP
  sampling calls DSH `LlmRuntime` with the current model and credential;
- cancellation, command reconnect and full session shutdown/restart work;
- an immediate command waits for asynchronous `session_start` initialization,
  and `ctx.reload()` starts the newly loaded extension instance exactly once.

The precise matrix, upstream 1159-test baseline and known differences are in
[`docs/mcp-compatibility.md`](../../docs/mcp-compatibility.md).

Maintainer reproduction after `pnpm build`:

```sh
PI2DSH_MCP_ADAPTER_ROOT=/absolute/path/to/node_modules/pi-mcp-adapter \
  node scripts/verify-tui-mcp-tool-e2e.mjs
```

The script exits non-zero unless the complete host-influenced matrix passes.

The real-terminal run — the stock npm CLI, the stock npm dsh-TUI, two agents,
real DeepSeek turns, session-log assertions — is:

```sh
node scripts/verify-tui-singlepath-e2e.mjs
```

It records its verdict (with the exact installed versions and the proof that
no fork was involved) in `community/tui-singlepath-e2e.json`, and reports
`skipped` with the reason when no DeepSeek credential is available.
