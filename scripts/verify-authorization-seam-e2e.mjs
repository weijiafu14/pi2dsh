#!/usr/bin/env node
// Real-machine proof of the DSH authorization-seam projection, on the exact
// stack a user installs — no forks, no mocks:
//
//   - CLI:      @deepseek-ai/dsh@0.1.1-rc.2 (npm, stock; the only line that
//               ships dsh-authorization)
//   - Surfaces: dsh web (server) AND @deepseek-harness-tui/dsh-tui (tmux) —
//               the seam is host-level, both surfaces must see one truth
//   - Engine:   this working tree (or PI2DSH_ENGINE_SPEC)
//   - Plugin:   pi-provider-kimi-code (npm, stock) — the community OAuth
//               provider the subscription-login example names
//
// The stock compositions ship the dsh-authorization PACKAGE without
// composing it (verified against the composed profile dump: 93 entries, no
// authorization), and no stock surface calls begin() yet — the seam today is
// package + conditional hooks (official llm-pi-ai uses
// ctx.inject(['authorization'], …), and so do we). This run composes the
// service exactly the way a user or a future host release would: a profile
// patch naming the CLI tree's own package. Nothing is mocked — the service,
// the credentials store, the engine, and the packages are all real.
//
// What must be true only if the projection works:
//   1. authorization.list() on the REAL host carries our flows —
//      pi2dsh/kimi-coding (community package), the built-in accounts
//      (openai-codex, anthropic, github-copilot), each labelled "(pi2dsh)".
//   2. The official llm-pi-ai catalog flows COEXIST in the same listing
//      (llm-pi-ai/… keys) — scopes are the namespace, nobody stood down.
//   3. begin() on a Pi package's flow runs that package's OWN login through
//      the real service, commits the record witness, lands the credential in
//      the bridge store, and deleteRecord mirrors the sign-out back out.
//      (The package used for 3 is a local fixture whose oauth.login resolves
//      without a human — that login is the package's own contract; a human
//      account cannot be automated and a real one is exercised by /login in
//      the subscription-login acceptance.)
//   4. The same probe passes on BOTH surfaces (web boot and TUI boot).
//
//   node scripts/verify-authorization-seam-e2e.mjs [community/authorization-seam-e2e.json]

import { execFile as execFileCallback, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outPath = resolve(process.argv[2] ?? 'community/authorization-seam-e2e.json')

const DSH_CLI_SPEC = process.env.PI2DSH_DSH_CLI_SPEC ?? '@deepseek-ai/dsh@0.1.1-rc.2'
const TUI_SPEC = process.env.PI2DSH_TUI_SPEC ?? '@deepseek-harness-tui/dsh-tui'
const ENGINE_SPEC = process.env.PI2DSH_ENGINE_SPEC ?? projectRoot
const KIMI_SPEC = 'pi-provider-kimi-code'
const TMUX_SESSION = 'pi2dsh-authz-seam-e2e'

const log = message => console.log(`[authz-seam-e2e] ${message}`)

const startedAt = new Date().toISOString()
const record = async (status, extra) => {
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    startedAt,
    scenario: 'authorization-seam-projection',
    cliSpec: DSH_CLI_SPEC,
    tuiSpec: TUI_SPEC,
    engineSpec: ENGINE_SPEC,
    status,
    ...extra,
  }, null, 2)}\n`)
}

async function waitFor(description, predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await predicate()
    if (result !== undefined && result !== false) return result
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await delay(intervalMs)
  }
}

const root = process.env.PI2DSH_AUTHZ_E2E_ROOT ?? await mkdtemp('/tmp/pi2dsh-authz-e2e.')
const home = join(root, 'dsh-home')
const cliDir = join(root, 'cli')
log(`scratch: ${root}`)

const shimDir = join(root, 'bin')
await mkdir(shimDir, { recursive: true })
await writeFile(join(shimDir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm@11.7.0 "$@"\n')
await chmod(join(shimDir, 'pnpm'), 0o755)

const baseEnv = {
  ...process.env,
  DSH_HOME: home,
  PATH: `${shimDir}:${process.env.PATH ?? ''}`,
  CI: '1',
  NO_COLOR: '1',
  DSH_TELEMETRY_DISABLED: '1',
  PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0',
  npm_config_registry: 'https://registry.npmjs.org',
}

/** The host-side probe: a NORMAL DSH cordis plugin (the kind any user can
 * install) that waits on the real authorization+credentials services, snapshots
 * the flow listing, begins the fixture flow, and writes what it saw. Its
 * cordis.patch.yml also composes the CLI tree's own dsh-authorization —
 * exactly how a user would turn the service on today. */
async function writeProbePackage(dir) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name: 'dsh-authz-probe',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './index.mjs', './package.json': './package.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
  await writeFile(join(dir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: authorization',
    "      name: '@deepseek-ai/dsh-authorization'",
    '    - id: authz-probe',
    '      name: dsh-authz-probe',
    '',
  ].join('\n'))
  await writeFile(join(dir, 'index.mjs'), `
export const name = 'dsh-authz-probe'
export const inject = ['authorization', 'credentials']

export function apply(ctx) {
  const out = process.env.AUTHZ_PROBE_OUT
  if (!out) return
  void (async () => {
    const report = { startedAt: new Date().toISOString() }
    try {
      const expected = (process.env.AUTHZ_PROBE_EXPECT ?? '').split(',').filter(Boolean)
      const deadline = Date.now() + 120_000
      for (;;) {
        const keys = ctx.authorization.list().map(entry => String(entry.key))
        if (expected.every(key => keys.includes(key))) break
        if (Date.now() > deadline) { report.timedOutWaitingFor = expected.filter(key => !keys.includes(key)); break }
        await new Promise(tick => setTimeout(tick, 1000))
      }
      report.flows = ctx.authorization.list().map(entry => ({
        key: String(entry.key),
        label: entry.label,
        methods: (entry.methods ?? []).map(method => method.id),
      }))
      const beginKey = process.env.AUTHZ_PROBE_BEGIN
      if (beginKey) {
        const target = ctx.authorization.list().map(entry => entry.key).find(key => String(key) === beginKey)
        if (target === undefined) throw new Error('flow ' + beginKey + ' never appeared')
        const outcome = await ctx.authorization.begin({
          key: target,
          interaction: {
            notify: () => {},
            prompt: () => Promise.reject(new Error('probe declines interactive prompts')),
          },
        })
        report.begin = { key: beginKey, status: outcome.status }
        const grant = await ctx.credentials.readRecord(target)
        report.record = grant === undefined ? undefined : { kind: grant.kind }
        const { readFileSync } = await import('node:fs')
        const { join: joinPath } = await import('node:path')
        const authPath = joinPath(process.env.DSH_HOME, 'pi2dsh', 'agent', 'auth.json')
        const providerId = beginKey.split('/').pop()
        try {
          const auth = JSON.parse(readFileSync(authPath, 'utf8'))
          report.credentialLanded = auth[providerId] !== undefined
        } catch { report.credentialLanded = false }
        await ctx.credentials.deleteRecord(target)
        // the sign-out mirror is async; poll the store
        const gone = Date.now() + 20_000
        for (;;) {
          try {
            const auth = JSON.parse(readFileSync(authPath, 'utf8'))
            if (auth[providerId] === undefined) { report.signOutMirrored = true; break }
          } catch { report.signOutMirrored = true; break }
          if (Date.now() > gone) { report.signOutMirrored = false; break }
          await new Promise(tick => setTimeout(tick, 500))
        }
      }
      report.ok = report.timedOutWaitingFor === undefined
    } catch (error) {
      report.ok = false
      report.error = String((error && error.message) || error)
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(out, JSON.stringify(report, null, 2))
  })()
}
`)
}

/** A real Pi package whose provider's oauth.login is the package's own code
 * and needs no human — the shape a provider with a device-free grant takes.
 * This is the ONLY way begin() can complete unattended; a human account's
 * flow is exercised by /login in the subscription-login acceptance. */
async function writeFixturePackage(dir) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name: 'pi-authz-fixture',
    version: '1.0.0',
    pi: { extensions: ['extension.ts'] },
  }, null, 2)}\n`)
  await writeFile(join(dir, 'extension.ts'), [
    'export default function extension(pi: any) {',
    "  pi.registerProvider('authz-fixture', {",
    "    name: 'Authz Fixture',",
    "    baseUrl: 'https://fixture.invalid/v1',",
    '    oauth: {',
    "      name: 'Authz Fixture',",
    "      login: async () => ({ type: 'oauth', access: 'fixture-access-token', refresh: 'fixture-refresh', expires: Date.now() + 3_600_000 }),",
    '    },',
    '  })',
    '}',
    '',
  ].join('\n'))
}

function assertProbeReport(surface, report) {
  const problems = []
  const flows = report.flows ?? []
  const keys = flows.map(flow => flow.key)
  for (const key of ['pi2dsh/kimi-coding', 'pi2dsh/openai-codex', 'pi2dsh/anthropic', 'pi2dsh/github-copilot', 'pi2dsh/authz-fixture']) {
    if (!keys.includes(key)) problems.push(`missing flow ${key}`)
  }
  if (!keys.some(key => key.startsWith('llm-pi-ai/'))) problems.push('no official llm-pi-ai flows in the same listing — coexistence unproven')
  for (const flow of flows) {
    if (flow.key.startsWith('pi2dsh/') && !String(flow.label).endsWith('(pi2dsh)')) {
      problems.push(`flow ${flow.key} label ${JSON.stringify(flow.label)} does not carry the (pi2dsh) marker`)
    }
    if (flow.key.startsWith('pi2dsh/') && !flow.methods.includes('oauth')) {
      problems.push(`flow ${flow.key} offers no oauth method`)
    }
  }
  if (report.begin?.status !== 'authorized') problems.push(`begin() outcome was ${JSON.stringify(report.begin)} — expected authorized`)
  if (report.record?.kind !== 'grant') problems.push(`credential record after begin() was ${JSON.stringify(report.record)} — expected a grant`)
  if (report.credentialLanded !== true) problems.push('the package login did not land its credential in the bridge store')
  if (report.signOutMirrored !== true) problems.push('deleteRecord was not mirrored into the bridge store')
  if (report.ok !== true) problems.push(`probe reported not-ok: ${report.error ?? JSON.stringify(report.timedOutWaitingFor)}`)
  if (problems.length > 0) throw new Error(`${surface}: ${problems.join('; ')}`)
  return {
    flows: keys.sort(),
    officialFlowCount: keys.filter(key => key.startsWith('llm-pi-ai/')).length,
    begin: report.begin,
    credentialLanded: report.credentialLanded,
    signOutMirrored: report.signOutMirrored,
  }
}

let webProcess
try {
  // ---- 1. stock CLI from npm ----------------------------------------------
  const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh')
  if (!existsSync(join(cliDir, 'package.json'))) {
    await mkdir(cliDir, { recursive: true })
    await writeFile(join(cliDir, 'package.json'), `${JSON.stringify({
      name: 'pi2dsh-authz-e2e-cli',
      private: true,
      dependencies: { [DSH_CLI_SPEC.slice(0, DSH_CLI_SPEC.lastIndexOf('@'))]: DSH_CLI_SPEC.slice(DSH_CLI_SPEC.lastIndexOf('@') + 1) },
    }, null, 2)}\n`)
    await writeFile(join(cliDir, 'pnpm-workspace.yaml'), [
      'minimumReleaseAge: 0',
      'allowBuilds:',
      "  '@deepseek-ai/dsh-subprocess-local': true",
      '  node-pty: true',
      '  koffi: true',
      "  '@google/genai': false",
      '  protobufjs: false',
      '',
    ].join('\n'))
    log(`installing stock CLI ${DSH_CLI_SPEC} …`)
    await execFile('corepack', ['pnpm@11.7.0', 'install'], { cwd: cliDir, env: baseEnv, timeout: 300_000 })
  }
  const cliVersion = JSON.parse(await readFile(join(cliDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version

  // ---- 2. probe + fixture packages ---------------------------------------
  const probeDir = join(root, `dsh-authz-probe-${Date.now().toString(36)}`)
  const fixtureDir = join(root, `pi-authz-fixture-${Date.now().toString(36)}`)
  await writeProbePackage(probeDir)
  await writeFixturePackage(fixtureDir)

  // ---- 3. both profiles, the user's own install path ---------------------
  for (const profile of ['web', 'tui']) {
    const profileReady = existsSync(join(home, 'profiles', profile, 'node_modules', 'pi2dsh'))
    if (profileReady) continue
    const specs = profile === 'tui' ? [TUI_SPEC] : []
    log(`installing profile ${profile}: engine + ${KIMI_SPEC} + probe + fixture …`)
    await execFile(dshBin, ['plugin', '--profile', profile, 'add', '-w', ...specs, ENGINE_SPEC, KIMI_SPEC, probeDir, fixtureDir], {
      env: baseEnv, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
    })
  }
  const engineVersion = JSON.parse(await readFile(join(home, 'profiles', 'web', 'node_modules', 'pi2dsh', 'package.json'), 'utf8')).version
  log(`stock proof: cli ${cliVersion}, engine ${engineVersion}`)

  const probeEnv = out => ({
    ...baseEnv,
    AUTHZ_PROBE_OUT: out,
    AUTHZ_PROBE_EXPECT: 'pi2dsh/kimi-coding,pi2dsh/openai-codex,pi2dsh/anthropic,pi2dsh/github-copilot,pi2dsh/authz-fixture',
    AUTHZ_PROBE_BEGIN: 'pi2dsh/authz-fixture',
  })

  // ---- 4. web surface -----------------------------------------------------
  const webOut = join(root, 'probe-web.json')
  await rm(webOut, { force: true })
  const port = 5400 + Math.floor(Math.random() * 200)
  log(`booting dsh web on :${port} …`)
  webProcess = spawn(dshBin, ['web', '--port', String(port)], { env: probeEnv(webOut), stdio: ['ignore', 'pipe', 'pipe'] })
  let webLog = ''
  webProcess.stdout.on('data', chunk => { webLog += String(chunk) })
  webProcess.stderr.on('data', chunk => { webLog += String(chunk) })
  const webReport = await waitFor('web probe report', async () => {
    if (webProcess.exitCode !== null) throw new Error(`dsh web exited ${webProcess.exitCode}:\n${webLog.slice(-2000)}`)
    if (!existsSync(webOut)) return undefined
    return JSON.parse(await readFile(webOut, 'utf8'))
  }, 240_000, 2000)
  const web = assertProbeReport('web', webReport)
  log(`web: ${web.flows.length} flows (${web.officialFlowCount} official), begin authorized, sign-out mirrored`)
  webProcess.kill('SIGTERM')
  webProcess = undefined

  // ---- 5. TUI surface -----------------------------------------------------
  const tuiOut = join(root, 'probe-tui.json')
  await rm(tuiOut, { force: true })
  await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
  const launcher = join(root, 'launch-tui.sh')
  await writeFile(launcher, `#!/bin/sh\nexec "${dshBin}" --profile tui\n`)
  await chmod(launcher, 0o755)
  log('booting the stock TUI in tmux …')
  await execFile('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-x', '180', '-y', '50', '-c', root,
    'env',
    `DSH_HOME=${home}`,
    `PATH=${shimDir}:${process.env.PATH ?? ''}`,
    'NO_COLOR=1',
    'DSH_TELEMETRY_DISABLED=1',
    `AUTHZ_PROBE_OUT=${tuiOut}`,
    'AUTHZ_PROBE_EXPECT=pi2dsh/kimi-coding,pi2dsh/openai-codex,pi2dsh/anthropic,pi2dsh/github-copilot,pi2dsh/authz-fixture',
    'AUTHZ_PROBE_BEGIN=pi2dsh/authz-fixture',
    launcher,
  ], { timeout: 30_000 })
  const tuiReport = await waitFor('tui probe report', async () => {
    if (!existsSync(tuiOut)) return undefined
    return JSON.parse(await readFile(tuiOut, 'utf8'))
  }, 240_000, 2000)
  const tui = assertProbeReport('tui', tuiReport)
  log(`tui: ${tui.flows.length} flows (${tui.officialFlowCount} official), begin authorized, sign-out mirrored`)
  await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})

  await record('passed', { cliVersion, engineVersion, web, tui, scratch: root })
  log(`PASSED — evidence in ${outPath}`)
} catch (error) {
  webProcess?.kill('SIGTERM')
  await execFile('tmux', ['kill-session', '-t', TMUX_SESSION]).catch(() => {})
  await record('failed', { error: String((error && error.message) || error), scratch: root })
  log(`FAILED: ${String((error && error.message) || error)}`)
  process.exit(1)
}
