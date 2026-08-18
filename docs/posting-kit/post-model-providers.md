# Post — model accounts and gateways (DSH community)

**Title**: Log in to your ChatGPT / Claude / Copilot account inside DSH and pick its models — `/login`, then the model picker

**Attach**: `assets/10-login-dialog.png`, `assets/11-model-picker-after-login.png`

**Status of the facts below**: verified on 2026-08-18 against the working tree
for pi2dsh 0.12.4 (`pnpm verify` green — 208 tests / 19 files), on a real DSH
web instance. Rows marked *not exercised* say so because no account was
available, not because anything is expected to differ. No internal endpoint,
host, or credential appears anywhere in this post or its screenshots.

---

DSH routes model calls through adapters it configures from settings. If you
already pay for a coding subscription — ChatGPT Plus/Pro, Claude Pro/Max,
GitHub Copilot — that account authenticates with OAuth, and there is nowhere in
a settings file to put an OAuth token: settings carry a credential
*reference*, never a secret, and the token rotates every hour anyway.

[pi2dsh](https://github.com/weijiafu14/pi2dsh) closes that gap by reusing what
both sides already have. Two commands:

```sh
dsh plugin --profile <p> add pi2dsh
# restart dsh
```

Then in the command palette:

```
/login
```

Pick the account. The provider's own OAuth flow runs — the real one, byte for
byte from Pi, no protocol reimplemented here — and its questions arrive as DSH's
own question dialog: options as rows to click, the authorization address as a
short link on the app's own origin that opens in a new tab.

When it finishes, three things happen without any further step:

1. **the route is declared** in DSH's own `llm-pi-ai` settings section, naming a
   credential reference and nothing else;
2. **the token goes into DSH's own credential store**, and is renewed there —
   beside each request while it is still valid, and *before* the request once it
   has expired, so the first message after an idle stretch is not the one that
   fails;
3. **the models appear in the picker**, in their own group, beside your existing
   routes.

The profile that lands in your settings is this small, and it is yours to edit
or delete:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      displayName: OpenAI (ChatGPT Plus/Pro)
      apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX
```

No protocol, no endpoint, no model list — on purpose. Naming a protocol would
make the official adapter repoint the route instead of reusing the installed
pi-ai provider, and that reuse is what keeps each account's own wire dialect
(Codex does not speak plain `openai-completions`). An endpoint is written only
when the credential itself decides one, which is how Copilot enterprise and
proxied accounts stay correct.

## Built-in accounts

`/login` offers these the moment the engine is installed; they need no extra
package.

| Account | Status | Evidence |
|---|---|---|
| **OpenAI (ChatGPT Plus/Pro)** — `openai-codex` | **End-to-end** | Logged in on a real DSH web instance; the route appeared with 7 models; selected GPT-5.6 Sol; the model answered. Screenshots attached. |
| **Anthropic (Claude Pro/Max)** — `anthropic` | Same path, **not exercised** | Its credential resolves to an api key exactly like Codex's, and pi-ai's Anthropic transport detects an OAuth token and switches to bearer auth on its own. No account here, so it is not claimed as working. |
| **GitHub Copilot** — `github-copilot` | Same path, **not exercised** | Same key shape, plus an endpoint carried out of the token (which the profile now writes, so enterprise and proxied accounts land on their own host). pi-ai's transport has an explicit bearer branch for this provider. No account here. |
| **Kimi Coding** — `kimi-coding` | **Not served this way** — use the package below | Its credential is a request *header*, not a key. A DSH route profile names a credential reference, so there is nowhere for a header to go, and the engine says so at login instead of leaving you with an empty picker. |

## Gateway and vendor packages

For anything else — a self-hosted relay, a domestic cloud, a subscription with
its own protocol — the answer is a Pi provider package, installed the same way:

```sh
dsh plugin --profile <p> add pi-provider-litellm
```

A package that brings its own transport becomes a **native DSH route**: its
models join the directory, its credential chain runs as the package wrote it,
and its per-model compatibility flags reach the request. That is the path Kimi
Coding takes through `pi-provider-kimi-code`, and it is the same path every
gateway package takes — nothing in the engine is keyed on a package name.

<!-- TABLE:gateway-survey -->

## What this does not do

- **No second model directory.** Every route above is an ordinary DSH route in
  the one directory your picker already reads. The engine writes configuration
  and hands over the credential; the request itself is made by DSH's own
  adapter, or by the package's own transport, never by the engine.
- **No secret in your settings file.** Settings hold the reference; the value
  lives in DSH's credential store.
- **Header-shaped credentials cannot be served through the official adapter.**
  A DSH route profile has exactly one credential slot (`apiKeyEnv`, resolved to
  an api key), so a provider whose credential is an `Authorization` header has
  no way in. Packages that carry their own transport are unaffected. Worth
  raising upstream as a gap in `llm-pi-ai`.
- **Behind a proxy, Node needs telling.** `curl` and your browser honour
  `http_proxy`; Node's `fetch` does not unless you start dsh with
  `NODE_USE_ENV_PROXY=1`. Without it a login can succeed and every request
  after it fails with `fetch failed` — not a bridge problem, but it looks like
  one.

## Removing it

`dsh plugin remove pi2dsh` stops the engine. The route profile it wrote stays
in your settings until you delete that block — it is plain DSH configuration,
not hidden state.
