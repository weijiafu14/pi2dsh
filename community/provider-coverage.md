# 你手上有什么 → 装哪个包

实测 98 个包，覆盖 79 类服务。每个包装进独立的临时 profile、启动一次，然后问宿主自己的模型目录（模型选择器读的同一个源）。
**全程没有配任何凭证，也没有对任何一家发过请求。**「装完就有模型」= 模型出现在选择器里；能不能调通取决于你自己的密钥和那家服务。

要先给密钥/登录 6 · 启动时不注册 22 · 装完就有模型 56 · 不能用 14

| 你有什么 | 装哪个 | 周下载 | 装完 | 模型数 | 怎么接进来的 |
|---|---|---|---|---|---|
| Anthropic 订阅 | `pi-background-tasks` | 18992 | 要先给密钥/登录 | 0 | 包自带传输 → DSH 原生路由 |
| Anthropic 订阅 *(要登录)* | `@caupulican/pi-adaptative` | 2892 | 不能用 | 0 |  |
| Anthropic 订阅 | `@robhowley/pi-openrouter` | 2244 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（evil.example） | `@plannotator/pi-extension` | 11841 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 自建 / 中转（端点由你配） | `pi-hermes-memory` | 5627 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 自建 / 中转（端点由你配） | `@gotgenes/pi-anthropic-auth` | 3070 | 要先给密钥/登录 | 0 | 包自带传输 → DSH 原生路由 |
| 自建 / 中转（端点由你配） | `pi-claude-bridge` | 2664 | 要先给密钥/登录 | 0 | 包自带传输 → DSH 原生路由 |
| 其它厂商（api.nuget.org） | `pi-lens` | 5082 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| OpenAI / ChatGPT *(要登录)* | `@howaboua/pi-codex-conversion` | 4710 | 装完就有模型 | 9 | 包自带传输 → DSH 原生路由 |
| OpenAI / ChatGPT | `@cortexkit/pi-openai-auth` | 3054 | 装完就有模型 | 4 | 包自带传输 → DSH 原生路由 |
| 其它厂商（sui-xiang.com） *(要登录)* | `@myka2003/pi-dpi` | 2825 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.neuralwatt.com） | `pi-neuralwatt-provider` | 2813 | 装完就有模型 | 24 | 包自带传输 → DSH 原生路由 |
| OpenRouter | `pi-tokenrouter` | 2706 | 装完就有模型 | 96 | 目录翻译成配置 → DSH 官方适配器 |
| Kimi / Moonshot *(要登录)* | `pi-provider-kimi-code` | 2365 | 装完就有模型 | 3 | 包自带传输 → DSH 原生路由 |
| Kimi / Moonshot | `pi-spark` | 1956 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| Kimi / Moonshot *(要登录)* | `pi-aftc-toolset` | 1052 | 不能用 | - |  |
| 其它厂商（cchistory.mariozechner.at） | `@twogiants/pi-anthropic-vertex` | 2309 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| MiniMax | `@billjr99/pi-openai-compat` | 2180 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| MiniMax | `@sinamtz/pi-minimax-provider` | 189 | 装完就有模型 | 8 | 包自带传输 → DSH 原生路由 |
| 其它厂商（api.getlilac.com） | `pi-lilac-provider` | 2121 | 装完就有模型 | 4 | 目录翻译成配置 → DSH 官方适配器 |
| Google *(要登录)* | `pi-provider-litellm` | 2107 | 要先给密钥/登录 | 0 | 包自带传输 → DSH 原生路由 |
| Google *(要登录)* | `pi-antigravity` | 856 | 装完就有模型 | 7 | 包自带传输 → DSH 原生路由 |
| 其它厂商（inference.makora.com） | `pi-makora-provider` | 1935 | 不能用 | - |  |
| 其它厂商（www.2h2d.co） | `pi-openai-codex-fast` | 1927 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.cline.bot） *(要登录)* | `pi-clinepass-provider` | 1867 | 装完就有模型 | 11 | 目录翻译成配置 → DSH 官方适配器 |
| NVIDIA NIM | `pi-extension-nvidia-nim` | 1858 | 装完就有模型 | 31 | 目录翻译成配置 → DSH 官方适配器 |
| NVIDIA NIM | `pi-nvidia-nim` | 939 | 装完就有模型 | 44 | 包自带传输 → DSH 原生路由 |
| 其它厂商（api.theclawbay.com） | `pi-clawbay` | 1789 | 装完就有模型 | 18 | 包自带传输 → DSH 原生路由 |
| Azure AI Foundry | `pi-llm-bridge` | 1781 | 不能用 | - |  |
| Azure AI Foundry *(要登录)* | `@nquandt/pi-azure-foundry` | 51 | 不能用 | - |  |
| Fireworks | `pi-fireworks-provider` | 1771 | 装完就有模型 | 48 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（gitlab.com） | `@danypops/pi-packed` | 1743 | 不能用 | - |  |
| 其它厂商（api.deepseek.com） | `@juvio15/pi-seek` | 1572 | 装完就有模型 | 2 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（agentn.us.api5.cursor.sh） *(要登录)* | `@rahularya01/pi-cursor` | 1532 | 装完就有模型 | 42 | 包自带传输 → DSH 原生路由 |
| Baseten | `pi-baseten-provider` | 1512 | 装完就有模型 | 15 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（hyper.charm.land） | `pi-hypercharm-provider` | 1426 | 装完就有模型 | 26 | 包自带传输 → DSH 原生路由 |
| 其它厂商（hyper.charm.land） *(要登录)* | `@charmland/pi-hyper-provider` | 311 | 不能用 | - |  |
| Ollama | `pi-ollama-cloud` | 1415 | 不能用 | - |  |
| Ollama | `pi-ollama-cloud-provider` | 298 | 装完就有模型 | 19 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.openmodel.ai） *(要登录)* | `pi-openmodel-provider` | 1362 | 装完就有模型 | 49 | 目录翻译成配置 → DSH 官方适配器 |
| xAI *(要登录)* | `pi-xai-oauth` | 1321 | 装完就有模型 | 1 | 包自带传输 → DSH 原生路由 |
| xAI | `pi-tensorix-provider` | 932 | 装完就有模型 | 21 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（crof.ai） | `pi-crof-provider` | 1242 | 装完就有模型 | 26 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（vip.j3gb.com） *(要登录)* | `pi-j3gb-provider` | 1199 | 装完就有模型 | 1 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（opencode.ai） | `@monotykamary/pi-opencode-provider` | 1196 | 装完就有模型 | 69 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.code.umans.ai） *(要登录)* | `pi-umans-provider` | 1102 | 装完就有模型 | 10 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（hub.coreinfra.ai） | `@coreinfra/pi-plugin` | 950 | 装完就有模型 | 1 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.intelligence.io.solutions） | `pi-io-provider` | 945 | 装完就有模型 | 32 | 目录翻译成配置 → DSH 官方适配器 |
| HuggingFace | `@aliou/pi-neuralwatt` | 944 | 装完就有模型 | 18 | 包自带传输 → DSH 原生路由 |
| HuggingFace *(要登录)* | `pi-huggingface-oauth` | 357 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（pass.wafer.ai） | `pi-wafer-provider` | 837 | 装完就有模型 | 9 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.parasail.io） | `pi-parasail-provider` | 732 | 装完就有模型 | 44 | 目录翻译成配置 → DSH 官方适配器 |
| DeepInfra *(要登录)* | `pi-free` | 613 | 装完就有模型 | 361 | 包自带传输 → DSH 原生路由 |
| DeepInfra | `pi-deepinfra` | 133 | 装完就有模型 | 10 | 包自带传输 → DSH 原生路由 |
| 阿里百炼 / 通义千问 *(要登录)* | `pi-multi-account` | 522 | 装完就有模型 | 6 | 目录翻译成配置 → DSH 官方适配器 |
| 阿里百炼 / 通义千问 | `pi-provider-alibaba-bailian` | 169 | 装完就有模型 | 9 | 目录翻译成配置 → DSH 官方适配器 |
| Cohere | `@aliou/pi-cohere` | 484 | 装完就有模型 | 7 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.zyloo.io） | `pi-zyloo-provider` | 468 | 装完就有模型 | 48 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.commandcode.ai） *(要登录)* | `pi-commandcode-provider` | 397 | 装完就有模型 | 55 | 包自带传输 → DSH 原生路由 |
| 其它厂商（biomejs.dev） | `@howaboua/pi-subagent-review` | 363 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（ai.host.ts.net） | `@aliou/pi-ts-aperture` | 356 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 商汤 SenseNova | `@d3ara1n/pi-provider-sensenova` | 346 | 装完就有模型 | 3 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（radius.pi.dev） | `@earendil-works/pi-radius` | 304 | 要先给密钥/登录 | 0 | 包自带传输 → DSH 原生路由 |
| Vercel AI Gateway *(要登录)* | `@yulong-me/pi-swarm` | 254 | 不能用 | 0 |  |
| 其它厂商（agentrouter.org） | `@sphinxcorp/pi-provider-agentrouter` | 253 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.synthetic.new） | `@benvargas/pi-synthetic-provider` | 241 | 装完就有模型 | 10 | 目录翻译成配置 → DSH 官方适配器 |
| 硅基流动 | `@bigking67/pi-67` | 226 | 不能用 | 0 |  |
| 其它厂商（api.telegram.org） | `pi-reactor` | 205 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.gmi-serving.com） | `pi-gmi-cloud` | 194 | 不能用 | 0 | llm-pi-ai: provider "gmi" resolves no models; the installed catalog does not des |
| 其它厂商（api.sarvam.ai） | `pi-sarvam-provider` | 190 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.any-router.com） | `pi-relay-models` | 183 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（ingrazzio-cloud-prod.labs.jb.gg） | `pi-jetbrains-junie-bridge` | 158 | 装完就有模型 | 20 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.kilo.ai） | `pi-bansos` | 148 | 装完就有模型 | 17 | 目录翻译成配置 → DSH 官方适配器 |
| 火山方舟 / 豆包 | `pi-provider-volcengine-ark` | 141 | 装完就有模型 | 8 | 目录翻译成配置 → DSH 官方适配器 |
| 火山方舟 / 豆包 | `pi-volcengine-provider` | 96 | 装完就有模型 | 13 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（go.microsoft.com） | `pi-provider-newapi` | 130 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.exa.ai） | `pi-blackbytes` | 95 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.cirthan.com） | `@cirthan/pi-cirthan-provider` | 71 | 装完就有模型 | 3 | 包自带传输 → DSH 原生路由 |
| 其它厂商（pi.dev） | `pi-safe-compact` | 70 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.otari.ai） | `@mozilla-ai/pi-otari` | 63 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.berget.ai） *(要登录)* | `@bergetai/pi-provider` | 62 | 不能用 | - |  |
| SAP AI Core *(要登录)* | `pi-sap-aicore` | 61 | 装完就有模型 | 21 | 包自带传输 → DSH 原生路由 |
| 其它厂商（reactjs.org） | `pi-setup` | 53 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.novita.ai） *(要登录)* | `pi-novita-ai` | 51 | 装完就有模型 | 148 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（toms-mac-mini.taild0936.ts.net） | `pi-omlx-provider` | 51 | 装完就有模型 | 2 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（app.kiro.dev） *(要登录)* | `@arvoretech/pi-kiro-provider` | 50 | 装完就有模型 | 19 | 包自带传输 → DSH 原生路由 |
| 其它厂商（app.kiro.dev） *(要登录)* | `pi-kiro-provider` | 34 | 不能用 | - |  |
| 其它厂商（apihub.agnes-ai.com） | `@d3ara1n/pi-provider-agnes` | 41 | 装完就有模型 | 2 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（headroom.local） | `@faks/pi-gateway` | 41 | 启动时不注册 | 0 | 要走它自己的命令/配置才注册 |
| 其它厂商（api.edgee.app） | `@aliou/pi-edgee` | 38 | 不能用 | 0 | llm-pi-ai: provider "edgee" resolves no models; the installed catalog does not d |
| 其它厂商（api.tokenrouter.com） | `@realvendex/pi-token-router` | 33 | 装完就有模型 | 22 | 包自带传输 → DSH 原生路由 |
| 其它厂商（api.openference.com） *(要登录)* | `pi-provider-openference` | 31 | 装完就有模型 | 3 | 包自带传输 → DSH 原生路由 |
| 其它厂商（api.swisscom.com） | `pi-provider-swiss-ai-platform` | 31 | 要先给密钥/登录 | 0 | 包自带传输 → DSH 原生路由 |
| Scaleway | `@andersea/pi-scaleway-provider` | 30 | 装完就有模型 | 15 | 目录翻译成配置 → DSH 官方适配器 |
| Cloudflare | `pi-extension-cloudflare-workers-ai` | 25 | 装完就有模型 | 17 | 目录翻译成配置 → DSH 官方适配器 |
| 阶跃星辰 StepFun | `@d3ara1n/pi-provider-stepfun` | 24 | 装完就有模型 | 4 | 目录翻译成配置 → DSH 官方适配器 |
| 其它厂商（api.opper.ai） | `@opperai/pi-provider` | 23 | 装完就有模型 | 8 | 包自带传输 → DSH 原生路由 |
| 其它厂商（aihubmix.com） *(要登录)* | `@h00w/pi-provider-aihubmix` | 20 | 装完就有模型 | 278 | 目录翻译成配置 → DSH 官方适配器 |
