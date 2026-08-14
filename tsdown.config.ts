import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/runtime.ts', 'src/host.ts', 'src/cli.ts', 'src/compat/pi-coding-agent.ts', 'src/compat/pi-tui.ts', 'src/compat/pi-ai.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//] },
  banner: ({ fileName }) => fileName.includes('cli') ? '#!/usr/bin/env node' : undefined,
})
