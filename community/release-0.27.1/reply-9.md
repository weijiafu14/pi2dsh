@WH2026913 已发布 **pi2dsh 0.27.1**，兼容 DSH **0.2.1-rc.2 / 0.2.1-rc.3**，修复你遇到的安装前版本拒绝，不需要 `allow-version`。

可以在桌面应用的插件管理页重新安装/升级 `pi2dsh@0.27.1`。

如果使用命令，必须使用**桌面应用安装的 dsh 命令**，不是另行 `npm install -g` 的 CLI。
桌面应用菜单中的“管理 dsh 命令…”可安装/修复该命令。先完全退出桌面应用，再对你的
`desktop` profile 执行：

```sh
dsh plugin --profile desktop add pi2dsh@0.27.1
```

如果还安装了 Web 套件，也一并升级：

```sh
dsh plugin --profile desktop add dsh-work-x@0.6.1
```

完成后重新打开 DeepSeek Harness。独立 npm CLI 会拒绝管理 `desktop` profile，
这是宿主的隔离规则，不需要修改或绕过。
参考：[官方桌面内置命令说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/apps/desktop/README.zh.md#bundled-command-runtime)。

已用 npm 正式包在 rc.2、rc.3 上重新验证；[版本范围与验收记录](https://github.com/weijiafu14/pi2dsh/tree/main/community/release-0.27.1)。如果仍有错误，请贴升级后的版本和新的报错文本，我继续跟进。
