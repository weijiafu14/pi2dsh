import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzePackage } from '../src/analyzer.js'
import { resolvePiPackage } from '../src/source.js'

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url))
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Pi package discovery and compatibility analysis', () => {
  it('treats an existing bare relative path as a local package', async () => {
    const pkg = await resolvePiPackage('complete-package', fixtures)
    try {
      expect(pkg.identity).toMatchObject({
        name: '@pi2dsh-fixtures/complete',
        source: 'complete-package',
      })
      expect(pkg.temporary).toBe(false)
    } finally {
      await pkg.dispose()
    }
  })

  it('discovers explicit manifest resources and reports every detected API use', async () => {
    const pkg = await resolvePiPackage(join(fixtures, 'complete-package'))
    try {
      expect(pkg.identity).toMatchObject({ name: '@pi2dsh-fixtures/complete', version: '1.2.3' })
      expect(pkg.resources.extensions).toHaveLength(1)
      expect(pkg.resources.skills.some(path => path.endsWith('SKILL.md'))).toBe(true)
      expect(pkg.resources.prompts.some(path => path.endsWith('pi-review.md'))).toBe(true)

      const report = await analyzePackage(pkg)
      expect(report.verdict).toBe('review')
      expect(report.summary.unsupported).toBe(0)
      expect(report.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: 'registerTool', level: 'partial' }),
        expect.objectContaining({ capability: 'registerCommand', level: 'partial' }),
        expect.objectContaining({ capability: 'events.on', level: 'full' }),
        expect.objectContaining({ capability: 'events.emit', level: 'full' }),
        expect.objectContaining({ capability: 'registerFlag', level: 'partial' }),
        expect.objectContaining({ capability: 'getFlag', level: 'partial' }),
        expect.objectContaining({ capability: 'on(tool_call)', level: 'partial' }),
        expect.objectContaining({ capability: 'on(before_agent_start)', level: 'partial' }),
        expect.objectContaining({ capability: 'on(session_start)', level: 'full' }),
      ]))
    } finally {
      await pkg.dispose()
    }
  })

  it('blocks terminal UI APIs and unknown dynamically named events', async () => {
    const pkg = await resolvePiPackage(join(fixtures, 'unsupported-package'))
    try {
      const report = await analyzePackage(pkg)
      expect(report.verdict).toBe('blocked')
      expect(report.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: 'registerShortcut', level: 'partial' }),
        expect.objectContaining({ capability: 'on(<dynamic>)', level: 'unsupported' }),
      ]))
    } finally {
      await pkg.dispose()
    }
  })

  it('supports a single local extension file without package.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-single-'))
    cleanup.push(root)
    const file = join(root, 'one.ts')
    await writeFile(file, 'export default pi => pi.registerCommand("one", { description: "one", handler() {} })\n')
    const pkg = await resolvePiPackage(file)
    expect(pkg.identity.name).toBe('one')
    expect(pkg.resources.extensions).toEqual([file])
    expect((await analyzePackage(pkg)).summary.partial).toBe(1)
  })

  it('audits aliases and unknown Pi methods without mistaking unrelated object calls for ExtensionAPI use', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-analysis-'))
    cleanup.push(root)
    const file = join(root, 'aliases.ts')
    await writeFile(file, [
      'export default (pi) => {',
      '  const api = pi',
      '  const { registerTool: tool } = api',
      '  const bus = pi.events',
      '  tool({ name: "x", description: "x", parameters: { type: "object" }, execute() {} })',
      '  bus.emit("ready", true)',
      '  const emitter = { on() {} }',
      '  emitter.on("not-a-pi-event", () => {})',
      '  pi.futureApi()',
      '  const method = "sendMessage"',
      '  pi[method]()',
      '}',
    ].join('\n'))
    const pkg = await resolvePiPackage(file)
    const report = await analyzePackage(pkg)
    expect(report.verdict).toBe('blocked')
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'registerTool', level: 'partial' }),
      expect.objectContaining({ capability: 'events.emit', level: 'full' }),
      expect.objectContaining({ capability: 'futureApi', level: 'unsupported' }),
      expect.objectContaining({ capability: '<dynamic-api-method>', level: 'unsupported' }),
    ]))
    expect(report.findings.some(finding => finding.capability.includes('not-a-pi-event'))).toBe(false)
  })

  it('audits ExtensionAPI retained on class instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-class-api-'))
    cleanup.push(root)
    const file = join(root, 'index.ts')
    await writeFile(file, [
      'class Bridge {',
      '  constructor(private readonly pi) {}',
      '  install() {',
      '    this.pi.registerTool({ name: "x", description: "x", parameters: { type: "object" }, execute() {} })',
      '    this.pi.setActiveTools(["x"])',
      '  }',
      '}',
      'export default pi => new Bridge(pi).install()',
    ].join('\n'))
    const report = await analyzePackage(await resolvePiPackage(file))
    expect(report.verdict).toBe('review')
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'registerTool', level: 'partial' }),
      expect.objectContaining({ capability: 'setActiveTools', level: 'partial' }),
    ]))
  })

  it('audits the complete local module closure including NodeNext .js-to-.ts re-exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-closure-'))
    cleanup.push(root)
    await mkdir(join(root, 'extensions'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'closure', pi: { extensions: ['extensions/index.ts'] } }))
    await writeFile(join(root, 'extensions/index.ts'), 'export { default } from "./goal.js"\n')
    await writeFile(join(root, 'extensions/goal.ts'), [
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"',
      'import { setup } from "./helper.js"',
      'export default function goal(pi: ExtensionAPI) { setup(pi) }',
    ].join('\n'))
    await writeFile(join(root, 'extensions/helper.ts'), [
      'export function setup(pi) { pi.registerCommand("goal", { description: "goal", handler() {} }) }',
    ].join('\n'))
    const pkg = await resolvePiPackage(root)
    const report = await analyzePackage(pkg)
    expect(report.verdict).toBe('review')
    expect(report.findings).toContainEqual(expect.objectContaining({ capability: 'registerCommand', file: 'extensions/helper.ts' }))
    expect(report.findings.some(finding => finding.capability === 'static-audit')).toBe(false)
  })

  it('audits runtime Pi host imports while ignoring type-only imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-host-imports-'))
    cleanup.push(root)
    const file = join(root, 'index.ts')
    await writeFile(file, [
      'import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent"',
      'import { defineTool, getAgentDir, MissingHostExport } from "@earendil-works/pi-coding-agent"',
      'import { Text } from "@earendil-works/pi-tui"',
      'import { StringEnum } from "@earendil-works/pi-ai"',
      'import runtimeValue from "missing-runtime"',
      'export default function extension(pi: ExtensionAPI) {',
      '  void getAgentDir(); void MissingHostExport; void new Text("x"); void StringEnum(["a"]); void runtimeValue;',
      '  pi.registerTool(defineTool({ name: "x", description: "x", parameters: { type: "object" }, execute() {} }))',
      '}',
    ].join('\n'))
    const report = await analyzePackage(await resolvePiPackage(file))
    expect(report.verdict).toBe('blocked')
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'host-import(@earendil-works/pi-coding-agent:defineTool)', level: 'full' }),
      expect.objectContaining({ capability: 'host-import(@earendil-works/pi-coding-agent:getAgentDir)', level: 'partial' }),
      expect.objectContaining({ capability: 'host-import(@earendil-works/pi-tui:Text)', level: 'partial' }),
      expect.objectContaining({ capability: 'host-import(@earendil-works/pi-ai:StringEnum)', level: 'full' }),
      expect.objectContaining({ capability: 'host-import(@earendil-works/pi-coding-agent:MissingHostExport)', level: 'unsupported' }),
      expect.objectContaining({ capability: 'undeclared-runtime-dependency(missing-runtime)', level: 'unsupported' }),
    ]))
    expect(report.findings.some(finding => finding.capability.includes(':ExtensionAPI)'))).toBe(false)
    expect(report.findings.some(finding => finding.capability.includes(':Theme)'))).toBe(false)
  })

  it('audits tool and command context properties including guarded headless UI fallbacks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-context-'))
    cleanup.push(root)
    const file = join(root, 'index.ts')
    await writeFile(file, [
      'export default pi => {',
      '  pi.registerTool({',
      '    name: "x", description: "x", parameters: { type: "object" },',
      '    async execute(_id, _params, signal, _update, ctx) {',
      '      if (!ctx.hasUI) return { content: [{ type: "text", text: ctx.cwd }] }',
      '      await ctx.ui.input("value")',
      '      ctx.ui.setStatus("x", "ready")',
      '      return { content: [] }',
      '    }',
      '  })',
      '  pi.registerCommand("stop", { description: "stop", handler(ctx) { ctx.shutdown() } })',
      '}',
    ].join('\n'))
    const report = await analyzePackage(await resolvePiPackage(file))
    expect(report.verdict).toBe('blocked')
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'ctx.hasUI', level: 'full' }),
      expect.objectContaining({ capability: 'ctx.cwd', level: 'full' }),
      expect.objectContaining({ capability: 'ctx.ui.input', level: 'full' }),
      expect.objectContaining({ capability: 'ctx.ui.setStatus', level: 'partial' }),
      expect.objectContaining({ capability: 'ctx.shutdown', level: 'unsupported' }),
    ]))
  })

  it('fails closed when an extension module closure cannot be proven', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-incomplete-'))
    cleanup.push(root)
    const file = join(root, 'index.ts')
    await writeFile(file, 'export { default } from "./missing.js"\n')
    const pkg = await resolvePiPackage(file)
    const report = await analyzePackage(pkg)
    expect(report.verdict).toBe('blocked')
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'static-audit', level: 'unsupported' }),
      expect.objectContaining({ capability: 'module(./missing.js)', level: 'unsupported' }),
    ]))
  })

  it('blocks Pi terminal themes instead of silently dropping them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-theme-'))
    cleanup.push(root)
    await mkdir(join(root, 'themes'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'theme-only', pi: { themes: ['themes'] } }))
    await writeFile(join(root, 'themes/dark.json'), '{}')
    const pkg = await resolvePiPackage(root)
    const report = await analyzePackage(pkg)
    expect(report.verdict).toBe('blocked')
    expect(report.findings).toContainEqual(expect.objectContaining({ capability: 'theme', level: 'unsupported' }))
  })

  it('rejects resource globs escaping the package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi2dsh-escape-'))
    cleanup.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'escape', pi: { extensions: ['../outside.ts'] } }))
    await expect(resolvePiPackage(root)).rejects.toThrow('must stay inside the Pi package')
  })
})
