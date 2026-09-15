# pi-hermes-memory acceptance, 2026-09-10

- `published-cli.json`: real CLI processes, published DSH 0.1.5-rc.1,
  pi2dsh 0.24.0, pi-hermes-memory 0.9.8. Core memory CRUD passes; history
  indexing and native skill discovery fail. The suite retains its failed status.
- `published-web.json`: the same published versions in a real Chrome browser.
  Save/recall/delete, five slash-command completions, pin persistence and the
  pinned instruction in a fresh session's model context pass. Index command
  completion is not history-search success: its output says zero messages.
- `local-skills.json` and `local-skills.log`: the separately built `52f7841`
  engine loads both global and project skills through the native DSH skill
  tool. This is not evidence for the npm 0.24.0 tarball.
- PNGs show the actual browser recall and pinned-instruction command.

Raw sessions and installation logs are retained at
`/tmp/pi2dsh-hermes-20260910/`. Random proof words are synthetic test data.
No credentials are included in these evidence files.

## Reproduce

Use a fresh directory for each run and export a working `DEEPSEEK_API_KEY`
without placing it in an evidence file. The runner needs Node 22+, corepack,
pnpm 11.7.0, and Playwright (resolved through `PLAYWRIGHT_FROM`).

```sh
export HERMES_E2E_ROOT="$(mktemp -d)"
npm install --prefix "$HERMES_E2E_ROOT/cli" @deepseek-ai/dsh@0.1.5-rc.1
node scripts/verify-hermes-memory-e2e.mjs install
node scripts/verify-hermes-memory-e2e.mjs cli
# The CLI command exits nonzero for the two recorded compatibility gaps.
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node scripts/verify-hermes-memory-e2e.mjs web
```

`verify-cli` / `verify-web` recheck retained session evidence without repeating
model calls. For the separately labeled source-only skill probe, build and
pack the engine, then set `HERMES_LOCAL_TARBALL` and run `probe-local-skills`.

Architectural classifications are maintained manually in
[`docs/plugin-validation-matrix.md`](../../docs/plugin-validation-matrix.md#pi-hermes-memory).
