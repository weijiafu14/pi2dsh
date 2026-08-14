import { builtinModules } from 'node:module'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

export const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']

interface LocalReference {
  kind: 'module' | 'asset'
  specifier: string
  // A lazy reference is only evaluated when some feature runs, never while the
  // extension entry loads: dynamic import()/require() inside a function body,
  // or worker/data assets spawned on demand. Pi's loader therefore succeeds
  // even when a lazy target is unresolvable; problems on lazy paths surface
  // (identically under Pi and pi2dsh) only if that feature is used.
  lazy: boolean
}

export interface LocalClosureIssue {
  file: string
  kind: LocalReference['kind']
  specifier: string
  detail: string
  lazy: boolean
}

export interface LocalClosure {
  files: string[]
  // Files whose module-level code executes the moment the extension entry
  // loads (transitive non-lazy module edges from the entries).
  loadTimeFiles: Set<string>
  issues: LocalClosureIssue[]
}

export function sourceKind(path: string): ts.ScriptKind {
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

function literalModule(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
}

function isImportMetaUrl(node: ts.Expression | undefined): boolean {
  return node !== undefined && ts.isPropertyAccessExpression(node) && node.name.text === 'url'
    && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
}

function localReferences(path: string, text: string): LocalReference[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, sourceKind(path))
  const values = new Map<string, LocalReference>()
  const createRequireNames = new Set<string>(['createRequire'])
  const requireNames = new Set<string>(['require'])
  const add = (kind: LocalReference['kind'], specifier: string, lazy: boolean): void => {
    // '#'-prefixed specifiers are Node subpath imports resolved through the
    // package's own `imports` map — package-local, not external dependencies.
    if (!specifier.startsWith('.') && !specifier.startsWith('#')) return
    const key = `${kind}:${specifier}`
    const existing = values.get(key)
    // A specifier reached both statically and lazily executes at load time.
    if (existing === undefined) values.set(key, { kind, specifier, lazy })
    else if (existing.lazy && !lazy) existing.lazy = false
  }
  function collectRequireAliases(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && (node.moduleSpecifier.text === 'node:module' || node.moduleSpecifier.text === 'module')
      && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const element of node.importClause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'createRequire') createRequireNames.add(element.name.text)
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && createRequireNames.has(node.initializer.expression.text)) {
      requireNames.add(node.name.text)
    }
    ts.forEachChild(node, collectRequireAliases)
  }
  collectRequireAliases(source)
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      add('module', node.moduleSpecifier.text, false)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      add('module', node.moduleReference.expression.text, false)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0
      && ((node.expression.kind === ts.SyntaxKind.ImportKeyword)
        || (ts.isIdentifier(node.expression) && requireNames.has(node.expression.text)))) {
      const specifier = literalModule(node.arguments[0])
      if (specifier !== undefined) add('module', specifier, insideFunctionBody(node))
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL'
      && isImportMetaUrl(node.arguments?.[1])) {
      const specifier = literalModule(node.arguments?.[0])
      if (specifier !== undefined) add('asset', specifier, false)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...values.values()]
}

function externalPackage(specifier: string): string | undefined {
  // `bun:*` counts as a host builtin, not an npm dependency: Pi's official
  // distribution is a Bun-compiled binary, so ecosystem packages gate these
  // requires behind runtime detection and take their declared Node fallback
  // (better-sqlite3, node:sqlite) everywhere else.
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')
    || specifier.startsWith('node:') || specifier.startsWith('bun:')
    || builtinModules.includes(specifier)) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function insideTry(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isTryStatement(current)) return true
    // Stop at function boundaries: a try in an outer function does not guard
    // an import inside a nested callback executed later.
    if (ts.isFunctionLike(current)) {
      // ...unless the whole function body IS awaited inside the try; keeping
      // this conservative check simple errs toward reporting the dependency.
      return false
    }
    current = current.parent
  }
  return false
}

// Inside any function body means the expression does not run while the module
// itself loads — it runs when (if ever) that function is called.
function insideFunctionBody(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) return true
    current = current.parent
  }
  return false
}

export interface RuntimeDependencyUse {
  name: string
  // true when every use sits on a lazy path (dynamic import/require inside a
  // function body): the module loads fine without the dependency, exactly as
  // under Pi, and only the feature that calls it needs the install.
  lazy: boolean
}

export function runtimeExternalPackages(path: string, text: string): RuntimeDependencyUse[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, sourceKind(path))
  const packages = new Map<string, RuntimeDependencyUse>()
  const createRequireNames = new Set<string>(['createRequire'])
  const requireNames = new Set<string>(['require'])
  const add = (specifier: string, lazy: boolean): void => {
    const name = externalPackage(specifier)
    if (name === undefined || name.length === 0) return
    const existing = packages.get(name)
    if (existing === undefined) packages.set(name, { name, lazy })
    else if (existing.lazy && !lazy) existing.lazy = false
  }
  function collectRequireAliases(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && (node.moduleSpecifier.text === 'node:module' || node.moduleSpecifier.text === 'module')
      && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const element of node.importClause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'createRequire') createRequireNames.add(element.name.text)
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && createRequireNames.has(node.initializer.expression.text)) {
      requireNames.add(node.name.text)
    }
    ts.forEachChild(node, collectRequireAliases)
  }
  collectRequireAliases(source)
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings
      const namedImportsAreTypeOnly = named !== undefined && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly)
      if (clause === undefined || (!clause.isTypeOnly && (clause.name !== undefined || !namedImportsAreTypeOnly))) {
        add(node.moduleSpecifier.text, false)
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, false)
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node.moduleReference.expression.text, false)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0
      && ((node.expression.kind === ts.SyntaxKind.ImportKeyword)
        || (ts.isIdentifier(node.expression) && requireNames.has(node.expression.text)))) {
      // A dynamic import/require wrapped in try/catch is the ecosystem's
      // optional-dependency idiom (e.g. pi-harness-runtime's "// Dynamic
      // import for Playwright (optional dependency)") — its absence is a
      // designed degradation, not an undeclared runtime requirement.
      if (!insideTry(node)) {
        const specifier = literalModule(node.arguments[0])
        if (specifier !== undefined) add(specifier, insideFunctionBody(node))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...packages.values()]
}

function inside(rootDir: string, path: string): boolean {
  const pathRelative = relative(rootDir, path)
  return pathRelative === '' || (pathRelative !== '..' && !pathRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

function sourceAlternates(base: string): string[] {
  const extension = extname(base)
  const stem = extension.length > 0 ? base.slice(0, -extension.length) : base
  if (extension === '.js') return [`${stem}.ts`, `${stem}.tsx`]
  if (extension === '.mjs') return [`${stem}.mts`, `${stem}.ts`]
  if (extension === '.cjs') return [`${stem}.cts`, `${stem}.ts`]
  if (extension === '.jsx') return [`${stem}.tsx`, `${stem}.ts`]
  return []
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function subpathImportTarget(rootDir: string, specifier: string, importsMap: Record<string, unknown>): string | undefined {
  const conditionValue = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    for (const condition of ['import', 'node', 'default']) {
      const candidate = conditionValue(record[condition])
      if (candidate !== undefined) return candidate
    }
    return undefined
  }
  const direct = conditionValue(importsMap[specifier])
  if (direct !== undefined) return resolve(rootDir, direct)
  for (const [pattern, value] of Object.entries(importsMap)) {
    const star = pattern.indexOf('*')
    if (star === -1) continue
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
    const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
    const target = conditionValue(value)
    if (target !== undefined) return resolve(rootDir, target.replace('*', wildcard))
  }
  return undefined
}

async function packageImportsMap(rootDir: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')) as { imports?: unknown }
    return typeof parsed.imports === 'object' && parsed.imports !== null ? parsed.imports as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function resolveModule(fromFile: string, specifier: string, rootDir: string, importsMap: Record<string, unknown>): Promise<string> {
  if (specifier.startsWith('#')) {
    const target = subpathImportTarget(rootDir, specifier, importsMap)
    if (target === undefined) {
      throw new Error(`cannot resolve subpath import ${JSON.stringify(specifier)} through the package "imports" map`)
    }
    return resolveModule(fromFile, relative(dirname(fromFile), target).startsWith('.')
      ? relative(dirname(fromFile), target)
      : `./${relative(dirname(fromFile), target)}`, rootDir, importsMap)
  }
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base,
    ...sourceAlternates(base),
    ...(extname(base) === '' ? MODULE_EXTENSIONS.map(extension => `${base}${extension}`) : []),
    ...MODULE_EXTENSIONS.map(extension => join(base, `index${extension}`)),
  ]
  for (const candidate of [...new Set(candidates)]) {
    if (!inside(rootDir, candidate)) throw new Error(`extension import escapes the Pi package: ${specifier} from ${fromFile}`)
    if (await isFile(candidate)) return candidate
  }
  throw new Error(`cannot resolve local extension import ${JSON.stringify(specifier)} from ${fromFile}`)
}

async function expandAsset(path: string, rootDir: string): Promise<string[]> {
  if (!inside(rootDir, path)) throw new Error(`extension asset escapes the Pi package: ${path}`)
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // A `new URL('./worker.js', import.meta.url)` asset may only exist in its
    // TypeScript source form before the package builds; track the source.
    for (const alternate of sourceAlternates(path)) {
      if (await isFile(alternate)) return [alternate]
    }
    throw error
  }
  if (info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link from Pi package: ${path}`)
  if (info.isFile()) return [path]
  if (!info.isDirectory()) return []
  const output: string[] = []
  for (const entry of await readdir(path)) output.push(...await expandAsset(join(path, entry), rootDir))
  return output
}

export async function collectLocalClosure(rootDir: string, entries: readonly string[]): Promise<LocalClosure> {
  const importsMap = await packageImportsMap(rootDir)
  const graph = new Map<string, Array<{ lazy: boolean, targets: string[] }>>()
  const issues: LocalClosureIssue[] = []
  const queue = entries.map(path => resolve(path))
  // Pass 1: the full local reference graph, lazy edges included, so the
  // snapshot carries every file any feature could ever load.
  while (queue.length > 0) {
    const source = queue.shift() as string
    if (graph.has(source)) continue
    if (!inside(rootDir, source)) throw new Error(`extension source escapes the Pi package: ${source}`)
    const info = await lstat(source)
    if (info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link from Pi package: ${source}`)
    if (!info.isFile()) throw new Error(`extension closure contains a non-file path: ${source}`)
    const edges: Array<{ lazy: boolean, targets: string[] }> = []
    graph.set(source, edges)
    if (!SCRIPT_EXTENSIONS.has(extname(source))) continue
    const text = await readFile(source, 'utf8')
    for (const reference of localReferences(source, text)) {
      // Worker/data assets never execute while the entry loads; the feature
      // that spawns them does, so their whole subtree is a lazy path.
      const lazy = reference.lazy || reference.kind === 'asset'
      try {
        const targets = reference.kind === 'module'
          ? [await resolveModule(source, reference.specifier, rootDir, importsMap)]
          : await expandAsset(resolve(dirname(source), reference.specifier), rootDir)
        edges.push({ lazy, targets })
        queue.push(...targets)
      } catch (error) {
        issues.push({
          file: source,
          kind: reference.kind,
          specifier: reference.specifier,
          detail: error instanceof Error ? error.message : String(error),
          lazy,
        })
      }
    }
  }
  // Pass 2: load-time reachability across non-lazy module edges only. This is
  // the set whose problems actually break `pi` (and pi2dsh) at extension load;
  // everything else fails at feature-use time, identically under both hosts.
  const loadTimeFiles = new Set<string>()
  const loadQueue = entries.map(path => resolve(path)).filter(path => graph.has(path))
  while (loadQueue.length > 0) {
    const source = loadQueue.shift() as string
    if (loadTimeFiles.has(source)) continue
    loadTimeFiles.add(source)
    for (const edge of graph.get(source) ?? []) {
      if (edge.lazy) continue
      for (const target of edge.targets) {
        if (!loadTimeFiles.has(target)) loadQueue.push(target)
      }
    }
  }
  // An issue found inside a file that itself only loads lazily cannot break
  // extension load either, however the reference is written.
  for (const issue of issues) {
    if (!loadTimeFiles.has(issue.file)) issue.lazy = true
  }
  return { files: [...graph.keys()].sort(), loadTimeFiles, issues }
}
