# Side conversations that leave the main thread alone

Ask something off-topic mid-session — "wait, who wrote Dune?" — without
derailing the conversation you are in. The Pi plugin **pi-btw** turns
`/btw <question>` into a separate thread; on DSH that thread is a real child
session, so it appears in DSH's own subagent list, opens in its own view with
its own composer, and **the main conversation gains nothing but a status
line**. Works in the DSH CLI and the DSH web app.

Everything below is copy-paste runnable and was verified end to end on a real
DSH loop — CLI and web. The screenshots in
[`../../docs/posting-kit/assets/`](../../docs/posting-kit/assets/) come from
this exact flow.

## 1. Install the engine, then the plugin

```sh
dsh plugin --profile <your-profile> add pi2dsh
dsh plugin --profile <your-profile> add pi-btw
```

That's the whole install: the pi2dsh engine mounts every Pi package you add to
the profile — no conversion step, no generated bundles.

If an add stops with `ERR_PNPM_IGNORED_BUILDS` (pnpm blocks dependency build
scripts by default): run `pnpm approve-builds` inside
`$DSH_HOME/profiles/<your-profile>` — or set the listed packages to `true`
under `allowBuilds` in that profile's `pnpm-workspace.yaml` — then re-run the
add command. Restart dsh afterwards: packages mount at startup.

## 2. Ask a side question

Start a session and ask something normal:

```sh
dsh --profile <your-profile>
```

```text
Name three classic sorting algorithms, one line each.
```

Then take a detour:

```text
/btw who wrote the novel Dune? name only
```

The answer (`Frank Herbert.`) comes back in a thread of its own. Your main
conversation still holds only the sorting-algorithm exchange plus one
`btw · Completed` line.

In the web app (`dsh web`), the same two messages give you:

| Screenshot | What it shows |
|---|---|
| `01-side-conversation-main-thread-clean.png` | The main thread after the side question: sorting algorithms, `btw · Completed`, and a `1 subagent` control in the header. No trace of Dune. |
| `02-side-conversation-host-catalog.png` | DSH's own subagent list, with a `pi-btw side conversation` row (`continuable · not running`) |
| `03-side-conversation-injected-on-request.png` | After `/btw-inject`: the thread enters the main conversation as a context injection, and only then |
| `04-side-conversation-child-view.png` | The side thread opened: its own breadcrumb, its own composer, `Frank Herbert.` inside it |

Type `/btw` at the start of the composer to see the whole family in the
command palette — `/btw-new`, `/btw-tangent`, `/btw-summarize`,
`/btw-inject`, `/btw-model`, `/btw-clear`.

## 3. Bring an answer back, when you want it

Nothing is merged into the main conversation automatically — that stays your
explicit action, through the plugin's own commands:

```text
/btw-inject
```

injects the side thread into the main conversation as a context injection —
the main model then sees it and can act on it (`btw-inject · Injected BTW
thread (3 exchanges).`).

```text
/btw --save what year was Dune first published? year only
```

asks in the side thread and records the answer as the plugin's own note
(`btw · Saved BTW note to the session.`) — the answer itself still stays out
of the main conversation.

## 4. Reproduce the screenshots

With a DSH web instance running and this profile loaded:

```sh
PLAYWRIGHT_FROM=<a-project-that-has-playwright> \
  node docs/posting-kit/capture-screenshots.mjs out-dir --url http://127.0.0.1:<port>
```

The script drives the same two messages and **asserts** the property the
pictures are meant to show: it fails if the side answer ever appears in the
main conversation. Add `--locale zh-CN` for the Chinese UI.

## What this exercises in pi2dsh

- `createAgentSession` bridged onto a real DSH child agent (`ctx.agents`),
  with the parent's lineage and delegation depth carried across
- Pi's public, settable `AgentState.messages`: pi-btw seeds the side thread by
  assigning a transcript, which the bridge carries into the child's next
  prompt as a `<prior-conversation>` context injection
- the host's own child identity event (`subagent/descriptor`) appended inside
  the child's log — what makes DSH list the thread, name it after the package
  that started it, and reopen it as continuable
- Pi commands with arguments in the DSH web palette (every bridged command
  declares an input descriptor, so `/btw <question>` is parsed as a command
  and not sent as chat)
- Pi's numbered-collision naming translated to DSH's (`/btw:summarize` →
  `/btw-summarize`)
