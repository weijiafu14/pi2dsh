Hi — for Pi extension authors: your extensions now have a second runtime.

[pi2dsh](https://github.com/weijiafu14/pi2dsh) (npm: `pi2dsh`) is a compatibility layer that runs unmodified Pi extensions inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the recently open-sourced agent harness. It implements Pi's public Host API once over DSH's native services — no per-package patching, no source modification: your package installs as an ordinary npm dependency of a host bundle.

To keep semantics honest, the text/measurement/key logic extensions rely on (`visibleWidth`, `wrapTextWithAnsi`, `matchesKey`, the keybinding tables, fuzzy matching, `SessionManager` and the truncation helpers) is **vendored byte-identical from Pi** under its MIT license — widths and key handling behave exactly as in Pi. Interactive TUI pieces follow Pi's own non-TUI semantics (`ui.custom` resolves `undefined` like rpc mode; select/confirm/input map to DSH's native user-question service and really wait for answers).

**Where the top 50 (by monthly downloads) stand today, verified black-box in a real DSH runtime:**

| | |
|---|---|
| Mount successfully | **39 / 50** |
| Tested working — a representative tool/command really executed | **32 / 50** |
| Mount, full run needs user credentials / are event-hook packages | 7 / 50 |
| Not yet (4 use Pi-internal runtime APIs like `createAgentSession`; 5 have package-level defects such as Bun-only `bun:sqlite` or undeclared deps; 2 need host-mode instead of snapshot conversion) | 11 / 50 |

Per-package evidence (mount + graded real executions) is machine-readable in the repo's `community/` directory, and there's a live acceptance run where `deepseek-v4-flash` calls a migrated Pi tool with the durable log asserted.

Boundaries are explicit: internal-runtime imports fail with a clear message instead of silently faking success — those are next on the roadmap, along with lifting every remaining package. If you maintain one of the top-50 extensions and want it working there, gap reports are very welcome.
