# Pi ABI inventory and DSH coverage boundary

This page is the accounting note behind the generated per-surface tables. It no
longer claims that a successful runtime mapping proves architectural equivalence;
each row is now a leaf in the
[architecture mapping standard](architecture-mapping-standard.md). Its capability
contract and theoretical DSH mapping are maintained in the expandable Markdown
[architecture matrix](architecture-mapping-matrix.md), not generated from this count.

## Pinned upstream inventory

Baseline: `@earendil-works/pi-coding-agent` 0.84.1.

The current rules track **111 upstream-shaped runtime rows**:

| Upstream surface family | Count |
|---|---:|
| Non-event `ExtensionAPI` members | 25 |
| Event names accepted by `ExtensionAPI.on()` | 33 |
| Non-UI `ExtensionContext` + `ExtensionCommandContext` members | 24 |
| `ExtensionUIContext` members | 28 |
| Selected nested registry method (`modelRegistry.hasConfiguredAuth`) | 1 |
| **Total** | **111** |

This is not yet a count of every nested callable. For example, the
`sessionManager` row represents its multi-method contract as one surface, while
`modelRegistry.hasConfiguredAuth` is broken out because the bridge gives it a
separate runtime verdict. A complete upstream drift audit must check those nested
contracts too, not merely reproduce the total 111.

Packages can also import runtime symbols from the three Pi packages served by the
bridge. Those imports are a separate compatibility surface; they are not extra ABI
items and must not be mixed into the 111 denominator. Their live, per-symbol list
and counts are generated in [`capabilities/imports.md`](capabilities/imports.md) —
this page does not restate them, because the bridge's export set changes as compat
work lands and a hand-copied number here goes stale (it did once).

## Bridge-only extensions

`src/compatibility.ts` also includes `unregisterTool`. The bridge keeps that method
as a compatibility extension, but Pi 0.84.1 does not declare it on `ExtensionAPI`.
The generator now documents it separately and excludes it from the upstream
denominator:

- **111** — the pinned upstream Pi runtime ABI;
- **1 bridge-only extension** — tracked separately from the upstream snapshot.

## Where the live runtime labels are

The per-surface runtime labels (same semantics / mapped with a stated difference /
not available) and their per-area totals **live only in the generated pages** under
[`docs/capabilities/`](capabilities/README.md), which `pnpm check:docs` keeps in
lockstep with `src/compatibility.ts`. This page deliberately does not restate
those numbers: they change whenever bridge work lands, and a hand-maintained copy
here went stale once already (the `before_provider_request` upgrade moved a
surface from unavailable to mapped while this page still said otherwise). The
tools page shows the extra `unregisterTool` row while keeping it outside upstream
totals. Either way, these labels describe what a package receives; they are not a
DSH architecture score.

## Why the old “only three gaps” verdict was wrong

It mixed several unlike things into one bucket:

- a native DSH service mapping and a pi2dsh sidecar were both called “mapped”;
- an event that registers but never fires was counted beside an authoritative
  waterfall;
- Pi terminal-only host behavior was counted beside portable plugin semantics;
- bridge work still to do was sometimes attributed to DSH;
- the DSH module and Cordis lifecycle coverage were not audited at all.

The currently unavailable surfaces (see the generated pages for the live list) are
also not one architectural class:

- `before_provider_headers` and `after_provider_response` need a real adapter wire
  lifecycle seam when a plugin does not own the transport
  (`before_provider_request` is bridged for package-owned transports since
  0.13.x — the DSH-native-adapter half of it remains `DSH-ARCH-003`);
- `project_trust` needs a host-owned decision before untrusted project resources
  load;
- `resources_discover` can be translated onto existing DSH provider seams and is
  currently pi2dsh work, not proof of a DSH limitation.

High-risk partial rows need the same separation. For example, custom session
entries live in a sidecar, `getContextUsage()` has not yet been projected from
DSH's token meter, Pi session-tree lifecycle events do not all fire, and several
TUI component factories intentionally become Web-native text or slots rather than
executing a terminal component in the browser.

## What this snapshot can and cannot prove

Do not say “Pi is fully covered” from these totals. A defensible conclusion still
requires all of the following kinds of evidence:

1. the pinned upstream declarations, including nested callables, have been reviewed
   and bridge-only extensions remain outside that versioned snapshot;
2. every discovered runtime leaf has an architecture verdict with its authoritative DSH
   service, state owner, lifecycle, and evidence;
3. the discovered DSH subsystems and Cordis lifecycle promises have their own explicit
   coverage status, including unload, provider replacement, isolation, and failed
   reload rollback.

The inventory is open-ended: a newly discovered Pi interface or DSH module is added
under the relevant Markdown architecture branch. CI must not hard-code 111 or 45 as
permanent completeness boundaries.
