# pi2dsh 0.25.2 发版回归（2026-09-22）

修复内容：`ctx.modelRegistry` 补齐 Pi 0.84.1 `ModelRegistry` 缺失的三个公开方法
（`registerProvider` / `unregisterProvider` / `getRegisteredNativeProvider`）；未 await 的
`sendMessage` 投递失败只告警。触发者：`pi-background-tasks` 2.6.x 当天发版。

- [`published.json`](published.json)：npm `dist.integrity` 与本地 tarball 一致；dsh-work-x 未动。
- 宿主：stock npm `@deepseek-ai/dsh@0.1.5-rc.2` CLI，全新 DSH_HOME，引擎从 registry 装 `pi2dsh@0.25.2`
  （每条结果里的 `engine.from = "registry"`）。

## 结果

| 批次 | 文件 | 结果 |
|---|---|---|
| 第一次（本地 checkout CLI，**错误装置**） | `examples-localcheckout-attempt.json` | 15 失败于安装阶段，零信息量，保留不作数 |
| 第二次（stock CLI，并发 4） | `examples-stock-cli.json` | 7 过 / 8 挂 / 4 跳 / 1 partial；8 挂全因本机 Playwright Chromium 缓存目录不存在 |
| 补跑 8 个浏览器场景（串行） | `rerun/*.json` | 8 过 |

合计：**15 过、4 有因跳过（无阿里/视觉/Codex 凭证）、1 partial（subscription-login 无 CODEX_AUTH_FILE）**。

修复本身在两代上的真机验证（本地引擎，真包 2.6.2）：`background-tasks-rc2-local-engine.json`、
`background-tasks-alpha2-local-engine.json`。

## 目检

- `side-conversation.png`：侧聊浮窗在输入框右上，问答在窗内，主线程只有 "OK"。
- `presentation-surfaces.png`：powerline 状态胶囊在输入框上方，带颜色无转义符；旁边
  `bg ↑ v2.6.2 /bg-update` 是 pi-background-tasks 自己的升级提示（套件钉 2.4.2）。

## 这次回归里哪些绿灯不算数

对 20 个场景断言的逐条审查（功能死了会不会照样过）：13 个可证伪；**presentation-surfaces**
读页面文字、**subscription-login** 的 partial 与 **dsh-x** 的"六包挂载"读启动日志、
**codex-image-gen** 只读子脚本的 status 字段——这 4 个的绿不能单独当证据。
本次它们分别由截图目检、`registered as a native DSH llm route` 日志、btw 主日志断言兜底；
codex-image-gen 跳过。断言改法待定。
