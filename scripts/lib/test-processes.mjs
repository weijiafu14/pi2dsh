// Test-only ownership: never target a user's browser, tmux server or process.
import { spawn as nativeSpawn, execFile as nativeExecFile, execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const owned = new Set()
const stopping = new WeakMap()
const socket = `pi2dsh-test-${process.pid}`
let usedTmux = false
let installed = false

export function processGroupHasLiveMembers(output, group) {
  return output.split('\n').some(line => {
    const [pgid, state] = line.trim().split(/\s+/u)
    return Number(pgid) === group && state !== undefined && !state.startsWith('Z')
  })
}

function hasLiveMembers(child) {
  return processGroupHasLiveMembers(execFileSync('ps', ['-axo', 'pgid=,stat='], {
    encoding: 'utf8', timeout: 3000,
  }), child.pid)
}

function signal(child, name) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') child.kill(name)
    else process.kill(-child.pid, name)
  } catch (error) {
    if (error.code === 'ESRCH') return
    // Darwin can report EPERM for a terminating group with only zombies.
    // Verify the OS process table; do NOT suppress EPERM for live members.
    if (error.code === 'EPERM' && process.platform !== 'win32' && !hasLiveMembers(child)) return
    error.message += ` (test group ${child.pid}, ${name})`
    throw error
  }
}

function alive(child) {
  if (!child?.pid) return false
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    if (error.code === 'EPERM' && process.platform !== 'win32') return hasLiveMembers(child)
    throw error
  }
}

export async function stopProcess(child, graceMs = 3000) {
  if (!child) return
  if (stopping.has(child)) return stopping.get(child)
  const task = (async () => {
    signal(child, 'SIGTERM')
    const deadline = Date.now() + graceMs
    while (alive(child) && Date.now() < deadline) await delay(50)
    if (alive(child)) signal(child, 'SIGKILL')
    const killedDeadline = Date.now() + 3000
    while (alive(child) && Date.now() < killedDeadline) await delay(50)
    if (alive(child)) throw new Error(`test process group ${child.pid} did not exit`)
    // A zombie-only group is no longer running, but our direct child must
    // also be reaped by Node before its handle can be considered closed.
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(() => {
          child.removeListener('exit', done)
          reject(new Error(`test child ${child.pid} was not reaped`))
        }, 3000)
        child.once('exit', done)
      })
    }
    owned.delete(child)
  })()
  stopping.set(child, task)
  return task
}

export async function cleanupTestProcesses() {
  // tmux detaches from its launcher. Its private socket, not the user's
  // default server, is the ownership boundary even after a failed scenario.
  if (usedTmux) {
    await new Promise(resolve => nativeExecFile('tmux', ['-L', socket, 'kill-server'], { timeout: 3000 }, resolve))
    usedTmux = false
  }
  const results = await Promise.allSettled([...owned].map(child => stopProcess(child)))
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (errors.length) throw new AggregateError(errors, 'test process cleanup failed')
}

function install() {
  if (installed) return
  installed = true
  let exiting = false
  for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(name, () => {
      if (exiting) return
      exiting = true
      void cleanupTestProcesses().then(() => process.exit(code), error => {
        console.error(error); process.exit(1)
      })
    })
  }
  process.on('beforeExit', () => { if (owned.size || usedTmux) void cleanupTestProcesses() })
  process.on('exit', () => {
    // Explicit process.exit / uncaught exceptions cannot await. Last-resort
    // cleanup is still restricted to groups/socket created by this process.
    for (const child of owned) {
      try { signal(child, 'SIGKILL') } catch (error) { console.error(error) }
    }
    if (usedTmux) {
      try { execFileSync('tmux', ['-L', socket, 'kill-server'], { timeout: 3000, stdio: 'ignore' }) } catch {}
    }
  })
}

function track(child) {
  install()
  owned.add(child)
  child.once('error', () => { if (!child.pid) owned.delete(child) })
  return child
}

export function spawn(command, args, options = {}) {
  const child = track(nativeSpawn(command, args, { ...options, detached: process.platform !== 'win32' }))
  child.once('exit', () => { void stopProcess(child).catch(error => { console.error(error); process.exitCode = 1 }) })
  return child
}

export function execFile(command, args, options = {}) {
  if (command === 'tmux') { usedTmux = true; args = ['-L', socket, ...args] }
  return new Promise((resolve, reject) => {
    // Node execFile does not forward detached to spawn. Use spawn directly
    // so -pid really identifies our group rather than a nonexistent group.
    const child = spawn(command, args, { ...options, timeout: undefined, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = { stdout: [], stderr: [] }
    const sizes = { stdout: 0, stderr: 0 }
    let failure
    let timer
    for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
      sizes[name] += chunk.length
      if (sizes[name] <= (options.maxBuffer ?? 1024 * 1024)) chunks[name].push(chunk)
      else {
        failure ??= Object.assign(new Error(`test command ${name} exceeded maxBuffer`), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
        void stopProcess(child).catch(reject)
      }
    })
    child.once('error', error => { failure = error })
    child.once('close', (code, signalName) => {
      clearTimeout(timer)
      const output = Object.fromEntries(Object.entries(chunks).map(([name, buffers]) => {
        const value = Buffer.concat(buffers)
        return [name, options.encoding === 'buffer' ? value : value.toString(options.encoding ?? 'utf8')]
      }))
      void stopProcess(child).then(() => {
        if (failure || code !== 0) reject(Object.assign(failure ?? new Error(`test command failed (${code ?? signalName}): ${command}\n${output.stderr}`),
          { ...output, code: failure?.code ?? code, signal: signalName }))
        else resolve(output)
      }, reject)
    })
    if (options.timeout > 0) timer = setTimeout(() => {
      failure ??= Object.assign(new Error(`test command timed out after ${options.timeout}ms: ${command}`), { code: 'ETIMEDOUT' })
      void stopProcess(child).catch(reject)
    }, options.timeout)
  })
}
