# pi2dsh 0.26.0 / dsh-work-x 0.5.0

Target host: stock npm DeepSeek Harness **0.2.0-rc.2**. Pi ABI: 0.84.1.

Release execution is in progress. Code and tag `v0.26.0` were pushed at
`c972a79`. npm accepted both uploads, but its authenticated version-status API
still reports `pi2dsh@0.26.0` as **validating** after approximately 30 minutes
(2026-10-13). See [publication receipts](published.json).

`dsh-work-x@0.5.0` is published and its registry integrity matches the uploaded
tarball. Its `latest` tag temporarily remains on 0.4.2 so the default install
does not request an engine that is not yet publicly available. Restore
`latest` to 0.5.0 after the engine is available and integrity-verified.

Registry-installed acceptance and issue replies are **not complete**. They
must run after the engine passes npm validation; successful upload is not
successful availability or regression. No successful-upgrade reply has been
sent to issue #7 or #8.
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
