import { defineConfig } from 'vitest/config'

// Without a local config, vitest walks up and inherits the parent repo's
// vite.config.js (including its coverage thresholds). Pin this project's own.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Vendored Pi sources are byte-identical upstream code covered by Pi's
      // own suite; measuring them here misstates the bridge's coverage.
      exclude: ['src/compat/vendor/**'],
    },
  },
})
