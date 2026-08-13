import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { generateBundle } from '../src/generator.js'
import { resolvePiPackage } from '../src/source.js'

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url))
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function outputDir(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pi2dsh-${name}-`))
  cleanup.push(root)
  return join(root, 'bundle')
}

describe('DSH bundle generator', () => {
  it('generates an installable manifest, plugin, skills, prompts, and source snapshot', async () => {
    const pkg = await resolvePiPackage(join(fixtures, 'complete-package'))
    const outDir = await outputDir('complete')
    try {
      const result = await generateBundle(pkg, { outDir, runtimeSpec: 'file:/runtime' })
      expect(result.packageName).toBe('dsh-pi-pi2dsh-fixtures-complete')
      const packageJson = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8')) as Record<string, any>
      expect(packageJson.dsh.bundle.patch).toBe('./cordis.patch.yml')
      expect(packageJson.dependencies.pi2dsh).toBe('file:/runtime')
      expect(packageJson.dependencies.typebox).toBe('1.3.7')
      expect(packageJson.dependencies['@earendil-works/pi-coding-agent']).toBeUndefined()
      expect(packageJson.dependencies['@deepseek-ai/dsh-skill-filesystem']).toBe('^0.1.0-rc.6')

      const plugin = await readFile(join(outDir, 'index.js'), 'utf8')
      expect(plugin).toContain('"commands"')
      expect(plugin).toContain('"skills"')
      expect(await readFile(join(outDir, 'skills/fixture-skill/SKILL.md'), 'utf8')).toContain('PI2DSH_SKILL_OK')
      expect(await readFile(join(outDir, 'prompts/pi-review.md'), 'utf8')).toContain('Review $1 carefully')
      expect(await readFile(join(outDir, 'vendor/extensions/index.ts'), 'utf8')).toContain("name: 'pi_greet'")
    } finally {
      await pkg.dispose()
    }
  })

  it('refuses unsupported packages unless explicit degraded generation is requested', async () => {
    const pkg = await resolvePiPackage(join(fixtures, 'unsupported-package'))
    try {
      await expect(generateBundle(pkg, { outDir: await outputDir('blocked') })).rejects.toThrow('conversion blocked')
      const result = await generateBundle(pkg, {
        outDir: await outputDir('allowed'),
        allowUnsupported: true,
      })
      expect(result.report.verdict).toBe('blocked')
      expect(JSON.parse(await readFile(join(result.outDir, 'package.json'), 'utf8')).dependencies.pi2dsh)
        .toBe('https://github.com/weijiafu14/pi2dsh/releases/download/v0.1.1/pi2dsh-0.1.1.tgz')
      expect(JSON.parse(await readFile(join(result.outDir, 'pi2dsh.report.json'), 'utf8'))).toMatchObject({
        verdict: 'blocked',
      })
    } finally {
      await pkg.dispose()
    }
  })

  it('makes strict conversion fail on partial mappings', async () => {
    const pkg = await resolvePiPackage(join(fixtures, 'complete-package'))
    try {
      await expect(generateBundle(pkg, { outDir: await outputDir('strict'), strict: true }))
        .rejects.toThrow('strict conversion requires')
    } finally {
      await pkg.dispose()
    }
  })

  it('snapshots local JSON loaded through createRequire aliases', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'pi2dsh-create-require-'))
    cleanup.push(sourceRoot)
    await mkdir(join(sourceRoot, 'extensions'))
    await writeFile(join(sourceRoot, 'package.json'), JSON.stringify({
      name: 'create-require-fixture',
      version: '1.0.0',
      pi: { extensions: ['extensions/index.ts'] },
    }))
    await writeFile(join(sourceRoot, 'extensions/meta.json'), JSON.stringify({ marker: 'PI2DSH_META_OK' }))
    await writeFile(join(sourceRoot, 'extensions/index.ts'), [
      'import { createRequire as makeRequire } from "node:module"',
      'const localRequire = makeRequire(import.meta.url)',
      'const meta = localRequire("./meta.json")',
      'export default pi => pi.registerTool({ name: "meta", description: meta.marker, parameters: { type: "object" }, execute() {} })',
    ].join('\n'))
    const pkg = await resolvePiPackage(sourceRoot)
    const outDir = await outputDir('create-require')
    await generateBundle(pkg, { outDir })
    expect(await readFile(join(outDir, 'vendor/extensions/meta.json'), 'utf8')).toContain('PI2DSH_META_OK')
  })
})
