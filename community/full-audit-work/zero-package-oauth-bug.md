# 零 Pi 包 profile 的 OAuth 路由缺失（2026-08-30 发现，待修）

## 复现（真机，两次对照）

装置：`scripts/verify-codex-write-optional-e2e.mjs`（stock @deepseek-ai/dsh@0.1.1-rc.2
headless + 工作区引擎 + seedCodexLogin 预置 auth.json + settings 配
`llm-pi-ai.providers.openai-codex.apiKeyEnv: PI2DSH_OAUTH_OPENAI_CODEX`）。

| profile 内容 | 结果 |
|---|---|
| 仅引擎（零 Pi 包） | `dsh: MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "openai-codex"` |
| 引擎 + 一个什么都不注册的 noop Pi 包 | 凭证解析通过，请求真实发出（后续 TRANSPORT: fetch failed 是本机代理问题，另行解决） |

两次都打印 `[pi2dsh] logged in to "openai-codex", but this composition has no
credentials service to hand the token to`（publishOAuthCredential 用
`optionalService(ctx,'credentials')` 立即探测，src/runtime.ts:3311）。

## 判定

CLAUDE.md 铁律：“零个社区 Pi 包也必须挂 host 级运行时——内建 OAuth provider、/login、
凭证恢复和伴生路由属于引擎，不得因插件发现结果为空而跳过。” 现状：零包时凭证发布/
路由恢复的结果与有包时不一致 = 违标。

嫌疑（正推未定论，修前必须倒推实证）：
1. `publishOAuthCredential` 的 `optionalService` 立即探测 vs CLAUDE.md 已拍板的
   `ctx.inject(['credentials'],cb)` 姿势（服务何时组合都能挂上）；
2. 有包时晚一步的 host anchor 再跑一遍 `ensureLoggedInProviderRoute`（runtime.ts:5035
   一带），零包路径少这一遍；
3. 但两次运行该 warn 都出现过 → “有包时凭证从哪一步真正接上”的完整数据流还没
   追到底（按倒推标准，说清断在哪个符号之前不许下修复结论）。

## 待办

- [ ] 倒推有包运行里 llm-pi-ai 拿到 key 的确切来源（加探针跑一次）
- [ ] 修复零包路径（大概率 inject 化 + 零包也跑路由恢复），契约测试钉住
  “空 profile + 存量 auth.json → 路由可用”
- [ ] 两代（rc.8 / rc2）回归
