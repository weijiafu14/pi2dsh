# Use a subscription account (ChatGPT / Claude / Copilot / Kimi / Grok) as a DSH model

You already pay for a coding subscription, and you want those models in
DeepSeek Harness — not a second API bill.

The obstacle is that a subscription authenticates with **OAuth**, and a DSH
route names a credential *reference*, never a secret. There is nowhere in a
settings file to put a token, and the token expires every hour anyway.

This example walks the whole path: log in, watch the route appear, and send a
turn to it.

## 1. Install the engine

```sh
dsh plugin --profile web add pi2dsh
```

Restart dsh. Nothing else is needed for the built-in accounts — `openai-codex`,
`anthropic`, `github-copilot`, `kimi-coding` come with the engine.

If your account is one a **community package** serves (Kimi Coding is the one
built in that cannot be served through the host adapter — see step 5), install
that too:

```sh
dsh plugin --profile web add pi-provider-kimi-code
```

SuperGrok is supplied by the community `pi-grok` provider rather than built
into pi2dsh. Install the original package straight from its tagged GitHub
release — no generated wrapper and no xAI-specific code in pi2dsh:

```sh
dsh plugin --profile web add github:stnly/pi-grok
# restart dsh, then run: /login xai-oauth
```

The package owns the xAI device-code protocol, token refresh, model catalog,
wire transport, and request sanitizer. pi2dsh only maps those standard Pi
surfaces onto DSH: the expiring code is shown immediately in DSH's question
panel, the provider transport becomes a native DSH model route, and the
package's `before_provider_request` sanitizer runs on the exact body its own
transport is about to send.

## 2. Log in

In the command palette (type `/` at the start of the composer):

```
/login
```

Pick the account. What you see next is the provider's own flow — the real one,
run by the package's own code:

- a link labelled **Open the login page**, on the app's own origin, which
  redirects to the vendor's authorize URL and opens in a new tab;
- whatever questions that vendor asks (OpenAI Codex offers *Browser login* or
  *Device code login*, for instance), rendered as DSH's own question dialog.

When it finishes the command reports, for example:

```
Logged in to OpenAI (ChatGPT Plus/Pro); 7 models available
```

## 3. Look at what it wrote

The engine writes exactly one thing into your settings — a route naming a
credential reference:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      displayName: OpenAI (ChatGPT Plus/Pro)
      apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX
```

No protocol, no endpoint, no model list. That is deliberate: naming a protocol
would make the official adapter repoint the route instead of reusing the
installed pi-ai provider, and that reuse is what keeps the account's own wire
dialect. An endpoint is written only when the credential itself decides one
(GitHub Copilot reads its host out of the token, so enterprise and proxied
accounts land on their own).

The token itself goes into DSH's own credential store (`$DSH_HOME/.credentials.yaml`,
owner-readable only) under that reference, and is renewed there: beside each
request while it is still valid, and *before* the request once it has expired —
so the first message after an idle stretch is not the one that fails.

**No restart.** The models are in the picker the moment the login returns.

## 4. Use it

Open the model picker (bottom right of the composer). The account has its own
group — `OpenAI (ChatGPT Plus/Pro)` — beside the routes that were already
there. Pick a model and send a turn.

A one-line check that the turn really went to that account:

```
你是哪个模型？只回模型名
```

On a Codex route the answer is a `gpt-…` id, not DeepSeek's.

## 5. When the account cannot be served this way

Some accounts hand back a request **header** rather than a key —
`kimi-coding` returns `Authorization: Bearer …`. A DSH route profile has one
credential slot and it takes a reference to a key, so a header has nowhere to
go, and the engine says so at login instead of leaving you with an empty
picker:

```
logged in to "kimi-coding", but this provider authenticates with a request
header rather than an api key — DSH routes name a credential reference, so no
model route was added for it
```

The fix is a community package that brings its own transport, because then the
credential never goes through a route profile at all — the package's own chain
resolves it:

```sh
dsh plugin --profile web add pi-provider-kimi-code
# restart, then: /login kimi-coding
```

## Behind a proxy

Node's `fetch` does not honour `http_proxy` on its own, so a login can succeed
and every request after it fails with `fetch failed` while `curl` works fine.
Start dsh with both:

```sh
NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--no-warnings dsh
```

The second one matters too: without it Node prints an experimental-feature
warning to stderr from every child process, which shows up inside tool output.

## What this example asserts

`pnpm test:examples` runs `subscription-login` on a clean DSH home with the
engine installed from npm, and asserts the two things that can be checked
without an account:

- installing `pi-provider-kimi-code` puts that account in `/login`;
- the package becomes a **native route** — the path that carries a
  header-shaped credential, which a route profile cannot.

Removing the package from the scenario makes it fail, which is the point.

The rest is covered where it belongs rather than claimed here: the credential
behaviour (stored under the reference, rotated per request, renewed *before* a
request once expired) is pinned by contract tests in `tests/dsh-runtime.spec.ts`
with mutation checks. Account consent cannot run unattended in CI, so the live
browser leg is performed as an explicit end-to-end check. It was rerun for
`openai-codex` on DSH `0.1.0-rc.8` on 2026-08-20 from an empty DSH home with
only pi2dsh installed: `/login` → browser authorization → localhost callback →
0600 auth and host credential stores → seven models in the picker → a real
GPT-5.6 Sol reply. The same newly created credential also survived profile
startup and produced a real headless reply.

The SuperGrok path was checked on 2026-08-20 with the unmodified
`stnly/pi-grok` v0.10.1 package through a clean DSH Web profile: provider mount,
real xAI OIDC discovery, device-code issuance, clickable code panel, and
cancellation all completed. Finishing account approval and sending a model
turn still require a SuperGrok subscription; no subscription credential is
bundled or fabricated by this example.
