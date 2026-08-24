# Subagents: delegate, steer, stop, resume — with `@tintinweb/pi-subagents`

The model gets an `Agent` tool and a small team to manage: it can launch
autonomous subagents for multi-step tasks, keep working while they run in the
background, redirect one mid-run, wait for results, resume a finished agent
with its memory intact, and stop everything by interrupting the parent. Each
subagent is a genuine DSH child agent with its own native session — the host
lists, reopens and continues them like any other session.

Everything below has passed a real end-to-end acceptance on the stock npm
stack (see [Verified behaviors](#verified-behaviors)).

## Install

```sh
dsh plugin --profile main add pi2dsh
dsh plugin --profile main add @tintinweb/pi-subagents
```

Restart `dsh` after installing. Any configured model route works; the runs
below used the default DeepSeek route.

If pnpm stops the install with `ERR_PNPM_IGNORED_BUILDS`, approve the listed
build scripts (`dsh` writes the pending names into the profile's
`pnpm-workspace.yaml`) and re-run the add — that gate is the host's own
supply-chain approval, not an error in either package.

## Walkthrough

**1. Delegate.** Ask for anything that benefits from a separate context:

> Use the Agent tool to launch a general-purpose subagent named "digger"
> that finds every TODO in this repository and summarizes them.

Subagents run in the background by default: the parent gets the agent's ID
back immediately, keeps working, and is notified on completion.

**2. Steer one mid-run.** Plans change while an agent is already working:

> Call steer_subagent with agent "digger": ignore the tests directory,
> and group the TODOs by file instead.

The steering message reaches the running child between its tool executions.

**3. Collect the result.**

> Call get_subagent_result for "digger" with wait true.

**4. Resume with memory.** A finished agent can continue where it left off —
same conversation, same context:

> Resume that agent (pass its Agent ID from the result header to the Agent
> tool's `resume` parameter) and ask it to turn the summary into a task list.

Note two upstream quirks (present on Pi as well): `resume` accepts only the
**Agent ID**, not the name — the ID is printed in the spawn/result headers —
and the tool schema still requires `subagent_type` even on a resume call.

**5. Stop everything.** Interrupt the parent (Esc in the TUI) and running
children stop with it — and stay stopped. A stopped child does not finish its
task behind your back; prompting it again later is what wakes it.

**6. Manage the roster.** In the dsh TUI, `/pi-agents` opens the package's
own manager (agent types, running agents, scheduled jobs, settings). The
`pi-` prefix is there because dsh-TUI ≥ 0.9 reserves `/agents` for its own
local view.

**7. Reopen across restarts.** Every subagent is a native DSH session carrying
the official child descriptor and parent lineage: the host's session list can
reopen and continue it after a restart, and an evicted agent's `@name` mention
reopens the same conversation from its archive.

## Verified behaviors

The four lifecycle scenarios run as one repeatable harness —
[`scripts/verify-subagents-lifecycle-e2e.mjs`](../../scripts/verify-subagents-lifecycle-e2e.mjs)
— on a fresh `DSH_HOME`, the stock npm CLI, the stock package and a real
model, with falsifiable assertions (each one fails when the feature breaks):

| Scenario | Proof |
|---|---|
| steer | The steered file's name and content exist only in the steer message; the parent is forbidden bash and its log is checked — the file on disk can only mean the mid-run steer reached the child model |
| resume | A codeword that exists only inside a file: turn 1 reads and memorizes it, the resumed turn 2 must write it from memory with reads forbidden, in the same session log |
| stop | An interrupted parent's child was mid-`sleep`; well past the sleep window its output file must still be absent, and its session log must end aborted, not completed |
| cross-restart reopen | Two separate OS processes: the second reopens the child by its archive identity through the public Pi ABI and recalls the codeword — same session log grown from one turn to two |

Evidence: [`community/subagents-lifecycle-e2e.json`](../../community/subagents-lifecycle-e2e.json)
and the acceptance report
[`community/subagents-acceptance-report.md`](../../community/subagents-acceptance-report.md)
(in Chinese), including the earlier round proving child tool execution and the
`/pi-agents` alias on the real TUI.

## Troubleshooting

- **`Agent not found: "name"` on resume** — pass the Agent ID (from the spawn
  or result header), not the name; only `steer_subagent` and
  `get_subagent_result` accept names.
- **`/agents` opens something else in the TUI** — that is dsh-TUI's own local
  view; the package's manager is `/pi-agents`.
- **A subagent reports "0 tool uses" but clearly worked** — fixed in
  pi2dsh ≥ 0.16.1; upgrade the engine (`dsh plugin add pi2dsh@latest`).
