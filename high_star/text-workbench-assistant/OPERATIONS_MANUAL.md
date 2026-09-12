# 文本生成工作台操作手册

## 1. 项目是什么

文本生成工作台是一套面向论文、专利、技术报告等长文本任务的本地协作系统。它把 DSH 自然语言助手、Workbench Core、浏览器操作台和领域插件连接为一条受控流程：

```text
用户目标
→ 创建/选择项目
→ 导入已授权材料
→ 解析、分块、索引和检索
→ 关联证据并生成候选正文
→ 用户逐项确认
→ 写入正文、版本、审计与导出
```

系统的重点不是“自动写一篇不可追溯的文章”，而是让材料、检索结果、候选内容、确认操作和最终正文都保留可检查的关系。

## 2. 运行时架构

```text
┌───────────────────────────────────────────────────────┐
│ 用户                                                     │
│  DSH 对话 / 浏览器工作台                                 │
└───────────────┬───────────────────────────┬───────────┘
                │ wb_* 工具                 │ HTTP API
                ▼                           ▼
┌───────────────────────────────────────────────────────┐
│ Workbench Core Service                                  │
│ 项目 · 工作区 · 状态机 · 材料 · RAG · 版本 · 审计       │
│ AgentTask 队列 · 候选 Diff · 插件加载                   │
└─────────────────────────┬─────────────────────────────┘
                          ▼
┌───────────────────────────────────────────────────────┐
│ SQLite-only 存储                                        │
│ projects / materials / chunks / manuscript / tasks /    │
│ versions / audit_events / workspaces ...                │
└───────────────────────────────────────────────────────┘
```

### 2.1 服务与数据位置

- DSH Web 通常运行在 `3080`。
- 工作台 Core 默认运行在 `http://127.0.0.1:3200`。
- Core 默认数据库为 `~/.dsh/storages/workbench-core/workbench.db`。
- Core 使用 SQLite WAL；同一存储路径仅允许一个 Core 服务持有写锁。
- 旧版 `state.json` 不再作为运行时主数据；首次发现时会一次性导入 SQLite。

### 2.2 启动方式

首次使用先安装 Core，再安装本预设：

```powershell
cd D:\雷达毕设相关\high_star\workbench-core
npm.cmd ci
dsh plugin --profile web add .

cd ..\text-workbench-assistant
npm.cmd run setup
```

启动 DSH：

```powershell
dsh web
```

选择“文本生成工作台助手”。当用户明确说“打开工作台”时，Core 会探测已有服务；服务未运行时启动并在 `/health` 可用后打开页面。

也可独立启动工作台服务：

```powershell
cd D:\雷达毕设相关\high_star\workbench-core
npm.cmd run start:workbench
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3200/health
```

预期响应中应包含：`status: "ready"`、`service: "workbench-core"`、`storage: "sqlite"`。

## 3. 标准使用流程

### 3.1 创建项目

建议在 DSH 中先明确任务类型、项目标题和约束。例如：

```text
创建一个论文项目，题目为“基于 FMCW 雷达的物料水分测量研究”。
学位类型为本科，研究方向为雷达信号处理，中文写作，引用采用 GB/T 7714。
请先确认项目配置，再创建并进入写作阶段。
```

系统会：

1. 创建项目及领域大纲；
2. 将项目绑定到稳定工作区；
3. 在确认后进入 `write` 阶段；
4. 让 DSH 和页面读取同一个当前项目。

论文项目需要确认学位类型、学科方向、学校、研究形态、语言和引用规范；专利项目需要确认专利类型、申请人、发明人和技术领域。

### 3.2 导入材料

材料只能在用户明确授权后导入。单文件示例：

```text
将 C:\资料\radar-paper.pdf 导入当前项目，作为参考材料。
```

目录批量导入示例：

```text
材料目录使用 C:\资料\参考文献，递归导入子目录，最多 100 个文件。
请先复述范围，待我确认后再执行。
```

支持 PDF、DOCX、PPTX、XLSX、ODT/ODS/ODP、RTF、HTML、EPUB、TXT、Markdown、CSV、JSON、XML、常见代码文件和图片 OCR。系统会复制文件到项目受控目录，记录来源路径、哈希、解析状态、页数/字符数和分块数量。

不支持的格式、单个损坏文件或 OCR 失败会进入跳过/失败清单，不会中断其余材料的导入。

### 3.3 检索与证据关联

材料导入后可请求检索：

```text
检索当前项目材料中与“FMCW 雷达水分反演误差来源”有关的内容，
展示命中的片段、来源文件和定位信息；不要直接改写正文。
```

检索路径为：

```text
材料 → 文本解析/OCR → 分块 → 关键词与向量召回 → RRF 融合 → 可定位片段
```

默认可使用本地 Hash Embedding，零密钥且不发送材料；管理员也可配置 OpenAI-compatible Embedding Profile。切换远程模型或重建索引前，系统会显示数据边界并要求确认。

把材料片段关联到正文块后，后续候选内容可附带证据来源。书目元数据可以关联正文，但书目本身不代替原文证据。

### 3.4 生成大纲与正文

安全的生成方式是先生成候选，而不是直接覆盖正文：

```text
基于已绑定证据，为“研究背景”生成一个候选段落。
要求学术中文、说明现有方法局限；不要直接写入正文。
```

对于分章写作，正文默认采用块级 upsert：传入某一章节只会新增或更新这一块，不会删除已经存在的其他章节。

整篇替换必须同时具备：

```text
replaceAll = true
userConfirmed = true
expectedRevision = 当前 revision
```

在任何正文写入前，Core 会创建自动保护快照；写入后更新项目 revision 并记录审计事件。

### 3.5 审查、Diff 和确认

审查请求示例：

```text
审查当前正文的结构、术语一致性、证据充分性和引用问题。
仅给出可定位建议，不要修改正文。
```

审查只产生 `ReviewSuggestion`。若要再生成，页面或 DSH 创建 `regenerate_diff` 任务，Agent 返回候选块、证据和生成理由。用户可以只接受第 2、3 项候选；Core 仅写入被接受的块并生成版本和审计记录。

### 3.6 页面 AI 任务

页面中的“审查”“再生成”等 AI 请求会变成持久化 `AgentTask`，不是浏览器父窗口消息。

```text
queued → claimed → running → candidate_ready
       → awaiting_user_confirmation → completed
```

DSH 重启后可继续领取未完成任务。Agent 只能提交候选、进度、结果或失败信息，不能跳过用户确认直接覆盖正文。

### 3.7 版本、恢复和归档

- 使用快照查看或恢复历史正文版本；
- revision 不一致时，旧写入会被拒绝而不是静默覆盖；
- 项目默认最多 10 个活跃项；创建第 11 个项前必须确认归档最早项目；
- 页面顶部“归档项目”可打开归档管理页，恢复归档项目；
- 永久删除仅在归档管理页提供：输入完整项目名称并二次确认后，删除项目数据、材料副本和关联实体；系统仍保留最小删除审计凭据；
- 归档项目会解除当前工作区绑定；
- DSH 或页面重启后，稳定助手键和 workspace 用于恢复当前项目。

### 3.8 常驻执行器与协作事件

只有实际运行的 DSH Agent Worker 才应注册为执行器。Worker 启动时调用 `wb_register_agent_worker`，运行期间定期调用 `wb_heartbeat_agent_worker`，退出时调用 `wb_stop_agent_worker`。页面会显示名称、最后心跳和异常原因；超过心跳时限会标为 `stale`。

Worker 先用 `wb_list_agent_tasks` 查找可处理任务，再用 `wb_claim_agent_task` 原子领取，并用 `wb_update_agent_task_progress`、`wb_complete_agent_task` 或 `wb_fail_agent_task` 回写结果。没有已配置 Worker 时，队列显示“等待 DSH 执行器领取”；这不是故障，也不表示 AI 正在运行。

页面和 DSH 可通过 `wb_list_collaboration_events` 查看同一时间线。HTTP 集成可订阅 `GET /api/collaboration-events/stream?sessionId=...&after=...` 的 SSE；断线后以最后事件时间戳作为 `after` 重连。

当工作台由 DSH 的 `wb_open_workbench` 打开、且该 DSH 会话仍然 live 时，页面创建 AI 任务会自动向同一 `sessionId` 注入一条可见任务消息，并唤醒 Agent 的下一轮执行。该消息包含任务编号、项目、类型和“先领取、只交候选”的约束。页面随后显示 `chat_injected`；若 DSH 已退出、重启或该会话不再 live，则显示 `chat_injection_unavailable` 和原因，任务仍安全保留在 SQLite 中等待恢复后的处理。

### 3.9 Google Scholar 检索配置

OpenAlex 与 Crossref 可直接使用。Google Scholar 使用合规的 SerpApi 适配器，不抓取 Scholar 页面。管理员需要设置环境变量后重启 Core：

```powershell
[Environment]::SetEnvironmentVariable('SERPAPI_API_KEY', '你的 SerpApi 密钥', 'User')
```

检索对话框可选择数据源与年份范围。若未配置密钥，Google Scholar 这一源会明确报告未配置，其他选中的数据源仍可返回结果。

## 4. 可以达到的效果

在完成材料导入和证据关联后，系统能够：

- 建立论文、专利或自定义技术报告项目及受领域规则约束的大纲；
- 批量解析本地资料、OCR 图片并构建可追溯检索库；
- 用关键词、向量和 RRF 混合检索定位材料片段；
- 搜索 OpenAlex/Crossref 的书目候选，经确认后加入书目库；
- 生成正文候选、审查建议和按块 Diff；
- 让用户选择性接受候选，而不覆盖未选章节；
- 追踪正文、材料、证据、任务、版本及用户确认操作；
- 为技术报告等新领域生成、验证并安装独立工作台插件。

系统不承诺论文事实、专利法律结论或引用正确性自动成立；最终文本仍需要作者和领域专家复核。

## 5. 分层治理如何实现

分层治理的目标是：不同层各司其职，任何一层都不能绕过其他层直接破坏项目数据。

| 层级 | 组件 | 职责 | 不负责的事 |
| --- | --- | --- | --- |
| 交互层 | DSH 对话、工作台页面 | 收集意图、展示状态、请求确认 | 不直接操作数据库，不保存模型密钥 |
| 编排层 | Persona、Skill、工作阶段 | 根据 `design → write → review` 指导工具调用 | 不直接绕过确认写正文 |
| 任务层 | AgentTask / Agent Trace | 排队、领取、进度、候选、失败恢复 | Agent 不直接写最终正文 |
| 领域层 | Framework / Logic / Evidence / Material 插件 | 定义字段、大纲、状态机、写作和证据规则 | 不自行创建服务或写数据库 |
| Core 层 | Workbench Core | 唯一业务写入口；实施 revision、版本、审计、RAG 和绑定 | 不承担模型推理或 UI 决策 |
| 数据层 | SQLite | 事务、WAL、实体记录、审计、恢复 | 不直接暴露给页面或插件 |

### 5.1 阶段治理

`design`、`write`、`review` 是明确的工作阶段：

- `design`：分析需求、创建/校验插件规格、创建或选择项目；
- `write`：材料导入、检索、证据绑定、大纲和候选正文；
- `review`：只输出审查意见、证据缺口和版本比较，不直接改正文。

阶段切换需通过 Core 并携带用户确认。工具会按阶段限制访问，避免在审查阶段直接修改正文。

### 5.2 写入治理

Core 是唯一写入者。一次关键写入在同一 SQLite 事务中完成：

```text
校验 expectedRevision
→ 生成写前快照
→ 更新受影响实体
→ 递增 revision
→ 写 audit_event
→ COMMIT
```

任一步失败会回滚，revision 过期会明确拒绝。SQLite 实体表覆盖项目、工作区、材料、分块、正文、版本、任务、候选和审计；旧 JSON 仅用于一次性迁移。

### 5.3 确认治理

以下操作必须显式确认：

- 创建后进入写作或审查阶段；
- 批量目录导入；
- 整篇正文替换；
- 应用模板重构；
- 选择远程 Embedding Profile、重建索引；
- 加入书目、下载全文；
- 接受候选 Diff；
- 归档、恢复或删除项目；
- 生成与安装领域插件。

### 5.4 数据边界治理

- 只有用户授权的本地材料进入项目；
- 本地 Hash Embedding 不发送材料文本；
- 使用远程 Embedding 前显示数据边界并确认；
- API Key 只通过管理员环境变量提供，不写入项目、页面或审计记录；
- 页面不再依赖 `window.opener.postMessage()`，可以独立打开并通过 Core API 操作。

## 6. 常见问题

### 页面显示没有项目

打开工作台首页，选择已有项目或创建项目。不要手动复制 sessionId；页面和 DSH 使用稳定 workspace 恢复当前项目。

### 服务未启动或页面无法连接

检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3200/health
```

若无响应，进入 `workbench-core` 目录执行 `npm.cmd run start:workbench`，再重新打开工作台。

### 为什么生成的内容没有直接写入正文

这是候选治理的正常行为。先查看候选、Diff 和证据，确认接受哪些块后，Core 才会写入正文并记录版本。

### 为什么索引需要确认重建

Embedding 模型、向量维度或数据边界发生变化时，旧索引不再可靠。系统会标记为 stale，要求用户确认后重新建立索引。

## 7. 开发与验收命令

```powershell
cd D:\雷达毕设相关\high_star\text-workbench-assistant
npm.cmd run check

cd ..\workbench-core
npm.cmd run check
npm.cmd test
```

Core 测试覆盖服务锁、健康检查、SQLite-only 迁移和重启恢复、正文块写入保护、工作区绑定、AgentTask、RAG、材料导入、版本、审计和插件生成。
