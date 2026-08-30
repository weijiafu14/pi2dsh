// Drive the suite's Memory/Tasks tabs inside dsh-better-sidebar.
//
//   node docs/posting-kit/capture-workx-sidebar.mjs <out-dir> \
//     --url http://… --codeword X
//
// The waits are the assertions: the codeword inside the Memory tab can only
// have come from the plugin's store via /dsh-x/memory-state; the tasks tab's
// card can only come from /dsh-x/tasks-state.
import { openApp } from './web-drive.mjs'

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}
const CODEWORD = flag('codeword')
if (CODEWORD === undefined) throw new Error('capture-workx-sidebar: --codeword is required')

const { page, browser, shot, send } = await openApp()
page.on('console', message => {
  if (message.type() === 'error') console.error('page error:', message.text().slice(0, 400))
})
page.on('pageerror', error => console.error('page exception:', String(error).slice(0, 400)))
await page.getByRole('button', { name: /new session/iu }).first().click({ timeout: 60_000 })

await send(`Use the memory_add tool to remember this durable project fact: my project codename is ${CODEWORD}. Confirm in one short sentence.`)
await send('Use the bg_run tool to start a background shell job named ticker that runs exactly this command: '
  + "sh -c 'for i in $(seq 1 120); do echo tick $i; sleep 1; done'. "
  + 'Confirm the task id in one short sentence. Do not wait for it and do not kill it.')

// Open the sidebar. It mounts collapsed with toggle icons in the top-right
// header cluster; find a labeled toggle first, else click the rightmost
// header button. The labels are printed for diagnosis either way.
const headerButtons = await page.locator('button').evaluateAll(nodes => nodes
  .map(node => ({
    label: node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent?.trim() ?? '',
    x: node.getBoundingClientRect().x,
    y: node.getBoundingClientRect().y,
  }))
  .filter(entry => entry.y < 60 && entry.x > 700))
console.log('header buttons:', JSON.stringify(headerButtons))
const labeled = page.getByRole('button', { name: /sidebar|panel/iu })
if (await labeled.count() > 0) {
  await labeled.last().click()
} else {
  const rightmost = headerButtons.reduce((best, entry) => entry.x > best.x ? entry : best, headerButtons[0])
  await page.locator('button').filter({ hasText: rightmost.label === '' ? undefined : rightmost.label }).last()
    .click({ timeout: 5_000 })
    .catch(async () => {
      // Icon-only button: click by position.
      await page.mouse.click(rightmost.x + 10, rightmost.y + 10)
    })
}
await page.waitForTimeout(1500)
await shot('00-sidebar-open')

// The tab strip mounts with Files only; registered tabs are added through
// the "+" control next to it. Open it and pick Memory.
const openTabFromPlus = async (name) => {
  const already = page.getByText(name, { exact: true })
  if (await already.count() > 0 && await already.last().isVisible()) {
    await already.last().click()
    return
  }
  // The "+" is an SVG icon with no text node, so no text locator can find
  // it. Anchor on the rightmost visible tab TITLE in the strip and probe a
  // few x-offsets to its right with native hover→click until the wanted
  // menu item text becomes visible.
  const anchor = await page.evaluate(() => {
    const titles = ['Files', 'Memory', 'Jobs', 'Terminal', 'Tasks']
    const rects = [...document.querySelectorAll('*')]
      .filter(node => node.children.length === 0
        && titles.includes((node.textContent ?? '').trim())
        && node.checkVisibility?.())
      .map(node => node.getBoundingClientRect())
      .filter(rect => rect.y < 40)
    rects.sort((a, b) => a.x - b.x)
    const last = rects[rects.length - 1]
    return last === undefined ? null : { right: last.x + last.width, y: last.y + last.height / 2 }
  })
  if (anchor === null) throw new Error('sidebar tab strip not found (no visible tab title)')
  const itemVisible = () => page.evaluate((label) => [...document.querySelectorAll('*')]
    .some(node => node.children.length === 0
      && (node.textContent ?? '').trim() === label
      && node.checkVisibility?.()), name)
  let opened = false
  for (const offset of [34, 50, 66, 20]) {
    await page.mouse.move(anchor.right + offset, anchor.y)
    await page.waitForTimeout(120)
    await page.mouse.click(anchor.right + offset, anchor.y)
    await page.waitForTimeout(400)
    opened = await itemVisible()
    if (opened) break
  }
  if (!opened) throw new Error(`sidebar "+" menu never showed ${JSON.stringify(name)}`)
  // Raw screenshot without the pointer-parking shot(): the popup dies on
  // stray mouse moves.
  await page.screenshot({ path: `${process.argv[2]}/zz-menu-${name}.png` }).catch(() => {})
  // Click through raw coordinates in one breath: the popup closes on any
  // stray pointer move (a shot() between open and click killed it), and
  // Playwright's actionability re-checks race that closing.
  const box = await page.evaluate((label) => {
    const nodes = [...document.querySelectorAll('*')]
      .filter(node => node.children.length === 0
        && (node.textContent ?? '').trim() === label
        && node.checkVisibility?.())
    const target = nodes[nodes.length - 1]
    if (target === undefined) return null
    const rect = target.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, name)
  if (box === null) throw new Error(`sidebar “+” menu has no visible item ${JSON.stringify(name)}`)
  await page.mouse.click(box.x, box.y)
}

// Memory tab: click and see the STORE's codeword inside the suite's panel.
await openTabFromPlus('Memory')
await page.locator('[data-dsh-x="memory-tab"]').getByText(CODEWORD).first().waitFor({ timeout: 30_000 })
await shot('01-sidebar-memory')

// Tasks tab: the running ticker's card.
await openTabFromPlus('Jobs')
await page.locator('[data-dsh-x="tasks-card"]').first().waitFor({ timeout: 30_000 }).catch(async (error) => {
  const html = await page.evaluate(() => document.querySelector('[data-dsh-x="tasks-tab"]')?.outerHTML.slice(0, 600) ?? '(no tasks-tab)')
  const markers = await page.evaluate(() => [...document.querySelectorAll('[data-dsh-x]')].map(node => node.getAttribute('data-dsh-x')))
  console.error('tasks tab content:', html, '| markers:', JSON.stringify([...new Set(markers)]))
  throw error
})
await shot('02-sidebar-tasks')

await browser.close()
