# Gateways that reject `developer`, and reasoning that stays on

If your OpenAI-compatible gateway is a private/corporate deployment, a
domestic Chinese endpoint, or a local proxy, turning on reasoning may fail
every request with something like:

```
400  invalid value: `developer`
400  Unexpected role 'developer'
```

This example shows why it happens, and how installing a Pi provider plugin
through pi2dsh gets you past it — **without a local rewriting proxy**, and
with the reasoning effort selector still working.

## Why it happens

The request has to put the system prompt under some role. `developer` is the
newer OpenAI spelling, and many gateways only accept `system`. Whether to use
`developer` is one flag: `supportsDeveloperRole`.

When nothing declares it, the flag is guessed **from the hostname**. Public
vendor hosts are on the list; your private gateway is not — so it is assumed
to accept `developer`, and every reasoning request 400s.

The flag can be declared explicitly in a Pi model's `compat`. What matters is
whether your declaration reaches the request assembler.

## What this example does

Install a Pi provider plugin for your gateway. The plugin builds its own model
descriptors — `compat` included — and pi2dsh registers it as a **native DSH
llm route** through the host's own `llm.registerAdapter` seam. The request is
then assembled from the plugin's descriptor, so the flag it declares is the
flag that ships.

Everything else stays DSH's: the loop, the session log, retries, the model
picker, subagents. Only the adapter differs.

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add <the Pi provider plugin for your gateway>
```

Then configure the plugin the way its README says (usually environment
variables, or its own `/login` command in the DSH command palette), and
restart dsh. Its models appear in DSH's own model picker.

Pi provider plugins that exist today include `pi-provider-litellm` (LiteLLM
proxies, with model auto-discovery and enterprise SSO), plus per-vendor ones
for Volcengine, Kimi and others. If your gateway is a plain OpenAI-compatible
endpoint with a fixed model list and no compat quirks, you do **not** need any
of this — configure it directly in DSH settings, see
[`custom-gateways`](../custom-gateways/).


## Which plugins can actually do this

Only a plugin that **brings its own transport** — one whose provider has a
`stream` of its own — becomes a DSH llm route. A plugin that merely declares a
model catalog stays on the host's llm configuration, so it hits the exact same
dropped-field problem this example is about.

You do not have to guess. Install it, start dsh, and read one line:

```
[pi2dsh] Pi provider "<name>" registered as a native DSH llm route
   → its own requests, so your compat declarations ship

[pi2dsh] Pi provider "<name>" declares a model catalog but no transport;
         it was not added as a DSH llm route
   → falls back to host llm settings; this example does NOT help
```

Checked so far: `pi-provider-litellm` carries a transport (works);
`pi-ollama-cloud` is catalog-only (does not); `pi-llama-cpp` registers no
provider at all (not applicable).

## What pi2dsh had to fix for this to work

Three gaps, all general — no per-package code:

1. **Reasoning efforts were not offered at all.** Pi describes reasoning with
   a boolean plus a `thinkingLevelMap`; DSH asks an adapter for selectable
   efforts. The bridge translated neither, so every package-registered route
   reported no effort and any reasoning request was rejected outright with
   `UNSUPPORTED_REASONING_EFFORT`. The bridge now derives the efforts exactly
   as DSH's own pi-ai adapter does.

2. **The chosen effort never reached the request.** With efforts finally
   offered, picking one still did nothing: the bridge did not forward
   `reasoningEffort` into the package's stream call, so the selector was
   decorative.

3. **Declared image input was lost on the resolve path.** A model declaring
   `input: ['text','image']` advertised it in the catalog listing but not in
   the exact-route resolve — which is what the host consults before a request,
   so the model silently degraded to text-only exactly when it mattered.

All three are fixed in 0.12.0, and each unlocks every Pi provider plugin at
once, not just one vendor's.

## Verify it yourself, without a real gateway

`probe/` contains a fake OpenAI-compatible endpoint that records what it is
sent, plus a minimal Pi provider standing in for a private gateway: it
declares `supportsDeveloperRole: false`, `maxTokensField:
'max_completion_tokens'`, `supportsStore: false`, a `thinkingLevelMap` that
removes `minimal` and adds `xhigh`, and `input: ['text','image']` — none of
which DSH settings can carry.

```sh
node examples/gateway-compat/probe/fake-endpoint.mjs      # terminal 1
dsh plugin --profile web add file:examples/gateway-compat/probe/pi-probe-provider
# point agent-default-model at provider `probe`, model `probe-model`, then:
dsh --profile web --port 5184                             # terminal 2
```

Send any message and read what the endpoint recorded:

```json
{"roles":["system","user",…],
 "maxTokensField":"max_completion_tokens",
 "reasoningEffort":"xhigh",
 "store":null,
 "bodyKeys":["max_completion_tokens","messages","model","reasoning_effort","stream","stream_options","tools"]}
```

Every one of those is a declaration surviving the trip: `system` instead of
`developer`; the model's own spelling of the max-tokens field; the effort you
picked, after the model's own level map; and no `store` field, because the
model said the gateway rejects it.

Two more, visible outside the request body:

- The effort selector lists `Off / Low / Medium / High / Xhigh` — `Minimal` is
  gone because the map marks it unsupported, and `Xhigh` is there because the
  map declares it. Neither is the default set.
- No `probe-vision` companion route is registered at startup, because the
  model declares image input. (A text-only route still gets one — check the
  log for `deepseek-official-vision`.)

## Honest scope

This does **not** fix DSH's own configuration path. If you configure a gateway
directly in DSH settings, `supportsDeveloperRole` is still dropped there, and
the hostname guess still applies. What pi2dsh gives you is a second, fully
supported route into the same model directory — one where the plugin's compat
declaration is what ships.
