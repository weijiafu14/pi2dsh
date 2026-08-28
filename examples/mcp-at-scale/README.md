# MCP at scale: 50 tools, one proxy, a real timeout budget

A server with many tools is the shape that breaks naive MCP clients: every
tool schema lands in the model's context on every turn, and one hung call can
wedge the session. This example runs the published `pi-mcp-adapter` package
against a **real** stdio MCP server with 51 tools (built on the official
`@modelcontextprotocol/sdk` — see [`server/many-tools.mjs`](server/many-tools.mjs))
and shows three properties:

1. **The tool surface stays bounded.** DSH's registry receives the adapter's
   two meta-tools (`mcp`, `mcpScript`) — not 51 entries. The 50 demo tools are
   reached through lazy discovery.
2. **Discovery works at scale.** The model lists the server's tools through
   the `mcp` proxy, finds `tool_037`, calls it, and reports a marker string
   that exists nowhere except in that tool's live response.
3. **The timeout budget is real.** `slow_task` takes ~2 minutes; calling it
   through `mcpScript` with `timeoutMs: 5000` produces a structured failure in
   seconds, and the session — and the server — keep working afterwards.

## Install

```sh
dsh plugin add pi2dsh
dsh plugin add pi-mcp-adapter
```

Restart DSH after adding plugins.

## Run it

From this directory (`.mcp.json` here declares the server; the adapter reads
the project-local MCP config from the session's working directory):

```sh
cd server && npm install && cd ..
```

Then start DSH **in this directory** and try the two prompts:

```text
Use the mcp tool to list the tools of the many-tools server, find the one
that returns the launch marker, call it, and report the marker verbatim.
Use only the mcp tool.
```

Expected: the model discovers `tool_037` and answers with
`LAUNCH-MARKER-7741-ZEBRA` — a string that only exists in the tool's live
response, never in any file.

```text
Use the mcpScript tool with timeoutMs 5000 to call the slow_task tool of the
many-tools server and tell me exactly what happened. Then use the mcp tool
to call tool_001 and report its reply. Use only the mcp and mcpScript tools.
```

Expected: the slow call fails fast with a timeout after ~5 s (not after the
tool's real ~120 s), and the follow-up `tool_001` call still answers —
neither the session nor the server was wedged.

## What this is (and is not)

The adapter owns MCP transport, caching, discovery and the timeout budget;
pi2dsh only maps the package's public Pi surfaces onto DSH (its tools into
DSH's tool registry, its commands into the command palette). The server here
is deliberately boring — 50 deterministic tools and one slow one — because
the point is the client behavior, not the server.

For the adapter's interactive manager UI (`/pi-mcp`), OAuth-protected remote
servers and host-config adoption, see [`../tui-mcp/`](../tui-mcp/).
