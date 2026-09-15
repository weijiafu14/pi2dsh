// Shared headless-E2E harness: a throwaway DSH home on the real dsh CLI.
// ONE authority for this recipe — verify-examples-e2e and the provider-threads
// battery both build homes this way; the overrides block below is load-bearing
// (2026-08-25 upstream `latest`-tag breakage) and a hand-copied second version
// is exactly how one consumer would keep running old pins.
import { isSessionLog } from './session-log.mjs'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/** Resolve the running CLI's actual dependency graph in npm and pnpm layouts. */
export function installedCoreVersions(bin) {
  let dir = dirname(realpathSync(bin))
  const sibling = resolve(bin, '..', '..', '@deepseek-ai/dsh/package.json')
  let manifest = existsSync(sibling) ? sibling : undefined
  while (manifest === undefined) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === '@deepseek-ai/dsh') {
      manifest = candidate
      break
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Cannot locate the installed DSH manifest for ${bin}`)
    dir = parent
  }
  const core = new Map()
  const seen = new Set()
  const pending = [manifest]
  while (pending.length > 0) {
    const file = realpathSync(pending.pop())
    if (seen.has(file)) continue
    seen.add(file)
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    const previous = core.get(pkg.name)
    assert(previous === undefined || previous === pkg.version, `CLI mixes ${pkg.name}@${previous} and ${pkg.version}`)
    core.set(pkg.name, pkg.version)
    const require = createRequire(file)
    for (const name of new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})])) {
      if (!name.startsWith('@deepseek-ai/dsh')) continue
      const found = (require.resolve.paths(name) ?? [])
        .map(root => join(root, name, 'package.json')).find(existsSync)
      if (found === undefined && !Object.hasOwn(pkg.dependencies ?? {}, name)) continue
      assert(found !== undefined, `CLI dependency is missing: ${name}`)
      pending.push(found)
    }
  }
  return core
}

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
      // pnpm's default 60s fetch timeout kills large tarballs on a slow pipe
      // — recheck-jar (21MB, a dep of pi-mcp-adapter ≥2.31) measured 89s on
      // 2026-08-31 and failed every install with nothing but "pnpm failed in
      // profile directory". Harness property: a user's one install can retry,
      // a 20-scenario regression must not flake on it.
      PNPM_CONFIG_FETCH_TIMEOUT: '300000',
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
            // The 0.1.2 lines' initProfile writes `packages: [.]` and their
            // `plugin add` forwards to raw pnpm, which refuses a workspace
            // file without a packages field ("packages field missing or
            // empty") — but only for registry specs; file: installs take
            // another path, which is why the engine add worked while every
            // community-package add died (2026-08-31). Pre-writing this file
            // must therefore reproduce that field; the rc lines ignore it.
            'packages:',
            '  - .',
            'minimumReleaseAge: 0',
            'allowBuilds:',
            "  '@google/genai': false",
            '  protobufjs: false',
            '  esbuild: true',
            // pi-hermes-memory needs its native store actually built — unlike
            // the two above, declaring-without-running would break the plugin.
            // README of examples/persistent-memory tells users the same thing
            // (approve-builds better-sqlite3).
            "  'better-sqlite3': true",
            // dsh-better-sidebar's terminal tab needs node-pty built; same
            // approve-builds story as the CLI install docs already give.
            "  'node-pty': true",
          ]
          const pnpmStore = directDshBin === undefined
            ? join(dshRoot, 'node_modules', '.pnpm')
            : resolve(directDshBin, '..', '..', '.pnpm')
          // name -> version, BOTH read from the CLI tree. The pin version must
          // be the CLI's own generation: a hardcoded version here quietly pins
          // an alpha CLI's profiles to rc core — exactly the mixed-generation
          // install CLAUDE.md's E2E notes call an incident (caught 2026-08-31
          // when the alpha.2 regression inherited rc.2 pins).
          const core = directDshBin === undefined ? new Map() : installedCoreVersions(directDshBin)
          if (directDshBin === undefined && existsSync(pnpmStore)) {
            for (const entry of await readdir(pnpmStore)) {
              if (!entry.startsWith('@deepseek-ai+dsh')) continue
              const bare = entry.slice('@deepseek-ai+'.length)
              const at = bare.indexOf('@')
              if (at === -1) continue
              const name = `@deepseek-ai/${bare.slice(0, at)}`
              const version = bare.slice(at + 1).split(/[_(]/u)[0]
              if (version !== '') core.set(name, version)
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
                  if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/dsh')
                    && typeof manifest.version === 'string') {
                    core.set(manifest.name, manifest.version)
                    continue
                  }
                } catch { /* not a package dir: descend */ }
                stack.push(dir)
              }
            }
          }
          if (core.size > 0) {
            lines.push('overrides:')
            for (const name of [...core.keys()].sort()) lines.push(`  "${name}": ${core.get(name)}`)
          }
          await writeFile(workspaceFile, `${lines.join('\n')}\n`)
        }
      }
      const spawnDsh = (dshArgs) => execFile(
        directDshBin === undefined ? 'node' : directDshBin,
        directDshBin === undefined ? ['--import', 'tsx/esm', dshBin, ...dshArgs] : dshArgs,
        {
          cwd: cwd ?? dshCwd,
          env,
          // 600s, not 300: with a cold pnpm store and the bounded pool's six
          // installs sharing a slow proxy, one profile install measured 92s
          // SOLO — under contention 300s truncated installs into blank
          // "Command failed" errors across the board (2026-08-31, right
          // after a store prune).
          timeout: timeout ?? 600_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
      try {
        return await spawnDsh(args)
      } catch (error) {
        // The 0.1.2 lines forward `plugin add` to raw pnpm inside a profile
        // whose manifest declares `packages: [.]`, and pnpm then demands an
        // explicit -w (upstream candidate bug, first seen on alpha.1). The rc
        // lines run their own install flow and never print this. Retry with
        // the -w the error itself asks for — selected by the error's shape,
        // never by version sniffing.
        const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}\n${error?.message ?? ''}`
        const at = args.indexOf('add')
        if (at !== -1 && !args.includes('-w') && output.includes('ERR_PNPM_ADDING_TO_ROOT')) {
          return spawnDsh([...args.slice(0, at + 1), '-w', ...args.slice(at + 1)])
        }
        throw error
      }
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
    const files = (await filesBelow(join(home, 'sessions'))).filter(path => isSessionLog(path)).sort()
    assert.equal(files.length, expect, `expected ${expect} session log(s), found ${files.length}:\n  ${files.join('\n  ')}`)
    const all = []
    for (const file of files) {
      all.push(...(await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)))
    }
    return all
  }

  return { makeHome, useJsonlSessions, useDefaultModel, sessionRecords }
}

/** Seed an existing Codex login into a throwaway DSH home without copying any
 * unrelated Codex settings. The temporary home is removed by its scenario. */
export async function seedCodexLogin(home, authFile) {
  const source = JSON.parse(await readFile(resolve(authFile), 'utf8'))
  const tokens = source.tokens
  assert(tokens && typeof tokens === 'object', 'Codex auth file has no tokens object')
  assert.equal(typeof tokens.access_token, 'string', 'Codex auth file has no access_token')
  assert.equal(typeof tokens.refresh_token, 'string', 'Codex auth file has no refresh_token')
  assert.equal(typeof tokens.account_id, 'string', 'Codex auth file has no account_id')
  const encoded = tokens.access_token.split('.')[1]
  assert(encoded, 'Codex access token is not a JWT')
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  assert.equal(typeof payload.exp, 'number', 'Codex access token has no numeric exp claim')
  const directory = join(home, 'pi2dsh', 'agent')
  const target = join(directory, 'auth.json')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(target, `${JSON.stringify({
    'openai-codex': {
      type: 'oauth',
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: payload.exp * 1000,
      accountId: tokens.account_id,
    },
  })}\n`, { mode: 0o600 })
  await chmod(target, 0o600)
}


/**
 * The url a BROWSER should open for this server. The 0.1.2 line prints a
 * one-time launch token into the server log and answers uncookied index
 * reads with 401; opening the printed `?token=` url once exchanges it for
 * the session cookie. rc lines print no token and the url passes through.
 * @param url - the bare origin url.
 * @param webLog - captured server stdout+stderr so far.
 * @returns the url for the capture's page.goto().
 */
export async function authedUrl(url, webLog) {
  // A string snapshot races the server: the 401 gate answers readiness
  // probes BEFORE the token line reaches the log, and a capture launched in
  // that gap opens the bare origin and stalls on the auth wall ("New
  // session" never appears — dsh-x, 2026-08-31). Callers pass a getter over
  // their growing log; when the server is actually gated the token MUST
  // appear, so its absence is a loud failure, never a silent tokenless url.
  const read = typeof webLog === 'function' ? webLog : () => webLog
  const gated = await fetch(url).then(response => response.status === 401).catch(() => false)
  // 90s, not less: under a parallel full run the token line can trail the
  // 401 gate by well over 30s (mcp-at-scale-web false-failed at 30s on
  // 2026-08-31 while passing solo).
  const deadline = Date.now() + (gated ? 90_000 : 0)
  for (;;) {
    const token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(read())
    if (token !== null) return `${url}/?token=${token[1]}`
    if (Date.now() > deadline) {
      if (gated) throw new Error('dsh web answers 401 (launch-token gate) but printed no ?token= url in its log')
      return url
    }
    await new Promise(done => setTimeout(done, 500))
  }
}
