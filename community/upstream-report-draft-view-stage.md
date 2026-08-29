On `dsh-v0.1.2-alpha.1` (built from the tag, `cd5ef814`), entering the **New Session draft view** swaps the main column to the empty state but leaves `list.current` pointing at the previously open session until the first message actually creates/stages the new one.

That contradicts the session store's own documented contract (`packages/api/session-controller/src/client/sessions/service.ts`):

> Staging is the open signal: the window opens ⟺ the session is on stage (the stage is `current` […])

On the draft screen the previous session's window is gone from the main column, yet `current` still names it — "on stage" and "what the main column shows" have come apart. On the rc line the draft screen cleared `current`, so this is a behavior change in the alpha line (our zero-residue assertions passed there and started failing here).

## Why it matters to plugin authors

Any frame-scoped client piece keyed on `current` — the store's documented way to follow the active session — renders the OLD session's UI on top of the New Session screen. In our case ([pi2dsh](https://github.com/weijiafu14/pi2dsh) / dsh-work-x) that was a floating side-conversation window carrying the previous session's thread, sitting over the brand-new empty view; the network trace confirms the component keeps polling the old session id the whole time the draft is on screen.

## Repro

1. Open a session and do something that gives it session-scoped floating UI (any client module keyed on `useSessions(s => s.current)`).
2. Click **New Session**.
3. The draft view shows; `current` is unchanged; the stale UI floats over the empty state. Send the first message and `current` finally moves.

## Our current workaround

An invisible beacon registered in a conversation-scoped seat (`conversation.session.header.utilities`): its mounted lifetime says which conversation is really in the main column, and frame-scoped pieces render only when `current` is also staged. It works on both generations — but it derives, from seat-mount lifetimes, a fact the store contract says `current` already carries.

## Ask

Either the draft view clears `current` (restoring the documented ⟺), or the store exposes the draft/staged fact explicitly (e.g. a `draft: boolean` beside `current`, or `current: undefined` while drafting) so frame-scoped consumers don't have to infer it. Happy to test a fix against our contract suite and report back.
