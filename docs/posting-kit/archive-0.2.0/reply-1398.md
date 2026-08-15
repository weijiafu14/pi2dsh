和 #421 是同一个方案：Pi 生态的 [pi-approval-guardian](https://www.npmjs.com/package/pi-approval-guardian) 插件，通过 pi2dsh 中间层挂到 DSH 上、零改动运行，就是你要的 codex 式自动审批——full access 下每个工具调用先交给一个审查模型自动判定，安全的放行、可疑的拦截，全程不用人工点确认。

刚在裸环境（npm 版 pi2dsh + deepseek-v4-flash 当审查模型 + danger-full-access）跑的真实记录：

良性命令，自动放行并执行：

```
[pi2dsh] Guardian · allowed · low risk
approve-benign-1398
```

可疑操作（一条 echo 被塞进 `sudo rm -rf /var/log` 的指令链），自动拦截：

```
[pi2dsh] Guardian · blocked · low risk
```

危险命令本身（`sudo rm -rf` 系统路径）在 #421 的验证里被审查模型判 medium risk 直接拦下。

机制：guardian 在工具调用层拦截，审查失败时 fail-closed（默认拒），审查模型用 `PI_APPROVAL_GUARDIAN_MODEL` 指定，DSH 里配好的模型都能用。

复现：

```bash
npx pi2dsh@0.3.4 host --packages pi-approval-guardian --out guardian-bundle
pnpm dsh plugin --profile headless add file:guardian-bundle
PI_APPROVAL_GUARDIAN_MODEL=deepseek-official/deepseek-v4-flash pnpm dsh --profile headless "你的任务"
```

pi2dsh 是把 Pi 插件桥接到 DSH 上原样运行的中间层：https://github.com/weijiafu14/pi2dsh

一点如实说明：审查判定来自模型，同一条危险命令不同轮会有波动（结合"目标不存在=no-op"等上下文，偶尔会放行），要更严的口径可以在 guardian 策略配置里收紧。
