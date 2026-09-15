# pi2dsh 0.25.1 / dsh-work-x 0.4.2

本补丁修复 0.25.0 截图审核发现的侧聊显示问题：隐藏的宿主上下文不应出现在聊天
面板；已经声明浏览器产品呈现的命令不应因 `ui.custom` 误报终端组件不可用。

修复使用既有 `browserPresentation` 配置和 Pi `display` 标志，不改变模型输入或
原生日志；裸 Web 的原包非终端 fallback 保留。套件要求 pi2dsh `^0.25.1`。

发布前 `pnpm verify` 通过：35 个文件、365 个测试，类型检查、覆盖率、文档校验、
publint 与真实 tarball 安装检查全部通过。

同一侧聊流程已使用本地构建在两版官方 DSH 上验证：

- [0.1.5-rc.2 结果](side-local-new.json)、[实际界面](side-local-new.png)
- [0.1.1-rc.2 结果](side-local-old.json)、[实际界面](side-local-old.png)

断言检查侧答只进入子会话、侧窗实际可见、没有隐藏上下文或终端组件错误；两张截图
均已目检。旧版负面截图和原始发布记录保留在 [0.25.0 记录](../release-0.25.0/README.md)。

这些是发布前本地构建证据，发布后的 npm 产物验证将在完成后单独追加。
