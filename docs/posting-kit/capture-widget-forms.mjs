// Prove the floating widget forms on a live run. Self-contained: it drives
// its own session and its own lsp_diagnostics turn (sidebar rows carry
// model-written titles and their "now" badge is not a clickable element, so
// navigating into another capture's session is guesswork; one extra model
// turn buys a rig with no cross-capture dependency).
//
//   node docs/posting-kit/capture-widget-forms.mjs <out-dir> --url http://127.0.0.1:5195
//
// Four claims, each with a falsifiable check before its screenshot:
//   1. content-sized widgets rest as a labelled, badged pill (ambient by
//      default — the conversation already narrates the results; the badge is
//      the signal, VS Code-problems style);
//   2. clicking the pill opens the floating card (side-chat chrome) holding
//      the real diagnostic rows;
//   3. at phone width the pill stays fully on screen and clear of the
//      side-chat dot (the 2026-08-28 mobile screenshot showed both failing);
//   4. the new-session screen shows NO widget at all — the dock-strip form
//      leaked the previous session's diagnostics there, the overlay form
//      must not.
import { openApp } from './web-drive.mjs'

const { page, browser, shot, send, UI } = await openApp()

// A session of this capture's own, with the diagnostics widget live in it.
await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
await send('Use the lsp_diagnostics tool on src/ledger.ts, then on src/pricing.ts, and report every error each returns. Do not use bash or any other tool.')

// 1: the collapsed pill, naming owner and badge.
const pill = page.locator('[data-pi2dsh="widget"][data-state="collapsed"]')
await pill.first().waitFor({ timeout: 60_000 })
const pillText = await pill.first().innerText()
if (!/pi-lens/u.test(pillText) || !/\dE/u.test(pillText)) {
  throw new Error(`capture: the collapsed pill does not name owner and badge:\n  ${JSON.stringify(pillText)}`)
}
await shot('07-widget-pill')

// 2: click opens the card with the planted diagnostic.
await pill.first().click()
const openCard = page.locator('[data-pi2dsh="widget"][data-state="open"]')
await openCard.first().waitFor({ timeout: 10_000 })
const cardText = await openCard.first().innerText()
if (!/2322|not assignable/iu.test(cardText)) {
  throw new Error(`capture: the open widget card does not hold the planted diagnostic:\n  ${JSON.stringify(cardText)}`)
}
await shot('08-widget-card-open')
await openCard.first().locator('button[title="Collapse"]').click()
await pill.first().waitFor({ timeout: 10_000 })

// 3: phone width — pill fully on screen, clear of the side-chat dot.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(800)
const pillBox = await pill.first().boundingBox()
if (pillBox === null || pillBox.x < 0 || pillBox.x + pillBox.width > 390) {
  throw new Error(`capture: at 390px the widget pill is off screen: ${JSON.stringify(pillBox)}`)
}
const dotBox = await page.locator('[data-dsh-x="side-chat-dot"]').boundingBox()
if (dotBox !== null && pillBox.y + pillBox.height > dotBox.y) {
  throw new Error(`capture: the pill stack overlaps the side-chat dot: pill ${JSON.stringify(pillBox)}, dot ${JSON.stringify(dotBox)}`)
}
await shot('09-widget-mobile')
await page.setViewportSize({ width: 1280, height: 860 })

// 5: the sidebar Problems tab — the volume home. It mirrors each package's
// own diagnostics widget in full (pi-lens keeps its widget on the LATEST
// run — package policy, honestly mirrored, not our aggregation), so the
// claim is: the latest run's file with BOTH its rows, which the one-row
// corner card never had to carry.
//
// Opening it is two host gestures, probed on the live shell (2026-08-28):
// the workbench opens from the header's "Expand sidebar" toggle, and the
// registered tab first appears as a pane card in the workbench's picker —
// which can sit below the fold, so the card is clicked at the DOM (the
// button is real and user-reachable by scrolling; only Playwright's
// stability gate balks at the off-fold position).
const expand = page.getByRole('button', { name: 'Expand sidebar' })
if (await expand.count() > 0) await expand.first().click({ timeout: 15_000 })
await page.waitForTimeout(800)
if (await page.locator('[data-dsh-x="problems-tab"]').count() === 0) {
  const clicked = await page.evaluate(() => {
    const span = [...document.querySelectorAll('span')].find(node => node.textContent === 'Problems' && node.closest('button') !== null)
    if (span === undefined) return false
    span.closest('button').click()
    return true
  })
  if (!clicked) throw new Error('capture: no Problems pane card or tab handle found after expanding the sidebar')
}
const tab = page.locator('[data-dsh-x="problems-tab"]')
await tab.first().waitFor({ timeout: 15_000 })
const tabDeadline = Date.now() + 30_000
for (;;) {
  const text = await tab.first().innerText()
  if (/pricing\.ts/u.test(text) && /L14:9/u.test(text) && /L17:14/u.test(text) && /2322/u.test(text)) break
  if (Date.now() > tabDeadline) {
    throw new Error(`capture: the Problems tab does not list the latest run's rows:\n  ${JSON.stringify(text)}`)
  }
  await page.waitForTimeout(1000)
}
await shot('11-problems-tab')

// 4: a fresh new-session screen carries none of it.
await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 30_000 })
await page.waitForTimeout(2500)
const leaked = await page.locator('[data-pi2dsh="widget"]').count()
const bodyText = await page.evaluate(() => document.body.innerText)
if (leaked > 0 || /typescript:2322/u.test(bodyText)) {
  throw new Error(`capture: the new-session screen still shows widget content (count ${leaked})`)
}
await shot('10-new-session-clean')

await browser.close()
