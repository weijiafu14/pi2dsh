# Vision for text-only models on DSH

Give a text-only model (DeepSeek, etc.) eyes: mention an image path in your
message — or paste an image straight into the DSH web app — and the Pi
plugin **@kassing/pi-vision** sends the image to a vision model you
configure, injecting the analysis into the conversation so your main model
answers about the picture. Works in the DSH CLI and the DSH web app (the
injected analysis renders as a native context-injection row, and the
plugin's `/vision` command sits in the web command palette).

Everything below is copy-paste runnable. Verified end to end on a real DSH
loop — CLI and web — with the test images in [`test-images/`](test-images/).

## 1. Install the engine, then the plugin

```sh
dsh plugin --profile <your-profile> add pi2dsh
dsh plugin --profile <your-profile> add @kassing/pi-vision
```

That's the whole install: the pi2dsh engine mounts every Pi package you
add to the profile — no conversion step, no generated bundles. (The
`npx pi2dsh convert` flow still exists for unpublished/local packages.)

If an add stops with `ERR_PNPM_IGNORED_BUILDS` (pnpm blocks dependency
build scripts by default): run `pnpm approve-builds` inside
`$DSH_HOME/profiles/<your-profile>` — or set the listed packages to `true`
under `allowBuilds` in that profile's `pnpm-workspace.yaml` — then re-run
the add command.

## 2. Point it at a vision model

Any OpenAI-compatible vision endpoint works (OpenRouter, DashScope/Qwen-VL,
a self-hosted vLLM, …). Simplest form — three environment variables:

```sh
export VISION_BRIDGE_BASE_URL=https://openrouter.ai/api/v1
export VISION_BRIDGE_MODEL=qwen/qwen2.5-vl-72b-instruct
export VISION_BRIDGE_API_KEY=$OPENROUTER_API_KEY     # $VAR references are supported
```

Or configure the vision endpoint as a DSH gateway route (the `llm-pi-ai:`
section of `$DSH_HOME/settings.yaml`, see the
[`custom-gateways`](../custom-gateways/) example) — that also puts the
vision model into DSH's own model picker.

Tip: avoid GPT-5/o-family models as the vision backend — that model
generation rejects non-default `temperature`, which some vision plugins
send.

## 3. Ask about an image

```sh
dsh --profile <your-profile> "What solid color fills the image at $PWD/test-images/solid-green.png ? Answer with just the color name."
```

Expected: the answer is `green`. The test images are solid colors with
neutral names (`solid-green.png` is the label, but the probe series used in
our verification carried hex-noise names), so a correct answer can only
come from the vision model actually reading pixels.

In the web app (`dsh web`), send the same message: you will see your
message's image path replaced by guide text, a
`pi2dsh:@kassing/pi-vision` context-injection row carrying the analysis,
and the text-only main model answering correctly.

`test-images/make-test-image.py out.png R G B` generates a solid PNG of any
color (no dependencies) if you want your own probe.

## 4. Paste images in the web app (text-only main model)

DSH's web app only lets you attach images when the selected model declares
image input — a text-only route would reject the paste. Declare an
**image-admission companion** for your text-only route in the engine's
plugin config — the profile's `cordis.patch.yml`
(`$DSH_HOME/profiles/<your-profile>/cordis.patch.yml`):

```yaml
- id: pi2dsh
  config:
    visionCompanions:
      deepseek-official:
        - deepseek-v4-flash
```

Restart `dsh web`. The model picker now shows a **“DeepSeek + Vision
Bridge”** group; select the model there, paste an image, and ask. The
attachment is accepted, @kassing/pi-vision analyzes it and injects the
result, your message's image block becomes guide text, and the text-only
model answers about the picture — pixels never reach the text-only wire.

Without the vision plugin (or when it is unconfigured), the companion
route still keeps the turn honest: each image block is replaced by a
notice carrying a materialized file path
(`[image attached at /tmp/... — use an image-capable tool to view it]`),
so the agent can reach the image through any path-taking image tool.

## What this exercises in pi2dsh

- `before_agent_start` with the turn's real prompt, and custom-message
  injection beside the user message (the pre-step input bridge)
- the `context` event's transform of the step's not-yet-entered messages
  (image path → guide text, analysis prefix)
- Pi command registration in the DSH command palette (`/vision`), including
  Pi's numbered-collision semantics when two plugins claim one name
- the image-admission companion route (`<route>-vision`): DSH-shaped
  engine config (`visionCompanions`) declaring image admission for an
  existing route, honest admission, text-only forwarding with
  path-carrying notices, and `ctx.model` reporting the original route so
  the vision plugin's activation check sees the truth
