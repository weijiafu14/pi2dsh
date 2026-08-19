# Generate and edit images with a ChatGPT/Codex subscription

This example runs the published
[`@crazygit/pi-codex-image-gen`](https://www.npmjs.com/package/@crazygit/pi-codex-image-gen)
package unchanged on DeepSeek Harness. It uses the OpenAI Codex account you
log in with — no separate image API key or image-provider configuration.

The package calls its own `gpt-image-2` transport. pi2dsh supplies the parts a
Pi package expects from its host: OAuth model lookup, the tool ABI, a real
confirmation dialog before local files leave the machine, native DSH image
attachments, and a browser tool view that shows the returned pixels inline.

## 1. Install

```sh
dsh plugin --profile web add pi2dsh
dsh plugin --profile web add @crazygit/pi-codex-image-gen
```

Restart `dsh web` after adding the packages.

## 2. Log in to Codex

Type `/login` in the composer and choose **OpenAI (ChatGPT Plus/Pro)**. Finish
the provider's browser or device-code flow. When it returns, choose a model in
the new **OpenAI (ChatGPT Plus/Pro)** group.

The subscription model drives the agent turn; the image tool itself uses the
same OAuth login to call `gpt-image-2`.

## 3. Generate

Ask naturally, or force one reproducible tool call:

```text
Use codex_generate_image once. Generate a square app icon with white letters
DSH on a vivid cobalt-blue background. Use quality low. Show me the result.
```

The completed tool card expands to the generated image. By default the plugin
also saves it under its Pi agent data directory; ask it to use `save="none"`
when you only want the inline DSH attachment.

## 4. Edit a local image

Give the tool an **absolute** path. For a ready-made reference in this repo:

```sh
realpath examples/vision-bridge/test-images/solid-blue.png
```

Paste the printed path into a prompt:

```text
Use codex_generate_image once to edit /absolute/path/solid-blue.png. Turn it
into a vivid orange square with one centered white five-point star and no text.
Show me the result.
```

DSH asks **“Upload 1 local image to Codex?”** and shows the exact path. Choose
Yes to continue or No to keep the file local. The Pi package is unchanged; its
`ctx.ui.confirm` call is what crosses the bridge into DSH's native question UI.

## What the automated acceptance proves

Run the account-backed check explicitly:

```sh
CODEX_AUTH_FILE=$HOME/.codex/auth.json pnpm test:codex-image
```

It creates a clean temporary `DSH_HOME`, installs pi2dsh plus the real npm
package through `dsh plugin`, and then checks both routes:

- a real Codex model calls `codex_generate_image` and generates a PNG;
- the PNG becomes a content-addressed native DSH attachment;
- Web editing sends exactly one real local reference after the DSH approval;
- the edited PNG differs from the reference and is displayed as actual pixels
  inside the Web tool card through DSH's session-authorized attachment RPC.

Tokens are copied only into that temporary home, are never written to the
report, and the temporary home is removed after the run.
