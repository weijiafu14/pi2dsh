# Bring your `.claude/` with you: pi-code on DSH

You already have a repository full of Claude Code configuration — `CLAUDE.md`
with `@imports`, `.claude/settings.json` with `env` and hooks, `.claude/skills`,
`.claude/commands`, agents, MCP servers. The published Pi package
[`pi-code`](https://www.npmjs.com/package/pi-code) reads all of that for the Pi
coding agent. Through pi2dsh the same unmodified package reads it for DSH, so a
project keeps working the way it did under Claude Code without a rewrite of its
configuration.

Everything is stock: the unmodified DSH release from npm, the unmodified
`pi-code` package. pi2dsh maps the package's public Pi host surfaces onto DSH:

```text
pi-code                         pi2dsh                         DSH
─────────────────────────       ──────────────────────────     ───────────────────────
session_start (trust ask) ───▶  ctx.ui.confirm bridge     ──▶  native user-questions dialog
settings.json env         ───▶  process env (Pi semantics)──▶  bash tool child environment
PreToolUse/PostToolUse …  ───▶  tool_call / tool_result   ──▶  tools/pre-execute, post-execute
CLAUDE.md @imports        ───▶  before_agent_start        ──▶  system-prompt/assemble
                                (systemPromptOptions.contextFiles from the
                                 official dsh-agent-instructions loader)
.claude/skills            ───▶  resources_discover        ──▶  skills registry (dsh-skill-filesystem)
```

## Install

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-code
```

(Use `--profile headless` for the one-shot CLI; add both packages to every
profile you use.) Restart DSH after adding plugins.

## Try it

Open a workspace that carries a `.claude/` directory — this example's
[`workspace/`](workspace/) is a minimal one:

- `CLAUDE.md` importing `@notes/imported.md`
- `.claude/settings.json` exporting `PI_CODE_PROBE` and running a `PreToolUse`
  hook on `Bash`
- `.claude/skills/demo-skill/SKILL.md`
- `.claude/rules/general.md` (always on) and `.claude/rules/src-only.md`
  (attached when a file under `src/` is read)
- `.claude/output-styles/pirate.md` — select it with `/output-style pirate`
  (or `"outputStyle": "pirate"` in `settings.json`)
- `.claude/commands/greet.md` — run it as `/greet`

The first session in that workspace asks **"Trust this project?"** through
DSH's own question dialog. That is pi-code's rule, the same as on Pi: a
repository can ship hooks and MCP servers, so nothing project-scoped loads
until you say yes. Answer **Yes** once; the decision is remembered for that
directory.

Then, in the same session:

```text
Run the bash command: echo "PROBE=$PI_CODE_PROBE" and reply with the line it printed.
```

The shell prints the value from `settings.json`, and the `PreToolUse` hook has
run before the command (the example hook touches a marker file). Ask:

```text
What is the secret import codeword from your context files?
```

The answer comes from `notes/imported.md`, which only `CLAUDE.md`'s `@import`
brings into the prompt — the model does not open the file. The skill from
`.claude/skills` is listed in the session's skill catalog and loads through
DSH's `skill` tool.

Type `/greet` in the composer: the command file's body is what the model
answers. Ask it to read `src/probe.ts` and the `src/**` rule rides along with
the file's content. A project `.mcp.json` (stdio or HTTP servers) is connected
by pi-code's own MCP client and its tools register as `<server>_<tool>`.

## What was verified, and how

Verified end to end on stock DSH (`0.1.1-rc.2` and `0.1.2-alpha.3`), headless
and web, with a fresh `DSH_HOME` and a real model. Every row is read from the
session log, never from page text or the model's wording:

| Claude Code feature | Evidence |
|---|---|
| "Trust this project?" | answered in DSH's native question card in the web app; headless fails closed without a stored decision |
| `settings.json` `env` | the bash tool's own result carries the value |
| `PreToolUse` hook on `Bash` | the hook's marker file exists on disk |
| `CLAUDE.md` `@import` | the imported text is inside `request/header.system` |
| `.claude/skills` | the skill's description is in DSH's skill-catalog message |
| `.claude/output-styles` + `outputStyle` setting | `## Output Style: <name>` and its body are in `request/header.system` |
| `.claude/rules` (unscoped) | the rule text is in `request/header.system` |
| `.claude/rules` with `paths:` | the rule body is attached to the `read` result of a matching file |
| `.mcp.json` (stdio server) | the server's tool ran through pi-code's own MCP client; its result carries the server's answer |
| `.claude/commands` | as a user slash command in the web app (the expansion enters the conversation) and through the model-facing `slash_command` tool |

Regression: `scripts/verify-pi-code-headless-e2e.mjs` and
`scripts/verify-pi-code-web-e2e.mjs` (`pnpm test:pi-code`).

## Not working on DSH

- **`Task` subagents from `.claude/agents`.** pi-code runs an agent by
  spawning the Pi CLI as a child process (`getPiInvocation`); on DSH that
  resolves to the host's own binary, which answers `--profile <name> is
  required`, so every `Task` call fails. This is a Pi-CLI process contract,
  not a host ABI surface, and pi2dsh does not fake it. For subagents on DSH
  use [`@tintinweb/pi-subagents`](../subagents/), which is verified.

## Boundaries

- A one-shot headless run with no stored trust decision loads no
  project-scoped configuration — pi-code's fail-closed rule, identical on Pi.
  Approve once in the web app (or a terminal surface) first.
- Pi prompt templates and TUI themes that `resources_discover` might return
  have no DSH seat; they are reported in the log, not mounted.
- pi-code's statusline reads rate-limit headers from Pi's
  `after_provider_response`, which DSH's llm adapter does not expose; the
  status line works without that field.
- Hooks follow pi-code's own contract (its `docs/hooks.md`): a `PreToolUse`
  hook that returns `permissionDecision: "ask"` shows DSH's Yes/No question
  in the web app and blocks in headless.
