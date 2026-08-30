// dsh-x is the pi2dsh engine, carried one dependency-hop away: DSH's loader
// resolves patch-row modules from the PROFILE root, and under pnpm's isolated
// layout only direct profile dependencies are visible there. dsh-x is that
// direct dependency; the engine is dsh-x's own dependency and resolves from
// here. A re-export is the whole bridge — no second engine, no fork.
//
// On top of the engine, the suite serves its OWN product routes under
// /dsh-x/*. They are suite-scoped by design: the data faces below read the
// on-disk state of the suite's exact-pinned member packages (pi-hermes-memory
// memory files, pi-background-tasks task snapshots) — package knowledge that
// belongs in the product that bundles those packages, never in the engine
// core. Reads are read-only over the packages' own authoritative files; every
// WRITE goes through /pi2dsh/pi-command into the packages' own command
// handlers, so no second authority ever exists.
export * from 'pi2dsh'
import { apply as engineApply } from 'pi2dsh'
import { readFile, readdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// pi-hermes-memory's durable entry line: `text <!-- created=…, last=… -->`.
const MEMORY_LINE = /^(.*?)\s*<!--\s*created=([^,>]+),\s*last=([^>]+?)\s*-->\s*$/u

function parseMemoryText(raw) {
  const entries = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const match = MEMORY_LINE.exec(trimmed)
    if (match) entries.push({ text: match[1], created: match[2].trim(), last: match[3].trim() })
    else entries.push({ text: trimmed })
  }
  return entries
}

function agentDirOf() {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'pi2dsh', 'agent')
}

async function readEntries(path) {
  try {
    return parseMemoryText(await readFile(path, 'utf8'))
  } catch {
    return []
  }
}

// STANDING.md is plain lines (bullets allowed, # comments skipped) — the
// package's own parseInstructions semantics, read-only here.
async function readStanding(path) {
  try {
    const raw = await readFile(path, 'utf8')
    const seen = new Set()
    const instructions = []
    for (const line of raw.split('\n')) {
      const text = line.replace(/^\s*[-*]\s+/u, '').replace(/\s+/gu, ' ').trim()
      if (text.length === 0 || text.startsWith('#')) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      instructions.push(text)
    }
    return instructions
  } catch {
    return []
  }
}

async function memoryState() {
  const agentDir = agentDirOf()
  // The package's default global dir is <agentRoot>/pi-hermes-memory/ (its
  // index.ts `defaultGlobalDir`); project memories live under the agent
  // root's projects-memory/. Read-only over both.
  const globalDir = join(agentDir, 'pi-hermes-memory')
  const projects = {}
  for (const name of await readdir(join(agentDir, 'projects-memory')).catch(() => [])) {
    const entries = await readEntries(join(agentDir, 'projects-memory', name, 'MEMORY.md'))
    if (entries.length > 0) projects[name] = entries
  }
  const standing = await readStanding(join(globalDir, 'STANDING.md'))
  return {
    global: await readEntries(join(globalDir, 'MEMORY.md')),
    user: await readEntries(join(globalDir, 'USER.md')),
    standing,
    standingBudget: { entries: standing.length, maxEntries: 20, chars: standing.join('\n').length, maxChars: 2000 },
    projects,
  }
}

async function tailOf(path, bytes = 4096) {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - bytes)
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(size - start), 0, size - start, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    await handle?.close()
  }
}

function pidAlive(pid) {
  if (typeof pid !== 'number') return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// pi-background-tasks persists one JSON snapshot + one output file per task
// under <cwd>/.pi/tasks/<runId>/ (its own durable layout). Snapshots are the
// package's authoritative record; `alive` is a liveness probe over the
// recorded pid, so a run dir left by a crashed host never poses as running.
async function tasksState(cwd, withOutput) {
  const root = join(cwd, '.pi', 'tasks')
  const tasks = []
  for (const runId of await readdir(root).catch(() => [])) {
    const dir = join(root, runId)
    for (const file of await readdir(dir).catch(() => [])) {
      if (!file.endsWith('.json')) continue
      let snapshot
      try {
        snapshot = JSON.parse(await readFile(join(dir, file), 'utf8'))
      } catch {
        continue
      }
      const alive = snapshot.status === 'running' ? pidAlive(snapshot.pid) : false
      tasks.push({
        id: String(snapshot.id ?? file.slice(0, -5)),
        name: snapshot.name,
        command: String(snapshot.command ?? ''),
        status: String(snapshot.status ?? 'unknown'),
        alive,
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
        exitCode: snapshot.exitCode,
        bytesWritten: snapshot.bytesWritten,
        runId,
        output: withOutput === String(snapshot.id ?? '') ? await tailOf(join(dir, `${String(snapshot.id)}.output`)) : undefined,
      })
    }
  }
  tasks.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
  return { cwd, tasks }
}

function readBody(req) {
  return new Promise((settle) => {
    const chunks = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
  })
}

function registerSuiteRoutes(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (scope) => {
    const web = (typeof scope.get === 'function' ? scope.get('webServer') : undefined) ?? scope.webServer
    if (web === undefined || typeof web.register !== 'function') return
    const sessionCwd = (session) => {
      const sessions = (typeof scope.get === 'function' ? scope.get('sessions') : undefined) ?? scope.sessions
      const cwd = sessions?.get?.(session)?.header?.cwd
      return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
    }
    scope.effect(() => web.register({
      kind: 'prefix',
      path: '/dsh-x',
      handler: async (req, res) => {
        const method = String(req.method ?? 'GET')
        const url = new URL(String(req.url ?? '/'), 'http://dsh-x.invalid')
        const json = (status, value) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(value))
        }
        try {
          if (url.pathname === '/dsh-x/memory-state' && (method === 'GET' || method === 'HEAD')) {
            return json(200, await memoryState())
          }
          if (url.pathname === '/dsh-x/tasks-state' && (method === 'GET' || method === 'HEAD')) {
            const cwd = sessionCwd(url.searchParams.get('session') ?? '')
            return json(200, await tasksState(cwd, url.searchParams.get('output') ?? ''))
          }
          // reserved for future suite faces; keep POST parsing in one place
          if (method === 'POST') {
            await readBody(req)
            return json(404, { error: 'unknown dsh-x route' })
          }
          res.writeHead(404)
          res.end()
        } catch (error) {
          json(500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
  })
}

export async function apply(ctx, config = {}) {
  await engineApply(ctx, config)
  registerSuiteRoutes(ctx)
}
