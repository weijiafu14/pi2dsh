// Drive the side-conversation example on the WEB surface, work-x shape.
//
//   node docs/posting-kit/capture-side-chat.mjs <out-dir> [--url http://…]
//
// One composer line: `/btw <question>`. The property the example claims —
// the side answer never lands in the main thread — is asserted by the CALLER
// from the session logs (child sessions carry the pi2dsh-sub- id prefix),
// never from page text. This script only drives the flow and takes the
// posting-kit screenshot; the answer presents in the side-chat window (the
// web projects no TUI, so no package modal ever appears).
import { openApp } from './web-drive.mjs'

const QUESTION = '/btw who wrote the novel Dune? name only'

const { page, browser, shot } = await openApp()
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })

// The composer: type the slash line key by key so the suggestion popover sees
// it, then send.
const composer = page.getByRole('textbox').last()
await composer.click()
await composer.pressSequentially(QUESTION, { delay: 14 })
await page.keyboard.press('Enter')

// The answer arrives in the side chat window; give the model turn time to
// complete, then screenshot — the durable assertions live in the logs.
await page.waitForTimeout(45_000)
await shot('00-side-conversation-work-x')

await browser.close()
