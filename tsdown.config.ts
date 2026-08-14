import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/runtime.ts', 'src/host.ts', 'src/cli.ts', 'src/credentials-oauth.ts', 'src/compat/pi-coding-agent.ts', 'src/compat/pi-tui.ts', 'src/compat/pi-ai.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//] },
  // The generator copies Pi's license next to vendored Pi code inside every
  // emitted bundle; the file must ship in the npm artifact (dist is the only
  // published directory).
  copy: [{ from: 'src/compat/vendor/PI-LICENSE', to: 'dist/compat/vendor' }],
  banner: ({ fileName }) => fileName.includes('cli') ? '#!/usr/bin/env node' : undefined,
})
