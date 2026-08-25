# dsh-work-x

**One install that turns a stock [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a batteries-included agent workstation.**

```sh
dsh plugin --profile <your-profile> add dsh-work-x
```

Restart `dsh` (plugins mount at startup). That is the entire setup: the suite
carries the [pi2dsh](https://github.com/weijiafu14/pi2dsh) engine and four
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

The suite: [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) ·
[`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents) ·
[`pi-btw`](https://www.npmjs.com/package/pi-btw) ·
[`@crazygit/pi-codex-image-gen`](https://www.npmjs.com/package/@crazygit/pi-codex-image-gen),
running unmodified through the pi2dsh compatibility engine. Vision companion
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
Without `dsh-better-sidebar` everything still runs; you just lose those two
panels. (DSH has no way yet for one plugin to declare a companion bundle —
[we've proposed one](https://github.com/deepseek-ai/deepseek-harness/discussions/4543) —
so the install command names both.)

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
