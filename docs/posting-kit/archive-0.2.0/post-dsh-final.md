Hi all — sharing a bridge project for running Pi ecosystem extensions on DeepSeek Harness.

**What it is.** [pi2dsh](https://github.com/weijiafu14/pi2dsh) (npm: `pi2dsh`) implements Pi's public extension surface once — a general Host ABI — on top of DSH's native services (tools, durable sessions, subprocess, userQuestions, attachments, llm/credentials). A Pi package that sticks to the public API runs unmodified. Three delivery modes:

- **Host bundle**: one installable DSH bundle mounts any list of unmodified Pi packages as ordinary npm dependencies (`pi2dsh host --packages … --out …` → `dsh plugin add`).
- **Convert**: a reviewable per-package bundle with a vendored source snapshot and a machine-readable compatibility report.
- **MCP**: config translation only — Pi's `mcpServers` layers become `@deepseek-ai/dsh-mcp-client` patch entries; the Pi MCP adapter's code never runs.

**Discipline.** No `if (packageName === …)` anywhere in the core; every capability has a public-API contract test; the top-50 Pi catalog (by monthly downloads) is verified **black-box**: convert + mount in a real Cordis composition with official DSH service plugins, then execute representative tools with schema-derived arguments against local fixtures. Failures are attributed to concrete ABI gaps; fixing a gap unlocks every package that hits it.

**Current numbers (2026-08-14, machine-readable evidence in the repo's `community/`):**

| Layer | Result |
|---|---|
| Mountable in a real DSH runtime | **39 / 50** |
| Tested working — real tool/command execution | **32 / 50** (29 returned success, 3 ran business logic end-to-end) |
| Mounts; needs user credentials / event-hook-only / harness-limited | 7 / 50 |
| Not yet, attributed (4 Pi-internal-runtime users, 5 package defects, 2 snapshot limitation) | 11 / 50 |
| Deep verification (real LSP subprocess, web search/fetch, PNG generation) + official `dsh plugin` add/activate/remove | 4/4, plus a host bundle mounting two unmodified packages through the same official flow |
| Real-model acceptance: `deepseek-v4-flash` calls a migrated Pi tool, durable session log asserted, credential provably absent from artifacts | passed |

**Honest boundaries.** Packages that reach into Pi's internal runtime (`createAgentSession`, provider SDK factories) fail explicitly rather than pretending; Bun-only deps (`bun:sqlite`) and undeclared dependencies are reported as package defects; terminal-decoration surfaces (footer/statusline/shortcuts) register but never fire, matching Pi's own non-TUI modes.

**Two upstream gaps we hit that DSH might want to know about:**
1. There's currently no channel for an out-of-repo plugin to append custom session events safely: `Session.append()` can't set the envelope's `ignorable: true`, and `KNOWN_SESSION_EVENT_TYPES` is an in-repo generated list — so we persist Pi custom entries in a durable sidecar instead of the main log. The session README defers a registration surface "until such a consumer exists"; pi2dsh is that consumer.
2. The official MCP client bridges tools only; resources/prompts have no consumption path yet.

Roadmap: all 50 — bespoke adapters for the 4 internal-runtime packages, upstream issues for the 5 package defects, host-mode routing for the 2 snapshot-limited ones. Feedback and gap reports welcome.
