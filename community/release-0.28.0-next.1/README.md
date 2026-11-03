# 0.28.0-next.1 / 0.7.0-next.1 验收（进行中）

目标为 stock DSH `0.2.2-alpha.3`、Cordis `4.0.6-alpha.2`、Pi `1.4.0`，Node.js 24.9+。
沿用 `next` 预览通道，不改变稳定线 `latest`。

本轮修复配置写入错误被误判为适配器缺失的问题；契约覆盖错误保留与不二次挂载。
新增精确 Cordis prerelease 兼容门，防止未经验证的内部 alpha 自动进入支持声明。

发布前本地 verify 通过（410 tests）；完整 examples 退出码 0，13 passed / 1 partial /
6 skipped / 0 failed。网关和 Web 配置写入失败已不再出现。npm 包回归尚待完成；
发布状态将以本目录的 registry 回读和验收文件为准。

虚拟模型、完整 loadout、可编辑轮次边界等剩余能力仍在原有架构矩阵中逐项记录，
本版本不声称 Pi 1.4 全能力兼容。
