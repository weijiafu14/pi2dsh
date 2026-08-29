Your 2026-08-25 note ("Require known session event types on read") ends with exactly the door this post walks through:

> Repository-external `SessionEventMap` members remain outside the generated set. They can run and persist during the live process, but a first-party persistence reader refuses them on reload **until a real external-event consumer justifies a registration mechanism.**

We are that consumer, with shipped code and a cost ledger.

## Who / what

[pi2dsh](https://github.com/weijiafu14/pi2dsh) runs unmodified Pi-ecosystem plugins on DSH. Pi's public API includes `appendEntry` / custom entry kinds: packages write their own conversation-adjacent facts (e.g. `pi-btw` records side-conversation summaries and injection markers). On DSH we currently keep those OUT of the native log, in a per-session sidecar archive, precisely because external event types are not first-class.

## The cost of the sidecar (why registration beats it)

- The entries are invisible to everything that derives from the native log — replay, fork/resume, projection caches, session transport, telemetry. A fork of a session silently loses the plugin's facts.
- It is a second authority store, with exactly the drift risks your own architecture notes warn against.
- Under the new fail-closed reader the wall is now explicit: appending one external type today produces `SessionFormatUnsupportedError` on the next load (event name + sequence named in the diagnostic — repro below, on `dsh-v0.1.2-alpha.1`).

## Repro (dsh-v0.1.2-alpha.1, built from the tag)

Take any healthy session artifact, append **one** event of an external type at the next seq (we cloned a real session's `session.jsonl.zstd`, kept the header frame verbatim, and added `{"type":"pi2dsh/probe","seq":45,"time":…,"data":{…}}` as the last event row), then open that session from the web surface's session list. The history pane refuses with:

```
Failed to load history: failed to observe session "session-aaaaaaaa-…":
session "session-aaaaaaaa-…" contains event type "pi2dsh/probe" (seq 45)
unknown to this harness; refusing to interpret the log — it was likely
written by a newer harness (raw log: …/session.jsonl.zstd)
```

Which is exactly the designed behavior — the diagnostic is precise and the refusal is loud. Our point is only that for a *registered* external type this refusal is the wrong outcome, and the note above already anticipates that.

## Shape we'd propose (aligned with the note's invariants)

1. **Namespaced types**: external members register as `<package>:<type>`; the bare vocabulary stays first-party-only, so the generated `KNOWN_SESSION_EVENT_TYPES` set never collides.
2. **Declared surface posture at registration**: either surface-eligible with an explicit `SurfaceOp` (the registrant accepts the reconstruction invariant), or declared non-surface — excluded from request reconstruction by REGISTRATION, not by silent tolerance, so an older reader's refusal stays loud for unregistered types and skipping stays sound for registered non-surface ones.
3. **Decoder ownership**: the declaring package owns its versioning/migration, mirroring your per-package format registry: a missing declarer at load time keeps today's refusal (fail-closed is preserved — the mechanism only moves the boundary from "repository membership" to "registration").

Happy to build against a draft of this seam and report back with the same evidence discipline as above — we run contract tests against stock npm releases and keep a public compatibility ledger, so a trial consumer with reproducible results is cheap for you to have.
