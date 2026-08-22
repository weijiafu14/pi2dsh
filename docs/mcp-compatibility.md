# `pi-mcp-adapter` compatibility evidence

This document is the acceptance boundary for running the published
`pi-mcp-adapter@2.26.1` package through pi2dsh in DSH and dsh-TUI. It separates
behavior that can be changed by the host bridge from behavior owned entirely
by the MCP package. A single echo call is not considered acceptance.

## Result

The complete host-influenced surface is verified end to end. The real package
is loaded unmodified, its manager is rendered through dsh-TUI, and its MCP
operations cross the real DSH command, tool, LLM, question and attachment
runtimes. The test uses the official
`@modelcontextprotocol/server-everything@2026.8.18` package over real child
processes and local network transports.

The Agent-lifecycle acceptance additionally runs on the fully stock stack —
the npm `@deepseek-ai/dsh@0.1.0-rc.8` CLI and the npm
`@deepseek-harness-tui/dsh-tui`, no forks anywhere: startup Agent A and `/new`
Agent B each receive their own Pi runtime through DSH's official
`agent/created` lifecycle event and awaited assembly/tool waterfalls, and a
real DeepSeek tool turn runs on each agent with the proof read from the
session log's tool results
([`scripts/verify-tui-singlepath-e2e.mjs`](../scripts/verify-tui-singlepath-e2e.mjs),
verdict in `community/tui-singlepath-e2e.json`). The run asserts the installed
`dsh-agent` is the stock rc.8 with no `agent/setup` seam and the installed TUI
advertises no setup extension point.

The remaining protocol-internal behavior is verified by the upstream package's
version-matched suites. This split is deliberate: pi2dsh must prove every seam
it can affect, while it must not copy or pretend to re-test the package's own
transport, OAuth and cache implementation with mocks.

## Host-influenced end-to-end matrix

The executable evidence is
[`scripts/verify-tui-mcp-tool-e2e.mjs`](../scripts/verify-tui-mcp-tool-e2e.mjs).
The same verifier is run after installing a packed pi2dsh tarball, dsh-TUI and
`pi-mcp-adapter` into a clean DSH profile by
[`scripts/verify-examples-e2e.mjs`](../scripts/verify-examples-e2e.mjs).

| Surface | End-to-end assertion |
|---|---|
| Terminal UI | `/pi-mcp` opens the real full-screen manager through dsh-TUI's public `tuiScenes` service; ANSI output, input and close lifecycle cross the package-agnostic custom-UI bridge |
| Command ownership | dsh-TUI's native `/mcp` remains present; the Pi package command is exposed as `/pi-mcp` |
| Lifecycle | An immediate command waits for asynchronous `session_start`; reconnect works; dispose/restart creates one new package session; final shutdown reaps the stdio child |
| Agent ownership | Each root Agent mounts its own package runtime from the official `agent/created` event, gated by the awaited `system-prompt/assemble` and `tools/pre-execute` waterfalls; on stock npm dsh-TUI, startup Agent A and `/new` Agent B each list the everything server fully connected and complete a real `everything_echo` model tool call, proven from the session logs |
| Transports | Real stdio, Streamable HTTP and legacy SSE server processes connect and answer calls |
| Discovery | Proxy `search`, `describe` and server `instructions` return live metadata |
| Tool projection | The proxy tool and seven hot-loaded direct tools register in DSH `ToolRuntime` and execute there |
| Orchestration | `mcpScript` performs multiple real MCP calls and preserves their results |
| Approval | A tool approval traverses DSH `userQuestions`; the session decision is reused by the direct-tool path |
| Content | Structured content survives normalization; an MCP image becomes a real DSH attachment whose PNG bytes are read back; a resource tool returns its document |
| MCP Apps | A real MCP server advertises a `ui://` app resource; the package starts its token-scoped AppBridge host, opens it through Pi `exec` → DSH subprocess, and serves both the host shell and original iframe HTML |
| Prompts | MCP prompt metadata becomes a DSH slash command and sends the expanded prompt into the active DSH agent |
| Elicitation | A real form-mode elicitation request crosses the MCP wire and collects its answers through DSH questions |
| Sampling | A reverse MCP sampling request resolves the active model and credential, invokes real DSH `LlmRuntime`, and returns the model result to the server |
| Cancellation | Aborting the DSH tool call cancels a five-second MCP operation in under two seconds |

The clean-package evidence records these capability names in
[`community/examples-e2e.json`](../community/examples-e2e.json): manager,
discovery, proxy, direct tools, `mcpScript`, resources, prompts, images,
structured content, MCP Apps UI, approval, elicitation, sampling, cancellation, reconnect
and session restart.

## Package-internal upstream baseline

The exact upstream tag `v2.26.1` (`fafae21`) was tested from a clean checkout
after building its required interactive-visualizer fixture:

| Upstream check | Result |
|---|---|
| TypeScript typecheck | passed |
| Vitest with one worker | 99 files, **1159/1159 passed** |
| OAuth suite | **137/137 passed** |
| MCP conformance suite | **26/26 scenarios passed** |
| Package dry-run | passed, 68 files |

The default parallel Vitest run finished at 1158/1159 on this macOS host. Its
only failure was the malformed-output helper termination timing test in
`request-headers-command.test.ts`; that complete file passed 15/15 when run
alone, and the full suite passed 1159/1159 with one worker. This is recorded as
a concurrency/process-cleanup timing flake, not hidden as a green parallel run.

Those upstream suites own the behavior that does not cross the Pi Host ABI:
OAuth storage, authorization-code and client-credentials flows, refresh and
dynamic registration; Unix sockets and legacy transport negotiation; metadata
and session-recovery caches; bearer and request-header commands; output guards
and spill files; output-schema validation; and protocol conformance. MCP Apps'
internal session/message/consent branches remain extensively unit-tested
upstream, while their user-visible resource, authenticated host and browser-open
path is also included in the DSH end-to-end matrix above.

## Upstream host-scenario checklist (standard acceptance step)

The upstream suite must NOT be ported wholesale: of its ~106 test files, ~98
test package-internal modules and the 26-scenario conformance run drives
`McpServerManager` directly — the host is not on the tested path, so running
them against pi2dsh proves nothing about the bridge (survey of v2.27.0
`dd380db`, 2026-08-22). The ~8 files that do construct a host stand-in assert
`vi.fn()` call counts, which cannot be pointed at a real host without
rewriting every assertion — and the surfaces they touch are already covered
by the end-to-end matrix above.

What IS kept, on every package version bump: **diff the scenario titles** of
the upstream host-facing tests (the files that build a `pi`/`ExtensionAPI`
stand-in) against the matrix above, and translate any scenario the matrix
does not cover into a pi2dsh contract test. This costs minutes, and it
surfaces exactly the cases upstream learned to guard against hosts whose
shape differs from stock Pi. The 2.27.0 diff produced two:

- **TypeBox surface fidelity** (upstream: "host TypeBox shim omits Unsafe",
  "internal markers leak into registered schemas") →
  `tests/upstream-host-scenarios.spec.ts`: the compat shim must supply the
  complete `Type` including `Unsafe`; normalized schemas are marker-free
  plain JSON; constraints outside DSH's enforced subset are dropped WITH an
  explicit warning, never silently.
- **ctx invalidated mid-connect** (upstream: "initializeMcp vs. a ctx
  invalidated mid-connect") → `tests/engine.spec.ts` ("a slow package
  operation outliving its disposed agent"): a late ctx use after agent
  disposal fails catchably, nothing escapes as an unhandled rejection, the
  handler received exactly one `session_start`, and a fresh agent still
  mounts and executes.

## Known differences from native Pi

These differences are explicit and do not block the standard `mcp.json` path:

- DSH cannot add Pi extension flags to its launcher. The adapter's optional
  `--mcp-config` flag therefore resolves only to its declared default through
  `registerFlag/getFlag`; use the adapter's standard `.mcp.json`, shared config
  files or Pi-owned `mcp.json` paths instead.
- DSH commands currently have no dynamic argument-completion seam, so the
  adapter's `getArgumentCompletions` suggestions are not shown. Command parsing
  and execution are preserved.
- Pi-specific tool renderers are not mounted. DSH owns tool presentation; text,
  structured data, resources and image attachments retain their functional
  content through DSH-native cards and attachments.

`pi-mcp-adapter@2.26.1` itself states that adapter-level roots support, standard
MCP logging presentation, and configuration/UI for protocol cache hints are
not implemented upstream. They are not pi2dsh regressions and are not claimed
here.

## Reproduce

After `pnpm build`, point the verifier at the installed upstream package:

```sh
PI2DSH_MCP_ADAPTER_ROOT=/absolute/path/to/node_modules/pi-mcp-adapter \
  node scripts/verify-tui-mcp-tool-e2e.mjs
```

To reproduce the user installation shape, pack pi2dsh and run only this clean
profile scenario:

```sh
ONLY=tui-mcp PI2DSH_ENGINE_SPEC=file:/absolute/path/to/pi2dsh.tgz \
  node scripts/verify-examples-e2e.mjs
```
