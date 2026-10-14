感谢这份详细报告。已发布 **pi2dsh@0.26.0**，新版基线是 **DSH 0.2.0-rc.2**；需要一起升级宿主，**不是在 0.1.7 上只升引擎或放宽版本检查**。

这版对齐了逐 Agent 初始化、新版工具结果格式，以及子代理的完成/错误回传：完成条件关联本次 prompt 实际领取的 turn，原生错误和取消状态会传回 Pi 插件，不再一律按普通完成处理。

这次验证走的是你报告的 **Pi-origin 路径**：安装原样的 `@tintinweb/pi-subagents@0.20.0`，父模型调用 `Agent` → 创建 `pi2dsh-sub-` 子会话 → 子模型实际调用文件工具 → 结果返回父模型。已用 **npm 正式包**跑通，并从 DSH 原生持久日志核对请求、工具调用、配对结果与终态；另有 8 个子代理生命周期场景通过。[验收记录和专项证据](https://github.com/weijiafu14/pi2dsh/tree/main/community/release-0.26.0)。

你使用的是 npm 安装的 CLI，可以先退出运行中的 DSH，再执行：

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
dsh --version
dsh plugin --profile web add pi2dsh@0.26.0 @tintinweb/pi-subagents@0.20.0
```

确认启动的是升级后的那份 DSH，重启 `dsh web`，在新会话中再试一次。如果还复现，请提供新的版本号及去敏后的 **DSH 原生子会话日志**，不要只看 Pi 导出文件大小；不需要提供任何 key/token。这个 issue 先留着，等你复测反馈。
