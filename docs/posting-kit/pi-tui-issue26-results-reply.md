# dsh-pi-tui #26 成果回帖存档

Posted to XMoon/dsh-pi-tui · issue #26 · 2026-08-26 — https://github.com/XMoon/dsh-pi-tui/issues/26#issuecomment-5421146212

---

Following up with the concrete results we promised — the integration has shipped.

**Released**: [pi2dsh 0.20.0](https://www.npmjs.com/package/pi2dsh) carries the dsh-pi-tui backend exactly along the boundary proposed above:

- selected by capability, never by package name: `piTuiExtensions` injected as an optional service, `apiVersion === 1` + `unstable.surface.handle` checked, `UNSTABLE_API_LEVEL === 1` verified at import time — anything else degrades to the existing headless/scene behavior;
- only the two documented entry points are consumed (`@xmoon76/dsh-pi-tui` for `LOCAL_COMMANDS`, `/extensions/unstable` for the facade); no repository internals;
- Pi `setStatus` lands on the public `chrome.footer.status` slot; command collisions resolve against `LOCAL_COMMANDS` so native commands keep their names and package commands mount with a `pi-` source prefix;
- no second model/session/tool store.

One design note that should age well with your Server/Client split: the Pi component object never reaches the presentation layer. It stays Host-owned behind a transport-neutral relay whose messages are only `sessionId / width / lines / input / revision / close`; the current in-process `mountComponent` call is just the local transport. When the split lands, only that transport changes — no callback or component object crosses the boundary, and the Pi ABI is untouched.

**Stock-package E2E** (one real DSH TUI process, real model, nothing patched): `@deepseek-ai/dsh@0.1.1-rc.2` + `@xmoon76/dsh-pi-tui@0.3.4` + `pi2dsh@0.20.0` + `pi-mcp-adapter@2.27.0` + `@tintinweb/pi-subagents@0.18.0`

- native `/login` lists 43 providers with the projected Pi OAuth flows (filtered to OpenAI Codex on screen);
- zero duplicate-command errors in the boot logs;
- `/pi-mcp` renders the original MCP manager, `everything 23/23` connected;
- a real model call drives an MCP direct tool; the successful result lands in DSH's native `tool/result` log;
- `/agents` renders the original Pi Agents surface, and a real `Agent` tool round creates a child and returns its answer — also durably logged.

On question 3 (coexistence): the native-command guarantee is now asserted by machinery, and `/login` ownership is decided by capability — the bridge's fallback steps aside only when the host's `/login` is backed by the composed authorization service (which yours is), so neither surface ever loses a login entry point.

Per your ask, this combination is now a permanent compatibility case: the full scenario runs in our release regression on every version we publish. Reproducible walkthrough: [`examples/pi-tui-ecosystem`](https://github.com/weijiafu14/pi2dsh/tree/main/examples/pi-tui-ecosystem); machine-written evidence: [`community/pi-tui-ecosystem-e2e.json`](https://github.com/weijiafu14/pi2dsh/blob/main/community/pi-tui-ecosystem-e2e.json).

Thanks for the clear guidance on the Unstable tier — it made this a clean fit. We'll re-run the case against your upstream Pi TUI swap when it ships.
