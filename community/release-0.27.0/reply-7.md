@j62268781-alt 已发布 **pi2dsh 0.27.0**，支持你截图中的 **DSH 0.2.1-rc.2**，不需要 `allow-version` 强制放行。

在桌面端实际使用的同一份 `DSH_HOME` / profile 里升级（以下以 `web` 为例）：

```sh
dsh plugin --profile web add pi2dsh@0.27.0
```

如果还装了 Web 套件，一并升级：

```sh
dsh plugin --profile web add dsh-work-x@0.6.0
```

然后完全退出并重新启动桌面端。注意别升级到另一套独立 CLI 的配置目录。

已从 npm 正式包完成干净安装与 CLI / Web / dsh-TUI 回归，[版本对应和验收记录在这里](https://github.com/weijiafu14/pi2dsh/tree/main/community/release-0.27.0)。如果仍有安装错误，请贴更新后的版本号和错误文本，我继续跟进。
