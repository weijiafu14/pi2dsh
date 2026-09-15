import { appendFileSync } from 'node:fs'
// Timing fixture only: let the unmodified Pi steer tool run after a real
// child request begins. It does not alter arguments, results, or model output.
export const name = 'pi2dsh-subagent-readiness'
export const inject = ['agents', 'tools']
export function apply(ctx) {
  const record = data => { if (process.env.PI2DSH_READINESS_LOG) appendFileSync(process.env.PI2DSH_READINESS_LOG, JSON.stringify(data) + '\n') }
  record({ stage: 'mounted' })
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'steer_subagent') return next()
    record({ stage: 'enter', agentId: exec.agent?.session?.id })
    const deadline = Date.now() + 45000
    for (;;) {
      exec.signal?.throwIfAborted()
      const ready = ctx.agents.list().some(agent => {
        if (agent.session?.header?.parentSession !== exec.agent?.session?.id) return false
        const session = agent.session
        const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
        return events.some(event => event.type === 'request/header')
      })
      if (ready) { record({ stage: 'release', agentId: exec.agent?.session?.id }); return next() }
      if (Date.now() > deadline) throw new Error('steer timing fixture: no child model request began')
      await new Promise(done => setTimeout(done, 100))
    }
  })
}
