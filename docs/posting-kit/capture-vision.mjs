// Prove the vision bridge on the WEB surface, not just headless.
//
//   node docs/posting-kit/capture-vision.mjs <out-dir> [--url http://127.0.0.1:5188] [--image /abs/path.png]
//
// Same shape as capture-screenshots.mjs: it drives the real app the way a user
// would — one composer line naming an image on disk — and asserts the property
// the example claims, that a text-only chat model answers a question about the
// picture because the Pi package delegated it to a vision route.
//
// Why this exists separately from the headless check: a headless run proves the
// bridge, not the surface. `dsh web` has its own path into a turn, and a
// capability that works in the CLI and breaks in the browser has happened here
// before — which is why the completion bar is both surfaces, not either.
import { openApp } from './web-drive.mjs'

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}
// A solid-colour probe: the answer is one word, and a model that never saw the
// image cannot land on it by sounding plausible.
const image = flag('image', 'examples/vision-bridge/test-images/solid-green.png')
const QUESTION = `What solid color fills the image at ${image} ? Answer with just the color name.`
const EXPECTED = /green/iu

const { page, browser, shot, send, UI } = await openApp()

await page.getByRole('button', { name: UI.newSession }).first().click({ timeout: 60_000 })
await send(QUESTION)

const answered = await page.locator('body').innerText()
if (!EXPECTED.test(answered)) {
  throw new Error(
    'capture: the web turn did not identify the image colour, so the vision delegation did not work here.'
    + `\n  last screen text: ${answered.replace(/\s+/gu, ' ').slice(-600)}`,
  )
}
// Deliberately NOT asserting anything else from the DOM. A page whose tool row
// reads "the vision bridge failed because no vision model was configured"
// contains both "vision" and "green", so screen text cannot tell a working
// bridge from a broken one. The caller checks the session log, where the
// image-reading tool's own result says which happened.
await shot('05-vision-bridge-web')

await browser.close()
