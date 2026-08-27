# Code navigation & feedback for the model on DSH

Give the model real code-navigation tools instead of directory crawls: fuzzy
file/content search (**@ff-labs/pi-fff**) and AST search, symbol navigation and
real language-server diagnostics (**pi-lens**) — all as native DSH tools the
model calls in an ordinary turn. This is the "the agent burns tokens scanning
my whole tree" fix: one indexed `ffgrep` call replaces dozens of `bash`
traversals, and `lsp_diagnostics` shows the model the same errors your editor
sees, right after it edits.

Everything below is copy-paste runnable against the bundled
[`sample-project/`](sample-project/), which plants two ground truths:

- a marker string (`FROSTBITE-7741`) that exists **only** in
  `notes/spec.md` — so a search result naming that file proves a real search;
- one type error in `src/ledger.ts` (`const opening: number = "seven"`) — so a
  diagnostics result naming TS2322 proves a real language server ran.

## 1. Install the engine, then the plugins

```sh
dsh plugin --profile headless add pi2dsh
dsh plugin --profile headless add @ff-labs/pi-fff pi-lens
```

That's the whole install: the pi2dsh engine mounts every Pi package you add to
the profile — no conversion step, no generated bundles.

The second add **will** stop with `ERR_PNPM_IGNORED_BUILDS: Ignored build
scripts: @ast-grep/cli` — pnpm blocks dependency build scripts by default, and
pi-lens's AST engine ships one. This is pnpm's approval gate, not a breakage:
run `pnpm approve-builds` inside the profile directory the error names,
approve `@ast-grep/cli`, and re-run the same `dsh plugin add` line. The failed
first attempt leaves a partial install; the re-run completes it.

> **Do not install `@narumitw/pi-lsp` into the same profile as `pi-lens`.**
> Both register a tool named `lsp_diagnostics`; pi-lens already covers LSP
> diagnostics and navigation, so co-installing them only creates a name
> collision. If you want pi-lsp's `lsp_fix`, use a separate profile.

## 2. Prepare the sample project

```sh
cd examples/code-navigation/sample-project
npm install
```

The local install carries `typescript` AND `typescript-language-server` —
the server pi-lens's discovery finds by walking up from the file. Without a
local server, pi-lens downloads a managed toolchain into `~/.pi-lens` on the
first diagnostics call instead — that also works, it is just slower the
first time (and it is what the `PI_LENS_DISABLE_LSP_INSTALL` switch below
turns off).

## 3. Run a turn that uses both tools

From `sample-project/` (the session's working directory is the workspace the
tools search):

```sh
dsh --profile headless "Two tasks in this project: 1) Use the ffgrep tool to find which file mentions FROSTBITE-7741 and report the file path. 2) Use the lsp_diagnostics tool on src/ledger.ts and report every error it returns. Do not use bash or any other tool for these two tasks."
```

What you should see in the answer:

1. the search names `notes/spec.md` — found by `ffgrep`, not by guessing;
2. the diagnostics report the planted error (TS2322,
   `Type 'string' is not assignable to type 'number'`) in `src/ledger.ts`.

The same works in the web app (`dsh web --profile web` after installing into
the `web` profile): pick the sample project as the workspace and send the same
prompt.

## What else is in the box

The exact toolset is what these packages register through the bridge, not a
pi2dsh feature list. As of the versions pinned by this example's regression:
`@ff-labs/pi-fff` adds `fffind`/`ffgrep` plus `/fff-health`, `/fff-mode`,
`/fff-rescan`; `pi-lens` adds AST search/replace (`ast_grep_*`), symbol tools
(`symbol_search`, `read_symbol`, `read_enclosing`), project/module reports,
`lsp_diagnostics`/`lsp_navigation`, and a `/lens-*` command family. Run
`/fff-health` or `/lens-health` in the composer to see each package's own
status page.

## Troubleshooting

- **First `lsp_diagnostics` call is slow** — pi-lens may be installing its
  managed toolchain (its own documented behavior): the auxiliary scanners
  (typos-lsp, opengrep) download from GitHub on first use. The local
  `npm install` in step 2 already covers the primary TypeScript server; if
  you want to skip the auxiliary downloads entirely, set pi-lens's own
  `PI_LENS_DISABLE_LSP_INSTALL=1` — servers already installed still run.
- **`ffgrep` finds nothing** — the tools search the session's working
  directory. Start `dsh` from `sample-project/` (or your real project root),
  not from the profile or home directory.
- **Diagnostics tool answers but reports zero errors for `ledger.ts`** — check
  that step 2 ran (`node_modules/typescript` present). A missing toolchain can
  degrade to syntax-only checks, which do not include type errors.
