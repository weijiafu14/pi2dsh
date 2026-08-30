# Background jobs with live output: pi-background-tasks on DSH

Long shell jobs — dev servers, watch builds, migrations — normally pin the
conversation: the tool call blocks, and you see nothing until it returns. The
Pi ecosystem's
[`pi-background-tasks`](https://www.npmjs.com/package/pi-background-tasks)
fixes that, and it runs unmodified on DSH through pi2dsh: the model starts a
named job with `bg_run`, keeps talking, and reads bounded output **while the
job is still running** with `bg_logs`.

What the bridge carries for this package: its eleven tools (`bg_run`,
`bg_logs`, `bg_status`, `bg_kill`, `bg_result`, `bg_delegate`, the `fusion_*`
family), its commands (`/bg`, `/jobs`, `/logs`, `/kill`, …), and its durable
completion notifications.

## Install

```sh
dsh plugin add pi2dsh
dsh plugin add pi-background-tasks
```

Restart dsh after installing. No build-script approvals are needed — the
package's only runtime dependency is pure JavaScript.

## Try it — the mid-run read

Ask for a job that outputs progressively, then read it before it finishes:

```text
Use the bg_run tool to start a background shell job named ticker that runs:
sh -c 'for i in $(seq 1 60); do echo tick $i; sleep 1; done'
Immediately after it starts, call bg_logs for that task and show me the raw
output lines. Do not wait for it to finish.
```

Expected: `bg_run` returns a task id right away, and `bg_logs` comes back
with the first few `tick N` lines — output of a job that is still running.
That property is exactly what the automated regression asserts: the
`bg_logs` result is not an error, contains early ticks, and does **not**
contain the final `tick 60` — so the only way the assertion passes is a real
mid-run read. If background jobs or the live read were broken, it fails.

Everyday uses once installed:

```text
/bg --name "typecheck watch" npm run typecheck -- --watch
/jobs
/logs <task-id> 20000
```

## Boundaries

- In one-shot headless runs the job lives only as long as the dsh process —
  background jobs are for "keep working while it runs", not for daemons that
  outlive the session.
- The package also ships `bg_delegate` (a route-pinned child agent) and a
  multi-model `fusion_*` family; this example verifies the background-job
  half only. The delegate/fusion half is exercised elsewhere in the Pi
  ecosystem but has not been end-to-end verified on DSH by us.
- The package's second entry point applies Anthropic OAuth attribution to
  Anthropic routes; with no Anthropic route configured it has nothing to do.
