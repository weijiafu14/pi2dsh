# pi2dsh

**English** | [中文](README.zh.md)

**Run the Pi ecosystem's plugins on DeepSeek Harness, unmodified.**

```sh
dsh plugin add pi2dsh          # once
dsh plugin add <any-pi-plugin> # then any Pi plugin, straight from npm
```

## Why this exists

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is built
on ideas worth betting on — a durable, reconstructable session log, a clean
service composition, an agent loop you can actually reason about. What it does
not have yet is a large plugin ecosystem: it is early, and the plugins people
want on day one — web search, memory, code navigation, subagents, vision — are
mostly not written for it yet.

[Pi](https://pi.dev/) has that ecosystem already, and it is mature: hundreds
of published packages, many with real users.

pi2dsh is one compatibility layer that implements Pi's public extension ABI on
top of DSH's native services, so a Pi package runs on DSH **as published** —
no fork, no patch, no per-package adapter. You install a Pi plugin the same
way you install anything else in DSH, and it works.

At the same time, pi2dsh is an ongoing, full-surface, real-world test of DSH's
architecture. Instead of patching individual plugins, it asks whether the
models, tools, sessions, interaction, resources and client capabilities that Pi
plugins rely on can preserve their logic and lifecycle using only DSH's public
services and extension seams. If they can, that is strong evidence that DSH's
architectural goals for building agents and an agent-plugin ecosystem have been
achieved, at least along this dimension. Wherever the bridge must bypass,
degrade or cannot express a capability, it pinpoints an architectural gap that
remains.

## Install

One engine, then whatever plugins you want:

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-mcp-adapter
```

Then **restart `dsh`** — plugins mount at startup.

> **A profile needs a surface bundle.** DSH's built-in templates are `web` and
> `headless`. A custom profile is valid when its product installs a surface —
> for example `@deepseek-harness-tui/dsh-tui` in the `dsh-tui` profile. A bare
> arbitrary profile has no surface and can start with nothing to drive it, so
> add the intended surface to `dsh.profile.bundles` first.

That is the whole model. There is no conversion step, no generated bundle, no
build. The engine discovers the Pi packages in your profile (every one is
something you explicitly added) and mounts them through a single bridge
instance: one model directory, one login, one credential store, one upgrade
unit.

Day-to-day:

| Task | Command |
|---|---|
| Add a plugin | `dsh plugin add <pkg>` (then restart dsh) |
| Remove a plugin | `dsh plugin remove <pkg>` — remove plugins before removing the engine |
| Upgrade a plugin | `dsh plugin add <pkg>@latest` — the engine is untouched |
| Upgrade the engine | `dsh plugin add pi2dsh@latest` — your plugins are untouched |
| Check a plugin before upgrading | `npx pi2dsh inspect <pkg>@<version>` |

Two installer messages worth knowing:

- **`ERR_PNPM_IGNORED_BUILDS`** — pnpm blocks dependency build scripts by
  default. Run `pnpm approve-builds` inside
  `$DSH_HOME/profiles/web`, or set the listed packages to `true`
  under `allowBuilds` in that profile's `pnpm-workspace.yaml`. Then re-run the
  add. (This is your call to make, so the bridge does not work around it.)
- **An add silently installs an older version** right after a release —
  pnpm's `minimumReleaseAge` skips versions published very recently. Pin it:
  `dsh plugin add pi2dsh@<version>`.

Requires Node.js 22.19+ and DeepSeek Harness.

### Engine configuration

The engine reads one `config` block from its plugin row. Today it takes a
single opt-in:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: pi2dsh
  config:
    serveNativeSubagents: true
```

`serveNativeSubagents` (default: **off**) serves DSH-native subagents with
the profile's Pi packages. With it on, a child agent DSH spawns through its
own subagent delegation (one whose session carries the subagent origin)
receives every discovered Pi package mounted on its own agent scope — the
package's tools, commands and prompt sections appear for that child only,
and every contribution unwinds when the child ends. With it off, such
children run as plain DSH agents, exactly as before.

The mount is guaranteed for the child's **first** turn: prompt assembly and
tool execution wait for it, so even a child that runs a single turn sees the
full tool set. Each child is served exactly once, whichever path DSH created
it through — children the agent registry reports as runtime roots are served
by the engine's root mount path, and the subagent path serves the rest; the
two never overlap. Pi subagent-bridge children are unaffected either way:
they already receive the creator package's own per-spawn loader mount, and
the bridge recognizes them by the `pi2dsh-sub-` session-id prefix (stable
across a persisted resume), so no child is ever mounted twice.

## Walkthrough: advanced MCP in your terminal

The clearest example of what the bridge buys you. dsh-TUI ships a native
`/mcp` command for DSH's official MCP client — it works, and it stays
untouched. The Pi ecosystem has a much richer MCP power tool: a full-screen
server manager, lazy tool discovery, one proxy tool instead of flooding the
model context with dozens of tools, JavaScript orchestration of multiple MCP
calls, OAuth logins, resources and prompts. With the bridge, that package runs
unmodified.

### 1. Install

```sh
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui   # skip if the profile exists
dsh plugin --profile dsh-tui add pi2dsh
dsh plugin --profile dsh-tui add pi-mcp-adapter
```

Or use the same unmodified Pi packages in dsh-pi-tui:

```sh
dsh plugin --profile pi-tui add @xmoon76/dsh-pi-tui
dsh plugin --profile pi-tui add pi2dsh pi-mcp-adapter @tintinweb/pi-subagents
dsh --profile pi-tui
```

That composition keeps dsh-pi-tui's native `/login` and projects Pi OAuth
flows into it, mounts the original MCP manager through the public
`piTuiExtensions` surface, and exposes the original Pi subagent flow at
`/agents`. See [`examples/pi-tui-ecosystem`](examples/pi-tui-ecosystem/).

Then restart `dsh` — plugins mount at startup.

### 2. Configure your MCP servers

Inside dsh-TUI, run:

```text
/pi-mcp setup
```

The setup flow can adopt MCP server definitions from host configs you already
have into the adapter's own standard `mcp.json`. No bridge-specific
configuration exists — everything you touch is the package's own surface.

### 3. Use it

```text
/pi-mcp
```

opens the full-screen interactive server manager — its footer documents the
keys for enable/disable, reconnect and OAuth login. The model receives the
adapter's `mcp` and `mcpScript` tools through DSH's normal tool registry, and
each agent (`/new` included) gets its own fully connected instance.

dsh-TUI's native command remains separate, and both stay available:

```text
/mcp       # native DSH MCP-client status
/pi-mcp    # the installed Pi adapter's manager
```

What is verified behind this walkthrough: 16 host-influenced capabilities
end to end on the stock npm stack — three real transports, discovery, proxy
and hot-loaded direct tools, `mcpScript`, resources, prompts, images becoming
real DSH attachments, MCP Apps, tool approval through DSH questions,
elicitation, sampling against the real DSH model runtime, cancellation and
session restart. The full evidence matrix:
[`docs/mcp-compatibility.md`](docs/mcp-compatibility.md).

Full runnable version: [`examples/tui-mcp`](examples/tui-mcp/).

## What actually works today

Two levels, and they are not the same claim.

### Level 1 — verified end to end, with a runnable example

Someone sat down, used the plugin's real feature on a real DSH loop, and saw
it work. **This is the list to trust.**

| Plugin | What was exercised | Where | Example |
|---|---|---|---|
| [`@kassing/pi-vision`](https://www.npmjs.com/package/@kassing/pi-vision) | Image analysis delegated to a vision model; image-admission companion route; analysis injected into a text-only model's turn | CLI + web | [`vision-bridge`](examples/vision-bridge/) |
| [`@crazygit/pi-codex-image-gen`](https://www.npmjs.com/package/@crazygit/pi-codex-image-gen) | ChatGPT/Codex OAuth → `gpt-image-2` generation; local reference-image upload through DSH approval; image edit; native attachment storage and inline Web rendering | CLI + web | [`codex-image-gen`](examples/codex-image-gen/) |
| [`pi-btw`](https://www.npmjs.com/package/pi-btw) | `/btw <question>` as a real child session in DSH's subagent UI; `/btw-inject`; `/btw --save`; main thread stays clean | CLI + web | [`side-conversation`](examples/side-conversation/) |
| [`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) | A terminal status line — model, thinking level, project, context usage — drawn into DSH's widget dock, colour included | web | [`presentation-surfaces`](examples/presentation-surfaces/) |
| [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | Original full-screen manager; stdio/Streamable HTTP/SSE; discovery, direct/proxy/scripted calls, resources, prompts, images, structured content, MCP Apps, approval, elicitation, sampling, cancellation and restart through DSH runtimes | dsh-TUI + dsh-pi-tui | [`tui-mcp`](examples/tui-mcp/) · [`pi-tui-ecosystem`](examples/pi-tui-ecosystem/) · [evidence matrix](docs/mcp-compatibility.md) |
| [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents) | The model delegates to autonomous subagents: spawn (with real host-native tools), background + completion notify, mid-run steer, wait-for-result, resume with memory, stop that stays stopped, interactive manager, and cross-restart reopen by archive identity — every child a native DSH session | CLI + dsh-TUI + dsh-pi-tui | [`subagents`](examples/subagents/) · [`pi-tui-ecosystem`](examples/pi-tui-ecosystem/) · [acceptance report](community/subagents-acceptance-report.md) |
| [`pi-provider-alibaba`](https://www.npmjs.com/package/pi-provider-alibaba) | Alibaba Token Plan (CN) with its plan-specific key: live catalog, cold-start dynamic model, complete tool loop and restart. The package also declares Coding/API routes, but each requires its own non-interchangeable credential | CLI + web | [`alibaba-token-plan`](examples/alibaba-token-plan/) |
| [`pi-vision-tool`](https://www.npmjs.com/package/pi-vision-tool) | Tool registration through a JSON-Schema shape DSH had to convert (`anyOf` → `oneOf`) | CLI + web | — |
| [`pi-approval-guardian`](https://www.npmjs.com/package/pi-approval-guardian) | Every tool call reviewed by a second model before execution; allow and deny both observed | CLI (bare env) | — |
| [`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory) | Cross-session memory: written in one process, read back in a second, fresh one | CLI | — |

Examples for the last three are still to be written; per this project's own
rule they get re-verified from scratch before an example lands, so the table
says plainly which have one today.

### Level 2 — mounts and its surface answers a probe

The Pi catalog's **top 50 packages by monthly downloads**, each mounted in a
real DSH runtime and then called through a black-box probe. Status as of
2026-08-14; per-package machine-readable evidence in
[`community/`](community/).

**47 of 50 exercised successfully · 1 with no probeable surface · 2 pending a
re-run.**

**What this level does not tell you:** that the plugin's actual feature works
the way you would use it. A probe calls a registered surface with synthetic
arguments; a user runs a workflow. `pi-btw` is the cautionary example — it
graded "working" here for weeks while `/btw <question>` failed on a real
session, because the feature needed two ABI gaps closed (Pi's settable
`AgentState.messages`, and an input descriptor on bridged commands) that no
probe exercised. Both are fixed in 0.11.0, and both were general fixes that
unlock every plugin doing the same thing.

So read the table below as **"the bridge covers what this plugin touches"**,
not as "this plugin is known-good". When you try one, a report either way is
useful.

| Area | Packages |
|---|---|
| **MCP** | `pi-mcp-adapter` · `pi-mcp-extension` |
| **Web search & fetch** | `pi-web-access` · `pi-deepseek-search` · `pi-web-search` · `@ollama/pi-web-search` · `@juicesharp/rpiv-web-tools` |
| **Code navigation & editing** | `pi-lens` (ast-grep) · `@narumitw/pi-lsp` · `pi-readseek` · `@ff-labs/pi-fff` · `pi-landstrip` · `pi-hashline-edit-pro`¹ |
| **Subagents & background work** | `@gotgenes/pi-subagents` · `pi-background-tasks`² · `@mjasnikovs/pi-task` |
| **Memory** | `pi-hermes-memory` · `pi-goosedump` |
| **Planning & goals** | `@narumitw/pi-goal` · `pi-goal-list-loop-audit` · `@narumitw/pi-plan-mode` · `@juicesharp/rpiv-todo` |
| **Asking you / approvals** | `@juicesharp/rpiv-ask-user-question` · `pi-ask-user` · `@gotgenes/pi-permission-system` · `@juicesharp/rpiv-advisor` |
| **Side conversations** | `pi-btw` · `@narumitw/pi-btw` |
| **Models & providers** | `pi-provider-litellm` · `pi-llama-cpp` · `pi-prompt-template-model` · `@vigolium/piolium` |
| **Images** | `@kassing/pi-vision` (see above) · `@amaster.ai/pi-image-gen` |
| **External integrations** | `@llblab/pi-telegram` · `pi-cursor-sdk`² · `@howaboua/pi-codex-conversion` · `pi-agent-browser-native`² · `pi-harness-runtime` |
| **Prompting & workflow** | `pi-simplify` · `pi-fabric`² · `mitsupi` · `pi-cc-extensions` · `pi-rtk-optimizer` · `pi-interview`¹ |
| **Terminal decoration** | `pi-powerline-footer` · `@narumitw/pi-statusline` · `pi-zentui` |
| **Voice** | `@juicesharp/rpiv-voice` |
| **Usage reporting** | `@alexanderfortin/pi-deepseek-usage`³ |

¹ Mounts; the exercise run is pending a re-run (a harness-side failure, not a
package or bridge gap). ² Ran its own business logic end to end and rejected
the synthetic probe arguments — working, correctly validating.
³ A pure event-hook package: all subscriptions attach, but every handler is
gated on a live DeepSeek billing session, so a black-box probe has nothing
safely callable to assert.

Packages outside the top 50 are not a separate case — the bridge has no
per-package code. If one hits an ABI gap, fixing that gap unlocks every
package that shares it.

Level 1 grows by working through Level 2 one plugin at a time. The full
verification ladder, with what each rung does and does not prove:
[support matrix](docs/posting-kit/support-matrix.md).

## How it works

Three layers, and nothing crosses them:

```
┌─ Pi plugin ─────────────────────────────────────────────────┐
│ unmodified npm package. It sees a complete Pi host: the     │
│ three Pi runtime imports, registerX, ctx.*, 33 lifecycle    │
│ events. It never learns DSH exists.                         │
└──────────────────────────┬──────────────────────────────────┘
                           │  Pi's public ABI
┌──────────────────────────▼──────────────────────────────────┐
│ pi2dsh — the translator, and the only place that knows both │
│ vocabularies. Registry projection, event bridge, session &  │
│ subagent bridge, credentials, vendored Pi logic.            │
└──────────────────────────┬──────────────────────────────────┘
                           │  ordinary DSH plugin + llm adapter
┌──────────────────────────▼──────────────────────────────────┐
│ DeepSeek Harness. Sees a normal plugin. Never learns Pi     │
│ exists.                                                     │
└─────────────────────────────────────────────────────────────┘
```

DSH is two halves, and so is the bridge. The column above is the server; the
browser shell has its own plugin surface, and a Pi capability that is a SHAPE
rather than a behaviour lands there:

```
┌──────────── DSH server (cordis) ────────────┐  ┌──────── DSH browser shell ────────┐
│ services · waterfalls · durable events      │  │ dsh.client + exports "./client"   │
│                                             │  │ slot registry (ui-slots)          │
│ pi2dsh engine                               │  │   shell.overlay  ← panel, pills   │
│   tools · commands · models · sessions      │  │   session.header.utilities ← hdr  │
│   subagent bridge ─────────────┐            │  │   input.dock ← widgets            │
│   browser-state registry       │            │  │   composer.dock ← working/footer  │
│     GET /pi2dsh/browser-state ─┼── own route┼──┼─▶ all four seats, one poller      │
└────────────────────────────────┴────────────┘  └───────────────────────────────────┘
```

The browser half's data rides **this package's own route**, not DSH's typed
Remote system: that one is a first-party, code-generated contract, and an
out-of-tree plugin talking to its own UI should carry its own channel. One
payload per session serves every seat — the side-conversation panel, plus the
Pi presentation surfaces (status, widget, header, footer, title and the
working/thinking chrome), which are drawn in the host's own slot seats rather
than re-implemented. Two host rules make the browser half load at all — the
package must export `./package.json` (the host resolves the manifest by
subpath), and the `./client` bundle is a closure-factory artifact, not plain
ESM.

The rules that keep it honest:

- **Never a second bridge-owned implementation of something DSH already has.**
  Tools go to DSH's tool registry, models to DSH's llm configuration,
  configuration-only MCP servers to `dsh-mcp-client`, skills to
  `dsh-skill-filesystem`, and questions to DSH's user questions. An explicitly
  installed Pi capability package can retain behavior that it owns; the bridge
  maps its public surfaces and does not copy its transport.
- **No bridge-private user world.** Normal configuration remains DSH-shaped:
  DSH settings, commands and credentials. When an installed capability package
  deliberately exposes its own manager, that surface remains recognizable and
  is namespaced on conflict — dsh-TUI keeps `/mcp`, while the Pi manager is
  `/pi-mcp`.
- **No per-package special cases.** The core contains no
  `if (packageName === …)`. One ABI gap fixed unlocks every package that hits
  it.
- **Never fake success.** A capability with no safe mapping is reported —
  once, per plugin, in plain language — instead of silently returning
  something invented. If a plugin needs one during startup, it is marked
  unusable with a removal hint rather than half-working.
- **Verified, not asserted.** Every capability has a public-API contract test,
  and ships only after running end to end on every DSH surface it claims.

## What this is teaching us about DSH

pi2dsh is also an executable stress test of DSH's plugin architecture. Pi gives
that test a useful workload: a large, already-used public plugin ABI rather than
a set of examples invented to fit the host.

The result so far is specific, not a thumbs-up/thumbs-down verdict:

- DSH's public seams successfully carry whole capabilities: tools, commands,
  model adapters, user questions, native child sessions and browser slots.
- The pressure points appear when an out-of-repo plugin needs to extend an
  existing capability *from the inside*: add a durable session-event type,
  intercept the real provider request/response, control compaction before it
  happens, or participate in trust before project resources load.
- A working pi2dsh sidecar or alternate adapter is useful product behaviour,
  but it is **not** counted as proof that the native DSH seam is complete.

For example, a `pi-btw` answer is a real DSH child session — visible, resumable
and continuable by the host. Pi custom entries are different: they still need a
pi2dsh sidecar because an out-of-repo plugin cannot safely add a new event type
to DSH's durable log. Likewise, a transport-owning Pi provider can register a
native DSH route. Since DSH rc.8, a catalog-only provider also has a faithful
official path: pi2dsh translates its endpoint, modalities, reasoning levels and
the protocol-specific compat fields DSH offers into an `llm-pi-ai` profile, and
DSH owns the request.

The project follows one **[Pi → DSH architecture mapping standard](docs/architecture-mapping-standard.md)**.
It is a reasoning method, not another runtime layer: concrete Pi interface →
Pi capability contract → DSH carrying mechanism → public seam → real plugin
run → five-grade result. The evolving branches live in the handwritten
**[architecture model](docs/architecture-mapping-matrix.md)**, real runs in
**[per-plugin validation records](docs/plugin-validation-matrix.md)**, and the
three result classes in **[architecture conclusions](docs/dsh-architecture-conformance.md)**.
Architecture classifications are deliberately not generated from a JSON ledger.
The previously observed 111 Pi rule rows and 45 DSH subsystems are versioned
snapshots, not fixed totals or proof of completeness. Four DSH gap IDs remain
active; a fifth historical finding (`DSH-ARCH-002`) was fixed upstream in rc.8.
These are confirmed findings, not a claim of complete coverage. Current
upstream reports include
[#2708 — durable events for out-of-repo plugins](https://github.com/deepseek-ai/deepseek-harness/discussions/2708)
and
[#3076 — provider compat fields dropped by `llm-pi-ai`](https://github.com/deepseek-ai/deepseek-harness/discussions/3076),
now resolved by the rc.8 profile schema.

## Pi capabilities on DSH

Every surface a Pi package can touch, and what it maps onto. These tables are
generated from the rules the bridge consults at runtime, so they cannot drift
from the code.

For pinned Pi 0.84.1, the generated catalog has **111 upstream-shaped rule
rows**. The bridge also keeps one
documented compatibility extension, `unregisterTool`; it appears on the tools
detail page but is deliberately outside that total. Nested objects such as the
session manager can expose several methods behind one row; the architecture
audit states this boundary explicitly.

<!-- capability-table:start -->
| Area | Pi surfaces | Status |
|---|---|---|
| [Tools](docs/capabilities/tools.md) | 11 | 2 same semantics · 9 mapped, difference stated |
| [Commands, flags, editor input](docs/capabilities/commands.md) | 13 | 13 mapped, difference stated |
| [Messages, context, agent loop](docs/capabilities/conversation.md) | 20 | 9 same semantics · 11 mapped, difference stated |
| [Sessions & side conversations](docs/capabilities/sessions.md) | 24 | 7 same semantics · 17 mapped, difference stated |
| [Models, providers, credentials](docs/capabilities/models.md) | 15 | 1 same semantics · 12 mapped, difference stated · 2 not available |
| [Asking the user, rendering](docs/capabilities/interaction.md) | 24 | 5 same semantics · 19 mapped, difference stated |
| [Project environment & resources](docs/capabilities/environment.md) | 4 | 1 same semantics · 1 mapped, difference stated · 2 not available |
| **Total** | **111** | **25 same semantics · 82 mapped, difference stated · 4 not available** |
<!-- capability-table:end -->

Plus **203 imported symbols** from Pi's three runtime packages
(`pi-coding-agent`, `pi-tui`, `pi-ai`), served from vendored or headless
shims — so a plugin's own Pi version pins never load. They are listed in
[Imported Pi runtime symbols](docs/capabilities/imports.md).

Each area page states the Pi capability contract, the theoretical DSH mechanism
and public seam, and the current implementation for every surface. Adding a
surface without a capability assignment or theoretical mapping fails the docs
check.

Start at the [capability index](docs/capabilities/README.md). Machine-readable:
`pi2dsh matrix --json`.

**Signing in with a subscription** works too: DSH ships static HTTP headers
only, and the bridge adds the Pi ecosystem's interactive OAuth layer. Any Pi
provider package that declares an `oauth` block gets a working
`/login <provider>`, driven by the package's own protocol code — Pi's four
official flows (OpenAI Codex, Anthropic, GitHub Copilot, Kimi Code) ship built
in and are available immediately after installing the engine, even before the
first community Pi package. Credentials persist with Pi's `auth.json` semantics and resolve per
request through a standard `dsh-credentials` provider, so your subscription
drives real calls on DSH's native llm path. Details in
[models](docs/capabilities/models.md).

**What is deliberately not available**, and why: runtime package installation
and standalone model runtimes stay with the host and its security gates;
provider payload/header/response interception belongs in a DSH llm adapter;
project trust is a host decision. See
[models](docs/capabilities/models.md) and
[environment](docs/capabilities/environment.md).

**The one gap we own:** plugin-drawn cards. Pi plugins can ship their own
renderers; today those registrations are accepted but not invoked, so such a
note appears as a native context-injection row — the content reaches you and
the model, without the plugin's styling. The client half exists and takes four
seats (side-conversation panel, header, widget dock, working chrome) — the card
renderers are what it does not draw yet.

## Examples

Every verified capability ships as a complete, runnable example. Every command
in one has actually been executed against a real DSH loop before landing.

| Example | What you get |
|---|---|
| [`vision-bridge`](examples/vision-bridge/) | A text-only model answers questions about images — CLI and web, probe images included |
| [`codex-image-gen`](examples/codex-image-gen/) | Generate and edit images with a ChatGPT/Codex subscription; DSH approval and inline result included |
| [`side-conversation`](examples/side-conversation/) | `/btw <question>` runs a side thread in DSH's native subagent UI; your main conversation stays clean |
| [`presentation-surfaces`](examples/presentation-surfaces/) | A real plugin's terminal chrome (`pi-powerline-footer`) in DSH's web seats, plus which of the top-50 Pi plugins draw at all |
| [`subscription-login`](examples/subscription-login/) | Use a ChatGPT / Claude / Copilot / Kimi subscription as a DSH model: `/login`, then the route and credential appear on their own |
| [`gateway-compat`](examples/gateway-compat/) | Private / domestic / proxy gateways that reject the `developer` role: how rc.8's official profile carries Pi compat declarations to the wire (passthrough recorder included) |
| [`alibaba-token-plan`](examples/alibaba-token-plan/) | Use Alibaba Cloud Model Studio Plan routes through the original Pi provider; dynamic DeepSeek model, tool loop and restart included |
| [`custom-gateways`](examples/custom-gateways/) | Add any OpenAI-compatible gateway the official DSH way, and every Pi plugin sees it |
| [`tui-mcp`](examples/tui-mcp/) | Keep dsh-TUI's native `/mcp`, add the Pi ecosystem manager as `/pi-mcp`, and exercise its complete host-influenced MCP surface through DSH runtimes |
| [`subagents`](examples/subagents/) | The model runs a small team: delegate, background, steer mid-run, collect, resume with memory, stop for real, manage via `/pi-agents`, reopen across restarts |
| [`pi-tui-ecosystem`](examples/pi-tui-ecosystem/) | Run the unmodified Pi MCP manager and Pi subagent flow in `@xmoon76/dsh-pi-tui`; native `/login` and Pi OAuth providers coexist without duplicate commands |

## Other tools

Beyond the engine, the CLI has a few helpers:

```sh
npx pi2dsh inspect <pkg>@<version>   # compatibility report before an upgrade
npx pi2dsh matrix --json             # the full capability matrix
npx pi2dsh mcp-config                # Pi mcpServers config → official DSH MCP entries
```

## Development

```sh
pnpm verify                 # typecheck + contract tests + packaging
pnpm audit:community        # static screening over the top-50 corpus
pnpm test:community         # deep runtime + official plugin-manager + e2e
DEEPSEEK_API_KEY=… pnpm test:live    # real-model acceptance (key from env only)
CODEX_AUTH_FILE=… pnpm test:codex-image # real OAuth generation + reference edit + Web pixels
```

Acceptance evidence per capability: [docs/acceptance.md](docs/acceptance.md).
Working standards: [CLAUDE.md](CLAUDE.md) and [docs/STANDARDS.md](docs/STANDARDS.md).

## License

MIT. Vendored Pi sources retain their upstream MIT license
(`src/compat/vendor/PI-LICENSE`); generated bundles retain copied upstream
license and notice files.
