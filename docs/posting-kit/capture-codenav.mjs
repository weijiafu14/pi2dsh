// Prove code navigation (@ff-labs/pi-fff + pi-lens) on the WEB surface.
//
//   node docs/posting-kit/capture-codenav.mjs <out-dir> [--url http://127.0.0.1:5190]
//
// Same shape as capture-vision.mjs: drive the real app the way a user would —
// the example README's own prompt in the composer — with CAPTURE_WORKSPACE
// pointing at the staged sample project so the session's cwd is the project
// the tools search. The screen check below is deliberately WEAK (a smoke that
// the turn painted something recognisable); the caller asserts the real
// property from the session log, where ffgrep's and lsp_diagnostics' own
// results say what actually ran.
import { openApp } from './web-drive.mjs'

const PROMPT = 'Two tasks in this project: '
  + '1) Use the ffgrep tool to find which file mentions FROSTBITE-7741 and report the file path. '
  + '2) Use the lsp_diagnostics tool on src/ledger.ts and report every error it returns. '
  + 'Do not use bash or any other tool for these two tasks.'

const { page, browser, shot, send, UI } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
await send(PROMPT)

// Weak screen smoke only. "spec.md" is never in the prompt, so it can only be
// painted by a search that found it; the planted error code likewise. The
// authoritative check stays in the caller, on the session log.
const answered = await page.locator('body').innerText()
if (!/spec\.md/u.test(answered) || !/2322|not assignable/iu.test(answered)) {
  throw new Error(
    'capture: the web turn painted neither the found file nor the planted diagnostic.'
    + `\n  last screen text: ${answered.replace(/\s+/gu, ' ').slice(-600)}`,
  )
}
await shot('06-code-navigation-web')

await browser.close()
