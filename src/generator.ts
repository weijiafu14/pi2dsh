import { cp, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { analyzePackage } from './analyzer.js'
import { collectLocalClosure, runtimeExternalPackages, SCRIPT_EXTENSIONS } from './module-graph.js'
import type {
  CompatibilityReport,
  GenerateOptions,
  GeneratedRuntimeManifest,
  ResolvedPiPackage,
} from './types.js'

interface PromptMetadata {
  name: string
  description: string
  argumentHint?: string
  path: string
}

const SHIMMED_PI_HOST_PACKAGES = new Set([
  '@earendil-works/pi-coding-agent',
  '@mariozechner/pi-coding-agent',
  '@earendil-works/pi-tui',
  '@mariozechner/pi-tui',
  '@earendil-works/pi-ai',
  '@mariozechner/pi-ai',
  // Host-provided in Pi's loader whitelist; the runtime aliases them too.
  'typebox',
  '@sinclair/typebox',
])

function packageSlug(name: string): string {
  const slug = name.replace(/^@/u, '').replaceAll('/', '-').replace(/[^a-zA-Z0-9._-]+/gu, '-').toLowerCase()
  return slug.replace(/^-+|-+$/gu, '') || 'package'
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

async function assertEmptyOrMissing(path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) throw new Error(`output exists and is not a directory: ${path}`)
    const entries = await readdir(path)
    if (entries.length > 0) throw new Error(`output directory is not empty: ${path}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function parseFrontmatter(text: string): { attributes: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n?/gu, '\n')
  if (!normalized.startsWith('---')) return { attributes: {}, body: normalized }
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return { attributes: {}, body: normalized }
  const raw: unknown = parseYaml(normalized.slice(4, endIndex))
  const attributes = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? stringRecord(raw)
    : {}
  return { attributes, body: normalized.slice(endIndex + 4).trim() }
}

async function assertNoSymlinks(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link from Pi package: ${path}`)
  if (!info.isDirectory()) return
  for (const entry of await readdir(path)) await assertNoSymlinks(join(path, entry))
}

async function copyExtensions(pkg: ResolvedPiPackage, outDir: string): Promise<{ entries: string[]; runtimePackages: Set<string>; skillScriptPackages: Set<string> }> {
  const copied: string[] = []
  const runtimePackages = new Set<string>()
  const closure = await collectLocalClosure(pkg.rootDir, pkg.resources.extensions)
  // Unresolved references never block the snapshot here: the analyzer grades
  // them (fatal only on the load-time path) and enforceReport is the gate.
  // The copy below preserves the published layout, so lazy dead references
  // behave exactly as they would under Pi.
  for (const issue of closure.issues) {
    console.warn(`pi2dsh: unresolved ${issue.kind} reference ${JSON.stringify(issue.specifier)} from ${relative(pkg.rootDir, issue.file)} (${issue.lazy ? 'lazy path — fails at feature use, as under Pi' : 'load-time path'})`)
  }
  for (const source of closure.files) {
    if (SCRIPT_EXTENSIONS.has(extname(source))) {
      const text = await readFile(source, 'utf8')
      // Lazy undeclared imports stay out of bundle dependencies: the package
      // works without them (Pi semantics) and they may not even be installable.
      // Lazy means the import site OR the whole file only evaluates on demand
      // (a top-level import inside a dynamically-imported module loads lazily).
      const lazyFile = !closure.loadTimeFiles.has(source)
      for (const use of runtimeExternalPackages(source, text)) {
        if ((!use.lazy && !lazyFile) || use.name in stringRecord(pkg.packageJson.dependencies)) runtimePackages.add(use.name)
      }
    }
    const sourceRelative = relative(pkg.rootDir, source).replaceAll('\\', '/')
    const targetRelative = `vendor/${sourceRelative}`
    const target = join(outDir, targetRelative)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { dereference: false })
    if (pkg.resources.extensions.map(entry => resolve(entry)).includes(source)) copied.push(targetRelative)
  }
  // Skill helper scripts run on the user's explicit request, not at extension
  // load; their imports (often themselves try/catch-guarded) are informational,
  // never a conversion blocker (mitsupi ships googleapis-using skill scripts
  // this way and works fine in Pi).
  const skillScriptPackages = new Set<string>()
  for (const source of pkg.resources.skills) {
    if (!SCRIPT_EXTENSIONS.has(extname(source))) continue
    const text = await readFile(source, 'utf8')
    for (const use of runtimeExternalPackages(source, text)) skillScriptPackages.add(use.name)
  }
  return { entries: copied, runtimePackages, skillScriptPackages }
}

async function copySkills(pkg: ResolvedPiPackage, outDir: string): Promise<string[]> {
  const entryFiles = pkg.resources.skills.filter(file => basename(file) === 'SKILL.md' || file.endsWith('.md'))
  if (entryFiles.length === 0) return []
  const names = new Set<string>()
  for (const entry of entryFiles) {
    const isBundle = basename(entry) === 'SKILL.md'
    let name = isBundle ? basename(dirname(entry)) : basename(entry, '.md')
    if (names.has(name)) {
      // Same-named skills under different parents (piolium ships several):
      // disambiguate with the parent directory instead of refusing the package.
      const parent = basename(dirname(isBundle ? dirname(entry) : entry))
      const candidate = `${parent}-${name}`.replace(/[^a-zA-Z0-9._-]+/gu, '-')
      name = names.has(candidate) ? `${candidate}-${names.size}` : candidate
    }
    names.add(name)
    const target = join(outDir, 'skills', isBundle ? name : `${name}.md`)
    await mkdir(dirname(target), { recursive: true })
    const source = isBundle ? dirname(entry) : entry
    await assertNoSymlinks(source)
    await cp(source, target, { recursive: isBundle, dereference: false })
  }
  return ['skills']
}

async function copyPrompts(pkg: ResolvedPiPackage, outDir: string): Promise<PromptMetadata[]> {
  const prompts: PromptMetadata[] = []
  const names = new Set<string>()
  for (const source of pkg.resources.prompts) {
    const name = basename(source, '.md').toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
    if (names.has(name)) throw new Error(`prompt command name collision while flattening Pi package: ${name}`)
    names.add(name)
    const targetRelative = `prompts/${name}.md`
    const target = join(outDir, targetRelative)
    await mkdir(dirname(target), { recursive: true })
    await assertNoSymlinks(source)
    await cp(source, target, { dereference: false })
    const { attributes, body } = parseFrontmatter(await readFile(source, 'utf8'))
    const firstLine = body.split(/\r?\n/u).map(line => line.trim()).find(Boolean)
    prompts.push({
      name,
      description: attributes.description ?? firstLine ?? `Run migrated Pi prompt ${name}`,
      ...(attributes['argument-hint'] !== undefined ? { argumentHint: attributes['argument-hint'] } : {}),
      path: targetRelative,
    })
  }
  return prompts
}

async function copyNotices(pkg: ResolvedPiPackage, outDir: string): Promise<string[]> {
  const copied: string[] = []
  for (const entry of await readdir(pkg.rootDir)) {
    if (!/^(?:licen[cs]e|notice|copying)(?:[._-].*)?$/iu.test(entry)) continue
    const source = join(pkg.rootDir, entry)
    const info = await lstat(source)
    if (info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link from Pi package: ${source}`)
    if (!info.isFile()) continue
    await cp(source, join(outDir, entry), { dereference: false })
    copied.push(entry)
  }
  return copied.sort()
}

function generatedPackageJson(
  pkg: ResolvedPiPackage,
  generatedName: string,
  runtimeSpec: string | undefined,
  runtimePackages: ReadonlySet<string>,
  hasSkills: boolean,
): Record<string, unknown> {
  const declaredDependencies = {
    ...stringRecord(pkg.packageJson.dependencies),
    ...stringRecord(pkg.packageJson.optionalDependencies),
    ...stringRecord(pkg.packageJson.peerDependencies),
  }
  const externalRuntimePackages = [...runtimePackages].filter(name => !SHIMMED_PI_HOST_PACKAGES.has(name))
  const missing = externalRuntimePackages.filter(name => declaredDependencies[name] === undefined)
  if (missing.length > 0) {
    throw new Error(`runtime dependencies are imported but not declared by the Pi package: ${missing.join(', ')}`)
  }
  // Carry EVERY declared runtime dependency, not only statically detected
  // imports: packages load their own deps dynamically (computed require,
  // optional native backends) and the original manifest is the authority on
  // what they need.
  const declaredRuntime = {
    ...stringRecord(pkg.packageJson.dependencies),
    ...stringRecord(pkg.packageJson.optionalDependencies),
  }
  const dependencies = {
    ...Object.fromEntries(Object.entries(declaredRuntime).filter(([name]) => !SHIMMED_PI_HOST_PACKAGES.has(name))),
    ...Object.fromEntries(externalRuntimePackages.sort().map(name => [name, declaredDependencies[name]])),
    // The embedded runtime's own runtime dependencies (vendored Pi width math
    // uses get-east-asian-width; the pi-tui shim re-exports marked; typebox is
    // the host-provided schema library Pi's loader gives every extension;
    // vendored Pi bash tooling spawns through cross-spawn exactly as Pi does).
    ...(runtimeSpec === undefined
      ? { jiti: '^2.7.0', 'get-east-asian-width': '^1.6.0', marked: '^16.4.1', typebox: '^1.0.4', 'cross-spawn': '^7.0.6', diff: '^9.0.0' }
      : {}),
    ...(hasSkills ? { '@deepseek-ai/dsh-skill-filesystem': '^0.1.0-rc.6' } : {}),
    ...(runtimeSpec !== undefined ? { pi2dsh: runtimeSpec } : {}),
  }
  // Re-point the package's Node subpath-imports map ("#x": "./src/x.js") at
  // the vendored snapshot so '#'-imports keep resolving inside the bundle.
  const remapImports = (value: unknown): unknown => {
    if (typeof value === 'string') return value.startsWith('./') ? `./vendor/${value.slice(2)}` : value
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remapImports(entry)]))
    }
    return value
  }
  const sourceImports = pkg.packageJson.imports
  return {
    name: generatedName,
    version: pkg.identity.version,
    description: `DeepSeek Harness adapter generated from ${pkg.identity.name}`,
    type: 'module',
    main: './index.js',
    ...(typeof sourceImports === 'object' && sourceImports !== null
      ? { imports: remapImports(sourceImports) as Record<string, unknown> }
      : {}),
    files: ['index.js', 'cordis.patch.yml', 'pi2dsh.manifest.json', 'pi2dsh.report.json', 'README.md', 'LICENSE*', 'NOTICE*', 'COPYING*', 'PI2DSH-LICENSE', 'runtime', 'vendor', 'skills', 'prompts'],
    dependencies,
    ...(runtimeSpec === undefined
      ? {
          peerDependencies: {
            '@deepseek-ai/dsh-llm': '^0.1.0-rc.6',
            '@deepseek-ai/dsh-system-prompt': '^0.1.0-rc.6',
          },
        }
      : {}),
    keywords: ['dsh-plugin', 'deepseek-harness', 'pi-package', 'pi2dsh'],
    license: typeof pkg.packageJson.license === 'string' ? pkg.packageJson.license : 'UNLICENSED',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
}

function generatedReadme(pkg: ResolvedPiPackage, packageName: string, report: CompatibilityReport): string {
  return `# ${packageName}\n\n`
    + `Generated by [pi2dsh](https://github.com/weijiafu14/pi2dsh) from \`${pkg.identity.name}@${pkg.identity.version}\`.\n\n`
    + `Compatibility verdict: **${report.verdict}** (full ${report.summary.full}, partial ${report.summary.partial}, unsupported ${report.summary.unsupported}).\n\n`
    + `Review \`pi2dsh.report.json\` before installation. This bundle executes the original Pi extension source and should only be installed when that source is trusted.\n\n`
    + `Install with DeepSeek Harness (keep the \`file:\` prefix so pnpm installs this bundle's dependencies instead of creating a bare link):\n\n`
    + `\`\`\`sh\ndsh plugin --profile headless add file:$PWD\ndsh --profile headless --dump-config\n\`\`\`\n`
}

function pluginSource(manifest: GeneratedRuntimeManifest, runtimeImport: string): string {
  const injections = ['tools', 'systemPrompt']
  if (manifest.prompts.length > 0 || manifest.report?.findings.some(item => item.capability === 'registerCommand') === true) {
    injections.push('commands')
  }
  if (manifest.skillDirs.length > 0) injections.push('skills')
  return `import { applyPiPackage } from ${JSON.stringify(runtimeImport)}\n\n`
    + `export const name = ${JSON.stringify(`pi2dsh:${packageSlug(manifest.package.name)}`)}\n`
    + `export const inject = ${JSON.stringify(injections)}\n\n`
    + `const manifest = ${JSON.stringify(manifest, null, 2)}\n\n`
    + `export async function apply(ctx, config = {}) {\n`
    + `  await applyPiPackage(ctx, { rootUrl: new URL('.', import.meta.url), manifest, config })\n`
    + `}\n`
}

async function firstExisting(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      await stat(path)
      return path
    } catch {
      // Try the next package/source layout.
    }
  }
  throw new Error(`cannot locate pi2dsh runtime artifact; tried: ${paths.join(', ')}`)
}

async function copyEmbeddedRuntime(outDir: string): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const runtimeSource = await firstExisting([
    join(moduleDir, 'runtime.mjs'),
    join(moduleDir, '../dist/runtime.mjs'),
  ])
  const runtimeRoot = dirname(runtimeSource)
  const targetRoot = join(outDir, 'runtime')
  await mkdir(targetRoot, { recursive: true })
  // Copy every emitted module, including bundler-named shared chunks — a
  // fixed file list silently breaks whenever the bundler re-splits chunks.
  for (const entry of await readdir(runtimeRoot)) {
    if (entry.endsWith('.mjs')) await cp(join(runtimeRoot, entry), join(targetRoot, entry))
  }
  for (const sub of ['compat', join('compat', 'vendor')]) {
    const sourceDir = join(runtimeRoot, sub)
    try {
      const entries = await readdir(sourceDir)
      await mkdir(join(targetRoot, sub), { recursive: true })
      for (const entry of entries) {
        if (entry.endsWith('.mjs')) await cp(join(sourceDir, entry), join(targetRoot, sub, entry))
      }
    } catch {
      // dist layout without that subdirectory
    }
  }
  await cp(join(targetRoot, 'runtime.mjs'), join(targetRoot, 'pi2dsh-runtime.mjs'))
  const license = await firstExisting([join(moduleDir, '../LICENSE'), join(moduleDir, '../../LICENSE')])
  await cp(license, join(outDir, 'PI2DSH-LICENSE'))
}

function patchSource(generatedName: string, slug: string): string {
  return `- insert:\n    - id: pi2dsh-${slug}\n      name: ${JSON.stringify(generatedName)}\n`
}

function enforceReport(report: CompatibilityReport, options: GenerateOptions): void {
  // Fatal findings (incomplete module closure, undeclared runtime deps,
  // resource escapes) mean the bundle cannot be built or trusted; no flag
  // bypasses them. Unsupported findings are explicit, load-safe degradations
  // — the bundle installs and the black-box run decides real usability.
  if (report.summary.fatal > 0) {
    throw new Error(
      `conversion blocked: ${report.summary.fatal} fatal finding(s) — the bundle cannot be built or trusted; run inspect for details`,
    )
  }
  if (options.strict && (report.summary.partial > 0 || report.summary.unsupported > 0)) {
    throw new Error('strict conversion requires every detected Pi API use to have full compatibility')
  }
}

export async function generateBundle(
  pkg: ResolvedPiPackage,
  options: GenerateOptions,
): Promise<{ outDir: string; report: CompatibilityReport; packageName: string }> {
  const outDir = resolve(options.outDir)
  const report = await analyzePackage(pkg)
  enforceReport(report, options)
  await assertEmptyOrMissing(outDir)
  await mkdir(outDir, { recursive: true })

  const slug = packageSlug(pkg.identity.name)
  const packageName = `dsh-pi-${slug}`
  const extensionSnapshot = await copyExtensions(pkg, outDir)
  const skillDirs = await copySkills(pkg, outDir)
  const prompts = await copyPrompts(pkg, outDir)
  await copyNotices(pkg, outDir)
  const manifest: GeneratedRuntimeManifest = {
    schemaVersion: 1,
    package: pkg.identity,
    extensions: extensionSnapshot.entries,
    skillDirs,
    prompts,
    report,
  }
  const runtimeSpec = options.runtimeSpec
  if (runtimeSpec === undefined) await copyEmbeddedRuntime(outDir)
  const optionalSkillDeps = [...extensionSnapshot.skillScriptPackages]
    .filter(name => !SHIMMED_PI_HOST_PACKAGES.has(name) && !(name in stringRecord(pkg.packageJson.dependencies)))
  if (optionalSkillDeps.length > 0) {
    console.warn(`pi2dsh: skill helper scripts reference ${optionalSkillDeps.join(', ')}; install them only if you use those skills`)
  }

  await Promise.all([
    writeFile(join(outDir, 'package.json'), `${JSON.stringify(generatedPackageJson(pkg, packageName, runtimeSpec, extensionSnapshot.runtimePackages, skillDirs.length > 0), null, 2)}\n`),
    writeFile(join(outDir, 'pi2dsh.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(outDir, 'pi2dsh.report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outDir, 'index.js'), pluginSource(manifest, runtimeSpec === undefined ? './runtime/pi2dsh-runtime.mjs' : 'pi2dsh/runtime')),
    writeFile(join(outDir, 'cordis.patch.yml'), patchSource(packageName, slug)),
    writeFile(join(outDir, 'README.md'), generatedReadme(pkg, packageName, report)),
  ])
  return { outDir, report, packageName }
}
