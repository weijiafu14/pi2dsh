# 可回帖清单（v2）— 81 条

判据：**现成的、已核证的 Pi 包经 pi2dsh，今天就能给到这个人要的结果。**
核证等级照 [CLAUDE.md 四点五](../CLAUDE.md) 的两级制，**回帖不许越级宣称**：
等级 1 = 真 DSH loop 端到端跑通；等级 2 = 只到"能挂载 + 探针能调起来"，
**必须写明"我们没做过真实端到端"**。

## 回帖纪律（每条都适用）

1. **先承认对方的问题成立**。这批里大部分人报的是 DSH 自家的真缺陷——
   上来就推销会被当广告。口径是"你这个 bug 成立、该官方修；在那之前有条能用的路"。
2. **明说我们不修 DSH 自家组件**，给的是并行的另一条路径。
3. **判定信心 < 0.6 的（34 条）先追问再回**，别拿推断当结论。
4. **社区里已有高质量回答的（ylwl1997 / DRAG0NM / zoahdev / Electricitysheep
   / ciceroyang 等）**，除非我们能补上他们没提的具体东西，否则重复价值为零。
5. 产品图只在对方问"长什么样"或"有没有现成的"时带，别往窄的 bug 帖里塞图。

## 按包分布

| 包 | 条数 | 等级 |
|---|---|---|
| `pi-mcp-adapter` | 20 | 1 |
| `@tintinweb/pi-subagents` | 15 | 1 |
| `@kassing/pi-vision` | 13 | 1 |
| provider / 网关 compat 一族（pi2dsh + Pi provider 包） | 11 | 1 |
| `pi-approval-guardian` | 6 | 1（无 example） |
| `@juicesharp/rpiv-web-tools` | 4 | **2 — 必须写明未端到端** |
| `@xmoon76/dsh-pi-tui` / 终端面 | 5 | 1 |
| `dsh-work-x` 套件 / 其它 | 7 | 1 |

判定信心：≥0.8 共 5 条 · 0.6–0.8 共 42 条 · <0.6 共 34 条（先追问）。

## 全表（按热度排序）

| # | ↑ | 版块 | 标题 | 推荐包 | 核证等级 | 判定信心 |
|---|---|---|---|---|---|---|
| [#533](https://github.com/deepseek-ai/deepseek-harness/discussions/533) | 6 | General | 必须要有官方自己的交互式CLI/TUI，这是目前程序员的主要使用场景，越简单越好，最好跟Cl | @xmoon76/dsh-pi-tui + pi2dsh | 1 | 0.55 |
| [#126](https://github.com/deepseek-ai/deepseek-harness/discussions/126) | 6 | Ideas | [Feature Request] TUI & Vim/Neovim Integration | @xmoon76/dsh-pi-tui + pi2dsh | 1 | 0.55 |
| [#3917](https://github.com/deepseek-ai/deepseek-harness/discussions/3917) | 5 | Ideas | Feature request: Connect ChatGPT, Claude, and  | pi2dsh 内建 OAuth /login（Codex 订阅登录）+ @cra | 1 | 0.75 |
| [#1791](https://github.com/deepseek-ai/deepseek-harness/discussions/1791) | 4 | General | 对于文件路径的认识不足 | pi-mcp-adapter | 1 | 0.55 |
| [#678](https://github.com/deepseek-ai/deepseek-harness/discussions/678) | 4 | Ideas | 建议支持 Office 全家桶文件类型（Word/Excel/PowerPoint） | pi-mcp-adapter | 1 | 0.55 |
| [#4161](https://github.com/deepseek-ai/deepseek-harness/discussions/4161) | 3 | General | web_search 工具硬编码走 DeepSeek，绕过用户当前选择的对话模型 | @juicesharp/rpiv-web-tools | 2 | 0.7 |
| [#3987](https://github.com/deepseek-ai/deepseek-harness/discussions/3987) | 3 | Ideas | [Feature Request] Allow subagent to specify a  | @tintinweb/pi-subagents | 1 | 0.65 |
| [#4346](https://github.com/deepseek-ai/deepseek-harness/discussions/4346) | 3 | General | Why is there no new Ox Alpha model when reques | llm-pi-ai providers 段 + 自带传输的 Pi provide | 1 | 0.6 |
| [#811](https://github.com/deepseek-ai/deepseek-harness/discussions/811) | 3 | Ideas | 建议将 DEEPSEEK_API_KEY 只读的设定取消 | pi2dsh + 官方 llm-pi-ai 自定义 provider | 1 | 0.6 |
| [#728](https://github.com/deepseek-ai/deepseek-harness/discussions/728) | 3 | Q&A | Subagent 返回的消息会出现在主对话框的排队队列中 | @tintinweb/pi-subagents | 1 | 0.6 |
| [#716](https://github.com/deepseek-ai/deepseek-harness/discussions/716) | 3 | Q&A | 工具调用异常：invalid arguments: missing required pro | pi-provider-alibaba（或任一 Pi provider 包 /  | 1 | 0.55 |
| [#90](https://github.com/deepseek-ai/deepseek-harness/discussions/90) | 3 | Ideas | 能不能支持ssh远程连接项目 | pi-mcp-adapter | 1 | 0.55 |
| [#3559](https://github.com/deepseek-ai/deepseek-harness/discussions/3559) | 3 | General | v0.1.0-rc.8 release notes 声称 DeepSeek 适配器支持原生图 | @kassing/pi-vision | 1 | 0.5 |
| [#3986](https://github.com/deepseek-ai/deepseek-harness/discussions/3986) | 2 | Ideas | [Feature Request] Allow subagent to specify a  | @tintinweb/pi-subagents | 1 | 0.8 |
| [#4466](https://github.com/deepseek-ai/deepseek-harness/discussions/4466) | 2 | General | 为什么flash的子智能体用pro? | @tintinweb/pi-subagents | 1 | 0.75 |
| [#2132](https://github.com/deepseek-ai/deepseek-harness/discussions/2132) | 2 | Ideas | 关于agent派出子代理然后子代理的回复排队这个东西 | @tintinweb/pi-subagents | 1 | 0.7 |
| [#3001](https://github.com/deepseek-ai/deepseek-harness/discussions/3001) | 2 | General | Harness不支持文件拖入，只支持工作区文件的读取。 | pi-mcp-adapter | 1 | 0.6 |
| [#2738](https://github.com/deepseek-ai/deepseek-harness/discussions/2738) | 2 | Ideas | Background subagent responses are queued rathe | @tintinweb/pi-subagents | 1 | 0.55 |
| [#933](https://github.com/deepseek-ai/deepseek-harness/discussions/933) | 2 | Q&A | Deepseek Harness 有支持日志 Observability么？ | pi-mcp-adapter | 1 | 0.55 |
| [#4510](https://github.com/deepseek-ai/deepseek-harness/discussions/4510) | 2 | General | 【bug】我对“计划模式”有疑问？ | pi-approval-guardian | 1(无 example) | 0.5 |
| [#1303](https://github.com/deepseek-ai/deepseek-harness/discussions/1303) | 2 | General | 花了100块钱，有点失望 | pi-provider-alibaba / OpenAI Codex OAuth | 1 | 0.45 |
| [#3512](https://github.com/deepseek-ai/deepseek-harness/discussions/3512) | 1 | Ideas | Feature idea: for text-only models, route imag | @kassing/pi-vision | 1 | 0.85 |
| [#1754](https://github.com/deepseek-ai/deepseek-harness/discussions/1754) | 1 | Q&A | 没有mcp的添加入口 | dsh-work-x（pi2dsh + pi-mcp-adapter） | 1 | 0.85 |
| [#4173](https://github.com/deepseek-ai/deepseek-harness/discussions/4173) | 1 | Ideas | 建议对所有模型开放图片添加功能 | @kassing/pi-vision | 1 | 0.8 |
| [#3666](https://github.com/deepseek-ai/deepseek-harness/discussions/3666) | 1 | General | 发现个关于subagent的问题 | @tintinweb/pi-subagents | 1 | 0.8 |
| [#4519](https://github.com/deepseek-ai/deepseek-harness/discussions/4519) | 1 | Ideas | 我想做个升级版的AskUserQuetion 插件，结果发现plugin根本实现不了 | pi-mcp-adapter | 1 | 0.75 |
| [#1604](https://github.com/deepseek-ai/deepseek-harness/discussions/1604) | 1 | General | DeepSeek Harness with 1,000 MCP tools: should  | pi-mcp-adapter | 1 | 0.75 |
| [#1076](https://github.com/deepseek-ai/deepseek-harness/discussions/1076) | 1 | Ideas | 你应该知道 dsh 和 claude/codex/cursor 当前有哪些会影响生产的小区别 | dsh-work-x（含 pi-mcp-adapter） | 1 | 0.75 |
| [#922](https://github.com/deepseek-ai/deepseek-harness/discussions/922) | 1 | Q&A | 想问下Deepseek Harness能否内置浏览器？ | pi-mcp-adapter | 1 | 0.75 |
| [#3681](https://github.com/deepseek-ai/deepseek-harness/discussions/3681) | 1 | Q&A | 是否可能 未来Plugin in Python | pi-mcp-adapter | 1 | 0.7 |
| [#2682](https://github.com/deepseek-ai/deepseek-harness/discussions/2682) | 1 | Ideas | [Feature] Parent session should show subagent  | @tintinweb/pi-subagents（配 dsh-work-x 套件  | 1 | 0.7 |
| [#1866](https://github.com/deepseek-ai/deepseek-harness/discussions/1866) | 1 | General | Can't add Ollama as Custom Provider, please ma | pi2dsh（+ 官方 llm-pi-ai 段） | 1 | 0.7 |
| [#1802](https://github.com/deepseek-ai/deepseek-harness/discussions/1802) | 1 | Ideas | UI 界面 自动化验证，触发模型"复读"退化、DSH 中断 | @tintinweb/pi-subagents | 1 | 0.7 |
| [#1765](https://github.com/deepseek-ai/deepseek-harness/discussions/1765) | 1 | Q&A | 为什么我的harness接入的多模态模型glm-4.6v无法识图 | @kassing/pi-vision | 1 | 0.7 |
| [#826](https://github.com/deepseek-ai/deepseek-harness/discussions/826) | 1 | Ideas | 关于内置标准化数据库查询工具的建议 | pi-mcp-adapter | 1 | 0.7 |
| [#707](https://github.com/deepseek-ai/deepseek-harness/discussions/707) | 1 | Q&A | node版本与mcp需要的node版本不符怎么办 | pi-mcp-adapter | 1 | 0.7 |
| [#3869](https://github.com/deepseek-ai/deepseek-harness/discussions/3869) | 1 | General | 【问题反馈】web_search 的三重成本放大器：queries 扇出、无调用层预算、we | @juicesharp/rpiv-web-tools | 2 | 0.65 |
| [#3768](https://github.com/deepseek-ai/deepseek-harness/discussions/3768) | 1 | Ideas | [UX] Plugin list displays all MCP connections  | pi-mcp-adapter | 1 | 0.65 |
| [#3766](https://github.com/deepseek-ai/deepseek-harness/discussions/3766) | 1 | Ideas | [UX] Plugin list displays all MCP connections  | pi-mcp-adapter | 1 | 0.65 |
| [#3602](https://github.com/deepseek-ai/deepseek-harness/discussions/3602) | 1 | Q&A | 如果一个对话发过截图并提示失败，切换其他对话后，每次切换到该对话都会弹这个提示 | @kassing/pi-vision | 1 | 0.65 |
| [#3063](https://github.com/deepseek-ai/deepseek-harness/discussions/3063) | 1 | Ideas | MCP client: expose OAuth lifecycle and long-ru | pi-mcp-adapter | 1 | 0.65 |
| [#4491](https://github.com/deepseek-ai/deepseek-harness/discussions/4491) | 1 | General | 好家伙，自己派子代理，然后嫌弃子代理慢，强制终止 | pi-approval-guardian | 1（无 example） | 0.6 |
| [#4435](https://github.com/deepseek-ai/deepseek-harness/discussions/4435) | 1 | Ideas | `dsh-subprocess`: add an env allowlist — `scru | pi-mcp-adapter | 1 | 0.6 |
| [#4347](https://github.com/deepseek-ai/deepseek-harness/discussions/4347) | 1 | General | 多种形式的附件支持 | pi-mcp-adapter | 1 | 0.6 |
| [#4111](https://github.com/deepseek-ai/deepseek-harness/discussions/4111) | 1 | Ideas | [Feature Request]: Add UI toggle switches for  | @juicesharp/rpiv-web-tools | 2 | 0.6 |
| [#3965](https://github.com/deepseek-ai/deepseek-harness/discussions/3965) | 1 | General | 加入的模型无法设置是否支持图片！ | @kassing/pi-vision | 1 | 0.6 |
| [#3672](https://github.com/deepseek-ai/deepseek-harness/discussions/3672) | 1 | General | rc.8 resolves older pi-ai catalog than rc.7, c | pi-opencode-go-provider | 2 | 0.6 |
| [#3643](https://github.com/deepseek-ai/deepseek-harness/discussions/3643) | 1 | Ideas | Switching to a text-only model is blocked when | @kassing/pi-vision | 1 | 0.6 |
| [#3625](https://github.com/deepseek-ai/deepseek-harness/discussions/3625) | 1 | Q&A | 有没有好用推荐的skkill（我是小白） | @juicesharp/rpiv-web-tools | 2 | 0.6 |
| [#2354](https://github.com/deepseek-ai/deepseek-harness/discussions/2354) | 1 | Ideas | 请求添加新Api供应商，AMD TokenFactory中国区。 | pi2dsh（自建网关 compat / custom-gateways exa | 1 | 0.6 |
| [#1985](https://github.com/deepseek-ai/deepseek-harness/discussions/1985) | 1 | General | 预设权限过高但没有询问使用者 | pi-approval-guardian | 1（等级一，但没有 example） | 0.6 |
| [#1670](https://github.com/deepseek-ai/deepseek-harness/discussions/1670) | 1 | Q&A | Lightweight Harness on top of DPSK-Harness / C | @tintinweb/pi-subagents | 1 | 0.6 |
| [#991](https://github.com/deepseek-ai/deepseek-harness/discussions/991) | 1 | Ideas | # 项目添加文件夹功能需求 | pi-mcp-adapter | 1 | 0.6 |
| [#794](https://github.com/deepseek-ai/deepseek-harness/discussions/794) | 1 | Ideas | SSH能力尽快增加 | pi-mcp-adapter | 1 | 0.6 |
| [#522](https://github.com/deepseek-ai/deepseek-harness/discussions/522) | 1 | General | 在尝试让其链接yakit的mcp服务后出现错误，导致无论是新建会话还是项目都会出现同一个错误 | pi-mcp-adapter | 1 | 0.6 |
| [#224](https://github.com/deepseek-ai/deepseek-harness/discussions/224) | 1 | Ideas | sdk 的一种用法 | pi-mcp-adapter | 1 | 0.6 |
| [#132](https://github.com/deepseek-ai/deepseek-harness/discussions/132) | 1 | Ideas | 不支持cli 和 tui 那咱们就手搓一个吧 | @xmoon76/dsh-pi-tui | 1 | 0.6 |
| [#4283](https://github.com/deepseek-ai/deepseek-harness/discussions/4283) | 1 | General | Show and tell: reproducible Pi vs DSH benchmar | pi2dsh（自建网关 compat 路线，examples/custom-ga | 1 | 0.55 |
| [#3930](https://github.com/deepseek-ai/deepseek-harness/discussions/3930) | 1 | General | 你们能在 dsh 上使用最新的视觉模型了吗？ | @kassing/pi-vision | 1 | 0.55 |
| [#3348](https://github.com/deepseek-ai/deepseek-harness/discussions/3348) | 1 | Ideas | deepseek-harness 功能及优化建议 | @tintinweb/pi-subagents | 1 | 0.55 |
| [#3284](https://github.com/deepseek-ai/deepseek-harness/discussions/3284) | 1 | Ideas | 现在多模态模型接入不方便，切换思考等级也不方便，我贴一个我的的解决办法。 | @kassing/pi-vision | 1 | 0.55 |
| [#3098](https://github.com/deepseek-ai/deepseek-harness/discussions/3098) | 1 | Q&A | dsh --profile tui --resume <id> 无法启动 | @xmoon76/dsh-pi-tui | 1 | 0.55 |
| [#2734](https://github.com/deepseek-ai/deepseek-harness/discussions/2734) | 1 | Ideas | Push an ongoing foreground execution to backgr | @tintinweb/pi-subagents | 1 | 0.55 |
| [#1028](https://github.com/deepseek-ai/deepseek-harness/discussions/1028) | 1 | Ideas | 关于将Agent服务与Web服务分离的构想 | pi2dsh + @xmoon76/dsh-pi-tui | 1 | 0.55 |
| [#743](https://github.com/deepseek-ai/deepseek-harness/discussions/743) | 1 | Ideas | DSH 接入 gpt-daybreak-blue + kimi-k3 | pi2dsh (subscription-login example) | 1 | 0.55 |
| [#708](https://github.com/deepseek-ai/deepseek-harness/discussions/708) | 1 | General | 我让dsh给我装插件，自己把自己装死球了。 | @kassing/pi-vision | 1 | 0.55 |
| [#4482](https://github.com/deepseek-ai/deepseek-harness/discussions/4482) | 1 | Q&A | At most 5 image(s) may be provided in one prom | pi-vision-tool | 1（无 example） | 0.5 |
| [#3863](https://github.com/deepseek-ai/deepseek-harness/discussions/3863) | 1 | General | 支持多模态，怎么点加号无法上传文件和图片？ | @kassing/pi-vision | 1 | 0.5 |
| [#2831](https://github.com/deepseek-ai/deepseek-harness/discussions/2831) | 1 | Ideas | deepseek 官方 api 一天用下来，还是挺贵的，都十几块钱了。还是 opencode | pi-provider-alibaba / OpenAI Codex OAuth | 1 | 0.5 |
| [#2421](https://github.com/deepseek-ai/deepseek-harness/discussions/2421) | 1 | Ideas | 可以提供一个官方的docker镜像吗？ | pi-approval-guardian | 1（无 example） | 0.5 |
| [#2186](https://github.com/deepseek-ai/deepseek-harness/discussions/2186) | 1 | Q&A | 1100个子agent导致web页面一直在加载状态，应该如何解决？ | @tintinweb/pi-subagents | 1 | 0.5 |
| [#1838](https://github.com/deepseek-ai/deepseek-harness/discussions/1838) | 1 | General | 在让dsh 开发一些插件的时候，或者对dsh本身做一些操作的时候，应该加上一些限制 | pi-approval-guardian | 1（无 example） | 0.5 |
| [#1116](https://github.com/deepseek-ai/deepseek-harness/discussions/1116) | 1 | General | issue: too many subagents get stuck,已达到输出 toke | @tintinweb/pi-subagents | 1 | 0.5 |
| [#999](https://github.com/deepseek-ai/deepseek-harness/discussions/999) | 1 | Ideas | [Feature] 希望有环境隔离的功能 | @tintinweb/pi-subagents | 1 | 0.5 |
| [#291](https://github.com/deepseek-ai/deepseek-harness/discussions/291) | 1 | Q&A | Undefined behaviour when headless hits an appr | pi-approval-guardian | 1（无 example） | 0.5 |
| [#4607](https://github.com/deepseek-ai/deepseek-harness/discussions/4607) | 1 | Q&A | ox alpha 直接配置不支持多模态！！！ | @kassing/pi-vision | 1 | 0.45 |
| [#3967](https://github.com/deepseek-ai/deepseek-harness/discussions/3967) | 1 | General | OPC - 有没有大佬实现以dsh为底座封装的一套可落地使用的一人公司的套件？ | dsh-work-x | 1 | 0.45 |
| [#3830](https://github.com/deepseek-ai/deepseek-harness/discussions/3830) | 1 | General | Deepseek Harness调用实验版v4-flash-vision思考阶段出错 | @kassing/pi-vision | 1 | 0.45 |
| [#1063](https://github.com/deepseek-ai/deepseek-harness/discussions/1063) | 1 | Q&A | 不支持 tokenhub的api key | pi2dsh（自建/聚合网关 compat + llm-pi-ai profil | 1 | 0.45 |
| [#4460](https://github.com/deepseek-ai/deepseek-harness/discussions/4460) | 1 | Q&A | 配置本地部署的大模型后，普通对话能够正常使用，但是一涉及到修改文件就报错 | 自建网关 compat（DSH 官方 llm-pi-ai 配置）/ 自带传输的  | 1 | 0.35 |
| [#546](https://github.com/deepseek-ai/deepseek-harness/discussions/546) | 0 | Ideas | 子代理方面 | @tintinweb/pi-subagents | 1 | 0.65 |