import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { parsePiPrintArgs, withPiPrintTransport } from '../src/pi-cli-bridge.js'

const run = promisify(execFile)
const client = fileURLToPath(new URL('../src/pi-cli-client.mjs', import.meta.url))

describe('Pi non-interactive CLI transport', () => {
  it('parses print flags and reads a referenced prompt without dropping extension isolation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-print-test-'))
    try {
      await writeFile(join(directory, 'prompt.md'), 'A durable prompt')
      await writeFile(join(directory, 'extension.ts'), 'export default () => {}')
      const request = await parsePiPrintArgs(['-p', '--no-session', '--no-extensions', '-e', 'extension.ts', '--model', 'provider/model', '--thinking', 'off', '@prompt.md'], directory)
      expect(request).toMatchObject({ noSession: true, noExtensions: true, model: 'provider/model', thinking: 'off' })
      expect(request.extensions).toHaveLength(1)
      expect(request.prompt).toContain('A durable prompt')
      await expect(parsePiPrintArgs(['--interactive'], directory)).rejects.toThrow('unsupported option')
      await expect(parsePiPrintArgs(['-p', '--model'], directory)).rejects.toThrow('needs a value')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('runs the real OS print client through an authenticated execution-scoped socket', async () => {
    let socketPath = ''
    await withPiPrintTransport(async request => {
      expect(request.prompt).toBe('protocol probe')
      return { stdout: 'native child result', code: 0 }
    }, async environment => {
      socketPath = environment.PI2DSH_CLI_SOCKET!
      expect((await stat(socketPath)).mode & 0o777).toBe(0o600)
      const result = await run(process.execPath, [client, '-p', 'protocol probe'], { env: { ...process.env, ...environment } })
      expect(result.stdout.trim()).toBe('native child result')
      expect(result.stderr).not.toContain(environment.PI2DSH_CLI_TOKEN)
    })
    await expect(stat(socketPath)).rejects.toThrow()
  })

  it('rejects a caller without the execution capability before creating a native child', async () => {
    let calls = 0
    await withPiPrintTransport(async () => { calls++; return { stdout: '', code: 0 } }, async environment => {
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(environment.PI2DSH_CLI_SOCKET!)
        let data = ''
        socket.on('connect', () => socket.write(JSON.stringify({ token: 'wrong', cwd: process.cwd(), args: ['-p', 'x'] }) + '\n'))
        socket.on('data', chunk => { data += chunk })
        socket.on('end', () => resolve(data))
        socket.on('error', reject)
      })
      expect(JSON.parse(reply)).toMatchObject({ code: 1, stderr: expect.stringContaining('invalid execution capability') })
    })
    expect(calls).toBe(0)
  })

  it('cancels native work when the watched CLI process is terminated', async () => {
    let announce!: () => void
    const started = new Promise<void>(resolve => { announce = resolve })
    let cancelled = false
    await withPiPrintTransport(async (_request, signal) => {
      announce()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve() }, { once: true }))
      return { stdout: '', code: 130 }
    }, async environment => {
      const child = spawn(process.execPath, [client, '-p', 'cancel probe'], { env: { ...process.env, ...environment }, stdio: 'ignore' })
      const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
      await started
      child.kill('SIGTERM')
      await exited
    })
    expect(cancelled).toBe(true)
  })
})
