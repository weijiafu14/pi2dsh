// Reproduce the side-conversation screenshots in `assets/` against a running
// DSH web instance that has the pi2dsh engine and a Pi package with a side
// thread command installed (pi-btw).
//
//   node docs/posting-kit/capture-screenshots.mjs <out-dir> [--url http://127.0.0.1:5179]
//
// Playwright is not a dependency of this package (nothing in the shipped
// engine needs a browser); point the script at an installation you already
// have, e.g. the DSH checkout:
//
//   PLAYWRIGHT_FROM=../deepseek-harness/apps/web node docs/posting-kit/capture-screenshots.mjs out
//
// What it drives is exactly the user path: a normal main-thread question,
// then `/btw <question>` — and it asserts the property the screenshots are
// meant to show, that the side answer never lands in the main conversation.
import { openApp } from './web-drive.mjs'

// The two questions: unrelated on purpose, so a leak into the main thread is
// visible at a glance rather than something a reader has to take on faith.
const MAIN_QUESTION = 'Name three classic sorting algorithms, one line each. No tools.'
const SIDE_QUESTION = '/btw who wrote the novel Dune? name only'
const SIDE_ANSWER = /herbert/iu

const { page, browser, shot, send, UI, outDir } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
await send(MAIN_QUESTION)
await send(SIDE_QUESTION)

// The web projects no TUI (0.24.0 line, 2026-08-29 product decision): `/btw`
// must present ONLY through the side-chat window — the old projected modal
// ([data-pi2dsh="scene"]) never appears. Assert its absence so a regression
// back to the projection fails this capture instead of styling it over.
if (await page.locator('[data-pi2dsh="scene"]').count() > 0) {
  throw new Error('capture: a projected TUI scene appeared on the web — the no-TUI standard is broken')
}

// The child is registered the moment it starts, so the count alone does not
// mean the side thread has answered. The catalog row's own activity does:
// wait there until it goes idle, then close the popover again.
const catalogButton = page.getByText(UI.children).first()
await catalogButton.waitFor({ timeout: 120_000 })
await catalogButton.click()
// The catalog row is a treeitem whose own click area opens the child. Matching
// the label TEXT instead lands on an inner span that ignores clicks — the shot
// then stays on the main thread while every wait still passes, which is how a
// "child view" screenshot spent weeks showing the parent.
const listed = page.getByRole('treeitem').filter({ hasText: /side conversation/iu }).first()
await listed.waitFor({ timeout: 60_000 })
await page.getByText(UI.childIdle).first().waitFor({ timeout: 180_000 })
await page.keyboard.press('Escape')
await listed.waitFor({ state: 'hidden', timeout: 30_000 })

// 1. The main conversation: the side question and its answer are absent, and
//    the only trace is the command's own status line.
//
//    The panel is part of the page and holds the answer on purpose, so it is
//    subtracted first — the property under test is that the CONVERSATION stays
//    clean, not that the answer is nowhere on screen.
const panel = page.locator('[data-pi2dsh="side-panel"]')
const panelText = async () => (await panel.count()) === 0 ? '' : await panel.innerText()
const conversationText = async () => {
  const whole = await page.locator('body').innerText()
  const inPanel = await panelText()
  return inPanel === '' ? whole : whole.split(inPanel).join('')
}
const mainText = await conversationText()
if (SIDE_ANSWER.test(mainText)) throw new Error('capture: the side answer leaked into the main conversation')
if (!mainText.includes('btw')) throw new Error('capture: the command status line is missing from the main thread')
await shot('01-side-conversation-main-thread-clean')

// 1b. The panel: pi2dsh's own browser half, in the host's frame-wide overlay
//     seat — the shape Pi packages present a side conversation in. The
//     assertion is one only a working panel satisfies: the ANSWER inside the
//     panel while the conversation beneath it still has none.
await panel.waitFor({ timeout: 60_000 })
await page.waitForFunction(
  () => {
    const node = document.querySelector('[data-pi2dsh="side-panel"]')
    return node !== null && /herbert/iu.test(node.textContent ?? '')
  },
  undefined,
  { timeout: 120_000 },
)
if (SIDE_ANSWER.test(await conversationText())) {
  throw new Error('capture: the side answer reached the conversation, not only the panel')
}
await shot('02-side-conversation-panel')

// 3. DSH's own subagent catalog, listing the side thread the Pi package started.
await catalogButton.click()
await listed.waitFor({ timeout: 30_000 })
await shot('03-side-conversation-host-catalog')

// 4. Merging back is the user's explicit action: `/btw-inject` is what puts
//    the side thread into the main conversation, and only then. Captured
//    before opening the child, because the app keeps the open conversation in
//    its own state rather than the URL — there is no "go back" to navigate.
await page.keyboard.press('Escape')
await send('/btw-inject')
await page.getByText(SIDE_ANSWER).first().waitFor({ timeout: 120_000 })
await shot('04-side-conversation-injected-on-request')

// 5. The side thread itself: its own view, its own composer, the answer inside it.
//
//    Waiting for the side answer is NOT enough to prove the click navigated:
//    step 3 just injected that same text into the MAIN thread, so the locator
//    matches there too and the shot passes without going anywhere — which is
//    exactly what it did until this was caught. The main thread's own question
//    is the discriminator: it is present in the main view and absent in the
//    child, so requiring it to be GONE is what makes this a child-view shot.
await catalogButton.click()
await listed.waitFor({ timeout: 30_000 })
await listed.click()
await page.getByText(SIDE_ANSWER).first().waitFor({ timeout: 60_000 })
const childDeadline = Date.now() + 30_000
for (;;) {
  const childText = await page.locator('body').innerText()
  if (!childText.includes(MAIN_QUESTION) && SIDE_ANSWER.test(childText)) break
  if (Date.now() > childDeadline) {
    throw new Error('capture: still on the main conversation after opening the child'
      + ' (the main question is still on screen), so this would not be a child-view shot')
  }
  await page.waitForTimeout(250)
}
await shot('05-side-conversation-child-view')

await browser.close()
console.log(`done — ${outDir}`)
