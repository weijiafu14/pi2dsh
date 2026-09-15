// Internal print-mode client. Credentials stay in the native DSH host.
import { createConnection } from 'node:net'
const socket = createConnection(process.env.PI2DSH_CLI_SOCKET)
let input = ''
let complete = false
socket.setEncoding('utf8')
socket.on('connect', () => socket.write(JSON.stringify({ token: process.env.PI2DSH_CLI_TOKEN, args: process.argv.slice(2), cwd: process.cwd() }) + '\n'))
socket.on('data', chunk => {
  input += chunk
  if (!input.includes('\n') || complete) return
  complete = true
  try {
    const reply = JSON.parse(input.slice(0, input.indexOf('\n')))
    if (reply.stdout) process.stdout.write(reply.stdout + '\n')
    if (reply.stderr) process.stderr.write(reply.stderr + '\n')
    process.exitCode = reply.code ?? 1
  } catch (error) {
    process.stderr.write(String(error) + '\n')
    process.exitCode = 1
  }
  socket.end()
})
socket.on('error', error => { process.stderr.write(`pi2dsh CLI: ${error.message}\n`); process.exitCode = 1 })
socket.on('close', () => { if (!complete) process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { socket.destroy(); process.exitCode = 130 })
