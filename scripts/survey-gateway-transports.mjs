#!/usr/bin/env node
// Which Pi gateway packages actually become a usable DSH route.
//
//   node scripts/survey-gateway-transports.mjs [out.json] [pkg …]
//
// The hard precondition for a gateway package to solve anything is that it
// brings its OWN transport: only then does the bridge register it as a native
// DSH llm route and the compat it declares reaches the request. A package that
// only declares a catalog falls back to the host's llm settings and hits the
// very problem the user came with.
//
// The bridge already says which it is, in one line at startup, so this installs
// each package into a throwaway profile, boots the runtime once, and reads that
// line. No model turn is sent — this costs nothing but the install.
//
//   [pi2dsh] Pi provider "<name>" registered as a native DSH llm route
//   [pi2dsh] Pi provider "<name>" declares a model catalog but no transport
import { execFile as execFileCb, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRoot = process.env.DSH_ROOT ?? resolve(projectRoot, '../deepseek-harness')
const dshBin = join(dshRoot, 'apps/cli/src/bin.ts')
const outputPath = resolve(projectRoot, process.argv[2] ?? 'community/gateway-transports.json')

// Gateway packages from the npm search for Pi providers, covering the vendors
// the community threads name (domestic clouds, relays, self-hosted proxies).
const DEFAULT_PACKAGES = [
  'pi-provider-litellm',
  'pi-provider-newapi',
  'pi-provider-ollama-cloud',
  'pi-cliproxyapi-provider',
  'pi-provider-alibaba-bailian',
  'pi-volcengine-provider',
  'pi-provider-kimi-code',
  '@indexyz/pi-provider-sub2api',
  'pi-moonshot-provider',
  'pi-qwencloud-provider',
  'pi-fireworks-provider',
  'pi-baseten-provider',
]
const packages = process.argv.slice(3).length > 0 ? process.argv.slice(3) : DEFAULT_PACKAGES

// Three outcomes, three lines, none of them printed before the route exists.
// The old criterion matched an announcement the engine made BEFORE mounting,
// so a provider that failed a moment later still counted as working.
const ROUTE = /Pi provider "([^"]+)" registered as a native DSH llm route/u
const SERVED_BY_OFFICIAL = /Pi provider "([^"]+)" declares a catalog only; DSH's official llm-pi-ai adapter now serves it/u
const NOT_SERVED = /Pi provider "([^"]+)" could not be served by the official adapter \(([^)]*)\)/u

async function probe(name) {
  const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-gw-'))
  try {
    const home = join(scratch, 'dsh-home')
    const shimDir = join(scratch, 'bin')
    await mkdir(shimDir, { recursive: true })
    await writeFile(join(shimDir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
    await chmod(join(shimDir, 'pnpm'), 0o755)
    const env = {
      ...process.env, DSH_HOME: home, PATH: `${shimDir}:${process.env.PATH ?? ''}`,
      CI: '1', NO_COLOR: '1', DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'danger-full-access',
      npm_config_registry: 'https://registry.npmjs.org', PNPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
      PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
    }
    const run = args => execFile('node', ['--import', 'tsx/esm', dshBin, ...args],
      { cwd: dshRoot, env, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
      .then(r => ({ ok: true, out: `${r.stdout}${r.stderr}` }))
      .catch(e => ({ ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message}` }))

    await mkdir(home, { recursive: true })
    await run(['plugin', '--profile', 'web', 'add', `file:${projectRoot}`])
    let added = await run(['plugin', '--profile', 'web', 'add', name])
    let neededBuildApproval = false
    if (!added.ok && added.out.includes('ERR_PNPM_IGNORED_BUILDS')) {
      // Not a broken package: pnpm blocks dependency build scripts by default
      // and that gate is the user's decision, which the README documents. A
      // survey that reports this as "install failed" blames the package for a
      // host policy. Approve it here (a measurement, recorded as such) and say
      // so in the result.
      neededBuildApproval = true
      const blocked = [...added.out.matchAll(/Ignored build scripts: ([^\n]+)/gu)]
        .flatMap(match => match[1].split(',').map(entry => entry.trim().replace(/@[^@]*$/u, '')))
      await writeFile(join(home, 'profiles/web/pnpm-workspace.yaml'),
        `allowBuilds:\n${blocked.map(pkg => `  ${JSON.stringify(pkg)}: true`).join('\n')}\n`)
      added = await run(['plugin', '--profile', 'web', 'add', name])
    }
    if (!added.ok) {
      return { name, verdict: 'install-failed', neededBuildApproval, detail: added.out.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200) }
    }

    // Boot once and read the mount lines. No turn, so no model call.
    const port = 5400 + Math.floor(Math.random() * 400)
    const web = spawn('node', ['--import', 'tsx/esm', dshBin, '--profile', 'web', '--port', String(port)],
      { cwd: dshRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    web.stdout.on('data', c => { log += String(c) })
    web.stderr.on('data', c => { log += String(c) })
    const deadline = Date.now() + 60_000
    while (!/dsh web:|listening|http:\/\//iu.test(log)) {
      if (web.exitCode !== null || Date.now() > deadline) break
      await new Promise(done => setTimeout(done, 400))
    }
    await new Promise(done => setTimeout(done, 2500))
    web.kill('SIGTERM')

    const route = ROUTE.exec(log)
    const served = SERVED_BY_OFFICIAL.exec(log)
    const notServed = NOT_SERVED.exec(log)
    const mounted = /loaded ([^:]+): \d+ tools/u.exec(log)
    const failedToLoad = /failed to mount ([^:]+): every Pi extension entry failed to load/u.exec(log)
    return {
      name,
      ...(neededBuildApproval ? { neededBuildApproval: true } : {}),
      verdict: route !== null ? 'route'
        : served !== null ? 'route-via-official'
        : notServed !== null ? 'not-served'
        : failedToLoad !== null ? 'load-failed'
        : mounted !== null ? 'mounted-no-provider'
        : 'unknown',
      providerId: route?.[1] ?? served?.[1] ?? notServed?.[1],
      ...(notServed === null ? {} : { reason: notServed[2].slice(0, 160) }),
      mountLine: (log.split('\n').find(l => l.includes('[pi2dsh]') && l.includes(name.split('/').pop())) ?? '').trim().slice(0, 160),
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const results = []
for (const name of packages) {
  try {
    const outcome = await probe(name)
    results.push(outcome)
    console.log(`${outcome.verdict.padEnd(20)} ${name}${outcome.detail === undefined ? '' : ` — ${outcome.detail}`}`)
  } catch (error) {
    results.push({ name, verdict: 'error', detail: String(error).slice(0, 200) })
    console.log(`error                ${name} — ${String(error).slice(0, 120)}`)
  }
}

const counts = results.reduce((all, r) => ({ ...all, [r.verdict]: (all[r.verdict] ?? 0) + 1 }), {})
await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  note: 'verdict is what the bridge reported at mount. "route" means the package carries its own transport and its compat reaches the request; it is NOT a claim that a real turn was run against that gateway.',
  counts,
  results,
}, null, 2)}\n`)
console.log(`\n${JSON.stringify(counts)}\n[gateway-transports] → ${outputPath}`)
