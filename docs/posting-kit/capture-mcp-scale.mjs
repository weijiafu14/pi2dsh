// Prove examples/mcp-at-scale on the WEB surface: the discovery prompt runs
// through the browser, and the durable assertions read the session log in the
// caller (verify-examples-e2e). The screen check here is a weak smoke only —
// the marker string appearing in the answer — because page text is never the
// evidence, the mcp TOOL RESULT in the log is.
//
//   node docs/posting-kit/capture-mcp-scale.mjs <out-dir> --url http://127.0.0.1:5191
import { openApp } from './web-drive.mjs'

const PROMPT = 'Use the mcp tool to list the tools of the many-tools server, '
  + 'find the one that returns the launch marker, call it, and report the marker verbatim. '
  + 'Use only the mcp tool.'

const { page, browser, shot, send, UI } = await openApp()

// On timeout, say WHAT the page was showing — a bare locator timeout names
// nothing and forces a blind rerun.
try {
  await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
} catch (error) {
  const state = await page.evaluate(() => ({
    url: location.href,
    buttons: [...document.querySelectorAll('button')].map(b => (b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 25),
    text: document.body.innerText.replace(/\s+/gu, ' ').slice(0, 400),
  })).catch(probeError => ({ probeError: String(probeError) }))
  await shot('12-mcp-at-scale-web-stuck').catch(() => {})
  throw new Error(`capture: no "${UI.newSession}" button; page state: ${JSON.stringify(state)}`, { cause: error })
}
await send(PROMPT)

const deadline = Date.now() + 60_000
for (;;) {
  const seen = await page.evaluate(() => document.body.innerText.includes('LAUNCH-MARKER-7741-ZEBRA'))
  if (seen) break
  if (Date.now() > deadline) throw new Error('capture: the launch marker never appeared in the answer')
  await page.waitForTimeout(1000)
}
await shot('12-mcp-at-scale-web')

await browser.close()
