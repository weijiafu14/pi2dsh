# AGENTS.md

## Architecture mapping is a required deliverable

pi2dsh is both an ecosystem bridge and an executable architecture test for DeepSeek Harness.
Any agent changing compatibility behaviour must follow the single mapping standard in
[`docs/architecture-mapping-standard.md`](docs/architecture-mapping-standard.md).

Architecture knowledge is maintained as ordinary Markdown, not a JSON ledger or generated verdict.
Use [`docs/architecture-mapping-matrix.md`](docs/architecture-mapping-matrix.md) for the evolving
Pi/DSH branches, [`docs/plugin-validation-matrix.md`](docs/plugin-validation-matrix.md) for real
plugin evidence, and [`docs/dsh-architecture-conformance.md`](docs/dsh-architecture-conformance.md)
for conclusions. Do not create a parallel taxonomy. `src/compatibility.ts` is the leaf-level runtime
inventory, not an architectural verdict by itself.

## Required model

Organize Pi as capability domain → capability contract → concrete interface, and DSH as architecture
domain → carrying mechanism → public seam. Concrete leaves are an open inventory: add newly found
interfaces and modules under the appropriate branch, and revise the abstraction when a leaf does not
fit. Counts such as 111 Pi rules or 45 DSH subsystems are versioned observations, never invariants or
proof of completeness.

The theoretical mapping compares five semantic dimensions: user goal, intervention timing,
authoritative state, lifecycle and native presentation. Matching names are not sufficient.

## Required validation

Every real plugin validation references existing mapping IDs and traces five layers:

```text
Pi call → pi2dsh translation → public DSH seam → DSH authority → user-visible/restorable result
```

Grade each mapping independently:

1. native;
2. reliable translation;
3. sidecar/workaround;
4. degraded or missing;
5. host-specific and not scored.

Do not give a whole package one blanket result when it exercises multiple capabilities.

## Required attribution

- A suitable public DSH seam exists but the bridge has not used it: pi2dsh debt.
- The correct data or decision point is outside every public seam, with a real consumer and a
  minimal reproduction: confirmed DSH gap and a stable `DSH-ARCH-*` ID.
- A terminal/CLI implementation should be re-expressed for DSH rather than copied: host difference.
- A theoretical mapping without a real plugin run: theoretically viable, not yet verified.

A second authority store or sidecar is grade 3 even when the user workflow works. An alternate
adapter that bypasses a broken seam does not prove the original seam is fixed.

## Same-change documentation rule

When adding or changing a capability, update in the same change:

1. `src/compatibility.ts` for the concrete runtime behaviour;
2. the relevant Markdown architecture branch and real-plugin validation record;
3. contract tests and, for user workflows, real DSH CLI/Web evidence;
4. generated capability pages only when the runtime inventory changed.

`pnpm check:docs` must stay green, but automation may only check facts derived directly from runtime
code. Do not generate architecture classifications, theoretical mappings, grades or attribution, and
do not hard-code interface/module totals into CI.
