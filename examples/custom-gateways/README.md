# Custom gateways — DSH settings, one directory for DSH and Pi plugins

Add any OpenAI-compatible gateway (OpenRouter, a self-hosted vLLM, a
corporate proxy) to DSH through the official `llm-pi-ai` plugin configuration.
The route appears in the DSH web model
picker, works as the main model, and every mounted Pi plugin sees it
through the bridge's registry projection automatically. There is no
bridge-specific model configuration: **one DSH configuration entry, one
model directory, both worlds read it.**

## 1. Configure the gateway in DSH settings

Use the Models page, or add this entry to the active profile's
`$DSH_HOME/profiles/web/cordis.patch.yml`. Merge it with the existing patch
list. `llm-pi-ai` is DSH's official generic model adapter in the default composition:

```yaml
- id: llm-pi-ai
  config:
    providers:
      my-gateway:
        displayName: My Gateway
        api: openai-completions
        baseURL: https://openrouter.ai/api/v1
        apiKeyEnv: OPENROUTER_API_KEY      # a reference — no secret in the file
        models:
          - id: qwen/qwen2.5-vl-72b-instruct
            name: Qwen2.5-VL 72B
            contextWindow: 131072
            input: [text, image]
            compat:
              supportsDeveloperRole: false
              maxTokensField: max_tokens
```

`apiKeyEnv` names an environment variable (or a `ctx.credentials`
reference); the key itself never enters the file. Restart the profile after
manual edits; the Models page uses DSH's live configuration service.

`input`, `reasoningEfforts` and `compat` are official rc.8 profile fields.
Declare only what the endpoint actually supports. Compat is protocol-aware:
an OpenAI-completions-only switch on an Anthropic route is rejected with the
route and model named, rather than silently ignored.

## 2. Use it

```sh
export OPENROUTER_API_KEY='<your-openrouter-key>'
dsh web
```

- **DSH side**: the model picker shows a "My Gateway" group; select it and
  chat — requests stream through DSH's official adapter.
- **Pi-plugin side**: every mounted plugin's `modelRegistry` sees the same
  route (`getAll()`, `find('my-gateway', ...)`, `getProvider(...)
  .streamSimple`), and plugin model calls run through the same DSH llm
  directory — the single call path.
- **Bonus (0.9.0+)**: if the gateway's models are text-only, the picker
  also shows an automatic "My Gateway + Vision Bridge" group — pi2dsh's
  image-admission companion, letting you paste images while chatting on a
  text-only route (see the [`vision-bridge`](../vision-bridge/) example).

## What this exercises in pi2dsh

- the registry projection: DSH's llm directory (including routes you
  configure in DSH settings) answered to plugins in exact Pi vocabulary
- the single call path: plugin-initiated model calls
  (`registry.complete`, `getProvider().stream`) routed through the DSH
  llm service — plugins never hold a wire transport
- zero bridge-owned model configuration: gateways are host configuration,
  served by DSH's official `llm-pi-ai` adapter
