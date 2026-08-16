import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinModules } from 'node:module'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { generateBundle } from '../src/generator.js'
import { resolvePiPackage } from '../src/source.js'

const execFile = promisify(execFileCallback)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const fixtureRoot = join(projectRoot, 'fixtures/complete-package')
const dshRoot = process.env.PI2DSH_DSH_ROOT === undefined
  ? join(projectRoot, '..', 'deepseek-harness')
  : process.env.PI2DSH_DSH_ROOT
const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function runDsh(home: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const shimDir = join(home, '..', 'bin')
  const shim = join(shimDir, 'pnpm')
  await mkdir(shimDir, { recursive: true })
  await writeFile(shim, '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
  await chmod(shim, 0o755)
  return execFile('node', ['--import', 'tsx/esm', dshBin, ...args], {
    cwd: dshRoot,
    env: {
      ...process.env,
      DSH_HOME: home,
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
      CI: '1',
      NO_COLOR: '1',
    },
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  })
}

describe('the embedded runtime declares every package it imports', () => {
  it('derives the bundle dependencies from the emitted modules, not a hand-kept list', async () => {
    // The list used to be written out by hand beside the bundler output, and
    // it drifted the moment a dependency was added to pi2dsh without being
    // copied there — five were missing, so a converted bundle installed
    // cleanly and then failed to start with ERR_MODULE_NOT_FOUND in every
    // clean profile. Reading the imports back off the emitted modules is what
    // makes that impossible; this test is the guard on that property.
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-bundle-deps-'))
    cleanup.push(scratch)
    const source = join(scratch, 'pkg')
    const bundle = join(scratch, 'bundle')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: '@pi2dsh-fixtures/deps', version: '0.0.0', type: 'module', pi: { extensions: ['e.js'] },
    }))
    await writeFile(join(source, 'e.js'), 'export default function (pi) {}\n')
    const pkg = await resolvePiPackage(source)
    try {
      await generateBundle(pkg, { outDir: bundle })
    } finally {
      await pkg.dispose()
    }

    const generated = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const declared = new Set([
      ...Object.keys(generated.dependencies ?? {}),
      ...Object.keys(generated.peerDependencies ?? {}),
    ])

    // Every bare import in the emitted runtime must be declared or supplied by
    // the host (a @deepseek-ai/* package comes from the profile's bundles).
    const imported = new Set<string>()
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { await walk(path); continue }
        if (!entry.name.endsWith('.mjs')) continue
        const text = await readFile(path, 'utf8')
        for (const match of text.matchAll(/(?:^|[^.\w$])(?:from|import)\s*\(?\s*["']([^"'\n]+)["']/g)) {
          const specifier = match[1] ?? ''
          if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue
          if (builtinModules.includes(specifier)) continue
          if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/[^\s"']*)?$/.test(specifier)) continue
          const parts = specifier.split('/')
          imported.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!)
        }
      }
    }
    await walk(join(bundle, 'runtime'))

    const undeclared = [...imported]
      .filter(name => !declared.has(name))
      .filter(name => !name.startsWith('@deepseek-ai/'))
      .filter(name => !name.startsWith('@earendil-works/') && !name.startsWith('@mariozechner/'))
    expect(undeclared).toEqual([])
    // The specific one that broke every bundle, named so a regression is legible.
    expect(declared.has('proper-lockfile')).toBe(true)
  })
})

describe('generated bundle through the official DSH plugin manager', () => {
  it('installs, activates, resolves its runtime, dumps into the profile tree, and removes cleanly', async () => {
    await stat(dshBin)
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-generated-bundle-'))
    cleanup.push(scratch)
    const home = join(scratch, 'dsh-home')
    const bundle = join(scratch, 'bundle')
    const pkg = await resolvePiPackage(fixtureRoot)
    let packageName = ''
    try {
      packageName = (await generateBundle(pkg, { outDir: bundle })).packageName
    } finally {
      await pkg.dispose()
    }

    // First add can stop at pnpm's build-script gate (the bundle carries the
    // real pi-ai, whose deps declare install scripts). Mirror the documented
    // user flow: approve the listed builds in the profile's workspace file,
    // then re-run the add.
    const installed = await runDsh(home, ['plugin', '--profile', 'headless', 'add', `file:${bundle}`])
      .catch(async (error: { stdout?: string; stderr?: string }) => {
        if (!`${String(error.stdout ?? '')}${String(error.stderr ?? '')}`.includes('ERR_PNPM_IGNORED_BUILDS')) throw error
        const workspaceFile = join(home, 'profiles/headless/pnpm-workspace.yaml')
        const workspace = await readFile(workspaceFile, 'utf8')
        await writeFile(workspaceFile, workspace.replace(/set this to true or false/g, 'true'))
        return runDsh(home, ['plugin', '--profile', 'headless', 'add', `file:${bundle}`])
      })
    expect(installed.stderr).not.toContain('ERR_')

    const profileRoot = join(home, 'profiles/headless')
    const profileManifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(profileManifest.dependencies?.[packageName]).toBeDefined()
    expect(profileManifest.dsh?.profile?.bundles).toContain(packageName)
    const installedBundle = join(profileRoot, 'node_modules', packageName)
    expect(await readFile(join(installedBundle, 'index.js'), 'utf8')).toContain('./runtime/pi2dsh-runtime.mjs')
    await stat(join(installedBundle, 'runtime/pi2dsh-runtime.mjs'))
    await stat(join(installedBundle, 'runtime/compat/pi-coding-agent.mjs'))
    const installedManifest = JSON.parse(await readFile(join(installedBundle, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(installedManifest.dependencies?.pi2dsh).toBeUndefined()
    expect(installedManifest.dependencies?.jiti).toBe('^2.7.0')

    const dumped = await runDsh(home, ['--profile', 'headless', '--dump-config'])
    expect(dumped.stdout).toContain(`# == ${packageName}`)
    expect(dumped.stdout).toContain('id: pi2dsh-pi2dsh-fixtures-complete')
    expect(dumped.stdout).toContain(`name: ${packageName}`)

    await runDsh(home, ['plugin', '--profile', 'headless', 'remove', packageName])
    const removedManifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(removedManifest.dependencies?.[packageName]).toBeUndefined()
    expect(removedManifest.dsh?.profile?.bundles ?? []).not.toContain(packageName)
  }, 150_000)
})
