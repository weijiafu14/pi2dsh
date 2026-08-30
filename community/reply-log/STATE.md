# 回帖执行状态

来源清单：`community/v2-reply-queue.md`（81 条）。
纪律：**主判定人逐条自审**——读原帖 + 评论 + 核实我方能力证据，不采信子代理判定。
毙掉的必须写理由，理由进本文件（它们是判定口径的校正样本）。

## 已回（4）

| # | 标题 | 依据 | 评论链接 |
|---|---|---|---|
| 3917 | Connect ChatGPT/Claude/Antigravity accounts | 内建 4 个 OAuth 入口；codex 等级一实测；明写缺 disconnect、无 Antigravity | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3917#discussioncomment-18161040) |
| 811 | DEEPSEEK_API_KEY 只读 | **纯 DSH 官方配置答案**（llm-pi-ai 自定义 provider + 任意 apiKeyEnv），不推销 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/811#discussioncomment-18161061) |
| 533 | 必须要有官方 CLI/TUI | 两个社区 TUI 包 + 我在 tmux 上实际驱动过的五条；明写 CAO 要的事件通道没有 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/533#discussioncomment-18161080) |
| 126 | TUI & Vim/Neovim | 同上，明写 Vim/Neovim 那半边没有 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/126#discussioncomment-18161088) |

| 4346 | Ox Alpha 不在 OpenRouter 模型列表 / 不能手填 | **纯 DSH 官方配置**：`llm-pi-ai` 里自己声明 model id 就是"手填"；顺带解释 OpenAI 404 与 4094 CTX 报错的归属 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4346#discussioncomment-18161272) |
| 3001 | 不支持文件拖入，要 xlsx/docx/pptx/pdf | **社区已做**：`dsh-file-upload@0.4.3`（拖放+文档转 Markdown+`read_document` 工具）、`dsh-upload-button`、`dsh-pdf`。零推销 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3001#discussioncomment-18161279) |
| 4466 | flash 会话派出 pro 子代理 + 停不住 | pi-subagents 三级模型解析（等级一）+ stop 停得住；**明写第一条是按截图推断、第二条我们不修 DSH** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4466#discussioncomment-18161287) |

| 3512 | 文本模型自动路由图片到视觉模型 | 作者自己已写了插件、在提案官方做。**回的是设计输入不是推销**：伴生路由的两个坑（热跟随 `llm/adapters-updated`、sweep 防重入）+ 我们那次假绿事故的教训（断言别看输出文字，要看读图工具自己的 result） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3512#discussioncomment-18161473) |
| 4173 | 对所有模型开放图片入口 | 伴生路由等级一（vision-bridge example）；明写「主模型拿到的是文字不是图片」「不修 DSH 入口层」「官方 0.1.1 自带视觉模型的话不用装我们的」 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4173#discussioncomment-18161488) |
| 1754 | 没有 MCP 添加入口 | **社区已做，且有 5 个**（dsh-mcp-manager 一族 + dsh-toolkit 带 skill-manager）。**主动劝退自家 dsh-work-x**：只要一个入口别装一整套 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1754#discussioncomment-18161494) |
| 4519 | 纯插件做不出阻塞式表单 | 他的源码结论我核过、没反驳。补的是他没找的杠杆：**MCP elicitation 自带阻塞+结构化+回传**，我们端到端验过 form-mode；**同时明写"我验的是请求穿过去了，不是它渲染成一屏表单"**——表单 UI 那半他的结论成立 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4519#discussioncomment-18161498) |

| 678 | Office 全家桶文件类型 | **社区已做**：`dsh-file-upload`（MarkItDown，20+ 格式含 OCR）、`dsh-pdf`、`dsh-pdf-mineru`、`dsh-univer-office`。零推销 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/678#discussioncomment-18161658) |
| 922 | 能否内置浏览器 | **社区已做 6 个**，且 DSH 有官方 `dsh-browser` 能力位；按他"做自动化测试"的场景点名了更贴的两个 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/922#discussioncomment-18161661) |
| 1604 | 1000 个 MCP 工具的常驻请求成本 | **技术同行对照**：pi-mcp-adapter 独立得到同款 `1000→2` 形态；**外加给他一条他没测过的杠杆**——`assembly.tools` 可改写已注册条目（我 8-26 实测），建议他的 lens 加一列"每轮可摘掉的字节数"。同时写明 pre-execute 改 arguments 已证伪 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1604#discussioncomment-18161665) |
| 1076 | dsh vs claude/codex 的三个生产差距 | 逐条分开答：① 项目级 MCP 今天能解 ② system-prompt **机制在（assemble waterfall 实测过）但没现成包**，且他脚本编排的场景插件补不回来 ③ headless `--resume` **明确给不了** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1076#discussioncomment-18161668) |

| 1791 | 模型对本地路径认识不足 | 拆成两件事答：① 模型不知道你的绝对路径（给一次绝对路径）② 工作区外访问——**dsh-TUI 0.9.0 原生有 `/add-dir`**（我在 `src/tui-surfaces.ts` 的命令表里核到，但明写没测过行为）；第三条路 filesystem MCP 用**官方 dsh-mcp-client**。明说提示词装配里那个根因我们改不了 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1791#discussioncomment-18161883) |
| 3681 | 未来能否用 Python 写 Plugin | **纯官方答案**：cordis 插件必须 TS，但 MCP server 协议中立、Python 随便写，官方 `dsh-mcp-client` 直接接。给了 MCP 能做/不能做的边界判据 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3681#discussioncomment-18161886) |
| 2682 | 子代理进度卡片 + 失败自动回传 | **三个诉求分开答**：#2 忙等有实证解（`get_subagent_result` wait:true）；#1 只有管理器不是内联卡片；**#3 失败回传我明确说"没测过、不替它背书、别因为我这句话换运行时"**——而那正是他最要命的一条 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2682#discussioncomment-18161890) |

| 826 | 内置标准化数据库查询原语 | 他列的四条约束正是 MCP server 的标准形态；structured content + 取消我们端到端验过。**同时明说 npm 上没有现成 DSH 数据库插件、我没测过数据库类 server、这跟他要的"官方共建组件"不是一回事** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/826#discussioncomment-18162092) |
| 3559 | rc.8 release notes 谎称支持原生图片 | 他要的是**更正文档**，我明说那是官方的事、不替它回答。只补一条 @ylwl1997 之外的选项：伴生路由**不用换主模型**。明写"这不修复也不绕过 api.deepseek.com 的 schema，你那三个 400 一个都不会变" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3559#discussioncomment-18162094) |
| 1802 | 整页快照累积触发模型复读退化 | 补的是**结构维度**（子会话隔离），与楼里 @boyin111-1 的 diff 建议是叠加不是替代。明写"不修复复读退化本身、子会话塞满雷同快照一样会退化" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1802#discussioncomment-18162101) |

| 707 | MCP 要 node20、dsh 要 node22 | **纯机制答案**：MCP stdio server 是独立子进程、不共享 node 运行时，`command` 指绝对路径或 `nvm exec 20` 即可。顺带否掉楼里"让 dsh 去改上游包"的建议（风险更大）。用官方 dsh-mcp-client | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/707#discussioncomment-18162295) |
| 3768 | 插件列表全显示成 mcp-client | ① 社区 mcp-manager 一族按 server 名分组带状态，正是他画的形状 ② 单适配器托管全部 server 则列表只有一行。**明写第 2 条是换掉官方客户端、不是修好显示名，"别为一个显示名换运行时"**。顺带指出 #3766 是同一篇 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3768#discussioncomment-18162298) |
| 3063 | MCP client 的 OAuth 生命周期 + 长任务超时语义 | **两问分开答**：OAuth 有真实 Atlassian 远程服务的host 边界实证（discovery/DCR/PKCE、UI 只见链接不见凭据、logout 后公开状态助手报 `absent`）；**超时语义我明说"没有任何证据、不猜"**。并点明我给的是"另一个带 UI 的包"，不是他要的嵌入式 API 契约 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3063#discussioncomment-18162305) |

| 3965 | 加入的模型无法设置是否支持图片 | **他的前提是错的、而且是好消息**：`llm-pi-ai` 的 model 条目上有官方 `input: [text, image]` 字段（custom-gateways 实测过），只是添加模型的 UI 表单没覆盖。明写"声明只是声明，端点不收 image_url 照样 400（见 #3559）"，并区分了 @aoaoms 那套子代理流程解决的是**纯文本模型**、这条解决的是**本来就支持视觉的模型** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3965#discussioncomment-18162527) |
| 3869 | web_search 三重成本放大器 | 三条分开答：**③ 用官方 `@deepseek-ai/dsh-web-fetch-http`（npm 上就有，只是没被 base 捆绑）**——比推我们的包好；**① 给了他 `assembly.tools` 可改写 schema 这条杠杆**（改 queries 的 description 或直接把数组改成单值），并划清"改 schema 可行、改 arguments 已证伪"；**② 明说没有现成包、不假装有** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3869#discussioncomment-18162536) |
| 4347 | 放开附件种类让插件解析 | **他的想法恰好就是社区插件在做的事**：`dsh-file-upload` 没等官方放开白名单，自己在 composer 旁开了并行入口，excel 在覆盖范围内。零推销 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4347#discussioncomment-18162545) |

| 3643 | 会话含图片历史后切不回纯文本模型 | **查到一条纯 DSH 的真信息**：0.1.1 线上宿主 dispatch 自己处理模态不匹配，把图片块换成显式 `[image omitted …]` 占位（我们的契约测试按 `LlmAdapter.prototype.prepareCall` 能力探测钉死）。**同时明写"我测的是 dispatch 层，你描述的是发送前准入层，我没单独验证过，请先在会话副本上试"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3643#discussioncomment-18162759) |
| 2354 | 请求添加 AMD TokenFactory | **纯 DSH 官方配置**（llm-pi-ai 自定义 provider + compat 三字段兜底 quirk）。**明写"这个端点我没账号、没试过，不保证它是 OpenAI 兼容"**，并留了后续帮看报错的口子 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2354#discussioncomment-18162764) |
| 991 | 项目添加多文件夹 | 拆两半：能做的（dsh-TUI `/add-dir`、官方 dsh-mcp-client 接 filesystem server）；**给不了的那半明确交还官方**——`sandboxPolicy` 只有解析没有写入面，所以他验收标准里"AI 只能访问已授权目录"外部插件保证不了边界 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/991#discussioncomment-18162772) |

| 4111 | 插件 UI 开关 + 免 key 搜索 | **两条诉求社区都有现成的**：`dshmarket` / `dsh-plugins-store`（插件市场界面）、**`dsh-web-search-searxng` 正是免 key**、DuckDuckGo 走 MCP。并指出 DSH 有官方 `ctx.web` 能力位，所以"内置免 key 搜索"架构上不需要新机制。**明写"动态挂载"那半仍是官方的事** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4111#discussioncomment-18162945) |
| 3602 | 失败截图 toast 每次切回来都弹 | 补 @ylwl1997 没提的一条：**0.1.1 宿主自己把图片块换成 `[image omitted …]` 占位而非硬拒**（同 #3643 的实证）。同样明写"我测的是分发层、你这个像是发送前准入层，先在会话副本上试" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3602#discussioncomment-18162950) |
| 522 | 接 yakit MCP 后所有新会话都报错 | **先诊断不推销**：给了三步排查（注释掉那条 mcp-client 配置 → 重启 → 确认是否恢复），并**要他贴报错原文而不是截图**。结构性观察（一个 server = 一个插件实例，挂不上就带崩会话启动，同 #902）放在最后，且明写"你是被卡住不是缺功能，不值得为此换掉官方 MCP 客户端" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/522#discussioncomment-18162951) |
| 132 | 用 Pi 手搓了个 CLI（Phi） | **盟友帖，零推销**：讲我们在从相反方向解同一问题，给了四条 Pi ABI 实测经验（锁死上游版本、`ExtensionFactory` 没有参数位、registerCommand 撞名、两个可用终端面），并把 #533 里 AWS 提的"缺机器可读事件通道"那个更关键的点转给他 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/132#discussioncomment-18162957) |

| 224 | 用 DSH SDK 替掉 dify/langchain | 确认可行 + 三点实测：① 能力插件不用全自己写（DSH 生态 + Pi 生态两个池）② 装配层的四个抓手 ③ **主动提醒 developer preview 跨版本会动**（列了三个我实测到的代际差异），建议把依赖的面写成契约测试。**并发那半明说答不了、别按我的猜测做架构决定** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/224#discussioncomment-18163158) |
| 3284 | 多模态与思考等级应可在 UI 勾选 | **他的数据模型已经在了**：`input: [text, image]` 与 `reasoningEfforts` 都是官方 profile 字段，缺的只是他画的那个界面。同时给他的提案补了个坑：**"声明不等于端点支持"，勾选框需要配提示**（#3559 就是这个坑） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3284#discussioncomment-18163162) |

| 2421 | 想要官方 Docker 镜像防 AI 误删文件 | **官方 Docker 是官方的事，但他的目的有原生答案**：DSH 有完整官方沙箱套件（`dsh-sandbox` / `dsh-sandbox-local` / **`dsh-fs-sandbox` 强制文件系统** / bash·pwsh sandbox / windows-acl）。**主动写了一句"不要拿第二个模型审批当安全边界"**——这类插件很容易被推荐成安全方案，实际不是。并如实说"我本人没实测过沙箱拦截效果" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2421#discussioncomment-18163429) |
| 743 | 接 gpt-daybreak-blue + kimi-k3，"還是月費舒服" | 订阅登录路径。**关键caveat**：四个内建 OAuth 入口里 `kimi-coding` 是唯一不能只靠宿主适配器承载的（凭据是 header 形态），要额外装 `pi-provider-kimi-code`。**明写"codex 我端到端跑过，Kimi 我没账号没验过，不打包票"**，并说"看你截图像是已经接上了，那就当我没说" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/743#discussioncomment-18163437) |
| 1028 | 构想把 Agent 服务与 Web 分离（作者在基于 Pi 重构 DSH） | **盟友帖**。讲了为什么我们没走重构路（跨版本会动、维护分叉成本），并给两条事实：① 终端形态已有两个包、**"想用 TUI 就得先拆服务"这个前提不成立** ② **真正缺的是机器可读事件契约**（转述 #533 里 AWS 的点），并分享我自己"屏幕文字不可靠、改读会话 jsonl"的经历 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1028#discussioncomment-18163443) |
| 4607 | ox alpha 配置不支持多模态 | 同 #3965/#3284 的 `input` 字段答案，但**给了他一个可执行的先决步骤**：先 curl 那个端点发带 `image_url` 的请求确认它收不收，再配——否则只是把"被 DSH 拦"变成"被端点 400" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4607#discussioncomment-18163448) |

| 794 | SSH 能力尽快增加（零评论） | **纯社区路由，零推销**：`dsh-remote-ssh`、BitFun Remote Workspace、`@linxin666/dsh-ssh`，并**转述 #90 里 @bobleer 的架构判断**（别只加一个 ssh 执行命令工具）。**明写"我原本想推荐 MCP，看完 #90 后放弃了——那正是他论证过不够好的那一种"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/794#discussioncomment-18163675) |
| 999 | 希望有 venv 式环境隔离 | **原生答案**：`--profile` 就是"插件组合"这一档隔离。给了四档对照表（workspace / profile / dsh-sandbox-tester / 容器）。**主动写明"子代理那类方案只能解决一半，给不了不同插件集"**——他原帖明确要不同插件，所以没往那个方向推 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/999#discussioncomment-18163678) |
| 4460 | 本地模型普通对话正常、改文件报错 | 判为工具调用协议对不上，给三类原因 + **指向 #4283 楼主贴出的那份跑通的本地 compat 配置**（不是我们的东西）。**明写"全是按现象推的、截图里的字我读不出"**，并列出三样需要他补的信息 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4460#discussioncomment-18163685) |
| 3967 | 求以 dsh 为底座的"一人公司套件" | **先说没有现成的**，再给 `dsh-plugin-radar`（7000+ 插件索引）让他自己按需求翻 + 一张七类积木表（全是别人的包）。**利益相关那段主动劝退自家 dsh-work-x**："它是开发向的组合，算不上一人公司套件，写在这里只是不写就成了藏着掖着，不是推荐你装" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3967#discussioncomment-18163693) |

| 708 | 让 dsh 自己装插件，装死了 | **先救急再解释**：remove 那条组合记录 / 直接编辑 `agent.cordis.yml`；解释根因（一条挂载失败带崩整个 profile，同 #522 #1404 族），并给两条预防（别让模型 git 直装、先在备用 profile 试）。**明说那个仓库我没看过、不评价** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/708#discussioncomment-18163932) |
| 4482 | 一次超过 5 张图把会话钉死 | 解释"图片进了会话日志所以每轮都撞同一堵墙"；三条按代价排的办法。**关键：把第 3 条标成"我的推断不是实测"**——"转文字后不受 image 上限约束"逻辑成立但我没拿几十张图验过 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4482#discussioncomment-18163936) |
| 3348 | 四条功能建议 | **开门见山说"只能答上一条半"**：① 语音转文字有 `dsh-file-upload`（但明说没端到端测过语音那条）② 长文本转附件**翻遍 npm 没找到** ③ 多窗协同给不了 ④ 购买渠道不是插件能做的 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3348#discussioncomment-18163945) |

| 4491 | 子代理强制 git 恢复，未提交代码丢了 | **数据丢失事故，先救再防**：按"有没有 git add 过"分两种情况给了 `git fsck --lost-found` 的捞法，**并明说从没暂存过的工作区改动 git 里没有副本、捞不回来**。防的部分给权限预设（把 shell 设 ask）+ `pi-rewind-hook` 线索，**但明写"这个包我还没在 DSH 上核证过，是线索不是推荐"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4491#discussioncomment-18164132) |
| 2186 | dsh-deep-research 派出 1100 个子 agent 卡死页面 | **先定责任方**：无界扇出是那个插件的行为不是 DSH 的。给三步恢复 + 用独立 profile 隔离 + 建议给那个插件提并发/总数上限的 issue。**全程零推销**（没提我们的子代理） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2186#discussioncomment-18164136) |
| 1838 | 开发插件把整个服务搞崩，要核心限制 | 给 `--profile dev` 隔离（今天就能用）+ 解释"一条挂载失败带崩整个 profile"并指向 #708 的详细步骤 + 官方沙箱（指向 #2421）。**明写三者都挡不住"改坏 dsh 自己的安装目录"，那要进程/容器级隔离，是官方的事**；并再次警告别拿模型审批当边界 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1838#discussioncomment-18164142) |

| 1063 | tokenhub 的 api key 用不了 | **纯官方配置**（llm-pi-ai 自定义 provider + baseURL 带 /v1 + model id 一字不差 + compat 三开关兜底）。**明写"tokenhub 这个服务我没账号没试过"、"你只写了提示错误，我看不到具体报什么"**，并要他贴报错原文 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1063#discussioncomment-18164373) |
| 1116 | 多个子代理都卡住、输出被截断 | **先纠方向**：@6thChoice 说"只有接 dpsk 不会遇到"是关键线索——问题在那条路由的流式输出，不在子代理机制，**换子代理运行时不会改善，这话我写在最前面**。给了两条可查的（显式声明 `maxTokens`/`contextWindow`、用官方路由做对照实验）。**明说"换自带传输的路由这条我一次没实测过，不能当建议"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1116#discussioncomment-18164384) |

## 自审后毙掉（29）

| # | 子代理判定 | 我的复核结论 |
|---|---|---|
| 3987 | `yes_today` / pi-subagents (0.65) | **毙。** 他要的是子代理用不同 Agent Preset 身份。查 `src/compatibility.ts` 的 `createAgentSession` 规则：我们的子代理**同样是"继承父的 standing composition（composeFrom），否则挂 roster 默认"**——正是他抱怨的那一点。我们能给的是 per-child model / thinkingLevel / 工具白名单，不是 preset 身份。回了就是越级。 |
| 728 | （workaround / pi-subagents 等级一） | **毙。** 症状是子代理完成通知残留成一条排队消息（纯 UI 状态、无数据损失），@Start-Gao 已给出完整时序根因并指出与 #274 同族。为一个残留提示劝人换掉整套子代理运行时，不成比例，且重复社区已答内容。 |
| 4161 | `yes_today` / rpiv-web-tools **等级二** (0.7) | **毙。** 两个问题叠加：① rpiv-web-tools 只到等级二（挂载+探针），从没端到端跑过；② 它注册的工具名就是 `web_search`，而语料里 #1113 报的正是"上游把 `web_search` 当保留名"——推过去可能当场坏掉。核实不了就不推。 |

| 3986 | `yes_today` / pi-subagents (**0.8**) | **毙。与 #3987 同一作者、同一正文的重复帖**（子代理指定不同 Agent Preset），毙的理由同 #3987。顺带一提：同一份内容子代理在 #3987 给 0.65、在 #3986 给 0.8——这本身就是不能采信它们判定的证据 |
| 2132 | `yes_today` / pi-subagents (0.7) | **毙。** @oricholcos 已给出正确且可操作的原生答案（前台/后台子代理之分，DSH 默认后台）。他的问题在 DSH 内部就能解，我们再劝人换整套运行时不成比例——与 #728 同一判据 |

| 3666 | `yes_today` / pi-subagents (**0.8**) | **毙。** @ylwl1997 已给出完整根因（创建期快照、指向 #3377）+ 可用绕法 + 日志验证方法。而且我 20 分钟前刚在 #4466 讲过同一套 pi-subagents 三级解析——同一时段往多个帖子灌同一段话就是刷屏 |

| 90 | `yes_today` / pi-mcp-adapter (0.55) | **毙，而且毙得很干净。** 楼里 @bobleer 明确论证了"别只加一个 ssh 执行命令工具，那样 terminal 在服务器、文件读取/搜索/Skill 发现/子进程还可能偷偷落回本机"——**我们的 MCP 方案正是他论证过不够好的那一种**。而 @Yan-Zero 已发布 `dsh-remote-ssh`（远端 SSH 作透明工作区）、@bobleer 的 BitFun 有 Remote Workspace，npm 上还有 `@linxin666/dsh-ssh`。推我们的等于推一个已被指出有缺陷的方案 |

| 933 | `yes_today` / pi-mcp-adapter (0.55) | **毙，双重理由。** ① @DRAG0NM 已给出极完整的答案：DSH **内置**完整可观测管道（会话 jsonl 结构化事件、`dsh-session-log-export`、官方 `dsh-session-telemetry-otel` 的 FULL/FEEDBACK_ONLY/DISABLED 三档 OTLP 导出），只是默认关闭。② **子代理推的 `pi-mcp-adapter` 跟"日志可观测"根本不沾边**，是明显的错判 |
| 1866 | `yes_today` / pi2dsh + llm-pi-ai (0.7) | **毙。** @denial123789 已经把实现读完并给出确定答案：创建门槛的四个条件、API key 可留空、**localhost 属于 DSH 宿主进程而非浏览器**这个关键边界，还附了手册页和 PR。我们没有任何增量 |

| 716 | `yes_today` / pi-provider-alibaba (0.55) | **毙。** 证据只有一张 rc.6 的截图、零评论，看不出 `missing required property "command"` 是 wire 层丢参数还是模型自己没填。我们能给的只有"走自带传输的 provider 路由绕开官方累加器"，而按 CAPABILITY-BRIEF 这类一律只能标 **结构性成立/行为未测**。拿猜测去回一个证据不足的老帖，不值 |
| 1765 | `yes_today` / @kassing/pi-vision (0.7) | **毙。** @shinjiyu 已给出完整诊断（GUI 准入按 `inputModalities` 拦，不是 glm-4.6v 不能看图）**并附了自己的插件 `dsh-plugin-multimodal` 和可直接执行的安装命令 + env 配置**。我们的伴生路由是同一形态的平行实现，在人家帖子里推自己的同款包，价值为负 |

| 2738 | `yes_today` / pi-subagents (0.55) | **毙。** 他的前提明写"主代理还有别的活要干"，要的是子代理返回**异步中途注入**成 steer。我们能背书的恰恰是相反的东西（`get_subagent_result` 阻塞等待）；**子代理返回是否能中途注入，我没有任何实证**。而且这已是短时间内第三条子代理帖，再推就是刷屏 |
| 4510 | `yes_today` / pi-approval-guardian (0.5) | **毙，两条理由。** ① 他要的是**计划模式真的拦住写入**，而 `pi-approval-guardian` 是**第二个模型来审批，不是硬边界**——拿它顶会误导，这跟我在安全类帖子上定的口径一致。② 原生正解应该是权限预设（`ctx.permissionPresets.set` 是公开写面），但我**没有实测证据**能告诉他该切哪个预设，没证据就不写 |

| 1303 | `yes_today` / provider 一族 (0.45) | **毙。** @ylwl1997 已给出完整省钱答案：DSH 本身免费、钱花在模型 API、PTC 前缀缓存、OpenCode Go 首月额度、Agnes 免费模型，还附了两篇算成本的文章。**他给的比我们能给的更具体（含价格和链接）**，我们零增量 |
| 3672 | `yes_today` / pi-opencode-go-provider (0.6) | **毙，而且理由很特别：@ylwl1997 推荐的解法就是我们的东西**（`dsh plugin add pi2dsh` + `pi-opencode-go-provider`），还引了 #3397 的干净 profile 验证。**别人已经替我们说了，我们再去说一遍毫无信息增量，还显得像自吹** |
| 3766 | （与 #3768 同一篇） | **毙，重复帖。** 已在 #3768 的回帖里指出两篇是同一件事，跟进合并到那一处 |

| 4435 | `yes_today` / pi-mcp-adapter (0.6) | **毙。** 他要的是 `dsh-subprocess` 的 env 白名单。我能想到的第二条路（把集成包成 MCP server、用它自己显式配置的 env）**本身就可能撞同一个坑**——#584 报的正是"env 被 `scrubbedParentEnv` 误剥"，而 pi-mcp-adapter 那条只有「结构性成立/行为未测」。**给一条自己都可能坏的路，比不给更糟** |
| 1670 | `yes_today` / pi-subagents (0.6) | **毙。** @denial123789 已给出极完整的答案（profile/overlay 选组合、AGENTS.md + skill 编码流程、专用工具包 compute-sanitizer、审批/沙箱插件强制边界、**subagent preset 承担专职角色**），还点出关键洞见："把成功契约做成工具门禁而不是提示词句子"。他连子代理那条都覆盖了，我们的增量只剩"换一套子代理运行时"，不成比例 |

| 4283 | `yes_today` / pi2dsh 网关 compat (0.55) | **毙。** 这是一篇 "Show and tell" 基准测试帖（Pi vs DSH 同一本地模型），作者**没有提问**、配置已经跑通、他用的 compat 字段正是我们验过的那几个（我们给不出新信息）。在别人的基准帖下说"其实你可以两个都要"，本质是产品推销。**记为值得结识的技术同行，但不该用回帖去做** |

| 3625 | `yes_today` / rpiv-web-tools **等级二** (0.6) | **毙。** @yunyunyunyunsuan 已给出高质量回答：三个插件的对照表（BrowserSkill ★1200+ 等）+ `dsh-plugin-radar` 插件雷达（收录 7000+ 插件、可搜可一键装）。**我们只有等级二的包，严格劣于已有答案** |
| 1985 | `yes_today` / pi-approval-guardian (0.6) | **毙。** @zoahdev 已完整回答，且抓住了本质："预设权限 = 把每次询问换成按类别放行，换的是摩擦不是安全"，并给了换预设/精调 permission-presets/按会话收紧/跑 doctor 四条。**我们的 guardian 是模型审批不是硬边界，在"信任与权限"这个话题上推它会误导**——与 #4510 同一判据 |
| 2734 | `yes_today` / pi-subagents (0.55) | **毙，两条理由。** ① 他要的是把**正在跑的前台执行**转后台，那是宿主的 UI 动作，我们给不了；我们能给的"一开始就用后台子代理"是**改变他的问题而不是解决它**。② **与我上一轮毙掉的 #2738 是同一作者**，对同一个人反复推同一套包就是刷屏 |

| 3863 | `yes_today` / @kassing/pi-vision (0.5) | **毙。** ① 问题本身太模糊——"点加号无法上传"看不出是按钮不工作、还是模型没声明 `input`、还是版本问题，零诊断信息；② 作者自己的唯一跟帖是**微信群二维码**，属半广告帖；③ 同批的 #4607 已经把 `input` 字段这条答透了，在广告帖下重复一遍价值低 |

| 3098 | `yes_today` / dsh-pi-tui (0.55) | **毙。** 楼里 @Mide69 已完整诊断并被楼主确认解决：`@deepseek-ai/dsh-base` 的 npm `latest` 标签停在 0.0.1-rc.1、真实版本在 `next` 下，显式指定版本号即可。**我手上有一个可以补充的独立佐证**（我核过 `dsh-client-ui-sidebar`、`dsh-web-search-deepseek` 也是同样的 latest 停在 0.0.1-rc.1），**但楼主的问题已解决，这个增量对他没用**——该发的地方是 dist-tag 那个专门帖（#2233） |

| 2831 | `yes_today` / provider 一族 (0.5) | **毙。** ① 不是提问帖，是成本对比分享；② **正文含 opencode go 的返利推广链接**（`?ref=`），在这种帖下接话容易变成替推广背书；③ 同类话题（省钱/换 provider）在 #1303 已被 @ylwl1997 完整回答过，我也已按同一理由毙过一次 |
| 291 | `yes_today` / pi-approval-guardian (0.5) | **毙。** @ivanusto 已在 rc.6 上**实测**给出定论，且结论与帖子标题相反：**stock headless 不会 hang，是 fail-closed（exit 0，明确报告拒绝）**；他还顺手证明了"一个约 30 行、注册 `approval/request` 监听器的插件就能让 headless 完全无人值守"——**连插件侧能做什么都替我们答了**，零增量 |

| 546 | `yes_today` / pi-subagents (**0.65**，队列里剩余最高信心) | **毙。** ① 第一条诉求"子代理回复要手动 steer 才能及时注入"与我上一轮毙掉的 #2738 是同一件事——**异步中途注入我没有任何实证**，我能背书的 `wait:true` 是阻塞等待，方向相反；② 第二条（默认带 Codex/Claude Code 风格 preset）没有现成包；③ ↑0，且我已在 #2682 讲过 wait-for-result。**信心分最高不等于该回** |
| 3930 | `yes_today` / @kassing/pi-vision (0.55) | **毙。楼主自己已确认解决**："rc2 原生支持……因为我使用了固定脚本启动，脚本锁定了版本，未使用最新的 runtime rc2"。楼里 @ylwl1997 和 @hytime 也已把 `input` 字段那条讲清楚 |

| 3830 | `yes_today` / @kassing/pi-vision (0.45) | **毙。** 实验版视觉模型（v4-flash-vision-exp-max）在思考阶段无限循环 `<hmm: >`，这是模型侧退化，**我没有任何实证**。唯一能想到的机制（`thinkingFormat` compat 不匹配导致思考块没被正确闭合）纯属猜测，而且他走的是官方实验模型 + 官方适配器，compat 不匹配的可能性更低。**证据不足不猜** |

## 第二个池：`no_dsh` 中带等级一 workaround（160 条）

口径固定：**"你的 bug 成立、该官方修；在那之前有条能用的路"**。同样逐条自审。

| # | 标题 | 依据 | 评论链接 |
|---|---|---|---|
| 4013 | 0.1.1 升级炸掉第三方插件（`prepareCall is not a function`） | **本池最高价值的一条，且与子代理建议的角度完全无关**。给了插件作者真正的修法：**不是自己实现 `prepareCall`，是继承**——把 adapter 建在宿主 `LlmAdapter` 基类上、走 peer 依赖，一份产物跨两代；并给了"探能力不探版本号"的探针写法，外加提醒他的提案该覆盖 waterfall 迁移和 attachment 重编码 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4013#discussioncomment-18164594) |
| 3821 | dsh-mcp-client 不发 MCP roots | **主动阻止一次错误切换**：我查自家兼容矩阵的"已知差异"，**`pi-mcp-adapter` 的 adapter 级 roots 上游本身就没实现**——换客户端解决不了。给的是绕开 roots 的官方解法（按工作区配 server 实例、显式传 `--path`），全程用官方 `dsh-mcp-client` | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3821#discussioncomment-18164598) |
| 3789 | supportsDeveloperRole 默认值 + UI 开关 | 旁证他的第 1 条：我们翻译 provider 时**显式写入 compat 而不走 `detectCompat` 名单**，因为名单是枚举、端点无穷。并把他的第 2 条**从"给 compat 加开关"扩成"表单缺了一整层字段"**（#3965/#3284/#4044 同源），指出这样提更容易被接受；第 3 条指出"400 无 body 被翻译成具体错误码"本身才是更该修的缺陷 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3789#discussioncomment-18164610) |

| 3468 | 推理模型上会话标题静默失败 | **纯官方配置**：① 先调大 `maxOutputTokens`（他自己的分析说 64 被 thinking 吃光）② 用 `llm-pi-ai` 给同一端点再声明一条只带 `reasoningEfforts: {off:}` 的路由，把 `session-title-llm` 的 provider/model 覆盖指过去。**明写"只声明 off 是否等于默认不推理，这个具体组合我没试过"**，并说静默失败那部分我们更帮不上 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3468#discussioncomment-18164806) |
| 3437 | WebUI 插件故障隔离提案 | **存在性证明 + 两条设计经验**（分级比二元有用、报错别替用户判断是不是核心能力）。**把"这条不覆盖你要的场景"写在显眼处**——我们只隔离经桥挂载的那批，DSH 原生 cordis 行仍是全有全无。另给这帖搜到的人一段恢复/预防办法（全是官方机制） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3437#discussioncomment-18164812) |
| 2979 | 空 id/name 的后续 delta 覆盖掉好的 | **本轮最该记的一条：我主动否掉了自家的方案。** 池里给的是"换自带传输的路由绕开累加器"，我回帖明写**别指望它**——他贴的帧的关键形状是"携带 `id:""`/`name:null` 而非省略"，**任何"有字段就覆盖"的累加器都会踩同一个坑，而另一个实现扛不扛得住我没测过**。并额外指出"agent 会自责并继续犯错"这个反馈回路值得单独提给官方 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2979#discussioncomment-18164818) |

| 2273 | SDK 运行时闭包缺 dsh-mcp-client + 无 plugins-ready 屏障 | **只答第 2 条（启动竞态），给了真正的屏障做法**：用官方 awaited waterfall `system-prompt/assemble` 卡住首轮，**并点出那个让我们调试过一轮的陷阱——`assembly.tools` 是在 waterfall 之前快照的，光 gate 不够、必须在同一个监听里用 `tools.schemas(agent)` 回填**；顺带建议他的提案要定义屏障相对快照的时序。**第 1 条明说"我没有有用的东西"**：第三方 MCP 包同样不在 SDK 闭包里，换包解决不了 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2273#discussioncomment-18165033) |
| 1263 | max-tokens 截断后 INVALID_REPLAY_STATE 会话永久报废 | 三点：① **已坏的会话换什么都救不回来**（replayState 已落盘）② 预防——显式声明真实 `maxTokens`，降低截断落在 tool call 上的概率 ③ **第三点是明确劝退我自己的方案**：换不经 llm-pi-ai 的路由结构上说得通，但"截断落在 tool call 中途"这个场景我没实测过另一条路由的持久化产物，**不拿推断当建议** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1263#discussioncomment-18165040) |

| 906 | thinking 模式要求回传 reasoning_content 报 INVALID_REQUEST | **把一句吐槽翻译成可配的东西**：这不是"不能切思维等级"，是回传契约没满足。官方 rc.8 compat 字段 `requiresReasoningContentOnAssistantMessages`（我们在 `src/provider-adapter.ts:477` 按 COMPLETIONS 协议翻译它）。**并分情况说清：自定义 provider 能加、内置 DeepSeek 路由改不了那就是 DSH 侧该修**；明写"配上能不能解决你这个具体报错我没在官方端点验过，是从报错文案反推的" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/906#discussioncomment-18165256) |
| 1244 | max-tokens 截断导致会话永久报废 | 与 #1263 是同一 bug 的两份独立报告，**证据互补**（他有持久化产物实测、#1263 有源码链路），已互相串联。强调他多给的那条事实：**fork 出来的会话也是坏的**——报废的是一整条血缘。给 maxTokens 预防；**再次明确劝退"换路由"那条**（指向我自己的东西，所以更该说清） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1244#discussioncomment-18165260) |
| 885 | llm-deepseek SSE `!== void 0` 判空 | **纯社区服务，零技术增量也零推销**：把同一根因的 **5 份独立报告**（#885/#879/#2979/#3052/#725）按证据类型列成表，指出"跨网关跨平台五份独立报告本身就是严重度证据"。补了一条对 patch 形状有用的细节：帧里 `id:""` 与 `name:null` 混着来，守卫要写成"仅非空字符串才覆盖" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/885#discussioncomment-18165268) |

| 566 | GLM-5.2 中文经常乱码 | **纯诊断，零推销**：给了一个具体可证伪的机制假设——UTF-8 三字节汉字被 SSE 按字节切块、解码器未跨块保持状态（英文 1 字节所以不坏、"经常"而非"每次"也吻合），并给三条验证办法（短中文、看 chunk 边界、关流式对比）。**明写"这是从症状反推的假设，我没在这条链路上实测过"，并明确说不建议换路由那条（它正好指向我自己的东西）** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/566#discussioncomment-18165447) |
| 345 | 重度用户的连环踩坑记录 | **只答我确实知道的三条，其余明说"不装懂"**：① 代理——转述 #1171 的实测（undici 默认忽略 HTTP_PROXY，要 `NODE_USE_ENV_PROXY=1` 且首次 fetch 惰性读取），并注明是转述不是我实测 ② 路径——从他的报错 `realpath 'D:\ai'` 指出是**多字节字符处截断**而非"不支持中文"，同族 #643/#1660，我们改不了 ③ 插件管理——`dsh-plugin-radar`/`dshmarket` 等社区包，并纠正"功能少"的说法（是默认组合薄 + 没有发现入口） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/345#discussioncomment-18165450) |

| 167 | headless 支持打印 session-id + --resume | **核心结论：入口缺失不是能力缺失**——`sessionQuery` 有公开的 `load/readSession/listSessions/traceSession`，改动量估计可以更硬（"把已有读回面接到 runner 入口"）。给了跨进程恢复的实测旁证。**并主动提醒他小心"跨会话记忆类插件"来顶这个需求**——记忆带回的是结论不是上下文，对他 CI 场景差别很大。明说我们加不了 CLI 参数 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/167#discussioncomment-18165668) |
| 684 | 后台子代理汇报晚于最终答复 | **他给的两个方向分开答**：(a) `get_subagent_result` 的 `wait:true` 有机制，**但明写"这是给模型一个能等的工具，不是让 loop 强制它等；你原话是'须先收齐'，那个'须'字我给不了"**；(b) 做不到，**且我说 (b) 才是对的修法**（(a) 依赖模型每次记得，(b) 是结构性的）。串联 #2192 指出两条投递路径本就没有统一调度与去重 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/684#discussioncomment-18165679) |
| 4564 | discoverModels 返回打包快照不探端点 | 确认根因 + **告诉他自己找到的手工 `models:` 就是当前最好的解法**；串联 #3672（pi-ai 被钉在 0.82.1）指出"内置 provider 目录可能落后两代"；给 `pi-opencode-go-provider` 时**特意说明是 @ylwl1997 在 #3672 独立推荐过、不是我上门推销**，并注明具体模型没试过 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4564#discussioncomment-18165683) |

| 4548 | dsh-tool-lsp 的 workspaceRoot 不可配 | LSP 换成 MCP server 承载（根目录由它自己的启动参数定，结构上不受 session cwd 约束），给了 npm 上现成的两个包 + 官方 dsh-mcp-client 配法。**三条代价写在明处**（工具名变了、能力集不同、这是换掉不是配置）。另给提案一个角度：**按"与 sandbox-policy / jobs-local 保持一致"来提，比按"我的 host 特殊"更容易被接受** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4548#discussioncomment-18165856) |
| 4538 | 想要 tool.call.toolview 的 select 谓词 | 三点：① **MCP 本身也是跨 host 契约**（Claude Code/Codex/Kimi/Pi 都支持），走 MCP 天然拿到独立 tool name 也就天然拿到独立卡片，不必为渲染注册模型可见的一等工具 ② **DOM 后处理先例存在但我明确不建议**（不是官方契约，宿主改 DOM 就坏且无契约层报错）③ **替他的提案预答一个会被打回的问题：多个插件同时 select 同一次调用怎么办** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4538#discussioncomment-18165859) |
| 121 | Windows 上 pwsh 缺必填参数刷屏烧 token | **先把两族报错分开**：`missing required property`（模型没填全）vs `unknown tool ""`（传输层抹掉工具名，#885/#879/#2979/#725），**解法完全不同、别照着那边试**。给两条立刻能做的（换模型判断是不是模型能力、别让它无限重试）。**并指出 `missing required property` 与 #1069/#201 的提权刷屏很可能是同一份 schema 的两种症状**。明说"我没有已验证的绕法"，连 MCP shell 那条都写明未实测、不当建议 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/121#discussioncomment-18165863) |

| 4350 | typert-generator 不认 DSH 0.1.1 的 Remote API | **直接解决了，而且不是兼容问题**：`npm view` 实证 `latest: 0.0.1-rc.1` 但 `next: 0.1.1-rc.2`——他装到了一年前的版本。**并给出系统性证据**：dsh-base / dsh-client-ui-sidebar / dsh-web-search-deepseek 的 latest 也都停在 0.0.1-rc.x，只有主包对；建议把这帖并进 #2233 推动"给所有子包打对标签" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4350#discussioncomment-18166056) |
| 4322 | 提案：插件工作区域 + 会话伴随栏 | **给他的提案补了一份实测座位清单当证据**：frame 层一共只有 4 个座位，`sidebar`/`conversation`/`details` 全是 **single 且已被占**（注册即替换），唯一 additive 的 `shell.overlay` 按设计是点击穿透的浮层——**"不是没人做过，是契约上就没有这个位置"**。另替他预答两个会被追问的点（与 `conversation.view` 的区别、工作区激活时审批/提问/附件的归属） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4322#discussioncomment-18166063) |
| 4417 | 多文件夹工作区 | **短帖，主要是把 #991 的结论指过去避免讨论分散**：能做的（`/add-dir`、官方 dsh-mcp-client 接 filesystem server）与**给不了的**（沙箱策略服务只有解析没有写入面，所以外部插件"做得出界面、保证不了边界"）。明说这一半必须官方做 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4417#discussioncomment-18166071) |

| 4412 | 已是 danger-full-access 时重申同模式被拒 | **我实测过的 `assembly.tools` 改写能力最贴的一个消费者**：会话已是 full access 时把 `sandbox_permissions` 从 write/edit/bash 的 schema 里摘掉，模型看不见就不会带，"not strictly wider"校验根本不触发。**明写"需要有人写插件、现在没有现成包，我给的是机制证明不是产品"**，并划清 schema 可改 / arguments 已证伪。另串联 #1069/#201/#121，指出**同一份 schema 正在制造至少三种失败形态** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4412#discussioncomment-18166295) |
| 4125 | 子代理路由到过期的模型路由 | 串联 #4124（那边是时间线与量化后果、这边是根因链路）；**强调后果被低估**——父会话没在用那个 provider，配额却被子代理打爆，属账单意外且难自查；给三级解析作**可行性佐证**，并明说"**不是让你换掉子代理运行时，那对一个已定位到源码的 bug 不成比例**" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4125#discussioncomment-18166299) |
| 4251 | 粘贴的图片被静默丢弃 | **给了一条可能改变他报告方向的线索**：同一个模型 id 在 #3559 是 **400 拒收**而非静默丢弃，所以"即使图片真进了请求也会被端点拒"——他现在看到的可能是某层提前摘了图片块。建议他先抓实际请求体区分"没进请求"还是"进了被拒"，并指出**真正该修的是"不许静默丢弃"**（#3559 至少还能看到 400） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4251#discussioncomment-18166313) |

| 4033 | 提案：切纯文本模型时遮蔽历史图片而非阻止 | **他提的方案可能已经实现了一半**：0.1.1 线上宿主 dispatch 自己就把图片块换成 `[image omitted …]`（我的跨代契约测试实证）。于是他的诉求可收窄成**小得多、更易被接受**的一条——`session.selectModel` 的 guard 可以放宽了，因为它防的失败已被下游兜住。**明写 guard 那半我没测过，让他先在 0.1.1 上试** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4033#discussioncomment-18166480) |
| 4025 | activeServerNames 是作用域不匹配的分析 | **跨帖综合**：「一个 MCP server = 一个插件实例」这个形状同时制造了四个已报症状（#3984 名字冲突 / #3768 列表全叫 mcp-client / #522 一条 server 挂不上带崩所有新会话 / #4145 畸形条目让 harness 起不来），**共同前提是 server 的身份、生命周期、故障域都被绑在"插件条目"这个粒度上**。并给被 #3984 卡住的人一条实用建议（重启清模块级 WeakMap） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4025#discussioncomment-18166485) |
| 3998 | 提案：MCP 图片与 ui_url 进 tool/result.meta | **存在性证明，且主动说他的做法更对**：我们走 attachment 通道、他提 `presentationMeta`——"**你那条更对**，图片作为工具结果的呈现附属物本就该是工具私有可回放载荷，而不是变成会话级附件"。另提醒他 PR 里要先写清相对 `ui_url` 的解析基准，那大概率是评审第一个问题 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3998#discussioncomment-18166493) |

| 3819 | 推理说调 X、动作层持续发 bash（1139 次调用 / 966 次空转 echo） | **又一个 `assembly.tools` 的真实消费者**：跑这类冒烟测试时把 `bash` 从模型可见工具表里摘掉，动作层没得发就只能发 `team_*`。**明写需要有人写插件、现在没有现成包**，并划清 schema 可改 / arguments 已证伪。**主动劝退"用第二个模型审批"**——那是用概率判断治概率失败，他需要的是确定性计数。指出他最有价值的观察是"一个总是成功的工具在 loop 里没有刹车" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3819#discussioncomment-18166725) |
| 3919 | write/edit 在 Google Drive 虚拟盘上失败 | **指出他现有绕法的安全代价**（用 danger-full-access 换文件系统兼容，等于整会话关沙箱）；给范围更窄的 MCP filesystem 方案，**但明写两点：MCP server 跑在 DSH 沙箱之外（是另一种信任模型不是回到 workspace-write）、我没在 Drive 虚拟盘上实测过**。并把真正的修法归还 DSH（DACL 复制失败应跳过、link 失败应回退 rename，属通用虚拟/网络盘兼容性） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3919#discussioncomment-18166733) |
| 3893 | settings.yaml 缺 api/baseURL 导致全部 provider 消失 | 给最小可用形状；**并指出真正该报的 bug 是后半段**——一处配置不全导致整段配置静默作废、UI 按钮死掉、终端零日志，**用户完全没有线索定位到自己刚改过 settings**。串联 #4145 的同类形态，建议把帖子重点改成"配置校验失败应有可见诊断" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3893#discussioncomment-18166741) |
| 3936 | 文件被写到工作区之外 | **从他自己的 trajectory 里找到反证**：运行时上下文明确告知了工作区路径，而 `g:\sandbox\` / `g:\workspace\` 是**模型自己编的目录名**——所以这是模型没遵循被告知的路径（本地小模型常见），不是 DSH 写错地方。给了可证伪的验证办法（直接给绝对路径看照不照做），并解释"by-passes security"的因果链是提权被批准所致 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3936#discussioncomment-18166745) |

| 3785 | 求"Deep diving…"旁边加可注入 slot | **用实测座位表精确佐证他的判断**：`turnTail` 的契约原文是 "The **completed** Turn Node's extension chain"、`assistant-actions` 明写附着在**已完成**的消息上——"回合结束后才触发"不是实现细节而是**写进契约的语义**，消息列确实没有运行中的座位。另给"今天能拿到 80%"的做法（`composer.dock` / `input.dock` 是活座位）**但强调位置本身是语义的一部分，不替代他的提案**；并提醒 list 座位要先说清多条目排序依据 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3785#discussioncomment-18166912) |
| 4198 | 中止子代理的收尾输出把 tool-call 块拼进 user 消息 | **跨帖模式综合**：这是"持久日志被写坏 → 会话永久不可用"的**第三种独立成因**（本帖 / #1263+#1244 replayState 不一致 / #885 一族空 callId 持久化），三个 bug 在三个包里、成因无关、结局相同。指出真正的杠杆可能是"**append-only 日志没有隔离/跳过/修复通路**"，有的话三条后果都从"会话报废"降级成"少一轮"。**并明说这次没有绕行方案**——我没测过自家路径在"带在途 tool call 被中止"时怎么拼收尾输出 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4198#discussioncomment-18166923) |
| 3713 | MCP 条目 env 里一个未定义值搞死整个 harness | 给嵌入宿主一条**今天就能加的护栏**（交给 harness 前滤掉 undefined），**并点出他要自己定的语义选择**（不传该变量 vs 传空串，对 server 行为可能不同）。同意真正该修的是另外两件，并建议**把"union 解析器丢弃分支 ValidationError"单独提**——那不是 MCP 特有的，是整个配置层的诊断质量问题 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3713#discussioncomment-18166927) |

**本池自审毙掉：**

| # | 池中标注 | 我的复核结论 |
|---|---|---|
| 3052 | workaroundLevel **"1"** | **毙，而且这是池子的标注错误。** 池里写"provider 全链含完整工具循环端到端实测过"——但那证明的是 provider 链路，**不是"pi-ai 自己的累加器扛不扛得住 name 为空串的畸形 delta"**。按 CAPABILITY-BRIEF 明令，这类一律只能标「结构性成立/行为未测」。而且这正是我在路线图 R1 里列为"第一步必须测掉"的那个未验证前提。另：他贴的证据是模型发出 `<invoke name="">` 这种文本式工具语法，也可能根本不是 wire 层的事 |
| 4006 | workaroundLevel "1" | **毙。** 他逐行读了 `toRecord`/`assertJsonValue`，要的是 llm-pi-ai 被修。我的增量只是"我们的 OAuth 存储走自己的 auth.json、不经那个边界"——**但 github-copilot 这条链路我没验过**（端到端验过的是 codex）。**对一个逐行读源码的人给未经核证的"换条路"，价值为负** |

| 2919 | pi-approval-guardian | **毙。** 他问的是**运行时是否强制**"不得投机性提权"这条规则（模型侧契约已经写了，他要的是 runtime 层的前置条件）。`pi-approval-guardian` 是**再加一个模型来审**，不是运行时强制——在安全语义帖上拿它顶会把"多一道模型判断"说成"多一道边界"。与 #4510 / #1985 / #2421 同一口径 |
| 2758 | pi-mcp-adapter + filesystem server | **毙。** @zoahdev 已给出完整排查路径（绝对路径、CJK 路径截断 bug #643/#1660、`--dump-config` 看组合后的值、以及该贴哪些信息）。**根因还没定，我们的方案是"绕开工作区另开一条读写通道"，属于绕路而非解决**；在根因未定时推绕路会让排查跑偏 |

| 2192 | pi-subagents | **毙。** DRAG0NM 是语料里定位最精确的分析者之一，这帖带源码行号定位了双投递路径 + 零去重 + 调度不对称。**换一整套子代理运行时，对一个已经指出补丁位置的缺陷报告不成比例**；而且"pi-subagents 在 report 工具场景下会不会双投递"我**没有任何实证** |
| 1920 | pi-approval-guardian | **毙，他已经预先驳过这类回答。** 原文明写："安全网是信任边界不是功能特性，插件按定义就是可选的——用户装了最小插件集就得零保护"。我们推插件正是他驳的那一类；而且 guardian 是**模型判断不是结构性保障**，在他这个"文件被批量清空、只因恰好有 git 才救回"的语境下更不该拿它顶 |
| 1236 | pi-approval-guardian | **毙，与 #1920 同一判据。** 他原文："问题不在工具没检测，而在警告只是提示、模型可以无视"——**他要的是工具层硬性行为**。池子自己的备注里都写了"它是模型判断而非硬规则，与他要的不符"，那就不该回 |

| 1198 | 自带传输的 Pi provider 包 | **毙，池子自己就写了"没在他这个模型+网关组合上实测过"。** 他的问题是网关间歇性不把 reasoning 作为独立块发出（chunk 统计显示含 reasoning 的 step 从 75% 掉到 5%），根因在上游或适配器解析。按标准这类只能标「结构性成立/行为未测」，不该回 |
| 1124 | pi-subagents | **毙。** @ZhangEnlin 给出了很可能是真根因的解释：**agent 后台起的 node 服务自测完没退出，所以任务确实还在跑**——不是状态显示错了。这种情况下推"换一套子代理运行时"是答非所问 |

| 879 | 自带传输的 Pi provider 包 | **毙。** 与 #885 同一根因且同一族，**我已在 #885 那边把含 #879 在内的五份重复报告串联成表**——技术上零增量，再发一遍就是重复刷屏 |
| 725 | 自带传输的 Pi provider 包 | **毙，而且我差点发错。** 我本来准备指出原帖那个 `(block.name ?? '') + call.function.name` 的拼接修法有缺陷（遇到 `name: null` 会拼出 `"lsnull"`）——**但读完 11 条评论发现社区早已发现并修正**：@Constantine1916 与 @TAOLI123666 都验证了正确的 `typeof name === 'string' && name.length > 0` 守卫，@Electricitysheep 还把"null 隐式转字符串根因"收进了手册 FAQ。**我零增量。这条正好说明"必须读完评论区"不是形式要求** |
| 225 | pi-mcp-adapter 接 shell MCP server | **毙。** @DRAG0NM 已给出完整诊断（三种可能：插件不在组合里 / 模型调的名字不对 / 传输层 id-name 覆写 #161），并向楼主要了定位所需的三项信息，**楼主还没补**。根因未定时推"绕开原生 pwsh 工具走 MCP"会让排查跑偏 |

| 476 | pi-subagents | **毙。** 他要的是 **DSH 的数据模型带上终态结局**（现在 `activity` 只分 running/inactive，源码注释自己写着 "Neither encodes a durable outcome"）。我们的增量只是"另一套运行时的日志里能区分 aborted / completed"——**对一个状态点颜色问题推换整套运行时不成比例**；且本批已回同族的 #684，避免连发 |
| 250 | pi-approval-guardian | **毙，而且是原则性的。** 这是一份**已复现的提权安全报告**：沙箱内的模型进程通过 loopback Web approval 通道**自批准** `danger-full-access`。**攻击者就是模型本身**——此时推荐"再加一个模型来逐次审批"作为缓解，是根本性错误的建议。与 #1330 立下的口径一致：安全帖上绝不拿模型审批当边界。真正的缓解在网络层（沙箱子进程不该够得到那个回环端点），那是 DSH 的事 |

| 4563 | pi-subagents | **毙。** 一份精确到源码行的性能分析（`persistence.list()` 全库扫 4311 个会话、扫两次、再整文件解压、prepared 缓存只有 5）。他要的是**那条加载路径被优化**。换子代理运行时既不修既有 4311 条会话的扫描，也不解决他点的那个原生 UI——答非所问 |
| 4524 | @kassing/pi-vision 伴生路由 | **毙。** 他**已经有一个合并进 fork 的 PR**，验证做得比我们细（77 后端测试 + 82 UI 测试 + 3997 GUI + 11 E2E + 28 道文档同步门），而且**没有提问**。我唯一的增量是"手工声明 `input: [text, image]`"——**他整个 PR 就是为了让这件事自动化**，显然早就知道 |

| 4503 | pi-approval-guardian | **毙，与 #250 同一原则。** 这是一份方法严谨的安全报告（macOS Seatbelt profile 只有 `deny file-write*`，unix socket `connect(2)` 不受约束，实证可连 Docker daemon 与 ssh-agent）。**攻击面是沙箱内进程的出站连接，缓解必须在 Seatbelt/网络层**；推"再加一个模型逐次审批"是把边界问题答成了判断问题 |
| 4407 | pi-mcp-adapter + ripgrep MCP server | **毙。** 他已定位到 `completeStdout()` 在 lossy read 时直接抛、而 subprocess seam 本就支持 collect-spill（bash/pwsh 已在用），并给了 ~40 行的修法。**要的是官方合入**；换掉整个搜索工具既不成比例，也会让他失去原生 grep/glob 的集成 |

| 4145 | pi-mcp-adapter 自有运行时管理 server 定义 | **毙。** 他的诉求是 `failOnStartupError` 这个 flag 的**契约与命名不符**（它治的是 server 启动失败，管不了条目配置校验失败），要的是官方改契约或改名。我的增量只是"换一种承载形态可能避开这类问题"，**而且我没测过畸形条目在那种形态下的行为**；他给的三个选项本身就是产品决策，不该由我们代答 |
| 4124 | pi-subagents 三级解析 | **毙，同族重复。** 与 #4125 是同一个 bug（子代理继承创建期冻结的模型种子）的两份报告，**我已在 #4125 把两帖串联**并说明各自贡献的证据类型。同一套说法在两帖各发一遍就是刷屏 |

| 4384 | pi-approval-guardian | **毙，与 #250 / #4503 同一原则（第三次）。** 实录的无人值守提权：agent 读源码发现本地 API 的信任栅栏只要求 loopback Host 头（代码注释自述 "explicitly not an authentication layer"），随后用自己的 shell 工具调 `commands/execute` 把权限预设切到 danger-full-access。**攻击者是模型、攻击面是无认证的本地 RPC**，缓解必须在认证/网络层 |
| 3984 | pi-mcp-adapter | **毙，但内容没浪费。** 它与 #4025 是同一件事的报告与分析，**我把实用建议（重启清模块级 WeakMap）和跨帖综合一并写进了 #4025 的回帖**，并在那里点名"给被 #3984 卡住的人"。两帖各发一遍就是刷屏 |

| 3800 | pi-subagents 后台子代理 | **毙。** 他要的是**断线后的自动恢复与 `interrupted` 状态语义修正**（已定位到 repair.ts 对 interrupted 只重试不自动恢复）。我能给的是"把长任务放进后台子会话"，但**浏览器/网络断线这个具体场景我没测过**（验过的是跨进程重启），而且核心诉求在 DSH 自己的 repair 逻辑里 |

| 3714 | pi-approval-guardian | **毙，两条理由。** ① 他**自己已经量化了修法**——实测表里就有"same, with a status epilogue appended → 2"，即追加状态尾巴就能拿回真实退出码，我零增量。② 这是"用户写的 block hook 静默失效"的控制面失败，**推"再加一个模型逐次审批"是错的形状**（与安全类同一判据） |
| 3954 | pi-subagents | **毙。** 他定位到的是 DSH agent registry 的 ownership 语义（continuation manager 用中立的 activation-owner scope 创建、子代理没有 runtime owner，于是 `roots()` 把它当顶级，`DELEGATED_CALLER` 守卫因此不触发）。**我没有任何证据表明我们经 `ctx.agents` 创建的子代理不会踩同一个 ownership 缺口**——没测过就不能宣称绕得开 |

### 池 2 批次 13（2026-08-27）

| 3568 | 无（纠正根因） | **本批最高价值：很可能纠正了根因归属。** 他把三段 `argumentsDelta` 归因为"重组断裂"，但我把它们拼起来是 `{"connection_name": 43-MySQL}` —— **值没有引号，本身就不是合法 JSON**，"解析失败退化成空 `{}`"完全能解释他看到的现象。给了两条区分实验（读最终 arguments 串、把连接改名成字母开头）；若坐实，诉求应改成"解析失败别静默退化成空对象"——**空 `{}` 让 server 报缺参、模型据此原样重发，17 步死循环正是这么来的**。明写全部由三段 delta 反推、没看附件日志 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3568#discussioncomment-18167074) |
| 3600 | 无（纯 pnpm/官方命令） | **同族踩坑经验的直接迁移。** 他定位到 pnpm `fetch-timeout` 默认 60s 吞掉 111MB tarball 而 `dsh plugin add` 仍 exit 0。我补三件：① **配置通道比配置值更容易踩**——我们自己给回归装置关 `minimumReleaseAge` 时 `.npmrc` 完全不生效、必须写 `pnpm-workspace.yaml`，所以先用环境变量 `npm_config_fetch_timeout` 排除通道因素；② `--force` 说 "Already up to date" 是因为失败的是下载不是解析，要 `store prune` + 删 node_modules，且**别在 profile 裸跑 pnpm**（我们立过这条规矩）；③ 把他的 `du -sh` 固化成安装后检查——同源于我们"回归产物必须能回答证明了哪个版本"的标准（起因正是 metadata 缓存装到旧版、我据此"发现"两个几周前的假 bug） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3600#discussioncomment-18167102) |
| 3566 | 无（纯 DSH 官方配置） | **等级一证据的纯配置解法。** `reasoningEfforts` 是 `llm-pi-ai` profile 的官方字段，手写 settings 就生效——被丢掉的只是"自动发现→自动填"这一环。给了 `off:/low:/high:` 的映射形状（左=DSH 档位名、右=wire 值），依据是 `examples/custom-gateways` **真 DSH loop 端到端跑过并进发版回归**。另把他的诉求从"给 `adopt` 补字段"扩成"**发现层归一化白名单应与 profile schema 同源**"（#3965/#3284/#4044 同源病灶），并写明手写只解决自己的端点、动态目录跟不动 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3566#discussioncomment-18167108) |
| 3751 | 无（佐证 + 修法建议） | **拿自家回归断言给他做独立佐证。** 他定位 `TOOL_RUNTIME_SCHEDULER` 模块级 `Symbol()` 在包被求值两次时身份失配。我贴出我们真机 E2E 里硬钉的两句——"profile 不许有自己的 core 拷贝"和"CLI 树里 dsh-agent 必须同版本线"——证明**"同一个包被求值两次"在 DSH 依赖布局下是必须每次发版主动检查的现实**；并指出他这条比我们的断言更狠（同版本、仅 peer 提升差异也能触发）。建议改 `Symbol.for()`（把身份从模块图搬到运行时全局，模块图恰恰是 pnpm 布局和打包分块都能改的），说清全局键命名空间与 `unique symbol` 类型窄化两个代价，外加一条 fail loud 兜底。明写 `Symbol.for` 那条没在 `dsh-tools` 上实跑 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3751#discussioncomment-18167113) |

| 3696 | 无 | **毙。** @argszero 已在 rc.8（`141eb6fef8`）上逐条核证，而且**纠正了原帖**：根因 1 成立但**不是静默的**（`applyOnce` 返回错误串、`setFailure` 会显示），真正的缺陷是**两阶段非原子**（settings 已提交 + `credentials.set` 失败 = 反向半成功）；三条里还有一条是设计意图不是缺陷。这已经是比原帖更准的分析，**我零增量**。且我们的凭证路径是 OAuth 走自有存储，对"设置页粘贴 API key"这个场景不适用 |

### 池 2 批次 14（2026-08-27）

| 3561 | 无（两代实测事实 + 跨帖归类） | **本批最高价值。** 他为"带图会话切文本模型被拒且无出路"写了 25 文件补丁。我给的是**我们契约测试里钉着的两代差异**：0.1.1 的宿主 dispatch 已不再拒绝，而是把 image 块换成显式 `[image omitted …]`（可见降级）——**上游的落点和他的 `[image removed …]` 撞上了**，而且这意味着 `selectModel` 那道栅栏可能已多余，他补丁能瘦一大圈。**明写我只验了 dispatch 层、没验 selectModel 栅栏**，并给出两种确认结果各自的提法。另把他的 zod-strip-`reason` 发现与 #3566 的两处并成**第三例"归一化白名单没跟着 schema 长"**，指出可统一修 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3561#discussioncomment-18167250) |
| 3795 | 无（论证） | **不用复现就能定的一条。** 他因"没确认 codex@0.147.0 是否总发 `phase: null`"而不敢下结论。我给两条：① **`undefined` 永远不可能是未来某个新 phase 的名字**（新 phase 一定是字符串），所以接受它**不削弱 fail-closed 一分**——现在这版是把"字段缺席"和"未知新 phase"两个处置相反的语义合进了同一分支；② **JSON 里没有 `undefined`**，落成 `null` 还是省略取决于 serde 的 `skip_serializing_if`，**是可在任意重构中被顺手改掉、不体现为协议版本变更的属性**——所以钉版本号没钉住表示法，文档的 `phase?` 才是权威。附我们 `reasoningEffortsOf` 的三态拆分实例与"跨通道白名单"铁律的事故由来 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3795#discussioncomment-18167259) |
| 3669 | 无（砍提案 + 设计意见） | **帮他把提案砍掉一半以提高被接受概率。** 他提"观察通道 + UI 渲染"两件事；我用 `pi-powerline-footer` 在 DSH Web 上真出现状态文本（截图脚本靠断言页面文本验证）证明**渲染面已存在**，缺的只是事件根本没被产生——建议只要数据通道，"加事件流"比"加事件流+定 UI"争议小得多。**明写我验的是能往 Web chrome 写状态、不是能往子代理工具卡内部写**。另指出他的 `code: 'codex-model-cache-schema'` **破坏了他自己声明的 provider 中立**（给了 `{provider, code}` 的改法），以及**从 stderr 文本合成结构化事件会随上游改措辞静默失灵** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3669#discussioncomment-18167265) |
| 3489 | 无（主动否掉自家方案 + 四帖归类） | **又一次主动否掉自家方案。** MCP 生命周期那半已有完整参考实现，我零增量；我只写**被两位显式 scope 掉的熔断那半**——他的数据是 67 次调用里只有 6 次是该错误，**生命周期缺陷造成 6 次失败、缺刹车造成了另外 500 多秒**。把 #3568/#2979/#3819/本帖并成**第四例"工具层给了模型无法据以纠错的反馈"**，并论证熔断的独特价值：**它不需要知道错误是什么意思**，因此对还没被发现的第五种根因同样有效。**明确不推荐换我们的 MCP 运行时**：我们验过的重连是传输层 `onclose` 触发的，**应用层 `-32001` 判定会话失效这个分支一次没测过**，很可能有同一缺口 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3489#discussioncomment-18167270) |

| 4239 | 无 | **毙。** 社区已完整闭环：@argszero 对 `b150a551b8` 逐条源码核证（`acquireOwnership:1162` 早返回、`notifySettlement` 丢通知、`agent/disposed:385` 不 drain、`liveLineage:881` 断在不可解析的父），@Jstn-1g 给出运行时复现 + 参考补丁，**楼主自己做了变异测试复核**（中和两处 `installParentDrain` 挂掉五个测试）并已采纳。纯 DSH core 的 ownership 语义，我零增量 |

### 池 2 批次 15（2026-08-27）

| 3114 | 无（第一手现状报告） | **本批最贴身的一条：我们就是他描述的那种"仓库外第三方插件"。** 他提 RFC 要让插件自己声明 settings namespace 可暴露，去掉 apiproxy 硬编码白名单。我给第一手证据：**dsh-x 的 Settings 页从没调过 `ctx.settings.register`**——UI 走 `settings.section` client slot（slot 体系对仓库外插件无白名单），数据自己拿 `ctx.webServer` 注册 `/pi2dsh` 前缀路由重写一遍。**绕得过去恰恰证明这不是安全边界只是摩擦**，代价是丢掉 `base` 分层/`applies`/`validate`/落盘语义——建议把这句写进动机段（比"要 fork 框架"更有力）。另两点 API 意见：`SettingsExposure` 字符串联合等于把白名单从 apiproxy 搬进类型定义（第三方 surface 不是假想，我们自己就投两个终端）；`expose` 标量粒度不够，凭证引用类 namespace 会被 owner 保守地全关 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3114#discussioncomment-18167380) |
| 3431 | 无（用自查的 slot 清单挡下一个回归） | **他的核心测量有结构性前提不成立。** 他要把 composer dock 改成硬 `nowrap` 并**移除 ellipsis + ResizeObserver**，论据是"701px 对 716px 还剩 15px"。我用自己清点的 43 座位表指出 **`conversation.composer.dock` 是 `list` 座位**——条目数不由他决定（他自己就提到第三方 `dsh-balance` 的计费 pill），装第三个贡献者这个数就不成立；而现状的省略号有个他要拿掉的性质：**任何条目组合下都不破版**。建议拆成两件卖，把他自己当"可选让步"提的降级路径提为方案本体，**这样评审不需要相信他的宽度测量**。**主动披露利益冲突**：我们也往那些座位写东西，算他这个方案的潜在受害者 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3431#discussioncomment-18167426) |
| 3446 | 无（运维手法 + 社区包指路） | 两位已核到很细（@argszero 修正了方案 A：`llm-deepseek` 注册的 provider id **就是** `deepseek-official`）。我补两件：① **把 hosts 里 `127.0.0.1 api.deepseek.com` 当发现工具而非阻断**——它把失败模式翻过来，**漏掉的路径会当场报错而不是次日看账单**，完全可逆，比吊销 key 温和，与"权威边界在 provider 侧"不冲突；② `searchProvider` 有**一整个社区 provider 生态**（npm 实搜：`dsh-web-search-searxng` 无 key 自建、`dsh-web-search-thirdparty`、`@yugasun/dsh-web-search`、两个 exa），所以 F2 不必留空——**"有免费无 key 的替代存在"本身就是论据**。③ 支持 @argszero 否掉方案 C，但指出方案 B 被低估：**伤害不是关不掉，是界面信号与实际状态相反** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3446#discussioncomment-18167433) |
| 3226 | 无（跨帖协调） | **纯协调增量，且直接影响补丁形状。** @zoahdev 定位的 `ModelListEditor.tsx:146-154` 的 `adopt()` **同一行还在丢另一个字段**——#3566 追的 `reasoningEfforts` 与本帖的 `inputModalities` 根因链条逐段同构（端点声明→发现层归一化剥掉→wire 无字段→adopt 不拷），他总结的"四处贯通"换个字段名一字不用改。建议把补丁提成**按 schema 字段集透传**而非为单字段逐处开道，则 #3566 同 PR 顺带修掉、下次加字段不再产生第三个帖。**同时写清反对理由**（白名单拷贝有防脏字段的道理，全量透传要多一层设计），定性为该先问维护者的方向题。明写我没实跑验证两帖同源，依据是各自已被独立核证的定位指向同一处 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3226#discussioncomment-18167435) |

| 3244 | 无 | **毙，两条理由。** ① 他的原话是"像这种比较底层的功能真没必要也靠插件"——**对一个抱怨"不该靠插件"的人推荐插件是根本性的答非所问**，无论推谁的。② 可操作的那半 @denial123789 已经答了（user-invocable Skill 用精确 kebab-case 名直呼、`user-invocable: false` 与 `disable-model-invocation: true` 是独立策略，附完整指南）。正文只有一句话、没有具体缺失清单，追问也没有比现有回答更能推进的抓手 |

### 池 2 批次 16（2026-08-27）

| 2911 | @kassing/pi-vision 伴生路由（等级一，有 example） | **首次给出"第四条设计形状"。** 他提的三条都建立在"主模型必须换"上；伴生路由是**主模型不动、图交给视觉模型、分析注入本轮**——恰好绕开他自己提的反对理由（价格/语气/工具行为/推理支持全不变）。**代价写在明处**：多一次调用 + 主模型读到的是二手描述，**任何要盯像素的任务都做不了**，定性为"另一个权衡点不是更好的方案"。另两件：① 把他"10 个标 vision 的模型只有 2 个真能用"的实测**搬去 #3226**——@nhype 的 `capabilities.vision` fallback 会把那 8 个全标成可用；② 提醒 0.1.1 的 dispatch 做静默替换，**明写我只验了分发层没验 api-proxy 准入层**，建议他自己确认哪层先生效 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2911#discussioncomment-18167581) |
| 3045 | 无（跨平台归类 + 正确层次缓解） | **把 WSL 洞归成一整类，并接上 macOS 那份独立报告。** 一般化他自己那句"bwrap 管不到 Windows 进程"：**沙箱约束的是进程自己能做什么，委托给沙箱外的执行者时一个越权 syscall 都没有**。与 [#4503](https://github.com/deepseek-ai/deepseek-harness/discussions/4503)（Seatbelt 只 deny file-write，`connect(2)` 不受约束→Docker daemon/ssh-agent）并成对照表——**两个操作系统、同一原理，比任何单份都更能说明沙箱模型漏了一维**。用户侧给 `[interop] enabled=false` + 单开发行版（**关转发本身 >> 枚举 .exe 黑名单**）。对他建议 3 提保留：argv[0] 匹配易绕（`/init`、`wsl.exe -e`、软链、`cmd /c`），适合当审计信号不适合当边界。**第四次写"攻击者就是模型，再加一个模型不构成边界"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3045#discussioncomment-18167586) |
| 2915 | 无（答无人应答的提问 + 第四例归类） | **先答 @nkhanhquoc 那句没人理的 "How to continue process?"** ——把 #2913 里 @sylvesterkaczmarek 的 8/15 修复指过来，关键是它**让错位的 replay state 降级成 provider-neutral 重放而非永久报废**，所以升级后被污染的会话可能直接能继续。**明写我没在被污染会话上实测过**并请他回来反馈。技术增量两条：① 根因的真正教训是 **replay state 与持久内容从同一份数据的两个不同版本各自派生**，只要派生源不同迟早漂移，正解是从最终持久内容派生；② **防御性检查没有恢复路径就是陷阱**——与 #3561/#3568/#3489 并成第四例对照表，并指出 8/15 那个修复恰恰是"给不一致加降级路径"而非消灭不一致，**这是通用解法不是个例** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2915#discussioncomment-18167589) |
| 3030 | 无（拆故障模式 + 定性升级） | **他复现步骤第 3 步里的"或"其实是两种故障，而他的修法只治一种。** 空闲桌面标签页=中间盒回收（服务端 ping 有效）；锁屏手机=OS 挂起整个应用（**对端没在运行，谁来回 pong**）——而且他提的"漏 N 个 pong 就 terminate"**会主动杀掉本来切回前台就能用的手机连接**，把"可能已断"变成"保证已断"。保活与探活在移动场景互相打架，建议右半交给客户端 `visibilitychange` 主动重验。另一条：**丢的是审批提示，审批是安全控制面**，建议把 Impact 从"UI 体验问题"改写成"安全提示投递不可靠"——**同一份证据，定性不同优先级完全不同**。明写移动端那段是推论不是实测，并给了他十分钟可测的事实 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3030#discussioncomment-18167594) |

| 2913 | 无 | **毙，同族重复。** 与 #2915 是同一个 `INVALID_REPLAY_STATE` 的两份报告，**#2915 有精确根因定位（`max_tokens` 截断时 `BlockAssembler.blocks()` 过滤而 `toPiReplayState` 用未过滤输入）且下面还有一个无人应答的求助**，我已在那边把两帖串联、把本帖 @sylvesterkaczmarek 的 8/15 修复指过去、并注明两条路径可能不同源。同一套说法在两帖各发一遍就是刷屏 |

### 池 2 批次 17（2026-08-27）

| 2873 | 无（座位表佐证 + 自家 single 代价案例） | **本批最富的一条，且我是利益相关方并已披露。** 他要 root-scoped 加性导航座位。我用自查的 43 座位表佐证并**补上他漏掉的一个**：frame 级唯一加性座位是 `shell.overlay`（list、点击穿透），可当今天的临时落点。核心增量是 **`single` 座位的真实代价案例**——`sidebar` 是 single ⇒ 想加东西只能整个替换 ⇒ 于是有了 `dsh-better-sidebar` ⇒ **想上侧栏的插件都得依赖它**，`single` 必然催生一个"二级平台"，装两个替换侧栏的插件只有一个能赢（我们的子代理面板就卡在这条链上）。背书 @tianhao8687 的 `shell.page` 类比 `settings.section`（我们真在用），**并警告 `settings.section` 只给 UI 一半、数据面在 apiproxy 白名单里**（接 #3114）。把诉求线程从他列的 4 条扩到 **7 条**（补 #4543/#4594）。**明确披露 #4543 是我们提的、我不是中立第三方** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2873#discussioncomment-18167711) |
| 2414 | 无（拆帖 + 根因 + 绕法） | **主要增量是"你的标题埋掉了最严重的一条"。** 第 3 条 `read` 静默丢行（`totalLines` 报 1771 只返回 1482）→ write 腰斩文件（`git diff -12,462`）**与死循环无因果**，就算看门狗做出来也照样毁文件，而躺在《死循环》第 3 项里必然被当成循环的附属现象——建议单开帖、标题直写后果、并**主动附最小复现别等人要**。第 2 条给了具体根因（Windows CRLF，grep 保留行尾 `\r` 导致 `$` 匹配失败）和**当场可用的绕法 `\r?$`**，并说明验证成功即等于替维护者确认根因。第 1 条点破**看门狗掩盖问题**（只做刹车会把"卡死"变成"跑 80 轮放弃、文件改一半"，后者更难发现）。最后把五条重排为"工具报错没携带调用方据以纠错的信息"一条主线 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2414#discussioncomment-18167719) |
| 2470 | 无（标题削弱了他自己的发现） | **他的标题写"GUI 冷恢复后"，但他自己的复现 A 明写"无需重启"。** 2b（GUI 选择器）只要求"换过一次模型"——**是每个用第三方 provider 的人每天都做的动作**，影响面比冷恢复大一个数量级；而维护者按标题分诊很容易把修复圈在 resume 路径上，**修完 2b 完好无损**。对 @Cfomodz 的"重复"给了更有用的处置：**五份报告并成一张证据类型表**（五个人五种配置撞同一行代码，只有并起来才看得出来）。结构观察：`parent.options` 与实际路由是同一事实的两份副本、只有一份会更新——与 #2915/#3226/#3566 同族。**利益相关全摊开后明确劝阻换运行时**（一行改动的事不值得换整套） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2470#discussioncomment-18167725) |
| 2373 | 无（运维风险警告） | **他已自己实现 3/4 并按 #2376 反馈把 `oneOf` 改成独立参数名、第 4 项自查后如实撤回**，技术上我零增量。唯一补的是他那套 `node_modules` 覆盖补丁的**静默还原风险**：`dsh plugin add` / profile 重装 / 升级都会让 pnpm 从 store 重建，**四个包悄悄变回官方版、无报错无提示**，表现是"多行命令又开始报错"而他当时多半在查别的。给了 `apply_dsh_patch.ps1` 加只读校验模式的做法（特征字符串探测 + fail loud），依据是我们自己的 `file:` 拷贝缓存事故与"装完必须回读比对"的规矩。附赠 BSD grep 对打包超长单行静默失败的坑 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2373#discussioncomment-18167732) |

| 1627 | 无 | **毙。** @denial123789 已给出比我在 #2915 写的更完整的答案：四步链路全部带 commit 锚定的源码行链接（`stream.ts#L188-195` / `assembler.ts#L128-139` / `agent.ts#L373-389` / `replay.ts#L159-167`）、**精确到触发条件**（不是任意 `length` stop，而是"撞上限时响应里已开始产生 tool call"）、**四条恢复建议**（含"从截断前的 assistant message 创建分支"——正是我在 #2915 只敢标为"值得一试"的那条，他给成了确定建议）、以及修复方向。我零增量，且这已是本族第三帖 |

### 池 2 批次 18（2026-08-27）

| 2107 | 无（给活跃调查加一个没人查过的输入） | **本批最高价值：五人已深挖到 arm 1，我指出闸门有两个乘数而讨论只覆盖了一个。** `thresholdTokens = contextWindow × thresholdRatio`——@labmimors 三条臂全围绕左边的 token 计量，**而 `contextWindow` 这个乘数从头到尾没人验证闸门实际拿到的是不是 98304**。依据是我们一手踩过的坑：DSH 用两条 seam 描述模型（`listModels` 管目录成员、`resolveModelInfo` 管每条路由容量），**只读前者会拿到 undefined 然后静默落内置默认**，而下游压缩正是 `model.contextWindow || 128000`——闸门被抬高正好解释"计量没到门限、provider 已经拒了"。给了可证伪的验证步（问 `llm.resolveModelInfo`，回 98304 就干脆排除）。并指出这是本帖第二次出现"组合层面正确、运行时无效"。**明写我没读过 compaction-basic 源码，第三节是假设不是结论** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2107#discussioncomment-18167850) |
| 2283 | pi-mcp-adapter 取消（等级一实测数字） | **用一条实测把他清单里的未知项去掉。** 他把"为 MCP 工具提供取消支持"列为待实现；我给实测数字——**中止 DSH 工具调用能在 2 秒内取消一个 5 秒的 MCP 操作**，MCP 协议本身有 `notifications/cancelled`，所以这是他那张长清单里**最容易先落地、且能验证建议 1 整体设计**的一项。**明写这是另一套 MCP 运行时的实测、不是 `dsh-mcp-client`**。另**反对他的建议 3**：`interruptMode` 开关的"cancel"承诺取决于每个工具配不配合而非开关，**只在部分情况兑现的强承诺比诚实的弱承诺更难用**；建议 1 本身已给出恒定语义（一按就还控制权，清理异步进行）。第三条把他的变通方案升格为论据：`jobs` 是公开 Context 服务，**说明同一运行时里后台能立刻杀、前台不能，是语义不一致而非缺能力** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2283#discussioncomment-18167846) |
| 1993 | 无（同族第三例 + 外部佐证） | **报告这个失败类还有第三个未修实例。** @zoahdev 已用 `Symbol.for` 修了 #1697 和本帖；我指出 [#3751](https://github.com/deepseek-ai/deepseek-harness/discussions/3751)（`TOOL_RUNTIME_SCHEDULER` 模块级 `unique symbol`）是同机制第三例且**触发条件更宽**（不需要 source launch，pnpm peer 提升或打包分块即可），列成三行表建议一次提。**这正是我今天在 #3751 建议 `Symbol.for` 的独立印证。** 另给楼主"方向 1"（globalThis 登记身份 + 重复告警）一条外部佐证：我们被迫在回归里实现了它的粗糙版（从文件系统数 core 拷贝），并指出**`Symbol.for` 修的是"重复了也能工作"、检测修的是"重复了至少有人知道"**，后者一次覆盖所有还没被发现的实例 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1993#discussioncomment-18167854) |
| 1877 | 无（可用绕法 + 汇合指路） | **给他一条今天就能解掉"设置卡片永远 loading"的绕法**：白名单挡的是 settings 数据面而非 slot，UI 照常注册 `settings.section`、数据改走 `ctx.webServer.register` 自有路由——**卡死的原因是在等一个永远不来的 `settings.describe` 响应**。代价照写（丢 `base`/`applies`/`validate`/落盘语义，这恰是该修的理由不是已解决的证据）。另把他引向 [#3114](https://github.com/deepseek-ai/deepseek-harness/discussions/3114) 的完整 RFC，并**把"被卡住的真实插件名单"整理成表**（sampling-sliders / smart-route / 我们的产品页 + friendly-errors）——RFC 最难自证的就是有真实消费者，而他是消费者本人。第 2 条明说零增量，只指出他"已有稳定 code、无需解析自由文本"那句是最强论据 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1877#discussioncomment-18167865) |

| 1968 | @tintinweb/pi-subagents steer（等级一） | **毙，社区已完整闭环且有人在走官方通道。** @alex04130 已实现零 hack 的 client 插件（劫持 Ctrl/Cmd+Enter 路由到 `agent.steer`，官方 InputBar 完整保留）并端到端验证 steer 在**同一轮内**送达；@zoahdev 已交付 [RFC 草稿](https://github.com/zoahdev/dsh-docs/blob/main/docs/rfc/subagent-steer-channel.md)（`subagent/steer` 事件 + 去掉 `steeringAvailable` 门禁 + 三级验证计划 + open questions）；@Electricitysheep 已收录进手册。我们的子代理虽有等级一的 mid-run steer，但**他们要的是 DSH 原生 Composer 能指挥原生子代理**，换运行时答非所问；且 7 条评论已覆盖我能说的全部 |

### 池 2 批次 19（2026-08-27）

| 1289 | 无（我们自己的源码就是证据） | **他写"Polling is the only option"，我给第一手证物：我们就是那个只能轮询的插件。** 贴出 `dsh-x/src/mcp-tab.ts:118` 的 `setInterval(pull, 4000)`、`side-chat.ts:156` 的 2000，以及我们源码里的注释 "the client half **polls** it"——**4000/2000 两个数字毫无依据，纯粹是猜，这就是缺推送通道的税**。两处真实功能损失：① 侧边面板跟子会话 2 秒明显偏钝，而快慢是同一个旋钮、代价无条件付出；② 另一行注释 "a cached answer would freeze the thread mid-turn"——**拿不到"变了"的信号就连缓存都不敢做**。对提案两点意见：支持 `client/push` 形状（逐插件加白名单与 `WEB_SETTINGS_NAMESPACES` 是同一反模式，那边已有人被逼到运行时改写宿主文件）；**`channel` 应强制包名前缀并校验调用方身份**，否则撞名表现为"我的数据偶尔变成别人的"——与 #1697/#1993/#3751 的 `Symbol.for` 族是同一类全局命名空间问题。**披露我是直接受益者**（落地当天就能删掉那两个 setInterval） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1289#discussioncomment-18168007) |
| 1845 | 无（座位表佐证 + 两帖诉求冲突预警） | **发现同一个座位有两个方向相反的需求方，且两边互不知情。** 先用 43 座位表佐证他的前提：`turnTail`(chain) 和 `assistant-actions`(list) **契约上都在 turn 结束之后，运行中那一刻消息栏没有任何座位**——不是他没找对 API。核心增量：[#3669](https://github.com/deepseek-ai/deepseek-harness/discussions/3669) 盯的是同一行文字但要**让它显示更多产品信息**（重试 3/5、transport 切换），而他要**让插件替换它**——按他提的 `single` 落地，**轮播诗词的插件会把重试和降级一起盖掉，用户失去了却不知道**。建议改 `chain`（与隔壁 turnTail 一致，产品状态作链起点），并复用 #2873 的教训说明 `single` 会催生二级平台。肯定他 `startTime` 那个 prop，建议把 #3669 要的 `phase/activity` 也纳入 owner props——**两个提案合成一个契约的两部分而不是抢座位** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1845#discussioncomment-18168011) |
| 903 | 无（风险提示 + 安全绕法 + 拆帖建议） | **本族第三帖，但这帖有别人没有的东西：他们正在出货一个运行时改写宿主 `lib/index.js` 的自愈式 hack。** 列四条后果：① **"更新后自愈"意味着上游若因安全收紧 allowlist 会被静默改回**；② 多插件并发改写同一文件是损坏不是合并；③ 只读安装/容器/MDM 下静默失败；④ **任何做过软件审计的组织看到这条会直接拒，是可分发性的实打实损失**。另附 #2373 刚踩的坑：`dsh plugin add` 会让 pnpm 从 store 重建、插入被静默还原。给出不碰宿主文件的替代（slot + `ctx.webServer.register`）并照写代价。**建议把 BOM 那条从 "Bonus" 里拆出来单独开帖**——失败形态是**半更新的 profile**（依赖写进 package.json 但 bundles 没对齐），比设置页少一个 section 严重得多。把六个被卡住的插件列成表送去 #3114 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/903#discussioncomment-18168020) |
| 902 | 无（一般化根因 + 指出最贵的那半） | **他已自查到 `ensureStanding()` 的未实现 TODO 并给了必现路径。** 我补两点：① 把根因一般化成通用规则——**effect 写进比自己活得久的地方（进程级 registry/globalThis/模块级 Map）时，"忘记 dispose"就不再是泄漏而是直接弄坏下一次加载**；普通泄漏一年发现不了，这种下次热重载就爆。附我们整套挂载都走 agent-local `ctx.effect` 靠 scope 自动 unwind 的设计理由（只要有一处需要"记得"就一定会漏）。并指出那条 TODO 的目标（等最后一个 agent 消失再回收）正确但复杂，**而冲突现在就发生**，可先只撤全局注册表那部分。② **这个 bug 最贵的部分是被吞掉的报错**——后端返回的 `agent-preset-invalid` 消息里 preset/loader/包/冲突/文件全有，前端却只闪回未选择状态；**同一个失败带报错是十分钟、不带是一次逆向工程**，且修复成本远低于代际回收、收益覆盖所有 `ok:false` 路径 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/902#discussioncomment-18168030) |

| 1703 | 无 | **毙，本族第四帖且已被更彻底地解决。** @argszero 对 master `47f943859b` 全链核证，确认楼主的 "possible cause" 完全正确并把失败点收敛到一个函数，逐段给出行号（`replay.ts:63-91` / `stream.ts:188-195` / `replay.ts:160-167`），还补上了本帖相对 #1627 的增量——**"继续"会扩写同一条 assistant message 的持久内容、超出被冻结的 replay state**；楼主自己也补了两条实用变通（把 bootstrap `maxTokens` 从 1024 提到 16384；截断后别点"继续"改发新消息）。我在 #2915 写的那套（恢复路径 + 防御性检查无恢复路径=陷阱）在这里零增量 |

### 池 2 批次 20（2026-08-27）

| 780 | examples/gateway-compat（等级一，录制代理证据） | **本批最高价值：给一个今天被卡住的人立刻可用的解，并可能让提案本身作废。** @yannicksong0106 正被 `unknown variant \`developer\`` 400 卡住；我给出纯 DSH 官方配置的 `compat.supportsDeveloperRole: false`，证据是**透传录制代理录到的真实 body 里 `"role":"system"` 而非 `"developer"`**（不是读类型推的）。更硬的一条：我们那张映射表钉着 `satisfies Record<keyof PiAiCompatProfile, …>`，**编译通过即证明这两个键在 `PiAiCompatProfile` 上已经存在**——所以建议楼主先确认提案是否已被合掉（给了三种可能各自的处置）。**明写我只验了 entry 级、route 级没测过**。另背书他"探测封不住第三方端点"那段并附我们的同款规矩（显式写 compat、不走 `detectCompat` 名单） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/780#discussioncomment-18168139) |
| 2593 | 无（机制深挖 + 更硬的写法 + 沙盒建议的 Windows caveat） | **要害不是"`$home` 只读"而是"赋值失败不会停下来"**：给只读变量赋值是 non-terminating error，默认 `Continue` 下脚本继续，**于是拿着旧值去执行破坏**——这个形状比变量名普遍得多，建议加通用规则 `$ErrorActionPreference = 'Stop'`。给了比"换变量名"更硬的模式：**删你刚创建的那个路径**（`New-Item` 返回的 `.FullName`，操作系统给的真实路径不可能是主目录），并说明这正是我们回归装置造临时 DSH_HOME 的做法。**对 @Sutera-Diffusus 的沙盒建议给必要 caveat**：隔离是真边界（赞成），但 [#3045](https://github.com/deepseek-ai/deepseek-harness/discussions/3045) 实测 WSL2 上 `workspace-write` 可被 interop 穿透、而本帖危险命令恰恰就是 `powershell.exe`——"最坏只炸掉沙盒自己的 home"在 WSL 上需先验证。对他建议 4（正则拦）提保留，建议把分量让给建议 2（解析路径比对祖先黑名单） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2593#discussioncomment-18168146) |
| 2485 | 无（把诉求形状往前推一步） | **"补一个 `; exit $LASTEXITCODE`"治不住这个类。** 他和 @sjh9714 的两条洞原因完全不同（运行时退出码 vs 解析时事件名不被遍历），**结果一模一样：一份"加载了、跑了、什么都没拦住"的配置**。真正该提的是：**enforcement hook 的裁决无法确定时默认必须阻塞不是放行**——① 与 shell 无关，换一种 shell 就得重打一次补丁，"不确定就拦"一次覆盖全部；② 方向正确，安全控制 fail open 是缺陷本身；③ **让剩下的问题变得可见**（fail closed 后用户当天就来报"总在拦"，现在是"从来不拦"没人报）。把他的 canary 固化成运维自查，并附我们"装完必须回读比对"的同源规矩与假 bug 事故。另建议把他括号里那句相对路径按 caller cwd 解析**单独列成第 3 条**（不需要空格即可触发、最容易被漏） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2485#discussioncomment-18168153) |
| 740 | 无（接他自己无人回应的两条补充） | 主帖已被 @udsy19 决定性更正（符号是 `registerModelDiscovery`、按 settings namespace 建索引、唯一调用点在 `dsh-llm-pi-ai`），我零增量；**只接他评论里没人理的缺陷 2/3**。缺陷 3 应定性为**"一次工具调用中断导致会话永久损坏"**而非"错误处理不健壮"，并入那张"检查/投影本身正确、但没有恢复路径"的表——**这是第五个独立实例**（本条 + replay-state 三帖 + #3561 + #3489 + #3568），且 replay-state 族的官方修复恰恰是"给不一致加降级路径而非消灭不一致"。缺陷 2 指出 `Cannot read properties of undefined (reading 'prepare')` **至少有两个成因**（他的工具名 vs [#3751](https://github.com/deepseek-ai/deepseek-harness/discussions/3751) 的 `TOOL_RUNTIME_SCHEDULER` 重复实例），给了区分实验（换个正确工具名试试），**明写我判断不了他踩的是哪个** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/740#discussioncomment-18168157) |

| 618 | 无 | **毙，社区已完整闭环。** 楼主给了可 cherry-pick 的分支与 commit、48 个测试通过、三条验收；@zylos-luna 独立确认了最微妙的那一处（**必须写回同一个 disposer map**——`registrationFailure: 'throw'` 时 `startConnection` 不接返回值，原地恢复才能让调用方手里的 disposer 仍指向活世代），@Xilink-Lin 复核了被否决的两条备选并指出唯一残留风险（restore 自身再抛无兜底）。我们虽有另一套 MCP 运行时，但**"重同步替换阶段冲突时会不会保留上一世代"这个具体分支我一次没测过**，按标准不能宣称绕得开 |

### 池 2 批次 21（2026-08-27）

| 2374 | 无（自查手法 + 官方路径 + 归类）；录制器为可拷走的独立脚本 | 三件：① 两个陷阱各给一条 curl 自查（看 `content-type` 是不是 `text/html`、拉 `/v1/models` 看真实 id 大小写），**结果可直接贴回帖当证据**；② 他"DSH 原样发送 model ID"这一环是推测，给了 [`recording-proxy.mjs`](https://github.com/weijiafu14/pi2dsh/blob/main/examples/gateway-compat/probe/recording-proxy.mjs)——**不是假网关**，真转发真流回、只多存一份请求体，**独立单文件拷走就能跑、不需要装我们任何东西**；③ 指出他引的是 `dsh-llm-deepseek`（DeepSeek 专用适配器），而 `llm-pi-ai` 才是为任意 OpenAI 兼容网关设计的官方路径，**明写我不知道换过去能否让 `/v1` 那个坑更好诊断**。归类：`STREAM_CLOSED` 的问题是**解析器把"喂错了内容"当成了"什么都没有"**（HTML 对 SSE 解析器是合法输入、零事件），与 #3568/#740 同族，建议把他的 fix 1 写成通则 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2374#discussioncomment-18168231) |
| 1992 | 无（对在飞补丁的 review） | **给 @zoahdev 的 cherry-pick 补丁提一条具体风险。** 他把 `input` 加了一层"按 model id 从全局 catalog 继承"，已小心隔离协议（api/baseUrl 仍来自路由），**但能力事实也会错，且错的方向是放行**——而这个 setup 的定义就是**翻译反代**，id 相同不代表这条链路能力相同。引 [#2911](https://github.com/deepseek-ai/deepseek-harness/discussions/2911) 的实测（10 个标 vision 的模型只有 2 个真能用，最坏两种是收钱返 400 和收钱返空），**同时说明两者来源可信度不同、不等价**。三条建议：可关、可见（区分"声明的"与"猜的"）、**按错误代价分层继承**（`contextWindow` 猜错只是压缩时机不准，`input` 猜错产生真实失败请求和真实账单）。另指出楼主第三个 workaround 正是这个补丁的手工版、同样会继承到不成立的能力。串成同族第四帖 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1992#discussioncomment-18168235) |
| 1331 | 无（提升他被低估的那条 + 补第三个边界） | **他的第 1 条被低估了。** 一般形式是**执行环境向消费者谎报自己的强度**——模型收到"命令成功"，据此推断"我被约束住了"，而 partial 下这个推断不成立却无人告知。与 #2485（hook 加载了跑了什么都没拦住）、#1967 同族。建议把第 1/2 条从"pwsh 提示"提升为通用契约（`enforcement` 非完全强制时必须在每次受限运行的结果里如实声明），理由：**下一个 partial 档出现时不会有人记得再打一遍补丁**。补 Windows 第三个边界 [#3045](https://github.com/deepseek-ai/deepseek-harness/discussions/3045)（WSL interop 完全绕过，不是部分强制），建议 enforcement 声明覆盖"这条路径根本不经过沙箱"。**特意肯定他用 `ctx.approval` 人批而非模型批**，并建议默认 `false` 别改（批准疲劳会让门的实际强度回到零、且同样不可见）；指出他"非 allowed-once 一律失败关闭"与 #2485 的 fail open 恰成同仓对照，本身就是论据 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1331#discussioncomment-18168236) |
| 1967 | 无（平台 caveat + 分诊线索） | @zoahdev 的分诊正确，我只补**"配个沙箱就行"在 Windows 上的两个已知窟窿**：① windows-acl 档本身标着 `enforcement: 'partial'`（#1331），**且这些边界对模型和运维都不可见**，配上之后可能照样看到工作区外写入而界面毫无提示；② 若在 WSL2 下跑，#3045 的 interop 可完全绕过——**他截图是 C:/ 与 D:/ 跨盘符，这条直接适用**，并给 WSL 侧缓解。另给一条比读轨迹更粗但更快的分诊判据：**重定向/`Set-Content` 类 = shell 路径；工具卡上能看到完整 `content` 参数的整文件写入 = fs 工具路径，那才是真 enforcement bug**——两条路结论完全相反，他补充原因时这一条最有价值 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1967#discussioncomment-18168239) |

| 2263 | 无 | **毙。** UX 观点帖、零评论、无具体缺陷证据。我唯一的实质增量是他"bonus"段落里点名的 vision-bridge 附件接入槽——**那正好是我们的能力，在一个纯 UX 提案下接这段就是推销**。剩下能说的两点都不够格：① `conversation.composer.bar` 是 `single` 座位（第三方要加附件入口只能整个替换）——同一条我已在 #2873/#1845/#3431 说过三遍，这里边际价值接近零；② 他"文本模型贴图会在发送时才失败"的前提在 0.1.1 上可能已变（宿主 dispatch 改为替换成 `[image omitted …]`），**但我只验过分发层、没验 api-proxy 准入层**，而他描述的正是准入层那条路——按核证等级不许拿未验证的事去纠正别人 |

### 池 2 批次 22（2026-08-27）

| 2910 | 无（补一条已上线的 workaround + 座位表佐证） | **给他的调研补上第四条 workaround，而且它正是他那套设计的存在性证明。** [`@puji4810/dsh-mermaid`](https://www.npmjs.com/package/@puji4810/dsh-mermaid) 占 `root` 客户端入口、对渲染后 DOM 做后处理（`language-mermaid` → 就地换 SVG、跟随 `prefers-color-scheme`、逐图超时、失败保留源码），`dsh-tikz` 同族。三点价值：① **fence 语言标签模式在真 DSH Web 上端到端跑通的证明**，比"Jupyter 这么干"更有说服力；② 他那三条不变量（不改会话记录 / settled-only / 失败降级）已有实现在跑；③ **它的脆弱点正是最强论据**——依赖宿主 DOM 形状，改个 class 就静默失效，"能做但只能靠 DOM 耦合"比"完全做不到"更有力。**主动交代我自己一开始也判错、是搜 npm 才发现的**。另佐证他的注册表形状（`single` 会催生二级平台，渲染器是典型多方参与位），并建议把 RFC 拆成"机制"与"内置渲染器"两半，防后者拖住前者 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2910#discussioncomment-18168313) |
| 1144 | 无（家族普查 + 加固他的短期方案） | **本族第七帖，我在这里做全族合并。** 列出七个线程 / 十三个以上具名插件 / 至少三份独立 patch 脚本（含 #903 那份**运行时改写宿主 `lib/index.js` 且设计成"更新后自愈"**的），并把我们自己也算进受害者（从没调过 `ctx.settings.register`）。核心增量：**他的"短期方案"比长期方案更值得先推**——逐条对上 #1196 引的官方设计笔记那三条暂缓理由，profile patch 方案**不动 seam、零注册点受影响、不需要脱敏路径**，因为**"部署方在自己配置里写一行"和"有人改 api-proxy.ts"在信任模型上是同一件事**，笔记坚持的"暴露仍是 Host 的决定"完全保住。建议提成独立提案（可追加不可替换、默认值不变、插件不能自加），与 #3114 的 RFC 并行不冲突。第三节给今天被卡住的人那条不改宿主文件的绕法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1144#discussioncomment-18168323) |
| 597 | 无（血换来的佐证 + 一个决定落地路径的提问） | **他选的 `agent.ctx` 挂载正是我们绕一圈才回到的形状。** 交代我们曾越界 fork Core 加 `agent/setup` 并整个废掉，两条理由都与他场景直接相关（`setup(agentCtx)` 是创建者独占参数、root 插件够不到；且天生漏声明式 Agent），最终落到官方 `agent/created` → `agent.ctx` → `ctx.effect` 自动 unwind——**没 fork 任何东西**。关键提问：他给 `ToolRuntime.register` 加"显式保留的注册上下文"**是不是一处 core API 变更**——若是，必须先进上游、无人能作为外部插件提供，提案该显式标注；若只是要在异步续体里用那个 agent 的 ctx 注册，**持有 `agent.ctx` 调 `agentCtx.tools.register` 归属就跟着走**（我们全程如此，没碰过签名）。第三节给时序提醒：**`assembly.tools` 在 assemble waterfall 之前快照**，注册归属对≠首轮可见，官方 awaited waterfall 可收口；并提示他复用 `serverName` 会更频繁进入抢占判定、需确认与 [#618](https://github.com/deepseek-ai/deepseek-harness/discussions/618) 的交互 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/597#discussioncomment-18168330) |

| 1196 | 无 | **毙，同族重复（settings 白名单第七族）。** 它最有价值的资产是**官方设计笔记原文**（`.agents/notes/.../2026-08-10-web-plugin-configuration.zh.md`，把"用注册期暴露声明取代白名单"列为暂缓备选并写明三条顾虑）——**我已把这段原文搬进 #1144 的回帖并逐条对照，论证 profile-patch 方案恰好全部绕开**。零评论、无被卡插件实例，在这里再发一遍同样的话就是刷屏 |
| 1183 | 无 | **毙，同族重复。** 独有资产是 `dsh-auto-continue` 及其已发布的 `scripts/patch-expose.mjs`（第三份独立 patch 脚本）——**已收进 #1144 那张七帖对照表**。提案内容与 #3114 的 RFC 高度重合而更简略，我能说的（webServer 绕法、家族规模、信任模型论证）全部已在 #1144 / #3114 / #903 / #1877 说过 |

### 池 2 批次 23（2026-08-27）

| 2822 | 无（推翻"无 workaround" + 类型系统佐证） | **他明写"无可用 workaround"，而其实有一条。** DSH 配置面确实无法移除 header 名（他对），但可以在 DSH 与网关之间放一个只删这一个 header 的本地透传器——给了我们那个独立单文件 `recording-proxy.mjs`（拷走 `node` 直接跑、不装任何东西），改动就是转发前 `delete headers['session_id']`；并说明这是绕过不是修复、且顺带能看到 DSH 真发了哪些 header 用于验证修复。**第二件是类型系统佐证**：我们的 `satisfies Record<keyof PiAiCompatProfile, …>` 要求穷举每个键，而表里**没有 `sessionAffinityFormat`**——独立证明这个字段不在类型上（与 #780 同一手法，那次证明"有"，这次证明"没有"），并指出这个编译门可当上游落地状态的廉价探针。第三件：把他发现的"Completions 有 `sendSessionAffinityHeaders` 开关、Responses 没有"提为最有价值部分（诉求从"加配置项"变成"两协议策略不一致且一方无出口"），并接上 #780 的同一论点（自动探测只能枚举一方端点） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2822#discussioncomment-18168397) |
| 2639 | 无（拆诉求 + 倒推方法论） | **建议把"已有权威晚期入口"的部分从诉求里拆出去。** 他说 setup 不够，要重解析"模型路由 + 工具限制 + 角色策略"三样；我给出分表：**工具组合与 persona 今天已有权威晚期 seam**（`system-prompt/assemble` 是 async waterfall、返回值权威，`assembly.tools` 的已有条目可改写不只是追加——这条是真组合上跑探针实测的），**只有 provider/model 那行我没有证据**。若属实，RFC 可收窄成"只请求 activation 发布前重解析路由"，比"给我一个替换全套策略的新 hook"容易通过得多。第二节给**倒推方法论**（正推 vs 倒推 + 三次实证 + "说不能之前必须说出数据流断在哪个具体符号上"），并把它变成他能自己做的一个具体问题。第三节背书他"不要复制子代理生命周期"那条并**主动劝阻换我们的运行时**——明写 followup/retry/cold-resume 三种 reason 的重解析**我没有实测断言、不能宣称做到** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2639#discussioncomment-18168406) |
| 2575 | 无（接上 #1289 + 措辞建议） | **他在证明症状、#1289 在提通用解法，两边互不知情。** 给第一手佐证：我们的 `setInterval(pull, 2000)` 就是为了跟一个正在跑的子会话，**正是他说的第 2 条**；还有那行"不敢缓存否则会冻住 mid-turn"的注释。措辞建议是核心增量：**别要"周期性快照"（那是把轮询搬到服务端，没事发生时也要付钱，周期还得由 DSH 来猜），要"变化事件"**——而且 jobs 那半可以表述成极小的一句：**`job.detail` 运行中更新时也应触发已经存在的 `notifyChanged`**，不需要新机制新帧新周期，"补一个漏掉的调用点"比"加周期性推送"好过太多；并指出他这帖其实是两个不同大小的诉求（补调用点 vs 新增推送面）。第三节说明 OS 通知兜的是另一半（**他的场景是用户在场**，通知不响也没用），防讨论滑向"装个通知插件就行" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2575#discussioncomment-18168409) |
| 2239 | 无（把他自己埋掉的第 3 条挖出来） | **settings 族第八帖，但我只为一件事而来：他的建议 3 是全族唯一不需要 RFC 就能做的。** 其余各帖（含他的 1、2）都要注册期暴露声明——改 seam 契约、复核全部注册点、先有脱敏路径（官方笔记三条暂缓理由）；**他的第 3 条一条都不沾**，只是"别把已经产生的错误丢掉"。收益却是整族级：**十三个以上插件作者各自独立走过"点了没反应→怀疑自己→最后找到 apiproxy 常量"这条路，而后端每次都清楚说了 `settings-not-exposed`、客户端每次都扔了**。建议提到最前或单独开帖（现在挂在"命名空间不能暴露"的标题下，分诊时会跟着主诉求一起等 RFC，而它本可以下周就合）。附**"后端说清楚了、前端把它扔了"第七例对照表**（本帖 / #902 / #2485 / #2374 / #3568），并提炼成工程规范：任何 `ok:false` 都必须有一条到达用户的路径 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2239#discussioncomment-18168415) |

| 2185 | 无 | **毙，社区已完整闭环。** @DRAG0NM 已定位根因（continuable 后台子代理在 turn 结束调注入的 `report` 工具时，父会话会收到内容相同的两条投递：settle notice 与 report relay）并给出完整源码定位与修复方案（另帖 #2192，含 steer 走 next-step / followup 走 next-turn 的不对称，解释了楼主看到的重复**和**顺序倒置）；楼主已确认根因与自己的复现完全吻合并认可修复方案 A。我零增量 |

### 池 2 批次 24（2026-08-27）

| 1888 | 无（三条机械障碍的设计评审） | **他提"按任务自动装插件、结束自动卸载"，我指出三条今天就成立的墙，其中一条会让 assemble 把它想帮的会话弄坏。** ① 插件挂载在启动时，装完不重启不生效（我们自己的安装经验）；② 运行中热插入有已知破坏性 bug [#902](https://github.com/deepseek-ai/deepseek-harness/discussions/902)（旧代际不 dispose → 进程级注册表撞 already registered → 新建会话失败直到重启），**他的特性会把"偶尔手工踩到"变成主干路径**；③ **最严重**：自动往 profile 装任意插件正是 [#1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697) 的触发条件——装任何依赖 `dsh-tools` 的插件（**哪怕同版本**）都可能让整个 profile 每次工具调用都失败，**受害的不是新插件而是原本工作良好的一切**，且失败非诊断性、**任务结束自动卸载也撤销不了伤害**。好消息是该前提可离线检测（两个社区 doctor 都有），**若做必须装前检测**。建议把重心从"自动"挪到"可控"、identify 那步单独成立、并指出 assemble/cleanup 无法作为插件实现。安全部分：若由模型决定装什么，那是**从模型输出直达代码执行**，边界只能是人确认包名或预批准白名单 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1888#discussioncomment-18168480) |
| 1514 | 无（定性升级 + 同边界第二/第三条失效路径） | **不只是控制流 bug，是审计记录不实**：日志里写着 `decision: stop` 而工具真的执行了——**肯定地记录了一件没发生的事**，比缺失记录更严重（合规结论错向安全方向、排查时主动误导 hook 作者去查别处、且静默）。建议标题同时点出这一层。第二件：把 [#2485](https://github.com/deepseek-ai/deepseek-harness/discussions/2485) 的两条并进来做成三行表——**裁决产生了吗 / 被记录了吗 / 被执行了吗**：本帖(✅✅❌)、Windows 退出码读不出(✅❌❌)、事件名不在支持列表里从不遍历(❌❌❌)——**用户配了 deny hook 今天有三条独立路径得到零强制，三条都不出声**，该修的是这个边界缺少"我的强制真的生效了吗"的可验证性。第三给出可证伪自查（无条件拦截的 canary hook） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1514#discussioncomment-18168485) |
| **3751（补发更正）** | 无 | **主动更正我自己 8 小时前给的建议。** #1697 是同一符号同一失败的另一份报告且已完整解决。我当时给 `Symbol.for` 时列了两个代价，**漏了最重要的第三个**（@moonquake2004 在那边指出）：`Symbol.for` 拆掉共享键的同时**也拆掉了版本屏障**——版本错配今天会响亮崩溃，换成共享键后会变成**静默的跨版本错配**，更难查。正确形状是 @zoahdev 升级后的**共享键 + 协议版本守卫**（导出 `TOOL_RUNTIME_SCHEDULER_PROTOCOL_VERSION`、每次 prepare/finalize/finish/dispatch 前 `assertSchedulerProtocol()`）。另转达两个可现在就跑的离线探针与 @yzke 报的第二个实例（旧版 `dsh-system-prompt` 遮蔽宿主致内置 `minimal` 预设挂不上），建议把讨论并去 #1697 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3751#discussioncomment-18168492) |
| 1745 | 无（安全前提 + 拆提案） | 肯定他最关键的设计（**策略是部署方配置，模型与任务文本不得influence**；非法值 fail plugin load 不静默回退）。核心增量是必须写明的安全前提：**`approvalPolicy:'never'` + `sandbox:'workspace-write'` 的保障 = workspace-write 在那个平台上的真实强度**，而 [#3045](https://github.com/deepseek-ai/deepseek-harness/discussions/3045)（WSL interop 完全穿透，实测删 26.8GB 零审批）与 [#1331](https://github.com/deepseek-ai/deepseek-harness/discussions/1331)（windows-acl 标着 `enforcement: 'partial'` 且边界不可见）说明它并不一致——**配置项让部署方选一个字符串，而这个字符串在不同平台兑现的强度不同且无处告知**。主动写清边界反而更容易通过评审。两个小建议：把 `sandbox`（几乎无争议）与 `approvalPolicy:'never'`（需论证）拆开卖；把当前失败形态的用户可见表现展开（与 #3600 的"配置在别处、报错在这里"同族，本身是更便宜的独立改进点） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1745#discussioncomment-18168498) |
| 1759 | 无（指路 + 变通） | 一句话的用户抱怨、零评论。给他 [#2283](https://github.com/deepseek-ai/deepseek-harness/discussions/2283) 的完整根因（**DSH 的"停止"是排空语义不是取消语义**——"Abort stops starts, drains and commits started calls"，信号只在步骤边界和启动新调用前检查、从不在执行中的调用内部检查，所以前台子代理虽是协作式但结果仍要等回合结束才提交），以及今天能用的变通（`run_in_background: true` + `job_kill`，`jobs` 是公开服务、`kill` 是正式方法）。建议他去那边补一条 PTC 模式的独立复现——**一个提案带几份不同场景的复现比几个零星帖有力**。明写我没用过 PTC 模式、没复现过他的场景 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1759#discussioncomment-18168502) |

| 1697 | 无 | **毙，社区闭环得比任何一帖都彻底。** 8 条评论走完：楼主实测两份同版本副本的 symbol 不 `===` → @zoahdev 定位 `packages/core/tools/src/index.ts:466` 并给 `Symbol.for` 一行修法 → **@moonquake2004 指出 `Symbol.for` 会拆掉版本屏障、把响亮崩溃换成静默跨版本错配** → @zoahdev 升级为共享键 + 协议版本守卫并给出行为矩阵 → 两个独立 doctor 工具各自实现 `profile-shadow` / P5 检测并**双向验证** → @yzke 补第二个实例（`dsh-system-prompt` 遮蔽致内置预设挂不上）→ 长文复盘。**我不但零增量，还从这帖学到我自己在 #3751 漏掉的那个权衡，已回去补发更正** |

### 池 2 批次 25（2026-08-27）

| 1491 | 内建 OAuth + `/login`（等级一，subscription-login example） | **在他提新 slot 之前先告诉他上游可能已有一个登录注册面。** 核证事实：**0.1.1 线新增官方 `dsh-authorization`（登录 flow 注册面），但 stock 组合只带包不组合服务、没有任何 stock 面调 `begin()`**（rc2 组合 dump 93 项无实证）。因此同一诉求有两种提法且难度差很远——"新开一个 slot"vs"**把已有的 `dsh-authorization` 组合进 stock、让 Models 页成为它的消费面**"，建议他先读接口再决定。附我们自己的接法作为"这个注册面够用"的旁证（组合了官方服务的宿主上，桥把每个 OAuth provider 注册成 `pi2dsh/<id>` flow 进原生登录注册表，官方 sign-out 的 `deleteRecord` 能删掉我们存的登录，与 llm-pi-ai 的 catalog flows 各占 scope 共存）。肯定他的安全边界并指出"token 不进浏览器 ⇒ 契约面很窄 ⇒ 更好卖"。给两个今天可用落点（`settings.section` + 命令面板）并附 settings 数据面白名单的坑。**明写我没读过 `dsh-authorization` 的完整接口** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1491#discussioncomment-18168588) |
| 1215 | 无（用实测机制帮他少 fork 一块） | **他 fork 了 64 个文件，其中一组改动可能不需要。** 给两条实测结论：**❌ `tools/pre-execute` 改不了原生工具参数**（核心在策略之前就把 arguments 记进日志，有意为之）；**✅ `assembly.tools` 的已有条目可改写**（在 `system-prompt/assemble` async waterfall 里改 `description`、从 `parameters.properties` 删字段都能落地）。所以**在 assemble 阶段把 `sandbox_permissions` 从原生工具 schema 里摘掉，模型看不见就不会再发**，"升级被拒→重试"从源头消失，普通插件即可做。**边界写死**：摘字段=彻底放弃 escalation，只对他这种 `approval never` 无人值守成立；需要真升级的部署仍要他那条 consumer 侧修法，**两者不是替代关系**；且明写我没在 Codex subagent 路径上试过。第二件：他的第 3 条（结构化 code/status 被压扁成英文 `errorMessage`）并入**"结构化信息被中间层压扁"第四例表**（本帖 / #3566 / #3226 / #3561），并加粗他那句"不因供应商改文案而改变重试语义"——**靠文案做控制流=把重试策略外包给对方的文案编辑** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1215#discussioncomment-18168594) |
| 1249 | 无（同一监督器的三条通道对照） | **他踩的盲区不是孤立的。** @FirmaSpring 定位重连预算只被传输层 close 驱动、而 EPIPE 从通知路径内部抛出逃逸监督器；我并入 [#3489](https://github.com/deepseek-ai/deepseek-harness/discussions/3489)（应用层 `-32001` 同样看不见）做成三行表：**三条失败通道只订阅了一条**，后果分别是正常重连 / **整个进程崩溃退出** / 陈旧工具死循环。把诉求从"我这个场景要修"提到"监督器需覆盖它所有的失败入口"，并附 #618 让维护者看到这是一个面。第二件：fail-loud 策略本身没错、错在适用范围——**对宿主自己的不变量对，对第三方插件 I/O 路径意味着任何一个 MCP server 的进程意外都是全局单点故障**；接上 #3437 并指出本帖是那个提案最强的论据（**不是降级，是宕机**）。给了未验证的换传输临时办法并标注"没试过"，附 #1697 的装插件风险 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1249#discussioncomment-18168599) |
| 1202 | 无（三帖并成一个缺失字段 + 可行性确切答案） | **同一个 `ready` 在两个界面被渲染成两个相反的东西**（#476/#478 绿色"已完成" vs 本帖"还在跑"）——不是两个渲染 bug，是 `activity` 里**没有终态结局字段**（源码注释自述 "Neither encodes a durable outcome"），于是每个消费面各猜各的；做成对照表并指出**唯一正确的语义只有 `list_agents` 能看到、不出现在用户面前**。第二件：用我清点过的公开服务面给他"清除动作"的确切可行性——**归档 ✅ `workspaceRegistry.archiveSession` 公开可调（今天就能做）**、**取消归档 ❌ 无对等方法（所以按钮必须按不可逆设计）**、**永久删除 ❌ `SessionPersistence` 无 delete/forget（他手工删目录那件事没有公开 API，是真缺口）**，建议三条分开提。结尾明确劝阻换运行时（不成比例，且不会让已在磁盘上的记录消失） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1202#discussioncomment-18168601) |
| 1015 | 无（拆掉"文档外衣") | **他的第 2 条穿着"文档缺口"的外衣，里面是行为缺陷。** "凭据缺失→401→工具静默不注册"不是没写文档，是**失败没到达需要知道的人那里**——用户看到的是"这 agent 怎么变笨了"，因为模型不会说自己少了工具。并入**静默失败第八例**（#2239/#902/#2485/#1514…）。建议拆成两个诉求：文档那半照补很便宜；**行为那半单独开帖、标题直写后果**，理由是"放在'建议补文档'的标题下会被当文档任务排期"。附 #4145 指出这是同一个 `failOnStartupError` 的第三种失败形态。第 1 条补一层安全收益：没人说密钥该放哪时，用户会写进 `settings.yaml` 或**会被 `--dump-config` 原样打印的 `cordis.patch.yml`**，所以文档收益应写成两层。末尾给自查：**"server 进程活着"与"它的工具在模型手上"是两件事** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1015#discussioncomment-18168604) |

### 池 2 批次 26（2026-08-27）

| 524 | 无（实测机制可能直接关掉他的几个缺口） | **他问"能不能有一个事务性时点让 retriever 安全改变下一次请求可见的工具集"——我认为这个时点今天已经存在。** 两条实测：`system-prompt/assemble` 是 **awaited async waterfall、装配时跑、返回值权威**；**`assembly.tools` 的已有条目可改写不只是追加**（改 `description`、从 `parameters.properties` 删字段都落地）。逐条对上他的审计：可逆激活天然成立（只作用于这一次装配、不需要 undo）、模型可见 schema 与执行权威可分离（正是 @Yan-Zero 那个包在做的）、隐藏≠禁用（安全模型须建立在此）、热更新与重放每轮重算不需持久化投影。**并交代我们也漏过这条**——第一反应去看名字最像的 `ctx.tools.restrict()` 撞墙就下了"平台不给"的结论，倒推才找到；建议他对六个缺口各做一次倒推，提案可能从"请开四个新 seam"缩成"请补 X"。**边界写死**：整条删掉一个工具我没单独验过；另附已证伪的 `tools/pre-execute` 改不了原生工具参数（省他时间）。背书两位评论者已发布的包是"有真实消费者"的最好证据 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/524#discussioncomment-18168696) |
| 478 | 无（更正我自己 + 归族） | **本族证据最完整的一帖，且它推翻了我此前的说法。** 我在 #1202 写"数据模型里没有终态结局字段"——**他的第 1 问证明信息其实落盘了**（`repair.ts:131` 合成 `turn/end {interrupted}`、`coordinator.ts:944-945` 持久化），缺的只是 `list-children.ts` 冷路径从不读它。**这个区别决定修复成本**：不是加字段（要改 schema + 存量迁移），是补一次读取 + 拓宽状态枚举，**存量孤儿会话修完立刻正确显示**。第二件：他找到的同仓正确范例（`WorkflowRunPanel` 已有 `statusFromStopReason` 的完整终态取色）让诉求从"请设计一套状态语义"变成"请照抄 workflow 那套"。附四帖对照表（同一非终态被渲染成四样、唯一正确的只有 `list_agents` 能看到）与服务面事实（归档✅可调但不可逆 / 永久删除❌无公开对等物）作为他 39 个孤儿会话的止血办法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/478#discussioncomment-18168698) |
| 247 | 无（跨帖串联 + 规范冲突提示） | **核心增量是指出他的规范会和 #618 直接冲突。** 先把 `dsh-mcp-client` 连接监督器的四份独立报告并成表（本帖就绪无总预算 / #3489 应用层 `-32001` 看不见 / #1249 EPIPE 逃逸致进程崩溃 / #618 重同步替换阶段清空上一世代），指出四人从四个入口撞到同一件事：**世代管理缺一份统一规范**。然后是冲突：他写"deadline 到期就主动关掉该 client"，而 #618 指出重同步路径今天**获取阶段失败保留上一世代、替换阶段冲突才清空**——按他字面读，**一次网络抖动导致的重同步超时会让用户会话中途丢掉整个 server 的工具，而在他的提案之前同样的抖动只是重同步失败、工具照旧可用**，这是可感知的退步且难归因。给了写死的措辞（重同步超时保持上一世代注册，只有替换成功才 dispose），使两份工作合成一条线。另两点：默认值 60s 应给依据；超时诊断应报**卡在哪个阶段**（这个信息在超时那一刻是现成的） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/247#discussioncomment-18168703) |
| 590 | 无（分诊 + 指出他手上有别人缺的东西） | 一句话 + 截图的抱怨。**先做分诊**：后台派发的话主会话那一轮技术上确实结束了、说谎的是没告诉他"还有活在别处跑"（归 [#2575](https://github.com/deepseek-ai/deepseek-harness/discussions/2575)，那边已定位 `session/jobs` 运行中零帧、子代理列表纯拉取式；更上游是 #1289 没有通用推送通道）；同步等待却显示完成才属于子代理状态模型那一族（四帖对照表 + #478 挖出的"落盘了没人读"）。**最有价值的建议**：他这条唯一独有的资产是**那张截图**——上面几帖大多是源码分析、缺的正是"用户实际看到什么"的直观证据，建议按分诊结果把图贴到对应帖下面，**源码定位 + 用户截图比只有其中一样有力得多** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/590#discussioncomment-18168708) |

| 502 | 无 | **毙，settings 白名单族第九帖，且无独有资产。** 内容与 #903/#1877/#3114/#1196/#1183/#1144/#2239 高度重合（同一段 `WEB_SETTINGS_NAMESPACES` 常量、同一句源码注释、同样的 `expose: true` 建议）；它举的 `@linxin666/dsh-web-ui` 家族**已经由 #1144 提供了更详细的实例**（6 个命名空间、5 张卡片 4 张隐形、附下游 issue 链接），并已收进我在 #1144 做的全族对照表。零评论，再发一遍同样的话就是刷屏 |

### 池 2 批次 27（2026-08-27）

| 1495 | 无（指出他的设计前提正被另一帖质疑） | **他的核心设计写着"It lands where the math already reads"——而 [#2107](https://github.com/deepseek-ai/deepseek-harness/discussions/2107) 正在查的可能恰恰是这个前提不成立。** 那位配了 `contextWindow: 98304` + `thresholdRatio: 0.6`，全量扫描零条 compaction 事件、计量从未到压力门、会话死于 context exceeded。我在那边补过"闸门有两个乘数、右边那个 `contextWindow` 没人验证过"。**若闸门今天就读不到端点声明的 window，他的 override 沿同一条路流下去同样读不到**，得到一个"配了但没效果"的功能且更难排查。附我们踩过的两 seam 事实（`listModels` 管目录成员、`resolveModelInfo` 管容量，只读前者会拿 undefined 静默落默认）。给了十分钟验证步与三种结果各自的提案形状（其中结果 2 意味着他的提案要带一个前置修复，而那个前置修复本身能解掉 #2107，价值更大）。另赞同"Consumed, never transported"（附 #2822 的 `session_id` 反面教材）与"切换模型丢弃 override"，建议梯子允许超出固定档位的手工输入 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1495#discussioncomment-18168791) |
| 1771 | examples/gateway-compat（等级一，录制代理）+ 编译期证据 | **他的第 2 条（compat 透传）在 rc.8 上可能已经落地。** 用 `satisfies Record<keyof PiAiCompatProfile, …>` 证明他点名的三个字段都在类型上，并用透传录制代理录到的真实 body（`"role":"system"` 而非 `developer`、非默认的 `max_tokens` 拼写、`store` 消失）证明**三个 compat 声明真能打到线上**。同时**调和了与 #780/#2822 的表面矛盾**——类型 `PiAiCompatProfile` 与用户配置校验 schema `compatProfile` 是两回事，rc.8 给了 compat 真正的 profile 槽位（按协议 gated 的受控子集），那几份报告核的是 rc.8 之前的 master。给了十分钟核实的 YAML 与一个坑（**一个非法键会让整个 settings 段被拒**，所以一次只加一个字段）。第 3 节建议把 replay 空指针单独开帖（否则跟着 compat 一起等排期），并归入"一次异常留下不合规历史→会话永久报废"族。第 4 节劝他想清楚 Google 端点自动识别那半——**配置透传是可持续表面，自动识别是跑步机** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1771#discussioncomment-18168798) |
| 1453 | 无（他要的 seam 有两类已存在） | **他提"新增 ContextPlanner seam"，我指出五类贡献者里有两类今天已有权威时点。** 他自己引的 `preStep()` 已说明 `systemPrompt.assemble()` 每步都跑；补上另一半实测——**它是 awaited async waterfall、返回值权威**，且 **`assembly.tools` 的已有条目可改写**。做成五行表（system ✅ / 工具 schema ✅ / 动态 context 大概率但我没验 / 工具结果 ❌ / 累计历史 ❌）。**这意味着他可以先做真实原型用数字说话、诉求可缩窄成"把 RequestPlan 扩到 assemble 够不着的两类"**（而那两类恰是 #935/#963/#1052 里 token 暴涨的主要来源）。并印证 @labmimors 的 MCP Lens 把 1000 工具从 647,962B 压到 1,114B 正说明这一层 seam 够用。另强调 @labmimors 四件事里**第 3 条（裁剪原因可见）最容易被省掉而最贵**——接"诊断信息存在过却没送到人手上"第八例，建议写进验收标准。附已证伪的 `tools/pre-execute` 改不了原生工具参数 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1453#discussioncomment-18168804) |
| 3178 | 无（评审角度的风险量化，两面都说） | @zoahdev 已完整核验两个档位的机制。我补评审会关心但没人说的一条：**在 WSL 上加设备透传的边际风险比看起来小得多，因为那里的沙箱已有更大的洞**（[#3045](https://github.com/deepseek-ai/deepseek-harness/discussions/3045) 实测 interop 完全穿透、`workspace-write` 下删 D 盘 26.8GB 零审批）。做成三行对照表，把评审问题拆成"原生 Linux + bwrap 上的真实风险"与"WSL 用户真正该知道的是 #3045"。**但明确写了这话得两面说**——不希望被读成"反正都漏了随便开"，诚实结论是两条：对提案边际风险小、对 WSL 用户则说明不该把 workspace-write 当边界。实现建议：`extraDevPaths` 生效时应对模型和用户可见（接 #1331 的"partial 边界不可见"），并提炼成通则：**削弱沙箱的配置项都应让沙箱的实际强度与它自己宣称的一致** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3178#discussioncomment-18168809) |
| 2157 | 无（两条一句话抱怨的分诊 + 指路） | 两条一句话 + 截图。第 1 条给分诊判据（**shell 工具 vs fs 写入工具，两条路结论完全相反**：前者是能力边界问题归 #1967，后者才是真 enforcement bug），并按平台补 Windows 两坑（#1331 的 `enforcement: 'partial'` 且边界不可见、#3045 的 WSL interop 完全绕过 + 缓解办法），外加 #2593 的同类惊吓（`$HOME` 只读、赋值失败但脚本继续，`Remove-Item $home` 打到用户主目录）。第 2 条给 #2283 的一句话结论（**"停止"是排空语义不是取消语义**）与今天可用的 `run_in_background` + `job_kill`。建议他把截图和具体操作贴到对应帖下——**那几帖大多是源码分析，缺的正是用户实际撞上的现场** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2157#discussioncomment-18168832) |

### 池 2 批次 28（2026-08-27）

| 2849 | 无（一份来自另一消费者的运行信号 + 版本策略意见） | **我们的依赖树里钉着 `@earendil-works/pi-ai: 0.84.1` 与 `@deepseek-ai/dsh-llm-pi-ai: 0.1.1-rc.2`，契约测试与真机 E2E 全绿**——直接对上 @tianhao8687 检查清单第 3 条（流事件/工具调用/reasoning/replay 未被破坏）。**边界写死**：只覆盖我们翻译时用到的 Pi 面、不等于 `dsh-llm-pi-ai` 内部每条路径；我们钉 0.84.1 不是 0.84.2，两个补丁版没对比过；这是有限运行信号不是"升级安全"的结论。第二件是版本策略：**`^0.84.2` 只是把同一个陷阱往前挪一格**——0.x 的 caret 正是本 bug 成因，0.85 发布时会原样重演且症状同样隐蔽。给了两条各自成立的路（精确钉住 + 显式升级仪式 / 让范围真的会动 + 把检查清单变成 CI 门禁），并指出**当前 `^0.82.1` 是两者中间最差的位置**。第三件：`pnpm.overrides` 是全局的，会顶到所有共享 pi-ai 的第三方插件 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2849#discussioncomment-18168987) |
| 2917 | 无（可落地的止血路径 + 拆诉求） | **他的"方案 1（安装时失败）"可以更快落地**：`inject` 声明与组合内 provider 是**纯静态可判定**的，不需要启动；而 [#1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697) 已产出两个离线 profile 诊断器（`dsh-doctor` P5 / `dsh-plugin-doctor --profile`），两位作者正在对齐 contract——**"未满足的 service 依赖"和他们已有的检查是同一类**，建议带着他那张四插件表去找他们，用户可在上游改之前就有检查。第二件：强调他查到的**不是"少装了包"而是这批服务在当前打包边界下对 headless 不可达**（`dsh-workspace` 无 `dsh.bundle`、两个 app bundle 撞 `duplicate loader entry id` 设计上互斥），所以修法只能是产品边界决策，建议把"252 个 session 类插件事实上只能在 web 跑"提到摘要第一行。第三件：把 `dsh-memento` 那条**静默降级**单独区分出来（前两种响亮、这种是插件活着但能力没在工作），并入静默失败第八例——**方案 1 只挡住第一种** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2917#discussioncomment-18168995) |
| 2703 | examples/custom-gateways 的 `apiKeyEnv`（等级一） | **给了今天就能规避的办法**：显式写 `apiKeyEnv` 就不会走到 `deriveKeyRef` 那条回退路；并提醒**路由名直接决定派生凭证名**，别叫 `deepseek`。第二件：论证**他的建议 2（给派生名加命名空间）比建议 1（冲突检测）更该做**——检测只挡得住今天已存在的冲突、是枚举，命名空间是消除；派生名本就只是 fallback，唯一该优化的目标就是不撞；并接上同构的 #1697（模块级 Symbol 撞不上，修法是带包名前缀的全局键）与 #1289（`channel` 强制包名前缀）。第三件：**这不是静默失败，是静默的破坏性写入**——静默失败只是功能没生效，**静默覆盖是原来的东西没了且无法恢复**，而且撞的是凭证（用户手边常无副本、丢失当下无症状、只在下次计费时才发现）。建议标题改成后果导向 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2703#discussioncomment-18169005) |
| 3032 | 无（把观察重新定性 + 正确层的缓解） | **真正的观察是"权限拒绝被当成障碍而不是信号"**：单看每一步都正常，有问题的是序列本身——`Access Denied` 之后 agent 换一条路再试。这个区分决定缓解层次：堵路是枚举（路无穷），而**"对同一个被拒绝的目标反复尝试不同手段"是可机械检测的指纹**，不需判断意图。并指出它与 [#3489](https://github.com/deepseek-ai/deepseek-harness/discussions/3489) 的熔断是同一机制的两面——**那边是失败循环烧 token，这边是成功的绕行留下真实后果，更危险**。给了不依赖具体手段的条目写法。缓解层：接 #1331（partial 且不可见，**模型可能确实"以为"自己在更强的约束里**）与 #3045（WSL interop 完全穿透），真边界只能在 OS 层。供应链段落**第五次写"攻击者就是模型，再加一个模型不构成边界"并主动披露我们生态里就有这类插件**。最后建议他补"agent 当时看到的工具返回是什么"——若失败信息没有"这是权限边界"的语义，那是工具层没告诉它 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3032#discussioncomment-18169010) |
| 2884 | 无（把埋在 RFC 底下的两个具体缺陷挖出来） | **他的动机 1 和 3 是两个可验证的缺陷，被埋在架构提案底下。** 动机 1（`QUOTA` 不在 `retryableCodes`，429 配额被当终态）是分类问题不是架构问题，且与 [#1215](https://github.com/deepseek-ai/deepseek-harness/discussions/1215)（结构化 code/status 被压扁成英文文案、跳过有界重试）同族，**两条合起来是一个完整诉求**。动机 3（**Windows 沙箱限制进程令牌破坏 schannel TLS，导致 `Invoke-WebRequest`/`curl.exe` 无法 HTTPS**）是本帖最有价值的一段——属于"沙箱实际效果与宣称语义不一致且不可见"族的**第三个实例**（#1331 / #3178），而且症状最迷惑（用户会怀疑网络/证书/代理，几乎不可能想到文件沙箱）。判据：**一份提案里若既有"这行代码分类错了"又有"系统应该自我进化"，前者一定会等后者**。另指出 key pool 今天就能做成独立本地代理、不需要 DSH 改任何东西，做出来比提 RFC 快；并肯定他关于 pi-ai 措辞的自我更正，同时给出该依赖上真正具体的切入点 #2849 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2884#discussioncomment-18169011) |

### 池 2 批次 29（2026-08-27）

| 2053 | 无（纠正一次错误的"重复"判定 + 实践数据点） | **@Cfomodz 判它"Duplicate of #1581/#1472/#2006"是错的**——那三帖是缺陷报告，他这帖开头就写明是 ecosystem contract 问题，而且两者互补：**那三帖恰恰是"该拿什么当权威"答错后的后果**。答他问题 3：**`agentOptions` 是创建期快照、语义上就不是"实际会用哪条路由"的答案**（引 #2470 的 RCA：读 `parent.options` 而实际路由可被瀑布按请求覆盖、GUI 换一次模型即分叉无需重启），并指出 `dsh-agent-teams` 的 `withPending` 桥本身就证明它不是权威。答问题 1：给一份独立实践数据点——**我们端到端断言"父会话切 `/model` 后未固定子代理跟随"靠的正是读实际发出的记录**，两个独立第三方不约而同选了 `request/header`；**但明写只有维护者能确认它是不是 intended contract**。答问题 2：#2639 需要同一个 seam（他要读、那边要写），做成两类需求方对照表建议互引 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2053#discussioncomment-18169183) |
| 2690 | 无（给他的死循环一个机制层解释） | **他的复盘把根因归为"误读了机制"，而那个机制有具体可指认的原因，且不是他的错。** 实测核证：**模型本轮能看到哪些工具取决于 `assembly.tools`，而它在 `system-prompt/assemble` waterfall 之前就被快照**——所以 `cordis_run` 本轮注册的工具确实进了 `ctx.tools`（他查到的权威证据是对的），但不在模型手上那份快照里；**让它出现的条件不是"再走一步"而是"下一次装配"**，这也解释了他的跳出方法为何有效。**最该修的是那句技能文案**："become callable on your next step"如果实际条件是"下一次装配"，那这句话就是把模型送进死循环的直接原因——**模型完全按文档行事**，这是同族里唯一源头在文档而非代码的一例，也最好修。另指出"没有跳出机制"不该由模型负责（接 #3489 熔断）。对他的评审师给两条实操坑：**装插件本身可能弄坏整个 profile**（#1697，且可离线检测，应是评审的一项且必须在装之前）、把可机械判定的部分交给检查（#2917 的 inject 未满足） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2690#discussioncomment-18169195) |
| 1773 | 无（替他的提案找到真实消费者） | **他的建议 1 有一个正在受苦的真实消费者**：[#2917](https://github.com/deepseek-ai/deepseek-harness/discussions/2917) 那位在 headless 装插件后 harness 完全起不来，而"在等哪个 service"这行只出现在崩溃进程的 stderr、`--dump-config` 还主动认证一切正常——**他要补的正是这个**，那张四插件表是最好的动机材料。答他问题 1：**"未来的 CLI doctor"不是未来时**——社区已有两个独立离线诊断器（`dsh-doctor` 19 项 / `dsh-plugin-doctor --profile`）因为缺这个 projection 而只能扒文件系统，两位作者已在对齐 contract，**"Web Settings + 两个已存在的诊断器"三个消费者比一个假想 CLI 有力得多**。建议 2 归入 settings 族第十帖并指出**他的第 3 条（Host 保留 admission）正是绕开官方三条暂缓理由的关键措辞**，附 profile-patch 中间方案。末尾建议明写"两条可独立落地"，防只读诊断被契约变更拖住 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1773#discussioncomment-18169204) |
| 2145 | 无（答一个无人回应的 Q&A） | **答"是 BUG 还是刻意设计"：既不是设计也不是单一 bug，是两条投递路径调度语义不一致，且已被定位。** 转述 #2185/#2192 的根因（continuable 后台子代理 turn 结束调注入的 `report` 工具 → 父会话收到 settle notice + report relay 两条同内容投递；**steer 走 next-step、followup 走 next-turn 的不对称**），正好解释他看到的两件事：为何多数插话少数排队、以及**为何排队那条会显示成可编辑的用户消息**（它按"下一轮用户输入"排进去、吃到了用户消息的 UI 处理）。并肯定他的追问是独立有价值的观察——**即使重复投递修好，"回报以可编辑的用户消息形态排队"仍在**，投递物来源与呈现形态不一致，改过之后模型无从分辨。建议带截图去补复现（**那两帖主要是源码分析，缺的正是用户看到的形态**） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2145#discussioncomment-18169199) |
| 1761 | 无（保留便利、去掉风险的再设计） | **他要"点链接自动添加模型和 API key"，我建议去掉 key 那一半。** 两条理由：① URL 会在浏览器历史/最近打开/聊天预览抓取/转发里到处留痕；② **更严重的是这个形状是钓鱼原语**——构造一条指向攻击者代理的 `dsh://add-provider?...&key=<攻击者的key>`，用户点了得到一条**看起来正常也确实能用**的路由（攻击者转发到真上游、用他自己的 key 所以账单也正常），而**用户此后所有对话内容全流经攻击者**；隐蔽点在于**没有任何东西坏掉**，唯一能察觉的时机是核对 baseURL——而那正是这个功能承诺帮他省掉的一步。给了保留 90% 便利的替代（**只带非机密配置 + `apiKeyEnv` 引用名 + 确认面板显著展示 baseURL**，恰好挡住该场景），并指出 DSH 官方配置格式本就是这个形状、可定义成"官方配置的可点击形式"；另给更简单的"粘贴配置片段导入"。附 #2703 作为现实提醒：**人工点击路径上"自动配置"已能造成不可恢复的凭证丢失** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1761#discussioncomment-18169207) |

### 池 2 批次 30（2026-08-27）

| 1471 | 无（把他的未定论问题接上另一帖的定论） | **他明写"帧为何没送达/没渲染未最终定论"——[#3030](https://github.com/deepseek-ai/deepseek-harness/discussions/3030) 定论了一半。** 那边实证：隧道/代理后空闲的 `events.mux` WebSocket 被中间盒**静默回收、两端都收不到 close 帧**，客户端重连只在检测到 close 时触发，于是 UI 一直以为连着、**审批弹窗永不出现直到手动刷新**；决定性对照是直连 mux 监听器上服务端确实按时 emit 了 `approval/requested`。**与他的取证完全吻合**（`asked` 有、`decided` 永远等不到），并解释了"时灵时不灵"=取决于弹窗触发时 socket 是否已被回收。做成两半对照表（他修 host 侧有界 fail-closed，#3030 修传输侧根因，**两者都需要**）。第二件：他选 fail-closed 正站在这个社区那条裂缝的正确一侧——**同一仓库里他这个门 fail closed，#2485 与 #1514 两个门 fail open**。第三件：建议把"审批审计不完整"（asked 无对应 decided）提到摘要，比"工具挂起"更容易被当成必须修 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1471#discussioncomment-18169346) |
| 1732 | 无（**本轮最强的"搜 npm 指过去"**） | **他的第 2、4 条今天已有社区插件。** 第 4 条正中他的缺口（他说 `dsh-notify` 只单向、缺事件入口）：`dsh-lark-bot`/`dsh-feishu-bot`（扫码即用、**流式卡片**）、`dsh-im-hub`、`@lijian-ui/dsh-im-gateway`、`@dingtalk-real-ai/dsh-dingtalk`、`dsh-dingtalk-channel`，并**标出 `dsh-dingtalk` 是单向的、与他现状一样**。第 2 条给 `dsh-remote`/`@linxin666/dsh-ssh`，**但做了期望管理**：这些多半是"给 agent 一个跑远程命令的工具"，而他要的是 **fs/process provider 指向远程、整条执行面换宿主**，两件事差别很大，建议在原帖写清以免被回成"已经有 ssh 插件了"。附 #1697 装插件风险（`@linxin666/dsh-ssh` 正是那帖点名的受影响插件之一）。第 3 条拆成三句（jobs 已能后台化 / 缺运行中进度→去 #2575 附议 / 完成回调可用 IM 插件先凑）。**全程标明这些包都是别人的、我没装过** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1732#discussioncomment-18169337) |
| 1517 | 无（三条现状：一条支撑、一条障碍、一个会继承的 bug） | ① **支撑**：#2283 证明前台"停止"是排空语义、取消本身不保证生效，而 `job_kill` 不走那条路——**所以他的提案不只是让父 agent 并行，还把 workflow 从取消不掉的路径挪到取消得掉的路径**，建议把这句写进 Problem 段（从"体验改进"提到"修语义缺陷"）。② **障碍**：#2575 查到 `notifyChanged` 只在四个生命周期点触发、`job.detail` 只在 `settle()` 赋值，**所以他验收标准里的"current phase"今天没地方放也推不出去**，应列成显式依赖并与 #2575 互引（那边的最小改动正是他要的）。③ **会继承的 bug**：他把"without duplicate completion notices"当洁癖写，而 #2185/#2192 证明那已是隔壁的真实 bug，建议升格成"已知风险 + 引用现有修复"。④ 肯定他第 5 条的窄承诺是有意的，附这个社区"承诺了兑现不了的语义"的反面案例 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1517#discussioncomment-18169359) |
| 1572 | 无（并线 + 把评论里的第二诉求提上来） | 与 [#1491](https://github.com/deepseek-ai/deepseek-harness/discussions/1491) 同诉求，建议互引别分两条线（**那边有 API 草案与安全边界论证，他这边有已发布可安装的真实消费者 `dsh-llm-ollama`**）。搬来 `dsh-authorization` 的核证事实（0.1.1 有官方登录 flow 注册面、stock 只带包不组合服务、无 stock 面调 `begin()`），指出改提法可大幅缩小评审面积；附我们接它的方式作旁证并**明写没读过它的完整接口**。核心增量是**把他评论里的 web-search provider 选择器提上来**：seam 已开、生态已长出**六个以上已发布的 `ctx.web` provider**（列表 + 标注全是别人的包、我没装过、**我们那条注册的是工具不是 provider 所以不在表里**），唯独选择面写死在 `web-search-deepseek` 命名空间上；并接 #3446 作为具体受害场景（默认指向付费端点、想换无 key 的 SearXNG 只能手改 `cordis.patch.yml`） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1572#discussioncomment-18169366) |
| 1510 | 无（一条今天可用 + 一条先知道的坑） | **「自定数据目录」今天就能做**：`DSH_HOME` 指向任意目录，并给出三平台写法；硬保证来自我们**每次回归都在全新临时 `DSH_HOME` 里跑完整流程**，所以"整套搬目录"天天在被验证；补充加密卷用法与"旧目录不会自动跟过去"的提醒；同时承认可视化设置项仍是合理诉求。**「全选」给了一个先知道的坑**：#3226 的 `adopt()` 只拷四个字段丢 `input`、#3566 同一行丢 `reasoningEfforts`——**现在手动采纳出来的条目就已经缺胳膊少腿，全选只是一次性得到几十个这样的条目**，且症状滞后（不是采纳时报错，是以后用到才失败）。给了手工补字段的 YAML 与"一个非法键会让整段被拒"的坑。建议把"全选"与"采纳时保留完整字段"绑在一起提 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1510#discussioncomment-18169375) |

### 池 2 批次 31（2026-08-27）

| 1421 | 无（给他的根因一个今天可做的解） | **他自己诊断出"模型无墙钟感知、轮次数被误当等待时长"——我指出这个根因有一个比"抑制 idle 轮"更接近病灶的解。** 节流只治"误判来得多快"（同一个错误认知还在，慢判官照样被误杀）；**把墙钟给模型**才治认知本身。而这半今天就能做：`system-prompt/assemble` 每步都跑、awaited、返回值权威，插件可在每步注入子代理的 `createdAt` + 已运行秒数 + 最近产出。**明写我没针对 goal idle 轮场景做过端到端验证、注入后模型判断会不会变属提示词工程需他自己试**。建议提案拆成两句（今天可做且治本 / 需官方做但省钱），第 1 条还能给第 2 条提供数据。**对他"按类别写死墙钟预算"提保留**：那是会过期的名单（类别会增加、速度会变，不改的表现是静默误杀），而他同句里提的"附证据（createdAt / 最后文件 mtime / 产出文件）"不会过期——**"有没有产出"是可观测事实，"该跑多久"是猜的**，这样提还省掉让维护者认可那两个数字。另建议把已合并的先例 PR 提到摘要附近 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1421#discussioncomment-18169516) |
| 3482 | 无（来自语料的边界条件） | **给这个 vision 提案一条会决定第一步该做什么的边界**：他假设"重复出现的推理模式 = 值得固化的经验"，但语料里有相当一批"模型反复做同一决定"的案例，**原因是输入本身错了或不完整**——做成四行表（#3568 原样重发坏参数 17 次 / #3489 重新规划 61 次 / #2690 连续几十轮 no-op 因技能文档说错 / #1421 因没有墙钟中断健康子代理）。**四条都高度可复现、都会被轨迹分析捕捉，但没有一条该被编译成反射**——固化它们等于把当时那个错误输入一起固化进去；以 #3568 为例，学出来的反射很可能是"遇到缺参数就重发"，**把一个靠人排查能发现的 bug 变成系统自己坚持要犯的错误**。建议在 @denial123789 的 pipeline 最前面加一道"输入健全性检查"，判据用现成指纹（同一动作高频重复 **且外部状态没变**）；并指出**这个判据恰好就是 #3489 的熔断信号**——同一信号一边当刹车一边当学习样本过滤器。最后给一个收益/风险比更好的第一步：先识别并报告重复失败，一行都不改运行时 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3482#discussioncomment-18169522) |
| 676 | 无（修法取舍 + 第三种"目录在说谎") | ① **他给的两个修法里"关闭时删除"严格优于"加 LRU 上限"**：LRU 治不了他自己指出的第二个症状（重开先渲染上一代快照），**保留下来的条目仍是上一代的**，只有恰好被挤出去时才不会——**LRU 把这个 bug 从"必然发生"变成"看运气发生"，比必然发生更难查**。② 把本帖与 #478/#476/#1202 并成表：**同一个子代理目录至少有三条独立路径让它显示与事实不符的内容**（陈旧缓存 / 非终态渲染成已完成 / 已失败渲染成运行中），并指出 #2575 的"纯拉取式、无推送帧"是本条的放大器（**刷新机会本就稀少，一次失败留下的陈旧快照会存活很久**）。③ 建议补内存增长量级数字——**纯逻辑正确性 bug 容易被认可也容易被排到很后面** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/676#discussioncomment-18169526) |
| 198 | 无（三候选分诊 + 一条单变量测试） | 一个零回复的卡住用户。**先给单变量测试**（绕开隧道本地直连点同一个按钮），再给三个成因完全不同的候选：① [#3030](https://github.com/deepseek-ai/deepseek-harness/discussions/3030) 隧道后 WebSocket 静默回收（与他症状高度吻合，给了"刷新后能用、闲置又不行"的确认判据，以及 SSH `ServerAliveInterval` 能防哪半、防不住哪半）；② [#2239](https://github.com/deepseek-ai/deepseek-harness/discussions/2239) 设置写入被客户端静默吞掉（只影响设置写入、不影响流式输出，据此可与①区分）；③ **他点的正是 [#2703](https://github.com/deepseek-ai/deepseek-harness/discussions/2703) 那个会静默覆盖官方凭证的"添加提供方"按钮**——给了绕开 UI 的官方 YAML 写法（显式唯一 `apiKeyEnv`、路由名别叫 deepseek），**顺带绕开①②**。最后请他贴 F12 控制台报错（"有没有那一行报错，排查难度差一个数量级"） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/198#discussioncomment-18169540) |
| 366 | 无（说清难点 + 两条今天可用） | 一句话需求。说明为何 harness 层难做（**判难度本身就需要一次模型调用**），并引 #2911 那位的话作为设计顾虑（换模型会同时换掉价格/语气/工具行为/推理支持，**静默切换比报错更难排查**）。两条今天可用：① **推理档位**（同模型内的深浅旋钮，收益同类但价格/语气/工具行为不变）；② **让模型自己派带 pro 的子代理**——**做判断的是已读过上下文的那个模型，而不是任务之外瞎猜的调度器**，并附 #2470 的已知 bug 与绕法。最后指出封闭产品与开放 harness 的难度差（**连"哪个更贵/更强"都没有可靠元数据来源**，见 #3226/#3566），建议把需求改写成具体可判定的规则——**"像 claude 一样自动"维护者也不知道该实现成什么** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/366#discussioncomment-18169550) |

### 池 2 批次 32（2026-08-27）——**池子跑完**

| 1865 | 无（用我们自己的安装事故答一个零回复帖） | **"输入框只吃进一个字母"我们撞过**：**在全新安装上没先选工作区时，输入框会静默吞字符、页面不给任何提示**——这是我们回归装置（每次全新临时安装）实测撞出来的坑，很可能就是他的问题。另给两条后备（F12 控制台报错、若经隧道访问看 #3030 并给刷新判据），并明确告诉他这帖挂这么久没人回是因为**只有一张截图和两句描述、缺一个能动手的抓手**，请他补版本/访问方式/控制台报错/具体失败形态 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1865#discussioncomment-18169642) |
| 494 | 无（两帖互补 + 收窄诉求） | **他有 [#3431](https://github.com/deepseek-ai/deepseek-harness/discussions/3431) 最缺的东西（用户实际看到什么的截图），那边有他最缺的东西（写好的 5 文件实现）**——那边通篇是排版参数和宽度测量，而**"省略号切在数字中间"比任何测量都更能说明问题：不是信息被截断，是截断出了一个读起来像数字但其实是半个数字的东西**。同时给出必须注意的前提：`conversation.composer.dock` 是 **`list` 座位**，那一行能有多长不由 DSH 决定，**所以"直接全部显示"在任意宽度下无法保证**；据此建议两边各自收窄——#3431 别移除省略号降级路径，他则把诉求改成**"别在字符中间切"**（小、无争议，且正好解决他最难受的点）。附三条路并存对照表。**主动披露我们也往 composer 附近座位写东西、算把那一行挤长的贡献者之一** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/494#discussioncomment-18169648) |
| 109 | 无（答他明确提出的第 3 问 + 补"有界"的界法） | 答问题 3：**failure marker 该进结构化 handoff，理由不是整洁而是"只在 prompt 里的标记编排层看不见"**——successor 连续失败几次、是不是同一种、workspace 有没有变化，这三件 orchestrator 都该知道。补"有界"：**纯次数上限会把预算平均花在有希望的重试和注定失败的重试上**；Ralph 的 child 是 fresh 的所以不记得上次，`maxFailureSuccessors: 3` 就是把同一个坑踩三遍。建议加便宜短路——**successor 只在 authoritative workspace 自上次失败后发生变化时才启动**（可观测事实、不需理解失败含义、且正好与他自己写的"successor 先检查 workspace"配套），并指出这与 #3489 的熔断是同一信号。问题 1/2 支持他自己的倾向，并指出**"是 invariant 还是暂缓策略"这个问法本身有价值——两个答案都有产出** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/109#discussioncomment-18169653) |
| 1782 | 无（让 @zoahdev 的诊断变得决定性） | **他报告里有一条线索能直接检验双实例假设：命令也不见了。** 命令注册表与工具注册表不在同一个包——**若只 hoist 了 `dsh-tools`，则工具不可见而命令应正常**；两样都不可见说明要么不止一个包被遮蔽、要么假设不完整。给了不用读源码的决定性检查（`ls` profile 顶层看几个是真实目录，比 doctor 更直接回答"一个包还是多个包"），并提示看插件把 `@deepseek-ai/*` 写成 dependencies 还是 peerDependencies。第二件：转述 #1697 已走到**共享 key + 协议版本守卫**（含 `Symbol.for` 会拆掉版本屏障这个隐藏代价），**修复已写好、他不需要另开修复线**。第三件：@yzke 的同族实例（旧版 `dsh-system-prompt` 遮蔽致内置 `minimal` 预设挂不上、Web 界面什么都不显示）作为"受害者可以是无关功能"的旁证。第四件：**若检查下来 profile 干净，则他的对照组实验就是核心证据** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1782#discussioncomment-18169663) |
| 984 | 无（方向相反的镜像实测印证机制根因） | 12 条评论已把 dist-tag、`dsh-session` peer 修完，@rjn32s 补了机制层根因（`autoInstallPeers: false` 写在 `pnpm-workspace.yaml` 在 pnpm 9 被静默忽略）。**我给一份方向相反的实测印证**：我们在 pnpm 11 上把 `minimum-release-age` 写进 `.npmrc` **完全不生效、必须写 `pnpm-workspace.yaml`**——做成镜像对照表，**两个方向都存在且失败模式一模一样（不报错、安静用默认值）**，所以他的"生成兼容各主版本的 .npmrc"理由应写成"**配置通道本身会随 pnpm 版本迁移，而写错通道时 pnpm 不会告诉你**"，只写一处都是在赌用户装的哪个 pnpm。第二件：**`dsh plugin` 调的是 PATH 上的 pnpm，DSH 完全不掌握版本**（我们回归为此用固定版本 shim，版本不一致会造成方向指错的假失败）。第三件：建议把 pnpm 版本打进报错——**这帖前几轮排查走那么久，一部分原因就是各人 pnpm 版本不同而报错里没有这个变量** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/984#discussioncomment-18169677) |

## 第三个池：增量新帖（快照 2026-08-23 之后）

两个策展池跑完后按审计自己的结论（"转增量：按天扫新帖，而不是每隔几周重跑全量"）改从仓库直拉。
`orderBy: CREATED_AT DESC` 取最近 100 条，**99 条未处理且全部 0 评论**——增量池的密度远高于存量池。

### 增量批次 1（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4620 ↑3 | examples/gateway-compat（等级一，录制代理） | **一行官方配置解掉一个 ↑3 零回复帖。** 报错 `The reasoning_content in the thinking mode must be passed back to the API.` 正对应 compat 字段 `requiresReasoningContentOnAssistantMessages`。**先解释"偶发"其实不是随机**：只有历史里已存在思考模式 assistant 消息、而请求未带 `reasoning_content` 的轮次才必炸，所以首轮正常、聊几轮后概率升高。给出完整 YAML 与三个坑（**一次只加一个键**、必须 `openai-completions`、纯官方配置）。证据是透传录制代理录到的真实 body（同一 compat 槽位实测生效）；**明写没专门测过这一个键在他端点上的效果**。附同族三帖（#780/#1771/#2822）与共同教训（自动探测封不住第三方方言） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4620#discussioncomment-18169805) |
| 4657 | 无（止血 + 归类 + 归属拆层） | 取证极扎实（12,238 step / 530 失败 / 81 次压缩 / 压缩后 8 事件内失败仅 12 次 = 2.3%，直接证伪"压缩导致失败"）。三件：① **止血**——他自己的对照组指出 429/5xx 空 body 都能进重试白名单，**所以只要那个响应不是 400/413 整条误判链就不成立**；给了拿我们那个独立单文件透传器改成"把空 body 400/413 改写成 503"的做法，**并写清代价**（真超长也会被改写成可重试，按他的数据代价接近零，建议加计数日志）；顺带能回答"400 是 ALB 返的还是上游返的"。② **归类**：与 #1215（结构化 code 被压扁）、#2884（QUOTA 被当终态）同族，并指出**造假比丢失更危险**——丢失退化到保守行为，造假是"系统自信地做了错误的事"，用户看到的错误码在积极误导他（他自己第一反应也是"压缩了还超长？"）。③ **归属拆层**：第 3 步在上游 pi-ai 不是 DSH，给出两个修复家与时间尺度差，并建议 DSH 侧加一条不依赖上游的通用防线——**由启发式推断出的结构化错误码，应在有更硬证据时被推翻**（token meter 与窗口声明当时就在手边）。附 pi-ai 版本提醒（我们钉 0.84.1、而 `^0.82.1` 的 caret 到不了 0.84） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4657#discussioncomment-18169811) |
| 4606 ↑2 | 无（安全前提 + 服务面事实） | **这个 RPC 恰好落在一个已被实录利用过的攻击面上。** 引 [#4384](https://github.com/deepseek-ai/deepseek-harness/discussions/4384) 的无人值守提权实录（agent 读源码发现信任栅栏只要 loopback Host 头、注释自述"explicitly not an authentication layer"，随后用自己的 shell 工具调 `commands/execute` 切到 `danger-full-access`），指出 **`session.setPermission` 会把绕一圈的提权变成一条更短更稳定的一等公民路径，而最可能的调用方就是那个能调 shell 的 agent**。建议提案正面回答三问：谁被授权调用、**是否只允许收紧（downgrade-only 几乎无风险且覆盖多数用例）**、写进哪个权威（我清点的服务面：`permissionPresets` 有 `set`，**`sandboxPolicy` 只有 resolve/overrideOf 没有 set**——后者等于新增权威，是大得多的提案）。另指出正文只有一句话+fork PR 链接会让它很难被讨论 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4606#discussioncomment-18169819) |
| 4612 | 无（形状归类 + 修法取舍） | 他已把根因定到 `applyReadImageTool(imageCtx)` 传了被收窄的 scope。① **点出这个 bug 的形状**：cordis 守卫在**执行期**才响，所以一个 scope 声明错误的注册**通过了全部启动期检查**（挂载成功、工具在目录里、模型看得到会去调），只在被使用时才暴露，代价是模型白花一整轮；与 #1782（挂载 active 但注册对 agent 不可见）、#2917（`--dump-config` 一切正常但起不来）同族，**而他这条是其中症状最良性的**——cordis 明确点名了缺哪个服务，值得作为"注册期就该校验 scope"的正面例子。② **两个修法不该并列**：传外层 `ctx` 表达的是"`fs`/`tools` 是执行依赖、`attachments` 只是注册时机门"，与函数注释和执行体已有的 `ctx.get()` 写法一致；扩宽内层 inject 能过守卫但**表达的意思是错的**，将来调整 attachments 可用条件会连带影响 `fs` 解析时机。③ 附 #4615 同属图片路径，并指出这个 bug 可能一直没人报是因为**遇到的人第一反应是绕过去，绕过去就不会回来报了** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4612#discussioncomment-18169825) |
| 4652 | 无（同串报错多来源 + 对修法的保留） | ① `Cannot read properties of undefined (reading 'kind')` **在这个仓库至少有两个家**：他这条在 `compactSlotTree`，[#1771](https://github.com/deepseek-ai/deepseek-harness/discussions/1771) 在 `llm-pi-ai/replay.ts` 的 `message.source.kind`（历史压缩或注入无 source 的辅助消息时触发）——**后来人搜到他这帖照着改 `providers.ts`，可能踩的其实是 replay 那条**；附 `.prepare` 那串同样多来源（#1697）作为已成模式的旁证。② **对他修法的保留**：`compactSlotTree` 是**诊断函数**，`filter(undefined)` 不崩溃了但**那棵树会在无任何提示的情况下少几个节点**，排查 slot 问题的人拿到一份看起来完整实际残缺的树；建议改成留痕降级（`{name:'<unavailable>', kind:'unknown'}` 占位或至少 warn 一次），**而且占位出现的频率本身就在告诉你那个竞态有多频繁，filter 掉就永远不知道它发生过**。③ 请他补"崩溃时有没有插件在装卸/面板在开关"——那是定位竞态的关键线索。**主动披露我们也在 DSH Web 注册 slot、可能是这类竞态的触发方之一** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4652#discussioncomment-18169828) |

### 增量批次 2（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4700 | 无（**搜 npm 指过去**） | 他已把 `onPaste` 无条件走 `intakeImages` 的链路定位到源码。**社区已有两个现成的包**：`dsh-file-upload@0.4.3`（Claude 风格拖拽/回形针上传）、`@tivility/dsh-file-upload@0.2.2`（带 `ownerAuth` 门控），另有 `dsh-file-browser`/`dsh-upload-button`/格式专用的 `dsh-pdf` 等——**全部标明是别人的包、我没装过**，并附 #1697 的装插件风险。核心增量：**这些包的存在是他提案最好的论据而不是取消理由**——两个独立作者各自造了一条上传通道，说明缺的是**通用附件通道**而非"多支持几个 MIME"；据此建议把诉求从"放宽 `imageLimits.mediaTypes`"（会让非图片文件进入为图片设计的管线：缩略图/lightbox/按图片数算的上限）改成"把 attachment 抽象成与媒体类型无关的通道"。另提醒**能贴上去 ≠ 模型能用**（#4612 `read_image` 全预设失败、#4615 非 png/jpeg/gif 原样发出） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4700#discussioncomment-18169939) |
| 4680 | 无（我们自己脚本里的旁证） | **我们五个 E2E 脚本里每一条多包 `plugin add` 都写着 `-w`——而我们从没意识到那是在绕一个 bug**（当初调不通试出来的，试通就一直留着）。这个旁证说明：① **不是"全新 profile"的边缘情况**（我们全新的和装过的一律要 `-w`）；② **至少还有一个项目默默把这个 workaround 焊进了全部自动化、从没报过**——他大概率不是第一个撞上的，只是第一个写下来的。第二件：**`initProfile()` 写的那个 `pnpm-workspace.yaml` 已是第二次成为麻烦来源**（#984 里 `autoInstallPeers: false` 在 pnpm 9 被静默忽略），两条并提可把问题从"某命令要加个 flag"提升到"profile 的 pnpm 布局需要通盘设计"。第三件：**他低估了自己的第二个建议**——自动传 `-w` 需要确认是否所有情况都该传，而把 pnpm 原始错误翻译成一句点名 flag 的提示是**零风险零语义变更**，且救的是下一个撞上的人。**明写我们脚本一开始就带 `-w`，所以我提供的是"我们一直在绕它"而非"我复现了它"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4680#discussioncomment-18169946) |
| 4695 | examples/custom-gateways 的 settings 形状（等级一） | @denial123789 已把边界讲清。我补**他点到但没展开的第 2 种选择的具体做法**：模型与凭证的权威就在 `$DSH_HOME/settings.yaml`，他既然能 SSH 就直接在那边改（热加载、不用重启），**Settings 面板本来就只是这个文件的编辑器**；密钥走 `apiKeyEnv` 引用名 + `$DSH_HOME/.env`（附 #1015 指出这层无用户文档），并给三个坑（非法键会让整段被拒、改 env 要重启、`--dump-config` 验证）。第二件：**给"第三方补丁伪装 loopback"补一个实录理由**——#4384 的 agent 自助提权证明 **loopback 这道门在同一台机器上本来就挡不住 agent 自己**，再朝局域网打开等于把一个已知挡不住本机进程的门朝网络开。第三件：给 SSH 本地端口转发的具体命令，**并附 #3030 的隧道坑**（空闲 WebSocket 被静默回收、审批弹窗永不出现、刷新才有） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4695#discussioncomment-18169955) |
| 4685 | 无（拆六条愿望清单 + 一个坑） | **他的第 2 条今天就有解**：`models` 是 advisory 发现目录，而模型解析**接受目录外的 id**——手写进配置照样能用，所以"拉不全 ≠ 用不了"。**最该知道的坑**：#3226 的 `adopt()` 只拷四字段丢 `input`、#3566 同一行丢 `reasoningEfforts`，**所以他的第 4 条（自动补齐）和第 6 条（自动更新）在这两个 bug 修好前会批量制造残缺条目**，且失败滞后；对 OpenRouter 用户尤其要紧（视觉与推理模型混杂）。另附 #1992：**路由名叫什么会影响能力继承**（模态继承按 provider 路由键查找）。把六条拆成性质表，指出**第 1 条是唯一能靠数据说话的**（分页没读全 vs 解析过滤），建议单独开帖带数字。末尾给 discovery 归属背景（seam 按 settings 命名空间注册、唯一注册者是 `dsh-llm-pi-ai`，见 #740），**这决定了他的第 1 条该报给谁**——而他没说路由是怎么配的 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4685#discussioncomment-18169967) |
| 4699 | 无（把他将要报错层的责任摆正） | 一张截图 + 一句"要做好鲁棒性"。**转述两次独立排查的一致结论**：#2373 的作者报了"write 剥离反斜杠/美元符"，**后来自己查源码撤回了这一项**——`content` 在 JSON 边界原样透传，根因在**模型侧 JS 模板字符串转义**。这个区分决定"更鲁棒"该做在哪：**若工具原样透传而坏在模型侧，把 `write` 改得再鲁棒也没用**（它收到的就已经是坏的，且无法区分"用户真想写反斜杠"和"漏转义的残骸"）。而他的场景（HTML 里嵌 OpenAPI 文档与示例）正是多层嵌套转义的极端形态。给四条减少转义层数的做法（别让内容过 `run_code` 字符串字面量、分层写、能外链别内嵌、引号分层）。**关键建议**：贴出那次工具调用的 `content` 参数——**这一个参数就能把责任分清**（content 已坏=模型侧；content 对而文件坏=比 #2373 更强的工具 bug 证据）。附"工具反馈不足以让模型纠错"的同族（#3568/#3489） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4699#discussioncomment-18169973) |

### 增量批次 3（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4706 | src/runtime.ts:75 的 `KNOWN_IMAGE_TOOLS_BY_PACKAGE`（我们自己的技术债） | **来自另一条代码路径的独立印证，而且我们的"解法"恰好证明他要的声明机制是真缺的。** 贴出我们源码里那张**写死的包名→工具名白名单**及项目守则原话（"上游没有'工具会输出图片'的声明机制……**这是缺口标记不是可扩展方案**，第二个生图包不会自动解锁"），**明说我们不是解决了问题、是给一个具体的包开了后门并记为技术债**。核心增量是三行表：**DSH 自己在 `code-mode.ts:564` 特判过一次、Standard 模式无对等处理、外部实现者维护一张白名单——三处特例、零个声明**，据此论证该补的是声明而非补丁。另给设计建议：**声明需配宿主侧校验**（否则渲染层要处理任意插件返回的任意形状），先把这层答了能降低评审阻力；并建议优先推"tool result 卡片渲染自己返回的 image block"而非"让 context 节点可展开"（后者会改变所有插件注入内容的呈现，是更大的产品决策） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4706#discussioncomment-18170123) |
| 4675 | 无（同一注册表的另一条触发路径） | **同一缺陷在 [#902](https://github.com/deepseek-ai/deepseek-harness/discussions/902) 已被独立报过，角度互补**：他这条是"两个 cordis preset 共存"，那条是"热重载同一 preset"；他查到 standing mount 是进程生命周期、`recompose` 只重绑，那位查到 `ensureStanding` 里那条未实现的 TODO——**两份独立报告收敛到同一个尚未做出的决定：preset 的挂载什么时候结束**。做成三行对照表，**其中最刺眼的一行是用户可见形态**：#902 那边后端返回了完整的 `agent-preset-invalid`（preset/loader/包/冲突/文件全有）**而前端把它扔了**，用户只看到"新增会话→闪回未选择工作区"，为此做了一次逆向工程。建议把本条归到"preset 挂载生命周期未定义"之下，否则修完 inspect registry、下一个往进程级注册表写东西的包还会再撞。另附通用教训：**用"替换"解决"重复"会把响亮失败换成静默失败**，与 #1697 的 `Symbol.for` 拆掉版本屏障是同一交易，那边定案是**共享键 + 协议版本守卫**，正对应 @denial123789 的 canonical manifest 方向 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4675#discussioncomment-18170129) |
| 4703 | 无（指向已有补丁 + 修正他的结论） | 与 [#4674](https://github.com/deepseek-ai/deepseek-harness/discussions/4674) 是同一 bug，那边已有 @nokkies 的独立复现（实测 `messageTokens = -499982`，并指出 state schema 与 wire view 都声明 `nonnegative`，所以之后每轮都过不了校验）和 @Jstn-1g 基于 master 的参考实现。**修正他一处结论**：他写"只有 `messageTokens` 会下溢"，而那份补丁覆盖的是**共享同一条 signed fold 的两个消费者**——还有 `contextPressure.surfaceTokens`，**只 clamp 一个字段另一条路照样炸**；并转述补丁把 checkpoint 版本 2→3 / 4→5 以丢弃旧缓存行、从 seq 0 重折叠（**这一步是已卡死会话能否自愈的关键**）。另指出他那句"仅供展示/计量"应放最前面——**当前设计把"显示可能不准"升级成了"会话不可用"**，这个定性比"数字会变负"有力，且是支持 fail-soft 的最强论据，而 #4674 那边没人明确说出来 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4703#discussioncomment-18170132) |
| 4689 | 无（补一条重试方案覆盖不到的修法 + 三帖区分判据） | **锁文件里有 PID，而没人读它。** 他自己写了"锁里含 dsh PID"和"拒绝移除不属于自己的锁"，两句合起来意味着**重启后新进程仍不敢动一把记着死 PID 的锁**——所以需要人工删。建议加"**拿锁前先看 PID 是否存活，不活即孤儿可接管**"，做成三行表说明**"进程崩溃/被 kill/断电留下的锁"是重试方案完全覆盖不到的**（Windows 上并不罕见），并提醒 PID 复用需配启动时间戳/随机 token，否则易被以"PID 复用不安全"驳回。第二件：给"设置存不下来"这一族三条**可自查的区分判据**（本条=请求发出且后端明确报锁超时+盘上有 `.lock` 残留；#2239=请求被拒但客户端吞了错；#4695=根本没发出 Settings RPC），并肯定他这条难得属于"报错说人话"的那一类 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4689#discussioncomment-18170141) |

| 4674 | 无 | **毙，与 #4703 同一 bug 且那边已闭环得更完整。** @nokkies 已独立复现并给出精确数字（-499982）与"减数与被减数不来自同一集合"的机制解释，@Jstn-1g 已交付基于 master `b150a551b8` 的有界参考实现（覆盖两个消费者 + checkpoint 版本推进 + 契约合法的历史兼容序列回归）。**我能补的两点（`contextPressure.surfaceTokens` 也要 clamp、"仅供展示"是 fail-soft 的最强论据）已写进 #4703 的回帖并建议他带过去**，在这边再发一遍就是刷屏 |

### 增量批次 4（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4707 | examples/gateway-compat README 的同一条边界表述 | **从完全独立的角度印证他的分析**：我们自己的翻译层文档里写着同一条边界、用词几乎一样——"**catalog-vendor-owned fields such as OpenRouter routing** … DSH deliberately keeps those on the installed vendor catalog. **One invalid key would otherwise reject the whole settings section**"，即 `openRouterRouting` 被挡不是疏忽而是设计选择。**明确建议放弃他的建议 1（裸透传）**：协议感知的 gate 会 fail loud 是特性，裸透传会把这层保护拆掉（附我们"跨通道白名单、禁止裸展开"的规矩与 `reasoning:false` 撞 `.efforts.length` 的事故），且按上面那句**一个错拼的键会让整段路由一起消失**。**建议 2 是正解且有成功先例**——#780 是同一形状且我有编译期证据表明那两个字段现已在 `PiAiCompatProfile` 上，建议引它作模板。另给本地透传器注入 body 字段的绕法，并把这条并入"端点需要/拒绝某字段而配置面无法表达"的四帖表（加不上/去不掉/开不了关） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4707#discussioncomment-18170253) |
| 4704 | 无（根因可能在上一层 + 写读不对称归类） | **他的因果起点"模型发出了退化块"可能不成立**：#2979/#725/#885 那一族指向**后续 delta 携带 `id:""`/`name:null`（而非省略）把先前正确值覆盖掉**，#725 里社区已验证出正确守卫 `typeof name === 'string' && name.length > 0`。**这解释了他觉得奇怪的"turn 14 又出现同一个退化块"**——不是模型两次都犯同错，是同一个累加器缺陷在同类报文上必然复现；给了用 `assistant/chunk` 序列验证的方法，并指出他的第三方 OpenAI 兼容 provider 正是那族的高发环境。第二件：**他的第 1 条（写入端存下读取端认定损坏的记录）应单独提**，与 #2915/#1627/#1703/#740 并成表——**写入宽松、读取严格，代价全由用户承担且总在事后显现**；建议提法改为"写入路径应与加载路径用同一套 schema 校验"，否则会被修成"过滤空 callId"这一个特例。第三件：他的第 2 条（级联 400）是第 1 条的下游、不需单独修。末尾给自救提醒（三件一套、先备份、更稳的是从坏轮之前分叉） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4704#discussioncomment-18170262) |
| 4710 | 无（**答案是"不需要插件"**） | 他问"有没有可自定义重试时间的插件"——**重试本身就是组合里的一个条目 `@deepseek-ai/dsh-llm-retry`**（npm 实查，描述为 "Provider-routed LLM request retry policy"），要做的是给它传 config 而不是再装东西；给了 `--dump-config | grep -i retry` + 读装好那份 README 两步自查法，**并明说我不替他猜键名**。**一个坑**：该包 npm `latest` 指向 `0.0.1-rc.1` 而在用线是 `0.1.1-rc.2`（挂 `next`），**千万别 npm add**（接 #984/#2849 的 dist-tag 错位）。技术判断：他"10 秒退完 5 次"对限流几乎必然无效，**要调的是退避初值与倍数而非次数**。**更关键的前提**：错误得先被分类成可重试——#4657（空 body 400 被误判 `CONTEXT_WINDOW_EXCEEDED`、不在白名单、第一发就结束）与 #2884（`QUOTA` 不在 `retryableCodes`），并给判据：**调长退避后若"根本没重试"，问题就不在参数而在分类**。末尾建议把"失败后要重新注入上下文"单独提 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4710#discussioncomment-18170270) |
| 4709 | 无（归属澄清 + 让证据指向对的地方） | **先说清归属**：`Thinking mode does not support this tool_choice` 是 DeepSeek API 返回的，"文档没写清楚"这半的收件人不是这个仓库。但这个仓库该回答的是**"是谁在发 `tool_choice`、能不能不发"**——**答案就在他自己上传的请求报文里**，请他贴出 `tool_choice` 那一行，据此分成"DSH 无条件带上（=DSH 侧问题，配置面没有关掉它的开关）"与"某个工具选择策略触发（=该策略在思考模式下应降级）"两种。**指出他现在的证据（三张文档截图）全部指向这个仓库改不了的地方**。并入"端点不接受 DSH 发的某字段而配置面无法表达"四帖表（他这条若确认是"去不掉"，正好补上 #2822 那一格的第二实例）。给本地透传器删字段的绕法，**顺带能直接回答"到底是谁发的"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4709#discussioncomment-18170279) |
| 4711 | 无（信心 <0.6，按规则**先追问不推销**） | 一句话 + 问号，无任何可动手的信息。**给了决定性的对照实验**（建只差一个字的两个文件夹）并做成四行表，把四种结果分别指向"真是这个字（编码/字节层）/ 所有中文名都失败 / 部分中文字失败（**把成功与失败的字各列几个，这份清单对定位极有价值**）/ 与字无关是那个具体路径"。列出必须补的五项，**特别强调第 4、5 条**——这个社区有一类问题的表现是"点了没反应/闪回去"而后端其实返回了完整错误、只是前端扔了（#902 那位为此做了一次逆向工程）。给优先排除方向：Windows 中文版的 GBK 代码页（接 #2373 同环境的 `UnicodeEncodeError`），并给"改成纯英文路径再试"的快速自查。**明写我在 macOS、路径全英文、从没撞过中文路径问题，帮不上更具体的** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4711#discussioncomment-18170285) |

### 增量批次 5（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4702 | 官方 `apps/cli/src/plugin.ts` 逐行核证 + 我们自己的依赖链事故 | **先缩小再放大他的诉求。** 逐行核过那段代码（该文件在我这份副本里最后一次改动是上游 `feat/npm-public` 合并，不是分支改的）：① 他的第 1 条诉求**已经满足**——`pnpm failed in profile directory` 那句 write 在 `if` 之外、无条件执行；第 3 条也已满足——pnpm 是 `stdio: 'inherit'` 起的，`ERR_PNPM_GIT_FETCH_FAILED` 从未被吞。**于是只剩一个缺陷，修法是纯减法**：提示的门是**一条对 argv 的正则**，既不看退出码也不看 `ERR_PNPM_*`——不是"主要按命令形状选诊断"，argv 是**唯一**输入。② **同一个门在反方向也坏，而这半他没报**：因为判据只认 git 形状，一个**非 git 的 npm 包**若正因该提示描述的原因失败（传递依赖带 install script → `ERR_PNPM_IGNORED_BUILDS`），提示被完全抑制——**最需要那句 allowBuilds 的人恰好看不到它**。这不是假设：我们自己发布链上 `pi-ai` → genai 客户端 → `protobufjs` 就带 install script，是新用户遇到的第一件事。结论：按 `ERR_PNPM_*` 选提示能一次修好两个方向，且他列的错误码集合正确、只需去掉 git 形状这个前置条件 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4702#discussioncomment-18170407) |
| 4683 | 43 座位清单（实测）+ npm 实查到已有先例 | @zhengyuzi 的"做成插件"方向对，但他要的那件事有**精确答案**：**模型选择器就是一个 slot，而且已经有人坐在里面。** ① 座位存在：`conversation.input.model`（session scope），出自真实安装树里官方客户端包的 `SlotMap` 声明。② **已有第三方先例**：npm 上 `reasoning-slider`（"Codex-style reasoning-effort slider embedded in the DSH model selector"）的 `lib/client.js` 注册的正是这个座位——不是理论，今天就有仓外包在模型选择器里渲染，且因为是独立安装的包所以 `npx` 更新冲不掉。③ **他这个用例的代价必须先说**：该座位 kind 是 `single` 不是 `list`，注册进去是**替换**不是追加——所以不是"给现有选择器加搜索框"，而是"自己实现一个带搜索框的选择器"。④ 四个**静默失败**的坑（缺 `./package.json` 导出→`ERR_PACKAGE_PATH_NOT_EXPORTED` 被吞并永久缓存成"不是 client 包"、cjs+`__ModuleLoader__` 包裹与 `module`/`exports` 自声明、两个 `inject` 字段含义不同、两条构建命令会被 `clean` 互删），**每条都用 `reasoning-slider` 已发布产物独立印证**。⑤ 没有座位时也不等于做不到：`@puji4810/dsh-mermaid` 用 `root` 入口 + DOM 后处理已上线（代价：非官方契约）。并劝退他自己那套"diff 目录 + memory 文件"方案 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4683#discussioncomment-18170412) |
| 4672 | 独立源码核证 + 实跑真值表 + src/runtime.ts:2267 | **实跑他那个函数，发现他报告里的复现路径是错的。** ① `validateEscalationArgs(undefined, '')` 抛的**不是**他写的 `expected a non-empty sentence`，而是第二条判断 `justification is only valid together with sandbox_permissions`——第二条先命中，第三条永远走不到。给了六行真值表。**这对定位有实质影响**：他现场看到的那句话只能由 `sandbox_permissions` **自己也是空串**产生，即丢失 `undefined`/`''` 区分的是**两个字段**不是一个。结论对他有利——3.6 的修法不变，但"只归一化 justification"不够。② **测试盲区比他写的更大且是"行覆盖率骗人"的标准形态**：spec 覆盖了 `'   '` 却没覆盖 `''`，而两者走**同一行**，所以该行覆盖率 100% 而四个空串组合全未测。**并指出同日 #4676 的 `redactSecrets` 是一模一样的形状**（`default` 分支被普通叶子类型跑满、危险场景从未进过测试），建议两处一起考虑。③ **给"想先用插件绕过去"的人一条硬边界，这条直接支持他"必须上游修"**：引我们 `src/runtime.ts:2267` 的写死拒绝——原生工具的 arguments 改不了，理由原话 "DSH logs arguments before policy"；反方向 `system-prompt/assemble` 改 schema 可行（实测改 description、删 `parameters.properties` 字段都生效）但只决定模型看到什么，救不了参数适配层丢失的区分。④ 问题 B 归入"写入宽松/读取严格"一族，肯定他记 `ctimeNs` 的做法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4672#discussioncomment-18170419) |
| 4701 | 官方 escalation/sandbox-policy 源码 + Context 公开服务全表（实测） | **把根因推深一层，而这改变了这个需求本身是什么。** 不是"授权没被记住"，而是**授权里根本没有路径可记**：`approveEscalation` 返回的是 `SandboxMode`，`ESCALATION_TARGETS` 是闭集 `['workspace-write','danger-full-access']`——授权的全部载荷就是三级阶梯上的一格；`WIDER_MODES['workspace-write'] === ['danger-full-access']`，所以他现在点掉的每一个弹窗**都是一次性的 danger-full-access**；`SandboxPolicyService.resolve()` 里 `workspaceRoot` 由 `session.header.cwd` 推出、**只有一个**，`overrideOf(session)` 返回的也是 mode 不是 path。**推论**：给现有授权加记忆＝记住"本会话可用 danger-full-access"，**正是他明说不想要的那个全局开关**——目录粒度是词汇表里的**新维度**，不是持久化功能。② **第三方插件能不能代劳：不能，而且我是查过表才这么说**——`ctx.sandboxPolicy` 只有 `resolve`/`overrideOf`、**没有 setter**；`ctx.permissionPresets` 确有 `set(session,name)` 但 preset 是 `ask`/`never`、同样没有路径维度。这件事只能上游做。③ **给一条今天可用的办法**：既然 root 由 session cwd 推出，把会话 cwd 设在那几个目录的**公共父目录**即可一次覆盖、零弹窗且不开全权限；**如实写明代价**——该父目录下的其它东西也一并进来，只在"那个父目录本来就可信"时成立，是布局的绕法不是功能的替代 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4701#discussioncomment-18170435) |

| 4676 | 无 | **毙，社区已闭环。** @argszero 已逐条核过 rc.2 并给出容器类型全表、行号（redact.ts:57-90、:86-91、schemastery :408-433/:525）与家族上下文（#2445 的第 35 条独立复现）；@nokkies 已给出跑了一段时间的实现形状（`tuple` 按 `.list` 逐位递归、`union`/`intersect` 两趟、其余 fail closed + `SAFE_LEAF_TYPES` 白名单）。**我唯一的角度是 `role('credential-ref')` 与"凭证只经环境变量、永不落盘"，而提帖人正文里已经自己写到了 `credential-ref` 这一点**。再发一遍是刷屏。（该帖的"覆盖率门禁量的是行不是输入空间"这条结构观察未被浪费——已写进 #4672 的回帖并点名指回本帖） |

### 增量批次 6（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4667 | 官方 dispatch 模态行为（我们 tests/provider-adapter.spec.ts:330 的断言）+ examples/vision-bridge（等级一） | **主问题 @nokkies 已解决，我接他完全没人答的"次要问题"——而按提帖人自己的证据，那根本不是次要的。** ① **两个问题是一条因果链**：模型看不到图 → 用 `find / -type f -iname '*.png'` 全盘找 → 那次工具调用才撞上 duplicate-symbol 崩溃。修好能力提示，这一轮压根走不到坏的查找。这句没人说过，而"加个提示"看起来像打磨、实际是触发器。② 指出**两个问题是同一失败形状**（系统握着用户需要的信息却没送到面前）。③ **一条可自查的矛盾**：0.1.1 线上宿主 dispatch 会把图片块换成显式 `[image omitted …]`（我们对装好的 0.1.1 有契约断言，按 `LlmAdapter.prototype.prepareCall` 能力探测），而他在 rc.2 上看到的是 `Image sha256:…; 884x650px`——**不是那个提示**。所以要么他那条路由**没被声明为纯文本**（DSH 认为该模型收图，自然没有不匹配要处理），要么附件走了别的路径；建议先查路由的 input modalities 再报"提示缺失"。④ 视觉伴生路径按等级一给出并**明写利益相关 + 明写这是并行路径不是修复**，他要求宿主"拦下或说明"的诉求依然成立 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4667#discussioncomment-18170524) |
| 4664 | 官方 goal-round-driver / JobsService 源码逐行核证 | **确认不是他用法问题，且缺口比他写的更具体。** ① 根因就在 `agent/status` 那一个 handler：`status === 'idle'` → `requestDrive(state)` **无条件触发**，driver 里没有任何"这个 agent 是不是在等什么"的概念——**他的对照实验（`job_output(wait:true)` 不注入）因此完全准确**，触发条件就是 idle 检查点本身。② 一般形状：**`idle` 被当成"没事可做"的代理指标，而它只表示"当前没有回合在跑"**。③ **判断所需的数据已经在同一进程的公开服务上**：`JobsService.list(caller?: Agent): JobSnapshot[]`（同步、按 agent 归属）；而 goal-round-driver 的 peerDeps 只有 agent/goal/invariants/llm/session/cordis、源码一次没提过 jobs——**所以不是缺 seam，是两个子系统没接上，修法不需要新增公开面**；给了 `ctx.inject(['jobs'],…)` 可选注入的接法（官方 llm-pi-ai 同款），无 jobs 组合时行为不变。④ **空转回合不只是费 token**：他记录到模型无新信息却自称 "~15/20/25 min in"——被迫发言时会把时间感编出来，**幻觉句进历史后被后续回合当事实读**。⑤ 建议提案别只特判 jobs（等审批、等子代理同理），否则下一个机制还会再撞。⑥ 自救路径（`ctx.goals.pause/resume` + `jobs.list` 写插件）**明写"只读了源码、没写过没跑过，不算实测结论"**，并建议在官方修好前继续手动暂停 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4664#discussioncomment-18170534) |
| 4666 | 无（**只为他自己报告里被冷落的那一半说话**，零推销） | 修复 #1（effort 继承）已有分支 + @argszero 逐行复核 + @denial123789 三 header 取证模板，**四条评论全在 #1，#2 零关注**。为 `SubagentResult.diagnostic` 立论：① **这不是打磨那一半**——他找到根因的方式就是父工具只给 `Error: subagent run failed`、他去翻子会话日志才看到 400/1210 与 header 缺 `reasoningEffort`；端点的报错**具体、正确、且已落盘**，只是没被路由给唯一能处理它的人，之后每个撞上的人都要重做一次 jsonl 考古。② **这是本仓库的重复类，不是孤例**，列出我本周亲自读过的四个同形状实例（#4667 符号查找返回 undefined、报错不提是哪个工具也不提哪个包重复；#902 后端返回完整 `agent-preset-invalid` 而前端扔了；#4657 空 body 400 被换成一个自信的错误结论；#4689 锁里记着 PID 而没人读）。③ **落地论据**：effort 只是一次端点契约不匹配，只修 #1 的话下一个（某网关必需的参数、某模型拒绝的 tool_choice）会产生一模一样的裸字符串和一模一样的考古——#1 修一个实例，#2 修"子代理知道而父代理没被告知"这一整类。④ 给评审阻力预案：子会话终态 `turn/end` 错误**已经落盘**，所以 #2 是路由改动不是新增信息采集。⑤ **主动披露我在子代理这件事上不是中立方，并明说正因如此不提我们任何东西**，本帖分支就是正解 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4666#discussioncomment-18170542) |

| 4656 | 无 | **毙，已闭环且有 PR。** @Jstn-1g 已核到精确根因（`Commands.execute` 在 0.1.0-rc.8 从 `(agent,line,signal)` 变为 `(agent,line,images,signal)`，dsh-lark 仍传三参 → 宿主把 Lark 的 `AbortSignal` 当 `images` 收、`signal` 收到 `undefined`，首次读 `signal.aborted` 即抛），并指出**影响的是全部委派宿主斜杠命令而不只 `/permission`**，已提交带回归的 PR（omdsh-dev/dsh-lark#18）。问题出在第三方 lark channel 包，既非我们的面也无我方增量 |
| 4671 | 无 | **毙，三位高手已闭环到比我能给的更深。** @argszero 核到 `llm-deepseek/src/translate.ts:159-160` 并归入 first-frame identity 家族；@nokkies 走真实 SSE 路径复现并给出 `!== undefined && !== null` 双判；@Jstn-1g 已交付基于 master `b150a551b8` 的参考实现；两人后续还把讨论推进到 **id 与 name 的修复边界不同**（`ToolNotFoundError` 由 name 构造，合成 id 救不回）以及**测试断言应读原始流而非组装结果**（组装器的 `if (chunk.name)` 会吸收 `null`，导致测试因错误原因通过）。我唯一的角度是"我们的路由不经过这个 adapter"——**既是推销，且按自订规矩只到"结构性成立/行为未测"**，不够格发 |

### 增量批次 7（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4715 | 官方 goal-round-driver / run-settlement.ts / SubagentsService 源码 | **我在 #4664 里写的"jobs 大概率不是唯一要挡的信号，等子代理同理"，几小时后被独立验证——这就是子代理版。** 先串联两帖（同一 handler、同一根因）。**核心增量是把两者拆开：它们的修法不一样，而他这条更难。** `run-settlement.ts` 开篇原话 "**Only the one-shot background path uses Jobs; continuable children have no Task**"——所以 ① one-shot 后台子代理经 `jobs.start`（tool-subagent/src/index.ts:406）注册，#4664 那个同步 `jobs.list(agent)` 检查**顺带就覆盖了**；② **continuable 子代理完全没有 Jobs 注册**，唯一公开面是 `SubagentsService.listChildren(...): Promise<...>`——**返回 Promise，而 `agent/status` 是同步 `ctx.on`**。这是实现者要正面回答的设计问题（检查改异步后"答案回来时它还 idle 吗"），不是细节；**若他的 10–30 分钟子代理是 continuable，便宜版修法救不了他**。建议提案写成"这个 agent 是不是在等它已经发起的事"，jobs/subagents 只是前两个答案。并把 #4664 的幻觉时间感证据带过去（空转回合会污染它自己要重复 prefill 的上下文） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4715#discussioncomment-18170663) |
| 4712 | **npm 实搜（按规则先搜社区）** | **标准的"已经有了，别推销我们的"案例。** 他问"能不能增加一个记忆插件模块"——**npm 上已有十几个原生 DSH 记忆插件**，DSH 现在就是他描述的那个形态。做成五类可选清单（模型工具型 / 自动沉淀型 / 人类可读文件型 / **注入策略型** / 接外部托管），并指出 `dshmarket` 可在 DSH 内可视化浏览。**明写"只看描述、我一个都没跑过，这是可选清单不是推荐榜"。** 增量不在抄清单而在两条挑选轴：① **真正的难点不是存取而是"何时注入、注入多少"**——记忆每轮都吃上下文，存得越全注入越要保守，所以"注入策略型"不是边角而是该先读 README 的地方；② **记忆落在哪儿**（人类可读 Markdown 可自己改可随仓库走 vs SQLite 检索好但看不见搬不动），是取舍无正解。**关于他点名的 Hermes：如实说 `pi-hermes-memory` 是 Pi 包、需经我维护的兼容层、利益相关，并明确建议他先试原生那批**（少一层引擎、排查路径短一半），只有原生都不满足才考虑走桥 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4712#discussioncomment-18170675) |
| 4668 | 读了他的 fork 分支 diff（2 文件 +66/-3）+ serializeAssistant 源码核证 | 原帖只有一句话 + 分支链接，**没人能评审看不见的东西**——我把分支拉下来读了。① **先问最关键的一问**：标题说"插件能破坏 wire 协议"，而 diff 与正文都没说**哪个插件、做了什么**才让 assistant 的 `tool_calls` 失去配对；若插件能注入这种消息，更该修的可能是注入点，`ensureToolCallsBalanced` 只是兜底网。② **肯定该肯定的**：给孤儿 tool_call 合成 `role:'tool'` 回复不是可选项——OpenAI 兼容端点会硬拒，且坏形状**持久落在会话日志里**，之后每一轮都失败；这与 #4703 的 fail-soft 论据同源。③ **反对合成假调用**：`function:{name:'tool',arguments:'{}'}` 捏造了一次没发生过的助手动作并给了**假工具名**——**#4671 刚在本仓库确立"name 是承重的"**（`ToolNotFoundError` 由 name 构造），他自己的 else 分支（转成 `role:'user'` 文本）才是诚实选项，建议两处都用它。④ **一处值得补测**：orphan 路径先 `flushPending()` 推入 `role:'tool'`，随后 `lastMsg` 必为 tool 而非 assistant，**捏造分支看起来在有 pending 时不可达**；明写"我是读的不是跑的"。⑤ **替他挡一个必被问到的点**：`lastMsg.tool_calls.push` 就地改是安全的——我核过 `serializeAssistant` 每次新建对象与新数组，改不到会话状态。⑥ 指出应与 #4671 合并测试（那个 inbound bug 产出空 id，正好落进他 `tc.id.length>0` 的判断） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4668#discussioncomment-18170683) |
| 4708 | 我们自己的轮询源码（src/browser-surfaces.ts:645、dsh-x/src/{mcp-tab:118,side-chat:156}）+ examples/tui-mcp（等级一） | ① **来自另一条 DSH wire 的独立印证，且是自曝**：我们的浏览器半边为同一个原因手搓了同款 loopback 长轮询——引我们自己源码原话 "the client half **polls** it"、`setInterval(pull, 4000)` / `2000`，并说明为何不冒充官方 typert Remote。**两个互不相关的接入方在两条不同 wire 上落到同一个长轮询，是"结构性缺口"的合理证据。** ② **把诉求缩小成更容易通过的形状**：能力不缺、缺的是 wire——**MCP elicitation 已端到端可用**（服务端中途向人提结构化问题，落在 DSH 自己的问答面，等级一有 example），成立的原因正是他撞到的约束：不跨进程、provider 就在进程内。所以这不是"给 DSH 加人机交互"，是"SDK wire 缺一个进程内路径已有语义的请求类型"。③ **DSH 已经有一条带 server→client 请求的传输，而它的 bug 报告就是设计参考**：ACP 的 `request_permission` 是真请求，#4693 报的是**没人应答会挂住整个 turn**——这是该能力**自带**的失败模式，必须写进规格而不是留给每个接入方（他的 `wait=25` + abort 已经在摸这件事）。④ 关联 #4697（子代理向用户提问）是同一缺口第三个角度。⑤ **建议他在提案里明确一问**：加了 wire 请求后，`userQuestions` 那个"单一 active provider"槽是被替代还是仍需进程内转发——这决定嵌入方能否与任何想占同一槽的 UI 包共存 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4708#discussioncomment-18170690) |
| 4713 | 无第一手证据（**已明写**）；归属分流 + 反对一条修复建议 | ① **归属分流，对他有利**：他跑的是 `dataelement/dsh-desktop` 社区 Electron 构建，**不是本仓库发布物**；给了二分复现（stock `dsh` CLI/web 上跑同一条命令：也崩→落 `dsh-subprocess-local`，不崩→该去桌面壳仓库），省得报告在错的地方排队。顺带要求他点明走的是 pty 还是普通 spawn（DSH 安装树确实带 `node-pty`，两条路径错误面完全不同）。② **建议他撤回自己的修复建议 2（全局 `uncaughtException` 兜底）**：Node 官方明确 uncaughtException 后进程状态不可信、应记录并退出；硬留下来会泄漏句柄、状态半更新，**而且会把这个 bug 变静默**——他现在至少还有"应用崩了"这个信号。③ 肯定建议 1 与 3，并指出 1 大概率就是真根因：**未挂 `'error'` 的 stream 遇 EPIPE 会直接 throw 成未捕获异常**，子进程被 `TerminateProcess` 硬杀正是典型形态；要在**正确的边界**上处理而非进程顶层拉网。④ 肯定他那段 Windows `os.kill(pid,0)` 语义分析并建议与宿主健壮性分开走。⑤ **明写"这条我没有任何第一手证据，不是我在 DSH 上实测出来的"** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4713#discussioncomment-18170699) |

本批 5 条全部回帖，无毙掉。

### 增量批次 8（2026-08-27）—— ACP 一族 + typert

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4694 | examples/tui-mcp（等级一）+ tests/agent-scoped-mount.spec.ts + assemble 快照实测 | @denial123789 说"schema 是易的一半、生命周期与权属是难的一半"——**我恰好能对难的那一半出证据：运行时供给、按 Agent 作用域的 MCP 工具面今天就跑在 DSH 公开 seam 上**（只是不经 `dsh-mcp-client`）。① 等级一事实：用户在**活会话里**通过管理界面增删 MCP server（stdio/Streamable HTTP/SSE + OAuth 全套 + lazy proxy + resources/prompts/images/approval/elicitation/sampling/reconnect），工具落到 `ctx.tools` 并被同一会话的模型使用，Web/dsh-TUI/第三方 TUI 三端有 example。**推论：他要的"Agent 创建之后才到达、按 Agent 归属的工具面"不是要新发明的生命周期模型，seam 已经承得住；`dsh-mcp-client` 的部署级作用域是那个插件的设计属性，不是 `ctx.tools` 的约束。** ② **两个实现地雷**（我踩过、契约测试钉死）：**(a)** 连接/凭证/目录半边锚 root 共享、**工具面半边必须逐 Agent**，且要用 `agent/created`→公开 `agent.ctx`（dispose 自动 unwind）；`setup(agentCtx)` 是创建者独占参数、root 插件不可达，`agent/session-start` 官方明文不能做启动门禁，**且 config 声明式 Agent 根本不走创建者 setup**——对多租户就是"只对我客户端建的会话有效"与"有效"的区别。**(b)** `assembly.tools` 在 `system-prompt/assemble` waterfall **之前**快照，晚一步注册的工具面当轮对模型不存在且无任何报错（表现为"该租户没有工具"，第二轮才好）；正解是在 assemble 里等挂载完成并用 `tools.schemas(agent)` 补快照，`tools/pre-execute` 同样要等。**`session/new` 紧接 `session/prompt` 正是 ACP 常态，所以这不是边角是默认时序。** ③ 指出他的 ask #1 与 #2 不是二选一（allowlist 答"谁批准了这个端点"，session-scoped 答"这个租户拿到哪几个"）。④ **明写我们从没碰过 ACP、也实现不了这条**，证据只关于 `ctx.tools`/agent 作用域/assemble 时序 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4694#discussioncomment-18170805) |
| 4693 | 官方 `ApprovalOutcome` 类型 + ACP `approval/request` handler 源码 | ① **他要的 fail-closed 出口已经在词汇表里**：`ApprovalOutcome = 'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'`，且**所有消费方已被穷尽性守卫强制处理**（`core/tools/src/index.ts` 以 `assertNever(outcome,'ApprovalOutcome')` 收尾，沙箱升级路径对它有专属报错文案）。所以超时不需要新出口、新配置形状，也不需要改 bridge 以外任何东西。② **而那唯一一处今天既没有超时也没有 `.catch()`**（贴出整个 handler）——改动就是给那个 promise 加个有界 race 返回 `'unavailable'`。③ **修正/锐化他一处表述**：他写"没实现该反向请求的客户端会无限挂"，但**未实现的 JSON-RPC 方法应返回 `-32601`，那会让 `conn.requestPermission` reject**，而 handler 没有 `.catch()`，rejection 会传进 waterfall 而不是挂住——若如此，则**只有"实现了但不应答"的客户端才挂**。明写我无法在没有他客户端的情况下确认是哪种，并指出这改变该写的文档措辞（"不实现就挂"可能比真相更吓人也更不准）。④ 交叉链接 #4708：ACP 有请求方向但没有 deadline 语义，SDK wire 两样都没有——**他这条正是那个能力自带的失败模式，应写进规格而非留作 follow-up**。⑤ 对他 `allow-once` 兜底的补充：不重复 @denial123789 的告诫，只提醒那条**承载在"另有权威执行器拥有全部副作用"这个属于他自家部署的前提上**，建议在正文写明以免读者照抄 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4693#discussioncomment-18170806) |
| 4679 | 我们自己的 src/browser-surfaces.ts 注释原话 + 轮询源码 + client-modules 静默缓存事故 | @nokkies 已找出第三道门、提帖人已自行拆分，我补的是**对他 ask #2（单包入口）的第二作者数据点**：**我是另一个撞上同一堵墙的仓外作者，而我选了另一个出口**——直接引我们源码里的原话"**not DSH's typed Remote system — that is a first-party generated contract, and an out-of-tree plugin talking to its own UI should carry its own channel**"，即放弃生成契约、自建 `ctx.webServer` 路由。**两个仓外作者、两条不同逃生路、同一个成因**，这就是 #2 的论据。② **如实报出这条逃生路的代价**：没有 push 通道，客户端只能**轮询**（`setInterval(pull, 4000)` / `2000`）——他的 staging 换来的是真 strict descriptor 和真 `$mount()`，我换来的是一个定时器，**两者都不该是仓外作者要在其间做的选择**。③ 支持他把 ask #1（诊断）排第一，理由是**这条在 build 期失败却长得像成功**，比构建失败更糟。④ **补一条同路径上的另一个静默门（自曝）**：runtime 半边的 client-modules 扫描按 subpath 解析 manifest，包声明了 `dsh.client` 却漏导出 `./package.json` 会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，**该异常被吞并缓存成"不是 client 包"**，页面全空、控制台无声、重部署也不清。**结论：仓外浏览器半边这条路至少有两处"诚实答案是空、可观测答案是沉默"，形状相同，多半是同一个下午能一起修的** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4679#discussioncomment-18170808) |

| 4691 | 无 | **毙，无第一手增量。** 提帖人自己已给出全部证据（全包只有一个 `sessionUpdate` 字面量、事件处理只过滤 `assistant/message`、SDK 侧已建模 tool lifecycle 与 usage），@denial123789 已把"呈现 vs 控制面事实"这条关键区分说透并给出最小投影形状（保留 callId 关联）。我能说的只有"这与 #4708 是同一类 wire 缺口"——**而这句我已经在 #4708 那边说过并做了交叉链接**，在这儿再发一遍是刷屏，且我对 ACP 事件面没有任何实测 |
| 4692 | 无 | **毙，我的增量只是一个类比。** 他已经精确指出根因（`AcpConfig.stream` 这个 seam 存在但**被刻意排除在导出的 `Config` schema 之外**，注释写着 "Runtime-only transport override; production uses stdio"，因此从唯一的生产配置面 `cordis.yml` 不可达），@denial123789 已给出远程托管所需的权属不变式。我唯一想补的是"**运行时类型支持而配置 schema 不开放**"这一族在本仓库另有实例（`PiAiCompatProfile` 富而 `compatProfile` zod schema 只开子集，见 #473/#4707/#780）——**但那是类比不是解法，他本人已经把这一点讲得比我清楚**。按"宁可少发也不要发不准的"不发 |

### 增量批次 9（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4696 | 官方 tool-subagent 提示词原文 + continuation.ts 交付语义 | @denial123789 的身份分析对，我接的是**他没解释的那一半：为什么是"卡住"而不是"报错"**。① **模型做的正是 DSH 让它做的事**——它的推理轨迹"子代理完成会以运行时通知到达，我结束本轮等待"不是猜测，是**把 DSH 自己的工具描述复述回来**（`tool-subagent/src/index.ts:304`/`:464` 原话 "the runtime sends the parent a notice containing its outcome"）。所以错误识别后它**正确恢复**了，然后等一个工具许诺过的通知，通知没来——**这后半才是真 bug，且与 `job_output`/UUID 张冠李戴是两回事**。② 机制确实存在（continuation 管理器owns "settlement delivery to the parent"，且文件明写 "**The Agent inbox is the only turn queue**"），所以本该唤醒，范围因此收窄。③ **给一条把报告一分为二的可执行检查**：同一文件会打 `subagent "<childId>" settlement notice was not delivered to its parent` 警告——**有** = 子代理已结算而通知在投递环节丢了（警告还点名了是哪个子代理）；**无** = 子代理根本没结算，那问题在缺失的那两章。并指出标题说的"polling fails"可能与真正的卡死无关。④ 交叉链接 #4715/#4664：**同一 seam 的反方向**（那边 idle 被唤醒得太频繁，他这边永远不被唤醒），并引 continuation 自己文档化的竞态窗口（`followup()` 与 turn 被接受之间 `Agent.status` 仍是 idle）。⑤ 建议给他的 Expected 加第三条（接 #4666：失败子代理连一句裸报错都没有） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4696#discussioncomment-18171108) |
| 4678 | 我们自己消费 `assistant/chunk` 的源码（runtime.ts:1998、subagent-bridge.ts:386）+ compatibility.ts:523 的诚实措辞 | **以"真实的仓外 `assistant/chunk` 消费方"身份，给他的"why this is safe"补一条他没写的不变式。** ① 事实：我们订阅 `session/event`，在每个 `assistant/chunk` 上累加文本投影出流式更新事件给上层 Pi 插件；我们自己的能力表里如实写着这是"累加近似、不是重建"。② **关键区分**：我们消费的是**实时流，不是 history page**——所以他的补丁对我们安全，但这个边界值得写进 PR：**只在 history 读取路径省略 chunk，实时 `session/event` 流必须继续发**，因为仓外消费方没有别的部分内容来源。③ **说明越界的后果是静默的**：我们不会报错，只会不再看到中间更新，渲染流式输出的插件会看起来"卡住"而不是"坏掉"——正是最难查的那种。④ 建议加一条测试与一句补丁说明：history 现在对已关闭消息是"终态消息权威"，冷启动后从 history 重建 in-progress 状态的消费方拿到的是最终内容而非累加流。⑤ **明写我没跑过他的补丁、我们今天根本不读 `historyPage`，所以这不是测试结果**，是"还有谁碰这些事件、线该画在哪"的备注 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4678#discussioncomment-18171110) |
| 4681 | 我们自己的两处静默失败（#4679 已引的 typert 逃生 + client-modules 缓存事故） | ① **先如实说我确认不了他的 `$mount` 模式**——我们刻意不用 typert Remote（原因就是他在 #4679 撞的那条），所以那个模式算他的发现不算我的。② 增量是**把这条与他自己的 #4679、我的一处事故并成"同一条路径上的第三个静默/欺骗性失败"**，建议当一个工作流而不是三张文档单：**build 期**（`discover()` 返回 `[]`，构建像成功却零产物）→ **load 期**（漏导出 `./package.json` 致 `ERR_PACKAGE_PATH_NOT_EXPORTED` 被吞**并缓存**成"不是 client 包"，重部署也不清）→ **mount 期**（本帖：读自己命名空间抛 `without inject`，而显然的修法——写进 module 级 `inject`——会让 fiber 与自己的 mount 死锁）。**三个阶段，三种"空白面板 + 零信号"。** ③ **主张他标为 optional 的那半才更该做**：文档段帮的是会先读 `$mount` 文档的人，而这条路径另外两处失败同样没有可用文本，所以真正卡住的是**不读文档的那批人**；他提的特例化报错很精确也很便宜（fiber 知道自己刚 mount 过那个名字），一句话就能补上欺骗性失败这个缺口 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4681#discussioncomment-18171113) |
| 4711 | #4654 已核证的根因（转述）+ 我上一批给他的四行对照表 | **回头结帖：把两天前那条无人应答的模糊提问闭环掉。** 他当时只有一句"dsh无法读中文文件夹？"，我给了四行诊断对照表并明写"我在 macOS、路径全英文，帮不上更具体的"。**表里第 3 行（"部分中文字失败——把成功与失败的字各列几个"）命中的正是 #4654**：根因不是"中文路径不行"也不是"中英混合不行"，而是 **`U+xx00` 类字符**——Windows 原生目录选择器扫 UTF-16 终止符时只查每个码元的**低字节**，而「开」U+5F00 的内存字节是 `00 5F`，低字节恰为 0，路径当场截断（`软件开发`→`软件`）。给了他三件可执行的事：① 名字含「开」「一」这类字就去 #4654 跟进（那边已核到源码行、有补丁，并统计为同族第约 10 份报告）；② **临时绕过**——目录改成不含 `U+xx00` 的名字，或直接粘完整路径；③ 改名后仍不行就**不是**这个 bug，四行表其余三行仍适用，按第 4、5 条贴后端日志。并为让他等了两天致歉 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4711#discussioncomment-18171115) |

| 4654 | 无 | **毙（但产出转化成了 #4711 的结帖）。** @argszero 已核到 `win32-dialog-bindings.ts:37-42` 并**统计出这是同一截断家族的第约 10 份报告**（#3188=#3279=#3291 重复、#3442、#3419、#3505、#3463、#4624）；@nokkies 已把规则精确表述为"低字节为零的码元 `U+xx00`，不是'中文路径坏'"。技术上我一个字都补不上。**但它是 #4711 的答案**——那条两天前无人应答的模糊提问是我回的，所以正确动作不是在这儿再发一遍，而是**回 #4711 把答案送到提问人手上**，已办 |
| 4659 | 无 | **毙，已闭环且有参考实现。** @Jstn-1g 已在组件契约层复现（`ProducedFiles.tsx` 已从 loopback 来源与宿主能力算出 `canOpenPath`，但**只有溢出菜单里的 Show in folder 消费了这个判断**，可见的文件 chip 仍是按钮、照样能调原生打开器），并发布了基于官方 `b150a551b8` 的带测试参考实现与确切 commit。这是纯 DSH 客户端组件问题，我们不碰也修不了，且无第一手增量 |

### 增量批次 10（2026-08-27）

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4718 | 43 座位清单（实测）+ 我们自建的 `shell.overlay` 侧聊窗（0.21.0 已发布） | **他的前提成立，而且我恰好建过那个绕过方案，它的局限正是这套 API 的论据。** ① **单槽属性是被声明了两次而不只是默认值**：`conversation` 是 **single** 座位；`conversation.view` 虽是 list，但官方注释原话说会话主体按 **`only: <active id>` 一次只渲染一个**——两层都钉死。② **自曝我们能做到什么、代价是什么**：我们的浮动侧聊窗占 `shell.overlay`（唯一可追加的 frame 座位）portal 到 `<body>`，**所以"显示第二个对话"今天就能做**（评审多半会这么怼他）——但那是**我们的**面板、渲染**我们的**数据、走**我们自己的** HTTP 路由（还得轮询，仓外客户端没有 push 通道），**用不了宿主的 `Conversation` 渲染器，也不是一个挂载的 Session**（没有宿主输入路由、没有 lineage UI、没有 trajectory 视图、session 级座位不会渲进去）。③ **给他提案最该突出的那句区分**：*显示第二个对话* ≠ *挂载第二个 Session*，前者已可行、不是缺口；后者才是，且缺在 `Conversation` 内部没上客户端表面。④ **指出他的向后兼容一节低估了一处**：`capacity > 1` 时所有 **session 级座位会为两个不同会话并发渲染两次**；我们的客户端半边全部按 session id 归键、**可能**扛得住，但**两个可见会话今天根本构造不出来，所以没有任何插件在那个状态下被跑过**——要求他在契约里明确"两个会话可见时一个 session 级注册被许诺什么" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4718#discussioncomment-18171294) |
| 4648 | #4654/#4624 已核证根因（转述）+ 补可操作绕过 | @nokkies 已给出根因与补丁，**我补的是他那条没写、而提帖人现在最需要的：官方修好之前怎么把工作区加上**。提帖人只发了一张截图，拿到的是一份优秀的英文根因分析和零个可执行动作。用中文重述规则（**不是"中英混合"也不是"中文"，而是码点末两位为 `00` 的字**，如「一」U+4E00、「开」U+5F00），给三条今天可用的绕过（改名避开这类字 / 不走弹出选择框直接输完整路径 / 先挪到纯英文路径反证），并给出"改名后仍不行就不是这个 bug"的判据。**发出后自查发现原文一处"地雷字"列表写法混乱（把一个反例混在正例清单里）+ 一处反引号笔误，已用 `updateDiscussionComment` 修正为一句话判据** | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4648#discussioncomment-18171298) |
| 4698 | 我们 E2E 装置里踩出来的 per-profile 事实（CLAUDE.md 第七节）+ #4640/#4667 | 展示帖（多实例/多版本 dsh 启动器），**零推销、纯技术贡献**，因为它正好踩在依赖树最易出事的那条线上。① **核心事实**：DSH core 由 CLI 依赖树提供，profile 只装 bundles+插件、**正常不解析任何 `@deepseek-ai` 核心包**；因此两个状态必须当故障检测——profile 里出现核心包拷贝、或树里两代核心混装。② **为什么对"可选版本"的启动器格外重要**：这正是 #4640 的故障——profile 里多一份 `@deepseek-ai/dsh-tools`，两份拷贝铸出两个不等的 `Symbol()`，scheduler 查找返回 `undefined`，**该 profile 每次工具调用都死在 `.prepare`**，加载期零报错、错误信息既不提工具也不提重复包（#4667 那位为此做了 jsonl 考古）。**能批量创建多实例多版本的工具，最有可能批量制造这个状态。** ③ 给了两条低成本自检（回读 CLI 树核心版本比对 / 扫 profile node_modules 见核心包即警告）。④ 另附三条 per-profile 事实：挂载发生在启动时（增删插件必须重启）、**profile 的组合安装是 CLI 私有流程别裸跑 pnpm install**、`dsh plugin` 调 PATH 上的 pnpm 而 profile 由 pnpm@11 初始化（版本不一致会假失败，建议启动器固定 pnpm@11） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4698#discussioncomment-18171321) |
| 4653 | Web 平台安全上下文规则（非我方能力，已明写推断性质） | 零评论的卡死用户。**"换了好几种浏览器都不行"这句本身就是最强线索**：`crypto.randomUUID()` **只在安全上下文存在**（`https://` 或 `http://localhost` / `127.0.0.1`），**用 IP 走明文 HTTP 访问不算**，所以在那种页面里它就是 `undefined`——与浏览器版本、发行版都无关，换浏览器当然没用。给了**10 秒确诊法**（控制台敲 `window.isSecureContext`：`false` 即是此因；`true` 则改查 Node 版本，`globalThis.crypto` 是 Node 19 才默认全局）。三条解法按省事排序：**SSH 端口转发**（`ssh -L 3080:127.0.0.1:3080`，并说明这是社区里跑无头服务器的常用姿势、接 #4659，不是将就）/ 服务器本机访问 / 配 HTTPS 反代。**明写"我没法百分之百确定，是从两点推的"**，并说明与我们的东西无关 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4653#discussioncomment-18171312) |

| 4688 | 无 | **毙，无第一手证据且已转为环境取证。** @nokkies 在 Windows CI 上按报告写了三向量测试（`[System.IO.File]::Delete` / `Remove-Item -Force` / `Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile`）**全部 DENIED，无法复现**，并明确说负结果值得公布以免有人去追一个可能不存在的缺陷；@denial123789 已给出把它变成有效报告所需的四项证据（父进程哨兵断言、目标与父目录的 `icacls` 含 capability SID、链接身份与卷类型、是否有祖先目录曾被选为更大的工作区）。**我在 macOS，且我们从不碰 DSH 沙箱**——这类环境敏感的取证我一条都补不上，发言只会稀释信噪比 |

### 增量批次 11（2026-08-27）—— 5 条全回，无毙掉

| # | 依据 | 说明 | 评论链接 |
|---|---|---|---|
| 4640 | #1697 的版本屏障论证 + 我们 singlepath E2E:243-262 的实测断言 | 这是我本周已在两个帖子里引用过的那个故障的**权威帖**。三点增量：① **对 @nokkies 的 `Symbol.for` 修法提出一处保留**——他"const 已导出、`Symbol.for` 不额外授予可达性"的论证在**访问**这一维是对的，但漏了**版本**这一维：module-local `Symbol()` 同时也是**版本屏障**。今天两份拷贝→两个不等 symbol→`undefined`→**响亮失败**；改 `Symbol.for` 后，**不同版本**的两份拷贝→同一个键→查找**成功**→`agent-loop@0.1.1` 去调 `dsh-tools@0.1.0` 造的 scheduler，响亮崩溃换成静默错配。**而他自己的解析轨迹里有三份实例**，profile 自解析拷贝正是版本不同而非同版重复的场景。主张 **`Symbol.for` + 协议版本守卫**（注册方盖版本、读取方校验并报出双方版本），并说明这是 #1697 说服我后我在 #3751 发过的同一处更正。② **给一条今天就能用、不依赖修复的检测法**：不变式是 **profile 不该解析出任何 `@deepseek-ai` 核心包**（core 来自 CLI 依赖树），附我们回归里在跑的那条 `find` 命令——把他的多小时二分变成一条命令。③ **指向会批量制造该状态的工具**（#4698 的多实例可选版本启动器，我已在那边留同款警告）。④ 保留他"会话被留下 `tool_calls` 无匹配结果、下一次请求上游失败、对话只能弃掉"这一条并归入"写入宽松/读取严格"族（#4704/#4662），指出 #4668 正在提的序列化期修复至少能让这个 bug 不再额外赔掉用户的对话 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4640#discussioncomment-18171490) |
| 4631 | continuation.ts 的 inbox 语义（#4696 时已核） | @Jstn-1g 的参考实现覆盖了他的 ask 1/2，**我提的是没人说过、且决定 ask 3/4 能不能建的约束**：**待发 `send_message` 队列不是专用队列，就是 Agent inbox，而 inbox 里不止他的消息**——源码原话 "The Agent inbox is the only turn queue"，同一管理器还负责把**孙代子代理的结算通知**投递进这个 inbox。逐条推论：**ask 3（move-to-front）不能是通用队列重排**（把结算通知往后挪会改变子代理对自己孩子状态的认知），必须定义成"只在**我的**follow-up 之间重排"；**ask 4（`replace_pending`）问题更尖锐**——朴素的"清空队列再插入"会丢结算通知，**而丢通知的后果正是 #4696**（父代理结束回合等一个被许诺的通知，然后永远没被唤醒，任务在大部分工作已成功后静默停摆）。指出这不反对他的诉求，而是要求 API **按构造只作用于 follow-up**（`cancel_pending_message` 已经是，这大概也是有界子集最先被实现的原因）。另建议：这个区分从用户席位上完全不可见，若 `list_pending_messages` 只列他自己的消息（正确默认），应在工具描述里写明，否则第一个看到"队列为空"而子代理明显在等东西的人会开第二个 bug | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4631#discussioncomment-18171495) |
| 4636 | 我们自己的 runtime.ts:4232 命令注册代码 | 以**第三方命令提供方**身份确认他的取证，并补一个决定成败的设计问题。① 确认：我们把上游生态插件的命令投影进 DSH 面板时，能传的就是一个字符串（贴出我们那行 `description: command.description || ...`），**自带多语言描述的第三方插件到我们这层只能压扁成一种语言**——他正文末句"以及任何第三方斜杠命令"对我们是实情不是补充。② **补的设计问题：描述在什么时候被解析。** 他给的两个方案在这点上不等价：方案 1（`descriptionByLocale`）**渲染时**选，切语言即时生效；方案 2（注册时用 `ctx.locale` 解析成一个字符串）——**命令注册发生在挂载期、一辈子一次**，解析出来就固定了，**切语言不变、要重启**；对第三方尤甚，我们没有"语言变了重注册所有命令"的钩子（真重注册还要撞命令重名与 disposer）。**建议在提案里点明，否则两个方案很可能被当等价的、随手选便宜那个。** ③ 补一条向后兼容细节（`descriptionByLocale` 必须定义回退到原 `description`，存量插件零改动）。④ **明写我不能验证的部分**：`ctx.locale` 运行期发不发变更事件、Web 切语言重渲染什么，我没实测过，方案 2 的判断是从"注册是挂载期一次性动作"这个我确实清楚的事实推的，请官方确认 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4636#discussioncomment-18171500) |
| 4633 | 跨帖综合（#4678 的实测数字 + #4722） | 诊断与最小复现都对，**我加的是：这是三个开着的帖子在描述同一个会话形态，而其中一个马上要动到这里崩掉的那个数组**。共同条件＝长会话的事件日志被**已关闭消息的 `assistant/chunk`** 主导：本帖一条 `assistant/message` 带 **254,780** 个 `sourceEventSeqs`；#4678 实测 50 条消息的一页 **38,483 事件 / 9.0 MB**，其中 **99.4% 是已关闭消息的 chunk**；#4722 是同一形态在内存侧的结果（~4 GB OOM）。**具体的碰撞**：@nokkies 在 #4678 建议改用 **`sourceEventSeqs`** 做分组——**正是这一行**，所以做省略补丁的人会在这些 25 万条数组上写新代码。两个推论：**省略补丁必须迭代不能展开**（他的修复应先落地，否则同一签名的崩溃换个地方复现）；**他的崩溃是野外规模的下界证据**，对目前只有单会话数字支撑的 #4678 有用。另建议他把"该会话在 Web 里永久不可读"这句提到显著位置（同 #4703 的 fail-soft 论据：只负责**展示**对话的例程不该把对话拿走；触发条件是会话长度，意味着每个重度用户终将撞上）。并提醒版本差异（他在 `apiproxy@0.1.0-rc.6`，另两帖是 `0.1.1-rc.2`，同一行被两条线引用应说明未变） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4633#discussioncomment-18171508) |
| 4722 | 我们自己的 runtime.ts:244/2005-2015 累加器（**含它为何不泄漏**） | ① **自曝我们是同一批字节的第三个持有者**：我们订阅 `session/event`，每个 `assistant/chunk` 累加文本以投影流式更新事件给上层插件——同进程内的第二份拷贝。**而让我们有界的那条规则正是 store 缺的那条**：按 `session:turn:step` 归键，**消息关闭时删除**（终态 `assistant/message` 到达后累加串就是冗余的）。② 把它提炼成一条**候选不变式**并用 #4678 的实测背书：**"消息一旦关闭，它的 chunk delta 不再携带终态 `assistant/message` 之外的任何信息"**——#4678 在读路径上应用了它并量出 99.4%，他这条是**store 里从未应用它**的后果。③ 引 #4633 的 **254,780** 条 `sourceEventSeqs` 作为**野外规模下界**，佐证他的 OOM 不是奇异负载。④ 建议把他的第二个成因（continuable 子代理常驻）**在报告里与第一个分开**——不同归属不同修法，并给两个相邻帖（#4696 停摆的常驻子代理；#4715/#4664 同一 seam 的反方向），指出只修成因 1 的话宽扇出仍会把每个子会话留在内存里。⑤ **明写我不能断言的部分**：store 里裁剪对所有消费方是否安全我不知道——我们安全只因为消费**实时流**且在关闭时丢拷贝，而从 store 冷启动重建 in-progress 状态的消费方会只看到终态消息 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4722#discussioncomment-18171510) |

## 池 2 跑完

160 条全部逐条自审完毕。

## 队列已跑完

81 条清单全部逐条自审完毕：**53 条已回、29 条毙掉**（另 #3766 为重复帖）。
毙掉理由分布见下方各条。清单原始判定来自子代理，**逐条复核后修正率约 36%**。

## 批次 12（2026-08-28，第一梯队①②证据回填）

三条是**带新证据回补已回帖**（此前明写"没证据不猜/不背书"的两处，现在拿实测补上）：

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 3063 | 回补 | 超时半边补证：mcp-at-scale 实测（5s 预算砍 120s 工具、30s 收轮、后续存活）；重申"仍非他要的官方内嵌 API 契约" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3063#discussioncomment-18186923) |
| 1604 | 回补 | 51 工具真服务器双端 E2E + 注册面=2 断言 + 截图；明写 51≠1000 但机制同路径 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1604#discussioncomment-18186924) |
| 2682 | 回补 | #3 失败回传的 pull 半边补证（failureReport）；明写 push/auto-resume 半边仍无证据、原生缺口仍在 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2682#discussioncomment-18186927) |
| 4334 | 首回 | failureReport 防伪断言=旁路今天就能拿到原因；明写"不是修 notifySettlement，原生一行转发才是更小的改法" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4334#discussioncomment-18186928) |
| 4639 | 首回 | 同行佐证他的插件方向（pull vs push 两条路同一结论）；零推销 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4639#discussioncomment-18186929) |
| 4311 | 首回 | modelFollow/explicitModelThinking 实测；明写"换运行时的规避不是修复，原生三条根因仍在" | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4311#discussioncomment-18186930) |
| 2006 | 首回 | 同族，modelFollow 断言口径（首条 request/header） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2006#discussioncomment-18186933) |
| 3741 | 首回 | 静默换 provider 直接判失败的断言；肯定他 descriptor 级追踪的价值 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3741#discussioncomment-18186935) |
| 1472 | 回补 | 早前口头规避路径补上可复核证据（modelFollow 正是他的计费场景反转成硬断言） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1472#discussioncomment-18186936) |
| 4254 | 首回 | 社区同类项目互为佐证（explicitModelThinking），零抢地盘 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4254#discussioncomment-18186938) |

待发批次：pi-lens/code-nav 9 帖——依赖 pi2dsh@0.22.0 上 npm（信任修复）+ verify:release 绿，勿提前。

## 批次 13（2026-08-28，0.22.0 发版后：alpha 修复回传 + code-nav 首批）

发版回归全绿后发出（npm pi2dsh@0.22.0：12 passed / 4 缺凭证 skipped / subscription-login 按设计 partial；step-seams 过；pi-tui 23/23）。

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 4311 | alpha 回传 | v0.1.2-alpha.1 原生修快照继承（child-agent.ts 引文）；rc 线规避仍适用 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4311#discussioncomment-18190512) |
| 2006 | alpha 回传 | 同上，短版 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2006#discussioncomment-18190513) |
| 3741 | alpha 回传 | 静默降级路径在 alpha 已不存在 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3741#discussioncomment-18190514) |
| 1472 | alpha 回传 | request-time selection 正对他的计费场景 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1472#discussioncomment-18190516) |
| 1851 | 首回（code-nav） | 同行 LSP 项目：送两课实战数据（信任判据常量 false 事故、lsp_diagnostics 撞名不可共装），明写能力面互补非竞品 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1851#discussioncomment-18190547) |
| 1690 | 首回（code-nav） | pi-fff 频度索引正对"重复搜索别重扫全树"；明写不修原生超时、无进度反馈、原生索引方案仍是正解 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1690#discussioncomment-18190549) |

毙掉：#2476（与 #1851 同作者同项目，避免重复打扰）；#3634（作者已自答原生根因与解法，再荐插件是推销味）。
盘点更正：此前口径"code-nav 9 帖"经逐条重扫不成立（queue 里并无 9 条 pi-fff/pi-lens 行），实际站得住的就上述 2 条——按宁可少发原则收敛。

## 上游提案（2026-08-29，0.23.0 发版后）

| # | 性质 | 依据 | 链接 |
|---|---|---|---|
| 5011 | 上游提案（Ideas） | ARCH-001 跟进：alpha fail-closed 笔记明写"等一个真实仓外事件消费者"，我们带 alpha 真机复现（`pi2dsh/probe` seq 45 → `SessionFormatUnsupportedError` 用户可见拒载）+ 三条注册形状应门 | [d](https://github.com/deepseek-ai/deepseek-harness/discussions/5011) |

## 上游候选报告队列（发帖前等拍板）

- alpha `dsh plugin add` 裸转发 pnpm 撞自写 `packages: [.]`（需 `add -w` 才能装）。
- `tools.register()` 验 output 不验 parameters 的不对称：`assertSupportedJsonSchema`
  全文件只对 `output.schema` 调用（core/tools/src/index.ts:1045），`parameters`
  零校验直入模型请求；叠加官方 mcp-client 逐字透传 inputSchema（lib/index.js:149），
  坏 schema 只能到严格端点才炸成无指向的逐请求 400。已有四组真机对照证据
  （community/malformed-tool-schema-e2e.json，#4213 回帖引用）；修法一行：
  register 时同样 assert parameters。
- ~~alpha New Session 草稿视图不换台~~ **已发**（2026-08-29，用户放行）：
  [DSH Discussion #5035](https://github.com/deepseek-ai/deepseek-harness/discussions/5035)
  （General 类目；底稿 community/upstream-report-draft-view-stage.md；复现
  seam-evidence/64-newsession-residue.png）。

## 批次 14（2026-08-29，R1 验证矩阵开跑：每绿一条发一帖）

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 3338 | 首回（R1 验证） | 429/Retry-After 故障注入真 transport 恢复实测（retry-experiment 判决 2.0s 恢复；429 不看错误体一律可重试）；明写 transport 层口径 + 官方分类缺陷仍待上游修 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3338#discussioncomment-18200080) |
| 3407 | 首回（R1 验证） | 500 server_error 故障注入恢复实测（0.4s）；同上口径纪律 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3407#discussioncomment-18200082) |

矩阵进度：e2e_only fresh 18 条 → 已发 2；累加器实验另判 #3090 方向证据 + #3047 围栏缺口坐实（进 R1 包需求）。

## 批次 15（2026-08-30，vision 卡点闭环后）

vision 端点凭证从 codex session 挖到并验证（真 deepseek-v4-flash-vision-exp）；
vision-bridge example 真机 E2E passed（伴生路径，可证伪断言）。vision 族 36 条
可回帖 live 复核：绝大多数此前已回，fresh 仅 2 条。

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 3930 | 首回（vision） | 承认 modalities 配置根因（多人已答）；补 pi2dsh 伴生自动补位这条不改配置的路径，带 example 实测证据；口径明写不改官方目录模态声明 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3930#discussioncomment-18200281) |

毙 #1765（shinjiyu 已把 modalities 根因答透，重复无增量）。

## 全量未回盘点（2026-08-30 live 逐帖复核，283 条可行动帖全查）

| 状态 | 条数 |
|---|---:|
| 已回（有我们实质评论） | **179**（63%） |
| 已有采纳答案，按纪律跳过 | 4 |
| **未回** | **100** |

未回 100 条的构成（= 为什么没回）：
- ready_now 仅 4 条，逐条复核后全部处置：#803/#2545 无增量毙（自答帖/操作分享）；
  #2692 需先重验 guardian 审批（CLAUDE.md：无 example 能力回帖前必须重新端到端验证，
  禁止凭记忆写）→ 转工作项；#2882 无引流增量按"只发落到我们 repo 的帖"口径砍。
- e2e_only 20 条：要先跑对应验证（部分缺第三方凭证）。
- adapter_work 23 条：要引擎适配开发（R1 段 2 等）。
- product_work 47 条：要先做出包（R1 provider 包、R8 提示词包等）。
- multi 6 条：要组合场景验证。

即"现在能回而没回"= 0；**未回帖的 96% 都押在开发进度上**——涨帖唯一路径是把
东西做出来，与 R1 优先的结论互为印证。（盘外 840 条永不回：782 无诚实插件
路径、58 走上游提案线。）

## 批次 16（2026-08-30，缺凭证帖按用户口径发"理论可行、未实测"）

用户拍板：缺凭证的照发，明写"理论上 work、无对应 key、有问题来找"。
CODEX_AUTH_FILE 已由用户供出（~/.codex/auth.json），#1149/codex-image 转入可跑队列。

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 2128 | 首回（理论级） | 确认作者的双 provider 撞名原理（pi-ai 源码层）；补 pi2dsh 直装 opencode provider 包 auth 原样运行的路径；明写无 zen 凭证未实测 + 邀请反馈 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2128#discussioncomment-18204766) |
| 3362 | 首回（半实测） | 先认 token 归因该官方查；线路归属半边有 gateway-compat 透传录制实证，usage 对照半边明写无外源付费账号未跑 + 邀请对照 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3362#discussioncomment-18204767) |

毙：#3387（维护者已关闭指向 #2017，而 #2017 已有我们两条实质回复含 Atlassian OAuth
全链实测——子场景已覆盖，第三条是噪音）；#695（纯截图配置求助帖，信息不足）。

## 批次 17（2026-08-30，记忆矿脉：pi-hermes-memory 端到端验证后首扫 memory_learning 簇）

前置：pi-hermes-memory@0.9.7 真机 E2E（examples/persistent-memory，双会话代号
实验：代号只存在于会话 A 输入、B 召回，B 的唯一来源=插件存储；断言 memory_add
非错 + B 用户输入零泄漏）+ 包源码核证三实锤（trigram tokenizer + 1–2 字 CJK
LIKE 兜底、/memory-pin 命令态结构性防模型写入、project 作用域目录隔离）。
逐条现场重取评论后回 8、毙 2。

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 795 | 首回 | 多租户拆两档真隔离（project 作用域源码核证 / DSH_HOME 实例级）；明写"服务端多租户+REST API"插件面给不了、project 半边只核了源码 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/795#discussioncomment-18204884) |
| 1456 | 首回（同行数据点） | jieba 作者帖：告知 hermes 正是他表里"trigram+LIKE 45% 精确"那行的生产样本（schema 源码坐标），他的 benchmark 受益面比他列的更广；明写我们验的是召回链路不是中文检索质量 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1456#discussioncomment-18204885) |
| 1787 | 增量回 | AgentExperience 作者：给"今天就在 DSH 上跑着的经验循环"当对照基线；点明分层互补（facts/lessons vs strategy deltas）；明写没跑过他的库 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1787#discussioncomment-18204886) |
| 2736 | 首回（强匹配） | 哨兵纠偏 = /memory-pin 三点全中（每轮注入/硬预算/命令态防模型写入，引源码注释原话）；明写 pin 本身没单独实测、"当下打断"DSH 原生就有 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2736#discussioncomment-18204889) |
| 2783 | 增量回 | 楼上答了压缩半边，补"跨会话记忆"半边的已实测选项；明写与楼上 dsh-memory-meow 不做对比 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2783#discussioncomment-18204890) |
| 3764 | 首回（设计对照） | 自指记忆构想：逐块对照已跑实现（基础结构=session_search 有/被动唤醒=注入非问句标签/自涌现图=没有），送一条成本封顶实测教训；明写他的新增量没有实现可验 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3764#discussioncomment-18204892) |
| 3898 | 首回（盟友帖） | Hermes 式技能循环作者：原版 hermes 就在 DSH 跑通的对照 + 确认他写 $DSH_HOME/skills 比 hermes 内部技能更原生 + 送"模型永远写不到的层"设计经验 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3898#discussioncomment-18204894) |
| 3937 | 首回（技术数据点） | SessionPersistence RFC 的 open question 正中我方实证：事件词表 fail-closed 且失败单元=整个会话（SessionFormatUnsupportedError）、append 无 ignorable 口子、指向 #2708 提案互证；明写我们不做持久化后端、只给 field notes | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3937#discussioncomment-18204897) |

毙：#1881（作者自家 RFC 且已发布 npm 全家桶、楼内已有互补讨论——再回就是纯竞品
推销）；#3202（argszero 已给 rc.7 源码级完整答案含 trigram 集成坐标，我方无增量）。

矿脉纪律沉淀：回帖前 npm pack 拿包源码核证每条技术断言——本批就地纠正了一条
错误记忆（hermes 并非 unicode61，已是 trigram+LIKE，#1456 的回帖角度因此整个
反转：从"同病相怜"变成"你表里那行的生产样本"）。

## 批次 18（2026-08-30，第二/三矿脉：后台任务实测 + Telegram 理论级）

矿脉勘探纪律先行：pi-cc-extensions 名不符实（是 Claude Code 风格 TUI 包，不是
skill 导入器）、@howaboua/pi-codex-conversion 亦然（是给 GPT 换 Codex 形工具面，
不是会话导入器）——npm pack 读 README 后剔除，未浪费回帖。

pi-background-tasks 按标准全套：场景进回归（`examples/background-tasks`，
bg_run 起 60 秒 ticker + 同轮 bg_logs 中途读，断言"非错 + 含早期 tick +
不含 tick 60"三条同时成立=只有活任务被读过一种解释）真机一把过。
pi-telegram 理论级三实锤：top50 黑盒挂载成功、其文档点名的 `agent_settled`
硬依赖桥接 full 且契约测试钉死（tests/dsh-runtime.spec.ts:428）、配置面
（/telegram-setup + TELEGRAM_BOT_TOKEN env）零泄漏；缺 bot token 未端到端，
按批次 16 用户口径明写。

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 971 | 首回（实测级） | 中途读输出正中诉求；E2E 可证伪证据 + example；明写 headless 一次性进程边界 + 他截图那个工具的显示问题归属 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/971#discussioncomment-18205037) |
| 1301 | 首回（理论级） | 募集帖 Telegram 格：现成 Pi 包 + 挂载/生命周期证据 + 明写无 bot token 未实测 + 对接楼主的实测收录流程 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1301#discussioncomment-18205039) |
| 1302 | 首回（理论级） | 同 1301 英文孪生帖 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1302#discussioncomment-18205041) |
| 1243 | 增量回（理论级） | 楼上 SSH 是全入口方案；补"窄而安全的配对"选项，明写验证等级 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1243#discussioncomment-18205038) |

毙：#266（楼内已有 dsh-web-ui 远程插件 / lody ai / goraven H5 三个远程方案，
理论级第四选项无差异化增量）。

## 批次 17（2026-08-30）——provider-threads 验证连跑器，验证→回帖六连

装置：`scripts/verify-provider-threads-e2e.mjs`（stock @deepseek-ai/dsh@0.1.1-rc.2 +
npm 引擎 pi2dsh@0.23.0 + catalog-only Pi provider + 透传录制代理 → 真 api.deepseek.com），
证据 `community/full-audit-work/provider-threads-e2e.json`（commit 86349c9），6/6 passed。

| # | case | 判决要点 | 评论 |
|---|---|---|---|
| 947 | tools-fields | bash 声明 1836 字符 description、command/description 参数俱全上线；工具执行+第二模型步 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/947#discussioncomment-18205042) |
| 3342 | write-second-step | write 全链：call_00 id、args file_path+content、落盘、3 模型步 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3342#discussioncomment-18205044) |
| 2859 | parallel-calls + 累加器注入 | 双 call id 独立非空、43 条历史可解析；无 id 畸形族由 accumulator 实验覆盖；明写不构成官方 adapter 修复 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2859#discussioncomment-18205045) |
| 2659 | long-output + token-limit 对照 | 25949 字符完整到达 completed；对照组 max_tokens:24 上线、max-tokens 如实收尾 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2659#discussioncomment-18205046) |
| 2670 | encoding | 224 CJK 零 U+FFFD；两类故障拆开+录制代理归因法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2670#discussioncomment-18205047) |
| 1166 | token-limit | 声明 maxTokens:24 真上线，turn/end max-tokens、部分文本保留、CLI 非零退出 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1166#discussioncomment-18205049) |

哨兵教训（进装置不进对外文案）：① jsonl 里助手文本在 `data.message.content` 不在
`data.content`——形状必须先实证再断言；② deepseek-chat 拒绝手写 3000 整数（两种措辞都拒），
long-output 换成长文任务并在脚本里注明"整数变体测的是服从性不是传输"；③ max-tokens 收尾
时 headless CLI 非零退出是被测行为，harness 需 allowExit。

进行中：#1149（codex write 可选参数，scripts/verify-codex-write-optional-e2e.mjs）。

## 批次 19（2026-08-30，散点收割：机制帖 + 作者帖 4 条）

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 3744 | 首回（同行印证） | skill-stabilizer 机制帖：assemble 瀑布权威性我方独立实测印证 + assembly.tools 可改写杠杆 + 前缀缓存字节稳定性坑（标注为推演非实测）；明写没跑过他的包 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3744#discussioncomment-18205060) |
| 2434 | 首回（实证印证） | headless resume 插件作者：subagents E2E 跨进程重开实证印证 resume 机械可达 + 承认我们此前在 #1076 说"给不了"的口径将改为指向他的 overlay + 提醒 patch 行压在无版本化 seam 上；明写没跑过他的插件、mid-turn 问题无证据不猜 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2434#discussioncomment-18205071) |
| 1165 | 首回（同行印证） | dsh-repo-map 提案：前缀缓存论点互证（连到 #3744）+ #4191 ripgrep seam 交叉引 + assemble 瀑布作为动态逃生口（明写更伤缓存、他的默认是对的） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1165#discussioncomment-18205070) |
| 2453 | 增量回 | web-search-ollama 作者：确认 ctx.web 官方槽形状正确 + Pi 孪生包挂载级数据点（明写他的 bundle 才是 DSH 用户的短路径） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2453#discussioncomment-18205072) |

毙（skills 簇现场复核）：#88（bobleer 已给源码级完整答案）、#3980（PensiveFei/
wold9168 已答满路径+frontmatter+watcher）、#3625（已有插件推荐表+雷达指路）、
#3497（作者自荐帖已有 dshbase 对接，我方无差异化增量）、#266（楼内已有三个远程
方案）。勘探剔除：pi-cc-extensions / pi-codex-conversion / pi-goosedump 名实
不符（见批次 18 注）。

批次 17 续（同日）：
| 3023 | 诊断法 | /init 与普通轮请求形状差异解释 + 六案已验基线 + 录制代理归因法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3023#discussioncomment-18205102) |
| 481 | retry 实验 + 基线 | 500/429 重试机制判定（已验注入实验）+ 通路稳定基线 + 归因工具；明写非定论 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/481#discussioncomment-18205103) |

批次 17 续 2（同日）：
| 1149 | codex write 可选参数 | 真 gpt-5.6-sol 经我们 codex 路由：write args 仅 file_path/content，零物化、验证过、completed；明写单点数据 + 工作树引擎 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1149#discussioncomment-18205171) |
| 1146 | reasoning 历史回放 | transform A/B（0.82.1/0.84.1 都不丢 thinking 块，内联进 content、无 reasoning_content 字段）+ 0.84.1 真上游端到端 200；把贴主根因收窄到 dsh→pi context 规范化层 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1146#discussioncomment-18205205) |

哨兵：rc2 headless 无 resume 入口（`--resume` 是 TUI 的，headless 每次造新会话，源码实锤）
——跨 provider 场景以 transform 层实验替代，battery 里不留假案。

批次 17 续 3（同日）：
| 695 | alibaba-token-plan E2E | 真 pi-provider-alibaba@1.0.1 + npm 0.23.0 引擎全链 passed（工具环/重启/零凭证落盘）；明写截图报错看不全、不替他定根因 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/695#discussioncomment-18205253) |

批次 17 终（同日）——e2e_only 桶清空：
| 3957 | 动态目录实证 | alibaba 包冷启动拉活目录注册（与他诊断的静态钉死路径对照）；明写不修官方路径、refresh-on-restart 不冒充 live | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3957#discussioncomment-18205263) |
| 2170 | liteLLM 真代理 E2E | DSH 侧零 DEEPSEEK_API_KEY 断言在先、真 liteLLM+真上游全链 completed；补默认路由机理 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2170#discussioncomment-18205269) |
| 3387 | 毙 | maintainer 已关闭并入 #2017——回帖是噪音；#2017 另行评估 | — |

**e2e_only 净新 18 条终账：17 回、1 毙（closed-as-dup）。今天共发 13 条，全部
"验证→回帖"（六案连跑器 + codex 可选参数 + reasoning A/B + alibaba + liteLLM 五套装置）。
剩余净新 = adapter 17 + product 5，全部等 R1 开发件（段 2 围栏剥离 adapter、段 3
provider 包），不存在"现在能回而没回"。**

## 批次 20（2026-08-30，#4213 用户点单：机制真机复现后重回）

用户转发邮件点名此帖「验证我们怎么解决他的问题然后去回帖」。8-26 已有一条推荐性
回帖，本次按标准补硬证据后追加实证跟帖。

验证四组对照（scripts/verify-malformed-tool-schema.mjs，真 deepseek-official，
零 mock）：A 官方路径+裸属性表 parameters=入口 INVALID_REQUEST 400 模型从未运行
（端点原话点名工具）；B 对照组正常——唯一变量即 schema；C 桥+唯一坏包=响亮拒启
点名包与原因；C2 坏好同包=per-extension 隔离、坏入口点名跳过、会话照常。
源码链：register() 只验 output 不验 parameters + mcp-client 逐字透传（坐标见
提交信息）。过程纠错：首轮 fixture 缺 output 声明在注册层被拦（DSH 是验 output
的），补官方 createOutput 同款形状后才测到 parameters 那条缝——差点错定位。

| # | 性质 | 依据 | 评论链接 |
|---|---|---|---|
| 4213 | 实证跟帖 | 四组对照 + 源码双坐标 + 自救指引（端点报错点名罪魁）+ 明写"v2"包名 npm/GitHub 均无搜获请楼主贴来源 + 楼上通用卫生不治此根因 + 我方两层结构性防御（lazy proxy / 注册期校验）皆有装置实测 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4213#discussioncomment-18205294) |

副产物：上游候选 +1（register 验 output 不验 parameters，见候选队列）。

## 批次 18（2026-08-30 晚）——围栏缺口上游化 + adapter 桶证据回帖

**上游 issue**：[earendil-works/pi#8858](https://github.com/earendil-works/pi/issues/8858)
——openai-completions 围栏参数静默降级 `{}`（repair 管线缺口）。发前证伪：最新 0.84.4
复测仍在（accumulator-experiment-results-0.84.4.json）；修复归上游、证据指我方仓库
（用户拍板的宣传姿势）。判定修正记录：曾计划在桥内做剥离，被用户以"非通用 ABI、
损专业性"否掉——正确姿势是真 Pi 同样坏的不修不掩、报上游。

**新增实验**：transport-classify-experiment（TCP 连接错 pi-ai 层重试恢复；
reasoning_content 分类零泄漏）。

| # | 依据 | 评论 |
|---|---|---|
| 3047 | 跨层测量：pi-ai 侧同输入静默 `{}`（比他那层的响亮拒绝更糟）+ 上游 issue | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3047#discussioncomment-18207514) |
| 3090 | 累加器 A/B：空串/无 id 族全扛住（index 键控+首个非空胜出）+ 真机双 call；明写不修 llm-deepseek | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3090#discussioncomment-18207515) |
| 3128 | Retry-After 传输层实测被尊重 → 锅收窄到 wrapper 重试层 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3128#discussioncomment-18207516) |
| 3112 | tcpReset 探针：传输层可重试恢复 → 确证 classifyPiAiError 是唯一修点 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3112#discussioncomment-18207517) |
| 1198 | reasoningStream 探针：分类零泄漏 → 嫌疑收窄到网关不发 reasoning_content；给录制自查法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1198#discussioncomment-18207519) |
| 1058 | thinkingLevelMap 上线实测（gateway-compat 断言）+ llama-server 配法；明写 llama 侧归属 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1058#discussioncomment-18207520) |
| 1866 | localhost 路由实测基线（battery 就跑在 127.0.0.1）+ 两条配置路径 + 本地特有坑 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1866#discussioncomment-18207521) |
| 1113 | 保留名冲突机理 + assembly.tools 改写杠杆（1604 实测）；明写是绕行非修复 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1113#discussioncomment-18207522) |
| 4190 | 独立复现佐证：我方 codex 装置早撞同现象（stopChild + terminated-after-durable-turn 证据在库）；明写没测 5 分钟数值 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4190#discussioncomment-18207523) |
| 1077 | 重试机制测量 + 持续/瞬时二分归因法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1077#discussioncomment-18207524) |
| 931 | 症状族二分（空 id 族 / 围栏族）+ 录制自查；明写非定论 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/931#discussioncomment-18207525) |

**跳过（记因）**：1073/1099（截图/一句话，无从下证）、1078（web-search 架构设计诉求，
无我方证据面）、2668（Bearer 开关是上游特性诉求）、2893（过泛）、3157（timeout 配置面
未实证）、3825（mapUsage 丢 reasoning 细分——**可下一批用 transform 探针升级为实测**，
候选队列）。

adapter 桶 17 条净新终账：回 10、余 7（各有记因，1 条可升级）。

## 批次 19（2026-08-30 深夜）——dsh_core_only provider 六簇开打（判据：只打桥真实骑的 seam）

**口径拍板（用户确认）**：dsh_core_only 782 条中只做 conformance 义务覆盖的 provider
六簇（live census 净可回 110）+ ui 对照 + session 子集；sandbox/host_core_other 241 条
明确不做——"实验进不了项目的不做"。census 装置 $S/census2.mjs，
provider-core-live.json 留档；新贴池 8-23 后 ≥300 条未扫完，另行批次。

**实验 v2**（全部入库）：transport-classify 增 reasoningFieldVariant（vLLM `reasoning`
字段 0.84.1 正确分类；0.82.1 注入 seam 不存在，如实记不可测）、invokeTagInContent
（`<invoke>` 文本落为纯文本零救网）；reasoning-history 增 toolCallWithThinking
（两代都内联保文本+tool_calls 齐全、真上游 200）、loneSurrogate（孤立代理对经
pi-ai 路由真上游 200——与 llm-deepseek 的 400 成 A/B）。
哨兵：transport-classify 结果文件曾因 env 名传错（PI_AI 单复数）写空并推出，
下一提交补全——生成结果文件后必须 JSON.parse 校验再提交。

wave 1（现有证据直接回，6 条）：
| 722 / 736 / 2719 | thinkingLevelMap/contextWindow 声明面实测三连 | [722](https://github.com/deepseek-ai/deepseek-harness/discussions/722#discussioncomment-18207577) [736](https://github.com/deepseek-ai/deepseek-harness/discussions/736#discussioncomment-18207578) [2719](https://github.com/deepseek-ai/deepseek-harness/discussions/2719#discussioncomment-18207579) |
| 1861 | 官方档位白名单的实测过渡路 + 代价说明 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/1861#discussioncomment-18207580) |
| 3752 | pi-ai 版本边界提案背书：跨版本 A/B 实测差异全家 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3752#discussioncomment-18207582) |
| 2674 | 空 id 覆盖：pi-ai 结构性免疫（first-non-empty-wins 可作修复语义）| [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2674#discussioncomment-18207583) |

wave 2（实验 v2 解锁，8 条）：
| 199 | vLLM reasoning 字段 0.84.1 实测正确分类 + 0.82.1 不可测如实记 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/199#discussioncomment-18207611) |
| 3857 / 1850 | toolCall+thinking 回放双代测量：字段谁都不给 → 排除绕行解、锁死 llm-deepseek 修复位 | [3857](https://github.com/deepseek-ai/deepseek-harness/discussions/3857#discussioncomment-18207613) [1850](https://github.com/deepseek-ai/deepseek-harness/discussions/1850#discussioncomment-18207614) |
| 3972 | 归因线索：可能是 #3857 回放丢字段的下游 + 录制自查法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3972#discussioncomment-18207615) |
| 231 | responses 侧同族：回放契约缺口跨适配器 + compat 声明位方向 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/231#discussioncomment-18207616) |
| 967 | 孤立代理对 A/B：同脏历史 pi-ai 路由 200 → 佐证序列化层修复位 + 临时活路 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/967#discussioncomment-18207617) |
| 2158 / 3609 | invoke/tool_call 文本落点实测零救网 + 家族上游 #8858 关联 | [2158](https://github.com/deepseek-ai/deepseek-harness/discussions/2158#discussioncomment-18207619) [3609](https://github.com/deepseek-ai/deepseek-harness/discussions/3609#discussioncomment-18207620) |

## 产品化工作项（2026-08-30，用户拍板"记忆/任务的 web 管理面"后落地）

一句话：dsh-work-x 套件 4→6 成员（+pi-hermes-memory、+pi-background-tasks），
web 上新增记忆浮窗与任务坞两块产品面，全部真机 E2E 绿。

过程中挖出并修掉的引擎级事故（独立成 commit）：
- **插件面 agent 目录重定向漏洞**：hermes 直读 env/homedir，store 写进真机
  ~/.pi/agent（E2E 代号在真机 projects-memory 实锤）；修法=引擎 apply 最早处
  发布 PI_CODING_AGENT_DIR（用户已设则尊重），契约测试钉死；场景补"代号逐
  run 随机 + 双向隔离断言"。真机残留待用户手动清（权限分类器拦了 rm）。
- 三条 E2E 新增：memory-tasks-web（web 工具层双包）、work-x-memory-tasks
  （产品面全回路）、persistent-memory 隔离强化。
- 误判并撤回：betterSidebar 缺席不是缺陷（dsh-x README 明写可选伴侣）；
  新产品面因此全部坐 stock shell.overlay。

待用户拍板：pi2dsh 0.24.0 + dsh-work-x 0.4.0 发版（重定向修复 + 登录卡 +
零 TUI 投影 + stage beacon + 本批产品面，用户可见量足够一版）。

## 批次 20（2026-08-30 深夜续）——gateway_catalog 簇 11 条

| # | 依据 | 评论 |
|---|---|---|
| 3985 | undici 代理坑独立复现（我方 harness 尸检注释为证）+ NODE_USE_ENV_PROXY | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3985#discussioncomment-18207675) |
| 4049 | prepareCall 崩溃根因（双代契约实测：字面量 adapter 撞 rc2 分发）+ LlmAdapter 基类修法 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/4049#discussioncomment-18207676) |
| 3934 | 同族短答 cross-link #4049 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3934#discussioncomment-18207677) |
| 2779 | 辅助 LLM 消费者（标题/搜索/子代理）各有路由的机理 + jsonl 实录证据 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2779#discussioncomment-18207678) |
| 2330 / 4042 | glm-5.3 目录滞后：显式声明绕目录（已验证形状）+ #3752 版本边界互链 | [2330](https://github.com/deepseek-ai/deepseek-harness/discussions/2330#discussioncomment-18207679) [4042](https://github.com/deepseek-ai/deepseek-harness/discussions/4042#discussioncomment-18207680) |
| 3200 | 容量 resolve seam 的消费侧实证（listModels/resolveModelInfo 拆分事故亲历）| [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3200#discussioncomment-18207681) |
| 3973 / 3270 | 发现字段扩展支持 + 显式声明活路（capacity/modality 皆实测） | [3973](https://github.com/deepseek-ai/deepseek-harness/discussions/3973#discussioncomment-18207682) [3270](https://github.com/deepseek-ai/deepseek-harness/discussions/3270#discussioncomment-18207683) |
| 3612 | thinkingLevelMap 按模型映射（尊重社区 dsh-custom-mode 的边界分工） | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/3612#discussioncomment-18207684) |
| 2943 | 本地模型即刻可接（battery 就在 127.0.0.1 上跑）+ 本地特有坑 | [c](https://github.com/deepseek-ai/deepseek-harness/discussions/2943#discussioncomment-18207685) |

gateway_catalog 30 虚位：回 11、余 19（多为 model-picker UI 诉求，非我方证据面，记因跳过）。

## 批次 21（2026-08-30 深夜续 2）——tool_stream 空 id 家族清仓 + 第二个上游 issue

**新缺口实测 + 上游 issue**：duplicateIndex 探针——两个完整调用共用同一 index 时
pi-ai 累加器静默吞掉第二个（0.84.1/0.84.4 同现），与 #4091 对 llm-deepseek 的机械证明
成对；已报上游 [earendil-works/pi#8861](https://github.com/earendil-works/pi/issues/8861)
（修法提案：非空 id 不同即开新块，id 优先于 index 定身份）。

空 id/name 家族 12 条（1713/2090/2802/2916/3260/3281/3299/3807/3822/4062/3955/2725）：
统一证据（累加器 A/B 免疫 + first-non-empty-wins 语义蓝本 + 真机活证 + #8861 诚实披露
同路已知坑），按各贴变体（null/空串/中途丢失/一行修）定制开头，全部互链 #3090/#2674。
评论号 18207714-18207728。

另 4 条：#4091（跨适配器确认 + 上游 issue）、#3315（孤立代理对 A/B 同族 #967）、
#2225（重试旋钮传输层全齐、缺的是配置面）、#3852（RFC 分层背书：第 1 层实测无缺陷）。
评论号 18207731-18207734。

跳过记因：#1171（帖身与标题不符，不盲回）；#805（custom input property 族待探针）；
retry/oauth/replay/metadata 簇余量待下批逐条审。
新贴池 census3 完成：8-23 后 928 条、844 虚位——需独立分类批次。
