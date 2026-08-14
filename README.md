# pi2dsh

Run [Pi](https://pi.dev/) extensions on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through one general-purpose **Pi Host ABI compatibility layer** — not per-package patches.

The bridge implements Pi's public extension surface once (tools, events, sessions, messages, AskUser, exec, TUI-headless, model/thinking, providers) on top of DSH's native services. Any package that sticks to Pi's public API runs unmodified; capabilities with no safe mapping fail explicitly instead of faking success.

## Two ways to use it

**Host bundle (recommended)** — one installable DSH bundle that mounts any list of unmodified Pi packages as ordinary npm dependencies. No conversion, no source snapshots:

```sh
pi2dsh host --packages '@juicesharp/rpiv-web-tools@2.4.0,pi-simplify@0.2.3' --out ./my-pi-host
dsh plugin --profile headless add file:$PWD/my-pi-host
dsh --profile headless --dump-config
```

**Convert (per-package artifact)** — a reviewable standalone bundle with a vendored source snapshot and a compatibility report, for supply-chain-sensitive installs:

```sh
pi2dsh inspect @narumitw/pi-lsp
pi2dsh convert @narumitw/pi-lsp --out ./dsh-pi-lsp
dsh plugin --profile headless add file:$PWD/dsh-pi-lsp
```

**MCP is config translation, not adapter execution.** DSH ships an official MCP client, so Pi's MCP setup migrates by translating configuration — `pi-mcp-adapter` code never runs:

```sh
pi2dsh mcp-config            # reads Pi's six mcpServers layers, emits dsh-mcp-client patch entries
pi2dsh mcp-config --out mcp.patch.yml
```

`$VAR` references become `!!js process.env.VAR`; literal secrets trigger a warning instead of landing in the patch.

## How the host layer works

```
Pi package (unmodified npm dependency)
  │ loaded verbatim (default-export factory, package.json pi.extensions)
  ▼
Pi Host ABI (this bridge)
  ├─ registerTool / setActiveTools  → DSH tools + per-agent tools.restrict
  ├─ 33 Pi events                   → DSH durable events & hook seams
  ├─ exec                           → DSH subprocess (local or E2B by composition)
  ├─ sendMessage / sendUserMessage  → DSH inject / steer / followup
  ├─ ui.select/confirm/input/editor → DSH userQuestions (real waiting)
  ├─ session entries / labels / name→ durable sidecar + DSH log projection
  ├─ images                         → DSH attachments (refs in the log, not base64)
  ├─ pi-tui / pi-coding-agent / pi-ai imports → vendored-or-headless shims
  └─ setModel / setThinkingLevel    → per-agent overrides at the agent/request seam
```

Three hard rules keep this general instead of degrading into per-package patches:

1. The core contains **no `if (packageName === …)`** branching.
2. Every capability has a **public-API contract test** (`pnpm test`); "some plugin loads" is never the success criterion.
3. The top-50 corpus is verified **black-box only**; a failure files a public ABI gap, and fixing the gap unlocks every package that hits it.

## Top-50 verification (Pi catalog, by monthly downloads, 2026-08-14)

Static analysis **screens**; the black-box run **certifies**. Full machine-readable evidence lives in [community/](community/).

| Layer | Result | Evidence |
|---|---|---|
| Static screening (`pnpm audit:community`) | 45 review / 5 blocked (was **46 blocked** before the ABI layer) | [audit-results.json](community/audit-results.json) |
| **Black-box load in a real DSH runtime** | **38 / 50 mount with their registration surfaces live** — 6 load-failed, 6 fatal, every failure attributed | [blackbox-results.json](community/blackbox-results.json) |
| Deep runtime + official plugin manager | 4/4 packages execute real tool paths (LSP subprocess, web search/fetch, PNG generation, ask_user); 4/4 pass `dsh plugin` add/activate/remove; host bundle mounting two unmodified packages passes the same official flow | [runtime-results.json](community/runtime-results.json) |
| Real model acceptance | `deepseek-official/deepseek-v4-flash` calls a migrated Pi tool once with the demanded arguments; durable log verified; credential provably absent from artifacts | [live-deepseek-results.json](community/live-deepseek-results.json) |

### The 12 that do not mount, honestly attributed

*Pi-internal runtime dependencies (the predicted "needs bespoke adaptation" tail):* `@tintinweb/pi-subagents` calls `createAgentSession`/`createCodingTools` at load; `pi-provider-litellm` needs Pi's provider SDK factories (in DSH, model routing belongs to native llm adapters); `pi-fabric` additionally references build-time-generated worker assets.

*Package defects visible under any host:* `pi-lens` escapes its own package root (`../../skills`); `pi-hermes-memory` and `@mjasnikovs/pi-task` require Bun-only `bun:sqlite`; `pi-harness-runtime` imports playwright without declaring it; `mitsupi` imports googleapis/ws without declaring them; `pi-goosedump` ships a platform binary its install can't resolve here.

*Convert-mode snapshot limitation:* `pi-hashline-edit-pro` and `pi-interview` read package files at runtime that static closure can't prove; the host bundle path (which keeps the whole package directory) is the supported route for them.

## Compatibility boundaries

| Area | Mapping |
|---|---|
| Tools | Native DSH tools; Pi's in-place `tool_call` argument mutation works for Pi-owned tools (DSH-native tools reject it: DSH logs arguments before policy) |
| Commands/prompts | Native DSH commands (names normalized to DSH's charset); `ui.notify` becomes the result |
| Skills | DSH filesystem skills, resource directories intact |
| Sessions | Messages project from DSH's durable log; Pi custom entries/labels/names persist in a pi2dsh sidecar (DSH has no out-of-repo plugin-event channel yet — appending unknown types would break other builds' reloads) |
| Pi TUI | Pure logic vendored byte-identical (width/wrap/keys/fuzzy/keybindings); components construct headlessly; `ui.custom` resolves `undefined` exactly like Pi's own rpc mode |
| Model/thinking | Per-agent overrides applied at DSH's `agent/request` seam; DSH validates effort ids |
| Providers/OAuth | Declarations recorded; transports and credentials stay native to DSH `llm`/`credentials` |
| Session tree writes | `fork`/`navigateTree`/`switchSession` fail explicitly (DSH lists pi-style entry trees as deferred); observational tree events register but never fire |
| Compaction | Events project from DSH's durable compaction records; `ctx.compact()` fails explicitly |

The full machine-readable matrix: `pi2dsh matrix --json`.

## Development and verification

Requires Node.js 22.19+ and a sibling `deepseek-harness` checkout (or `PI2DSH_DSH_ROOT`).

```sh
corepack pnpm@11.7.0 install
pnpm verify                      # typecheck + full contract tests + packaging checks
pnpm audit:community             # static screening of the top-50 corpus
node scripts/blackbox-community.mjs   # black-box certification (converts + loads all 50)
pnpm test:community              # deep runtime + official plugin manager + host bundle e2e
DEEPSEEK_API_KEY=… pnpm test:live     # real-model acceptance (key from env only)
```

The ten mandated capabilities map to their contract tests and evidence in [docs/acceptance.md](docs/acceptance.md).

## 中文结论

这一版是**通用 Pi Host ABI 兼容层**，不是逐包补丁：核心零包名分支，能力以公共 API 契约测试为准，前 50 只做黑盒验收。结果：静态筛查 blocked 从 46 降到 5；**黑盒真实挂载 38/50**（每个失败都有归因证据）；4 包深链路真执行 + 官方插件管理器安装/激活/卸载全过；单一 host bundle 装两个原样 Pi 包走完同一官方流程；真实 DeepSeek 模型调通迁移工具且凭证零落盘。装不上的 12 个包全部给出证据：依赖 Pi 内部运行时的、包自身缺陷的（Bun 专属/未声明依赖/资源越界）、以及 convert 快照模式的已知限制（host 模式可覆盖）。MCP 走配置转换直连 DSH 官方客户端，不运行 pi-mcp-adapter。

## License

MIT. Vendored Pi sources retain their upstream MIT license (see `src/compat/vendor/PI-LICENSE`); generated bundles retain copied upstream license and notice files. The original Pi package remains governed by its own license.
