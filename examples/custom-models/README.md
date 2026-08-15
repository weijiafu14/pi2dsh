# Custom models via Pi's models.json — one directory for DSH and Pi plugins

Define a provider once in Pi's standard `models.json`, and it becomes a real
route in DSH's model directory: it shows up in the DSH web model picker
(as its own provider group), a DSH user can chat on it as the main model,
and every Pi plugin sees it through the registry (`find`,
`getApiKeyAndHeaders`, `getProvider().streamSimple`, `registry.complete`) —
all calls run through the DSH llm route. Verified end to end in the DSH CLI
and web app.

## 1. Write models.json

Path: `$DSH_HOME/pi2dsh/agent/models.json` (default
`~/.dsh/pi2dsh/agent/models.json`). Copy
[`models.json.example`](models.json.example):

```json
{
  "providers": {
    "my-gateway": {
      "name": "My Vision Gateway",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "$OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        { "id": "qwen/qwen2.5-vl-72b-instruct", "input": ["text", "image"] }
      ]
    }
  }
}
```

Field semantics are Pi's exactly: `apiKey` supports `$ENV_VAR` references
and `!command` shell resolution; `api` picks the wire protocol
(`openai-completions`, `openai-responses`, `anthropic-messages`); `input`
declares modalities; `// comments` and trailing commas are tolerated.
JSON-schema violations and per-provider composition errors surface through
`modelRegistry.getError()` and never block the mount.

## 2. Install any pi2dsh bundle and start DSH

The registry ships inside every generated bundle — install one (see the
[`vision-bridge`](../vision-bridge/) example) and start `dsh web` or the
CLI with your key exported:

```sh
export OPENROUTER_API_KEY=sk-...
dsh web
```

## 3. What you get

- **DSH side**: the web model picker shows a "My Vision Gateway" group with
  your model; select it and chat — requests stream through a native DSH llm
  route (the wire client lives inside the route adapter).
- **Pi side**: plugins resolve `find('my-gateway', 'qwen/...')` to the exact
  Pi Model you wrote (api, baseUrl, modalities preserved), resolve the key
  with Pi's `$ENV` semantics, and stream through
  `getProvider('my-gateway')` / `registry.complete` — routed through DSH.
- `registry.refresh()` re-reads the file and re-registers routes.

One configuration entry, one runtime directory, one call path.
