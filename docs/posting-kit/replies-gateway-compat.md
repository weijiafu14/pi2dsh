# rc.8 gateway-compat discussion replies

The old “use a transport-owning Pi provider to bypass DSH settings” reply is
obsolete. DSH rc.8 fixed the underlying configuration seam. Do not repost the
archived workaround wording.

## What can be said now

- DSH's official `llm-pi-ai` profile accepts protocol-aware compat fields,
  model input modalities and `reasoningEfforts`.
- A gateway configured directly in DSH settings can use those fields without
  pi2dsh.
- If the gateway already has a Pi provider plugin, pi2dsh translates a
  catalog-only declaration into that official profile. It does not require the
  plugin to bring a stream and does not implement a parallel HTTP client.
- A provider that does bring its own transport still becomes a normal DSH
  route through `llm.registerAdapter`.
- Vendor-owned catalog switches and generic final-wire middleware remain out
  of scope. Do not turn those into “all provider problems are fixed”.

## Threads this update directly answers

Use the shared body for reports about configuration dropping
`supportsDeveloperRole`, `maxTokensField`, input modality or thinking-level
mapping, including the previously collected #472, #990, #1232, #1498 and the
same-root gateway threads. Read the current thread before posting: some users
only need the first paragraph (upgrade/configure DSH), while a thread about an
existing Pi provider also benefits from the pi2dsh paragraph.

Do not reuse it as evidence for:

- multi-turn reasoning replay unless that exact conversation was run;
- a specific official route such as `deepseek-official` unless that route was
  tested;
- arbitrary request/response interception (`DSH-ARCH-003`);
- a package that never registers any provider.

## Shared body — Chinese

> 这个问题在 DSH rc.8 里有了正面修复：官方 `llm-pi-ai` profile 现在可以表达
> `supportsDeveloperRole`、`maxTokensField`、输入模态、推理档位，以及各协议明确
> 开放的 compat 字段。也就是说，私有网关不再只能靠 hostname 猜协议行为；直接在
> DSH settings 里声明就能进入官方 adapter。
>
> 如果你已经有对应的 Pi provider 插件，也可以用 pi2dsh 直接迁移：插件即使只声明
> 模型目录、不自带 stream，pi2dsh 也会把协议、base URL、凭证引用、模型能力和 compat
> 逐字段翻译成官方 `llm-pi-ai` profile。真正的 HTTP 请求仍由 DSH 官方 adapter 发出，
> 不是另造一套代理。
>
> ```bash
> dsh plugin --profile web add pi2dsh
> dsh plugin --profile web add <对应的 Pi provider 插件>
> ```
>
> 仓库里的 `examples/gateway-compat/` 有一个不带 transport 的最小 provider 和透传
> 录制器，可以在真实上游前看到最终请求是否用了 `system`、`max_tokens`，以及选择的
> reasoning effort：<https://github.com/weijiafu14/pi2dsh>

## Shared body — English

> DSH rc.8 fixes the underlying configuration seam: the official `llm-pi-ai`
> profile can now express `supportsDeveloperRole`, `maxTokensField`, input
> modalities, reasoning efforts, and the compat fields explicitly offered for
> each protocol. A private gateway no longer has to rely only on hostname
> inference; those facts can be declared in DSH settings and reach the official
> adapter.
>
> If the gateway already has a Pi provider plugin, pi2dsh can migrate that
> declaration too. Even a catalog-only plugin with no stream is translated
> field by field into the official `llm-pi-ai` profile — protocol, base URL,
> credential reference, model capabilities and compat. DSH still owns the real
> HTTP request; the bridge does not create another proxy transport.
>
> ```bash
> dsh plugin --profile web add pi2dsh
> dsh plugin --profile web add <the matching Pi provider plugin>
> ```
>
> `examples/gateway-compat/` includes a transport-free fixture and a
> passthrough recorder that shows the final role, max-token field and reasoning
> effort against a real upstream: <https://github.com/weijiafu14/pi2dsh>

## Reply for the original upstream gap report

For #3076, keep it short and credit the upstream fix:

> Confirmed on rc.8: the new protocol-aware `llm-pi-ai` profile closes the
> configuration gap reported here. We updated pi2dsh's catalog-only provider
> translation to use the new official schema for compat, modalities and
> reasoning efforts; no bridge-owned transport is involved. The field-level
> contract and real-wire probe are in `examples/gateway-compat/`:
> <https://github.com/weijiafu14/pi2dsh>

## Evidence checklist before posting

- contract: OpenAI-completions and Anthropic fields are filtered by protocol;
- negative: unknown and vendor-owned keys are absent from the profile;
- runtime: DSH accepts the generated settings section and lists the route;
- wire: a real turn records `system`, `max_tokens`, no `store`, and completes;
- package: the fixture has no stream, proving the request came from DSH's
  official adapter.
