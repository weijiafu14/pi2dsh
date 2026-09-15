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

const { page, browser, shot, send } = await openApp()
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })

// A bare slash command in the modern host's draft can create a hidden session
// without putting its conversation on stage. Verify /btw inside an actual
// conversation, which is the side-chat workflow, and require visible output.
await send('Reply with exactly OK.')

// The composer: type the slash line key by key so the suggestion popover sees
// it, then send.
const composer = page.getByRole('textbox').last()
await composer.click()
await composer.pressSequentially(QUESTION, { delay: 14 })
await page.keyboard.press('Enter')

const panel = page.locator('[data-dsh-x="side-chat"]')
await panel.waitFor({ state: 'visible', timeout: 120_000 })
await panel.getByText(/herbert/iu).last().waitFor({ state: 'visible', timeout: 120_000 })
const panelText = await panel.innerText()
if (panelText.includes('<system-reminder>') || panelText.includes('Instructions from: AGENTS.md')) {
  throw new Error('Host-only context leaked into the side-chat presentation')
}
if ((await page.locator('body').innerText()).includes('ui.custom is not available')) {
  throw new Error('The browser side-chat command incorrectly failed on a terminal-only component')
}
await panel.getByText(/herbert/iu).last().scrollIntoViewIfNeeded()
await shot('00-side-conversation-work-x')

await browser.close()
