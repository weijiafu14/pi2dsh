import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

    const installed = await runDsh(home, ['plugin', '--profile', 'headless', 'add', `file:${bundle}`])
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
