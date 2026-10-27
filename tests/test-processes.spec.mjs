import { describe, expect, it } from 'vitest'
import { execFile as nativeExecFile, spawn as nativeSpawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { execFile, spawn, stopProcess, cleanupTestProcesses, processGroupHasLiveMembers } from '../scripts/lib/test-processes.mjs'

const gone = pid => { try { process.kill(pid, 0); return false } catch (e) { if (e.code === 'ESRCH') return true; throw e } }
const branch = `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
console.log(child.pid);setInterval(()=>{},1000);`
const line = child => new Promise((resolve, reject) => {
  child.stdout.once('data', b => resolve(Number(String(b).trim())))
  child.once('error', reject)
})

describe.skipIf(process.platform === 'win32')('E2E process ownership', () => {
  it('does not mistake zombie-only groups for running services, or ignore live members', () => {
    expect(processGroupHasLiveMembers('123 Z\n123 Z+\n999 S', 123)).toBe(false)
    expect(processGroupHasLiveMembers('123 Z\n123 S+\n999 Z', 123)).toBe(true)
    expect(processGroupHasLiveMembers('123 R\n999 S', 123)).toBe(true)
    expect(processGroupHasLiveMembers('999 S', 123)).toBe(false)
  })
  it('reaps a server and its resistant child without touching an unrelated process', async () => {
    const other = nativeSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    const child = spawn(process.execPath, ['-e', branch], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const descendant = await line(child)
      await stopProcess(child, 150)
      expect(gone(child.pid)).toBe(true)
      await expect.poll(() => gone(descendant), { timeout: 3000 }).toBe(true)
      expect(gone(other.pid)).toBe(false)
      await stopProcess(child) // idempotent
    } finally {
      const ended = new Promise(resolve => other.once('exit', resolve))
      other.kill()
      await ended
      await stopProcess(child)
    }
  })

  it('returns normal output and rejects failed commands', async () => {
    expect((await execFile(process.execPath, ['-e', 'console.log("ok")'])).stdout.trim()).toBe('ok')
    await expect(execFile(process.execPath, ['-e', 'process.exit(7)'])).rejects.toMatchObject({ code: 7 })
  })

  it('kills the whole group on timeout, even when descendants hold output pipes', async () => {
    let error
    try { await execFile(process.execPath, ['-e', branch], { timeout: 300 }) } catch (e) { error = e }
    expect(error).toBeDefined()
    await expect.poll(() => gone(Number(error.stdout.trim())), { timeout: 3000 }).toBe(true)
  })

  it('cleans owned processes when the harness receives SIGTERM', async () => {
    const helper = new URL('../scripts/lib/test-processes.mjs', import.meta.url).href
    const harness = nativeSpawn(process.execPath, ['--input-type=module', '-e',
      `import {spawn} from ${JSON.stringify(helper)}; const c=spawn(process.execPath,['-e',${JSON.stringify(branch)}],{stdio:['ignore','pipe','pipe']});c.stdout.pipe(process.stdout);`],
    { stdio: ['ignore', 'pipe', 'pipe'] })
    const descendant = await line(harness)
    const ended = new Promise(resolve => harness.once('exit', resolve))
    harness.kill('SIGTERM')
    expect(await ended).toBe(143)
    await expect.poll(() => gone(descendant), { timeout: 3000 }).toBe(true)
  })

  it('keeps terminal automation on a private tmux server', async () => {
    const socket = `pi2dsh-test-${process.pid}`
    await execFile('tmux', ['new-session', '-d', '-s', 'cleanup-proof', 'sleep 60'])
    await execFile('tmux', ['has-session', '-t', 'cleanup-proof'])
    await cleanupTestProcesses()
    await expect(promisify(nativeExecFile)('tmux', ['-L', socket, 'has-session', '-t', 'cleanup-proof'])).rejects.toBeDefined()
  })

  it('never opens Web regression URLs in the system browser', async () => {
    const source = await readFile(new URL('../scripts/verify-examples-e2e.mjs', import.meta.url), 'utf8')
    const launcher = source.slice(source.indexOf('function spawnWeb'), source.indexOf('const results ='))
    expect(launcher.match(/'--no-open'/g)).toHaveLength(2)
    expect(source).not.toContain("web?.kill('SIGTERM')")
    expect(source).not.toContain("web.kill('SIGTERM')")
  })
})
