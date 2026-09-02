#!/usr/bin/env node
// pi-code (Claude Code configuration for Pi) on headless DSH, user path only:
// fresh DSH_HOME, `dsh plugin add` of the engine and the real npm package, a
// project shipping a `.claude/` tree, real model turns. Assertions read the
// session log, never page or stdout text:
//   settings.json env  → the bash tool's own result carries the codeword
//   PreToolUse hook    → the hook's marker file exists
//   CLAUDE.md @import  → the imported codeword sits in request/header.system
//                        (a model that `read`s the file by hand is a false green)
//   .claude/skills     → the skill description is in DSH's skill-catalog message
// Harness property: pi-code treats a repository with .claude/ as untrusted until
// the user says yes; headless has no dialog and fails closed (same on Pi), so
// the decision an interactive "Trust this project?" Yes would store is seeded
// into the package-visible trust store. The web scenario answers the real
// dialog instead (scripts/verify-pi-code-web-e2e.mjs).
//
// Usage: DEEPSEEK_API_KEY=… PI2DSH_DSH_BIN=<stock dsh> PI2DSH_DSH_CWD=<its dir> \
//        node scripts/verify-pi-code-headless-e2e.mjs [out.json]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createE2eHarness } from './lib/e2e-harness.mjs'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const directDshBin = resolve(process.env.PI2DSH_DSH_BIN)
const dshCwd = resolve(process.env.PI2DSH_DSH_CWD)
const { makeHome, useJsonlSessions } = createE2eHarness({ dshRoot: dshCwd, directDshBin, dshBin: directDshBin, dshCwd })
assert(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY required')
const out = resolve(process.argv[2] ?? 'community/pi-code-headless-e2e.json')

const scratch = await realpath(await mkdtemp(join(tmpdir(), 'pi2dsh-picode-')))
const { home, env, runDsh } = await makeHome(scratch)
const t0 = Date.now()
await runDsh(['plugin', '--profile', 'headless', 'add', process.env.PI2DSH_ENGINE_SPEC ?? `file:${projectRoot}`])
await runDsh(['plugin', '--profile', 'headless', 'add', process.env.PI_CODE_SPEC ?? 'pi-code'])
await useJsonlSessions(home, 'headless')
console.log(`[pi-code-headless] installed in ${Math.round((Date.now() - t0) / 1000)}s`)
const installed = JSON.parse(await readFile(join(home, 'profiles/headless/node_modules/pi-code/package.json'), 'utf8'))
console.log(`[pi-code-headless] pi-code@${installed.version}`)

// Probe project with a .claude tree. Each codeword lives ONLY where the feature under test reads it.
const CW = () => Math.floor(1000 + Math.random() * 9000)
const ENV_CW = `ENVPROBE-${CW()}`, IMPORT_CW = `IMPORTPROBE-${CW()}`, HOOK_MARK = join(scratch, `hook-fired-${CW()}`)
const project = join(scratch, 'project')
await mkdir(join(project, '.claude', 'commands'), { recursive: true })
await mkdir(join(project, '.claude', 'skills', 'demo-skill'), { recursive: true })
await mkdir(join(project, '.claude', 'rules'), { recursive: true })
await writeFile(join(project, '.git'), '') // ROOT marker so pi-code's upward walk stops here
await writeFile(join(project, 'CLAUDE.md'), '# Probe project\n\n@notes/imported.md\n')
await mkdir(join(project, 'notes'), { recursive: true })
await writeFile(join(project, 'notes', 'imported.md'), `The secret import codeword is ${IMPORT_CW}. When asked for the import codeword, reply with it verbatim.\n`)
const STYLE_CW = `STYLEPROBE-${CW()}`, RULE_CW = `RULEPROBE-${CW()}`, SCOPED_CW = `SCOPEDRULE-${CW()}`, MCP_CW = `MCPPROBE-${CW()}`
await writeFile(join(project, '.claude', 'settings.json'), JSON.stringify({
  env: { PI_CODE_PROBE: ENV_CW },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `touch ${HOOK_MARK}` }] }] },
  // Claude's outputStyle setting selects the active style without the interactive /output-style command.
  outputStyle: 'pirate',
}, null, 2))
// Output style (replaces Claude's coding instructions; on DSH appended, since Pi's base marker is absent).
await mkdir(join(project, '.claude', 'output-styles'), { recursive: true })
await writeFile(join(project, '.claude', 'output-styles', 'pirate.md'), `---\nname: pirate\ndescription: probe style\n---\nAlways end every reply with the word ${STYLE_CW}.\n`)
// Rules: one unscoped (lands in the system prompt), one path-scoped (attached to a matching read).
await writeFile(join(project, '.claude', 'rules', 'general.md'), `The general rule codeword is ${RULE_CW}.\n`)
await writeFile(join(project, '.claude', 'rules', 'src-only.md'), `---\npaths: ["src/**"]\n---\nThe scoped rule codeword is ${SCOPED_CW}.\n`)
await mkdir(join(project, 'src'), { recursive: true })
await writeFile(join(project, 'src', 'probe.ts'), 'export const probe = 1\n')
// .mcp.json → a real MCP stdio server (raw JSON-RPC, no SDK) with one tool, ping.
const mcpServer = join(scratch, 'mcp-probe-server.mjs')
await writeFile(mcpServer, `
import { createInterface } from 'node:readline'
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0.0.1' } } })
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping', description: 'Returns the probe pong', inputSchema: { type: 'object', properties: {} } }] } })
  if (msg.method === 'tools/call') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'PONG-${MCP_CW}' }] } })
  if (msg.method === 'ping') return send({ jsonrpc: '2.0', id: msg.id, result: {} })
  if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } })
})
`)
await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [mcpServer] } } }, null, 2))
// A custom agent for the Task tool (pi-code runs agents by spawning the Pi CLI — a known gap, probed for its failure shape).
await mkdir(join(project, '.claude', 'agents'), { recursive: true })
await writeFile(join(project, '.claude', 'agents', 'echoer.md'), '---\nname: echoer\ndescription: Echoes the task back\n---\nYou repeat the task verbatim.\n')
await writeFile(join(project, '.claude', 'commands', 'greet.md'), '---\ndescription: greet probe\n---\nReply with exactly the text GREET-COMMAND-OK and nothing else.\n')
await writeFile(join(project, '.claude', 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: A probe skill that explains the demo protocol\n---\nWhen invoked, reply with exactly SKILL-DEMO-OK.\n')

// pi-code (like Pi) treats a repository shipping .claude/ as untrusted until the
// user says yes; headless has no dialog, so it fails closed. Seed the decision the
// way a prior interactive "Trust this project?" Yes would have stored it — in the
// package-visible trust.json under the pi2dsh agent dir (ProjectTrustStore).
if (process.env.PI_CODE_TRUST !== '0') {
  const agentDir = join(home, 'pi2dsh', 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'trust.json'), JSON.stringify({ [project]: true }, null, 2))
}

async function headless(prompt, cwd, done, timeoutMs = 300_000) {
  const child = spawn(directDshBin, ['--profile', 'headless', prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', c => { output += String(c) }); child.stderr.on('data', c => { output += String(c) })
  const deadline = Date.now() + timeoutMs
  const sessionsRoot = join(home, 'sessions')
  const endsBefore = (await (async () => { try { return await recordsOf() } catch { return [] } })()).filter(r => r.type === 'turn/end').length
  const records = recordsOf
  async function recordsOf() {
    if (!existsSync(sessionsRoot)) return []
    const files = []
    const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name === 'session.jsonl') files.push(p) } }
    await walk(sessionsRoot)
    const all = []
    for (const f of files.sort()) all.push(...(await readFile(f, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)))
    return all
  }
  try {
    for (;;) {
      const recs = await records()
      const ends = recs.filter(r => r.type === 'turn/end')
      const end = ends.length > endsBefore ? ends[ends.length - 1] : undefined
      if (end?.data?.reason?.kind === 'completed' && done(recs, output)) { await new Promise(r => setTimeout(r, 500)); child.kill('SIGTERM'); return { output, recs } }
      if (child.exitCode !== null) { const recs2 = await records(); const ends2 = recs2.filter(r => r.type === 'turn/end'); if (ends2.length > endsBefore && ends2[ends2.length - 1]?.data?.reason?.kind === 'completed') return { output, recs: recs2 }; throw new Error(`headless exited early:\n${output.slice(-4000)}`) }
      if (Date.now() > deadline) throw new Error(`headless timeout:\n${output.slice(-4000)}`)
      await new Promise(r => setTimeout(r, 400))
    }
  } finally { if (child.exitCode === null) child.kill('SIGKILL') }
}
const assistantText = recs => recs.filter(r => r.type === 'message/append' || r.type === 'message').map(r => JSON.stringify(r.data ?? r)).join('\n')

const results = {}
// Turn 1: settings env + PreToolUse hook (Bash).
const t1 = await headless(`Run the bash command: echo "PROBE=$PI_CODE_PROBE" and then reply with only the line the command printed.`, project, (recs) => recs.some(r => r.type === 'tool/result'))
const envSeen = t1.recs.some(r => r.type === 'tool/result' && JSON.stringify(r.data?.message?.content ?? '').includes(ENV_CW))
results.settingsEnv = { pass: envSeen, codeword: ENV_CW }
results.preToolUseHook = { pass: existsSync(HOOK_MARK), marker: HOOK_MARK }
console.log(`[pi-code-headless] settings.env → ${envSeen ? 'PASS' : 'FAIL'}; PreToolUse hook → ${existsSync(HOOK_MARK) ? 'PASS' : 'FAIL'}`)
await writeFile(join(scratch, 'turn1.log'), t1.output)

// Turn 2: CLAUDE.md @import resolution (codeword lives only in the imported file).
const t2 = await headless(`What is the secret import codeword from your context files? Reply with the codeword only.`, project, () => true)
const injected = t2.recs.filter(r => (r.type === 'user/message' && r.data?.source?.kind === 'plugin' && JSON.stringify(r.data).includes(IMPORT_CW))
  || (r.type === 'request/header' && String(r.data?.header?.system ?? '').includes(IMPORT_CW)))
const importSeen = injected.length > 0
results.claudeMdImportCarrier = injected.map(r => r.type === 'user/message' ? `user/message(plugin=${r.data.source.plugin})` : 'request/header.system')
results.claudeMdImport = { pass: importSeen, codeword: IMPORT_CW }
console.log(`[pi-code-headless] CLAUDE.md @import → ${importSeen ? 'PASS' : 'FAIL'}`)
await writeFile(join(scratch, 'turn2.log'), t2.output)

// Skills: pi-code discovers .claude/skills through resources_discover; the bridge
// mounts the root into DSH's skills registry, which advertises skills to the model
// in the request (system text or tool schema). Falsifiable: the skill's own
// description string, which lives only in SKILL.md frontmatter.
// DSH advertises skills as a durable session catalog message (a non-user
// user/message from the skill tool plugin), not inside request/header.
const skillCarrier = [...t1.recs, ...t2.recs].filter(r => r.type === 'user/message' && r.data?.source?.kind !== 'user' && JSON.stringify(r.data).includes('A probe skill that explains the demo protocol'))
const skillSeen = skillCarrier.length > 0
results.claudeSkillsCarrier = skillCarrier.map(r => JSON.stringify(r.data.source).slice(0, 120))
results.claudeSkillsDiscovered = { pass: skillSeen }
console.log(`[pi-code-headless] .claude/skills discovery → ${skillSeen ? 'PASS' : 'FAIL'}`)

// Turn 3: output style + unscoped rule (both land in the system prompt) and the
// scoped rule (attached to the read of a matching path).
const t3 = await headless(`Use the read tool to read the file src/probe.ts, then reply with the single word DONE.`, project, (recs) => recs.some(r => r.type === 'tool/result'))
const t3sys = t3.recs.filter(r => r.type === 'request/header').map(r => String(r.data?.header?.system ?? ''))
const styleSeen = t3sys.some(s => s.includes('## Output Style: pirate') && s.includes(STYLE_CW))
const ruleSeen = t3sys.some(s => s.includes(RULE_CW))
const readCalls = new Set(t3.recs.filter(r => r.type === 'tool/call' && r.data?.name === 'read' && String(r.data?.arguments ?? '').includes('src/probe.ts')).map(r => r.data.callId))
const scopedSeen = t3.recs.some(r => r.type === 'tool/result' && readCalls.has(r.data?.message?.source?.callId) && JSON.stringify(r.data?.message?.content ?? '').includes(SCOPED_CW))
results.outputStyle = { pass: styleSeen, codeword: STYLE_CW }
results.rulesUnscoped = { pass: ruleSeen, codeword: RULE_CW }
results.rulesScopedAttach = { pass: scopedSeen, codeword: SCOPED_CW }
console.log(`[pi-code-headless] output style → ${styleSeen ? 'PASS' : 'FAIL'}; unscoped rule → ${ruleSeen ? 'PASS' : 'FAIL'}; scoped rule on read → ${scopedSeen ? 'PASS' : 'FAIL'}`)
await writeFile(join(scratch, 'turn3.log'), t3.output)

// Turn 4: .mcp.json server → tool probe_ping (pi-code's own MCP client owns the transport).
const t4 = await headless(`Call the tool named probe_ping with no arguments and reply with exactly the text it returned.`, project, (recs) => recs.some(r => r.type === 'tool/result'))
const mcpCalls = new Set(t4.recs.filter(r => r.type === 'tool/call' && r.data?.name === 'probe_ping').map(r => r.data.callId))
const mcpSeen = t4.recs.some(r => r.type === 'tool/result' && mcpCalls.has(r.data?.message?.source?.callId) && JSON.stringify(r.data?.message?.content ?? '').includes(`PONG-${MCP_CW}`))
results.mcpJson = { pass: mcpSeen, codeword: MCP_CW }
console.log(`[pi-code-headless] .mcp.json tool → ${mcpSeen ? 'PASS' : 'FAIL'}`)
await writeFile(join(scratch, 'turn4.log'), t4.output)

// Turn 5: .claude/commands via the model-facing slash_command tool (the user path is a web matter).
const t5 = await headless(`Use the slash_command tool to run the command /greet and reply with exactly what the tool returned.`, project, (recs) => recs.some(r => r.type === 'tool/result'))
const slashCalls = new Set(t5.recs.filter(r => r.type === 'tool/call' && r.data?.name === 'slash_command').map(r => r.data.callId))
const slashSeen = t5.recs.some(r => r.type === 'tool/result' && slashCalls.has(r.data?.message?.source?.callId) && JSON.stringify(r.data?.message?.content ?? '').includes('GREET-COMMAND-OK'))
results.commandsViaTool = { pass: slashSeen }
console.log(`[pi-code-headless] .claude/commands (slash_command tool) → ${slashSeen ? 'PASS' : 'FAIL'}`)
await writeFile(join(scratch, 'turn5.log'), t5.output)

// Turn 6: Task tool with a custom agent — pi-code runs agents by spawning the Pi CLI
// (subagent/index.ts getPiInvocation): on DSH that is the host's own bin, so the run
// cannot succeed. Recorded as the failure shape, not as a pass.
const t6 = await headless(`Use the Task tool with subagent_type echoer to run the task "say hello" and reply with its result.`, project, () => true)
const taskResults = t6.recs.filter(r => r.type === 'tool/result' && /task|agent/iu.test(String(t6.recs.find(c => c.type === 'tool/call' && c.data?.callId === r.data?.message?.source?.callId)?.data?.name ?? '')))
results.taskSubagent = { pass: false, expected: 'gap: pi-code spawns the Pi CLI for subagents', observed: taskResults.map(r => JSON.stringify(r.data?.message?.content ?? '').slice(0, 300)) }
console.log(`[pi-code-headless] Task subagent → GAP (${taskResults.length} tool result(s) recorded)`)
await writeFile(join(scratch, 'turn6.log'), t6.output)

// Loader diagnostics from turn 1 output.
const loaderLines = t1.output.split('\n').filter(l => /pi2dsh|pi-code|Error|error/u.test(l)).slice(0, 60)
results.loaderLines = loaderLines
results.scratch = scratch
await writeFile(out, JSON.stringify(results, null, 2))
console.log(loaderLines.join('\n'))
console.log(`[pi-code-headless] evidence → ${out}; scratch kept at ${scratch}`)
