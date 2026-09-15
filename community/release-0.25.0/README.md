# pi2dsh 0.25.0 / dsh-work-x 0.4.1

发布日期：2026-09-15。

- [pi2dsh 0.25.0](https://www.npmjs.com/package/pi2dsh/v/0.25.0)
- [dsh-work-x 0.4.1](https://www.npmjs.com/package/dsh-work-x/v/0.4.1)，依赖 pi2dsh `^0.25.0`
- [发布源码 6fd34ed](https://github.com/weijiafu14/pi2dsh/commit/6fd34ed109e00892f003d3d221cdc7ad5f3f7da4)，标签 `v0.25.0`
- [GitHub CI](https://github.com/weijiafu14/pi2dsh/actions/runs/34924629582)：通过

## 交付内容

同一桥承接 DSH `0.1.1-rc.2` 与 `0.1.5-rc.1` / `0.1.5-rc.2`。修复新版系统
提示词、会话读取、文字增量、子代理作用域和父子归属、Inbox、文件上下文及授权图片
加载。套件单独更新是因为浏览器图片修复实际由 dsh-work-x 的客户端产物承载。

同时交付已在本地验证的 pi-code 配置、规则、hooks、skills、MCP 与命令路径，及
Hermes 所需的完整派生会话导出、simple 模型调用、本地 POSIX `pi -p` 文本子集、
子代理思考档位和关闭回调修正。Pi 契约目标仍为 `0.84.1`。

历史搜索的派生 Pi JSONL 仍为 3 级；完整 Pi CLI/JSON、完整 Pi 流元数据、压缩前
veto/replace、整进程退出的新模型调用保证等边界保留。跨版本旧数据迁移不在范围。
逐能力判断继续以[插件验证矩阵](../../docs/plugin-validation-matrix.md)为准。

## 发布验证

发布前 `pnpm verify` 通过：35 个文件、364 个测试、类型检查、覆盖率、文档校验、
publint 和真实打包安装检查。pnpm 11.7 的 frozen lockfile 检查通过，未改依赖锁文件。

`engine-published.json`、`suite-published.json` 保存 npm 回读版本与完整性值；均与
本地已经验证的 tarball 一致。套件首次发布后短暂处于 npm 处理阶段，待实际可读取后
再完成完整性核对，没有重复发布或拿本地包代替 npm 包。

发布后回归使用官方 npm DSH、全新 DSH_HOME、`pi2dsh@0.25.0` 与
`dsh-work-x@0.4.1`。浏览器和模型均真实运行；suite 路径显式安装已发布套件，
不能以临时打包的本地 client.js 冒充发布验收。

首次完整运行和补跑分别保存在 `examples-initial.json`、各 `*-recheck.json` 与
`examples-final.json`。数据断言最终为 19 过 / 1 因缺 Alibaba 凭证跳过；旧版
Pi TUI、模型 seam、provider 和 pi-code CLI/Web 另有记录。

**最终截图审核发现了侧聊显示回归**：宿主隐藏上下文进入了聊天面板，且主输入框
执行侧聊命令会出现多余的 `ui.custom` 错误。`side-chat-visible.png` 保留该负面证据；
因此这里的数据断言通过不能冒充完整界面验收。这两项转入 0.25.1 补丁处理，
0.25.0 的已发布产物与原始记录保持不变。
