// Shared headless-E2E harness: a throwaway DSH home on the real dsh CLI.
// ONE authority for this recipe — verify-examples-e2e and the provider-threads
// battery both build homes this way; the overrides block below is load-bearing
// (2026-08-25 upstream `latest`-tag breakage) and a hand-copied second version
// is exactly how one consumer would keep running old pins.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export async function filesBelow(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(path))
    else if (entry.isFile()) output.push(path)
  }
  return output
}

/**
 * @param dshRoot - a deepseek-harness checkout (only used without directDshBin,
 *   and to enumerate core packages for the overrides block).
 * @param directDshBin - an installed `dsh` executable (stock npm CLI); when
 *   set, runs go through it directly with no tsx loader.
 * @param dshBin - the CLI entry used without directDshBin (checkout bin.ts).
 * @param dshCwd - working directory for CLI runs (overridable per call).
 */
export function createE2eHarness({ dshRoot, directDshBin, dshBin, dshCwd }) {
  /** A throwaway DSH home with a pnpm shim, the way the other e2e scripts build one. */
  async function makeHome(scratch, extraEnv = {}) {
    const home = join(scratch, 'dsh-home')
    const shimDir = join(scratch, 'bin')
    await mkdir(shimDir, { recursive: true })
    const pnpmShim = join(shimDir, 'pnpm')
    await writeFile(pnpmShim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
    await chmod(pnpmShim, 0o755)
    const env = {
      ...process.env,
      DSH_HOME: home,
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
      CI: '1',
      NO_COLOR: '1',
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
      npm_config_registry: 'https://registry.npmjs.org',
      PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
      // A release check installs a release that is minutes old, and pnpm 11 holds
      // back very recent versions by default (minimumReleaseAge) — the profile
      // install then fails with nothing but "pnpm failed in profile directory".
      // Turning it off here is a property of the harness, not of the product: a
      // user installing tomorrow is past the window anyway.
      PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
      ...extraEnv,
    }
    const runDsh = async (args, { cwd, timeout } = {}) => {
      // Two upstream breakages this harness pre-empts in every profile, the
      // same way a user following the READMEs would:
      //  - dsh-TUI 0.9.1+ pulls pi-ai -> @google/genai -> protobufjs, whose
      //    install scripts pnpm blocks (ERR_PNPM_IGNORED_BUILDS); declared as
      //    "installed, scripts not run", the CLI install dir's own stance.
      //  - On 2026-08-25 the official @deepseek-ai core packages moved their
      //    npm `latest` tag to 0.0.1-rc.1, which broke pnpm's tag fallback for
      //    dsh-TUI's release-range (^0.1.1) core deps — NO version of dsh-TUI
      //    installs without pinning. The overrides pin every core package to
      //    the CLI's own generation, read from the CLI tree rather than a
      //    hand-copied list.
      const profileFlag = args.indexOf('--profile')
      if (args[0] === 'plugin' && profileFlag !== -1 && args.includes('add')) {
        const profileDir = join(home, 'profiles', String(args[profileFlag + 1]))
        const workspaceFile = join(profileDir, 'pnpm-workspace.yaml')
        await mkdir(profileDir, { recursive: true })
        if (!existsSync(workspaceFile)) {
          const lines = [
            'minimumReleaseAge: 0',
            'allowBuilds:',
            "  '@google/genai': false",
            '  protobufjs: false',
            // pi-hermes-memory needs its native store actually built — unlike
            // the two above, declaring-without-running would break the plugin.
            // README of examples/persistent-memory tells users the same thing
            // (approve-builds better-sqlite3).
            "  'better-sqlite3': true",
          ]
          const pnpmStore = directDshBin === undefined
            ? join(dshRoot, 'node_modules', '.pnpm')
            : resolve(directDshBin, '..', '..', '.pnpm')
          const core = new Set()
          if (existsSync(pnpmStore)) {
            for (const entry of await readdir(pnpmStore)) {
              if (entry.startsWith('@deepseek-ai+dsh')) {
                core.add(`@deepseek-ai/${entry.slice('@deepseek-ai+'.length).split('@0')[0]}`)
              }
            }
          }
          if (core.size === 0) {
            // A source checkout links core packages from its workspace, so its
            // .pnpm has no @deepseek-ai entries at all — enumerate the names
            // from the workspace's packages/ tree instead. Without this branch
            // the overrides block comes out empty and every dsh-TUI install
            // dies on the 2026-08-25 upstream `latest`-tag breakage.
            const stack = [join(dshRoot, 'packages')]
            while (stack.length > 0) {
              const current = stack.pop()
              let entries = []
              try { entries = await readdir(current, { withFileTypes: true }) } catch { continue }
              for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
                const dir = join(current, entry.name)
                if (!entry.isDirectory()) continue
                try {
                  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
                  if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/dsh')) {
                    core.add(manifest.name)
                    continue
                  }
                } catch { /* not a package dir: descend */ }
                stack.push(dir)
              }
            }
          }
          if (core.size > 0) {
            lines.push('overrides:')
            for (const name of [...core].sort()) lines.push(`  "${name}": 0.1.1-rc.2`)
          }
          await writeFile(workspaceFile, `${lines.join('\n')}\n`)
        }
      }
      return execFile(
        directDshBin === undefined ? 'node' : directDshBin,
        directDshBin === undefined ? ['--import', 'tsx/esm', dshBin, ...args] : args,
        {
          cwd: cwd ?? dshCwd,
          env,
          timeout: timeout ?? 300_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
    }
    return { home, env, runDsh }
  }

  /** Point the profile's session log somewhere this script can read it. */
  async function useJsonlSessions(home, profile) {
    await writeFile(join(home, `profiles/${profile}/cordis.patch.yml`), [
      '- id: session-persistence-jsonl',
      '  config:',
      "    root: !!js dshHomePath('sessions')",
      '    compression: none',
      '',
    ].join('\n'))
  }

  /**
   * Route the profile's default model, the way the examples' READMEs do — the
   * CLI has no --model flag; the selection is settings.
   */
  async function useDefaultModel(home, provider, model, reasoningEffort) {
    await writeFile(join(home, 'settings.yaml'), [
      'agent-default-model:',
      `  provider: ${provider}`,
      `  model: ${model}`,
      ...(reasoningEffort === undefined ? [] : [`  reasoningEffort: ${reasoningEffort}`]),
      '',
    ].join('\n'))
  }

  /** Session records from the session log(s) a scenario's home produced. */
  async function sessionRecords(home, { expect = 1 } = {}) {
    // Most scenarios drive exactly one turn; a count mismatch there means the
    // lane ran something it did not intend to. A multi-turn scenario passes
    // its own expectation (mcp-at-scale runs two prompts = two sessions) and
    // gets every session's records back, in file order.
    const files = (await filesBelow(join(home, 'sessions'))).filter(path => path.endsWith('/session.jsonl')).sort()
    assert.equal(files.length, expect, `expected ${expect} session log(s), found ${files.length}:\n  ${files.join('\n  ')}`)
    const all = []
    for (const file of files) {
      all.push(...(await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)))
    }
    return all
  }

  return { makeHome, useJsonlSessions, useDefaultModel, sessionRecords }
}
