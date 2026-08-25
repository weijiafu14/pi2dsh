# Proposal: let a plugin bundle declare dependencies on other bundles

Posted to deepseek-ai/deepseek-harness · Ideas · 2026-08-25 — https://github.com/deepseek-ai/deepseek-harness/discussions/4543

---

**Title**: Proposal: first-class bundle-to-bundle dependencies (the in-box bundles already rely on this — third-party bundles can't)

**Body**:

## The gap

A third-party plugin bundle cannot declare "installing me should also mount these other bundles". Everything a suite/distribution-style plugin wants to carry has to be installed by the user as a separate top-level `dsh plugin add` argument.

We hit this building [dsh-work-x](https://github.com/weijiafu14/pi2dsh) (a batteries-included capability suite): it wants to carry its engine (`pi2dsh`) and a companion presentation plugin (`dsh-better-sidebar`). The engine we could smuggle through with re-export tricks (details below); the 7 MB independent client plugin we cannot and should not.

## Why in-box bundles don't feel this (verified on 0.1.1-rc.2)

`@deepseek-ai/dsh-base` is exactly this shape — one `bundles` entry whose patch inserts dozens of member rows by bare package name, all of them its own dependencies. It works because of an installation-tree privilege:

1. `resolveBundleDir` resolves bundle names installation-anchor first — its own comment says the contract is that in-box bundles "always come from the same installation as the running dsh".
2. Member row names then resolve through the CLI installation tree's pnpm hidden hoist. We probed this live: `import('@deepseek-ai/dsh-agent')` from a profile root resolves into `<cli install>/node_modules/.pnpm/...`.
3. A third-party bundle's transitive dependency has no such path: the loader imports entry names from the profile root, and pnpm's isolated layout keeps transitive deps out of it — `ERR_MODULE_NOT_FOUND` from `Entry._init` (we have the full stack).
4. `dsh.profile.bundles` is a profile-side list and reconcile records only the packages the user explicitly added — there is no package-side field that says "when I am added, also mount X" (read through app-boot).
5. client-modules scans the composed loader entries, but an entry naming a third-party transitive dependency dies at (3) first.

## What we do today (the workaround, shipped and working)

- The suite re-exports its engine through its own entry (`export * from 'pi2dsh'`) so the loader row resolves via the suite package, and embeds the engine's client bundle into its own client bundle under its own loader id.
- For the independent companion plugin that cannot be embedded, the README teaches `dsh plugin --profile web add dsh-work-x dsh-better-sidebar` — one command, but the "suite" is no longer self-contained, and every suite author will reinvent these tricks.

## Proposal (either would close it)

**A. Package-side companion declaration** — e.g.

```jsonc
// package.json of a bundle
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml",
    "companions": ["dsh-better-sidebar"]   // added to dsh.profile.bundles on `dsh plugin add`
  }
}
```

`dsh plugin add <suite>` expands companions into the profile's bundle list (they are already in the dependency closure, so pnpm has installed them; reconcile just needs to record them).

**B. Generalize the in-box anchor** — resolve a bundle patch's member row names (and client-modules' package lookups) with the declaring bundle's own directory as an additional anchor, the way `resolveBundleDir` already privileges the installation tree. Then a bundle's patch can mount its own dependencies exactly like dsh-base mounts its members.

A is a smaller change and keeps the profile manifest as the single source of what is mounted. B is more general (no manifest growth) and simply extends to third parties the resolution contract in-box bundles already enjoy.

Happy to contribute a PR for either direction if there's interest — we have the failing-resolution reproductions and a real consumer to validate against.
