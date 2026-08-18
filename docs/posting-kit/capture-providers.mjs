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
// Two shots, and each asserts what it is meant to show rather than trusting
// the page: the login dialog must actually offer accounts, and the model
// picker must actually carry a group that only a completed login can put there.
import { openApp } from './web-drive.mjs'

const { page, browser, shot, send, UI } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })

// 1. The login dialog: DSH's own question dialog, listing the accounts the
//    engine can log in to. Cancelled afterwards — a real flow is not started.
await send('/login')
const dialogOption = page.getByRole('radio', { name: 'openai-codex' })
await dialogOption.waitFor({ timeout: 60_000 })
const offered = await page.getByRole('radio').count()
if (offered < 2) throw new Error(`capture: the login dialog offered ${offered} account(s); expected the built-in set`)
await shot('10-login-dialog')
await page.getByRole('button', { name: /discard|放弃/iu }).first().click()

// 2. The model picker after a login: the account's own group beside the
//    routes that were already there.
await page.getByRole('button', { name: /select model|选择模型/iu }).first().click({ timeout: 60_000 })
await page.getByText(/model|模型/iu).first().click()
const group = page.getByText(/ChatGPT Plus\/Pro/u)
await group.waitFor({ timeout: 30_000 })
// Only a completed login puts that group in the directory — an empty group
// would still render its label, so require a model row under it too.
const codexModel = page.getByText(/^GPT-5/u).first()
await codexModel.waitFor({ timeout: 30_000 })
await shot('11-model-picker-after-login')

await browser.close()
