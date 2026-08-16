# Posting kit — pi2dsh 0.12.3

Everything needed to announce pi2dsh 0.12.3 and bring earlier posts up to date.
Written for someone else to post: copy a file's body, attach the named
screenshots, publish.

**Status of the facts in here**: every number and claim was verified on
2026-08-17 against pi2dsh 0.12.3 (published to npm) — `pnpm verify` green,
CLI and web end-to-end runs on the published engine, and a bare-environment
install from the public registry. The side-conversation screenshots come from
the automated regression (`pnpm test:examples`), not a hand-driven session. The screenshots in `assets/` are from a
clean DSH home with only the public DeepSeek routes configured; no internal
gateways, hosts, or credentials appear in any of them.

## Files

| File | What it is |
|---|---|
| `post-dsh-showcase.md` | Main announcement for the DSH community (Show and tell) |
| `post-pi-community.md` | Companion post for the Pi community |
| `post-xiaohongshu.md` | Xiaohongshu title and ready-to-post Chinese body |
| `updates-to-earlier-posts.md` | One short update comment per earlier thread (#14, #218, #421, #759, #1120, #1398) |
| `replies-gateway-compat.md` | Replies for the four `developer`-role / gateway-compat threads (#472, #990, #1232, #1498) — one shared body, per-thread opener |
| `support-matrix.md` | What is supported today, what is deliberately not, with evidence |
| `assets/` | Screenshots (see below) |
| `archive-0.2.0/` | The superseded 0.2.0-era drafts, kept for reference — **do not post these** |

## Screenshots

| File | Shows |
|---|---|
| `assets/01-vision-companion-model-picker.png` | The model picker: the provider's own group, plus the `+ Vision Bridge` group pi2dsh registers automatically for every text-only route |
| `assets/02-image-accepted-by-text-only-model.png` | An image attachment accepted while a text-only model is selected |
| `assets/03-vision-bridge-answer.png` | The result: the image block becomes guide text, a `pi2dsh:@kassing/pi-vision` context-injection row carries the analysis, and the text-only model answers `green` |
| `assets/01-side-conversation-main-thread-clean.png` | A side question asked with `/btw`: the main conversation gains only a `btw · Completed` status line, and a `1 subagent` control appears in the header |
| `assets/02-side-conversation-panel.png` | The floating panel pi2dsh's own browser half draws in DSH's `shell.overlay` seat: the side question and its answer, while the conversation underneath still has neither |
| `assets/03-side-conversation-host-catalog.png` | DSH's own subagent list, with the `pi-btw side conversation` row (`continuable · not running`) |
| `assets/04-side-conversation-injected-on-request.png` | After `/btw-inject`: the thread enters the main conversation — the user's explicit action, and only then |
| `assets/06-pi-surfaces-on-dsh.png` | Nine Pi presentation calls on screen at once, each in the host's own seat: header (top right), a package's own custom entry inside the conversation, widget lines beside the composer, footer / working message / indicator / thinking label below it, and title + status as pills |
| `assets/05-side-conversation-child-view.png` | The side thread opened as its own session: its own breadcrumb, its own composer, the answer inside it |
| `assets/xiaohongshu-cover-v2.png` | 3:4 Xiaohongshu cover: give DeepSeek Harness visual capabilities through the Pi ecosystem |

Reproduce the side-conversation set against a DSH web instance with the engine
and `pi-btw` installed (see `examples/side-conversation/`):

```sh
PLAYWRIGHT_FROM=<a-project-that-has-playwright> \\
  node docs/posting-kit/capture-screenshots.mjs <out-dir> --url http://127.0.0.1:<port>
```

The script drives the real user path and **asserts** what the pictures claim —
it fails if the side answer ever appears in the main conversation. Add
`--locale zh-CN` for the Chinese UI. The vision set was captured by hand
against `examples/vision-bridge/`.

Note for whoever posts: the guide text inside screenshot 3
(`[图片已由外部视觉模型分析…]`) is the vision plugin's own wording, not
pi2dsh's — worth a one-line caption if the audience is English-speaking.

## Ground rules for posting

- Nothing internal: no internal gateway URLs, hostnames, model aliases, or keys
  in text or images. Examples use OpenRouter as the placeholder endpoint.
- Every claim in these drafts is backed by something reproducible. If a reviewer
  challenges a number, the answer is a command they can run, not an assertion.
- Post as a participant, not a vendor: lead with verified outcomes and runnable
  examples. Keep research limitations in the internal evidence matrix unless a
  community question directly calls for that detail.
