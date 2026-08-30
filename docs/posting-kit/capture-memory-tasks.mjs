// Drive the memory + background-tasks TOOL layer on the WEB surface.
//
//   node docs/posting-kit/capture-memory-tasks.mjs <out-dir> [--url http://…]
//
// Three composer turns across two sessions:
//   session A — save a codename through the plugin's memory_add tool
//   session B — recall it (the codename exists in no user input of B), then
//               start a 60s background job and read its output mid-run
// Every durable assertion lives in the CALLER and reads the session logs;
// this script only drives the flow and takes screenshots.
import { openApp } from './web-drive.mjs'

// Per-run codeword (passed by the caller): a fixed one false-greens the
// recall the moment any earlier run's store is still reachable.
const at = process.argv.indexOf('--codeword')
const CODEWORD = at === -1 ? undefined : process.argv[at + 1]
if (CODEWORD === undefined) throw new Error('capture-memory-tasks: --codeword is required')

const { page, browser, shot } = await openApp()

async function turn(text, settleMs) {
  const composer = page.getByRole('textbox').last()
  await composer.click()
  await composer.pressSequentially(text, { delay: 14 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(settleMs)
}

// Session A: durable save.
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })
await turn(
  `Use the memory_add tool to remember this durable project fact: my project codename is ${CODEWORD}. Confirm in one short sentence.`,
  45_000,
)
await shot('01-memory-save-web')

// Session B: fresh context — recall, then background job with a mid-run read.
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })
await turn(
  'What is my project codename? Use memory_search if needed. Answer with just the codename.',
  45_000,
)
await shot('02-memory-recall-web')
await turn(
  'Use the bg_run tool to start a background shell job named ticker that runs exactly this command: '
  + "sh -c 'for i in $(seq 1 60); do echo tick $i; sleep 1; done'. "
  + 'Immediately after it starts, call the bg_logs tool for that task and show me the raw output lines. '
  + 'Do not wait for the job to finish and do not kill it.',
  55_000,
)
await shot('03-background-tasks-web')

await browser.close()
