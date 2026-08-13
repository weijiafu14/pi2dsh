# pi2dsh

Convert a [Pi](https://pi.dev/) package into an installable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle — with a fail-closed compatibility report before any migrated code runs.

`pi2dsh` is a bridge, not a claim that the two plugin APIs are identical. It snapshots the package's local source/resource closure, adapts verified Pi APIs to native DSH services, and blocks capabilities with no safe mapping by default.

## What works today

- Pi tools become native DSH tools, including cancellation, text results, errors, and verified pre/post-tool hooks.
- Pi commands and prompt templates become DSH commands.
- Pi skills become DSH filesystem skills with their resource directories intact.
- Verified lifecycle events map to durable DSH session boundaries.
- Package-local Pi extension events continue to work inside the generated bundle.
- Imports from the current and legacy Pi host packages are redirected to small, audited compatibility shims.
- Local module closure, JSON assets, runtime dependencies, resource paths, symlinks, and unknown API access are audited fail-closed.

The full machine-readable matrix is available with `pi2dsh matrix --json`.

## Quick start

Requires Node.js 22.19 or newer and DeepSeek Harness.

```sh
git clone https://github.com/weijiafu14/pi2dsh.git
cd pi2dsh
corepack pnpm@11.7.0 install
pnpm build
node dist/cli.mjs inspect @narumitw/pi-lsp
node dist/cli.mjs convert @narumitw/pi-lsp --out ./dsh-pi-lsp
dsh plugin --profile headless add file:$PWD/dsh-pi-lsp
dsh --profile headless --dump-config
```

An existing path does not need a `./` prefix:

```sh
pi2dsh inspect packages/my-pi-extension
pi2dsh convert packages/my-pi-extension --out ./generated/my-extension
```

Use `--strict` to accept only packages whose every detected capability is fully compatible. A package with any unsupported capability is blocked by default; `--allow-unsupported` is an explicit escape hatch for generating a knowingly degraded bundle.

Always review `pi2dsh.report.json` before installing the generated bundle. The bundle executes a snapshot of the original Pi extension source, so the source must be trusted.

## Audited Pi community packages

On 2026-08-14 we audited the top 50 Pi extensions sorted by monthly downloads in the official [Pi package catalog](https://pi.dev/packages?type=extension). Static results: **0 ready, 4 review, 46 blocked, 0 audit errors**.

We then converted the four non-blocked packages and tested each through DSH runtime plus the official `dsh plugin` install/activate/remove flow:

| Pi package | Verified DSH capability | Honest status |
|---|---|---|
| `@narumitw/pi-lsp@0.49.4` | `lsp_diagnostics`, `lsp_fix`, real JSON-RPC child LSP | Core tools work; UI status and commands are degraded |
| `@juicesharp/rpiv-web-tools@2.4.0` | `web_search`, `web_fetch` | Core tools work; interactive configuration command is unavailable |
| `@amaster.ai/pi-image-gen@0.1.8` | `image_generate`, PNG materialization, bundled skill | Core tool and skill work; Pi command surface is limited |
| `pi-ask-user@0.14.0` | installs, registers `ask_user`, bundles its skill | **Not equivalent**: headless mode returns the package's explicit non-interactive fallback |

So the current, defensible answer is: three popular packages have directly usable core tool paths; one is installable only with material interaction degradation. None of the top 50 is classified as full-fidelity yet.

See [community/README.md](community/README.md), [the complete 50-package audit](community/audit-results.json), [runtime evidence](community/runtime-results.json), and [the real DeepSeek model evidence](community/live-deepseek-results.json).

## Real model acceptance test

The repository includes a live test that:

1. generates a bundle from the complete Pi fixture;
2. installs it with the official DSH plugin manager;
3. asks `deepseek-official/deepseek-v4-flash` to call the migrated `pi_greet` tool;
4. reads the durable DSH session log and asserts exactly one call with `{ "name": "Ada" }`, a successful result, and a completed turn;
5. refuses to write evidence if the API key appears in captured output or the session.

```sh
DEEPSEEK_API_KEY=... pnpm test:live
```

The key is read from process environment only. Do not put credentials in a repository or shell history.

## Compatibility boundaries

| Area | Mapping |
|---|---|
| Tools | Native DSH tools; an enforced JSON Schema subset and text results are preserved |
| Commands/prompts | Native DSH commands; `ui.notify` is captured as output |
| Skills | Copied into a DSH filesystem skill provider |
| Lifecycle | Session, turn, message, and tool boundaries map to durable DSH events where semantics were verified |
| Pi TUI | Headless loading shims only; interactive select/input/custom widgets are not emulated |
| Providers/OAuth | Blocked; these require native DSH adapters and credential integration |
| Shell execution | Blocked; packages must use an explicit DSH tool/sandbox port |
| Session mutation | Blocked where Pi's model conflicts with DSH append-only durable events |
| Dynamic/unknown access | Blocked because compatibility cannot be established statically |

Some tool-schema constraints, binary image blocks, presentation details, Pi-only result metadata, and interactive commands are intentionally degraded and reported as `partial`. Unsupported behavior fails during inspection or explicitly at runtime; the bridge does not silently fake success.

## Generated bundle

Each conversion creates a normal DSH bundle containing:

- `package.json` and `cordis.patch.yml` for official plugin-manager installation;
- `index.js`, which mounts the pi2dsh runtime adapter;
- `vendor/`, a closed snapshot of reachable Pi extension modules and local assets;
- copied `skills/`, `prompts/`, and license/notice files;
- `pi2dsh.manifest.json` and `pi2dsh.report.json` for review and provenance.

Generated bundles use `pi2dsh` as a runtime dependency. The default is the immutable `v0.1.1` GitHub Release tarball, so conversion works before npm publication. During local bridge development, pass `--runtime file:/absolute/path/to/pi2dsh`; a future npm release can be selected explicitly with `--runtime '<version>'`.

## Development and verification

```sh
corepack pnpm@11.7.0 install
pnpm verify
pnpm audit:community
pnpm test:community
```

`pnpm test:community` downloads the four pinned candidate versions, converts them, exercises their real core paths, and runs official DSH install/activate/remove checks. Set `PI2DSH_DSH_ROOT` when the DSH checkout is not the sibling `../deepseek-harness` directory.

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding an API mapping and its required evidence.

## 中文结论

这不是“把所有 Pi 插件改个包名”。它先做静态能力审计，再生成可由 DSH 官方插件管理器安装的 bundle；无法证明安全、语义不等价的能力默认阻断。

当前对 Pi 官方目录下载量前 50 的实测结论是：`pi-lsp`、`rpiv-web-tools`、`pi-image-gen` 的核心工具链路可直接使用；`pi-ask-user` 只能降级安装，交互问答并未等价迁移；其余 46 个存在明确阻断项。仓库保留了全量审计、四包运行时 E2E 和真实 DeepSeek 工具调用证据，方便社区逐项补齐，而不是口头宣称兼容。

## License

MIT. Generated bundles retain copied upstream license and notice files. The original Pi package remains governed by its own license.
