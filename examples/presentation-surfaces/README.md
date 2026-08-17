# A Pi plugin's own chrome, drawn in DSH's web seats

Pi extensions do not only call tools — they **draw**. A status line while a job
runs, a widget listing what was found, a title, a spinner and its label, a card
the package renders itself, a line written straight into your composer, an
`@`-mention menu of its own entries. In Pi those land in a terminal UI. On DSH
they land in the **web shell's own slots**, through pi2dsh's browser half. The
Pi plugin is unmodified and knows nothing about any of it.

This matters more than it sounds: **33 of the 50 most-downloaded Pi plugins draw
something** (measured — see [Which plugins this is for](#which-plugins-this-is-for)).
Before this, all of that was invisible on DSH.

## Verified end to end: pi-powerline-footer

[`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) is a
real, unmodified npm plugin — a powerline-style status line showing the model,
thinking level, project and context usage. It is what this example installs,
and what the automated regression drives.

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-powerline-footer
```

That is the whole install — the pi2dsh engine mounts every Pi package in the
profile. Restart dsh afterwards: packages mount at startup.

If an add stops with `ERR_PNPM_IGNORED_BUILDS` (pnpm blocks dependency build
scripts by default): run `pnpm approve-builds` inside `$DSH_HOME/profiles/web`
— or set the listed packages to `true` under `allowBuilds` in that profile's
`pnpm-workspace.yaml` — then re-run the add.

Open the web app, start a session, and run the plugin's own command:

1. type `/powerline` in the composer;
2. **pick it from the suggestion popover** — it shares a prefix with
   `/powerline-perf`, so until one is picked the send button stays disabled;
3. send.

The status line appears above the composer, in DSH's widget dock:

```text
 DeepSeek-V4-Flash | think:off | pi2dsh | 0/1.0M (0.0%)
```

Colour included: the plugin emits terminal colour codes, and the browser half
paints them rather than printing them.

## Which plugins this is for

Measured by reading the source of the 50 most-downloaded Pi packages —
`node scripts/survey-surface-usage.mjs`, recorded in
[`community/surface-usage.json`](../../community/surface-usage.json).

| Surface | Plugins in the top 50 | Some of them |
| --- | --- | --- |
| `setStatus` / `setWidget` | 28 | `pi-mcp-adapter`, `@juicesharp/rpiv-todo`, `pi-btw`, `@narumitw/pi-plan-mode`, `pi-fabric` |
| `setTitle` / `setHeader` / `setFooter` | 6 | `pi-powerline-footer`, `@narumitw/pi-statusline`, `pi-zentui` |
| working message / indicator / hidden-thinking label | 4 | `mitsupi`, `pi-cc-extensions`, `pi-zentui` |
| `registerMessageRenderer` / `registerEntryRenderer` / `appendEntry` | 14 | `pi-btw`, `pi-lens`, `@tintinweb/pi-subagents`, `@ff-labs/pi-fff` |
| `setEditorText` / `pasteToEditor` / `getEditorText` | 10 | `@juicesharp/rpiv-voice`, `pi-ask-user`, `@narumitw/pi-plan-mode` |
| `addAutocompleteProvider` | 2 | `@ff-labs/pi-fff`, `pi-cc-extensions` |

**What this table is and is not.** It counts **call sites in package source** —
which plugins would use these seats. It is not a claim that each plugin works:
that only comes from running one. Exactly one plugin here is verified end to
end (`pi-powerline-footer`, by the regression below); the rest are "the bridge
covers the surface they call", which is a weaker statement and is the reason
this paragraph exists.

## Where each call lands

Pi components render **text** — their contract is `render(width) => string[]` —
so the honest projection into a browser is that text, in the DSH slot that means
the same thing:

```text
Pi call                        pi2dsh (server half)         DSH web seat
ui.setStatus / setTitle    ->  per-session surface store ->  shell.overlay
ui.setHeader               ->                            ->  session.header.utilities
ui.setWidget               ->                            ->  conversation.input.dock
ui.setFooter / working*    ->                            ->  conversation.composer.dock
appendEntry / sendMessage  ->  sidecar + custom types    ->  conversation.chat.turnTail
ui.setEditorText / paste   ->  draft request             ->  inputActions.setDraft
ui.addAutocompleteProvider ->  provider chain            ->  ctx.inputTriggers ('@')
```

The browser half is a normal DSH client plugin (`dsh.client`) reading its own
route (`/pi2dsh/…`); it does not touch DSH's internal RPC contracts. Every
surface above has its own contract test in
[`tests/presentation-surfaces.spec.ts`](../../tests/presentation-surfaces.spec.ts)
— a real Pi extension calling the real Pi method, read back through the real
route.

## Reproduce the check

```bash
ONLY=presentation-surfaces node scripts/verify-examples-e2e.mjs
```

A fresh temporary DSH home, the engine and `pi-powerline-footer` installed from
npm, the real web app driven in a browser, and an assertion that the dock holds
the plugin's own status line **and no raw escape codes**.

## If nothing appears

- **The command is not in the popover.** The package did not mount. `dsh plugin
  --profile web list` should show it; mounting happens at startup, so restart
  after adding.
- **The send button stays disabled.** A slash command whose prefix matches more
  than one command has to be picked from the popover first.
- **Nothing at all, no console error.** The browser half did not load. Check
  that the profile's `pi2dsh` has `dist/client.js`; a partial install is the
  usual cause — re-run the add and restart dsh.
