import { execFile as execFileCallback } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const root = resolve('community/full-audit-work')
const liveName = process.argv[2] ?? 'ready-live.json'
const draftName = process.argv[3] ?? 'ready-outreach-drafts.json'
const outputName = process.argv[4] ?? 'ready-outreach-results.json'
const live = JSON.parse(await readFile(resolve(root, liveName), 'utf8'))
const drafts = JSON.parse(await readFile(resolve(root, draftName), 'utf8'))
const liveByNumber = new Map(live.records.map(record => [record.number, record]))

async function graphql(query) {
  const { stdout } = await execFile('gh', ['api', 'graphql', '-f', `query=${query}`], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const payload = JSON.parse(stdout)
  if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors))
  return payload.data
}

const results = []
for (const draft of drafts.drafts) {
  const discussion = liveByNumber.get(draft.number)
  if (!discussion) throw new Error(`#${draft.number} missing from ready-live.json`)
  if (discussion.isAnswered === true) throw new Error(`#${draft.number} gained an Answer before drafting`)
  const alreadyCommented = discussion.comments.some(comment =>
    comment.author?.login === 'weijiafu14'
    || comment.replies.some(reply => reply.author?.login === 'weijiafu14'))
  if (alreadyCommented) throw new Error(`#${draft.number} already has a weijiafu14 comment`)

  const data = await graphql(`mutation {
    addDiscussionComment(input: {
      discussionId: ${JSON.stringify(discussion.id)}
      body: ${JSON.stringify(draft.body)}
    }) {
      comment { id url createdAt author { login } }
    }
  }`)
  const comment = data.addDiscussionComment.comment
  if (comment.author?.login !== 'weijiafu14') throw new Error(`#${draft.number} posted as unexpected author`)
  results.push({ number: draft.number, discussionUrl: discussion.url, ...comment })
  process.stderr.write(`posted #${draft.number}: ${comment.url}\n`)
}

const output = resolve(root, outputName)
const temporary = `${output}.tmp`
await writeFile(temporary, `${JSON.stringify({
  schemaVersion: 1,
  postedAt: new Date().toISOString(),
  source: draftName,
  postedCount: results.length,
  skippedAfterReview: drafts.skippedAfterReview ?? drafts.notClaimed ?? [],
  results,
}, null, 2)}\n`)
await rename(temporary, output)
process.stdout.write(`${JSON.stringify({ output, postedCount: results.length })}\n`)
