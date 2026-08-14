import { readFile } from 'node:fs/promises'
import { basename, extname, relative } from 'node:path'
import ts from 'typescript'
import {
  PI_CODING_AGENT_PACKAGES,
  PI_AI_PACKAGES,
  PI_TUI_PACKAGES,
  ruleForApi,
  ruleForContextProperty,
  ruleForEvent,
  ruleForHostImport,
  ruleForUiContextProperty,
} from './compatibility.js'
import { collectLocalClosure, runtimeExternalPackages, SCRIPT_EXTENSIONS, sourceKind } from './module-graph.js'
import type {
  CompatibilityFinding,
  CompatibilityLevel,
  CompatibilityReport,
  ResolvedPiPackage,
} from './types.js'

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === kind) === true
}

function parameterIdentifier(node: ts.SignatureDeclarationBase): string | undefined {
  const parameter = node.parameters[0]
  return parameter !== undefined && ts.isIdentifier(parameter.name) ? parameter.name.text : undefined
}

function extensionApiReceivers(source: ts.SourceFile): Set<string> {
  const receivers = new Set<string>()
  const functions = new Map<string, ts.FunctionLikeDeclarationBase>()

  function index(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) functions.set(node.name.text, node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functions.set(node.name.text, node.initializer)
    }
    if (ts.isParameter(node) && node.type !== undefined
      && /(?:^|\.)ExtensionAPI\b/u.test(node.type.getText(source)) && ts.isIdentifier(node.name)) {
      receivers.add(node.name.text)
    }
    // Published Pi packages commonly ship JavaScript with type annotations
    // erased. `pi` is the documented ExtensionAPI parameter name throughout
    // the ecosystem, including helper functions reached from the entry point.
    if (ts.isParameter(node) && ts.isIdentifier(node.name)
      && /^(?:pi|extensionApi)$/iu.test(node.name.text)) {
      receivers.add(node.name.text)
    }
    ts.forEachChild(node, index)
  }
  index(source)

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      const name = parameterIdentifier(statement)
      if (name !== undefined) receivers.add(name)
    }
    if (ts.isExportAssignment(statement)) {
      const expression = statement.expression
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        const name = parameterIdentifier(expression)
        if (name !== undefined) receivers.add(name)
      } else if (ts.isIdentifier(expression)) {
        const candidate = functions.get(expression.text)
        if (candidate !== undefined) {
          const name = parameterIdentifier(candidate)
          if (name !== undefined) receivers.add(name)
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined
      && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== 'default' || element.propertyName === undefined || !ts.isIdentifier(element.propertyName)) continue
        const candidate = functions.get(element.propertyName.text)
        if (candidate !== undefined) {
          const name = parameterIdentifier(candidate)
          if (name !== undefined) receivers.add(name)
        }
      }
    }
  }
  return receivers
}

function extensionApiProperties(source: ts.SourceFile, receivers: ReadonlySet<string>): Set<string> {
  const properties = new Set<string>()
  function visit(node: ts.Node): void {
    if ((ts.isPropertyDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const typed = node.type !== undefined && /(?:^|\.)(?:Pi)?ExtensionAPI\b/u.test(node.type.getText(source))
      if (typed || /^(?:pi|extensionApi)$/iu.test(node.name.text)) properties.add(node.name.text)
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword
      && ts.isIdentifier(node.right) && receivers.has(node.right.text)) {
      properties.add(node.left.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return properties
}

function enclosingFunctionName(node: ts.ParameterDeclaration): string | undefined {
  const parent = node.parent
  if (ts.isMethodDeclaration(parent) && parent.name !== undefined) return parent.name.getText()
  if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isPropertyAssignment(parent.parent)) {
    return parent.parent.name.getText()
  }
  return undefined
}

function extensionContextReceivers(source: ts.SourceFile): Set<string> {
  const receivers = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const typedContext = node.type !== undefined
        && /(?:^|\.)(?:Extension|ExtensionCommand|ToolExecution)Context\b/u.test(node.type.getText(source))
      const conventionalHandlerContext = /^(?:ctx|context)$/iu.test(node.name.text)
        && /^(?:execute|handler)$/u.test(enclosingFunctionName(node) ?? '')
      if (typedContext || conventionalHandlerContext) receivers.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return receivers
}

const PI_HOST_PACKAGES = new Set<string>([
  ...PI_CODING_AGENT_PACKAGES,
  ...PI_TUI_PACKAGES,
  ...PI_AI_PACKAGES,
])

function dependencyNames(packageJson: Record<string, unknown>): Set<string> {
  const names = new Set<string>()
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const value = packageJson[field]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    for (const [name, specifier] of Object.entries(value)) {
      if (typeof specifier === 'string') names.add(name)
    }
  }
  return names
}

function pushFinding(
  findings: CompatibilityFinding[],
  rootDir: string,
  file: string,
  source: ts.SourceFile,
  node: ts.Node,
  capability: string,
  level: CompatibilityLevel,
  detail: string,
): void {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  findings.push({
    capability,
    level,
    file: relative(rootDir, file).replaceAll('\\', '/'),
    line: position.line + 1,
    detail,
  })
}

async function analyzeExtension(rootDir: string, file: string): Promise<CompatibilityFinding[]> {
  const text = await readFile(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, sourceKind(file))
  const findings: CompatibilityFinding[] = []
  const receivers = extensionApiReceivers(source)
  const apiProperties = extensionApiProperties(source, receivers)
  const contextReceivers = extensionContextReceivers(source)
  const methodAliases = new Map<string, string>()
  const eventBusAliases = new Set<string>()
  const uiAliases = new Set<string>()

  function reportHostImport(packageName: string, importedName: string, node: ts.Node): void {
    const matched = ruleForHostImport(packageName, importedName)
    if (matched === undefined) {
      pushFinding(
        findings, rootDir, file, source, node, `host-import(${packageName}:${importedName})`, 'unsupported',
        `The pi2dsh host shim does not export ${JSON.stringify(importedName)} from ${JSON.stringify(packageName)}.`,
      )
      return
    }
    pushFinding(
      findings, rootDir, file, source, node, `host-import(${packageName}:${importedName})`, matched.level, matched.detail,
    )
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && PI_HOST_PACKAGES.has(statement.moduleSpecifier.text)) {
      const packageName = statement.moduleSpecifier.text
      const clause = statement.importClause
      if (clause === undefined) {
        reportHostImport(packageName, '<side-effect>', statement)
        continue
      }
      if (clause.isTypeOnly) continue
      if (clause.name !== undefined) reportHostImport(packageName, 'default', clause.name)
      if (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
        reportHostImport(packageName, '*', clause.namedBindings)
      } else if (clause.namedBindings !== undefined) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) reportHostImport(packageName, element.propertyName?.text ?? element.name.text, element)
        }
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly
      && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
      && PI_HOST_PACKAGES.has(statement.moduleSpecifier.text)) {
      const packageName = statement.moduleSpecifier.text
      if (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)) {
        reportHostImport(packageName, '*', statement)
      } else {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly) reportHostImport(packageName, element.propertyName?.text ?? element.name.text, element)
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)
      && ts.isStringLiteral(statement.moduleReference.expression)
      && PI_HOST_PACKAGES.has(statement.moduleReference.expression.text)) {
      reportHostImport(statement.moduleReference.expression.text, '*', statement)
    }
  }

  const declarations: ts.VariableDeclaration[] = []
  const isApiReceiver = (node: ts.Expression): boolean => ts.isIdentifier(node) && receivers.has(node.text)
    || (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword
      && apiProperties.has(node.name.text))
  function collectDeclarations(node: ts.Node): void {
    if (ts.isVariableDeclaration(node)) declarations.push(node)
    ts.forEachChild(node, collectDeclarations)
  }
  collectDeclarations(source)

  for (let pass = 0; pass < declarations.length + 1; pass += 1) {
    let changed = false
    for (const declaration of declarations) {
      const initializer = declaration.initializer
      if (initializer === undefined) continue
      if (ts.isIdentifier(declaration.name) && isApiReceiver(initializer)) {
        if (!receivers.has(declaration.name.text)) {
          receivers.add(declaration.name.text)
          changed = true
        }
      }
      if (ts.isIdentifier(declaration.name) && ts.isIdentifier(initializer) && contextReceivers.has(initializer.text)) {
        if (!contextReceivers.has(declaration.name.text)) {
          contextReceivers.add(declaration.name.text)
          changed = true
        }
      }
      if (ts.isIdentifier(declaration.name) && ts.isPropertyAccessExpression(initializer)
        && initializer.name.text === 'ui' && ts.isIdentifier(initializer.expression)
        && contextReceivers.has(initializer.expression.text) && !uiAliases.has(declaration.name.text)) {
        uiAliases.add(declaration.name.text)
        changed = true
      }
      if (ts.isIdentifier(declaration.name) && ts.isPropertyAccessExpression(initializer)
        && isApiReceiver(initializer.expression)) {
        if (initializer.name.text === 'events') {
          if (!eventBusAliases.has(declaration.name.text)) {
            eventBusAliases.add(declaration.name.text)
            changed = true
          }
        } else if (!methodAliases.has(declaration.name.text)) {
          methodAliases.set(declaration.name.text, initializer.name.text)
          changed = true
        }
      }
      if (ts.isObjectBindingPattern(declaration.name) && isApiReceiver(initializer)) {
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const method = element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text
          if (method === 'events') {
            if (!eventBusAliases.has(element.name.text)) {
              eventBusAliases.add(element.name.text)
              changed = true
            }
          } else if (!methodAliases.has(element.name.text)) {
            methodAliases.set(element.name.text, method)
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }

  function reportMethod(method: string, args: ts.NodeArray<ts.Expression>, node: ts.Node): void {
    if (method === 'on') {
      const event = literalText(args[0])
      if (event === undefined) {
        pushFinding(
          findings, rootDir, file, source, node, 'on(<dynamic>)', 'unsupported',
          'Dynamic event names cannot be audited or mapped safely.',
        )
      } else {
        const rule = ruleForEvent(event)
        pushFinding(findings, rootDir, file, source, node, `on(${event})`, rule.level, rule.detail)
      }
      return
    }
    const rule = ruleForApi(method)
    if (rule === undefined) {
      pushFinding(
        findings, rootDir, file, source, node, method, 'unsupported',
        `Unknown ExtensionAPI method ${JSON.stringify(method)} cannot be audited or mapped safely.`,
      )
      return
    }
    pushFinding(findings, rootDir, file, source, node, method, rule.level, rule.detail)
  }

  function reportEventBus(method: string, node: ts.Node): void {
    const rule = ruleForApi('events')
    if ((method === 'on' || method === 'emit') && rule !== undefined) {
      pushFinding(findings, rootDir, file, source, node, `events.${method}`, rule.level, rule.detail)
    } else {
      pushFinding(
        findings, rootDir, file, source, node, `events.${method}`, 'unsupported',
        `Unknown Pi event-bus method ${JSON.stringify(method)} cannot be mapped safely.`,
      )
    }
  }

  function reportContext(property: string, node: ts.Node): void {
    const matched = ruleForContextProperty(property)
    if (matched === undefined) {
      pushFinding(
        findings, rootDir, file, source, node, `ctx.${property}`, 'unsupported',
        `Unknown Pi extension-context property ${JSON.stringify(property)} cannot be audited or mapped safely.`,
      )
    } else {
      pushFinding(findings, rootDir, file, source, node, `ctx.${property}`, matched.level, matched.detail)
    }
  }

  function reportUiContext(property: string, node: ts.Node): void {
    const matched = ruleForUiContextProperty(property)
    if (matched === undefined) {
      pushFinding(
        findings, rootDir, file, source, node, `ctx.ui.${property}`, 'unsupported',
        `Unknown Pi UI-context property ${JSON.stringify(property)} cannot be audited or mapped safely.`,
      )
    } else {
      pushFinding(findings, rootDir, file, source, node, `ctx.ui.${property}`, matched.level, matched.detail)
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const method = methodAliases.get(node.expression.text)
      if (method !== undefined) reportMethod(method, node.arguments, node)
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression.expression
      if (isApiReceiver(target)) {
        reportMethod(node.expression.name.text, node.arguments, node)
      } else if (ts.isIdentifier(target) && eventBusAliases.has(target.text)) {
        reportEventBus(node.expression.name.text, node)
      } else if (ts.isPropertyAccessExpression(target)
        && target.name.text === 'events'
        && isApiReceiver(target.expression)) {
        reportEventBus(node.expression.name.text, node)
      }
    } else if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)
      && isApiReceiver(node.expression.expression)) {
      const method = literalText(node.expression.argumentExpression)
      if (method === undefined) {
        pushFinding(
          findings, rootDir, file, source, node, '<dynamic-api-method>', 'unsupported',
          'Dynamic ExtensionAPI method access cannot be audited or mapped safely.',
        )
      } else {
        reportMethod(method, node.arguments, node)
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = node.expression
      if (ts.isPropertyAccessExpression(target) && target.name.text === 'ui'
        && ts.isIdentifier(target.expression) && contextReceivers.has(target.expression.text)) {
        reportUiContext(node.name.text, node)
      } else if (ts.isIdentifier(target) && uiAliases.has(target.text)) {
        reportUiContext(node.name.text, node)
      } else if (ts.isIdentifier(target) && contextReceivers.has(target.text) && node.name.text !== 'ui') {
        reportContext(node.name.text, node)
      }
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)
      && contextReceivers.has(node.expression.text)) {
      const property = literalText(node.argumentExpression)
      if (property === undefined) {
        pushFinding(
          findings, rootDir, file, source, node, 'ctx.<dynamic>', 'unsupported',
          'Dynamic Pi extension-context access cannot be audited or mapped safely.',
        )
      } else if (property !== 'ui') {
        reportContext(property, node)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return findings
}

export async function analyzePackage(pkg: ResolvedPiPackage): Promise<CompatibilityReport> {
  const extensionClosure = await collectLocalClosure(pkg.rootDir, pkg.resources.extensions)
  const findings = (await Promise.all(
    extensionClosure.files.filter(file => SCRIPT_EXTENSIONS.has(extname(file)))
      .map(file => analyzeExtension(pkg.rootDir, file)),
  )).flat()

  if (pkg.resources.extensions.length > 0 && findings.length === 0) {
    findings.push({
      capability: 'static-audit',
      level: 'unsupported',
      file: pkg.resources.extensions.map(file => relative(pkg.rootDir, file).replaceAll('\\', '/')).join(', '),
      line: 1,
      detail: 'No ExtensionAPI use was statically proven across the local module closure; conversion fails closed instead of claiming compatibility.',
    })
  }
  for (const issue of extensionClosure.issues) {
    findings.push({
      capability: `${issue.kind}(${issue.specifier})`,
      level: 'fatal',
      file: relative(pkg.rootDir, issue.file).replaceAll('\\', '/'),
      line: 1,
      detail: `The local extension closure is incomplete: ${issue.detail}`,
    })
  }

  const declaredDependencies = dependencyNames(pkg.packageJson)
  for (const file of extensionClosure.files.filter(candidate => SCRIPT_EXTENSIONS.has(extname(candidate)))) {
    const text = await readFile(file, 'utf8')
    for (const packageName of runtimeExternalPackages(file, text)) {
      if (PI_HOST_PACKAGES.has(packageName) || declaredDependencies.has(packageName)) continue
      findings.push({
        capability: `undeclared-runtime-dependency(${packageName})`,
        level: 'fatal',
        file: relative(pkg.rootDir, file).replaceAll('\\', '/'),
        line: 1,
        detail: `The extension imports ${JSON.stringify(packageName)} at runtime, but the Pi package does not declare it as a dependency.`,
      })
    }
  }

  const resourceFinding = (file: string, capability: string, level: CompatibilityLevel, detail: string): CompatibilityFinding => ({
    capability,
    level,
    file: relative(pkg.rootDir, file).replaceAll('\\', '/'),
    line: 1,
    detail,
  })
  for (const file of pkg.resources.skills.filter(path => basename(path) === 'SKILL.md' || path.endsWith('.md'))) {
    findings.push(resourceFinding(file, 'skill', 'full', 'Copied as a DSH filesystem skill with its resource directory intact.'))
  }
  for (const file of pkg.resources.prompts) {
    findings.push(resourceFinding(file, 'prompt', 'full', 'Registered as a DSH slash command with Pi-compatible argument expansion.'))
  }
  for (const file of pkg.resources.themes) {
    findings.push(resourceFinding(file, 'theme', 'unsupported', 'Pi terminal themes have no effect in DSH Web or headless surfaces.'))
  }
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.capability.localeCompare(right.capability))

  const summary: Record<CompatibilityLevel, number> = { full: 0, partial: 0, unsupported: 0, fatal: 0 }
  for (const finding of findings) summary[finding.level] += 1
  // Static analysis screens; it does not certify. Only fatal findings block a
  // bundle (it cannot be built or trusted). Everything else installs: verify
  // real behavior with the black-box run instead of trusting this verdict.
  const verdict = summary.fatal > 0 ? 'blocked' : summary.partial > 0 || summary.unsupported > 0 ? 'review' : 'ready'

  return {
    schemaVersion: 1,
    package: pkg.identity,
    verdict,
    summary,
    resources: {
      extensions: pkg.resources.extensions.map(file => relative(pkg.rootDir, file).replaceAll('\\', '/')),
      skills: pkg.resources.skills.map(file => relative(pkg.rootDir, file).replaceAll('\\', '/')),
      prompts: pkg.resources.prompts.map(file => relative(pkg.rootDir, file).replaceAll('\\', '/')),
      themes: pkg.resources.themes.map(file => relative(pkg.rootDir, file).replaceAll('\\', '/')),
    },
    findings,
  }
}
