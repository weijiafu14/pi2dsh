# pi2dsh

**English** | [中文](README.zh.md)

**Bridging the Pi and DeepSeek Harness ecosystems.** pi2dsh is dedicated to connecting [Pi](https://pi.dev/)'s extension ecosystem with [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): one general **Pi Host ABI compatibility layer** that runs unmodified Pi extensions as native DSH plugins — not per-package patches.

```sh
# one bundle, any Pi packages, no conversion
pi2dsh host --packages '@juicesharp/rpiv-web-tools@2.4.0,pi-simplify@0.2.3' --out ./my-pi-host
dsh plugin --profile headless add file:$PWD/my-pi-host
```

## Architecture

The bridge implements Pi's public extension surface **once**, mapping every call onto DSH's native services. A package that sticks to Pi's public API runs verbatim; capabilities with no safe mapping fail explicitly instead of faking success.

```
Pi package (unmodified npm dependency)
  │  loaded verbatim: default-export factory, package.json pi.extensions
  ▼
┌─────────────────── Pi Host ABI (pi2dsh) ───────────────────┐
│ registerTool / setActiveTools → DSH tools + per-agent restrict │
│ 33 Pi lifecycle events        → DSH durable events & hook seams│
│ exec                          → DSH subprocess (local / E2B)   │
│ sendMessage / sendUserMessage → DSH inject / steer / followup  │
│ ui.select/confirm/input       → DSH userQuestions (real waits) │
│ session entries/labels/name   → durable sidecar + log projection│
│ images                        → DSH attachments (refs, not b64)│
│ pi-tui / pi-coding-agent / pi-ai imports → vendored/headless   │
│   shims (width/keys/session math byte-identical to Pi, MIT)    │
│ setModel / setThinkingLevel   → agent/request seam overrides   │
└────────────────────────────────────────────────────────────────┘
  ▼
DeepSeek Harness native services (Cordis composition)
```

Three delivery modes:

| Mode | What it does |
|---|---|
| **Host bundle** (recommended) | One installable DSH bundle mounts any list of unmodified Pi packages as ordinary npm dependencies |
| **Convert** | A reviewable per-package bundle: vendored source snapshot + machine-readable compatibility report, for supply-chain-sensitive installs |
| **MCP config translation** | Pi's six `mcpServers` layers → official `@deepseek-ai/dsh-mcp-client` patch entries. The Pi MCP adapter's code never runs; `$VAR` becomes `!!js process.env.VAR`, literal secrets are warned about |

Three hard rules keep it general:

1. The core contains **no `if (packageName === …)`** branching.
2. Every capability has a **public-API contract test** (`pnpm test`, 45 tests); "some plugin loads" is never the success criterion.
3. The top-50 corpus is verified **black-box only**: failures file public ABI gaps, and fixing one gap unlocks every package that hits it (e.g. one jiti subpath-alias fix unlocked 4 packages at once).

## Progress: Pi catalog top 50 by monthly downloads

Status as of 2026-08-14. Static analysis screens; the black-box run certifies. Full per-package machine-readable evidence in [community/](community/).

| Tier | Count | Meaning |
|---|---|---|
| ✅ **Tested working** | **41 / 50** | Mounted in a real DSH runtime AND real execution verified: 35 returned success, 6 ran their business logic end-to-end and rejected the synthetic probe arguments (4 additionally passed deep verification: real LSP subprocess, web search/fetch, PNG generation, official `dsh plugin` add/activate/remove; 2 of the 41 verified through host mode) |
| 🟡 **Mounts, not fully verified** | **9 / 50** | Loads and registers its tools/commands/skills in a real DSH runtime; full execution needs user credentials/services (3), exposes no safely-probeable callable surface — event-hook packages or tools whose names indicate shared-state mutation, which the harness never invokes (4), was still executing when the 20s probe timeout hit — it dispatches a child `pi` process the fixture environment cannot serve (1), or hit a test-harness limitation (1: strict live-agent identity checks in userQuestions — the same path passes in the deep-verification layer) |
| ❌ **Not yet supported** | **0 / 50** | The last four Pi-internal-runtime packages are bridged: vendored built-in tool constructors, provider factories, a real-semantics `ExtensionRunner` facade, and `createAgentSession` driving genuine DSH child agents |
| **Total mountable today** | **50 / 50** | 48 through convert/host bundles directly; 2 snapshot-limited packages through host mode ([evidence](community/host-mode-results.json)) |

Additional verified layers: a **host bundle** mounting two unmodified packages passed the official plugin-manager flow end-to-end; a **real model run** (`deepseek-v4-flash`) called a migrated Pi tool with the durable session log asserted and zero credential persistence ([evidence](community/live-deepseek-results.json)).

### How the last four internal-runtime packages were bridged

Each landed as a reusable public-surface bridge, not a package patch: `pi-landstrip` and `pi-fabric` run on Pi's built-in tool constructors (bash/read/edit/write/grep/find/ls) vendored byte-identical with their pure-logic closure; `pi-provider-litellm` runs on the vendored pi-ai `createProvider` factory (model transports stay native to DSH llm); `pi-fabric` additionally hooks a real-semantics `ExtensionRunner` facade — patching `prototype.getAllRegisteredTools` genuinely filters the tool catalog, as under Pi; `@tintinweb/pi-subagents` runs on `createAgentSession` bridged to genuine DSH child agents through `ctx.agents` — the bridge owns no model loop, so compositions without one fail explicitly instead of simulating a subagent.

### Correction: the "5 package defects" earlier versions reported

An earlier revision of this page (and our launch posts) attributed 5 blocked packages to upstream package defects. On re-verification **all five were faults in this project's own static screening, not in the packages** — high-download packages deserved that skepticism. Concretely: `bun:sqlite` is a host builtin of Pi's Bun-compiled distribution, and both `pi-hermes-memory` and `@mjasnikovs/pi-task` gate it behind runtime detection with proper Node fallbacks (better-sqlite3 / node:sqlite); `pi-harness-runtime`'s playwright and `mitsupi`'s googleapis/ws sit only on lazily-evaluated feature paths that never run at extension load; `pi-lens`'s out-of-tree skills path is skipped by Pi's own loader, and its bundler-stale worker URLs behave identically under Pi. The screener now models load-time vs lazy reachability, treats `bun:*` like `node:*`, and preserves published file layout — after which **all five mount, four grade tested-working, and no upstream issue was warranted**. The screening rules that produced the misjudgment are contract-tested against regressions.

### Roadmap

1. Lift the 9 "mounts, not fully verified" to tested-working (credentialed fixtures, per-package probe arguments, a live-agent probe path for userQuestions).
2. ✅ Done: interactive OAuth host seam — Pi provider `oauth.login/refreshToken/getApiKey` flows run on DSH-native interaction, credentials persist with Pi's `auth.json` semantics with double-checked-lock refresh, and the four official Pi flows ship built in; verified end-to-end against a real ChatGPT Pro account (see "Interactive OAuth" above).
3. ✅ Done: all four Pi-internal-runtime packages bridged (see above) — every top-50 package mounts.
4. ✅ Done: the 2 snapshot-limited packages verified through host mode ([evidence](community/host-mode-results.json)).
5. ✅ Done: re-verified the 5 packages we had wrongly reported as defective; corrected the screener and this page (see above).

## Quick start

Requires Node.js 22.19+ and DeepSeek Harness.

```sh
git clone https://github.com/weijiafu14/pi2dsh.git && cd pi2dsh
corepack pnpm@11.7.0 install && pnpm build

node dist/cli.mjs inspect @narumitw/pi-lsp          # compatibility report
node dist/cli.mjs convert @narumitw/pi-lsp --out ./dsh-pi-lsp
node dist/cli.mjs host --packages 'pi-simplify' --out ./pi-host
node dist/cli.mjs mcp-config                        # Pi mcpServers → DSH patch
dsh plugin --profile headless add file:$PWD/pi-host
```

## Interactive OAuth: sign in with your subscription

DSH ships static HTTP headers only; pi2dsh adds the interactive OAuth layer from the Pi ecosystem. Any Pi provider package that registers an `oauth` block gets a working `/login <provider>` command on DSH, driven by the package's own protocol code. Pi's four official flows ship built in (vendored byte-identical): **OpenAI Codex (ChatGPT Plus/Pro)**, **Anthropic**, **GitHub Copilot**, **Kimi Code**.

```sh
# inside a DSH session with a pi2dsh host bundle mounted
/login openai-codex     # prints the authorization URL, spins up the localhost callback
# → approve in your browser; the credential lands in auth.json (0600)
```

What you get, end to end: PKCE + `localhost:1455` callback (device-code fallback for headless boxes), credentials persisted in Pi's `auth.json` format — so packages like `@narumitw/pi-accounts` manage the same file they already know — automatic refresh with Pi's double-checked-lock rotation (5-minute expiry window, refreshed token persisted before release), and `getProviderAuth`/`getApiKeyForProvider` on the extension registry returning live keys. Verified against a real ChatGPT Pro account: browser authorization → callback → token exchange → store → refreshable key (`scripts/verify-oauth-e2e.mjs` reproduces it; on networks that need a proxy, the script honors `HTTPS_PROXY`).

## Compatibility boundaries (explicit, never silent)

| Area | Mapping |
|---|---|
| Tools | Native DSH tools; Pi's in-place `tool_call` argument mutation works for Pi-owned tools (DSH-native tools reject it — DSH logs arguments before policy) |
| Sessions | Messages project from DSH's durable log; Pi custom entries/labels/names persist in a pi2dsh sidecar (DSH has no out-of-repo plugin-event channel yet) |
| Pi TUI | Pure logic vendored byte-identical; components construct headlessly; `ui.custom` resolves `undefined` exactly like Pi's own rpc mode |
| Providers/OAuth | Interactive OAuth is live: `/login <provider>` runs the package's own flow, credentials persist in Pi's `auth.json` with automatic refresh; model transports stay native to DSH `llm` |
| Session tree writes | `fork`/`navigateTree`/`switchSession` fail explicitly (DSH lists pi-style entry trees as deferred) |
| Terminal decoration | footer/statusline/shortcuts register but never fire — matching Pi's own non-TUI modes |

Full machine-readable matrix: `pi2dsh matrix --json`. Capability-by-capability acceptance evidence: [docs/acceptance.md](docs/acceptance.md).

## Development and verification

```sh
pnpm verify                                   # typecheck + 45 contract tests + packaging
pnpm audit:community                          # static screening, top 50
node scripts/blackbox-community.mjs community/blackbox-results.json --exercise
pnpm test:community                           # deep runtime + official manager + host e2e
DEEPSEEK_API_KEY=… pnpm test:live             # real-model acceptance (key from env only)
```

## License

MIT. Vendored Pi sources retain their upstream MIT license (`src/compat/vendor/PI-LICENSE`); generated bundles retain copied upstream license/notice files.
