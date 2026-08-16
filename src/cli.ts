// The analyzer (which pulls the 23 MB typescript compiler, an optional peer)
// loads lazily inside its own command only — `matrix` and `mcp-config` must
// run on an install without typescript.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { API_RULES, CONTEXT_RULES, EVENT_RULES, HOST_IMPORT_RULES, UI_CONTEXT_RULES } from './compatibility.js'
import { convertPiMcpConfig, renderMcpPatch } from './mcp-config.js'
import { resolvePiPackage } from './source.js'
import type { CompatibilityReport } from './types.js'

function usage(): string {
  return `pi2dsh — migrate Pi packages to DeepSeek Harness\n\n`
    + `Usage:\n`
    + `  pi2dsh inspect <package-or-path> [--json]\n`
    + `  pi2dsh mcp-config [--cwd <dir>] [--out <file>] [--json]\n`
    + `  pi2dsh matrix [--json]\n\n`
    + `Installing is dsh's own job — \`dsh plugin add pi2dsh\`, then\n`
    + `\`dsh plugin add <pi package>\`. This CLI only inspects.\n\n`
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
  if (command !== 'inspect' || source === undefined) {
    throw new Error(`invalid command\n\n${usage()}`)
  }

  const pkg = await resolvePiPackage(source)
  try {
    const { analyzePackage } = await import('./analyzer.js')
    const report = await analyzePackage(pkg)
    console.log(parsed.values.json ? JSON.stringify(report, null, 2) : reportText(report))
    if (report.verdict === 'blocked') process.exitCode = 2
  } finally {
    await pkg.dispose()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
