# 你手上有什么 → 装哪个包

实测 98 个包，覆盖 79 类服务。每个包装进独立的临时 profile、启动一次、读引擎为它打印的路由归属。
**没有对任何一家真发过请求** —— 这张表说的是"路由建起来了、模型进得了选择器"，不是"那家服务今天通不通"。

能用 61 · 未知 28 · 不能用 9

| 你有什么 | 装哪个 | 周下载 | 能用? | 怎么接进来的 |
|---|---|---|---|---|
| Anthropic 订阅 | `pi-background-tasks` | 18992 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Anthropic 订阅 *(要登录)* | `@caupulican/pi-adaptative` | 2892 | 未知 |  |
| Anthropic 订阅 | `@robhowley/pi-openrouter` | 2244 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（evil.example） | `@plannotator/pi-extension` | 11841 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 自建 / 中转（端点由你配） | `pi-hermes-memory` | 5627 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 自建 / 中转（端点由你配） | `@gotgenes/pi-anthropic-auth` | 3070 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 自建 / 中转（端点由你配） | `pi-claude-bridge` | 2664 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（api.nuget.org） | `pi-lens` | 5082 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| OpenAI / ChatGPT *(要登录)* | `@howaboua/pi-codex-conversion` | 4710 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| OpenAI / ChatGPT | `@cortexkit/pi-openai-auth` | 3054 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（sui-xiang.com） *(要登录)* | `@myka2003/pi-dpi` | 2825 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.neuralwatt.com） | `pi-neuralwatt-provider` | 2813 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| OpenRouter | `pi-tokenrouter` | 2706 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| Kimi / Moonshot *(要登录)* | `pi-provider-kimi-code` | 2365 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Kimi / Moonshot | `pi-spark` | 1956 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| Kimi / Moonshot *(要登录)* | `pi-aftc-toolset` | 1052 | 未知 |  |
| 其它厂商（cchistory.mariozechner.at） | `@twogiants/pi-anthropic-vertex` | 2309 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| MiniMax | `@billjr99/pi-openai-compat` | 2180 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| MiniMax | `@sinamtz/pi-minimax-provider` | 189 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（api.getlilac.com） | `pi-lilac-provider` | 2121 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| Google *(要登录)* | `pi-provider-litellm` | 2107 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Google *(要登录)* | `pi-antigravity` | 856 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（inference.makora.com） | `pi-makora-provider` | 1935 | 不能用 |  |
| 其它厂商（www.2h2d.co） | `pi-openai-codex-fast` | 1927 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.cline.bot） *(要登录)* | `pi-clinepass-provider` | 1867 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| NVIDIA NIM | `pi-extension-nvidia-nim` | 1858 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| NVIDIA NIM | `pi-nvidia-nim` | 939 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（api.theclawbay.com） | `pi-clawbay` | 1789 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Azure AI Foundry | `pi-llm-bridge` | 1781 | 未知 |  |
| Azure AI Foundry *(要登录)* | `@nquandt/pi-azure-foundry` | 51 | 不能用 |  |
| Fireworks | `pi-fireworks-provider` | 1771 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（gitlab.com） | `@danypops/pi-packed` | 1743 | 不能用 |  |
| 其它厂商（api.deepseek.com） | `@juvio15/pi-seek` | 1572 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（agentn.us.api5.cursor.sh） *(要登录)* | `@rahularya01/pi-cursor` | 1532 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Baseten | `pi-baseten-provider` | 1512 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（hyper.charm.land） | `pi-hypercharm-provider` | 1426 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（hyper.charm.land） *(要登录)* | `@charmland/pi-hyper-provider` | 311 | 不能用 |  |
| Ollama | `pi-ollama-cloud` | 1415 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| Ollama | `pi-ollama-cloud-provider` | 298 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.openmodel.ai） *(要登录)* | `pi-openmodel-provider` | 1362 | 不能用 | llm-pi-ai: provider "openmodel" model "codex-auto-review" sets compat reasoning  |
| xAI *(要登录)* | `pi-xai-oauth` | 1321 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| xAI | `pi-tensorix-provider` | 932 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（crof.ai） | `pi-crof-provider` | 1242 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（vip.j3gb.com） *(要登录)* | `pi-j3gb-provider` | 1199 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（opencode.ai） | `@monotykamary/pi-opencode-provider` | 1196 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.code.umans.ai） *(要登录)* | `pi-umans-provider` | 1102 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（hub.coreinfra.ai） | `@coreinfra/pi-plugin` | 950 | 不能用 | llm-pi-ai: provider "coreinfra" model "glm-4.7-flash" sets compat reasoning swit |
| 其它厂商（api.intelligence.io.solutions） | `pi-io-provider` | 945 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| HuggingFace | `@aliou/pi-neuralwatt` | 944 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| HuggingFace *(要登录)* | `pi-huggingface-oauth` | 357 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（pass.wafer.ai） | `pi-wafer-provider` | 837 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.parasail.io） | `pi-parasail-provider` | 732 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| DeepInfra *(要登录)* | `pi-free` | 613 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| DeepInfra | `pi-deepinfra` | 133 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 阿里百炼 / 通义千问 *(要登录)* | `pi-multi-account` | 522 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 阿里百炼 / 通义千问 | `pi-provider-alibaba-bailian` | 169 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| Cohere | `@aliou/pi-cohere` | 484 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.zyloo.io） | `pi-zyloo-provider` | 468 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.commandcode.ai） *(要登录)* | `pi-commandcode-provider` | 397 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（biomejs.dev） | `@howaboua/pi-subagent-review` | 363 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（ai.host.ts.net） | `@aliou/pi-ts-aperture` | 356 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 商汤 SenseNova | `@d3ara1n/pi-provider-sensenova` | 346 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（radius.pi.dev） | `@earendil-works/pi-radius` | 304 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Vercel AI Gateway *(要登录)* | `@yulong-me/pi-swarm` | 254 | 未知 |  |
| 其它厂商（agentrouter.org） | `@sphinxcorp/pi-provider-agentrouter` | 253 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.synthetic.new） | `@benvargas/pi-synthetic-provider` | 241 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 硅基流动 | `@bigking67/pi-67` | 226 | 未知 |  |
| 其它厂商（api.telegram.org） | `pi-reactor` | 205 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.gmi-serving.com） | `pi-gmi-cloud` | 194 | 不能用 | llm-pi-ai: provider "gmi" resolves no models; the installed catalog does not des |
| 其它厂商（api.sarvam.ai） | `pi-sarvam-provider` | 190 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.any-router.com） | `pi-relay-models` | 183 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（ingrazzio-cloud-prod.labs.jb.gg） | `pi-jetbrains-junie-bridge` | 158 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.kilo.ai） | `pi-bansos` | 148 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 火山方舟 / 豆包 | `pi-provider-volcengine-ark` | 141 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 火山方舟 / 豆包 | `pi-volcengine-provider` | 96 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（go.microsoft.com） | `pi-provider-newapi` | 130 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.exa.ai） | `pi-blackbytes` | 95 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.cirthan.com） | `@cirthan/pi-cirthan-provider` | 71 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（pi.dev） | `pi-safe-compact` | 70 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.otari.ai） | `@mozilla-ai/pi-otari` | 63 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.berget.ai） *(要登录)* | `@bergetai/pi-provider` | 62 | 不能用 |  |
| SAP AI Core *(要登录)* | `pi-sap-aicore` | 61 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（reactjs.org） | `pi-setup` | 53 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.novita.ai） *(要登录)* | `pi-novita-ai` | 51 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（toms-mac-mini.taild0936.ts.net） | `pi-omlx-provider` | 51 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（app.kiro.dev） *(要登录)* | `@arvoretech/pi-kiro-provider` | 50 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（app.kiro.dev） *(要登录)* | `pi-kiro-provider` | 34 | 未知 |  |
| 其它厂商（apihub.agnes-ai.com） | `@d3ara1n/pi-provider-agnes` | 41 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（headroom.local） | `@faks/pi-gateway` | 41 | 未知 | 启动时不注册 provider，要走它自己的命令/配置 |
| 其它厂商（api.edgee.app） | `@aliou/pi-edgee` | 38 | 不能用 | llm-pi-ai: provider "edgee" resolves no models; the installed catalog does not d |
| 其它厂商（api.tokenrouter.com） | `@realvendex/pi-token-router` | 33 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（api.openference.com） *(要登录)* | `pi-provider-openference` | 31 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（api.swisscom.com） | `pi-provider-swiss-ai-platform` | 31 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| Scaleway | `@andersea/pi-scaleway-provider` | 30 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| Cloudflare | `pi-extension-cloudflare-workers-ai` | 25 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 阶跃星辰 StepFun | `@d3ara1n/pi-provider-stepfun` | 24 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
| 其它厂商（api.opper.ai） | `@opperai/pi-provider` | 23 | 能用 | 包自带传输，注册成 DSH 原生路由 |
| 其它厂商（aihubmix.com） *(要登录)* | `@h00w/pi-provider-aihubmix` | 20 | 能用 | 目录翻译成 DSH 官方适配器的配置 |
