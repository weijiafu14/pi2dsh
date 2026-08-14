import { builtinModules } from 'node:module'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

export const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']

interface LocalReference {
  kind: 'module' | 'asset'
  specifier: string
}

export interface LocalClosureIssue {
  file: string
  kind: LocalReference['kind']
  specifier: string
  detail: string
}

export interface LocalClosure {
  files: string[]
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
  const add = (kind: LocalReference['kind'], specifier: string): void => {
    // '#'-prefixed specifiers are Node subpath imports resolved through the
    // package's own `imports` map — package-local, not external dependencies.
    if (specifier.startsWith('.') || specifier.startsWith('#')) {
      values.set(`${kind}:${specifier}`, { kind, specifier })
    }
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
      add('module', node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      add('module', node.moduleReference.expression.text)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0
      && ((node.expression.kind === ts.SyntaxKind.ImportKeyword)
        || (ts.isIdentifier(node.expression) && requireNames.has(node.expression.text)))) {
      const specifier = literalModule(node.arguments[0])
      if (specifier !== undefined) add('module', specifier)
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL'
      && isImportMetaUrl(node.arguments?.[1])) {
      const specifier = literalModule(node.arguments?.[0])
      if (specifier !== undefined) add('asset', specifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...values.values()]
}

function externalPackage(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')
    || specifier.startsWith('node:') || builtinModules.includes(specifier)) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

export function runtimeExternalPackages(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, sourceKind(path))
  const packages = new Set<string>()
  const createRequireNames = new Set<string>(['createRequire'])
  const requireNames = new Set<string>(['require'])
  const add = (specifier: string): void => {
    const name = externalPackage(specifier)
    if (name !== undefined && name.length > 0) packages.add(name)
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
        add(node.moduleSpecifier.text)
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node.moduleReference.expression.text)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0
      && ((node.expression.kind === ts.SyntaxKind.ImportKeyword)
        || (ts.isIdentifier(node.expression) && requireNames.has(node.expression.text)))) {
      const specifier = literalModule(node.arguments[0])
      if (specifier !== undefined) add(specifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...packages]
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
  const queue = entries.map(path => resolve(path))
  const closure = new Set<string>()
  const issues: LocalClosureIssue[] = []
  const importsMap = await packageImportsMap(rootDir)
  while (queue.length > 0) {
    const source = queue.shift() as string
    if (closure.has(source)) continue
    if (!inside(rootDir, source)) throw new Error(`extension source escapes the Pi package: ${source}`)
    const info = await lstat(source)
    if (info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link from Pi package: ${source}`)
    if (!info.isFile()) throw new Error(`extension closure contains a non-file path: ${source}`)
    closure.add(source)
    if (!SCRIPT_EXTENSIONS.has(extname(source))) continue
    const text = await readFile(source, 'utf8')
    for (const reference of localReferences(source, text)) {
      try {
        if (reference.kind === 'module') queue.push(await resolveModule(source, reference.specifier, rootDir, importsMap))
        else queue.push(...await expandAsset(resolve(dirname(source), reference.specifier), rootDir))
      } catch (error) {
        issues.push({
          file: source,
          kind: reference.kind,
          specifier: reference.specifier,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return { files: [...closure].sort(), issues }
}
