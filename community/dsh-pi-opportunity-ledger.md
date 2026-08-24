# DeepSeek Harness discussions × Pi ecosystem opportunity ledger

Last audited: 2026-08-21 (Asia/Shanghai)

> **Provider-count correction:** do not use this file's historical 70-thread
> Provider candidate set as the size of the Provider problem space. A fresh
> full-repository audit found **274 Provider-related discussions**; the current
> root-cause clusters, exact ids and reply status live in
> [`dsh-provider-root-audit.md`](dsh-provider-root-audit.md). The 70 below is
> retained only as the earlier “already mapped to a possible Pi Provider route”
> subset so the older 431-opportunity arithmetic remains reproducible.

This ledger answers a narrower, useful question: among the 431 DeepSeek Harness
discussions previously selected for broad Pi/DSH ecosystem relevance, which
ones have a credible solution path through **any part of the Pi extension
ecosystem**, not only Provider registration?

It deliberately separates four claims:

1. a Pi package with a relevant feature exists;
2. that package mounts through pi2dsh;
3. the exact scenario has passed a real DSH end-to-end test;
4. the discussion has received a relevant reply from `weijiafu14`.

Those are not interchangeable.

## Census

- DSH discussions audited: **431**
- Current comments on those discussions: **555**
- Discussions already touched by `weijiafu14`: **81** (**82** comments)
- Pi extension packages in the current official catalog: **3,280**
- Conservative Pi Provider-route candidates: **70**
- Non-Provider Pi-extension opportunities: **126**
- Overlap between those two sets: **3** (`#1765`, `#2329`, `#3226`)
- Unique discussions in either candidate line: **193 / 431**
- Not currently mapped to an equivalent Pi-extension solution: **238 / 431**

The 193 figure is a candidate inventory, not a claim that every item is already
solvable by installing a Pi package. It contains exact package matches, alternate
Provider routes, host configuration gaps and upstream protocol defects; the
sections below keep those states separate. Of the 193 candidates, 76 have
already received a relevant pi2dsh reply and
117 have not. “Replied” is recorded as community activity, not silently
upgraded to “resolved”.

## Pi Provider-route candidate line: 70 discussions

These 70 are the discussions currently mapped to a possible Pi Provider route
or Provider-owned transport. They are **not** a count of every DSH discussion
whose topic or root cause involves models, Provider configuration, OAuth,
credentials or wire protocols. That broader primary-cause count has not yet
been established by this ledger and must not be inferred as 70. In particular,
a DSH
profile's static `headers` map, Pi's dynamic provider events and a package-owned
transport are three different surfaces:

- `llm-pi-ai.providers.<route>.headers` is static host configuration. It can
  carry non-secret deployment headers; it is not an event hook, cannot safely
  interpolate an arbitrary secret, and Harness attribution wins reserved names
  such as `User-Agent`.
- `before_provider_request` sees and may replace the final **body**, only when
  the installed Pi package owns the transport.
- `before_provider_headers` and `after_provider_response` are not available in
  pi2dsh. A DSH-native adapter consumes those values behind its own boundary.

### A. Current path demonstrated and already replied: 26

`#208`, `#472`, `#473`, `#551`, `#636`, `#843`, `#990`, `#1064`,
`#1208`, `#1272`, `#1309`, `#1643`, `#1705`, `#2007`, `#2023`,
`#2277`, `#2388`, `#2489`, `#2587`, `#2637`, `#2804`, `#3004`,
`#3076`, `#3330`, `#3397`, `#3531`.

Evidence already available in the repository includes package-owned Pi
transports becoming native DSH routes, catalog-only providers being translated
into the official `llm-pi-ai` adapter, reasoning settings reaching the outgoing
request, compatibility fields surviving the bridge, and OpenAI Codex OAuth
driving a real DSH model call.

### B. Existing Provider route/package, exact service scenario still needs E2E: 32

`#444`, `#611`, `#634`, `#664`, `#1063`, `#1073`, `#1580`, `#1682`,
`#1765`, `#1780`, `#1786`, `#1806`, `#1861`, `#1866`, `#2128`,
`#2170`, `#2296`, `#2329`, `#2330`, `#2354`, `#2363`, `#2375`,
`#2703`, `#2849`, `#2894`, `#2943`, `#3200`, `#3226`, `#3270`,
`#3495`, `#3538`, `#3566`.

These are not ready for a “works for your endpoint” reply merely because one of
the 98 screened Provider packages formed a route. Each needs the endpoint's
credential/login and a real DSH request that exercises the disputed behavior.

### C. Mixed unresolved/current-upstream cases: 12

`#599`, `#2299`, `#2382`, `#2383`, `#2475`, `#2602`,
`#2668`, `#2822`, `#2956`, `#3090`, `#3225`, `#3283`.

These twelve do **not** share one missing generic Provider. Two now have an
exact Pi package candidate (`#2382`, `#2383`); one is covered by current static
DSH header configuration for its stated non-secret use (`#2475`); one is only
partly covered because its UI/secret-header semantics remain (`#2602`); four
need an exact package-owned alternate route or upstream request/auth work
(`#599`, `#2668`, `#2822`, `#3283`); three are wire-parser defects
(`#2299`, `#2956`, `#3090`); and host-wide application identity (`#3225`)
cannot be implemented by a Pi Provider route. The earlier proposal to solve
eleven of them with one configurable gateway package was incorrect.

### Work needed to unlock the 44 unreplied Provider discussions

The work should be batched by transport behavior, not by discussion number.

1. **Provider setup, credentials and concrete service E2E — 12 discussions**
   (`#611`, `#634`, `#664`, `#1063`, `#1073`, `#1806`, `#1866`,
   `#2128`, `#2170`, `#2354`, `#2943`, `#3538`). Reuse the existing
   OpenCode, Copilot, Ollama/local and LiteLLM providers. TokenHub and AMD
   TokenFactory need either a proven generic OpenAI-compatible Pi provider or
   a small service package. For every route: start from a clean profile, store
   the real credential through the intended path, see its models, complete a
   real turn and prove the credential is absent from logs/artifacts. `#2170`
   additionally needs a composition example that does not require the official
   DeepSeek route; merely selecting LiteLLM does not remove a broken mandatory
   route.
2. **Catalog and capability projection — 12 discussions** (`#444`, `#1682`,
   `#1765`, `#1786`, `#2329`, `#2330`, `#2375`, `#2849`, `#3200`,
   `#3226`, `#3270`, `#3566`). Exercise providers that discover/update their
   catalog after mount and assert four fields at both list and exact resolve:
   `contextWindow`, `maxTokens`, image input and `reasoningEfforts`. Then prove
   the same values appear in the DSH selector and affect a real request. The
   bridge already projects these fields; the unproved part is dynamic
   discovery/re-announcement with the named services and local servers.
3. **Existing transport/compat path under exact failure conditions — 8
   discussions** (`#1580`, `#1780`, `#1861`, `#2296`, `#2363`, `#2703`,
   `#2894`, `#3495`). Record the outgoing request and run the disputed
   multi-turn/tool sequence. `#1780` is the architectural risk: if switching
   from a foreign route still loses provider-required reasoning history, the
   bridge needs a history/signature normalization rule. `#2363` and `#2703`
   can only be advertised as an alternative credential/route path; they do not
   repair DSH's own Models-page save/overwrite bug.
4. **Request body, Fast mode and session affinity — 4 discussions** (`#599`,
   `#2382`, `#2383`, `#2822`). For `#2382/#2383`, first run the current
   `pi-openai-codex-fast` package through a clean DSH Codex-OAuth E2E: it owns a
   transport and explicitly passes `serviceTier: "priority"`; no generic
   gateway should be written first. `#599` needs a package-owned route to prove
   that the DSH session id reaches the Pi stream and is deliberately mapped to
   `metadata.user_id`/`user`; that is an alternate route, not a fix for every
   DSH provider. `#2822` needs either a package-owned model carrying
   `sessionAffinityFormat: "openai-nosession"` or the same field exposed by the
   official adapter. Neither is a header event implemented by pi2dsh.
5. **Static headers, secret auth and host attribution — 4 discussions**
   (`#2475`, `#2602`, `#2668`, `#3225`). `#2475`'s stated non-secret routing
   header is current `llm-pi-ai` static configuration and needs a versioned
   smoke/reply, not a Pi package. `#2602` remains partial: static headers and
   context capacity are configurable, but an arbitrary secret-valued header
   cannot safely be placed there. `#2668` needs an Anthropic Bearer-vs-x-api-key
   credential style in the official adapter or an exact transport-owning Pi
   Provider. `#3225` asks for one host-wide `AppIdentity` across every adapter;
   a Pi route cannot change that host invariant and must not be advertised as
   a solution.
6. **Wire-parser defects — 3 discussions** (`#2299`, `#2956`, `#3090`).
   Reproduce each captured wire shape against both the current DSH adapter and
   current Pi transport. Fix the parser that actually consumes that protocol:
   absent `finish_reason`, Anthropic streams ending without `message_stop`, and
   null/empty tool identity are not one generic post-response policy. pi2dsh
   exposes no `after_provider_response` hook, so a post-processing-only plugin
   cannot solve them.
7. **CLI-as-provider safety contract — 1 discussion** (`#3283`). Build and
   test a Provider package that owns process spawning, forces each CLI into a
   no-tools/read-only posture, supports cancellation and process-group cleanup,
   normalizes its stream into Pi events and exposes fallback routing. A README
   containing safe flags is not an E2E provider.

Strictly speaking, `#1493` is not a Provider problem. It asks for durable
subagent product-session attribution and intermediate observability, so it is
tracked under the non-Provider subagent/session line instead.

## Non-Provider Pi extension line: 126 discussions

The rows below use one primary Pi mechanism per discussion so that the total is
deduplicated. A multi-topic thread may legitimately fit more than one row; only
`#1732` is counted in two rows below, so the raw row total is 127 and the unique
total is 126.

| Pi capability | Threads | Already replied | Existing Pi packages / bridge evidence | What remains before new promotion |
|---|---:|---:|---|---|
| Vision, image admission and image-to-text | 41 | 28 | `@kassing/pi-vision`, `pi-vision-tool`; CLI + Web image E2E exists | 13 unreplied cases need per-scenario routing/UI/local-model checks |
| Provider-independent web search | 8 | 5 | `@juicesharp/rpiv-web-tools` runtime E2E; `pi-web-access` provides many engines, recency and domain filters | Freshness/routing claims in 3 unreplied threads need exact E2E |
| Subagents and explicit per-child models | 20 | 12 | pi2dsh child-session/model bridge exists; `@tintinweb/pi-subagents` has model pins and background execution | Run that real package through Web/CLI against stale-model and attribution cases |
| Query-aware/fallback routing | 3 | 2 | `pi-bifrost` and related routers exist | No real pi2dsh routing E2E yet |
| File/context selection, code navigation and Diff | 9 | 0 | `@ff-labs/pi-fff`, `pi-lens`, `@narumitw/pi-lsp`, `pi-hashline-edit-pro`, `pi-tool-display` | Composer `@file`/attachment path and Web diff/approval presentation need separate proof |
| Plan, Todo and model review | 3 | 1 | `pi-approval-guardian` allow/deny E2E; `rpiv-todo`, Pi goal/plan packages exist | Goal/plan packages and live UI still need DSH E2E |
| Long-term memory | 1 | 1 | `pi-hermes-memory` cross-process E2E | Nothing for `#1638`; do not generalize this to compaction bugs |
| MCP discovery, OAuth and timeout handling | 6 | 0 | `pi-mcp-adapter` has lazy discovery, OAuth/PKCE, configurable redirect URI and request timeout | Complete DSH command/TUI/headless OAuth E2E before replying |
| Usage, quota and status panels | 9 | 0 | `@narumitw/pi-usage` and many provider-specific meters; pi2dsh status/browser surfaces exist | Verify real account data and Web rendering; some threads are upstream display bugs rather than missing meters |
| Remote control and IM channels | 4 | 0 | `remote-pi`, `@llblab/pi-telegram`, `@amaster.ai/pi-channels`, Feishu/WeCom packages | Inbound session ownership, human questions and reconnect behavior need E2E |
| Cross-agent session import | 2 | 0 | Pi has Claude/Codex session import packages | pi2dsh lacks a standard durable DSH-session importer/writer contract |
| Skills and Claude-config migration | 5 | 0 | `pi-code`, `pi-cc-extensions`, Claude skill packages exist | Resource discovery/project trust and real DSH skill-catalog E2E remain |
| Background tasks and durable long work | 9 | 0 | `pi-background-tasks`, Pi goal/task packages and subagent schedulers exist | Process lifecycle, restart, notification and Web observability need E2E |
| Image generation | 1 | 1 | `pi-codex-image-gen` generation/editing with Codex OAuth has real Web E2E | Nothing for the demonstrated alternative; it does not repair another provider's exhausted balance |
| Provider-aware compaction | 6 | 0 | Pi has safe/Codex compaction extensions and pi2dsh exposes compaction lifecycle | Exact cache/replay behavior has not passed DSH E2E |

### Exact discussion sets

- Vision/image (41): `#112`, `#245`, `#321`, `#356`, `#357`, `#427`,
  `#588`, `#686`, `#784`, `#901`, `#908`, `#911`, `#1029`, `#1070`,
  `#1264`, `#1327`, `#1354`, `#1378`, `#1434`, `#1621`, `#1765`,
  `#1882`, `#1986`, `#1992`, `#2005`, `#2024`, `#2318`, `#2329`,
  `#2370`, `#2782`, `#2789`, `#2892`, `#2911`, `#2936`, `#3050`,
  `#3127`, `#3226`, `#3284`, `#3512`, `#3561`, `#3643`.
- Web search (8): `#332`, `#344`, `#408`, `#567`, `#779`, `#940`,
  `#1078`, `#1717`.
- Subagents (20) — `#455`/`#2006`/`#1493` replied 2026-08-24 with the verified
  pi2dsh + pi-subagents lifecycle route (see
  `docs/posting-kit/github-community-replies-subagents.md`): `#241`, `#455`, `#993`, `#1000`, `#1100`, `#1105`,
  `#1312`, `#1358`, `#1369`, `#1442`, `#1472`, `#1493`, `#1581`, `#1725`,
  `#2006`, `#2470`, `#2672`, `#2904`, `#3377`, `#3552`.
- Routing (3): `#431`, `#762`, `#1927`.
- File/context/Diff (9): `#196`, `#336`, `#337`, `#659`, `#1167`,
  `#1251`, `#2188`, `#2509`, `#3364`.
- Plan/Todo/review (3): `#421`, `#776`, `#1397`.
- Memory (1): `#1638`.
- MCP (6): `#524`, `#1239`, `#1604`, `#2017`, `#3063`, `#3387`.
- Usage/status (9): `#445`, `#1138`, `#1170`, `#1568`, `#1716`,
  `#1972`, `#2338`, `#2554`, `#3514`.
- Remote/IM (4): `#75`, `#351`, `#1732`, `#2544`.
- Session import (2): `#1087`, `#1359`.
- Skills/config migration (5): `#339`, `#838`, `#1711`, `#2378`,
  `#3425`.
- Background/durable work (9): `#1116`, `#1158`, `#1368`, `#1732`,
  `#1934`, `#2821`, `#2898`, `#3116`, `#3518`.
- Image generation (1): `#1963`.
- Compaction (6): `#1944`, `#2675`, `#3002`, `#3201`, `#3465`,
  `#3565`.

## The 117 unreplied Pi opportunities

This is the actionable backlog after removing discussions already touched by
our account:

- **44 Provider items**: the 32 “existing route needs E2E” and 12 “new
  Provider/standard work” discussions listed above.
- **76 non-Provider items**: 13 vision, 3 search, 8 subagent, 1 routing,
  9 file/context/Diff, 2 plan, 6 MCP, 9 usage, 4 remote/IM, 2 session
  import, 5 skills/config, 9 background, and 6 compaction discussions.
- Three discussions (`#1765`, `#2329`, `#3226`) appear in both backlogs, so
  the deduplicated total is **117**, not 120.

Exact non-Provider backlog:

- Vision/image: `#112`, `#1765`, `#1992`, `#2024`, `#2318`, `#2329`,
  `#2911`, `#2936`, `#3226`, `#3284`, `#3512`, `#3561`, `#3643`.
- Web search: `#332`, `#344`, `#1078`.
- Subagents: `#455`, `#1493`, `#2006`, `#2470`, `#2672`, `#2904`,
  `#3377`, `#3552`.
- Routing: `#431`.
- File/context/Diff: `#196`, `#336`, `#337`, `#659`, `#1167`, `#1251`,
  `#2188`, `#2509`, `#3364`.
- Plan/Todo: `#776`, `#1397`.
- MCP: `#524`, `#1239`, `#1604`, `#2017`, `#3063`, `#3387`.
- Usage/status: `#445`, `#1138`, `#1170`, `#1568`, `#1716`, `#1972`,
  `#2338`, `#2554`, `#3514`.
- Remote/IM: `#75`, `#351`, `#1732`, `#2544`.
- Session import: `#1087`, `#1359`.
- Skills/config migration: `#339`, `#838`, `#1711`, `#2378`, `#3425`.
- Background/durable work: `#1116`, `#1158`, `#1368`, `#1732`, `#1934`,
  `#2821`, `#2898`, `#3116`, `#3518`.
- Compaction: `#1944`, `#2675`, `#3002`, `#3201`, `#3465`, `#3565`.

Memory (`#1638`) and image generation (`#1963`) have no unreplied item in
this 431-thread set.

Do not reply to all 117 with the same installation command. A reply is ready
only after the disputed behavior has been observed in a clean DSH profile.

## Why the other 238 are not equivalent Pi-plugin fixes

They are not “impossible forever”; they simply do not currently map to an
existing Pi extension that can preserve the user's requested semantics.

1. **Agent history and wire invariants inside DSH** — broken tool call/result
   pairing, replay state after max-token truncation, reasoning blocks lost on
   multi-turn reconstruction, null/empty streamed call IDs, and unbounded loop
   behavior. A tool plugin starts too late, and a Provider plugin cannot repair
   a transcript DSH already corrupted before/after transport.
2. **Global Web and settings UX** — model-picker bulk actions, provider editor
   slots, first-run guidance, narrow-screen layout, history pagination and
   generic error rendering. A Pi package can draw its own card or overlay but
   cannot honestly claim it changed DSH's core settings page.
3. **Sandbox and trust boundary** — self-approval, workspace escape, core
   `run_code` confinement, secret ownership, plugin authority and project
   trust. A Pi approval/sandbox package can offer an alternate execution path
   or defense-in-depth; it cannot retroactively make vulnerable DSH core tools
   safe while those tools remain enabled.
4. **Process-global session/cache behavior** — Cordis singleton collisions,
   session-history crashes, prompt ordering drift, global dynamic tool catalogs
   and browser bundle caching. These are host lifecycle/storage defects, not a
   missing Pi feature.
5. **Product/model behavior, installation, documentation or non-actionable
   posts** — language preference, model quality, research/showcase posts,
   packaging channels and vague errors without reproduction evidence.

## Validation order by newly unlockable discussions

1. **MCP via `pi-mcp-adapter`**: six threads, including OAuth, redirect path,
   timeout and 1,000-tool context pressure. The package owns the MCP transport,
   so this can bypass missing DSH MCP features if its real Pi interaction
   surfaces work in DSH.
2. **File/context/Diff bundle**: nine threads. Test `@ff-labs/pi-fff`,
   `pi-hashline-edit-pro`, `pi-tool-display` and approval together; distinguish
   model-visible diffs from a browser-only pretty card.
3. **Real `@tintinweb/pi-subagents` E2E**: seven unreplied stale-model threads
   can share one proof if explicit model pinning, background completion and DSH
   child-session visibility all pass.
4. **`pi-web-access` freshness E2E**: three unreplied threads. Prove current
   date, recency filter, citations and provider independence in the stored
   request/result, not only a successful tool call.
5. **Plan/Todo and usage UI**: useful ecosystem breadth, but lower discussion
   leverage than the four lines above.

## Source notes

- DSH data came from the latest GraphQL refresh of the 431 selected
  discussions, including every current comment at audit time.
- Pi package data came from all 66 pages of the official Pi extension catalog.
- Runtime claims are limited to repository artifacts under `community/`,
  `docs/posting-kit/support-matrix.md`, `docs/plugin-validation-matrix.md` and
  `docs/pi-abi-coverage.md`.
- Package README claims are treated only as package capability evidence, never
  as pi2dsh E2E evidence.
