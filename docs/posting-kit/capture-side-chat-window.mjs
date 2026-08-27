// Capture the dsh-work-x side-chat WINDOW itself — dot, panel, a real Q/A —
// plus the shell with dsh-better-sidebar composed. Evidence shots, not an
// assertion run: the durable side-conversation assertions live in the
// examples E2E; these pictures answer "what does the product look like".
//
//   node docs/posting-kit/capture-side-chat-window.mjs <out-dir> [--url …]
import { openApp } from './web-drive.mjs'

const { page, browser, shot } = await openApp()
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })
await page.waitForTimeout(1500)

// The persistent recall dot.
const dot = page.locator('[data-dsh-x="side-chat-dot"]')
await dot.waitFor({ timeout: 30_000 })
await shot('20-side-chat-dot')

// Open the window and ask a real question through pi-btw's own handler.
await dot.click()
const panelInput = page.locator('[data-dsh-x="side-chat"] textarea, [data-dsh-x="side-chat"] input[type="text"]').last()
  .or(page.getByPlaceholder(/ask/iu).last())
await panelInput.waitFor({ timeout: 15_000 }).catch(() => {})
const box = (await panelInput.count()) > 0 ? panelInput : page.getByRole('textbox').last()
await box.click()
await box.pressSequentially('who wrote the novel Dune? name only', { delay: 12 })
await page.keyboard.press('Enter')
await page.waitForTimeout(40_000)
await shot('21-side-chat-window-qa')

await browser.close()
