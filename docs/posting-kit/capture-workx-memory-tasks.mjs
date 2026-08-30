// Drive the dsh-work-x memory tab + background-tasks dock as a user does.
//
//   node docs/posting-kit/capture-workx-memory-tasks.mjs <out-dir> \
//     --url http://… --codeword X --pin "rule text"
//
// Every waitFor below is itself an assertion (a broken route/command/render
// times this script out and the caller fails); the caller adds the disk-level
// half (STANDING.md content, task snapshot status) from the scratch home.
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

// 2. Open the floating memory window and see the STORE's content (the
// codeword inside the window container can only have come through
// /dsh-x/memory-state — the container renders route data, not chat text).
await page.locator('[data-dsh-x="memory-dot"]').click({ timeout: 30_000 })
const tabRoot = page.locator('[data-dsh-x="memory-tab"]')
await tabRoot.getByText(CODEWORD).first().waitFor({ timeout: 30_000 })

// 3. Pin a standing rule through the tab (round trip: pi-command →
// STANDING.md → /dsh-x/memory-state → the pin list).
await page.locator('[data-dsh-x="memory-pin-input"]').fill(PIN)
await page.locator('[data-dsh-x="memory-pin-add"]').click()
await page.locator('[data-dsh-x="memory-pin"]').getByText(PIN).first().waitFor({ timeout: 30_000 }).catch(async (error) => {
  const note = await page.locator('[data-dsh-x="memory-note"]').textContent().catch(() => '(no note)')
  const window = await page.locator('[data-dsh-x="memory-tab"]').textContent().catch(() => '(no window)')
  console.error(`pin never appeared; note: ${note}\nwindow: ${String(window).slice(0, 600)}`)
  throw error
})
await shot('01-memory-tab')

// Close the window before composing again: its pin input is also a textbox,
// and the composer locator targets the LAST textbox on the page.
await page.locator('[data-dsh-x="memory-tab"]').getByTitle('Close').click()

// 4. Start a long background job; the dock pill must appear on its own.
await send('Use the bg_run tool to start a background shell job named ticker that runs exactly this command: '
  + "sh -c 'for i in $(seq 1 180); do echo tick $i; sleep 1; done'. "
  + 'Confirm the task id in one short sentence. Do not wait for it and do not kill it.')
await page.locator('[data-dsh-x="tasks-pill"]').waitFor({ timeout: 60_000 })
await page.locator('[data-dsh-x="tasks-pill"]').click()
await page.locator('[data-dsh-x="tasks-card"]').first().waitFor({ timeout: 15_000 })

// 5. Live output while the job runs.
await page.locator('[data-dsh-x="tasks-output-toggle"]').first().click()
await page.waitForFunction(() => {
  const box = document.querySelector('[data-dsh-x="tasks-output"]')
  return box !== null && /tick \d+/u.test(box.textContent ?? '')
}, undefined, { timeout: 45_000 })
await shot('02-tasks-dock-live')

// 6. Kill from the dock; the running badge must go away well before the
// job's nominal 180s end (the caller asserts the snapshot on disk).
await page.locator('[data-dsh-x="tasks-kill"]').first().click()
await page.waitForFunction(() => {
  const cards = [...document.querySelectorAll('[data-dsh-x="tasks-card"]')]
  return cards.length > 0 && cards.every(card => !/\brunning\b/u.test(card.textContent ?? ''))
}, undefined, { timeout: 45_000 })
await shot('03-tasks-killed')

// 7. Close the tasks panel (it floats over the memory dot's corner), reopen
// the memory window and unpin; the entry must leave the list (removal round
// trip).
await page.locator('[data-dsh-x="tasks-panel"]').getByTitle('Close').click()
await page.locator('[data-dsh-x="memory-dot"]').click({ timeout: 15_000 })
await page.locator('[data-dsh-x="memory-pin-remove"]').first().waitFor({ timeout: 15_000 })
await page.locator('[data-dsh-x="memory-pin-remove"]').first().click()
await page.waitForFunction(pin => {
  const root = document.querySelector('[data-dsh-x="memory-tab"]')
  const pins = root === null ? [] : [...root.querySelectorAll('[data-dsh-x="memory-pin"]')]
  return pins.every(entry => !(entry.textContent ?? '').includes(pin))
}, PIN, { timeout: 30_000 })

await browser.close()
