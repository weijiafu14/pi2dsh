# A Pi package's own chrome, drawn in DSH's web seats

Pi extensions do not just call tools — they **draw**. A status line while a
long job runs, a widget listing what was found, a title for the session, a
spinner and its label, a custom card the package renders itself, a line it
writes straight into your composer, an `@`-mention menu of its own entries.
In Pi's terminal UI those land in the TUI. On DSH they land in the **web
shell's own slots**, through pi2dsh's browser half. The Pi package is
unmodified and knows nothing about any of it.

This example ships a small Pi package,
[`pi-surface-demo`](pi-surface-demo/), that touches **every one of those
surfaces once** with a unique string, so you can see which call drew which
line. It is the reference for "where does my Pi package's UI go on DSH".

Everything below is copy-paste runnable and was verified end to end on a real
DSH web app.

## 1. Install the engine, then the demo package

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add file:./examples/presentation-surfaces/pi-surface-demo
```

The path is relative to your checkout of this repository; an absolute path
works too. That's the whole install — the pi2dsh engine mounts every Pi
package in the profile, no conversion step and no generated bundles.

If an add stops with `ERR_PNPM_IGNORED_BUILDS` (pnpm blocks dependency build
scripts by default): run `pnpm approve-builds` inside `$DSH_HOME/profiles/web`
— or set the listed packages to `true` under `allowBuilds` in that profile's
`pnpm-workspace.yaml` — then re-run the add command.

Restart dsh afterwards: packages mount at startup.

## 2. Run the command

Open the web app, start a session, and type `/surfaces` in the composer —
pick it from the suggestion popover as you would any DSH command.

No model call happens: the whole command is the package drawing.

## 3. What you should see

| Where on screen | Text | The Pi call behind it |
| --- | --- | --- |
| Pills, top of the overlay | `title: demo session` · `status: demo is live` | `ui.setTitle` · `ui.setStatus` |
| Above the conversation | `header: built by factory` | `ui.setHeader` |
| Input dock | `widget: line one` / `widget: line two` | `ui.setWidget` |
| Composer dock | `footer: built by factory`, `working: still thinking`, `◐◓`, `thinking-label: hidden reasoning` | `ui.setFooter` · `ui.setWorkingMessage` · `ui.setWorkingIndicator` · `ui.setHiddenThinkingLabel` |
| End of the turn | `entry(demo-note): rendered by the package itself` | `pi.appendEntry` + `registerEntryRenderer` |
| End of the turn | `message(demo-msg): custom message drawn by the package` | `pi.sendMessage({role:'custom'})` + `registerMessageRenderer` |
| The composer itself | `composer: written by the package + pasted` | `ui.setEditorText` + `ui.pasteToEditor` |

Then type `@demo` in the composer: the menu offers **demo-alpha** and
**demo-beta**, from the package's own `ui.addAutocompleteProvider`. Pick one
and it is inserted. Pi's autocomplete is a chain — the demo wraps the provider
it was handed and falls through for anything that is not an `@`-mention, so
DSH's own menu keeps working.

## How it works

Pi components render **text**: their contract is `render(width) => string[]`.
So the honest projection into a browser is that text, in the DSH slot that
means the same thing:

```text
Pi call                       pi2dsh (server half)          DSH web seat
ui.setStatus/setTitle    ->   per-session surface store ->  shell.overlay
ui.setHeader             ->                             ->  session.header.utilities
ui.setWidget             ->                             ->  conversation.input.dock
ui.setFooter/working*    ->                             ->  conversation.composer.dock
appendEntry/sendMessage  ->   sidecar + custom types    ->  conversation.chat.turnTail
ui.setEditorText/paste   ->   draft request             ->  inputActions.setDraft
ui.addAutocompleteProvider->  provider chain            ->  ctx.inputTriggers ('@')
```

The browser half is a normal DSH client plugin (`dsh.client`), reading its own
route (`/pi2dsh/…`) — it does not touch DSH's internal RPC contracts. Details
in [`../../docs/capabilities/`](../../docs/capabilities/).

## Reproduce the check

The regression that keeps this example honest drives the real web app and
asserts each seat holds the package's own string:

```bash
ONLY=presentation-surfaces node scripts/verify-examples-e2e.mjs
```

## If a surface is blank

- **Nothing at all, no console error.** The browser half did not load. Check
  that the profile's `pi2dsh` has `dist/client.js`; a partial install is the
  usual cause — re-run the add and restart dsh.
- **The command is not in the popover.** The package did not mount. `dsh
  plugin --profile web list` should show `pi-surface-demo`; mounting happens at
  startup, so restart after adding.
- **Pills show but the turn-tail lines do not.** Those two need the session to
  have a turn to attach to — send one ordinary message first, then `/surfaces`.
