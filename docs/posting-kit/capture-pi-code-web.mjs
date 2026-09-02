// Drive pi-code's Claude-config story in the DSH web app.
//
//   node docs/posting-kit/capture-pi-code-web.mjs <out-dir> \
//     --url http://… --env-codeword X --import-codeword Y
//
// The workspace (CAPTURE_WORKSPACE) ships a .claude/ tree, which pi-code
// treats as untrusted until the user says yes: the first session raises its
// "Trust this project?" question through DSH's native user-questions dialog.
// This script answers it, sends the two probe prompts, and leaves the
// evidence to the harness, which reads the session log — the screenshots are
// for human eyes (the question dialog, and the answered conversation).
import { openApp } from './web-drive.mjs'

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}
const ENV_CW = flag('env-codeword')
const IMPORT_CW = flag('import-codeword')
if (ENV_CW === undefined || IMPORT_CW === undefined) throw new Error('capture-pi-code-web: --env-codeword and --import-codeword are required')

const { page, browser, shot, send, UI } = await openApp()
page.on('pageerror', error => console.error('page exception:', String(error).slice(0, 400)))
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })

/** Type and send without waiting for the turn: the trust question may block it. */
async function sendNoWait(text) {
  const composer = page.getByRole('textbox').last()
  await composer.click()
  await composer.focus()
  await composer.pressSequentially(text, { delay: 12 })
  await page.getByRole('button', { name: UI.send }).click()
}
const settled = async () => {
  await page.waitForTimeout(1500)
  await page.waitForFunction(
    ({ running, stop }) => !document.body.innerText.includes(running) && !document.body.innerText.includes(stop),
    { running: UI.running, stop: UI.stop },
    { timeout: 240_000 },
  )
}
const dumpButtons = () => page.evaluate(() => [...document.querySelectorAll('button')]
  .map(node => (node.textContent ?? '').replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, 40))

// The trust question is pi-code's session_start work. rc lines create the
// session on "New session", so the dialog is already up before any typing
// (and its backdrop swallows keystrokes); the 0.1.2 line creates the session
// on the first message, so the dialog follows the send. Handle both: look for
// the dialog first, else send and then look for it.
// DSH renders the question as a native card in the conversation: the
// options are selectable rows ("1 Yes" / "2 No"), plus a free-text field,
// "Skip this question" and "Submit". Answering = select the Yes row, Submit.
const answerTrust = async (waitMs) => {
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    const asked = await page.evaluate(() => /trust this project\?/iu.test(document.body.innerText))
    if (asked) {
      await shot('01-trust-question')
      const yesRow = page.getByRole('radio', { name: /^yes$/iu })
      if (await yesRow.count() > 0) await yesRow.first().click()
      else await page.getByText('Yes', { exact: true }).last().click()
      await page.getByRole('button', { name: /^submit$/iu }).click()
      // The card leaves the conversation once the answer is committed.
      await page.waitForFunction(() => !/trust this project\?/iu.test(document.body.innerText), undefined, { timeout: 15_000 })
      await page.waitForTimeout(800)
      return true
    }
    await page.waitForTimeout(400)
  }
  return false
}
const ENV_PROMPT = 'Run the bash command: echo "PROBE=$PI_CODE_PROBE" and then reply with only the line the command printed.'
try {
  let answered = await answerTrust(15_000)
  if (answered) {
    await send(ENV_PROMPT)
  } else {
    await sendNoWait(ENV_PROMPT)
    answered = await answerTrust(60_000)
    if (!answered) {
      console.error('no trust question appeared; buttons:', JSON.stringify(await dumpButtons()))
      throw new Error('capture-pi-code-web: the "Trust this project?" question never appeared')
    }
    await settled()
  }
} catch (error) {
  await shot('zz-failure').catch(() => {})
  throw error
}
await shot('02-env-answered')

// Turn 2: CLAUDE.md @import (the codeword lives only in the imported file).
await sendNoWait('What is the secret import codeword from your context files? Reply with the codeword only.')
await settled()
await shot('03-import-answered')
console.log('[capture-pi-code-web] done')
await browser.close()
