# Pi MCP and Subagents in dsh-pi-tui

This is the stock four-package combination verified on a real DSH model loop:

```text
@xmoon76/dsh-pi-tui + pi2dsh + pi-mcp-adapter + @tintinweb/pi-subagents
```

## Install

```sh
dsh plugin --profile pi-tui add @xmoon76/dsh-pi-tui
dsh plugin --profile pi-tui add pi2dsh pi-mcp-adapter @tintinweb/pi-subagents
dsh --profile pi-tui
```

No source patch, fork or bridge-specific MCP/Subagent configuration is used.
`@xmoon76/dsh-pi-tui` is optional: installing pi2dsh without it keeps the
existing Web, dsh-TUI and headless behavior.

## What to try

```text
/login       # dsh-pi-tui's native login screen, including projected Pi OAuth flows
/pi-mcp      # the original pi-mcp-adapter server manager
/agents      # the original pi-subagents manager/selection flow
```

Inside `/login`, filtering `openai codex` should show **OpenAI Codex — sign in**.
The Host-native `/login` wins; pi2dsh does not register a duplicate command.

Inside `/pi-mcp`, run the plugin's setup flow or point its standard `mcp.json`
at your servers. The verification run used the official MCP everything server
with direct tools and saw **23/23** connected.

## Architecture boundary

```text
Pi package
  ├─ tools / commands / child sessions ──▶ DSH authority
  └─ ctx.ui.custom
       └─ Host-owned Pi component
            └─ serializable frame/input/lifecycle relay
                 └─ public piTuiExtensions mountComponent
```

The adapter is selected by the public `piTuiExtensions` service and
`unstable.surface.handle` capability. There are no branches for
`pi-mcp-adapter` or `pi-subagents`, no private TUI imports, and no second
model/tool/session store. The relay carries `sessionId`, width, rendered lines,
raw input, revision and close events; it never sends callback or component
objects across a future Server/Client boundary.

Verified package versions on 2026-08-25:

- `@deepseek-ai/dsh@0.1.1-rc.2`
- `@xmoon76/dsh-pi-tui@0.3.4`
- `pi-mcp-adapter@2.27.0`
- `@tintinweb/pi-subagents@0.18.0`

The real run opened native `/login`, rendered the MCP manager, executed
`everything_echo`, opened `/agents`, and completed a real `Agent` tool call.
The reusable public-surface contracts are in
[`tests/pi-tui-extension-surface.spec.ts`](../../tests/pi-tui-extension-surface.spec.ts).

Reproduce the complete clean-profile proof with a real DeepSeek credential:

```sh
pnpm test:pi-tui
```

The script installs every published package into a fresh `DSH_HOME`, drives
the TUI through tmux, checks the boot log for duplicate commands, and requires
successful native `tool/result` records for both MCP and the child agent. Its
credential-free result is written to `community/pi-tui-ecosystem-e2e.json`, a
durable path that the repository's pack verification does not clear.
