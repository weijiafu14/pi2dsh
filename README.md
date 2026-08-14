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
2. Every capability has a **public-API contract test** (`pnpm test`, 43 tests); "some plugin loads" is never the success criterion.
3. The top-50 corpus is verified **black-box only**: failures file public ABI gaps, and fixing one gap unlocks every package that hits it (e.g. one jiti subpath-alias fix unlocked 4 packages at once).

## Progress: Pi catalog top 50 by monthly downloads

Status as of 2026-08-14. Static analysis screens; the black-box run certifies. Full per-package machine-readable evidence in [community/](community/).

| Tier | Count | Meaning |
|---|---|---|
| ✅ **Tested working** | **38 / 50** | Mounted in a real DSH runtime AND real execution verified: 34 returned success, 4 ran their business logic end-to-end and rejected the synthetic probe arguments (4 additionally passed deep verification: real LSP subprocess, web search/fetch, PNG generation, official `dsh plugin` add/activate/remove; 2 of the 38 verified through host mode) |
| 🟡 **Mounts, not fully verified** | **8 / 50** | Loads and registers its tools/commands/skills in a real DSH runtime; full execution needs user credentials/services (3), is an event-hook package with no callable surface to probe (3), was still executing when the 20s probe timeout hit — it dispatches a child `pi` process the fixture environment cannot serve (1), or hit a test-harness limitation (1: strict live-agent identity checks in userQuestions — the same path passes in the deep-verification layer) |
| ❌ **Not yet supported** | **4 / 50** | All four use Pi-internal runtime APIs — attributed below, next on the roadmap |
| **Total mountable today** | **46 / 50** | |

Additional verified layers: a **host bundle** mounting two unmodified packages passed the official plugin-manager flow end-to-end; a **real model run** (`deepseek-v4-flash`) called a migrated Pi tool with the durable session log asserted and zero credential persistence ([evidence](community/live-deepseek-results.json)).

### The 4 not yet supported, attributed

*All are Pi-internal runtime users — they need bespoke adapters, next on the roadmap:*
`@tintinweb/pi-subagents` (calls `createAgentSession`/`createCodingTools` at load), `pi-landstrip` (calls `createBashToolDefinition`, Pi's built-in tool constructors), `pi-provider-litellm` (needs Pi's provider SDK factories; in DSH, model routing belongs to native llm adapters), `pi-fabric` (uses `wrapRegisteredTool` and other internal runtime surfaces at load).

### Correction: the "5 package defects" earlier versions reported

An earlier revision of this page (and our launch posts) attributed 5 blocked packages to upstream package defects. On re-verification **all five were faults in this project's own static screening, not in the packages** — high-download packages deserved that skepticism. Concretely: `bun:sqlite` is a host builtin of Pi's Bun-compiled distribution, and both `pi-hermes-memory` and `@mjasnikovs/pi-task` gate it behind runtime detection with proper Node fallbacks (better-sqlite3 / node:sqlite); `pi-harness-runtime`'s playwright and `mitsupi`'s googleapis/ws sit only on lazily-evaluated feature paths that never run at extension load; `pi-lens`'s out-of-tree skills path is skipped by Pi's own loader, and its bundler-stale worker URLs behave identically under Pi. The screener now models load-time vs lazy reachability, treats `bun:*` like `node:*`, and preserves published file layout — after which **all five mount, four grade tested-working, and no upstream issue was warranted**. The screening rules that produced the misjudgment are contract-tested against regressions.

### Roadmap: all 50

1. Lift the 8 "mounts, not fully verified" to tested-working (credentialed fixtures, per-package probe arguments, a live-agent probe path for userQuestions).
2. Bridge Pi's internal `AgentSession`/tool-constructor surfaces onto DSH natives to unlock the 4 internal-runtime packages.
3. ✅ Done: the 2 snapshot-limited packages verified through host mode ([evidence](community/host-mode-results.json)).
4. ✅ Done: re-verified the 5 packages we had wrongly reported as defective; corrected the screener and this page (see above).

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

## Compatibility boundaries (explicit, never silent)

| Area | Mapping |
|---|---|
| Tools | Native DSH tools; Pi's in-place `tool_call` argument mutation works for Pi-owned tools (DSH-native tools reject it — DSH logs arguments before policy) |
| Sessions | Messages project from DSH's durable log; Pi custom entries/labels/names persist in a pi2dsh sidecar (DSH has no out-of-repo plugin-event channel yet) |
| Pi TUI | Pure logic vendored byte-identical; components construct headlessly; `ui.custom` resolves `undefined` exactly like Pi's own rpc mode |
| Providers/OAuth | Declarations recorded; transports and credentials stay native to DSH `llm`/`credentials` |
| Session tree writes | `fork`/`navigateTree`/`switchSession` fail explicitly (DSH lists pi-style entry trees as deferred) |
| Terminal decoration | footer/statusline/shortcuts register but never fire — matching Pi's own non-TUI modes |

Full machine-readable matrix: `pi2dsh matrix --json`. Capability-by-capability acceptance evidence: [docs/acceptance.md](docs/acceptance.md).

## Development and verification

```sh
pnpm verify                                   # typecheck + 43 contract tests + packaging
pnpm audit:community                          # static screening, top 50
node scripts/blackbox-community.mjs community/blackbox-results.json --exercise
pnpm test:community                           # deep runtime + official manager + host e2e
DEEPSEEK_API_KEY=… pnpm test:live             # real-model acceptance (key from env only)
```

## License

MIT. Vendored Pi sources retain their upstream MIT license (`src/compat/vendor/PI-LICENSE`); generated bundles retain copied upstream license/notice files.
