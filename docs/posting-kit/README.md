# Posting kit — pi2dsh 0.10.0

Everything needed to announce pi2dsh 0.10.0 and bring earlier posts up to date.
Written for someone else to post: copy a file's body, attach the named
screenshots, publish.

**Status of the facts in here**: every number and claim was verified on
2026-08-15 against pi2dsh 0.10.0 (published to npm) — `pnpm verify` green
(92 contract tests), CLI and web end-to-end runs, and a bare-environment
install from the public registry. The screenshots in `assets/` are from a
clean DSH home with only the public DeepSeek routes configured; no internal
gateways, hosts, or credentials appear in any of them.

## Files

| File | What it is |
|---|---|
| `post-dsh-showcase.md` | Main announcement for the DSH community (Show and tell) |
| `post-pi-community.md` | Companion post for the Pi community |
| `updates-to-earlier-posts.md` | One short update comment per earlier thread (#14, #218, #421, #759, #1120, #1398) |
| `support-matrix.md` | What is supported today, what is deliberately not, with evidence |
| `assets/` | Screenshots (see below) |
| `archive-0.2.0/` | The superseded 0.2.0-era drafts, kept for reference — **do not post these** |

## Screenshots

| File | Shows |
|---|---|
| `assets/01-vision-companion-model-picker.png` | The model picker: the provider's own group, plus the `+ Vision Bridge` group pi2dsh registers automatically for every text-only route |
| `assets/02-image-accepted-by-text-only-model.png` | An image attachment accepted while a text-only model is selected |
| `assets/03-vision-bridge-answer.png` | The result: the image block becomes guide text, a `pi2dsh:@kassing/pi-vision` context-injection row carries the analysis, and the text-only model answers `green` |

Reproduce them: `node docs/posting-kit/capture-screenshots.mjs <out-dir>` against a
DSH web instance with the engine and `@kassing/pi-vision` installed (see
`examples/vision-bridge/`).

Note for whoever posts: the guide text inside screenshot 3
(`[图片已由外部视觉模型分析…]`) is the vision plugin's own wording, not
pi2dsh's — worth a one-line caption if the audience is English-speaking.

## Ground rules for posting

- Nothing internal: no internal gateway URLs, hostnames, model aliases, or keys
  in text or images. Examples use OpenRouter as the placeholder endpoint.
- Every claim in these drafts is backed by something reproducible. If a reviewer
  challenges a number, the answer is a command they can run, not an assertion.
- Post as a participant, not a vendor: the honest-boundaries section stays in.
