# Pi ABI inventory and DSH coverage boundary

This page is the accounting note behind the generated per-surface tables. It no
longer claims that a successful runtime mapping proves architectural equivalence;
each row is now a leaf in the
[architecture mapping standard](architecture-mapping-standard.md), with its
capability contract and theoretical DSH mapping generated from the single
[architecture ledger](architecture-ledger.json).

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

Packages can also import **202 runtime symbols** from the three Pi packages served
by the bridge: 111 from `pi-coding-agent`, 74 from `pi-tui`, and 17 from `pi-ai`.
Those imports are a separate compatibility surface; they are not three extra ABI
items and must not be mixed into the 111 denominator.

## Known accounting mismatch

The generated capability table currently says **112** because
`src/compatibility.ts` includes `unregisterTool`. The bridge may keep that method as
a compatibility extension, but Pi 0.84.1 does not declare it on `ExtensionAPI`.
Until the generator separates upstream members from bridge extensions, use these
two numbers deliberately:

- **111** — the pinned upstream Pi runtime ABI;
- **112** — the bridge's current rule rows, including one bridge-only extension.

After removing that extra row from the upstream denominator, the present runtime
labels are **23 same semantics · 83 mapped with a stated difference · 5 not
available**. These labels describe what a package receives; they are not a DSH
architecture score.

## Area inventory

| Area | Upstream surfaces | Current runtime labels |
|---|---:|---|
| Tools | 11 | 2 same · 9 mapped with a difference |
| Commands, flags and editor input | 13 | 13 mapped with a difference |
| Messages, context and the agent loop | 20 | 9 same · 11 mapped with a difference |
| Sessions, branching and side conversations | 24 | 6 same · 18 mapped with a difference |
| Models, providers and credentials | 15 | 1 same · 11 mapped with a difference · 3 unavailable |
| Asking the user and rendering | 24 | 4 same · 20 mapped with a difference |
| Project environment, skills and resources | 4 | 1 same · 1 mapped with a difference · 2 unavailable |
| **Total** | **111** | **23 same · 83 mapped · 5 unavailable** |

The generated, implementation-facing details remain in
[`docs/capabilities/`](capabilities/README.md). They include the extra
`unregisterTool` row until the generator's upstream drift check is implemented.

## Why the old “only three gaps” verdict was wrong

It mixed several unlike things into one bucket:

- a native DSH service mapping and a pi2dsh sidecar were both called “mapped”;
- an event that registers but never fires was counted beside an authoritative
  waterfall;
- Pi terminal-only host behavior was counted beside portable plugin semantics;
- bridge work still to do was sometimes attributed to DSH;
- the DSH module and Cordis lifecycle coverage were not audited at all.

The five currently unavailable surfaces are also not one architectural class:

- `before_provider_request`, `before_provider_headers`, and
  `after_provider_response` need a real adapter wire lifecycle seam when a plugin
  does not own the transport;
- `project_trust` needs a host-owned decision before untrusted project resources
  load;
- `resources_discover` can be translated onto existing DSH provider seams and is
  currently pi2dsh work, not proof of a DSH limitation.

High-risk partial rows need the same separation. For example, custom session
entries live in a sidecar, `getContextUsage()` has not yet been projected from
DSH's token meter, Pi session-tree lifecycle events do not all fire, and several
TUI component factories intentionally become Web-native text or slots rather than
executing a terminal component in the browser.

## Completeness rule

Do not say “Pi is fully covered” until all three statements are true:

1. an automated drift check proves that every member of the pinned upstream Pi
   declarations has exactly one rule and bridge-only extensions are outside the
   denominator;
2. every runtime row has an architecture verdict with its authoritative DSH
   service, state owner, lifecycle, and evidence;
3. the 45 DSH subsystems and Cordis lifecycle promises have their own explicit
   coverage status, including unload, provider replacement, isolation, and failed
   reload rollback.
