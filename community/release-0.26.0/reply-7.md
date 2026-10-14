已发布 **pi2dsh@0.26.0**，对齐你截图中的 **DSH 0.2.0-rc.2**。不需要使用 `allow-version` 绕过版本检查。

在你实际运行的 DSH 实例/profile 中升级（下面以 `web` 为例）：

```sh
dsh plugin --profile web add pi2dsh@0.26.0
```

如果同时装了 Web 套件，也升级它：

```sh
dsh plugin --profile web add dsh-work-x@0.5.0
```

然后完全退出并重新启动 DSH。桌面版请确认操作的是桌面实例使用的同一份 DSH_HOME/profile，而不是另一套独立 CLI 配置。

已从 npm 正式包做过干净安装及 CLI/Web/TUI 回归，安装兼容检查通过。[版本对应关系与验收记录](https://github.com/weijiafu14/pi2dsh/tree/main/community/release-0.26.0)。升级后若仍报错，请贴新的版本号和安装错误文本，我继续跟进。
