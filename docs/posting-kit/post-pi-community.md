# Companion post — Pi community

**Title**: Your Pi plugin now has a second host: pi2dsh runs Pi packages on DeepSeek Harness, unmodified

**Attach**: `assets/03-vision-bridge-answer.png` (optional: `assets/01-vision-companion-model-picker.png`, `assets/05-side-conversation-child-view.png`)

---

For plugin authors here: [pi2dsh](https://github.com/weijiafu14/pi2dsh) is a compatibility engine that runs Pi ecosystem plugins on DeepSeek Harness — **as published on npm**, no fork, no port, no conversion step. Your users install it with DSH's own command:

```sh
dsh plugin add pi2dsh        # the engine, once
dsh plugin add <your-package>  # your package, exactly as published
```

Nothing is asked of you. If your plugin uses Pi's public API, it works.

## What your plugin sees

Pi. `registerTool`, `registerCommand`, `registerProvider`, the event bus, `ctx.ui`, `ctx.sessionManager`, `ctx.modelRegistry`, `createAgentSession`, `exec` — all projected in Pi vocabulary. The three Pi imports (`pi-coding-agent`, `pi-tui`, `pi-ai`) resolve to a compatibility surface; Pi's pure logic is vendored byte-identical from upstream sources (MIT, license and source commits recorded in the repo), so semantics match rather than approximate. Your plugin never learns it's running somewhere else.

## What it maps onto

DSH's native services: tools, durable sessions, subprocess, user questions, attachments, the llm directory and credentials. Model calls — `registry.complete`, `getProvider().stream`, pi-ai's top-level `complete`/`stream`, subagent sessions — all route through the host's llm layer. No provider SDKs are loaded, so no SDK-shaped install weight or install scripts come along for the ride.

## An example that shows the shape of it

DSH's web app only accepts image attachments when the selected model declares image input — a text-only model would reject the paste outright. pi2dsh registers an image-admission companion route for every text-only route, so [@kassing/pi-vision](https://www.npmjs.com/package/@kassing/pi-vision) — written for Pi, unmodified — can do its job on DSH: the image is accepted, the plugin analyzes it through the vision endpoint the user configured, and the text-only model answers about the picture.

![vision bridge on DSH](assets/03-vision-bridge-answer.png)

## Honesty about the edges

Where DSH has no equivalent, pi2dsh doesn't fake it. Session-tree operations run on DSH's real fork surface (so forks land on completed-turn boundaries and lineage is recorded — the semantics are documented, not silently different); `shutdown()` is absorbed because Pi itself defines shutdown behavior as host-provided and DSH's user owns process exit; host-owned capabilities like package installation raise a structured, catchable error naming the DSH equivalent. Anything degraded is reported to the user once, per plugin, in plain language.

A plugin bug that also reproduces on real Pi is reported as a plugin bug, not patched into the bridge — the goal is behavioral parity with Pi, not a divergent dialect.

Repo and compatibility notes: https://github.com/weijiafu14/pi2dsh
