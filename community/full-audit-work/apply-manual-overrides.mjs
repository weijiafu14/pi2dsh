import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('community/full-audit-work')
const path = resolve(root, 'classifications.json')
const data = JSON.parse(await readFile(path, 'utf8'))
const overrides = JSON.parse(await readFile(resolve(root, 'manual-overrides.json'), 'utf8'))
const seen = new Set()
data.classifications = data.classifications.map(item => {
  const override = overrides[String(item.number)]
  if (!override) return item
  seen.add(String(item.number))
  return { ...item, ...override, confidence: 1, manualReview: true }
})
const missing = Object.keys(overrides).filter(number => !seen.has(number))
if (missing.length > 0) throw new Error(`manual overrides missing discussions: ${missing.join(', ')}`)
data.manualReviewCount = seen.size
data.classifiedAt = new Date().toISOString()
const temporary = `${path}.tmp`
await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
await rename(temporary, path)
process.stdout.write(`${JSON.stringify({ manualReviewCount: seen.size, path })}\n`)
