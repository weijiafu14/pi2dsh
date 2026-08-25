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
const COMMANDS = [
  { variants: [{ prefix: '/pi-mc', full: 'pi-mcp' }, { prefix: '/mc', full: 'mcp' }], owner: 'pi-mcp-adapter' },
  { variants: [{ prefix: '/pi-agent', full: 'pi-agents' }, { prefix: '/agen', full: 'agents' }], owner: '@tintinweb/pi-subagents' },
  { variants: [{ prefix: '/bt', full: 'btw' }], owner: 'pi-btw' },
]

const { page, browser, shot, UI } = await openApp()
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
await browser.close()
