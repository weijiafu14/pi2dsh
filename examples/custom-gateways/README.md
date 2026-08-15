# Custom gateways — DSH settings, one directory for DSH and Pi plugins

Add any OpenAI-compatible gateway (OpenRouter, a self-hosted vLLM, a
corporate proxy) to DSH the **official DSH way** — the `llm-pi-ai:` section
of your DSH settings document. The route appears in the DSH web model
picker, works as the main model, and every mounted Pi plugin sees it
through the bridge's registry projection automatically. There is no
bridge-specific model configuration: **one DSH configuration entry, one
model directory, both worlds read it.**

## 1. Configure the gateway in DSH settings

Edit `$DSH_HOME/settings.yaml` (default `~/.dsh/settings.yaml`) and add an
`llm-pi-ai:` section — this is DSH's official generic model adapter, part
of the default composition:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      displayName: My Gateway
      api: openai-completions
      baseURL: https://openrouter.ai/api/v1
      apiKeyEnv: OPENROUTER_API_KEY        # a reference — no secret in the file
      models:
        - id: qwen/qwen2.5-vl-72b-instruct
          name: Qwen2.5-VL 72B
          contextWindow: 131072
```

`apiKeyEnv` names an environment variable (or a `ctx.credentials`
reference); the key itself never enters the file. Settings hot-reload:
the route serves on the next request, no restart needed.

## 2. Use it

```sh
export OPENROUTER_API_KEY=sk-...
dsh web
```

- **DSH side**: the model picker shows a "My Gateway" group; select it and
  chat — requests stream through DSH's official adapter.
- **Pi-plugin side**: every mounted plugin's `modelRegistry` sees the same
  route (`getAll()`, `find('my-gateway', ...)`, `getProvider(...)
  .streamSimple`), and plugin model calls run through the same DSH llm
  directory — the single call path.

## What this exercises in pi2dsh

- the registry projection: DSH's llm directory (including routes you
  configure in DSH settings) answered to plugins in exact Pi vocabulary
- the single call path: plugin-initiated model calls
  (`registry.complete`, `getProvider().stream`) routed through the DSH
  llm service — plugins never hold a wire transport
- zero bridge-owned model configuration: gateways are host configuration,
  served by DSH's official `llm-pi-ai` adapter
