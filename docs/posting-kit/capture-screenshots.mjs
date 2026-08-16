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
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Either this file's own resolution finds playwright, or PLAYWRIGHT_FROM names
// a project that has it. Anything else is a setup error worth stating plainly.
const from = process.env.PLAYWRIGHT_FROM
const require = createRequire(from === undefined ? import.meta.url : `${resolve(from)}/package.json`)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  throw new Error('capture: playwright not found — set PLAYWRIGHT_FROM to a project that has it (e.g. a DSH checkout)')
}

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}
const positional = process.argv.slice(2).filter((argument, index, all) =>
  !argument.startsWith('--') && !(index > 0 && all[index - 1]?.startsWith('--')))
const outDir = positional[0] ?? 'docs/posting-kit/assets'
const baseUrl = flag('url', 'http://127.0.0.1:5179')
const locale = flag('locale', 'en-US')

// The app localizes its chrome, so the strings the script waits on come from
// the locale it renders in. English is the default: the community posts these
// assets go into are English.
const UI = {
  'en-US': {
    newSession: 'New session', send: 'Send message', running: 'Running', stop: 'Stop',
    children: /\d+ subagents?/u, childIdle: /not running/iu, dismissNotice: 'Continue',
  },
  'zh-CN': {
    newSession: '新建会话', send: '发送消息', running: '运行中', stop: '停止',
    children: /\d+ 个子代理/u, childIdle: /当前未运行/u, dismissNotice: '继续',
  },
}[locale]
if (UI === undefined) throw new Error(`capture: no UI strings for locale ${locale} (known: en-US, zh-CN)`)

// The two questions: unrelated on purpose, so a leak into the main thread is
// visible at a glance rather than something a reader has to take on faith.
const MAIN_QUESTION = 'Name three classic sorting algorithms, one line each. No tools.'
const SIDE_QUESTION = '/btw who wrote the novel Dune? name only'
const SIDE_ANSWER = /herbert/iu

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale })
const shot = async name => {
  // Park the pointer away from the chrome so no hover tooltip lands in the asset.
  await page.mouse.move(700, 620)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  console.log(`captured ${name}.png`)
}

/**
 * Send one composer line and wait for the turn to settle.
 * @param text - what to type into the composer.
 */
async function send(text) {
  const composer = page.getByRole('textbox').last()
  await composer.click()
  // Type key by key (a slash command needs the suggestion popover to see each
  // keystroke), but only once the composer really holds focus — otherwise the
  // first characters go nowhere.
  await composer.focus()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('role') === 'textbox'
      || document.activeElement?.tagName === 'TEXTAREA',
    undefined,
    { timeout: 10_000 },
  )
  await composer.pressSequentially(text, { delay: 12 })
  // Typing into a composer that was still settling silently drops the first
  // characters, which only shows up as a subtly wrong screenshot. Check.
  const typed = await composer.inputValue().catch(() => text)
  if (typed !== text) {
    // Say WHAT was in the way. An empty composer after focusing means
    // something is still covering it — a first-run dialog on a fresh
    // DSH_HOME, most often — and the bare mismatch names none of that.
    const state = await page.evaluate(() => ({
      active: document.activeElement?.tagName ?? null,
      dialogs: [...document.querySelectorAll('[role="dialog"], [class*="_mask_"], [class*="modal"]')]
        .map(node => (node.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120))
        .filter(Boolean),
      buttons: [...document.querySelectorAll('button')]
        .map(node => (node.textContent ?? '').replace(/\s+/gu, ' ').trim())
        .filter(Boolean).slice(0, 20),
    })).catch(() => undefined)
    throw new Error(
      `capture: composer holds "${typed}", expected "${text}"`
      + `\n  page state: ${JSON.stringify(state)}`,
    )
  }
  await page.getByRole('button', { name: UI.send }).click()
  // Settled means both kinds of work are done: a model turn (which offers to
  // stop while streaming) and a slash command (which shows a running status
  // line). Neither marker is painted the instant the click lands, so give the
  // UI a beat first — otherwise "no marker yet" reads as "already finished".
  await page.waitForTimeout(1500)
  await page.waitForFunction(
    ({ running, stop }) => {
      const text = document.body.innerText
      return !text.includes(running) && !text.includes(stop)
    },
    { running: UI.running, stop: UI.stop },
    { timeout: 180_000 },
  )
}

// The app keeps a live connection open, so `networkidle` never arrives; the
// composer appearing is the real "ready".
/**
 * Dismiss the testing notice, whose backdrop swallows clicks.
 *
 * Called after EVERY navigation, not once: the notice comes back on reload,
 * and a second copy of it over the composer is invisible in a screenshot —
 * it just makes typing land nowhere, which reads as "the app ignored us".
 * @param page - the page to clear.
 */
async function dismissNotice(page) {
  const notice = page.getByRole('button', { name: UI.dismissNotice })
  // Wait for it rather than probing: `isVisible()` answers immediately, and
  // right after load the notice has not rendered yet — which reads as "no
  // notice" and leaves its backdrop to swallow the next click.
  const shown = await notice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
  if (!shown) return
  await notice.click()
  // Wait for the BACKDROP to go, not the button: the button hides first while
  // the mask lingers through its animation and keeps swallowing clicks.
  await page.waitForFunction(
    () => document.querySelectorAll('[class*="_mask_"]').length === 0,
    undefined,
    { timeout: 20_000 },
  )
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await dismissNotice(page)
// A DSH home that has never been opened also has no WORKSPACE, and until one
// exists the composer accepts nothing — it takes keystrokes and stays empty,
// which used to surface only as a blank composer with no explanation. The
// picker itself is an OS-native directory dialog a browser cannot drive, so
// adopt a directory through the host's own workspace.create RPC, which is
// exactly what the picker calls.
const workspacePath = process.env.CAPTURE_WORKSPACE ?? process.cwd()
const adopted = await page.evaluate(async path => {
  const response = await fetch('/api/workspace.create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'capture-workspace',
      method: 'workspace.create',
      payload: { path },
    }),
  })
  return { status: response.status, body: (await response.text()).slice(0, 300) }
}, workspacePath).catch(error => ({ status: 0, body: String(error) }))
// Always logged: this transport answers 200 for refusals too, wrapping the
// error in the response body, so the status alone says nothing.
console.log(`capture: workspace.create → ${adopted.status} ${adopted.body}`)
await page.reload({ waitUntil: 'domcontentloaded' })
await dismissNotice(page)

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
await send(MAIN_QUESTION)
await send(SIDE_QUESTION)

// The child is registered the moment it starts, so the count alone does not
// mean the side thread has answered. The catalog row's own activity does:
// wait there until it goes idle, then close the popover again.
const catalogButton = page.getByText(UI.children).first()
await catalogButton.waitFor({ timeout: 120_000 })
await catalogButton.click()
const listed = page.getByText(/side conversation/iu).last()
await listed.waitFor({ timeout: 60_000 })
await page.getByText(UI.childIdle).first().waitFor({ timeout: 180_000 })
await page.keyboard.press('Escape')
await listed.waitFor({ state: 'hidden', timeout: 30_000 })

// 1. The main conversation: the side question and its answer are absent, and
//    the only trace is the command's own status line.
const mainText = await page.locator('body').innerText()
if (SIDE_ANSWER.test(mainText)) throw new Error('capture: the side answer leaked into the main conversation')
if (!mainText.includes('btw')) throw new Error('capture: the command status line is missing from the main thread')
await shot('01-side-conversation-main-thread-clean')

// 2. DSH's own subagent catalog, listing the side thread the Pi package started.
await catalogButton.click()
await listed.waitFor({ timeout: 30_000 })
await shot('02-side-conversation-host-catalog')

// 3. Merging back is the user's explicit action: `/btw-inject` is what puts
//    the side thread into the main conversation, and only then. Captured
//    before opening the child, because the app keeps the open conversation in
//    its own state rather than the URL — there is no "go back" to navigate.
await page.keyboard.press('Escape')
await send('/btw-inject')
await page.getByText(SIDE_ANSWER).first().waitFor({ timeout: 120_000 })
await shot('03-side-conversation-injected-on-request')

// 4. The side thread itself: its own view, its own composer, the answer inside it.
await catalogButton.click()
await listed.waitFor({ timeout: 30_000 })
await listed.click()
await page.getByText(SIDE_ANSWER).first().waitFor({ timeout: 60_000 })
await shot('04-side-conversation-child-view')

await browser.close()
console.log(`done — ${outDir}`)
