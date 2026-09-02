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

## What was verified, and how

Verified end to end on stock DSH (`0.1.1-rc.2` and `0.1.2-alpha.3`), headless
and web, with a fresh `DSH_HOME` and a real model:

| Claude Code feature | Evidence read from the session log |
|---|---|
| `settings.json` `env` | the bash tool's own result carries the value |
| `PreToolUse` hook on `Bash` | the hook's marker file exists on disk |
| `CLAUDE.md` `@import` | the imported text is inside `request/header.system` |
| `.claude/skills` | the skill's description is in DSH's skill-catalog message |
| "Trust this project?" | answered in the web dialog; headless fails closed without a stored decision |

Regression: `scripts/verify-pi-code-headless-e2e.mjs` and
`scripts/verify-pi-code-web-e2e.mjs`.

## Loaded but not verified here

pi-code also reads `.claude/commands` (as `/dir:name` commands), `.claude/agents`,
output styles, `.claude/rules`, Claude plugins and MCP server definitions, and
adds todo, checkpoints, memory, web search and subagents. Those mount (the
package's 7 tools and 12 commands register) but have not been driven end to
end in this example yet; treat them as "mounts, awaiting a real run".

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
