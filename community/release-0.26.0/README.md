# pi2dsh 0.26.0 / dsh-work-x 0.5.0

Target host: stock npm DeepSeek Harness **0.2.0-rc.2**. Pi ABI: 0.84.1.

Both packages are published and installable from npm. Registry integrity
matches both uploaded tarballs. `latest` is pi2dsh 0.26.0 / dsh-work-x 0.5.0.
Code/tag `v0.26.0`: `c972a79`. [Publication receipts](published.json).

## Registry acceptance — 2026-10-14

The complete `pnpm verify:release` command exited 0 on stock npm DSH
0.2.0-rc.2, macOS / Node 22.22.0. Every example used a fresh DSH_HOME, with
`PI2DSH_ENGINE_SPEC=pi2dsh@0.26.0` and
`PI2DSH_SUITE_SPEC=dsh-work-x@0.5.0`. Suite scenarios installed the actual npm
browser package, not a staged local tarball. Actual installed versions are
recorded in each applicable receipt.

| Check | Result | Evidence |
|---|---|---|
| Type checking, tests, generated docs, build and package validation | 373 tests / 37 files passed; exit 0 | `pnpm verify:release` |
| Complete CLI/Web example battery | 15 passed / 1 partial / 4 skipped / 0 failed | [examples-npm.json](examples-npm.json) |
| Pi-origin subagent lifecycle on stock dsh-TUI 0.14.0 | 8/8 passed | [subagents-npm.json](subagents-npm.json) |
| dsh-pi-tui 0.5.1 composition | Native login discovery, MCP manager, Agents UI, real child and direct MCP tool rounds passed | [pi-tui-npm.json](pi-tui-npm.json) |
| Real-model event/argument contracts | Handler order, per-call tool results and argument normalization passed | [step-seams-npm.json](step-seams-npm.json) |
| Issue #8's Pi-origin usage shape | Original pi-subagents 0.20.0; child writes a file, parent receives paired result, CLI exits | [issue8-npm.json](issue8-npm.json) |

The eight child cases cover steer, failure reporting, resume, cross-process
reopen, parent cancellation, live model-switch inheritance, explicit child
model/thinking, and extension isolation. This is not a DSH 0.1.7 or Windows
validation claim; the supported new host baseline is 0.2.0-rc.2.

Four cases are skipped for missing configuration/credentials: Alibaba Token
Plan, vision CLI, vision Web, Codex image generation. Subscription login is
partial: pre-login discovery/native route behavior passed; no Codex credential
was supplied for post-login model selection. These are not counted as passes.

Screenshots in [screenshots/](screenshots/) were visually reviewed. The
presentation-surface capture was strengthened to verify visible → disabled
and absent → enabled and visible, then rerun successfully against both npm
packages; its targeted result is merged into the full example report. This
avoids treating the stale pre-disable frame as successful command behavior.
No product implementation changed during release acceptance.

Upgrade replies were posted after registry acceptance:
[#7](https://github.com/weijiafu14/pi2dsh/issues/7#issuecomment-6162228660) and
[#8](https://github.com/weijiafu14/pi2dsh/issues/8#issuecomment-6162229190).
Both issues remain open for the reporters' confirmation.

For this machine's proxy-enabled Node environment, the test command uses
`NODE_OPTIONS=--disable-warning=UNDICI-EHPA` so that Node's experimental proxy
warning does not contaminate the subprocess stderr contract. It does not
suppress application errors. The [candidate acceptance](../dsh-020-compat/README.md)
is retained separately and is not substituted for these registry runs.

## Upgrade

First update the DSH desktop/CLI runtime to **0.2.0-rc.2**. Do not exempt an
old engine from the host's version checks. For an npm-installed CLI:

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
dsh --version
dsh plugin --profile web add pi2dsh@0.26.0
```

Use the profile you actually run (`web` above is an example), then fully
restart it. Pi capability packages do not need conversion or source changes.
Users of the Web suite should upgrade the suite as well:

```sh
dsh plugin --profile web add dsh-work-x@0.5.0
```

Do not install 0.26.0 on DSH 0.1.7 or earlier. Historical hosts remain on their
matching release checkpoints; old-host maintenance is a separate fix branch.
