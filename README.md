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
2. Every capability has a **public-API contract test** (`pnpm test`, 41 tests); "some plugin loads" is never the success criterion.
3. The top-50 corpus is verified **black-box only**: failures file public ABI gaps, and fixing one gap unlocks every package that hits it (e.g. one jiti subpath-alias fix unlocked 4 packages at once).

## Progress: Pi catalog top 50 by monthly downloads

Status as of 2026-08-14. Static analysis screens; the black-box run certifies. Full per-package machine-readable evidence in [community/](community/).

| Tier | Count | Meaning |
|---|---|---|
| ✅ **Tested working** | **34 / 50** | Mounted in a real DSH runtime AND real execution verified: 30 returned success, 4 ran their business logic end-to-end and rejected the synthetic probe arguments (4 of the 32 additionally passed deep verification: real LSP subprocess, web search/fetch, PNG generation, official `dsh plugin` add/activate/remove) |
| 🟡 **Mounts, not fully verified** | **7 / 50** | Loads and registers its tools/commands/skills in a real DSH runtime; full execution needs user credentials/services (3), is an event-hook package with no callable surface to probe (3), or hit a test-harness limitation (1: strict live-agent identity checks in userQuestions — the same path passes in the deep-verification layer) |
| ❌ **Not yet supported** | **9 / 50** | Attributed below — all on the roadmap |
| **Total mountable today** | **41 / 50** | |

Additional verified layers: a **host bundle** mounting two unmodified packages passed the official plugin-manager flow end-to-end; a **real model run** (`deepseek-v4-flash`) called a migrated Pi tool with the durable session log asserted and zero credential persistence ([evidence](community/live-deepseek-results.json)).

### The 9 not yet supported, attributed

*Pi-internal runtime users (4) — need bespoke adapters, next on the roadmap:*
`@tintinweb/pi-subagents` (calls `createAgentSession`/`createCodingTools` at load), `pi-landstrip` (calls `createBashToolDefinition`, Pi's built-in tool constructors), `pi-provider-litellm` (needs Pi's provider SDK factories; in DSH, model routing belongs to native llm adapters), `pi-fabric` (uses `wrapRegisteredTool` + references build-time-generated worker assets missing from its published tarball).

*Package defects visible under any host (5) — will be reported upstream:*
`pi-lens` (resource manifest escapes the package root), `pi-hermes-memory` + `@mjasnikovs/pi-task` (Bun-only `bun:sqlite`), `pi-harness-runtime` (imports playwright without declaring it), `mitsupi` (imports googleapis/ws without declaring them).

### Roadmap: all 50

1. Lift the 7 "mounts, not fully verified" to tested-working (credentialed fixtures, per-package probe arguments).
2. Bridge Pi's internal `AgentSession`/tool-constructor surfaces onto DSH natives to unlock the 4 internal-runtime packages.
3. File upstream issues for the 5 package defects; adopt fixes as they land.
4. ✅ Done: the 2 snapshot-limited packages verified through host mode ([evidence](community/host-mode-results.json)).

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
pnpm verify                                   # typecheck + 41 contract tests + packaging
pnpm audit:community                          # static screening, top 50
node scripts/blackbox-community.mjs community/blackbox-results.json --exercise
pnpm test:community                           # deep runtime + official manager + host e2e
DEEPSEEK_API_KEY=… pnpm test:live             # real-model acceptance (key from env only)
```

## License

MIT. Vendored Pi sources retain their upstream MIT license (`src/compat/vendor/PI-LICENSE`); generated bundles retain copied upstream license/notice files.
