# Pi community corpus: evidence, not claims

This directory holds the machine-readable results for the top-50 Pi extensions (official catalog, sorted by monthly downloads, captured 2026-08-14; pinned in [`corpus.json`](corpus.json)). It separates four questions that are often collapsed into one word, "compatible":

1. **Static screening** — does analysis find fatal supply-chain findings (incomplete module closure, undeclared runtime dependencies, resource escapes)? Anything non-fatal installs; screening never certifies. → [`audit-results.json`](audit-results.json)
2. **Black-box certification** — does the package actually mount in a real DSH runtime composition, and what registration surface (tools/commands/skills) comes alive? With `--exercise`, representative tools and commands are then **executed** with schema-derived arguments against local fixture services, and each attempt is graded:
   - `working` — a real invocation returned success
   - `executed-input-validation` — the package's own business logic ran and rejected the synthetic probe arguments (execution path proven end-to-end)
   - `callable-needs-config` — the call executed but wants credentials/services the harness doesn't provide
   - `timed-out` — the call was still executing when the harness's 20s probe abort fired (e.g. it dispatches a child `pi` process the fixture environment cannot serve); not a package failure
   - `failed` — something else broke; the message is an attributed gap
   → [`blackbox-results.json`](blackbox-results.json)
3. **Deep runtime + official manager** — four pinned packages execute their real capability paths (LSP subprocess over JSON-RPC, web search/fetch, PNG generation, ask_user), pass official `dsh plugin` add/activate/remove, and one **host bundle** mounts two unmodified packages through the same official flow. → [`runtime-results.json`](runtime-results.json)
4. **Real model acceptance** — `deepseek-official/deepseek-v4-flash` calls a migrated Pi tool; the durable session log is asserted (exact call count, arguments, result, turn completion) and the credential is proven absent from every artifact. → [`live-deepseek-results.json`](live-deepseek-results.json)

Regenerate any layer:

```sh
pnpm audit:community
node scripts/blackbox-community.mjs community/blackbox-results.json --exercise
pnpm test:community
DEEPSEEK_API_KEY=… pnpm test:live
```

Safety notes for the exercise layer: tools whose names indicate mutation of shared state are skipped; exec-style tools run a harmless `echo` through the real subprocess seam; everything runs in an isolated scratch workspace with no real credentials, so external-service tools naturally land in `callable-needs-config` rather than performing outbound actions.
