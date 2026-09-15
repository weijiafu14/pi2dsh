# Persistent memory across sessions: pi-hermes-memory on DSH

[`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory) adds
cross-session facts, preferences, corrections, skills, and conversation search.
The original package runs through pi2dsh using DSH's model and tool services.

The September 10 acceptance covers the six tools and ten commands in 0.9.8,
including automatic review, correction capture, skill maintenance and overflow
consolidation. These fixes require **pi2dsh 0.25.0 or later**.
See the [versioned capability results](../../docs/plugin-validation-matrix.md#pi-hermes-memory)
and [evidence](../../community/hermes-memory-20260910/final/README.md).

## Install

```sh
dsh plugin add pi2dsh
dsh plugin add pi-hermes-memory
```

`pi-hermes-memory` builds a native SQLite store (`better-sqlite3`), which
pnpm's build-script gate blocks by default. That gate is the host's security
door — approve it explicitly rather than working around it:

```sh
# inside the profile directory, if the install reports ERR_PNPM_IGNORED_BUILDS
pnpm approve-builds   # select better-sqlite3
```

or add to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  'better-sqlite3': true
```

Restart dsh after installing.

## Try it — the two-session proof

Session one — tell it something durable:

```text
Remember this durable project fact for future sessions: my project codename
is ZEPHYR-7741. Save it to persistent memory now.
```

Expected: the agent calls `memory_add` and confirms.

Now start a **new session** (new conversation, fresh context) and ask:

```text
What is my project codename? Answer with just the codename.
```

Expected: `ZEPHYR-7741` — recalled from the plugin's store, because nothing
else in the new session ever saw it. That property is exactly what the
automated regression asserts: the codeword appears in no user input of the
second session, the first session's `memory_add` result is not an error, and
the second session still answers it.

Useful commands once installed: `/memory-index-sessions` (index your past
sessions for `session_search`), `/learn-memory-tool`, `/memory-insights`,
`/memory-pin` (standing instructions with a hard budget).

## Boundaries

- The package's own secret scanner refuses to store things that look like
  API keys or tokens; that is its behavior, not the bridge's.
- Background review uses the package's cadence and DSH's native model route.
  The two-session example exercises explicit saving; background review has a
  separate test with no foreground write tools.
- Conversation search consumes a derived Pi-format transcript; DSH remains the
  restore authority. This is graded as a sidecar translation.
- Bare Web uses the package's read-only fallback for terminal-only managers.
- A successful compaction flush does not provide Pi's awaited veto/replace
  contract. Full-process shutdown cannot guarantee a fresh model call finishes
  before DSH closes its services; save important facts during the session.
