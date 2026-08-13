#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const artifactRoot = join(projectRoot, '.artifacts')
const installRoot = await mkdtemp(join(tmpdir(), 'pi2dsh-packed-install-'))

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })

try {
  const packed = await execFile('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', artifactRoot], {
    cwd: projectRoot,
    env: { ...process.env, npm_config_registry: 'https://registry.npmjs.org' },
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const jsonStart = packed.stdout.lastIndexOf('\n[')
  const metadata = JSON.parse(jsonStart === -1 ? packed.stdout : packed.stdout.slice(jsonStart + 1))[0]
  assert.equal(metadata.name, 'pi2dsh')
  const files = new Set(metadata.files.map(file => file.path))
  for (const required of ['README.md', 'LICENSE', 'dist/cli.mjs', 'dist/index.mjs', 'dist/runtime.mjs']) {
    assert(files.has(required), `packed artifact is missing ${required}`)
  }
  assert(![...files].some(path => path.startsWith('community/') || path.startsWith('fixtures/')))

  const tarball = join(artifactRoot, metadata.filename)
  await access(tarball)
  await writeFile(join(installRoot, 'package.json'), '{"name":"pi2dsh-pack-smoke","private":true,"type":"module"}\n')
  await execFile('npm', [
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--registry=https://registry.npmjs.org',
    tarball,
  ], { cwd: installRoot, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })

  const cli = await execFile(join(installRoot, 'node_modules/.bin/pi2dsh'), ['matrix', '--json'], {
    cwd: installRoot,
    timeout: 30_000,
  })
  const matrix = JSON.parse(cli.stdout)
  assert.equal(matrix.api.registerTool.level, 'partial')
  assert.equal(matrix.events.session_start.level, 'full')

  const installedPackage = JSON.parse(await readFile(join(installRoot, 'node_modules/pi2dsh/package.json'), 'utf8'))
  assert.equal(installedPackage.version, metadata.version)
  console.log(JSON.stringify({ tarball, files: files.size, installedVersion: installedPackage.version }))
} finally {
  await rm(installRoot, { recursive: true, force: true })
}
