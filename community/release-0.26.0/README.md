# pi2dsh 0.26.0 / dsh-work-x 0.5.0

Target host: stock npm DeepSeek Harness **0.2.0-rc.2**. Pi ABI: 0.84.1.

Release execution is in progress. Publication receipts and registry-installed
regression results will be added here before issue replies are sent.
The [candidate acceptance](../dsh-020-compat/README.md) is separate from npm acceptance.

## Upgrade

First update the DSH desktop/CLI runtime to **0.2.0-rc.2**. Do not exempt an
old engine from the host's version checks. For an npm-installed CLI:

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
dsh --version
dsh plugin --profile web add pi2dsh@0.26.0
```

Use the profile you actually run (`web` above is an example), then fully
restart it. Pi capability packages do not need conversion or source changes.
Users of the Web suite should upgrade the suite as well:

```sh
dsh plugin --profile web add dsh-work-x@0.5.0
```

Do not install 0.26.0 on DSH 0.1.7 or earlier. Historical hosts remain on their
matching release checkpoints; old-host maintenance is a separate fix branch.
