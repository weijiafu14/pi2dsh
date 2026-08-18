#!/usr/bin/env node
// Which published Pi packages actually register a model provider.
//
//   node scripts/screen-provider-packages.mjs [out.json]
//
// The mount survey costs an install and a boot per package, so it cannot be
// pointed at the whole registry. This narrows the field first, cheaply and
// without running anything: search npm, fetch each candidate's tarball, and
// look for the one call that makes a package a provider —
// `registerProvider`. What comes out is the list worth mounting.
//
// A name or a description is not evidence: `pi-provider-utils` helps others
// register and registers nothing itself, while a package whose description
// never says "provider" may still register one. Only the code decides.
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pacote = require('pacote')
const outputPath = resolve(process.argv[2] ?? 'community/provider-universe.json')

// Several phrasings, because npm's relevance ranking truncates any single one.
const QUERIES = [
  'pi-provider', 'pi provider', 'provider pi-coding-agent', 'pi extension provider',
  'pi-ai provider', 'pi- gateway', 'pi models', 'pi-coding-agent extension',
]

/** Every package npm returns for the queries above, deduplicated by name. */
async function searchRegistry() {
  const found = new Map()
  for (const text of QUERIES) {
    for (const from of [0, 250]) {
      const url = `https://registry.npmjs.org/-/v1/search?size=250&from=${from}&text=${encodeURIComponent(text)}`
      try {
        const response = await fetch(url)
        if (!response.ok) continue
        for (const entry of (await response.json()).objects ?? []) {
          found.set(entry.package.name, entry.package)
        }
      } catch {
        // One failed page must not lose the pages that did answer.
      }
    }
  }
  return [...found.values()]
}

/** Every distinct http(s) host a package's source names as an endpoint. */
function endpointsIn(source) {
  const hosts = new Set()
  for (const match of source.matchAll(/https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})/gu)) {
    const host = match[1].toLowerCase()
    // Repos, docs and schema URLs are not the service a provider calls.
    if (/(github|githubusercontent|npmjs|json-schema|schemastore|w3\.org|example\.(com|test)|localhost)/u.test(host)) continue
    hosts.add(host)
  }
  return [...hosts].sort().slice(0, 8)
}

/** Weekly npm downloads, or null when the registry does not answer. */
async function weeklyDownloads(name) {
  try {
    const response = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`)
    if (!response.ok) return null
    return (await response.json()).downloads ?? null
  } catch {
    return null
  }
}

/** Read every text file in a directory tree, concatenated. */
async function sourceOf(dir) {
  let text = ''
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      text += await sourceOf(path)
      continue
    }
    if (!/\.(m?[jt]s|cjs|json)$/u.test(entry.name)) continue
    const info = await stat(path)
    if (info.size > 4_000_000) continue
    text += await readFile(path, 'utf8')
  }
  return text
}

const candidates = (await searchRegistry())
  .filter(pkg => /^(@[^/]+\/)?pi-/u.test(pkg.name))
console.log(`npm search: ${candidates.length} packages named like the Pi ecosystem`)

const results = []
let done = 0
for (const pkg of candidates) {
  done += 1
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-screen-'))
  try {
    await pacote.extract(pkg.name, scratch)
    const source = await sourceOf(scratch)
    // `registerProvider` is the call; the others say what KIND of provider it
    // is, which decides how the bridge can serve it.
    const registers = source.includes('registerProvider')
    if (registers) {
      results.push({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? '',
        // A transport of its own is what makes a native route possible.
        carriesTransport: /\bstreamSimple\s*[:(]/u.test(source) || /\bstream\s*[:(]/u.test(source),
        declaresOAuth: /\boauth\s*:/u.test(source),
        // Pi's env-reference convention, which becomes DSH's apiKeyEnv.
        envApiKey: /apiKey\s*:\s*["'`]\$/u.test(source),
        // WHOSE service this is. A hundred packages is not a hundred vendors
        // until the endpoints say so, and the endpoint is written in the code.
        hosts: endpointsIn(source),
        downloads: await weeklyDownloads(pkg.name),
      })
    }
    if (done % 25 === 0) console.log(`  screened ${done}/${candidates.length}, ${results.length} register a provider`)
  } catch (error) {
    results.push({ name: pkg.name, version: pkg.version, error: String(error?.message ?? error).slice(0, 120) })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const providers = results.filter(entry => entry.error === undefined)
const failed = results.filter(entry => entry.error !== undefined)
const report = {
  schemaVersion: 1,
  note: 'Packages whose published source calls registerProvider. Screening is static: it says a package declares a provider, not that the provider works.',
  counts: {
    searched: candidates.length,
    registersProvider: providers.length,
    carriesTransport: providers.filter(entry => entry.carriesTransport).length,
    declaresOAuth: providers.filter(entry => entry.declaresOAuth).length,
    usedLastWeek: providers.filter(entry => (entry.downloads ?? 0) >= 10).length,
    unreadable: failed.length,
  },
  providers: providers.sort((a, b) => a.name.localeCompare(b.name)),
  unreadable: failed,
}
const { writeFile } = await import('node:fs/promises')
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report.counts))
console.log(`wrote ${outputPath}`)
