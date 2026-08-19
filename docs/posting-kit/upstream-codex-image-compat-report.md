## Compatibility result

The published `@crazygit/pi-codex-image-gen` package now runs unmodified inside DeepSeek Harness through [pi2dsh](https://github.com/weijiafu14/pi2dsh), a Pi Host ABI compatibility engine.

DSH-side install:

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
```

After restarting DSH, `/login openai-codex` runs the Pi provider's normal OAuth flow through DSH's question UI. No Codex CLI installation or separate image API key is required.

## End-to-end paths exercised

- real ChatGPT Plus/Pro Codex OAuth login;
- a real Codex model selects and calls `codex_generate_image`;
- `gpt-image-2` returns a real PNG;
- the Pi image block becomes a native, content-addressed DSH attachment;
- the DSH Web tool card displays the returned pixels inline;
- a real local reference image goes through the package's `ctx.ui.confirm` flow, rendered as a DSH approval dialog, before upload;
- the returned edit differs from the reference and renders inline as well.

The package itself required no source change. pi2dsh supplies the host-side model registry/OAuth projection, tool ABI, confirmation UI, attachment persistence, and browser result surface.

Reproduction and the account-backed verification command are documented here:

<https://github.com/weijiafu14/pi2dsh/tree/main/examples/codex-image-gen>

This issue is an interoperability report rather than a change request. It may be useful to users who work in both Pi and DeepSeek Harness.
