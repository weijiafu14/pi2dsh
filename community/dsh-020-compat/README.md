# DSH 0.2 compatibility acceptance

Candidate: pi2dsh 0.26.0 and dsh-work-x 0.5.0. Host: stock npm
`@deepseek-ai/dsh@0.2.0-rc.2`. Pi extension semantics remain 0.84.1.
This directory records development acceptance, not an npm release claim.
The subsequent [npm release acceptance](../release-0.26.0/README.md) was completed
on 2026-10-14 using the published engine and suite.

## Final candidate acceptance — 2026-10-13

- `pnpm verify`: exit 0; **373 tests / 37 files**, type checking, capability
  documentation, package build, publint and clean package installation passed.
- `examples-accepted.json`: **15 passed / 1 partial / 4 skipped / 0 failed**.
- `subagents-accepted.json`: all eight lifecycle cases passed on stock
  dsh-TUI 0.14.0: steer, failed-child report, resume, cross-process reopen,
  parent cancellation, live model switch inheritance, explicit child model/
  reasoning effort, and child-extension isolation.
- `pi-tui-accepted.json`: stock dsh-pi-tui 0.5.1, original MCP manager and
  Agents UI, native login discovery, real child and direct MCP tool rounds.
- `issue8-final.json`: fresh official installation, original Pi Agent tool,
  real child file write, paired tool result returned to the parent, CLI exit.
- `step-seams-final.json`: real-model argument normalization and lifecycle
  handler order, including tool results in Pi turn_end.
- `screenshots/`: successful Web side conversation and code-navigation runs.

The accepted engine tarball SHA-256 is
`7adc91cfde5e69fc6763212308905e18079873e14629f7c8c1cab774a415ac61`.
The example receipts and detailed subagent report identify that artifact;
the Git commit in those reports is the checkout's base, not a claim that the
uncommitted candidate was already pushed. No npm publication is recorded here.

### Boundaries

Four credential-dependent lanes were not run: Alibaba Token Plan, vision CLI,
vision Web and Codex image generation. Subscription login is partial: pre-login
discovery and native route behavior passed, but no Codex OAuth credential was
provided for a fresh account-to-model round. Native TUI login discovery is not
an external OAuth authorization proof. Old release evidence does not turn
these skipped lanes into current-host passes. Cross-version data migration
remains the host's responsibility and was not tested here.

Earlier `examples.json`, `examples-2.json`, `examples-final.json`, targeted
diagnostic reports and `pi-tui-final.json` retain failed/intermediate attempts.
The `*-accepted.json` reports above are the final acceptance record. Test
apparatus corrections included V4 tool-result reading, actual workspace
selection, current TUI home/completion handling, restored command drafts,
paired durable result assertions, and propagating failed scenario statuses to
the runner exit code. None bypasses a failing product assertion.

## Scope

- Agent initialization returns its package-mount promise to the host's serial
  `agent/created` event. No assembly-time tool snapshot repair is used.
- Native V4 tool-role messages retain result contents, call identity and errors
  through provider requests, lifecycle events and Pi transcript exports.
- A child prompt completes only after its own inbox message's claimed turn;
  native error/aborted/max-token outcomes are represented to Pi consumers.
- Bridge messages declare the producer-owned `pi2dsh` source. Provider profiles
  include the current host's offered reasoning-budget, scheduler-priority and
  output-limit compatibility fields.
- Browser overlays use the mounted conversation identity. DSH's session list
  no longer carries a selected/current session.
- Native model credentials resolve from Settings.describe plus the official
  credential service; the removed Settings.get API is no longer called.
- dsh-pi-tui API 2 is consumed through its public extension seams and the
  public Host Loader.import. A late native authorization-backed login
  withdraws the bridge's earlier fallback rather than being shadowed by it.
- User and regression configuration uses Cordis profile patches; settings.yaml
  is only a host-owned legacy import. Regression scenarios select their actual
  workspace and read first-class tool results and nonblank session logs.

## Earlier diagnostics and issue attribution

- `issue8-live.json`: a fresh profile installs the unmodified
  `@tintinweb/pi-subagents@0.20.0` through `dsh plugin add`. A real DeepSeek parent
  calls `Agent`; a bridge-created child calls native file tools; the child's
  result reaches the parent's paired tool result; the CLI exits normally.
- `gateway-rerun.json`: a real forwarding recorder verifies the configured
  gateway route, system-role compatibility and reasoning mapping.
- Issue #7's rejected peer range is replaced by an exact 0.2.0-rc.2 baseline.
  Fresh official plugin installs passed throughout the final battery.
- Issue #8's original environment was not available for exact reproduction.
  Real published Host services reproduced swallowed child failure outcomes;
  V4 tool-result projection also required migration. Both are fixed and
  covered, and the reported successful parent/child usage passes live. The
  tiny Pi export in the report alone cannot establish what the native log did.
- `tests/host-020-contract.spec.ts`: real published DSH service composition
  reproduces a missing-provider failure without credentials and verifies the
  Pi error outcome. This is a contract test, not live-model evidence.

Historical compatibility is frozen at release tags. `v0.25.2` retains the
previous DSH 0.1.5-rc.2 acceptance record; future old-host fixes start from the
matching checkpoint instead of adding old-host branches to this candidate.
