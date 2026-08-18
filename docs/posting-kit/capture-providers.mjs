// Reproduce the model-account screenshots in `assets/` against a running DSH
// web instance that has the pi2dsh engine installed and one account logged in.
//
//   node docs/posting-kit/capture-providers.mjs <out-dir> [--url http://127.0.0.1:5210]
//
// Playwright is not a dependency of this package; point the script at an
// installation you already have, e.g. the DSH checkout:
//
//   PLAYWRIGHT_FROM=../deepseek-harness/apps/web node docs/posting-kit/capture-providers.mjs out
//
// `send()` is deliberately not used for `/login`: it waits for the turn to
// settle, and a command that opens a question dialog does not settle until
// somebody answers it — the wait would time out on a screen that is exactly
// what we came to photograph. So the composer is driven directly here.
//
// Each shot asserts what it is meant to show rather than trusting the page.
import { openApp } from './web-drive.mjs'

const { page, browser, shot, UI } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })

/**
 * Type one line into the composer and send it, without waiting for a turn.
 * @param text - the composer line.
 */
async function submit(text) {
  const composer = page.getByRole('textbox').last()
  await composer.click()
  await composer.focus()
  await composer.pressSequentially(text, { delay: 12 })
  await page.getByRole('button', { name: UI.send }).click()
}

// 1. The login dialog: DSH's own question dialog, listing the accounts the
//    engine can log in to. Dismissed afterwards — no flow is started.
await submit('/login')
await page.getByRole('radio', { name: 'openai-codex' }).waitFor({ timeout: 120_000 })
const offered = await page.getByRole('radio').count()
if (offered < 2) throw new Error(`capture: the login dialog offered ${offered} account(s); expected the built-in set`)
await shot('10-login-dialog')
await page.getByRole('button', { name: /skip this question|跳过本题/iu }).first().click()

// 2. The model picker after a login: the account's own group beside the routes
//    that were already there. A fresh session first — the dismissed dialog
//    leaves its own outcome line behind, and a screenshot of the picker should
//    show the picker, not the leftovers of getting there.
await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
await page.getByRole('button', { name: /select model|选择模型/iu }).first().click({ timeout: 60_000 })
await page.getByText(/^(Model|模型)$/u).first().click()
await page.getByText(/ChatGPT Plus\/Pro/u).waitFor({ timeout: 30_000 })
await page.getByText(/^GPT-5/u).first().waitFor({ timeout: 30_000 })
await shot('11-model-picker-after-login')

await browser.close()
