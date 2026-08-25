// dsh-x is the pi2dsh engine, carried one dependency-hop away: DSH's loader
// resolves patch-row modules from the PROFILE root, and under pnpm's isolated
// layout only direct profile dependencies are visible there. dsh-x is that
// direct dependency; the engine is dsh-x's own dependency and resolves from
// here. A re-export is the whole bridge — no second engine, no fork.
export * from 'pi2dsh'
