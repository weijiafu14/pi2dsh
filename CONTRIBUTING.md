# Contributing

Contributions should make one compatibility claim smaller, clearer, or better evidenced.

## Setup

```sh
corepack pnpm@11.7.0 install
pnpm verify
```

Node.js 22.19 or newer is required. Tests that exercise the official DSH plugin manager expect a DeepSeek Harness checkout at `../deepseek-harness`; set `PI2DSH_DSH_ROOT=/path/to/deepseek-harness` to use another checkout.

## Adding a Pi capability

1. Add or change the explicit rule in `src/compatibility.ts`.
2. Extend static analysis so aliases, destructuring, nested helpers, class fields, dynamic access, and the complete reachable local module graph cannot bypass the rule.
3. Implement the smallest runtime adapter with explicit failure for semantics DSH cannot preserve.
4. Add a fixture that exercises success, failure/cancellation where relevant, and lifecycle behavior.
5. Assert the behavior through native DSH services. For tools, verify durable `tool/call` and `tool/result` semantics, not only registration.
6. If this unblocks a community package, pin its version and add a package-specific runtime check before changing the public classification.

Do not upgrade a mapping from `partial` to `full` because the happy path happens to work. “Full” means the used Pi contract has a verified DSH equivalent, including important error and lifecycle behavior.

## Pull requests

Keep generated compatibility reports machine-readable, avoid credentials or raw private model transcripts, and preserve upstream license/notice files in generated bundles. Run `pnpm verify`; include `pnpm test:community` evidence when changing community-package compatibility.
