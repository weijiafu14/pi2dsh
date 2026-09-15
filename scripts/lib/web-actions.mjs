import assert from 'node:assert/strict'

/** The public workspace RPC, with the legacy spelling kept for rc hosts. */
export async function adoptWorkspace(page, path) {
  const attempt = (endpoint, method, payload) => page.evaluate(async ({ endpoint, method, payload }) => {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'pi2dsh-e2e-workspace', method, payload }),
    })
    return { status: response.status, body: (await response.text()).slice(0, 300) }
  }, { endpoint, method, payload })
  let result = await attempt('/api/workspace/create', 'workspace/create', { args: { request: { path } } })
  if (result.status === 404) result = await attempt('/api/workspace.create', 'workspace.create', { path })
  assert.equal(result.status, 200, `workspace.create returned ${result.status}: ${result.body}`)
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
