// dsh-x's browser half IS the engine's, re-identified.
//
// The host serves exactly one client bundle per client-declaring package in
// the profile and requires it to register its OWN package id via
// window.__ModuleLoader__.load — a forwarding stub cannot work (there is no
// require() in the browser, and the engine's bundle is never served for a
// package the profile cannot see). So the suite ships a byte-for-byte copy
// of the engine's client bundle with only the loader id rewritten. The copy
// is regenerated on every publish (prepack), so it always matches the engine
// version the suite pins.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(repoRoot, 'dist', 'client.js')
const target = join(repoRoot, 'dsh-x', 'client.js')

const bundle = readFileSync(source, 'utf8')
const banner = 'id: "pi2dsh",'
const occurrences = bundle.split(banner).length - 1
if (occurrences !== 1) {
  throw new Error(`build-dsh-x-client: expected exactly one loader id banner in dist/client.js, found ${occurrences} — the bundle shape changed, update this script deliberately`)
}
writeFileSync(target, bundle.replace(banner, 'id: "dsh-x",'))
console.log(`dsh-x/client.js regenerated from dist/client.js (${bundle.length} bytes)`)
