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

This is deliberately a bridge, not a destination. Every capability you reach
through pi2dsh is a capability DSH's own ecosystem will eventually offer
natively — and when a better native plugin shows up for something you use
here, you should switch to it. That would be the bridge doing its job.

## Install

One engine, then whatever plugins you want:

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @kassing/pi-vision
```

Then **restart `dsh`** — plugins mount at startup.

> **Use `web` or `headless` as the profile name.** DSH ships a template for
> exactly those two, and each includes a surface (the web app / the one-shot
> driver). `dsh plugin --profile <any-other-name>` creates a profile with no
> surface at all, and that profile **starts up and then hangs with no
> diagnostic** — nothing to do with pi2dsh, but easy to hit on your first
> install. If you want a differently named profile, add the surface bundle to
> its `dsh.profile.bundles` yourself.

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

## Walkthrough: give a text-only model eyes

The clearest example of what the bridge buys you. DeepSeek models are
text-only, so DSH cannot send them an image. The Pi ecosystem has a plugin for
exactly this — it hands the image to a vision model you choose and injects the
analysis back into the conversation.

### 1. Install the plugin

```sh
dsh plugin --profile web add @kassing/pi-vision
```

### 2. Point it at a multimodal model

**This is the step to get right** — the plugin needs its own vision model, and
it is a different model from the one you chat with. Any OpenAI-compatible
vision endpoint works (OpenRouter, DashScope/Qwen-VL, a self-hosted vLLM, …).

The plugin reads its configuration from environment variables — the standard
way Pi plugins are configured, and a plain DSH-side action for you:

```sh
export VISION_BRIDGE_BASE_URL=https://openrouter.ai/api/v1
export VISION_BRIDGE_MODEL=qwen/qwen2.5-vl-72b-instruct
export VISION_BRIDGE_API_KEY=$OPENROUTER_API_KEY
```

That is enough to work. If you would also like that vision model to appear in
DSH's own model picker (so you can chat with it directly), add it as a normal
DSH route as well — the `llm-pi-ai:` section of `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    openrouter:
      baseUrl: https://openrouter.ai/api/v1
      apiKeyEnv: OPENROUTER_API_KEY
      models:
        - id: qwen/qwen2.5-vl-72b-instruct
```

Both are ordinary DSH configuration. The bridge owns no model configuration of
its own, and there is no Pi-format file for you to write.

Avoid GPT-5/o-family models as the vision backend: that generation rejects the
non-default `temperature` some vision plugins send.

### 3. Ask about an image

In the CLI, mention a path:

```sh
dsh --profile web "What color fills $PWD/photo.png ? One word."
```

In the web app, **just paste the image** — even though your main model is
text-only. DSH normally refuses image attachments for a text-only model, so
the engine registers an *image-admission companion* route for every text-only
route in your directory, named `<route>-vision`. Pick it in the model picker
(it shows up as a "+ Vision Bridge" group), paste, and ask.

What you will see: your image becomes guide text, a
`pi2dsh:@kassing/pi-vision` context-injection row carries the analysis, and
your text-only model answers about the picture. Pixels never reach the
text-only wire.

Companions are automatic. To turn them off, or narrow them to specific routes,
set `visionCompanions` in the engine's plugin config
(`$DSH_HOME/profiles/web/cordis.patch.yml`):

```yaml
- id: pi2dsh
  config:
    visionCompanions: false
```

Full runnable version, with probe images: [`examples/vision-bridge`](examples/vision-bridge/).

## What actually works today

Two levels, and they are not the same claim.

### Level 1 — verified end to end, with a runnable example

Someone sat down, used the plugin's real feature on a real DSH loop, and saw
it work. **This is the list to trust.**

| Plugin | What was exercised | Where | Example |
|---|---|---|---|
| [`@kassing/pi-vision`](https://www.npmjs.com/package/@kassing/pi-vision) | Image analysis delegated to a vision model; image-admission companion route; analysis injected into a text-only model's turn | CLI + web | [`vision-bridge`](examples/vision-bridge/) |
| [`pi-btw`](https://www.npmjs.com/package/pi-btw) | `/btw <question>` as a real child session in DSH's subagent UI; `/btw-inject`; `/btw --save`; main thread stays clean | CLI + web | [`side-conversation`](examples/side-conversation/) |
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
| **Subagents & background work** | `@tintinweb/pi-subagents` · `@gotgenes/pi-subagents` · `pi-background-tasks`² · `@mjasnikovs/pi-task` |
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
│ vocabularies. Registry projection, event bridge, session &   │
│ subagent bridge, credentials, vendored Pi logic.            │
└──────────────────────────┬──────────────────────────────────┘
                           │  ordinary DSH plugin + llm adapter
┌──────────────────────────▼──────────────────────────────────┐
│ DeepSeek Harness. Sees a normal plugin. Never learns Pi     │
│ exists.                                                     │
└─────────────────────────────────────────────────────────────┘
```

The rules that keep it honest:

- **Never a second implementation of something DSH already has.** Tools go to
  DSH's tool registry, models to DSH's llm configuration, MCP to
  `dsh-mcp-client`, skills to `dsh-skill-filesystem`, questions to DSH's user
  questions. The bridge translates configuration; it does not build a parallel
  runtime.
- **You never see Pi.** Everything you configure, read, or type is DSH-shaped:
  DSH settings, DSH commands, DSH credentials. Pi vocabulary exists only
  inside the plugin's view and the bridge's own internals.
- **No per-package special cases.** The core contains no
  `if (packageName === …)`. One ABI gap fixed unlocks every package that hits
  it.
- **Never fake success.** A capability with no safe mapping is reported —
  once, per plugin, in plain language — instead of silently returning
  something invented. If a plugin needs one during startup, it is marked
  unusable with a removal hint rather than half-working.
- **Verified, not asserted.** Every capability has a public-API contract test,
  and ships only after running end to end on a real DSH loop — CLI *and* web.

## Pi capabilities on DSH

Every surface a Pi package can touch, and what it maps onto. These tables are
generated from the rules the bridge consults at runtime, so they cannot drift
from the code.

<!-- capability-table:start -->
| Area | Pi surfaces | Status |
|---|---|---|
| [Tools](docs/capabilities/tools.md) | 12 | 3 same semantics · 9 mapped, difference stated |
| [Commands, flags, editor input](docs/capabilities/commands.md) | 13 | 13 mapped, difference stated |
| [Messages, context, agent loop](docs/capabilities/conversation.md) | 20 | 9 same semantics · 11 mapped, difference stated |
| [Sessions & side conversations](docs/capabilities/sessions.md) | 24 | 6 same semantics · 18 mapped, difference stated |
| [Models, providers, credentials](docs/capabilities/models.md) | 15 | 1 same semantics · 11 mapped, difference stated · 3 not available |
| [Asking the user, rendering](docs/capabilities/interaction.md) | 24 | 4 same semantics · 20 mapped, difference stated |
| [Project environment & resources](docs/capabilities/environment.md) | 4 | 1 same semantics · 1 mapped, difference stated · 2 not available |
| **Total** | **112** | **24 same semantics · 83 mapped, difference stated · 5 not available** |
<!-- capability-table:end -->

Plus **202 imported symbols** from Pi's three runtime packages
(`pi-coding-agent`, `pi-tui`, `pi-ai`), served from vendored or headless
shims — so a plugin's own Pi version pins never load. They are listed in
[Imported Pi runtime symbols](docs/capabilities/imports.md).

Each area page states two things for every surface: what it does on DSH, and
**how it is built** — the DSH seam, service or waterfall the mapping runs on,
so a claim here can be checked against the harness instead of trusted.

Start at the [capability index](docs/capabilities/README.md). Machine-readable:
`pi2dsh matrix --json`.

**Signing in with a subscription** works too: DSH ships static HTTP headers
only, and the bridge adds the Pi ecosystem's interactive OAuth layer. Any Pi
provider package that declares an `oauth` block gets a working
`/login <provider>`, driven by the package's own protocol code — Pi's four
official flows (OpenAI Codex, Anthropic, GitHub Copilot, Kimi Code) ship built
in. Credentials persist with Pi's `auth.json` semantics and resolve per
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
the model, without the plugin's styling. DSH has the machinery for this; we
have not built our client half yet.

## Examples

Every verified capability ships as a complete, runnable example. Every command
in one has actually been executed against a real DSH loop before landing.

| Example | What you get |
|---|---|
| [`vision-bridge`](examples/vision-bridge/) | A text-only model answers questions about images — CLI and web, probe images included |
| [`side-conversation`](examples/side-conversation/) | `/btw <question>` runs a side thread in DSH's native subagent UI; your main conversation stays clean |
| [`gateway-compat`](examples/gateway-compat/) | Private / domestic / proxy gateways that reject the `developer` role: why reasoning 400s, and how a Pi provider plugin gets past it (fake-endpoint probe included) |
| [`custom-gateways`](examples/custom-gateways/) | Add any OpenAI-compatible gateway the official DSH way, and every Pi plugin sees it |

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
```

Acceptance evidence per capability: [docs/acceptance.md](docs/acceptance.md).
Working standards: [CLAUDE.md](CLAUDE.md) and [docs/STANDARDS.md](docs/STANDARDS.md).

## License

MIT. Vendored Pi sources retain their upstream MIT license
(`src/compat/vendor/PI-LICENSE`); generated bundles retain copied upstream
license and notice files.
