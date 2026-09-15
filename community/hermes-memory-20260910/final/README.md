# pi-hermes-memory 原包验收（2026-09-10—11）

本目录是本地测试记录，没有向上游发帖或发布 npm。
使用未修改的 npm `pi-hermes-memory@0.9.8`，stock npm
DSH `0.1.5-rc.1`，真实 DeepSeek 模型、CLI、新进程和浏览器。

准确 gitHead：`34c6fe49f832e6a0957ce517586158a8bdde71a4`。
上游同一 gitHead 的完整套件为 **52 文件 / 933 测试通过，零跳过**，见
[npm-source-tests.log](npm-source-tests.log)。这不替代宿主集成证据。

## 版本与判断方法

桥仍标作 0.24.0，但这里使用未发布的本地 tarball，不能将这些结果归给 npm 0.24.0。
各 JSON 内 `build.engineDependency` 和 `engineDistSha256` 记录实际产物。
最初的本地验收产物 dist hash 为
`d5057a874413c945ca28c38a83bb1512f7aaeb6c20b2b8ce0953b28a1ae874f6`。
[new-installed-versions.json](new-installed-versions.json) 与 [old-installed-versions.json](old-installed-versions.json) 保存实际 CLI 依赖图及 profile 依赖；检查没有同名原生核心的混合版本。
随后修复子代理显式 `thinking=off` 的丢失和新版事件作用域，final3 hash 为
`197eb6ad2959df8dac6e98fa842aed8664917e1845c673515a81453f1004f7ae`。
证据按实际构建保存，不把早期运行伪装为最后产物的重跑。
最终 `pnpm verify` 通过：35 文件 / 364 测试，类型检查、覆盖率、生成文档校验、publint 和真实打包安装检查通过，见 [verify.log](verify.log)。final3 完成运行后仅更正 sessionManager 清单里“归档只含 Pi-only entries”的旧说明，并重新生成文档。最终 final4 的 dist hash 为 `08c1cc8481e18195fc5b447b6875a68ad4c5dcfac9b4fbad5f6d35457e5bdaa6`；其代码行为与 final3 相同，核心链路另在全新 home 重跑。

逐能力五层映射与等级只在
[插件验证矩阵](../../../docs/plugin-validation-matrix.md#pi-hermes-memory)人工维护。
本目录 JSON 仅记录观察，不自动生成架构结论。

## 已取证的路径

| 场景 | 证据 |
|---|---|
| 最终产物在全新 home：记忆增删改查、不同进程读回、历史检索、原生 skill 加载 | [final4-cli-evidence.json](final4-cli-evidence.json)（10 项通过）；首轮记录为 [cli-evidence.json](cli-evidence.json) |
| 四类记忆、秘密拒存、技能全生命周期 | memory-domains / secret-scanner / skill-crud / skill-updated-restart / skill-delete / skill-deleted-restart |
| 不同 cwd 项目隔离、四种注入策略、anchor 行号 | project-one-context / project-two-context / legacy-injection / policy-only / custom-policy / disabled-policy / anchor-search |
| 强制子进程后台提取，指定 pro 模型与 off，前台零工具且 child 正常完成 | [subprocess-review.json](subprocess-review.json) |
| 旧宿主 0.1.1-rc.2 记忆 CRUD、历史搜索及原生技能加载 | [old-cli-evidence.json](old-cli-evidence.json) |
| 旧宿主 0.1.1-rc.2 原包超限整理及原生子代理 | [old-automatic-overflow-consolidation.json](old-automatic-overflow-consolidation.json) |
| 前台零写工具的自动记忆提取与纠错 | [automatic-review.json](automatic-review.json)、[correction.json](correction.json) |
| 工具次数触发、指定模型及主模型真实失败后回退 | automatic-tools / model-override / model-fallback；对应 requests 文件记录真实 HTTP 转发 |
| 原包子进程自动整理、超时中止和无迟到写入 | [automatic-overflow-consolidation.json](automatic-overflow-consolidation.json)、[cli-worker-cancellation.json](cli-worker-cancellation.json) |
| 后台直接模型调用取消 | [background-review-cancellation.json](background-review-cancellation.json)及 review-cancel-requests |
| 十条命令真实完成、guide 原生表单、interview 保存、pin 注入、管理器只读降级 | [ten-commands.json](ten-commands.json)、screenshots/commands |
| 实际长会话压缩保存、宿主仍运行时单会话关闭保存 | compaction-flush / per-agent-shutdown-flush |
| 先创建 DSH 历史，再安装插件，仅 session_search 找回随机词 | [pre-install-native-history.json](pre-install-native-history.json) |
| 整进程退出期服务可用性（不安装桥/原包的原生 probe） | [native-shutdown-seam.json](native-shutdown-seam.json) |

JSON 中出现的 SQLite/Markdown 是原包数据，DSH 模型调用、子代理和会话恢复仍由原生服务
拥有。历史搜索另需要派生 Pi JSONL，严格判为 grade 3。

## 失败与补测不能混淆

- diagnostics 保留旧测试失败。旧版子代理请求确实吞掉 `off`，属于桥欠账；修复后原生
  request/header 记录 off，不靠前台回复推断。
- 一次真实模型将 `REVIEWf1e27dbe3ac5` 抄成 `REVIEWf27e1a3ac5`；另一次回答
  `Nothing to save.`。这两次持久化断言都失败，未改成成功。模型提取不保证每次保存。
- 后续 fixture 改用不同的个人偏好，避免对同一项目反复写入互相冲突的发布名。
  前台若调用写工具，仍拒绝算作后台保存证据。
- 子进程也含转述用户内容，测试必须按 `source.kind=user` 选主会话；曾误选子会话的
  断言失败保留。最终脚本检查主会话零工具、原生 child 完成、模型/思考配置和实际记忆。
- 同一目录重复核心套件时，未按运行时间过滤的匹配器会选中历史主会话；原包搜索排名也会返回早先的同名会话，宽泛查询在删除目标后仍可能返回其他匹配记忆。失败保留为 diagnostics/reused-home-cli-evidence.json。修正主会话时间过滤后，最终产物使用全新 home 完成全部 10 项断言，没有删除旧目录来隐藏失败。
- 工具次数触发测试用一次真实 memory_search 和高 turn 阈值，断言真实 maintenance
  请求，不要求临时诊断事实被记忆。保存功能另由独立正向场景证明。
- 取消测试先关闭原生服务，再关浏览器；浏览器先关会拖延发信号，不能证明运行中取消。
  最终记录检查真实 HTTP 已开始、取消时点和取消后没有写入。

## 仍然存在的语义边界

- **DSH-ARCH-004**：压缩事件不能等价于 Pi 的事前 awaited veto/replace。一次 flush
  成功只能证明功能路径，不证明该决策权。
- **DSH-ARCH-007**：后台 worker 不生成/索引 Pi 会话文件，但 DSH 仍保留原生审计；
  不声称 `--no-session` 等价于零持久化。
- **DSH-ARCH-008**：根进程退出的新模型调用可得到 NO_ADAPTER。提前 prepareCall 的
  固定请求能继续，但无通用保活 gate，CLI 的 5 秒退出限时也仍在。
- 裸 Web 的终端管理器使用原包只读 fallback；没有声称完整 TUI 操作已在本轮实测。
- `pi -p` 适配仅为本地 POSIX 非交互文本子集，非完整 Pi CLI；Windows/远程路径未以此宣称通过。

## 复现

使用 stock CLI，提供 `DEEPSEEK_API_KEY`，设 `PI2DSH_DSH_BIN`、隔离的
`HERMES_E2E_ROOT`、本地 tarball `PI2DSH_ENGINE_SPEC`。运行：

```sh
node scripts/verify-hermes-memory-e2e.mjs install
node scripts/verify-hermes-memory-e2e.mjs cli
node scripts/verify-hermes-full-e2e.mjs tools
```

完整脚本还包含 project-isolation、policies、automatic、automatic-tools、correction、
commands、compaction、overflow、cli-cancel、review-cancel、session-dispose、native-shutdown、
model-override、model-fallback、subprocess-review、cold-history 各阶段。
浏览器测试可设 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`；无其他环境配置时使用 Playwright 自带浏览器。
所有配置文件写入测试专用 home，真实模型请求不替换、不伪造。模型随机行为可能使测试失败；
保留失败和输入输出后定位，不能跳过失败断言。
