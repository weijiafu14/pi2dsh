import { defineConfig } from 'tsdown'

// Two artifacts, ONE config array, on purpose: the server half and the browser
// half are built by the same command. They were two commands for one afternoon,
// and `prepare` (which pnpm runs when a profile installs this package by path)
// ran only the first — so the main build's `clean` deleted the client bundle
// and the browser half silently vanished from every fresh install.

/**
 * Modules the shell owns and the browser half must NOT bundle: they carry
 * runtime identity (two React copies would not share hooks), and the loader
 * hands them to the factory through the injected `require`.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/runtime.ts', 'src/host.ts', 'src/cli.ts', 'src/credentials-oauth.ts', 'src/compat/pi-coding-agent.ts', 'src/compat/pi-tui.ts', 'src/compat/pi-ai.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//] },
    // Pi's license ships next to the vendored Pi code; the file must be in the
    // npm artifact (dist is the only published directory).
    copy: [{ from: 'src/compat/vendor/PI-LICENSE', to: 'dist/compat/vendor' }],
    banner: ({ fileName }) => fileName.includes('cli') ? '#!/usr/bin/env node' : undefined,
  },
  // The browser half, in the format DSH's client loader consumes. The host does
  // not publish its own preset, so the contract is reproduced from
  // packages/client/tsdown.client.ts: a CJS body wrapped in a closure factory
  // that registers itself with the loader.
  {
    entry: ['src/client.ts'],
    outDir: 'dist',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    // Runs after the entry above, whose `clean` owns the directory.
    clean: false,
    external: [...PLATFORM_MODULES, /^@deepseek-ai\//],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "pi2dsh", factory: (require) => {',
      footer: 'return module.exports; } });',
      // The loader hands the factory one argument — `require`. The CJS body's
      // other two free variables have to be declared inside the closure, or it
      // throws "exports is not defined" the moment the shell imports it.
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  // The dsh-x suite's browser half: the engine's client (source-level import)
  // plus the suite's own product UI (the MCP tab), registered under the
  // suite's OWN loader id — the host serves one bundle per client-declaring
  // package, and in a suite install only dsh-x is visible at the profile root.
  {
    entry: ['dsh-x/src/client.ts'],
    outDir: 'dsh-x',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    external: [...PLATFORM_MODULES, /^@deepseek-ai\//],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-x", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
