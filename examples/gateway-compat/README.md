# Private-gateway compatibility through DSH's official adapter

Private, domestic and local OpenAI-compatible gateways often reject a request
as soon as reasoning is enabled:

```text
400 invalid value: `developer`
400 Unexpected role 'developer'
```

The common cause is a wire-dialect fact such as `supportsDeveloperRole`. When
it is absent, pi-ai guesses from the hostname. A private hostname says nothing
about the implementation behind it, so that guess can be wrong.

DSH rc.8 gives its official `llm-pi-ai` provider profile a protocol-aware
`compat` schema. pi2dsh uses that seam for a Pi plugin that declares a provider
catalog but no transport:

```text
Pi provider declaration
  → pi2dsh translates configuration field by field
  → DSH settings / credentials / model directory
  → official llm-pi-ai adapter
  → real gateway request
```

The bridge does not implement HTTP on this path. DSH owns the credential and
the request; pi2dsh only translates the declaration.

## What is translated

- protocol, base URL and `$ENV_VAR` credential reference;
- model name, context/output limits and text/image input modalities;
- Pi's `reasoning` + `thinkingLevelMap` into DSH `reasoningEfforts`;
- every compat field rc.8 offers for the selected protocol, including
  `supportsDeveloperRole`, `maxTokensField`, `thinkingFormat`, cache switches,
  tool-result switches and the Anthropic-specific switches.

The translation is a whitelist. Unknown keys and catalog-vendor-owned fields
such as OpenRouter routing, session affinity, grammar tools and tool search are
not copied into a generic route: DSH deliberately keeps those on the installed
vendor catalog. One invalid key would otherwise reject the whole settings
section.

Providers that bring their own `stream` still use the other supported path:
pi2dsh registers their transport through `llm.registerAdapter`. Both paths
enter the same DSH model directory.

## Verify the real wire

`probe/` contains two small pieces:

- `pi-probe-provider`: a **catalog-only** Pi provider — no stream, no HTTP
  client — declaring the non-default compat values;
- `recording-proxy.mjs`: a passthrough recorder. It forwards every request to
  your real upstream and streams the real response back, while saving the
  request shape locally.

Start the recorder:

```sh
PROXY_UPSTREAM=https://api.deepseek.com \
  node examples/gateway-compat/probe/recording-proxy.mjs
```

In another terminal, expose the real upstream key under the reference used by
the fixture, install the engine and fixture, then start DSH:

```sh
export PROBE_API_KEY="$DEEPSEEK_API_KEY"
export PROBE_BASE_URL=http://127.0.0.1:4599/v1

dsh plugin --profile web add pi2dsh
dsh plugin --profile web add file:examples/gateway-compat/probe/pi-probe-provider
dsh --profile web --port 5184
```

Select `Probe Gateway / Probe Model` and send a message. The real model should
answer. `probe/requests.jsonl` should show evidence like:

```json
{"roles":["system","user"],
 "maxTokensField":"max_tokens",
 "reasoningEffort":"high",
 "store":null}
```

Those values are deliberately falsifiable:

- `system`, not `developer`, proves `supportsDeveloperRole: false` reached the
  assembler;
- `max_tokens` is the non-default spelling declared by the plugin;
- no `store` proves `supportsStore: false` survived;
- selecting canonical `xhigh` produces the model's mapped wire spelling `high`;
- the DSH selector offers `Off / Low / Medium / High / Xhigh`, omits `Minimal`,
  and accepts images because those facts came from the Pi model declaration.

## Scope

This example proves the configuration-owned route fixed in DSH rc.8. It does
not claim a generic final-wire middleware: enhancing an already registered
adapter's final headers/body/response is a separate DSH seam that still does
not exist. It also does not turn a command-only package such as a llama.cpp
launcher into a model provider; the package must actually register a provider
declaration.
