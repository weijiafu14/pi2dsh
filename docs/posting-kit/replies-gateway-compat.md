# Replies for the `developer` role / gateway-compat threads

Ten threads share one root cause: a compat field that cannot reach the request
through DSH settings. Post the shared reply below in each, with
the per-thread first line. **All of them are unanswered by maintainers**, so
lead with the workaround, not with us.

Verified on 2026-08-16 with pi2dsh 0.12.0 on a real DSH web session. Each
claim below was observed on the wire, not inferred.

## Ground rules

- This is **a way around it, not a fix to DSH**. Never write "we fixed DSH's
  provider" — the host's own settings path still drops the field.
- Do not tell anyone to install our engine if their gateway works fine with
  plain DSH settings. This only matters when the compat flags matter.
- If someone asks for proof, the answer is a command they can run: the probe
  in `examples/gateway-compat/probe/` reproduces it with no real gateway.

## The threads

| Thread | First line to prepend |
|---|---|
| **#472** (schema drops all but two compat fields; Ark / Kimi) | 同样撞到这个问题，说一个不用自建代理的绕法。 |
| **#1232** (`supportsDeveloperRole: false` silently discarded) | 你分析的根因是对的——`resolveModelCompat()` 确实把这个字段排除了。补一个能绕过去的办法。 |
| **#1498** (hostname allowlist; Bedrock / Volcano / newapi / DashScope) | 私有网关不在 hostname 白名单里，这个诊断没错。有个不改 DSH 也能用的路子。 |
| **#990** (Ollama Cloud: can't set context / reasoning strength) | 这个和 #472 / #1232 / #1498 是同一层的问题，但**先看下面的前提**——现成的 `pi-ollama-cloud` 走不通这条路。 |
| **#780 / #1272 / #1861 / #1992** (full compat passthrough · `maxTokensField` · thinking level map · custom-provider image modality) | 这四条我们逐条在真机上验过了，证据见下。 |
| **#473 / #551 / #614 / #636 / #2007 / #2023** (same root cause) | 和 #472 / #1232 / #1498 同一个根因，直接套用同一份正文。 |

## Shared body (Chinese)

> 根因确认下来是：请求组装时 `supportsDeveloperRole` 这个开关，如果没人显式声明，就**按 hostname 猜**。公有厂商域名在名单里，私有网关/国内端点/本地代理不在，于是被当成支持 `developer`，一开推理就 400。而在 DSH settings 里显式写这个字段是没用的——它在配置层就被丢掉了。
>
> 绕法：**不走 DSH 的 settings 配置，改用 Pi 生态的 provider 插件**。
>
> 这类插件自己构造模型描述（`compat` 就挂在上面），通过 DSH 官方的 `llm.registerAdapter` 注册成一条原生 llm route。请求由插件自己的 stream 组装，读的是插件声明的 `compat`——DSH 那段丢字段的代码不在这条路径上。
>
> 装法（全是 DSH 官方命令）：
>
> ```bash
> dsh plugin --profile web add pi2dsh
> dsh plugin --profile web add <你的网关对应的 Pi provider 插件>
> ```
>
> 重启 dsh，模型会出现在 DSH 自己的模型选择器里。会话、日志、重试、子代理、权限全都还是 DSH 的，只是这条 route 换了个 adapter。
>
> **说明白边界**：这不是修好了 DSH——你要是继续用 DSH settings 配网关，那个字段照样被丢。这只是另一条同样受官方支持的入口。
>
> 不用真网关也能自己验：`examples/gateway-compat/probe/` 里有个假端点会把收到的 role 记下来，配一个声明 `supportsDeveloperRole: false` 的最小 Pi provider，发一条消息就能看到线上发的是 `system` 而不是 `developer`。
>
> pi2dsh：https://github.com/weijiafu14/pi2dsh

## Shared body (English)

> The root cause: when nothing declares `supportsDeveloperRole`, it is guessed
> **from the hostname**. Public vendor hosts are on the list; private
> gateways, domestic endpoints and local proxies are not, so they are assumed
> to accept `developer` and every reasoning request 400s. Declaring the field
> in DSH settings does not help — it is dropped in the config layer.
>
> A way around it: **skip the settings path and install a Pi provider plugin
> for your gateway.** Those plugins build their own model descriptors, `compat`
> included, and register as a native DSH llm route through the host's own
> `llm.registerAdapter`. The request is assembled from the plugin's descriptor,
> so the flag it declares is the flag that ships — the dropping code is not on
> that path.
>
> ```bash
> dsh plugin --profile web add pi2dsh
> dsh plugin --profile web add <the Pi provider plugin for your gateway>
> ```
>
> Restart dsh; its models show up in DSH's own model picker. Loop, session log,
> retries, subagents, permissions — all still DSH's. Only the adapter differs.
>
> **To be clear about scope**: this does not fix DSH. Configure a gateway
> through DSH settings and the field is still dropped. This is a second,
> officially supported way in.
>
> Reproducible without a real gateway: `examples/gateway-compat/probe/` has a
> fake endpoint that records the roles it receives — you will see `system`
> instead of `developer`.
>
> https://github.com/weijiafu14/pi2dsh

## The precondition — say this, it decides whether the workaround applies

Only a Pi provider plugin that **brings its own transport** becomes a DSH llm
route. A plugin that only declares a model catalog falls back to the host's llm
settings and hits the very same dropped-field problem.

Anyone can check without reading code — install, start dsh, read one line:

```
[pi2dsh] Pi provider "<name>" registered as a native DSH llm route      ← works
[pi2dsh] Pi provider "<name>" declares a model catalog but no transport ← does not
```

Checked so far: `pi-provider-litellm` **carries a transport (works)**;
`pi-ollama-cloud` is **catalog-only (does not)**; `pi-llama-cpp` **registers no
provider at all (not applicable)**.

So for **#990** specifically: the mechanism is real, but the Ollama plugin that
exists today cannot carry it. Do not hand that thread an install command —
say the mechanism works and the precondition is a transport-carrying provider.
Same caution for **#1058** until a llama-server provider with a transport shows
up.

## What was verified on the wire (0.12.0)

One request from a private-gateway stand-in, with everything the plugin
declared surviving the trip:

```json
{"roles":["system","user",…],
 "maxTokensField":"max_completion_tokens",
 "reasoningEffort":"xhigh",
 "store":null}
```

- `system` instead of `developer` — #472 / #1232 / #1498 and the six same-root threads
- the model's own max-tokens spelling — #1272
- three different compat flags honored at once — #780 (whole `compat` survives, not a chosen few)
- effort selector shows `Off / Low / Medium / High / Xhigh`: `Minimal` removed by the model's map, `Xhigh` added by it — #1861
- a model declaring image input no longer gets a text-only companion route — #1992

## What we had to fix (mention only if asked)

Three general gaps in our bridge, all now closed, none vendor-specific:

1. Pi describes reasoning as a boolean plus a `thinkingLevelMap`; DSH asks an
   adapter for selectable efforts. We translated neither, so a
   package-registered route offered **no** effort and any reasoning request
   was rejected with `UNSUPPORTED_REASONING_EFFORT`.
2. Once efforts were offered, the picked one was not forwarded into the
   package's stream call — the selector was decorative.
3. A model declaring `input: ['text','image']` advertised it in the catalog
   listing but not in the exact-route resolve, which is what the host consults
   before a request — so it silently degraded to text-only.

Each unlocks every Pi provider plugin at once.
