import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { analyzePackage } from './analyzer.js'
import { API_RULES, CONTEXT_RULES, EVENT_RULES, HOST_IMPORT_RULES, UI_CONTEXT_RULES } from './compatibility.js'
import { generateBundle } from './generator.js'
import { convertPiMcpConfig, renderMcpPatch } from './mcp-config.js'
import { resolvePiPackage } from './source.js'
import type { CompatibilityReport } from './types.js'

function usage(): string {
  return `pi2dsh — migrate Pi packages to DeepSeek Harness\n\n`
    + `Usage:\n`
    + `  pi2dsh inspect <package-or-path> [--json]\n`
    + `  pi2dsh convert <package-or-path> --out <directory> [--runtime <spec>] [--strict] [--allow-unsupported]\n`
    + `  pi2dsh mcp-config [--cwd <dir>] [--out <file>] [--json]\n`
    + `  pi2dsh host --packages <spec,spec,...> --out <directory> [--name <bundle-name>]\n`
    + `  pi2dsh matrix [--json]\n\n`
    + `host generates ONE installable DSH bundle that mounts the listed Pi\n`
    + `packages as ordinary npm dependencies — no per-package conversion.\n\n`
    + `mcp-config reads Pi's standard mcpServers files (six-layer precedence)\n`
    + `and emits DSH cordis.patch.yml entries for the official dsh-mcp-client —\n`
    + `Pi's MCP adapter code is never executed.\n`
}

function reportText(report: CompatibilityReport): string {
  const lines = [
    `${report.package.name}@${report.package.version}: ${report.verdict.toUpperCase()}`,
    `full=${report.summary.full} partial=${report.summary.partial} unsupported=${report.summary.unsupported}`,
    `extensions=${report.resources.extensions.length} skills=${report.resources.skills.length} prompts=${report.resources.prompts.length} themes=${report.resources.themes.length}`,
  ]
  for (const finding of report.findings) {
    lines.push(`${finding.level.toUpperCase().padEnd(11)} ${finding.file}:${finding.line} ${finding.capability} — ${finding.detail}`)
  }
  return lines.join('\n')
}

function matrix(json: boolean): void {
  const value = {
    api: API_RULES,
    events: EVENT_RULES,
    context: CONTEXT_RULES,
    uiContext: UI_CONTEXT_RULES,
    hostImports: HOST_IMPORT_RULES,
  }
  if (json) console.log(JSON.stringify(value, null, 2))
  else {
    for (const [kind, rules] of Object.entries(value)) {
      console.log(`${kind}:`)
      for (const [name, candidate] of Object.entries(rules)) {
        if ('level' in candidate && 'detail' in candidate) {
          console.log(`  ${candidate.level.padEnd(11)} ${name} — ${candidate.detail}`)
        } else {
          const hostRules = candidate as Readonly<Record<string, { level: string; detail: string }>>
          for (const [exportName, hostRule] of Object.entries(hostRules)) {
            console.log(`  ${hostRule.level.padEnd(11)} ${name}:${exportName} — ${hostRule.detail}`)
          }
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      cwd: { type: 'string' },
      packages: { type: 'string' },
      name: { type: 'string' },
      runtime: { type: 'string' },
      strict: { type: 'boolean', default: false },
      'allow-unsupported': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const [command, source] = parsed.positionals
  if (parsed.values.help || command === undefined) {
    console.log(usage())
    return
  }
  if (command === 'matrix') {
    matrix(parsed.values.json)
    return
  }
  if (command === 'host') {
    if (parsed.values.out === undefined) throw new Error('host requires --out <directory>')
    if (parsed.values.packages === undefined) throw new Error('host requires --packages <spec,spec,...>')
    const { generateHostBundle } = await import('./host.js')
    const result = await generateHostBundle({
      outDir: parsed.values.out,
      packages: parsed.values.packages.split(',').map(spec => spec.trim()).filter(Boolean),
      ...(parsed.values.name === undefined ? {} : { bundleName: parsed.values.name }),
    })
    console.log(`Generated host bundle ${result.packageName} in ${result.outDir}`)
    console.log(`Install with: dsh plugin --profile headless add file:${result.outDir}`)
    return
  }
  if (command === 'mcp-config') {
    const result = convertPiMcpConfig(parsed.values.cwd ?? process.cwd())
    for (const warning of result.warnings) {
      console.error(`warning: ${warning.server}: ${warning.message}`)
    }
    const output = parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : renderMcpPatch(result)
    if (parsed.values.out === undefined) process.stdout.write(output)
    else {
      writeFileSync(parsed.values.out, output)
      console.error(`wrote ${result.entries.length} MCP server entr${result.entries.length === 1 ? 'y' : 'ies'} from ${result.sources.length} Pi config file(s) to ${parsed.values.out}`)
    }
    return
  }
  if ((command !== 'inspect' && command !== 'convert') || source === undefined) {
    throw new Error(`invalid command\n\n${usage()}`)
  }

  const pkg = await resolvePiPackage(source)
  try {
    if (command === 'inspect') {
      const report = await analyzePackage(pkg)
      console.log(parsed.values.json ? JSON.stringify(report, null, 2) : reportText(report))
      if (report.verdict === 'blocked') process.exitCode = 2
      return
    }
    if (parsed.values.out === undefined) throw new Error('convert requires --out <directory>')
    const result = await generateBundle(pkg, {
      outDir: parsed.values.out,
      ...(parsed.values.runtime !== undefined ? { runtimeSpec: parsed.values.runtime } : {}),
      strict: parsed.values.strict,
      allowUnsupported: parsed.values['allow-unsupported'],
    })
    console.log(`Generated ${result.packageName} in ${result.outDir}`)
    console.log(reportText(result.report))
  } finally {
    await pkg.dispose()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
