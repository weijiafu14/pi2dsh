import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = resolve('community/full-audit-work')
const classifications = JSON.parse(await readFile(resolve(root, 'classifications.json'), 'utf8')).classifications
const matches = JSON.parse(await readFile(resolve(root, 'product-matches.json'), 'utf8')).matches
const classificationByNumber = new Map(classifications.map(item => [item.number, item]))
const productSet = new Set([
  'piolium_security_audit', 'fabric_agent_runtime', 'pi_task_pipeline',
  'goal_list_loop_audit', 'hermes_memory_learning', 'pi_lens_code_intelligence',
  'background_tasks_fusion', 'agent_browser_native', 'subagents', 'mcp_adapter',
  'multimodal_imagegen', 'web_access_research', 'remote_voice_im',
  'skills_prompt_migration', 'code_file_tools',
])
const actionable = new Set(['bug', 'feature', 'question', 'documentation'])
const numbers = matches
  .filter(item => item.status !== 'not_fit' && productSet.has(item.product) && actionable.has(classificationByNumber.get(item.number)?.intent))
  .map(item => item.number)
  .sort((a, b) => a - b)

const rows = []
for (let index = 0; index < numbers.length; index += 20) {
  const batch = numbers.slice(index, index + 20)
  const aliases = batch.map(number => `d${number}:discussion(number:${number}){number title url comments(first:100){totalCount nodes{author{login} body createdAt upvoteCount}}}`).join(' ')
  const query = `query{repository(owner:"deepseek-ai",name:"deepseek-harness"){${aliases}}}`
  const { stdout } = await run('gh', ['api', 'graphql', '-f', `query=${query}`], { maxBuffer: 32 * 1024 * 1024 })
  const repository = JSON.parse(stdout).data.repository
  for (const number of batch) {
    const discussion = repository[`d${number}`]
    if (discussion) rows.push(discussion)
  }
  process.stderr.write(`comments ${Math.min(index + batch.length, numbers.length)}/${numbers.length}\n`)
}

const output = resolve(root, 'candidate-comments.json')
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), candidateCount: numbers.length, discussions: rows }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ candidateCount: numbers.length, fetched: rows.length, output })}\n`)
