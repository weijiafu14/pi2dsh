// dsh-x web smoke: the suite's capabilities really surface in the web
// composer — the command popover offers each bundled package's own command.
//
//   node scripts/dsh-x-web-probe.mjs <out-dir> [--url http://127.0.0.1:5189]
//
// The check types a strict PREFIX of each command ("/pi-mc", never "/pi-mcp")
// and requires the FULL name to appear on screen: the full name can then only
// come from the suggestion popover, i.e. from a registered command — typing
// alone can never satisfy the assertion.
import { openApp } from '../docs/posting-kit/web-drive.mjs'

// Colliding names get a `pi-` prefix ONLY on surfaces where the host really
// owns the name — so each entry probes both spellings and records which one
// this surface mounted.
// Original names FIRST: on the web (no dsh-TUI reserved-name list) every
// suite command should mount under its own Pi name — /mcp, /agents, /btw.
// The pi- spelling is the TUI-collision fallback, probed second so a run
// that only satisfies the fallback is visible in the recorded mount table.
const COMMANDS = [
  { variants: [{ prefix: '/mc', full: 'mcp' }, { prefix: '/pi-mc', full: 'pi-mcp' }], owner: 'pi-mcp-adapter' },
  { variants: [{ prefix: '/agen', full: 'agents' }, { prefix: '/pi-agent', full: 'pi-agents' }], owner: '@tintinweb/pi-subagents' },
  { variants: [{ prefix: '/bt', full: 'btw' }], owner: 'pi-btw' },
]

const { page, browser, shot, send, UI } = await openApp()
await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })

const composer = page.getByRole('textbox').last()
const mounted = {}
for (const command of COMMANDS) {
  let found
  const dumps = []
  for (const variant of command.variants) {
    await composer.click()
    await composer.focus()
    await composer.fill('')
    await composer.pressSequentially(variant.prefix, { delay: 25 })
    // The popover lists each command NAME on its own line (no slash): an
    // exact whole-line match, so "btw-tangent" can never satisfy "btw".
    const ok = await page.waitForFunction(
      expected => (document.body.innerText ?? '').split('\n').some(line => line.trim() === expected),
      variant.full,
      { timeout: 15_000 },
    ).then(() => true).catch(() => false)
    if (ok) {
      found = variant.full
      break
    }
    const body = await page.locator('body').innerText().catch(() => '')
    dumps.push(...body.split('\n').filter(line => /agent|mcp|btw|codex|image/iu.test(line)))
    await composer.fill('')
  }
  if (found === undefined) {
    const body = await page.locator('body').innerText().catch(() => '')
    throw new Error(`dsh-x probe: no spelling of ${command.owner}'s command was offered by the popover (tried ${command.variants.map(v => v.full).join(', ')}); command-ish lines:\n${[...new Set(dumps)].slice(0, 40).join('\n')}\n--- full page text (truncated) ---\n${body.slice(0, 3000)}`)
  }
  mounted[command.owner] = found
  await composer.fill('')
}
await shot('dsh-x-command-popover')
console.log(`[dsh-x-probe] suite commands offered by the composer popover: ${JSON.stringify(mounted)}`)

// ---- The side-chat window: the suite's product face of pi-btw. ----
// Three separately-falsifiable signals, each carried by a DIFFERENT marker so
// no earlier step can satisfy a later assertion:
//   1. an un-saved side answer lands INSIDE the window and NOT in the main
//      conversation (Herbert);
//   2. Inject summarizes the side thread into the main agent;
//   3. a --save question is answered in-window (Arrakis).
// The DURABLE halves of 2 and 3 — the injected context and the saved note in
// the MAIN session — are asserted by the caller from the session log: the
// host renders plugin-sourced messages as a COLLAPSED context-injection row,
// so their text never reaches the DOM and a page assertion would be reading
// the wrong layer. All three need a real model turn, so without a credential
// the section is SKIPPED loudly, never quietly passed.
if (process.env.DEEPSEEK_API_KEY === undefined && process.env.OPENROUTER_API_KEY === undefined) {
  console.log('[dsh-x-probe] side-chat: SKIPPED — no model credential; the side thread needs real turns')
  mounted['side-chat'] = 'skipped: no model credential'
} else {
  await send('Reply with exactly one word: ok')
  await page.locator('[data-dsh-x="side-chat-dot"]').click()
  const win = page.locator('[data-dsh-x="side-chat"]')
  await win.waitFor({ state: 'visible', timeout: 10_000 })

  // 1. Plain side question: answer in-window, main thread untouched.
  await page.locator('[data-dsh-x="side-chat-input"]').fill('Who wrote the novel Dune? Reply with the surname only.')
  await page.locator('[data-dsh-x="side-chat-send"]').click()
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-dsh-x="side-chat"]')
    return w !== null && /Herbert/iu.test(w.textContent ?? '')
  }, undefined, { timeout: 180_000 })
  const leaked = await page.evaluate(() => {
    const clone = document.body.cloneNode(true)
    for (const w of clone.querySelectorAll('[data-dsh-x="side-chat"]')) w.remove()
    return /Herbert/iu.test(clone.textContent ?? '')
  })
  if (leaked) throw new Error('dsh-x probe: the side answer leaked into the main conversation before any save/inject')
  await shot('dsh-x-side-answer')

  // 2. Inject: the window's own confirmation; the durable main-session
  // half is the caller's log assertion.
  await page.locator('[data-dsh-x="side-chat-inject"]').click()
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-dsh-x="side-chat"]')
    return w !== null && /summary injected/iu.test(w.textContent ?? '')
  }, undefined, { timeout: 180_000 })
  await shot('dsh-x-side-injected')

  // 3. --save through the window's toggle: the note lands in the main view.
  await page.locator('[data-dsh-x="side-chat"] input[type="checkbox"]').check()
  await page.locator('[data-dsh-x="side-chat-input"]').fill('What planet is the novel Dune set on? Reply with the planet name only.')
  await page.locator('[data-dsh-x="side-chat-send"]').click()
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-dsh-x="side-chat"]')
    return w !== null && /Arrakis/iu.test(w.textContent ?? '')
  }, undefined, { timeout: 180_000 })
  await shot('dsh-x-side-saved')
  mounted['side-chat'] = 'answer-in-window; inject and save confirmed in-window (durable halves asserted from the session log)'
  console.log('[dsh-x-probe] side-chat: side answers stayed in-window; inject and --save acknowledged')
}
await browser.close()
