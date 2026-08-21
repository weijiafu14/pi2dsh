# Advanced MCP in dsh-TUI, from the Pi ecosystem

dsh-TUI already has a native `/mcp` command for DSH's official MCP client.
This example keeps it intact and adds the published `pi-mcp-adapter` package
for the capabilities that package owns: a full-screen server manager, lazy
tool discovery, one proxy tool instead of flooding model context, MCP-only
JavaScript orchestration, OAuth, resources and prompts.

DSH Core stays on the unmodified rc.8 release. dsh-TUI supplies the awaited
`tui/agent-setup` extension point from its Agent factory callback; until that
small change ships upstream, use the source branch shown below. The
`pi-mcp-adapter` package itself remains unmodified and still owns MCP transport,
cache, authentication and behavior. pi2dsh only maps its public Pi host
surfaces onto DSH:

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

If your dsh-TUI already contains `tui/agent-setup`, add the engine and the Pi
package:

```sh
dsh plugin --profile dsh-tui add pi2dsh
dsh plugin --profile dsh-tui add pi-mcp-adapter
```

If you are creating the profile from scratch, install dsh-TUI too:

```sh
dsh plugin --profile dsh-tui add github:weijiafu14/dsh-TUI#codex/agent-setup-contributors
dsh plugin --profile dsh-tui add pi2dsh
dsh plugin --profile dsh-tui add pi-mcp-adapter
```

Once an upstream dsh-TUI release contains `tui/agent-setup`, replace the first
line with the normal `@deepseek-harness-tui/dsh-tui` package.

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

## What was verified

The acceptance run uses a clean profile, stock DSH rc.8, the source-built
dsh-TUI branch above and the published Pi package. It does not stop at an echo
smoke test. It asserts all of the following:

- dsh-TUI's native `/mcp` is still present and is not replaced;
- Agent A and the Agent created by `/new` each mount an independent package
  runtime before publication; both show the real server as `23/23`;
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
