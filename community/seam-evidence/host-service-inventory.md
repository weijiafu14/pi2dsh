# DSH 公开服务清单（实测，2026-08-26）——含对判定口径的更正

**取证方式**：从真实安装树读所有 `@deepseek-ai/dsh-*` 包 `.d.ts` 里对
`interface Context` 的声明合并，并抽出各服务的方法签名。**是包里的公开类型契约，
不是推测。**

**核证等级说明**：下列服务"存在且在公开 Context 类型上"是**事实**。
"仓外插件能 inject 到"按 cordis 惯例成立，且我们自己的桥已实跑过
`sessions / tools / systemPrompt / commands / skills / compaction /
authorization / attachment`。**其余服务未逐个实跑，回帖前须先验一次**。

## ⚠️ 三条口径更正（此前判错的）

### 1. 归档**能写**、取消归档**不能** —— 旧口径过宽，但只宽了一半

`ctx.workspaceRegistry`（`@deepseek-ai/dsh-workspace@0.1.1-rc.2`）实际公开方法：

```
create(path, title?)            delete(id)                 ← delete 删的是"工作区"，不是会话
archiveSession(sessionId)       attachSession(sessionId)   detachSession(sessionId)
insertBefore(id, beforeId?)     insertSessionBefore(sessionId, beforeSessionId?)
setTitle(title)                 rememberSessionPath(id, path)
list()  get(id)  resolveByPath(path)  sessionPath(id)  readSessionHeader(id)
status()  table()
Workspace.archivedSessionIds    ← 只读 getter
```

**逐条核准（不是推断，是签名）：**

| 动作 | 有没有公开面 | 结论 |
|---|---|---|
| 归档一个会话 | ✅ `archiveSession(sessionId)` | 不是 no_dsh |
| **取消归档 / 恢复** | ❌ **没有 unarchive 对等方法**，`archivedSessionIds` 只读 | **no_dsh 是对的** |
| 会话在工作区间附着/脱离 | ✅ `attachSession` / `detachSession` | 不是 no_dsh |
| 排序、改标题、建/删工作区 | ✅ | 不是 no_dsh |
| **永久删除会话日志** | ❌ `SessionPersistence` 无 delete/forget | **no_dsh 是对的** |

**所以旧口径"归档一族一律 no_dsh"只错在归档/附着/排序这一段；"恢复归档"和"永久删除"
两条真的没有公开写面，那些判定不用翻。**（#3892 的提帖人把这件事说得比我们准：
"archiveSession 是只增操作、没有 unarchive 对等 RPC"。）

⚠️ `table()` 返回原始 KvTable 句柄，理论上能直接改 `archivedSessionIds`。**不要走这条**
——那是绕过语义 API 去写宿主权威记录，正是标准里禁止的形态。

### 2. 后台任务能终止 —— "缺公开写面" 的口径错了

`ctx.jobs`（`@deepseek-ai/dsh-jobs`）是**完整的读 + 停 + 订阅**公开面：

```
start(spec)   list(caller?)   get(id, caller?)   read(id, caller?)
kill(id, caller?, reason?) -> 'requested' | 'already-finished'
wait(id, timeoutMs, caller?, signal?)
onJobDone(listener)   onJobsChanged(listener)   attachController(name)
```

`ctx.shell` 另有 `kill()` / `readOutput()`。**枚举、读输出、终止、变更订阅全都有。**
（唯一确实缺的是"清除终态记录"的 remove/clear —— 那一条 no_dsh 成立。）

**受影响的判定**："后台任务列表要详情页 + 结束按钮"这一族（#757、#608、#2575）
从 `no_dsh` 翻为 **`ours_gap`（workx：任务面板）**——枚举/详情/输出/终止/实时刷新
全都有公开面，缺的只是我们的界面。

### 3. 权限预设能切 —— 不是只能靠 deny 通道

`ctx.permissionPresets`：`set(session, name)` / `resolve(name)` / `current(events)` /
`optionOf(name)` / `selectFor(state)`。

**受影响的判定**：声明式工具权限策略包不必只靠"Pi 的 tool_call deny 通道"，
可以真正切换 DSH 自己的 preset。（但 `ctx.sandboxPolicy` 只有
`resolve` / `overrideOf`，**没有 set** —— 沙箱写白名单确实没有公开写面，
那一族判 `no_dsh` 是对的。）

## ✅ 另外三个此前被当作"缺数据源"的，其实都有

| 需求 | 官方服务 | 关键方法 |
|---|---|---|
| 会话搜索 / 跨会话检索 | `ctx.sessionQuery` | `filterSessions` `filterEvents` `listSessions` `listEvents` `readSession` `readSurface` |
| **分支树 / 分叉血缘** | `ctx.sessionQuery` | **`traceSession(): SessionLineageTrace`** `traceEvent` |
| 用量 / 预算 / 成本看板 | `ctx.tokenMeter` | `measure(session, header?)` `estimateMessage(message)` |
| @文件引用候选 | `ctx.fileReferences` | `remoteExportList(agent, query, signal)` |

**分支树可视化**此前写着"降级条件：DSH 会话元数据里得有可读的分叉来源锚点"——
`traceSession` 就是那个锚点，降级条件不成立。

## Context 上的公开服务全表（DSH 侧，去掉 cordis/三方噪音）

```
credentials      directoryPicker   fileReferences    goals          invariants
jobs             llm               messageFeedback   permissionPresets
planMode         sandbox           sandboxPolicy     sessionPersistence
sessionProjectionCache  sessionProjections  sessionQuery  sessionReferenceResolver
sessionTitle     sessions          settings          settingsSchema  settingsScope
shell            skills            slots             storage        storageDomain
subagents        subprocess        systemPrompt      theme          tokenMeter
tools            typert            typertGateway     userQuestions  webServer
workspaceRegistry  workspaces      layout  locale  conversation  conversationEvents
conversationViews  inputTriggers   remote
```

## 判定用的一句话规则（替换旧口径）

旧口径"凡涉及 DSH 权威状态一律 no_dsh"**过宽**。新口径：

> 先在上表里找这件事的服务；**有公开写方法就不是 no_dsh**，是我们的缺口。
> 只有查过表、确认没有对应写方法（如 sandboxPolicy 无 set、会话日志无删除面），
> 才结案 `no_dsh`。
