// A local, per-exec CLI protocol adapter. The OS process carries arguments and
// stdout only; all model/tool work runs in the existing native DSH child seam.
import { createServer, type Socket } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export interface PiPrintRequest {
  cwd: string
  prompt: string
  model?: string
  provider?: string
  thinking?: string
  extensions: string[]
  noExtensions: boolean
  noSession: boolean
  tools?: string[]
  systemPrompt?: string
  appendSystemPrompt?: string
}

export async function parsePiPrintArgs(args: string[], cwd: string): Promise<PiPrintRequest> {
  const parsed: PiPrintRequest = { cwd, prompt: '', extensions: [], noExtensions: false, noSession: false }
  let print = false
  const prompts: string[] = []
  const value = (index: number): string => {
    const found = args[index + 1]
    if (found === undefined) throw new Error(`pi2dsh CLI: ${args[index]} needs a value`)
    return found
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '-p' || arg === '--print') print = true
    else if (arg === '--no-session') parsed.noSession = true
    else if (arg === '--no-extensions') parsed.noExtensions = true
    else if (arg === '--no-tools') parsed.tools = []
    else if (arg === '-e' || arg === '--extension') parsed.extensions.push(await realpath(resolve(cwd, value(i++))))
    else if (arg === '--model') parsed.model = value(i++)
    else if (arg === '--provider') parsed.provider = value(i++)
    else if (arg === '--thinking') parsed.thinking = value(i++)
    else if (arg === '--tools') parsed.tools = value(i++).split(',').filter(Boolean)
    else if (arg === '--system-prompt') parsed.systemPrompt = value(i++)
    else if (arg === '--append-system-prompt') parsed.appendSystemPrompt = value(i++)
    else if (arg === '--mode') {
      if (value(i++) !== 'text') throw new Error('pi2dsh CLI: only non-interactive text output is supported')
    } else if (arg.startsWith('-')) throw new Error(`pi2dsh CLI: unsupported option ${arg}`)
    else if (arg.startsWith('@')) {
      const path = resolve(cwd, arg.slice(1))
      prompts.push(`<file name=${JSON.stringify(path)}>\n${await readFile(path, 'utf8')}\n</file>`)
    } else prompts.push(arg)
  }
  if (!print) throw new Error('pi2dsh CLI: only pi -p/--print is supported; use the DSH surface for interactive work')
  if (prompts.length === 0) throw new Error('pi2dsh CLI: a prompt or @file is required')
  parsed.prompt = prompts.join('\n\n')
  return parsed
}

export async function withPiPrintTransport<T>(
  invoke: (request: PiPrintRequest, signal: AbortSignal) => Promise<{ stdout: string; code: number }>,
  execute: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  // This seat is a local POSIX process adapter, not a replacement Windows CLI.
  if (process.platform === 'win32') return execute({})
  const directory = await mkdtemp(join(tmpdir(), 'p2cli-'))
  await chmod(directory, 0o700)
  const socketPath = join(directory, 's')
  const token = randomBytes(32).toString('hex')
  const sockets = new Set<Socket>()
  const work = new Set<Promise<void>>()
  const controllers = new Set<AbortController>()
  const server = createServer(socket => {
    sockets.add(socket)
    const controller = new AbortController()
    controllers.add(controller)
    let input = ''
    let claimed = false
    let finished = false
    socket.setEncoding('utf8')
    socket.on('error', () => controller.abort())
    socket.on('close', () => {
      sockets.delete(socket)
      controllers.delete(controller)
      if (!finished) controller.abort(new Error('Pi print subprocess disconnected'))
    })
    socket.on('data', chunk => {
      if (claimed) return
      input += chunk
      if (input.length > 4 * 1024 * 1024) { socket.destroy(); return }
      if (!input.includes('\n')) return
      claimed = true
      const task = (async () => {
        try {
          const request = JSON.parse(input.slice(0, input.indexOf('\n'))) as { token?: unknown; args?: unknown; cwd?: unknown }
          const supplied = typeof request.token === 'string' ? Buffer.from(request.token) : Buffer.alloc(0)
          const expected = Buffer.from(token)
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('pi2dsh CLI: invalid execution capability')
          if (!Array.isArray(request.args) || request.args.some(arg => typeof arg !== 'string') || typeof request.cwd !== 'string') throw new Error('pi2dsh CLI: invalid request')
          const parsed = await parsePiPrintArgs(request.args as string[], request.cwd)
          controller.signal.throwIfAborted()
          const result = await invoke(parsed, controller.signal)
          finished = true
          socket.end(`${JSON.stringify(result)}\n`)
        } catch (error) {
          finished = true
          console.warn('[pi2dsh CLI]', error instanceof Error ? error.message : String(error))
          socket.end(`${JSON.stringify({ code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) })}\n`)
        }
      })()
      work.add(task)
      void task.finally(() => work.delete(task))
    })
  })
  try {
    await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(socketPath, resolveListen) })
    await chmod(socketPath, 0o600)
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
    const client = fileURLToPath(new URL('./pi-cli-client.mjs', import.meta.url))
    await writeFile(join(directory, 'pi'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(client)} "$@"\n`, { mode: 0o700 })
    return await execute({ PATH: `${directory}:${process.env.PATH ?? ''}`, PI2DSH_CLI_SOCKET: socketPath, PI2DSH_CLI_TOKEN: token })
  } finally {
    for (const controller of controllers) controller.abort(new Error('Pi exec completed'))
    for (const socket of sockets) socket.destroy()
    await Promise.allSettled(work)
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    await rm(directory, { recursive: true, force: true })
  }
}
