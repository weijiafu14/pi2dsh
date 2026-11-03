# 0.28.0-next.0 / 0.7.0-next.0：发布与回归记录

2026-11-03：引擎和套件已发布 npm `next`；旧 `latest` 分别仍为 0.27.1 / 0.6.1。
GitHub main 和 `v0.28.0-next.0` 指向 `0c5b1e0aa5a528a4681349fd195838ac77f34f61`。
registry integrity 与本地发布 tarball 一致。这个事实不等于发布后回归已经通过。

## 发布后发现的真实阻碍

新装 stock DSH `0.2.2-alpha.2` 解析到了 Cordis `4.0.6-alpha.2`，而发布前工作图
使用 Cordis `4.0.6-alpha.1`。原生设置修改出现 `next is not a function`，新建会话
出现 `Cannot read properties of undefined (reading 'parent')`。

用**不装 pi2dsh 的全新官方 Web profile** 重现：Continue 后
`/api/settings/mutate` 返回 `settings/rejected`；`/api/session/create` 返回
`agent-preset/invalid`。因此不是引擎 tarball 丢文件，也不能靠强行改测试断言处理。

同时发现桥的一个错误兜底：settings 写入的任意错误被当成“官方适配器没挂”，随后
二次挂载使原错误变成 `configurable provider "amazon-bedrock" is already declared`。
这部分属于桥，后续补丁保留真实写入错误，只在确认命名空间缺失时允许兜底。

首轮 npm 回归已安全中止、测试子进程已关闭；失败日志不能被记成通过。
下一补丁转到官方已同步新 Cordis 的 DSH `0.2.2-alpha.3`，保持不 fork 宿主。
同配置纯官方 alpha.3 Web 已验证设置保存和会话创建正常。

预发布内部依赖也可能发生破坏性变化，因此后续桥将 Cordis peer 钉到实际验收的
精确 prerelease，不再用 `~` 自动承诺未来 alpha。
