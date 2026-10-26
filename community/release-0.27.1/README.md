# pi2dsh 0.27.1 / dsh-work-x 0.6.1

状态：发布前双宿主验收通过；待 npm 发布和正式包完整回归。

针对 [#9](https://github.com/weijiafu14/pi2dsh/issues/9)：用户在 Windows、DSH
0.2.1-rc.3 的 `desktop` profile 安装时，被 0.27.0 的 rc.2 精确兼容声明拒绝。
当前报错发生在安装前，不是已确认的插件运行时崩溃。

## 修改边界

- 对外 DSH peers 只允许 `0.2.1-rc.2 || 0.2.1-rc.3`；不承诺未知版本。
- 开发依赖及测试图钉在单一 rc.3，rc.2 独立回归；禁止混装核心包。
- `check:host` 区分“支持版本集合”和“当前安装的单一测试宿主”。新增 11 条测试覆盖
  两版成员、未知版本、宽泛范围、重复版本、不一致 peers、混装开发依赖。
- 引擎补丁版本 0.27.1，Web 套件 0.6.1 要求新引擎，六个能力包版本不变。
- 不修改 DSH/Pi/第三方终端，不使用 `allow-version` 豁免。

## 上游审计

对照官方 `dsh-v0.2.1-rc.2` 与 `dsh-v0.2.1-rc.3` 的完整递归 Git tree，
不是只看 GitHub compare 限制为 300 文件的第一页。共 6 个提交、640 个新增/修改文件。
核心 Agent、工具、会话服务源码无变化；主要变化为 Web 导航菜单/草稿和官方 DeepSeek
模型目录。API-key route 现在会读官方 `/models`，模型容量和能力来自动态目录；必须实测
模型投影与子代理选择，不能仅凭核心接口未变宣布通过。

## 验收记录

- rc.2 的 `pnpm verify`：384 tests / 38 files 通过，包含 11 条新增测试，打包检查通过。
- rc.3 的 `pnpm verify`：384 tests / 38 files 通过；89 个 DSH 测试依赖全部 rc.3，peer 检查无问题。
- 对两个 npm CLI 实际解析的 13 个直接 DSH peer 包，加 Agent / AgentLoop，共 15 个包，
  对比 `lib` 下 179 个 JS/TS/MJS/MTS 文件：逐字节相同。此检查不包含整个客户端和所有传递依赖，不能替代 E2E。
- rc.2 / rc.3 发布前示例各 15 passed / 1 partial / 4 skipped / 0 failed；
  见 `examples-pre-rc2.json`、`examples-pre-rc3.json`。rc.3 含本页明确记录的定向复验，
  不是首次完整轮无失败；rc.2 完整轮一次通过。
- 两版子代理八场景、step-seams、dsh-TUI 0.17.0、dsh-pi-tui 0.5.3 的真实组合通过。
  原生登录列表只证明 flow 发现，不代表完成真实订阅账号授权。
- npm 正式包双宿主完整回归：待完成。

首轮 rc.3 的失败证据保留在 `pre-rc3-first-attempt.json`：子代理装置误将
`file:` 目录当 tarball 读取（EISDIR，尚未启动宿主），已按文件类型修正；代码导航
安装遇到 ECONNRESET，降低并发后从完整场景重跑。没有放宽功能断言或修改产品代码。

第二轮仅 suite 侧聊保存断言失败（`pre-rc3-second-attempt.json`）：截图明确仍为
“Answering…”时，装置已经以流式文本 Arrakis 为完成信号并检查保存。修正为等待回答
完成，再有界等待同一主会话的原始落盘条件；Pi 的 void sendMessage 不保证调用返回时
异步保存已完成。保留未保存不泄漏、保存笔记、按需注入的全部原始内容断言。
此处发布前做定向复验；发布后仍要求两个宿主各执行一次完整 verify:release。

加强等待后还发现 Web 套件的真实状态缺陷：注入清空侧聊后，第二次问答与第一次
消息条数相同，`seenCount` 不增长，`pending` 永远不清。保留现场核对到主会话已有
`btw-note` 与 Arrakis，页面却一直 Answering；不是笔记丢失，也不是 DSH 接口破坏。
修复在 `dsh-x/src/side-chat.ts`：命令请求结束后清 pending；消息增长只负责自动打开；
整个会话窗口按主会话 ID 重挂，隔离旧请求回调与新会话状态。引擎 Host ABI 未变。

新版 dsh-pi-tui 0.5.3 的原生登录列表把标签改为 `OpenAI Codex (legacy) — sign in`，
旧测试的逐字匹配误报不存在；`pi-tui-label-first-attempt.json` 保存了真实列表。
断言只兼容这个已观察到的标签后缀，仍要求实际菜单项，不拿输入框文字代替。

本机为 macOS；不能把本机通过表述为 Windows 桌面端真机验收。
四类缺凭据场景的跳过与登录 partial 必须独立记录，不计为已通过。

桌面升级指引已对照官方 Desktop rc.3 README：npm CLI 明确拒绝管理 `desktop`；
用户应在桌面插件页操作，或用应用菜单安装的 Desktop-owned dsh 命令，在完全退出
桌面应用后执行 `plugin --profile desktop add`。不能把独立 npm CLI 的该项拒绝
误判成此次版本兼容修复失败，也不能教用户伪装 Electron 环境绕过归属检查。
