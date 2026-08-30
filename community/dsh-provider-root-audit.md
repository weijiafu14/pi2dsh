# DeepSeek Harness Provider-root discussion audit

Last refreshed: 2026-08-21 (Asia/Shanghai)

This is the authoritative Provider-topic census. It replaces the old claim that
there were only 70 Provider discussions. That number meant “threads already
mapped to a possible Pi Provider route”; it was never the size of the Provider
problem space.

## Source and review method

- Refreshed all **3,731** current discussions from `deepseek-ai/deepseek-harness`
  (through discussion `#3772`).
- Kept `Show Your Plugins!` packages out of the problem denominator; packages
  are solution inventory, not additional user-problem reports.
- Reviewed every remaining title and category. Broad Provider/model/auth/wire
  candidates were then classified by root cause; vague titles and ambiguous
  multi-topic reports were decided from their bodies.
- Provider-related means the primary requested behavior or failure involves an
  LLM route, model catalog/capability, credential/OAuth path, request/response
  protocol, retry/error mapping, provider cache/metadata, or model routing.
- Host HTTP trust, sandbox, MCP, generic tool/runtime, file/context and Web-only
  defects are not counted merely because their downstream symptom mentions an
  API or a model.
- Current comments were refreshed through GraphQL. “Replied” means
  `weijiafu14` has a comment; it does not mean the scenario is resolved.

## Correct totals

- Provider-related problem/feature discussions: **274**
- Already commented by `weijiafu14`: **53** discussions (**54** comments)
- Not yet commented: **221** discussions
- Root-cause clusters: **14**

| Root-cause cluster | Threads | Replied | Unreplied | Pi/pi2dsh relevance |
|---|---:|---:|---:|---|
| Streamed tool-call identity (`null`/`""` id/name) | 46 | 1 | 45 | Bailian's exact empty/null continuation shape and the real DashScope endpoint now pass through the Pi route; extend that proof to the other named gateways |
| Reasoning/compat/request options | 44 | 20 | 24 | pi2dsh already projects reasoning levels and package-owned compat; exact duplicates need scenario E2E, not new generic transport |
| Credentials/OAuth/accounts | 28 | 3 | 25 | Reuse the 105 OAuth-declaring Pi packages and credential chain; DSH storage/redaction defects remain upstream |
| Gateway/service/local endpoints | 27 | 6 | 21 | Reuse named Pi Providers or DSH's official generic adapter; LiteLLM is only for users who already run LiteLLM |
| Request metadata/cache/service tier/headers | 18 | 1 | 17 | Body hook works only for package-owned transports; dynamic header hook is unavailable; Codex Fast has an exact existing Pi package |
| Vision/modalities/admission | 17 | 13 | 4 | Vision bridge is proven; named provider/catalog scenarios still need exact E2E |
| Replay/transcript integrity | 17 | 0 | 17 | Mostly DSH agent/session/assembler invariants; a Provider plugin starts too late to repair persisted corrupt history |
| Routing/model switching/subagents | 16 | 7 | 9 | Primarily Pi router/subagent packages and Host ABI, not `registerProvider` alone |
| Catalog/discovery/capacity | 15 | 0 | 15 | pi2dsh has projection/re-announcement support; dynamic named-service E2E is missing |
| Retry/error/timeout classification | 13 | 0 | 13 | Test current Pi-owned transport error mapping against captured failures; native adapter cases are upstream |
| Provider settings/UI | 11 | 1 | 10 | A package command/login can offer an alternate workflow; it cannot claim to repair DSH's core Models page |
| Other protocol compatibility | 9 | 1 | 8 | Exact fixture/E2E per protocol |
| Reasoning history/rendering | 9 | 0 | 9 | Split Pi transport behavior from DSH durable-history reconstruction |
| Usage/billing | 4 | 0 | 4 | Non-Provider Pi usage/status packages; needs real-account rendering E2E |

The thread count is intentionally not deduplicated: it is the number of
community conversations that can receive a useful answer. The fourteen rows
are the deduplicated engineering workstreams.

## Exact thread sets

### Streamed tool-call identity — 46

`#161`, `#615`, `#725`, `#741`, `#879`, `#885`, `#887`, `#890`, `#1405`,
`#1419`, `#1500`, `#1713`, `#1915`, `#2090`, `#2116`, `#2169`, `#2343`,
`#2540`, `#2674`, `#2725`, `#2802`, `#2820`, `#2823`, `#2855`, `#2859`,
`#2895`, `#2916`, `#2979`, `#2982`, `#2987`, `#2993`, `#2997`, `#3052`,
`#3069`, `#3090`, `#3260`, `#3281`, `#3299`, `#3374`, `#3384`, `#3408`,
`#3464`, `#3604`, `#3644`, `#3695`, `#3767`.

### Reasoning/compat/request options — 44

`#122`, `#196`, `#280`, `#302`, `#375`, `#472`, `#473`, `#551`, `#614`,
`#636`, `#722`, `#736`, `#780`, `#843`, `#1058`, `#1070`, `#1232`,
`#1272`, `#1309`, `#1498`, `#1580`, `#1643`, `#1944`, `#2023`, `#2050`,
`#2388`, `#2489`, `#2637`, `#2719`, `#2894`, `#2970`, `#3002`, `#3008`,
`#3076`, `#3125`, `#3330`, `#3335`, `#3363`, `#3372`, `#3379`, `#3394`,
`#3493`, `#3531`, `#3566`.

### Credentials/OAuth/accounts — 28

`#117`, `#208`, `#226`, `#455`, `#619`, `#634`, `#666`, `#811`, `#981`,
`#1011`, `#1063`, `#1080`, `#1491`, `#1502`, `#1559`, `#1631`, `#1806`,
`#2128`, `#2363`, `#2668`, `#2703`, `#3004`, `#3073`, `#3222`, `#3503`,
`#3538`, `#3575`, `#3696`.

### Gateway/service/local endpoints — 27

`#51`, `#200`, `#444`, `#691`, `#947`, `#990`, `#1073`, `#1077`, `#1171`,
`#1208`, `#1455`, `#1705`, `#1866`, `#2170`, `#2203`, `#2296`, `#2354`,
`#2374`, `#2529`, `#2587`, `#2941`, `#2943`, `#3270`, `#3338`, `#3397`,
`#3488`, `#3672`.

### Request metadata/cache/service tier/headers — 18

`#445`, `#599`, `#935`, `#952`, `#1138`, `#1716`, `#2136`, `#2141`,
`#2142`, `#2382`, `#2383`, `#2602`, `#2804`, `#2822`, `#3225`, `#3304`,
`#3305`, `#3761`.

### Vision/modalities/admission — 17

`#112`, `#245`, `#321`, `#356`, `#474`, `#561`, `#686`, `#784`, `#908`,
`#911`, `#1354`, `#1378`, `#1765`, `#2329`, `#2892`, `#3127`, `#3226`.

### Replay/transcript integrity — 17

`#436`, `#807`, `#1244`, `#1263`, `#1449`, `#1519`, `#1703`, `#1959`,
`#2410`, `#2584`, `#2661`, `#2913`, `#3046`, `#3303`, `#3315`, `#3591`,
`#3685`.

### Routing/model switching/subagents — 16

`#431`, `#1100`, `#1105`, `#1136`, `#1358`, `#1472`, `#1493`, `#1725`,
`#1927`, `#2470`, `#2672`, `#2779`, `#2904`, `#3377`, `#3552`, `#3755`.

### Catalog/discovery/capacity — 15

`#106`, `#166`, `#429`, `#557`, `#740`, `#824`, `#1495`, `#1572`, `#1682`,
`#1786`, `#1992`, `#2379`, `#2675`, `#2849`, `#3684`.

### Retry/error/timeout classification — 13

`#530`, `#892`, `#978`, `#1127`, `#1504`, `#2898`, `#2956`, `#3112`,
`#3128`, `#3157`, `#3158`, `#3399`, `#3407`.

### Provider settings/UI — 11

`#135`, `#616`, `#1064`, `#1254`, `#1397`, `#1439`, `#1510`, `#3342`,
`#3495`, `#3576`, `#3612`.

### Other protocol compatibility — 9

`#409`, `#967`, `#1593`, `#1771`, `#2007`, `#2569`, `#2976`, `#3040`,
`#3609`.

### Reasoning history/rendering — 9

`#80`, `#199`, `#231`, `#739`, `#906`, `#1146`, `#1780`, `#1850`, `#2755`.

### Usage/billing — 4

`#2349`, `#2554`, `#3362`, `#3514`.

## Unreplied backlog by cluster

- Tool-stream identity (45): all except `#3767`.
- Reasoning/compat (24): `#122`, `#196`, `#302`, `#375`, `#722`, `#736`,
  `#780`, `#1058`, `#1580`, `#1944`, `#2050`, `#2719`, `#2894`, `#2970`,
  `#3002`, `#3008`, `#3125`, `#3335`, `#3363`, `#3372`, `#3379`, `#3394`,
  `#3493`, `#3566`.
- Credentials/OAuth (25): `#226`, `#455`, `#619`, `#634`, `#666`, `#811`,
  `#981`, `#1011`, `#1063`, `#1080`, `#1491`, `#1502`, `#1559`, `#1631`,
  `#1806`, `#2128`, `#2363`, `#2668`, `#2703`, `#3073`, `#3222`, `#3503`,
  `#3538`, `#3575`, `#3696`.
- Gateway/service/local (21): `#51`, `#200`, `#444`, `#947`, `#1073`,
  `#1077`, `#1171`, `#1455`, `#1866`, `#2170`, `#2203`, `#2296`, `#2354`,
  `#2374`, `#2529`, `#2941`, `#2943`, `#3270`, `#3338`, `#3488`, `#3672`.
- Request metadata/cache/tier/headers (17): `#445`, `#599`, `#935`, `#952`,
  `#1138`, `#1716`, `#2136`, `#2141`, `#2142`, `#2382`, `#2383`, `#2602`,
  `#2822`, `#3225`, `#3304`, `#3305`, `#3761`.
- Replay/transcript (17): all 17 above.
- Catalog/discovery/capacity (15): all 15 above.
- Retry/errors/timeouts (13): all 13 above.
- Settings/UI (10): all except `#1064`.
- Reasoning history/rendering (9): all 9 above.
- Routing/subagents (9): `#431`, `#1493`, `#2470`, `#2672`, `#2779`, `#2904`,
  `#3377`, `#3552`, `#3755`.
- Other protocol (8): all except `#2007`.
- Usage/billing (4): all 4 above.
- Vision/modalities (4): `#112`, `#1765`, `#2329`, `#3226`.

## Development and validation order

1. **Captured tool-stream matrix — 45 unreplied after Bailian.** The exact
   empty-string plus null continuation fixture now passes through
   `pi-provider-alibaba-bailian` → pi2dsh → DSH's official pi-ai adapter: the
   first non-empty call id/name survives, the tool executes, its result is
   paired, and the second model step finishes. A real DashScope
   `deepseek-v4-flash` turn passed the same DSH loop and did not persist its
   credential. Repeat that proof for the other named gateways; do not invent
   an `after_provider_response` hook.
2. **Reasoning/compat audit — 24 unreplied.** Re-run current pi2dsh reasoning,
   `supportsDeveloperRole`, `maxTokensField`, provider switch and per-child
   effort scenarios. Reply only to the subset whose exact wire assertion passes.
3. **Credentials and named gateways — 46 unreplied across two rows.** Match
   concrete services to the current Provider catalog, then perform clean-profile
   login/key, picker and real-turn tests. Never require LiteLLM unless the
   discussion already uses LiteLLM.
4. **Catalog/capacity + retry fixtures — 28 unreplied.** Exercise late discovery,
   re-announcement, input modalities, capacities and captured retry/error strings
   through a real DSH loop.
5. **Codex Fast — two exact threads.** Test `pi-openai-codex-fast` with the
   existing Codex OAuth state and assert `service_tier: "priority"` on the real
   package-owned request body.

## Header boundary (do not conflate these again)

- DSH `llm-pi-ai` static `headers`: supported for fixed non-secret values.
- Pi `before_provider_request`: body only, and only for package-owned transports.
- Pi `before_provider_headers`: unavailable in pi2dsh.
- Pi `after_provider_response`: unavailable in pi2dsh.
- Harness-reserved attribution headers such as `User-Agent`: not overrideable
  by a Pi route for all providers.
