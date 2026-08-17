#!/usr/bin/env node
// Which real Pi packages use which presentation surface.
//
//   node scripts/survey-surface-usage.mjs [out.json]
//
// The examples are supposed to answer a reader's question — "which plugin can
// I install now that this works?" — and that answer has to come from the real
// ecosystem, not from a package we wrote. This downloads the corpus and reads
// each package's own source for the calls, so the example's plugin list is
// measured rather than remembered.
//
// It reports call SITES, not proof the plugin works: a package that calls
// setStatus still has to be run before it goes on the "verified" list. That
// distinction is standard 四点五 and this file must not blur it.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolvePiPackage } from '../dist/index.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const outputPath = resolve(root, process.argv[2] ?? 'community/surface-usage.json')
const corpus = JSON.parse(await readFile(join(root, 'community/corpus.json'), 'utf8'))

// The surfaces the browser half connected. Matched as a member call so that a
// mention in a README or a type import does not count as usage.
const SURFACES = {
  setStatus: /\.setStatus\s*\(/u,
  setWidget: /\.setWidget\s*\(/u,
  setTitle: /\.setTitle\s*\(/u,
  setHeader: /\.setHeader\s*\(/u,
  setFooter: /\.setFooter\s*\(/u,
  setWorkingMessage: /\.setWorkingMessage\s*\(/u,
  setWorkingIndicator: /\.setWorkingIndicator\s*\(/u,
  setHiddenThinkingLabel: /\.setHiddenThinkingLabel\s*\(/u,
  registerMessageRenderer: /\.registerMessageRenderer\s*\(/u,
  registerEntryRenderer: /\.registerEntryRenderer\s*\(/u,
  setEditorText: /\.setEditorText\s*\(/u,
  pasteToEditor: /\.pasteToEditor\s*\(/u,
  getEditorText: /\.getEditorText\s*\(/u,
  addAutocompleteProvider: /\.addAutocompleteProvider\s*\(/u,
  appendEntry: /\.appendEntry\s*\(/u,
}

const SOURCE = /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/u
const SKIP = new Set(['node_modules', '.git', 'test', 'tests', '__tests__'])

async function* sourceFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (SOURCE.test(entry.name)) yield path
  }
}

const results = []
for (const entry of corpus.packages) {
  let pkg
  try {
    pkg = await resolvePiPackage(entry.specifier ?? entry.name)
    const used = new Set()
    let bytes = 0
    for await (const file of sourceFiles(pkg.rootDir)) {
      const size = (await stat(file)).size
      // Bundled dist files run to megabytes on one line; reading them is the
      // point (that is where the calls survive minification), but a runaway
      // file is worth knowing about rather than silently skipping.
      bytes += size
      const text = await readFile(file, 'utf8')
      for (const [name, pattern] of Object.entries(SURFACES)) {
        if (pattern.test(text)) used.add(name)
      }
    }
    results.push({
      name: pkg.identity.name,
      version: pkg.identity.version,
      rank: entry.rank,
      downloadsPerMonth: entry.downloadsPerMonth,
      bytesScanned: bytes,
      surfaces: [...used].sort(),
    })
    process.stderr.write(`${pkg.identity.name}: ${[...used].sort().join(', ') || '—'}\n`)
  } catch (error) {
    // Fails loud per package rather than dropping it: a silently missing
    // package would understate the ecosystem and nobody would notice.
    results.push({ name: entry.name, rank: entry.rank, error: error instanceof Error ? error.message : String(error) })
    process.stderr.write(`${entry.name}: ERROR ${error}\n`)
  } finally {
    await pkg?.dispose()
  }
}

const bySurface = {}
for (const name of Object.keys(SURFACES)) {
  bySurface[name] = results.filter(item => item.surfaces?.includes(name)).map(item => item.name).sort()
}

await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  corpus: { source: corpus.source, capturedAt: corpus.capturedAt, size: corpus.packages.length },
  note: 'call sites found in package source. Usage is not proof the plugin works; that comes from an end-to-end run.',
  bySurface,
  packages: results,
}, null, 2)}\n`)

console.log(`\n[surface-usage] → ${outputPath}`)
for (const [name, list] of Object.entries(bySurface)) {
  console.log(`${name.padEnd(26)} ${String(list.length).padStart(2)}  ${list.slice(0, 6).join(', ')}${list.length > 6 ? ' …' : ''}`)
}
const failed = results.filter(item => item.error)
if (failed.length > 0) console.log(`\n${failed.length} package(s) could not be read: ${failed.map(item => item.name).join(', ')}`)
