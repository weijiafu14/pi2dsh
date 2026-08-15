Hi — for Pi extension authors: your extensions now have a second runtime.

[pi2dsh](https://github.com/weijiafu14/pi2dsh) is a compatibility layer that runs unmodified Pi extensions inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (the recently open-sourced agent harness). It implements Pi's public Host API once over DSH's native services — no per-package patching, no source modification.

To keep semantics honest, the text/measurement/key logic your extensions rely on (visibleWidth, wrapTextWithAnsi, matchesKey, keybinding tables, fuzzy matching, SessionManager and the truncation helpers) is **vendored byte-identical from Pi** under its MIT license — widths and key handling behave exactly as in Pi. Interactive TUI pieces follow Pi's own non-TUI semantics (`ui.custom` resolves `undefined` like rpc mode; select/confirm/input map to DSH's native user-question service and really wait for answers).

[NUMBERS TABLE HERE]

Boundaries are explicit: extensions that import Pi's internal runtime (`createAgentSession`, provider SDK factories) fail with a clear message instead of silently faking success — those need bespoke adapters and are on the roadmap. Full per-package evidence (mount + real tool executions with graded outcomes) is machine-readable in the repo.

If you maintain one of the top-50 extensions and want it working there, gap reports are very welcome.
