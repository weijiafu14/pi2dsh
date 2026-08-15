# Support matrix — what is verified, what is deliberately not

Every number here was re-checked on 2026-08-15 against the working tree that
becomes pi2dsh 0.11.0. Where a claim comes from a machine-readable artifact,
the file is named so a reader can re-run it.

## Verification levels (they are not the same claim)

| Level | What it means | Coverage |
|---|---|---|
| **Contract tests** | Public-API behavior pinned by tests, no plugin required | 93 tests / 17 files (`pnpm verify`) |
| **Static screening** | Every Pi API a package touches is classified against the compatibility table | top-50 Pi packages by downloads: **50/50 audited, 0 blocked** (`community/audit-results.json` — all 50 land in `review`, i.e. every use maps to a `full`/`partial` rule; nothing hits a fatal one) |
| **Black-box mount** | Package really mounts in a Cordis composition with official DSH service plugins | **48/50 mounted**, 2 failed for a reason inside the harness's own snapshot step, not an ABI gap (`community/blackbox-results.json`: `pi-hashline-edit-pro`, `pi-interview` — `vendor/index.ts ENOENT`; both need a re-run before being reported as anything) |
| **End-to-end on a real DSH loop** | Real model, real turn, CLI **and** web, seen with our own eyes | the plugins listed below |

## Plugins verified end to end

| Plugin | What was exercised | Where |
|---|---|---|
| [@kassing/pi-vision](https://www.npmjs.com/package/@kassing/pi-vision) | Image analysis delegated to a vision endpoint; image-admission companion route; context injection into a text-only model | CLI + web (screenshots in `assets/`) |
| [pi-vision-tool](https://www.npmjs.com/package/pi-vision-tool) | Tool registration with a JSON-Schema shape DSH had to convert (`anyOf` → `oneOf`) | CLI + web |
| [pi-approval-guardian](https://www.npmjs.com/package/pi-approval-guardian) | Every tool call reviewed by a separate model before execution; allow/deny both observed | CLI (bare environment, `danger-full-access`) |
| [pi-hermes-memory](https://www.npmjs.com/package/pi-hermes-memory) | Cross-session memory: written in one process, read back in a second, fresh process | CLI |
| [pi-btw](https://www.npmjs.com/package/pi-btw) | Side conversation with a seeded transcript; `/btw <question> --save` visible in the web transcript | web (0.11.0 fixes — see below) |
| [pi-fabric](https://www.npmjs.com/package/pi-fabric) | Tool-catalog wrapping through Pi's runner prototype | contract level |

## Capabilities

**Real, on DSH's own official surfaces**: tools · slash commands · prompt
commands · skills · lifecycle events · `before_agent_start` input bridging ·
context transforms · interactive OAuth `/login` · subagents through
`ctx.agents` · session control (`newSession`/`fork`/`navigateTree`/`switchSession`
on `ctx.sessions.create`/`fork`) · `ctx.compact()` on DSH's manual compaction ·
`reload()` remounting plugin entries · Pi's settable `state.messages` transcript
on a bridged child session · model calls through the DSH `llm` directory ·
MCP through the official MCP client · credentials through DSH credentials.

**Absorbed, per Pi's own host-defined semantics**: `shutdown()` — Pi delegates
shutdown behavior to the host; on DSH the user owns process exit. Reported to
the user once; the plugin keeps running.

**Deliberately unavailable** (4 items, all governance rather than difficulty):

| Capability | Why |
|---|---|
| `DefaultPackageManager` | Installing packages at runtime is the host's job, behind pnpm's build-script approval — `dsh plugin add/remove` |
| `ModelRuntime` | A standalone model stack would be a second model directory; DSH's llm configuration is the one directory, read through `ctx.modelRegistry` |
| `before_provider_request` / `before_provider_headers` / `after_provider_response` | Provider payload/header/response interception belongs in a DSH llm adapter, not in a plugin |
| `project_trust`, `resources_discover` | Project trust is a host decision; dynamic resource discovery must be converted into DSH providers |

Importing the first two is flagged at mount time; constructing them throws a
structured, catchable error, and doing so during a plugin's startup marks that
plugin unusable with a removal hint. The event hooks are accepted at
registration and never fire — the same as Pi's own non-TUI modes.

**Known plugins unusable for a deliberate boundary: none.** (This line names
any we find; it is currently empty.)

## Known gap we own

**Plugin-drawn UI in the DSH web app.** Pi plugins can carry their own
renderers (`registerMessageRenderer` / `registerEntryRenderer`) and mark a
custom message `display: true` so it renders as their own card. On DSH today
those registrations are accepted and never invoked, and such a note surfaces
as a native `Context injection · pi2dsh:<package>` row instead of the plugin's
own card — the content reaches both the user and the model, but not with the
plugin's styling.

This is **our** missing half, not a DSH limitation: DSH has a public client
plugin mechanism (a package declares `dsh.client` and exports `./client`; the
host serves it to the web app) and a slot registry
(`ctx.slots.register({ name: 'conversation.chat.node', key }, Component)`) that
the app's own node renderers use. pi2dsh only ships the Node half today.
Building the client half is a tracked next step.

## Reproduce

```sh
pnpm verify                      # typecheck + 93 contract tests + packaging
pnpm audit:community             # static screening over the top-50 corpus
pnpm test:community              # deep runtime + official plugin manager + host e2e
```
