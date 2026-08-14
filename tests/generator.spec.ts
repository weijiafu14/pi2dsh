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
      // typebox is host-provided (Pi's loader whitelist) and aliased by the
      // runtime, so the generated bundle no longer declares it.
      expect(packageJson.dependencies.typebox).toBeUndefined()
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

  it('generates degraded-but-load-safe bundles and hard-refuses fatal findings', async () => {
    const pkg = await resolvePiPackage(join(fixtures, 'unsupported-package'))
    try {
      // Unsupported findings are explicit, load-safe degradations: the bundle
      // generates and installs; the black-box run decides real usability.
      const result = await generateBundle(pkg, { outDir: await outputDir('degraded') })
      expect(result.report.verdict).toBe('review')
      const generatedPackage = JSON.parse(await readFile(join(result.outDir, 'package.json'), 'utf8'))
      expect(generatedPackage.dependencies.pi2dsh).toBeUndefined()
      expect(generatedPackage.dependencies.jiti).toBe('^2.7.0')
      expect(generatedPackage.peerDependencies).toMatchObject({
        '@deepseek-ai/dsh-llm': '^0.1.0-rc.6',
        '@deepseek-ai/dsh-system-prompt': '^0.1.0-rc.6',
      })
      expect(await readFile(join(result.outDir, 'runtime/pi2dsh-runtime.mjs'), 'utf8')).toContain('applyPiPackage')
      expect(await readFile(join(result.outDir, 'PI2DSH-LICENSE'), 'utf8')).toContain('MIT License')
      expect(JSON.parse(await readFile(join(result.outDir, 'pi2dsh.report.json'), 'utf8'))).toMatchObject({
        verdict: 'review',
      })
    } finally {
      await pkg.dispose()
    }

    // Fatal findings (here: an undeclared runtime dependency) have no flag
    // escape — the bundle cannot be built or trusted.
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-fatal-'))
    cleanup.push(root)
    await writeFile(join(root, 'index.ts'), [
      'import missing from "missing-runtime"',
      'export default pi => { void missing; pi.registerCommand("x", { description: "x", handler() {} }) }',
    ].join('\n'))
    const fatalPkg = await resolvePiPackage(join(root, 'index.ts'))
    try {
      await expect(generateBundle(fatalPkg, { outDir: await outputDir('fatal') })).rejects.toThrow('conversion blocked')
    } finally {
      await fatalPkg.dispose()
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
