// Prove examples/presentation-surfaces on the WEB surface, with a REAL plugin.
//
//   node docs/posting-kit/capture-surfaces.mjs <out-dir> [--url http://127.0.0.1:5189]
//
// The plugin is pi-powerline-footer, unmodified from npm. It draws a terminal
// status line — model, thinking level, project, context usage — through Pi's
// setWidget, and this asserts that line reaches DSH's own widget dock.
//
// It deliberately does NOT use a package we wrote. A demo package drives the
// surfaces we thought to drive, in the shapes we thought to use; this one emits
// raw ANSI colour, which is how the seats were found rendering escape codes as
// visible text. The example's plugin list is measured the same way — see
// community/surface-usage.json.
import { openApp } from './web-drive.mjs'

// The plugin's own vocabulary. None of these strings exist anywhere else in the
// app, so the dock holding them means the Pi package drew there.
const OWN_MARKS = [/think:/u, /\d+(?:\.\d+)?[KM]?\s*\(\d/u]
const ESC = ''

const { page, browser, shot, send, UI } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })

// `/powerline` shares its prefix with `/powerline-perf`, so Send stays disabled
// until one is PICKED from the suggestion popover — the documented gesture, and
// the reason a straight type-and-click hangs here.
const composer = page.getByRole('textbox').last()
await composer.click()
await composer.pressSequentially('/powerline', { delay: 25 })
await page.waitForTimeout(800)
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
const sendButton = page.getByRole('button', { name: UI.send })
if (await sendButton.isEnabled().catch(() => false)) await sendButton.click({ timeout: 30_000 })
else await page.keyboard.press('Enter')

const dock = page.locator('[data-pi2dsh="dock"]')
const deadline = Date.now() + 90_000
for (;;) {
  const text = (await dock.count()) === 0 ? undefined : await dock.first().innerText()
  if (text !== undefined && OWN_MARKS.every(mark => mark.test(text))) {
    // The ANSI check, and the reason it is here rather than in a unit test: the
    // package emits real SGR codes, and a seat that shows them prints visible
    // garbage. The unit tests cover the parser; this covers the seat.
    if (text.includes(ESC) || /\[\d+(?:;\d+)*m/u.test(text)) {
      throw new Error(`capture: the dock is showing raw ANSI escapes rather than colour:\n  ${JSON.stringify(text)}`)
    }
    break
  }
  if (Date.now() > deadline) {
    throw new Error(
      'capture: the Pi package\'s status line never reached the widget dock.'
      + `\n  dock held: ${JSON.stringify(text ?? null)}`,
    )
  }
  await page.waitForTimeout(1000)
}
await shot('06-presentation-surfaces')

await browser.close()
