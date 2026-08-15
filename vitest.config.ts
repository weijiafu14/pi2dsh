import { defineConfig } from 'vitest/config'

// Without a local config, vitest walks up and inherits the parent repo's
// vite.config.js (including its coverage thresholds). Pin this project's own.
export default defineConfig({
  test: {
    // Real-DSH integration fixtures (a full cordis Context with the session/
    // tools/commands/skills plugins) exceed the 5s default under coverage
    // instrumentation with many suites in flight.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Vendored Pi sources are byte-identical upstream code covered by Pi's
      // own suite; measuring them here misstates the bridge's coverage.
      exclude: ['src/compat/vendor/**'],
    },
  },
})
