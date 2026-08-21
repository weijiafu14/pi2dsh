# Alibaba Cloud Plan models in DeepSeek Harness

Use an Alibaba Cloud Model Studio Plan subscription as a native DeepSeek
Harness model route. The original `pi-provider-alibaba` package owns Alibaba's
endpoints, authentication, dynamic `/v1/models` discovery, protocol and HTTP
transport; pi2dsh only maps its public Pi Host ABI onto DSH.

## 1. Install the engine and the original provider

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add pi-provider-alibaba
```

Restart DSH after adding the packages. There is no conversion step and no
generated wrapper.

## 2. Export the credential for the plan you bought

China Token Plan:

```sh
export ALIBABA_TOKEN_PLAN_API_KEY='<your-plan-key>'
```

China Coding Plan:

```sh
export ALIBABA_CODING_API_KEY='<your-plan-key>'
```

These are plugin-defined, host-neutral environment variables. The key stays in
the process environment; do not put it in `settings.yaml` or commit it.

## 3. Start DSH and select the route

```sh
dsh web
```

Open the model picker and choose the matching group:

- **Alibaba Token Plan (CN)** for `ALIBABA_TOKEN_PLAN_API_KEY`;
- **Alibaba Coding Plan (CN)** for `ALIBABA_CODING_API_KEY`.

The provider discovers the live catalog from Alibaba. You can select a model
such as `deepseek-v4-pro` even on the first headless request: pi2dsh waits for
one in-flight catalog refresh before handing an initially unseen model to the
provider transport.

## 4. Prove the agent loop, not just endpoint reachability

Ask the model to use any installed tool and then explain its result. A complete
success has two model steps in the DSH trajectory:

1. the Alibaba model emits a tool call;
2. DSH executes it and returns the result;
3. the same Alibaba route consumes that result and produces the final answer.

Merely seeing models in the picker or receiving `200` from `/v1/models` does
not prove this loop.

## Why this avoids the hand-declared gateway problem

This package is a **transport-owning Pi provider**. pi2dsh registers it through
DSH's public `llm.registerAdapter` seam, so it is a native DSH route while the
provider keeps ownership of the wire request. It does not travel through a
hand-declared `llm-pi-ai` profile that may have a different set of exposed
compatibility switches.

The boundary is generic: no Alibaba package name or endpoint is hard-coded in
pi2dsh. Any Pi provider built from `createProvider`, `envApiKeyAuth` and a
standard protocol factory uses the same Host ABI path.

## Common failures

- **401 on an international route:** a China Plan key belongs on the `(CN)`
  route. Select the matching group.
- **No models:** verify the environment variable belongs to the selected Plan
  type, then restart DSH so the provider sees the process environment.
- **`Cannot read properties of undefined` on the first headless request:**
  update pi2dsh; current releases wait for dynamic discovery before first use.
- **Proxy works with curl but not Node:** start with
  `NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--no-warnings dsh web`.

## Reproducible acceptance check

The repository's example harness has an `alibaba-token-plan` scenario. It
installs the published engine and the unmodified provider into a clean
`DSH_HOME`, selects `alibaba-token-cn/deepseek-v4-pro`, forces a tool call,
restarts the profile, repeats the call, and scans the complete test home for
the exact credential:

```sh
ALIBABA_TOKEN_PLAN_API_KEY='<your-plan-key>' \
PI2DSH_ENGINE_SPEC='pi2dsh@<published-version>' \
ONLY=alibaba-token-plan pnpm test:examples
```

The live acceptance on 2026-08-21 used `pi-provider-alibaba@1.0.1` and the
published `pi2dsh@0.13.3`. Both tool loops completed on
`alibaba-token-cn/deepseek-v4-pro`; the exact Plan key appeared in zero files.
