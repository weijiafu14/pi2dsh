// The browser plumbing both capture scripts need, in one place.
//
// It is separated for one reason: every hard-won detail in here (the testing
// notice that returns on reload, the composer that silently drops keystrokes
// until a workspace exists, the settle rule that covers both a model turn and
// a slash command) was paid for once, and a second copy would have to pay for
// it again. Nothing here is specific to a scenario — the scenario lives in the
// script that calls `openApp`.
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

/**
 * Launch a browser, open the DSH web app, and hand back the two verbs a
 * scenario needs.
 * @returns page, browser, `shot(name)` and `send(text)`, plus the UI strings.
 */
export async function openApp() {
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
    // characters, which only shows up as a subtly wrong screenshot. Check —
    // and retype once, because a composer that swallowed the opening keystrokes
    // while mounting accepts the whole line on the second pass. A mismatch that
    // survives a clean retype is a real problem and still throws.
    // The composer is a <textarea> on rc lines and a Lexical contenteditable
    // on the 0.1.2 line; inputValue() throws on the latter, so fall back to
    // the element's text. Trim: contenteditable renders a trailing newline.
    const readComposer = () => composer.inputValue().catch(() =>
      composer.evaluate(node => (node.innerText ?? node.textContent ?? '').replace(/\u00a0/gu, ' ')).catch(() => text))
    const matches = value => value === text || value.trim() === text.trim()
    let typed = await readComposer()
    if (!matches(typed)) {
      await composer.fill('')
      await composer.pressSequentially(text, { delay: 12 })
      typed = await readComposer()
    }
    if (!matches(typed)) {
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

  return { page, browser, shot, send, UI, outDir }
}
