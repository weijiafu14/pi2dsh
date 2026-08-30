# Persistent memory across sessions: pi-hermes-memory on DSH

DSH sessions forget everything when they end. The Pi ecosystem's
[`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory) fixes that
— durable facts, corrections and preferences that survive across sessions,
plus full-text search over past conversations — and it runs unmodified on DSH
through pi2dsh.

What the bridge carries for this package: its five tools (`memory_add`,
`memory_replace`, `memory_remove`, `memory_search`, `session_search`), its ten
`/memory-*` commands, its `before_agent_start` system-prompt injection (the
memory context every new session starts with), and its background review
loop. Its store lives in the bridge's redirected Pi agent directory, so it
never collides with a real Pi installation on the same machine.

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
- Background review runs on the package's own cadence (every ~10 turns); the
  two-session proof above uses the explicit save path, which is deterministic.
