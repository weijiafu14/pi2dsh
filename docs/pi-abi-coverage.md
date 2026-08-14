# Pi ABI → DSH semantic coverage: the full verdict

Every public surface a Pi extension can touch — 114 items: 26 ExtensionAPI methods, 33 events, 24 ExtensionContext members, 28 ui members, 3 host-import packages — judged against DeepSeek Harness for an **equivalent-semantics mapping**. This is the answer to "can everything Pi convert, in principle?"

Verdict: **only 3 items have no DSH equivalent**. ~90 map directly; ~21 map approximately (different attachment point, loss stated in one sentence). Everything below uses public DSH mechanisms only — no monkey-patching, no private APIs.

Method note: usage claims for the risky surfaces come from a source survey of the top-50 corpus (event-listener bodies inspected package by package), not from guessing.

## RED — no equivalent DSH semantics (3)

| # | Pi surface | Real usage in top 50 | Assessment |
|---|---|---|---|
| R1 | **Plugin-rendered UI**: visible `ui.setWidget`, visible `ui.custom`, editor components | background-task detail panes and similar | The DSH web client has no plugin rendering channel. This is the **Web Client Slot** gap — upstream RFC territory; no in-bridge workaround exists that isn't fake |
| R2 | **Rewriting prior conversation messages** (one sub-use of `before_provider_request`: deleting/rewriting history in the outgoing payload) | **zero packages** — of the 6 packages touching this event, 2 are read-only observers and 4 decorate the *current* request's protocol shape; none touch history | Deliberately forbidden by DSH's log-reconstructability contract. Unhittable today; if a future package needs it, the assessment path is DSH's surface-replacing compaction bracket (`compaction/*`), which is open to any producer |
| R3 | **Project-trust model** (`isProjectTrusted`, `project_trust`) | trusted-branch reads (e.g. project-level settings loading) | DSH has no project-trust concept. The bridge answers "untrusted" — the most conservative branch. Packages degrade safely (skip project-scoped config) instead of breaking |

## YELLOW — approximate mapping, loss stated (21)

| Pi surface | DSH attachment point | Loss |
|---|---|---|
| `before_provider_request` (protocol decoration: gateway shapes, cache markers, attribution) | config-level changes → `agent/request` waterfall; whole-request transformation → `llm/stream` waterfall short-circuit + re-dispatch (`routing` is a documented use of that waterfall) | package logic runs through a bridge adaptation, not verbatim on a mutable payload |
| `before_provider_headers` | adapter/route layer (provider `headers`, credentials seam) | same as above |
| `after_provider_response` | `llm/stream` waterfall (observe/transform chunks before the loop consumes them) | header-level response facts only as adapters surface them |
| `input` (raw input transform) | `agent/pre-step` waterfall — replace the messages entering a step | none of substance |
| `ctx.fork` | `sessions.fork(source, boundary)` + `agents.create({seed})` | Pi: one session, many branches; DSH: one session per branch with `parentSession` lineage — representation differs, capability equal |
| `ctx.switchSession` | `agents.resume` | same representation note |
| `ctx.navigateTree` | resume/fork across sessions | same representation note |
| `ctx.newSession` | `agents.create` | — |
| `ctx.shutdown` | `Agent.cancel` + handle dispose | — |
| `ctx.compact` | DSH-native compaction bracket (`compaction/*` events; producer-open) | trigger surface wired at implementation time |
| `getContextUsage` | accumulate `assistant/message.usage` + `resolveModelInfo().context.contextWindow` | — |
| `modelRegistry.hasConfiguredAuth` | "adapter registered + credential reference resolvable" | configuration check, not key liveness (Pi's is also a config check) |
| `appendEntry` / `setLabel` | pi2dsh sidecar | not in DSH's canonical log (DSH's own third-party event registration is marked deferred — future upstream adoption path) |
| `sendMessage` (custom-rendered) | accepted, not rendered | identical to Pi's own rpc mode |
| `ctx.mode` | fixed `'rpc'` | — |
| `ctx.reload` | Cordis fiber reload semantics | — |
| `resources_discover` | DSH skill-registry projection | — |
| terminal decoration (footer / statusline / shortcuts / flags) | registered, never fired | identical to Pi's own non-TUI modes |
| `model_select` / `thinking_level_select` events | projections around the `agent/request` waterfall | — |
| billing attribution decoration | DSH adapter `attributionHeaders()` contract | — |
| `ctx.scopedModels` | llm catalog projection | — |

## GREEN — direct equivalent semantics (~90)

Everything else, grouped: tool registration/unregistration and per-agent shadowing (`register` via `agent.ctx` shadows global names — SSH-style overrides are first-class), commands, providers with Pi's full credential chain, the 33-event lifecycle projections not listed above, `ui.select/confirm/input/notify` on real userQuestions waits, exec on the subprocess seam, session read surfaces, model catalog (`llm.listProviders/listModels/resolveModelInfo` + `llm/adapters-updated`), current model (`Agent.options` + `request/header`), model switching (`agent/request` waterfall), designated-model calls (`ctx.llm.stream` with explicit provider/model), sub-agent creation (`agents.create` incl. `agentOptions.provider/model`), turn cancellation (`Agent.cancel`), per-step usage (`assistant/message.usage`), approval interception (`tools/pre-execute` waterfall + per-agent `guard()`), retry ownership (`agent/request-error`), skills, attachments (image refs), OAuth (four official flows + `auth.json` semantics + double-checked-lock refresh).

## The principle

A Pi package converts cleanly iff it does not require: (R1) plugin-rendered UI, (R2) history rewriting, (R3) a trusted-project branch. R1 waits on an upstream client slot; R2 has zero real-world usage in the corpus; R3 degrades conservatively instead of failing. Every other surface maps onto public DSH seams.
