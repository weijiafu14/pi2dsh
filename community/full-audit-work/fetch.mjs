import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const output = resolve(process.argv[2] ?? 'community/full-audit-work/discussions.json')
const query = `query($cursor:String){repository(owner:"deepseek-ai",name:"deepseek-harness"){discussions(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{number title body url createdAt updatedAt upvoteCount isAnswered answerChosenAt category{name} author{login} comments{totalCount}}}}}`
const discussions = []
let cursor
let totalCount = 0
let page = 0
do {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  if (cursor !== undefined) args.push('-F', `cursor=${cursor}`)
  const { stdout } = await run('gh', args, { maxBuffer: 32 * 1024 * 1024 })
  const connection = JSON.parse(stdout).data.repository.discussions
  discussions.push(...connection.nodes)
  totalCount = connection.totalCount
  cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : undefined
  page += 1
  process.stderr.write(`page ${page}: ${discussions.length}/${totalCount}\n`)
} while (cursor !== undefined)
const unique = [...new Map(discussions.map(item => [item.number, item])).values()].sort((a, b) => a.number - b.number)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), source: 'https://github.com/deepseek-ai/deepseek-harness/discussions', reportedTotalCount: totalCount, fetchedCount: unique.length, discussions: unique }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ reportedTotalCount: totalCount, fetchedCount: unique.length, output })}\n`)
