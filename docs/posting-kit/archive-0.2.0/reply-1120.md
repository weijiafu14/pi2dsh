现成的能力，不用等：Pi 生态的 [pi-btw](https://www.npmjs.com/package/pi-btw) 插件就是 `/btw` 侧边对话——不新建会话分支，直接问一个延展问题，问完不污染主线程上下文。通过 pi2dsh 中间层零改动挂到 DSH 上就能用。

它正好满足你说的两点：不用多一次"新会话分支"的交互操作，延展问题也不会打断"正规节点 1 → 正规节点 2"的主线。

刚挂上去的实测（官方 `dsh plugin add` 装进 profile，官方 CLI 加载）：

```
[pi2dsh] Pi command /btw:tangent registered as /btw-tangent to satisfy DSH command naming
[pi2dsh] Pi command /btw:new registered as /btw-new to satisfy DSH command naming
[pi2dsh] Pi command /btw:inject registered as /btw-inject to satisfy DSH command naming
[pi2dsh] Pi command /btw:summarize registered as /btw-summarize to satisfy DSH command naming
[pi2dsh] Pi command /btw:model registered as /btw-model to satisfy DSH command naming
[pi2dsh] Pi command /btw:thinking registered as /btw-thinking to satisfy DSH command naming
[pi2dsh] loaded pi-btw: 0 tools, 9 commands, 0 skill roots
```

9 个命令全部注册成功。pi2dsh 自动处理了一个命名差异：Pi 用 `/btw:tangent` 这种带冒号的命名，DSH 命令名不允许冒号，pi2dsh 把它转成 `/btw-tangent`，功能不变。

`/btw` 侧边对话底层是起一个真的 pi 子会话（带 read/bash/edit/write 工具），这条 `createAgentSession` 通道我在 #421（guardian 审查子会话）里已经真机验证过——真子代理、真调模型、真产出回答。

用法（命令在 web/tui 交互界面里输入）：

```
/btw 这个函数为什么这么写？
/btw:tangent 抛开当前上下文，从头脑暴力
/btw:inject 把刚才讨论的方案实现到主线程
```

复现：

```bash
npx pi2dsh@0.3.4 host --packages pi-btw --out btw-bundle
pnpm dsh plugin --profile <你的profile> add file:btw-bundle
```

pi2dsh 是把 Pi 插件桥接到 DSH 上原样运行的中间层：https://github.com/weijiafu14/pi2dsh
