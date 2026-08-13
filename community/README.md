# Pi community audit

This directory separates three questions that are often incorrectly collapsed into “compatible”:

1. Can the package be analyzed without unknown or unsupported Pi API use?
2. Can its bundle be installed, activated, and removed by the official DSH plugin manager?
3. Does its important capability actually execute through DSH?

## Corpus and results

- Source: official [Pi package catalog](https://pi.dev/packages?type=extension)
- Captured: 2026-08-14
- Selection: first 50 extensions sorted by monthly downloads
- Static audit: 0 ready, 4 review, 46 blocked, 0 errors
- Runtime candidates: 4/4 loaded and executed their stated checks
- Official plugin manager: 4/4 install, activation, and removal checks passed
- Full-fidelity packages in the top 50: 0

The pinned corpus is in [`corpus.json`](corpus.json). [`audit-results.json`](audit-results.json) contains every package, exact resolved version, download rank, repository, finding counts, partial capabilities, and blockers.

## Direct-use classification

| Rank | Package | Downloads/month | What was actually executed | Classification |
|---:|---|---:|---|---|
| 21 | `@narumitw/pi-lsp@0.49.4` | 16,300 | Spawned a fixture JSON-RPC LSP; ran diagnostics and fix | Directly usable core tools |
| 34 | `pi-ask-user@0.14.0` | 10,400 | Registered tool, returned explicit headless fallback, discovered skill | Degraded; not interaction-equivalent |
| 35 | `@juicesharp/rpiv-web-tools@2.4.0` | 9,876 | SearXNG-backed search plus real HTTP fetch | Directly usable core tools |
| 47 | `@amaster.ai/pi-image-gen@0.1.8` | 8,204 | OpenAI-compatible image endpoint, real PNG file, discovered skill | Directly usable core tool and skill |

“Directly usable core” is deliberately narrower than “fully compatible.” All four remain `review` because at least one used capability is partial. `pi-ask-user` is not counted among the three direct-use packages because DSH headless does not provide Pi's terminal interaction surface.

## Evidence files

- [`audit-results.json`](audit-results.json): reproducible static result for all 50 packages.
- [`runtime-results.json`](runtime-results.json): sanitized runtime checks and official DSH plugin-manager results.
- [`live-deepseek-results.json`](live-deepseek-results.json): sanitized real-model call/result evidence. It contains no credential or raw session transcript.

The runtime and live-model evidence were produced against DSH commit `47f943859bef60e4160492346772ded9b24f765a`. Results describe those pinned package versions and that DSH revision; rerun after relevant upstream changes.

## Reproduce

```sh
pnpm build
node scripts/audit-community.mjs
node scripts/verify-community.mjs --generate community/runtime-results.json
DEEPSEEK_API_KEY=... node scripts/verify-live-deepseek.mjs community/live-deepseek-results.json
```

`verify-community.mjs --generate` downloads the four exact versions above into a temporary directory, converts them, performs runtime checks, and removes the artifacts. The live test reads the key only from process environment and rejects evidence if the credential appears in captured output or the durable session.
