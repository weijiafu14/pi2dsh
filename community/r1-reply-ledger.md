# R1 回帖账本 — provider 互操作族（2026-08-29 live 复核修正版）

**修正**：上一版的"已回"清单只查了三份 outreach 结果文件，live 逐帖复核发现覆盖不全——
provider 族 84 条里 **43 条已在此前 outreach 波次回过**（全部为带安装命令与证据链接的
实质回复，含 ready_now 26 条的全部）。判据教训：**去重只认 live 逐帖查自己的评论，
不认结果文件**。

## 净账（live 复核后）

| 桶 | 总数 | 已回 | 可新回 | 解锁条件 |
|---|---:|---:|---:|---|
| ready_now | 26 | 26 | **0** | — |
| e2e_only | 25 | 7 | **18** | 跑对应验证（零代码） |
| adapter_work | 22 | 5 | **17** | 引擎适配工作 |
| product_work | 10 | 5 | **5** | provider 包 |
| multi | 1 | 1 | 0 | — |
| **合计** | 84 | 44 | **40** | |

另：已回的 43 条在 R1 做完后可带实证跟进升级（同 alpha 回传批次姿势），不计入新增。

## 验证矩阵 — e2e_only 18 条按可跑性分组

### A. 手头资源即可跑（DeepSeek key / 本地可搭真组件 / 故障注入打真适配器）

- [#2859](https://github.com/deepseek-ai/deepseek-harness/discussions/2859) · 运行 pi2dsh 连接 deepseek-official，构造并行工具调用且 API 全程不带 id 的流式响应，验证工具执行成功且历史加载正常
- [#3023](https://github.com/deepseek-ai/deepseek-harness/discussions/3023) · DSH 测试：使用 DeepSeek 模型执行 /init 和普通对话，对比请求构造差异，验证 pi2dsh 错误诊断能定位 Connection error 根因。
- [#1146](https://github.com/deepseek-ai/deepseek-harness/discussions/1146) · 用跨 provider 历史消息跑通 pi-ai deepseek 路由，验证后端不再返回 400
- [#2659](https://github.com/deepseek-ai/deepseek-harness/discussions/2659) · 在 pi2dsh 路由下复现 12189 tokens 输出，验证输出完整不被截断的 E2E 测试
- [#2670](https://github.com/deepseek-ai/deepseek-harness/discussions/2670) · 在 pi2dsh 路由下复现任务运行，验证输出正常不产生乱码的 E2E 测试
- [#3342](https://github.com/deepseek-ai/deepseek-harness/discussions/3342) · 真实模型调用 write/edit；捕获工具声明、call id/name/arguments、执行结果和第二模型步。
- [#2128](https://github.com/deepseek-ai/deepseek-harness/discussions/2128) · 真实 Zen 凭证、目录与模型调用闭环，错误端点控制组必须失败。
- [#2170](https://github.com/deepseek-ai/deepseek-harness/discussions/2170) · DSH E2E 测试：配置 liteLLM 代理路由，验证请求成功且不要求 DEEPSEEK_API_KEY。
- [#1166](https://github.com/deepseek-ai/deepseek-harness/discussions/1166) · 通过 pi2dsh 路由到输出 token 受限的模型，验证错误信息正确透传。
- [#3957](https://github.com/deepseek-ai/deepseek-harness/discussions/3957) · DSH 测试：应用实时快照后 dsh --models 报告与 /models 端点一致
- [#3338](https://github.com/deepseek-ai/deepseek-harness/discussions/3338) · 配置返回 429 insufficient_quota 的网关，验证 Pi transport 按 RATE_LIMIT 路径重试成功
- [#3407](https://github.com/deepseek-ai/deepseek-harness/discussions/3407) · 配置返回 server_error 的 provider，验证 Pi transport 下按 SERVER 路径重试成功
- [#481](https://github.com/deepseek-ai/deepseek-harness/discussions/481) · 保存脱敏错误形状，在官方和 Pi transport 各跑多轮；只有替代路径稳定时才能回。
- [#947](https://github.com/deepseek-ai/deepseek-harness/discussions/947) · 配置自定义网关模型，调用工具时验证 API 请求包含完整的 command 和 description 字段。
- [#3362](https://github.com/deepseek-ai/deepseek-harness/discussions/3362) · 切到命名外源后长任务所有 request/header 均为外源，官方 usage 不增长；控制组可观察。

（#2170 liteLLM 本地起真代理转真上游；#3338/#3407 故障注入：构造 429/5xx 打真 Pi transport
重试路径——注入的是输入，被测件全真，不属 mock 禁区。）

### B. 需要第三方凭证/订阅（skipped-with-reason，凑齐即跑）

- [#695](https://github.com/deepseek-ai/deepseek-harness/discussions/695) · 命名服务真实凭证在干净 profile 中保存、目录出现、真实调用成功。
- [#1149](https://github.com/deepseek-ai/deepseek-harness/discussions/1149) · 用 GPT-5.6-sol 调用 write 工具，验证可选参数不强制提交
- [#695](https://github.com/deepseek-ai/deepseek-harness/discussions/695) · 命名服务真实凭证
- [#1149](https://github.com/deepseek-ai/deepseek-harness/discussions/1149) · GPT-5.6-sol 通道
- [#3387](https://github.com/deepseek-ai/deepseek-harness/discussions/3387) · 需预注册回调的真 MCP OAuth 服务器

### adapter 17 条（R1 段 2）与 product 5 条（段 3）清单见上一版对应节，编号不变，
已回 5+5 条已从其中剔除：adapter fresh = 931,1058,1073,1077,1078,1099,1113,1198,1866,2668,2893,3090,3112,3128,3157,3825,4190；product fresh = 196,2441,2602,3169,3283。

## 已回进度（2026-08-30 批次 17 终账）

e2e_only 18 条：**17 回、1 毙**（#3387 maintainer 关闭并入 #2017）。本日 13 条全部
带机器可复核证据（provider-threads 六案连跑器 / codex-write-optional /
reasoning-history A/B / alibaba-token-plan / litellm-route）。剩余净新 = adapter 17
+ product 5，解锁条件是 R1 段 2/段 3 开发件；评论链接权威在
community/reply-log/STATE.md 批次 17 各节。

## R1 段 1 首个实验判决（2026-08-29，真跑 pi-ai 0.84.1 累加器，故障注入真 wire）

装置：`full-audit-work/accumulator-experiment.mjs`（options.fetch 注入手造 SSE，
openai client/SSE 解析/累加器全真）；结果 `accumulator-experiment-results.json`。

| case | 报文形状 | 判决 |
|---|---|---|
| baseline | 规范流 | ✅ |
| emptyContinuation | 续块带空串 id/name | ✅ 正确合并（首个非空胜出） |
| lateIdentity | 首块空 id/name、真身后到 | ✅ |
| parallelNoIds | 双并行调用全程无 id、纯 index 交错 | ✅ 两调用各自组装正确 |
| noIndex | 无 index、按 id 续块 | ✅ |
| fencedArgs | markdown 围栏包 arguments | ❌ **args 丢成 {}** —— 确认真缺口（#3047 家族），R1 包工作项 |

结论：pi-ai 累加器**扛得住空 id/name/纯 index 畸形族**（源码判据 + 实跑双证：
块按 index 优先键控、首个非空 id/name 胜出）。#3090 一族的回帖证据方向就是
本装置抬到"经 pi2dsh 路由"的 E2E 形态；围栏剥离进 R1 包需求清单。
