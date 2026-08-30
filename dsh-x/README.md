# dsh-work-x

**One install that turns a stock [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a batteries-included agent workstation.**

```sh
dsh plugin --profile web add dsh-work-x dsh-better-sidebar
```

Restart `dsh` (plugins mount at startup). One line, two packages: the suite,
and the sidebar its Memory/Tasks/MCP workbench tabs live in — the sidebar IS
the primary form of the suite's product UI. (Headless/CLI profiles can drop
`dsh-better-sidebar`; DSH has no way yet for one plugin to auto-install a
companion — [proposed upstream](https://github.com/deepseek-ai/deepseek-harness/discussions/4543) —
which is the only reason this is two names instead of one.) That is the entire setup: the suite
carries the [pi2dsh](https://github.com/weijiafu14/pi2dsh) engine and six
capability packages, versions pinned to combinations that have been verified
end to end on a real DSH loop — never "should work", always "was watched
working".

一条命令，把官方 DSH 变成开箱即用的全能 agent 工作台。装完重启 dsh 即可；
所有组件版本锁死在真机端到端验收过的组合上。

## What you get, and why native DSH alone doesn't have it

| Capability | Stock DSH | dsh-x |
|---|---|---|
| **MCP** | Config-file servers, statically mounted; every tool costs context window | **Lazy proxy** (one tool + on-demand `search`/`describe` — dozens of servers without eating context), in-session manager, **OAuth** flows, **MCP Apps** (`ui://`), prompts→slash-commands, elicitation, sampling, fast cancellation — [full verified matrix](../docs/mcp-compatibility.md) |
| **Subagents** | Low-level agent registry, no product surface | Spawn / parallel / background delegation, **mid-run steering**, resume (in-session and **across restarts**), stop-with-parent, per-child model & thinking level, live inheritance of your `/model` switches — [acceptance report](../community/subagents-acceptance-report.md) |
| **Side conversations** | — | `/btw <question>`: ask something off-topic without polluting the main context; answer lands in a side panel |
| **Image generation** | — | Codex-backed image generation as a normal tool call, generated pixels shown inline (bring your own Codex credential) |
| **Persistent memory** | Sessions forget everything | Cross-session facts, corrections and preferences (`memory_add`/`memory_search`, `/memory-*` commands), plus a **Settings → Memory page** on the web: browse and search what the agent remembers, pin/unpin standing rules with a hard budget |
| **Background tasks** | A long tool call pins the conversation | `bg_run` starts named shell jobs and keeps talking, `bg_logs` reads output **mid-run**, plus a **tasks chip** on the web: it joins the composer's status row while jobs run — live output, one-click kill |

The suite: [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) ·
[`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents) ·
[`pi-btw`](https://www.npmjs.com/package/pi-btw) ·
[`@crazygit/pi-codex-image-gen`](https://www.npmjs.com/package/@crazygit/pi-codex-image-gen) ·
[`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory) ·
[`pi-background-tasks`](https://www.npmjs.com/package/pi-background-tasks),
running unmodified through the pi2dsh compatibility engine.

`pi-hermes-memory` builds a native SQLite store (`better-sqlite3`); if the
install stops with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds` inside
the profile directory (select `better-sqlite3`) and re-run the add — that gate
is the host's own supply-chain approval, not an error. Vision companion
routes are **off** in this suite; subscription logins stay whatever your DSH
profile already has.

## Web first

dsh-work-x targets `dsh web` (and the desktop shells that wrap it) as its primary
surface. The automated regression drives a real browser against a clean
install and asserts each bundled package's own command is offered by the
composer — not that a file exists somewhere.

```sh
dsh plugin --profile web add dsh-work-x dsh-better-sidebar
dsh web --port 5179
```

[`dsh-better-sidebar`](https://www.npmjs.com/package/dsh-better-sidebar) is the
community sidebar the suite's product UI seats into: its Tasks page shows your
subagents natively (click through to steer or stop them), and dsh-work-x adds an
**MCP tab** there — this session's servers grouped by layer (project /
global), with per-project enable/disable. A machine-wide view of the same
servers lives in **Settings → MCP** and works with or without the sidebar.
With the sidebar installed, **Memory** and **Jobs** tabs appear there too —
the same panels in workbench form. Without
`dsh-better-sidebar` everything still runs — Settings → Memory and the tasks
chip carry the same functionality. (DSH has no way yet for one plugin to declare a companion bundle —
[we've proposed one](https://github.com/deepseek-ai/deepseek-harness/discussions/4543) —
so the install command names both.)

## Memory & background tasks

**Primary form — the sidebar.** With the one-line install above, the right
sidebar (VSCode-style, per session) carries the suite's workbench tabs: open
the **＋** next to the tab strip and add **Memory** or **Jobs** — they sit
beside Files, Terminal, Source Control, and stay while you chat.

- **Memory tab** — *This project*'s memories first (named as such), then
  other projects, global, and about-you groups, with search. The *Pinned
  rules* section manages standing instructions injected into every turn:
  pin from the input, unpin per entry, hard budget shown. Writes run
  `pi-hermes-memory`'s own `/memory-pin` command, so the store's
  single-writer anti-injection design holds; the memory list itself is
  read-only by design — edits and deletions go through the agent's memory
  tools so store and search index never drift.
- **Jobs tab** — each background job's status, runtime and bytes; *show
  output* streams a job's output while it is still running; *Kill* runs the
  package's own `/kill`.

**Without the sidebar** (headless-leaning installs) the same functionality
stays reachable: **Settings → Memory** is the full memory page, and while
jobs run a small clickable **"N tasks running" chip** joins the host's own
status row under the composer — click for the same panel; no jobs, no chip.
The side-chat dot stays the only floating piece either way.

Verified by the automated regression end to end on clean installs: the
memory surfaces show a fact that exists only in the plugin's store, a pin
round-trips through STANDING.md and back out, and the kill provably ends a
180-second job early — asserted from the store files and task snapshots on
disk, not from page text.

## Configuration

Override engine config in your profile's user patch layer
(`$DSH_HOME/profiles/<p>/cordis.patch.yml`), targeting the row by id — never
insert a second row:

```yaml
- id: pi2dsh
  config:
    exclude: ["pi-btw"]   # drop a suite member you don't want
```

Plugin-specific settings follow each plugin's own environment variables and
slash commands, as documented by the plugin.

## How it works

`dsh-work-x` is a normal DSH bundle. Its patch mounts the pi2dsh engine (re-exported
through this package, so it resolves under pnpm's isolated layout), and the
engine reads this package's `pi2dsh.suite` manifest — an explicit list, one
dependency-hop from your profile — and mounts each member exactly as if you
had `dsh plugin add`-ed it yourself. No directory scanning, no forks, no
patched DSH internals; remove it with `dsh plugin remove dsh-work-x` and the whole
suite is gone.

## Relation to pi2dsh

dsh-work-x is the curated product; [pi2dsh](../README.md) is the engine and remains
independently installable for anyone who wants to pick their own Pi packages.
Anything verified for pi2dsh is inherited here at the same version pins.
