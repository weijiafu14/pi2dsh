// Cross-restart reopen probe for the public Pi subagent ABI.
//
// Two TOOLS (headless print mode does not dispatch slash commands), invoked in
// two SEPARATE dsh processes:
//   sub_archive_spawn  { secret, out }
//     spawns a child that reads and memorizes a codeword, then records the
//     child's durable archive identity (session.sessionManager.getSessionFile()).
//   sub_archive_resume { identity, recall }
//     reopens that archive with Pi's own SessionManager.open — the exact shape
//     pi-subagents' tombstone resurrect uses — and asks the child to write the
//     codeword FROM MEMORY. The recall can only succeed if the reopened child
//     really is the same conversation.
import { readFileSync, writeFileSync } from 'node:fs'
import { Type } from 'typebox'
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'

export default function probe(pi: any): void {
  pi.registerTool({
    name: 'sub_archive_spawn',
    label: 'Archive spawn probe',
    description: 'Spawn a memorizing child agent and record its durable archive identity.',
    parameters: Type.Object({
      secret: Type.String({ description: 'Path of the codeword file the child must memorize.' }),
      out: Type.String({ description: 'Path to write the archive identity JSON to.' }),
    }),
    async execute(_toolCallId: string, params: { secret: string, out: string }) {
      const { session } = await createAgentSession({}) as { session: any }
      await session.prompt(
        `Use the read tool to read the file ${params.secret} and memorize the codeword inside. `
        + 'Reply with exactly the single word: memorized. Never write the codeword in any reply.',
      )
      const archive = session.sessionManager?.getSessionFile?.()
      const sessionId = session.sessionManager?.getSessionId?.()
      writeFileSync(params.out, JSON.stringify({ archive, sessionId }))
      return { content: [{ type: 'text', text: `archived ${String(sessionId)}` }], isError: false }
    },
  })
  pi.registerTool({
    name: 'sub_archive_resume',
    label: 'Archive resume probe',
    description: 'Reopen an archived child agent and have it recall the codeword from memory.',
    parameters: Type.Object({
      identity: Type.String({ description: 'Path of the archive identity JSON from sub_archive_spawn.' }),
      recall: Type.String({ description: 'Path the reopened child must write the recalled codeword to.' }),
    }),
    async execute(_toolCallId: string, params: { identity: string, recall: string }) {
      const record = JSON.parse(readFileSync(params.identity, 'utf8')) as { archive: string }
      const manager = SessionManager.open(record.archive)
      const { session } = await createAgentSession({ sessionManager: manager }) as { session: any }
      await session.prompt(
        `Without reading any file, run exactly one bash command that writes the codeword you memorized into ${params.recall}. `
        + 'Then reply done.',
      )
      return { content: [{ type: 'text', text: 'resumed' }], isError: false }
    },
  })
}
