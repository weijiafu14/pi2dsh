import assert from 'node:assert/strict'

/** Create and select the intended workspace through public RPC and its UI action. */
export async function adoptWorkspace(page, path) {
  const attempt = (endpoint, method, payload) => page.evaluate(async ({ endpoint, method, payload }) => {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'pi2dsh-e2e-workspace', method, payload }),
    })
    return { status: response.status, body: await response.text() }
  }, { endpoint, method, payload })
  const result = await attempt('/api/workspace/create', 'workspace/create', { args: { request: { path } } })
  assert.equal(result.status, 200, `workspace.create returned ${result.status}: ${result.body}`)
  const answer = JSON.parse(result.body).result
  assert.equal(answer?.ok, true, `workspace.create refused the request: ${result.body}`)
  const workspace = answer.value?.workspace
  assert(workspace?.workspaceId, 'workspace.create returned no identity')
  // Modern DSH already opens a default workspace on first launch. Creating
  // another workspace does not select it; the scoped New Session action does.
  const row = page.locator(`[data-row-key="workspace:${workspace.workspaceId}"]`)
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.hover()
  await row.getByRole('button', { name: /new.*session|新.*会话/iu }).click()
  await page.waitForTimeout(500)
  return result
}

/** Type into both legacy textareas and the current controlled rich-text editor. */
export async function fillComposer(page, text) {
  const composer = page.getByRole('textbox').last()
  await composer.click()
  await composer.focus()
  await composer.press('ControlOrMeta+A')
  await composer.press('Backspace')
  await composer.pressSequentially(text, { delay: 8 })
  const actual = await composer.inputValue().catch(() => composer.evaluate(node =>
    (node.innerText ?? node.textContent ?? '').replace(/\u00a0/gu, ' ')))
  assert.equal(actual.trim(), text.trim(), 'the editor did not accept the complete prompt')
}
