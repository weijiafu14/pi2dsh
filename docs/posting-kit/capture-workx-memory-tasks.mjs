// Drive the dsh-work-x Memory settings page + tasks chip as a user does.
//
//   node docs/posting-kit/capture-workx-memory-tasks.mjs <out-dir> \
//     --url http://… --codeword X --pin "rule text"
//
// The product shape under test (2026-08-30 design): NO floating circles
// beyond the side-chat dot. Memory lives in Settings → Memory; the tasks
// entry is a clickable chip in the host's composer status row, present only
// while tasks exist. Every waitFor below is itself an assertion; the caller
// adds the disk-level half from the scratch home.
import { openApp } from './web-drive.mjs'

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}
const CODEWORD = flag('codeword')
const PIN = flag('pin')
if (CODEWORD === undefined || PIN === undefined) throw new Error('capture-workx-memory-tasks: --codeword and --pin are required')

const { page, browser, shot, send } = await openApp()
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })

// 1. The model writes a durable memory through the package's own tool.
await send(`Use the memory_add tool to remember this durable project fact: my project codename is ${CODEWORD}. Confirm in one short sentence.`)

// 2. Start a long background job; the chip must appear in the composer's
// status row on its own.
await send('Use the bg_run tool to start a background shell job named ticker that runs exactly this command: '
  + "sh -c 'for i in $(seq 1 180); do echo tick $i; sleep 1; done'. "
  + 'Confirm the task id in one short sentence. Do not wait for it and do not kill it.')
await page.locator('[data-dsh-x="tasks-chip"]').waitFor({ timeout: 60_000 })
await page.locator('[data-dsh-x="tasks-chip"]').click()
await page.locator('[data-dsh-x="tasks-card"]').first().waitFor({ timeout: 15_000 })

// 3. Live output while the job runs, then kill from the panel.
await page.locator('[data-dsh-x="tasks-output-toggle"]').first().click()
await page.waitForFunction(() => {
  const box = document.querySelector('[data-dsh-x="tasks-output"]')
  return box !== null && /tick \d+/u.test(box.textContent ?? '')
}, undefined, { timeout: 45_000 })
await shot('02-tasks-chip-live')
await page.locator('[data-dsh-x="tasks-kill"]').first().click()
// The status badge carries its own marker: textContent on the whole card
// concatenates adjacent nodes without whitespace, so a word-boundary match
// there is vacuously false-green (caught 2026-08-30: shot 03 was byte-equal
// to shot 02 because this wait passed instantly).
await page.waitForFunction(() => {
  const badges = [...document.querySelectorAll('[data-dsh-x="tasks-status"]')]
  return badges.length > 0 && badges.every(badge => (badge.textContent ?? '').trim() !== 'running')
}, undefined, { timeout: 45_000 })
await shot('03-tasks-killed')
await page.locator('[data-dsh-x="tasks-panel"]').getByTitle('Close').click()

// 4. Settings → Memory: the STORE's content (the codeword inside the page
// container can only have come through /dsh-x/memory-state), pin a rule,
// see it round-trip, unpin it, see it leave.
await page.getByText('Settings', { exact: true }).first().click({ timeout: 30_000 })
await page.getByText('Memory', { exact: true }).first().click({ timeout: 30_000 })
const memoryRoot = page.locator('[data-dsh-x="memory-tab"]')
await memoryRoot.getByText(CODEWORD).first().waitFor({ timeout: 30_000 })
await page.locator('[data-dsh-x="memory-pin-input"]').fill(PIN)
await page.locator('[data-dsh-x="memory-pin-add"]').click()
await page.locator('[data-dsh-x="memory-pin"]').getByText(PIN).first().waitFor({ timeout: 30_000 }).catch(async (error) => {
  const note = await page.locator('[data-dsh-x="memory-note"]').textContent().catch(() => '(no note)')
  console.error(`pin never appeared; note: ${note}`)
  throw error
})
await shot('01-memory-settings')
await page.locator('[data-dsh-x="memory-pin-remove"]').first().click()
await page.waitForFunction(pin => {
  const root = document.querySelector('[data-dsh-x="memory-tab"]')
  const pins = root === null ? [] : [...root.querySelectorAll('[data-dsh-x="memory-pin"]')]
  return pins.every(entry => !(entry.textContent ?? '').includes(pin))
}, PIN, { timeout: 30_000 })

await browser.close()
