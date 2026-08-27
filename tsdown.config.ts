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
    deps: { neverBundle: [/^@deepseek-ai\//, /^@xmoon76\/dsh-pi-tui(?:\/|$)/] },
    // Pi's license ships next to the vendored Pi code; the file must be in the
    // npm artifact (dist is the only published directory).
    copy: [{ from: 'src/compat/vendor/PI-LICENSE', to: 'dist/compat/vendor' }],
    banner: ({ fileName }) => fileName.includes('cli') ? '#!/usr/bin/env node' : undefined,
  },
  // The dsh-x suite's browser half — THE web renderer for the Pi surfaces.
  // The engine deliberately ships no client bundle of its own (2026-08-27):
  // an engine-only web composition stays in Pi's rpc mode (headless
  // semantics), and presentation is a product concern the suite owns. The
  // suite's bundle composes the engine's renderer SOURCE (src/client.ts, a
  // source-level import in the same repository) plus the suite's own product
  // UI, registered under the suite's loader id — the host serves one bundle
  // per client-declaring package, and in a suite install only dsh-x is
  // visible at the profile root. The CJS closure-factory format is
  // reproduced from the host's packages/client/tsdown.client.ts (the host
  // does not publish its preset); the intro declares `module`/`exports`
  // inside the factory, or the shell throws "exports is not defined".
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
      banner: 'window.__ModuleLoader__.load({ id: "dsh-work-x", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
