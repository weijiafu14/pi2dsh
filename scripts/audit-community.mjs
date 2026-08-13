#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { analyzePackage, resolvePiPackage } from '../dist/index.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const corpusPath = resolve(root, 'community/corpus.json')
const outputPath = resolve(root, process.argv[2] ?? 'community/audit-results.json')
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'))

async function auditOnce(entry) {
  let pkg
  try {
    pkg = await resolvePiPackage(entry.specifier ?? entry.name)
    const report = await analyzePackage(pkg)
    const repository = pkg.packageJson.repository
    return {
      ...entry,
      specifier: `${pkg.identity.name}@${pkg.identity.version}`,
      version: pkg.identity.version,
      repository: typeof repository === 'string' ? repository : repository?.url,
      status: 'audited',
      verdict: report.verdict,
      summary: report.summary,
      partialCapabilities: [...new Set(report.findings.filter(item => item.level === 'partial').map(item => item.capability))],
      blockers: [...new Set(report.findings.filter(item => item.level === 'unsupported').map(item => item.capability))],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('resource pattern must stay inside the Pi package')) {
      return {
        ...entry,
        status: 'audited',
        verdict: 'blocked',
        summary: { full: 0, partial: 0, unsupported: 1 },
        partialCapabilities: [],
        blockers: ['invalid-resource-manifest'],
        error: message,
      }
    }
    return {
      ...entry,
      status: 'audit-error',
      error: message,
    }
  } finally {
    await pkg?.dispose()
  }
}

async function audit(entry) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await auditOnce(entry)
    if (result.status !== 'audit-error' || !/^(?:aborted|socket hang up)$/iu.test(result.error)) return result
  }
  return { ...entry, status: 'audit-error', error: 'transient package download failed after 3 attempts' }
}

const pending = [...corpus.packages]
const results = []
async function worker() {
  while (pending.length > 0) {
    const entry = pending.shift()
    if (entry !== undefined) results.push(await audit(entry))
  }
}
await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()))
results.sort((left, right) => left.rank - right.rank)

const value = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpus: {
    source: corpus.source,
    capturedAt: corpus.capturedAt,
    selection: corpus.selection,
    size: corpus.packages.length,
  },
  counts: {
    ready: results.filter(item => item.verdict === 'ready').length,
    review: results.filter(item => item.verdict === 'review').length,
    blocked: results.filter(item => item.verdict === 'blocked').length,
    error: results.filter(item => item.status === 'audit-error').length,
  },
  results,
}
await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`)
console.log(JSON.stringify(value.counts))
console.log(outputPath)
