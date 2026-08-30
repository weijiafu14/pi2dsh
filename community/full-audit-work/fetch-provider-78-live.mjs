import { execFile as execFileCallback } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const root = resolve('community/full-audit-work')
const final = JSON.parse(await readFile(resolve(root, 'architecture-feasibility-final.json'), 'utf8'))
const workVerdicts = new Set(['e2e_only', 'pi2dsh_adapter_work', 'pi_product_work', 'multi_product_composition'])
const providerProgram = final.programRows.find(row => row.program === 'provider_interoperability')
if (!providerProgram) throw new Error('provider_interoperability program missing')
const candidates = final.items.filter(item => providerProgram.clusters.includes(item.engineeringCluster)
  && workVerdicts.has(item.verdict))
if (candidates.length !== 78) throw new Error(`expected 78 Provider work candidates, got ${candidates.length}`)
const auditByNumber = new Map(candidates.map(item => [item.number, item]))

async function graphql(query) {
  const { stdout } = await execFile('gh', ['api', 'graphql', '-f', `query=${query}`], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const payload = JSON.parse(stdout)
  if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors))
  return payload.data
}

const commentFields = `
  id
  body
  url
  createdAt
  updatedAt
  upvoteCount
  author { login }
  replies(first: 100) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id body url createdAt updatedAt upvoteCount author { login }
    }
  }
`
const discussionFields = `
  id number title body url createdAt updatedAt upvoteCount isAnswered answerChosenAt
  author { login }
  category { name }
  comments(first: 100) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { ${commentFields} }
  }
`

const discussions = []
for (let offset = 0; offset < candidates.length; offset += 10) {
  const batch = candidates.slice(offset, offset + 10)
  const aliases = batch.map((item, index) => `d${index}: discussion(number: ${item.number}) { ${discussionFields} }`).join('\n')
  const data = await graphql(`query { repository(owner: "deepseek-ai", name: "deepseek-harness") { ${aliases} } }`)
  for (const discussion of Object.values(data.repository)) {
    if (!discussion) throw new Error('one Discussion was not returned')
    discussions.push(discussion)
  }
  process.stderr.write(`fetched first page ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}\n`)
}

for (const discussion of discussions) {
  while (discussion.comments.pageInfo.hasNextPage) {
    const cursor = JSON.stringify(discussion.comments.pageInfo.endCursor)
    const data = await graphql(`query {
      repository(owner: "deepseek-ai", name: "deepseek-harness") {
        discussion(number: ${discussion.number}) {
          comments(first: 100, after: ${cursor}) {
            totalCount pageInfo { hasNextPage endCursor }
            nodes { ${commentFields} }
          }
        }
      }
    }`)
    const page = data.repository.discussion.comments
    discussion.comments.nodes.push(...page.nodes)
    discussion.comments.pageInfo = page.pageInfo
  }
  for (const comment of discussion.comments.nodes) {
    while (comment.replies.pageInfo.hasNextPage) {
      const cursor = JSON.stringify(comment.replies.pageInfo.endCursor)
      const data = await graphql(`query {
        node(id: ${JSON.stringify(comment.id)}) {
          ... on DiscussionComment {
            replies(first: 100, after: ${cursor}) {
              totalCount pageInfo { hasNextPage endCursor }
              nodes { id body url createdAt updatedAt upvoteCount author { login } }
            }
          }
        }
      }`)
      const page = data.node.replies
      comment.replies.nodes.push(...page.nodes)
      comment.replies.pageInfo = page.pageInfo
    }
  }
  if (discussion.comments.nodes.length !== discussion.comments.totalCount) {
    throw new Error(`#${discussion.number} comments incomplete: ${discussion.comments.nodes.length}/${discussion.comments.totalCount}`)
  }
  for (const comment of discussion.comments.nodes) {
    if (comment.replies.nodes.length !== comment.replies.totalCount) {
      throw new Error(`#${discussion.number} comment ${comment.id} replies incomplete`)
    }
  }
}

const records = discussions.sort((a, b) => a.number - b.number).map(discussion => ({
  ...discussion,
  comments: discussion.comments.nodes,
  priorAudit: auditByNumber.get(discussion.number),
}))
const output = resolve(root, 'provider-78-live.json')
const temporary = `${output}.tmp`
await writeFile(temporary, `${JSON.stringify({
  schemaVersion: 1,
  fetchedAt: new Date().toISOString(),
  source: 'deepseek-ai/deepseek-harness live GraphQL, complete bodies/comments/replies',
  candidateCount: candidates.length,
  records,
}, null, 2)}\n`)
await rename(temporary, output)
process.stdout.write(`${JSON.stringify({ output, records: records.length, comments: records.reduce((sum, item) => sum + item.comments.length, 0), replies: records.reduce((sum, item) => sum + item.comments.reduce((inner, comment) => inner + comment.replies.nodes.length, 0), 0) })}\n`)
