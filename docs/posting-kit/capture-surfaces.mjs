// Prove examples/presentation-surfaces on the WEB surface.
//
//   node docs/posting-kit/capture-surfaces.mjs <out-dir> [--url http://127.0.0.1:5189]
//
// It drives the example exactly as its README does — one `/surfaces` command —
// and asserts that every seat holds the string the Pi package supplied.
//
// Why these assertions can be trusted: each string is authored by the package
// and appears nowhere else in the app, and each is checked INSIDE its own seat
// (`[data-pi2dsh="…"]`), not in page text. A broken bridge leaves the seat
// absent or empty; it cannot produce "widget: line one" from somewhere else,
// which is the failure mode that let a vision run pass with the bridge dead.
import { openApp } from './web-drive.mjs'

// marker → the strings that seat must hold. Split per seat on purpose: a
// whole-page match would pass even if every line landed in one wrong slot.
const SEATS = [
  ['pills', ['title: demo session', 'status: demo is live']],
  ['header', ['header: built by factory']],
  ['dock', ['widget: line one', 'widget: line two']],
  ['working', ['footer: built by factory', 'working: still thinking', '◐', 'thinking-label: hidden reasoning']],
  ['entries', ['entry(demo-note): rendered by the package itself', 'message(demo-msg): custom message drawn by the package']],
]
const DRAFT = 'composer: written by the package + pasted'

const { page, browser, shot, send, UI } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
// One ordinary turn first: the turn-tail seat attaches to a turn, so with an
// empty session there is nothing for the entry and custom-message renderers to
// hang off — and "no turn yet" would read as "the renderers do not work".
await send('Reply with the single word: ready. No tools.')
await send('/surfaces')

/**
 * Read one seat's text.
 * @param marker - the data-pi2dsh value.
 * @returns the seat's text, or undefined when the seat is not on the page.
 */
const seatText = async marker => {
  const seat = page.locator(`[data-pi2dsh="${marker}"]`)
  return (await seat.count()) === 0 ? undefined : (await seat.first().innerText())
}

// The browser half polls, so the seats appear a beat after the command
// returns. Wait for the whole set rather than sleeping a guessed amount.
const deadline = Date.now() + 60_000
for (;;) {
  const missing = []
  for (const [marker, expected] of SEATS) {
    const text = await seatText(marker)
    if (text === undefined) { missing.push(`${marker} (seat absent)`); continue }
    for (const line of expected) {
      if (!text.includes(line)) missing.push(`${marker}: "${line}"`)
    }
  }
  if (missing.length === 0) break
  if (Date.now() > deadline) {
    const seen = {}
    for (const [marker] of SEATS) seen[marker] = (await seatText(marker))?.replace(/\s+/gu, ' ') ?? null
    throw new Error(
      `capture: the Pi package's chrome never reached its seats.\n  missing: ${missing.join(', ')}`
      + `\n  seats held: ${JSON.stringify(seen)}`,
    )
  }
  await page.waitForTimeout(500)
}
await shot('06-presentation-surfaces')

// The composer: setEditorText + pasteToEditor write through DSH's own
// inputActions.setDraft. Read the input's value, not the page.
const composer = page.getByRole('textbox').last()
const drafted = await page.waitForFunction(
  expected => [...document.querySelectorAll('textarea, [role="textbox"]')]
    .some(node => (node.value ?? node.textContent ?? '').includes(expected)),
  DRAFT,
  { timeout: 30_000 },
).then(() => true).catch(() => false)
if (!drafted) {
  throw new Error(`capture: the package wrote no draft into the composer; it holds "${await composer.inputValue().catch(() => '<unreadable>')}"`)
}
await shot('07-presentation-surfaces-composer')

// The package's own @-mention source, through DSH's input triggers.
await composer.click()
await composer.fill('')
await composer.pressSequentially('@demo', { delay: 30 })
const menu = await page.waitForFunction(
  () => {
    const text = document.body.innerText
    return text.includes('demo-alpha') && text.includes('demo-beta')
  },
  undefined,
  { timeout: 30_000 },
).then(() => true).catch(() => false)
if (!menu) {
  throw new Error('capture: typing "@demo" offered none of the package\'s own mentions,'
    + ' so its autocomplete provider is not in the chain')
}
await shot('08-presentation-surfaces-mentions')

await browser.close()
