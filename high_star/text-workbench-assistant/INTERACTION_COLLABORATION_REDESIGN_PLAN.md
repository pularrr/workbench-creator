# 工作台—DSH 人机协同交互重构计划

## 1. 背景与结论

当前实现存在三类根本问题：

1. 页面把 AI 请求写为 `AgentTask` 后，用户只能看到“queued · 等待 Agent 领取”；DSH 对话没有可见的请求卡片、领取过程、工具过程或结果回传。
2. 项目虽然在底层通过 workspace / assistantKey 关联，但页面、DSH 对话和任务结果没有构成一个可见的协作会话；用户无法理解“谁正在做什么、为什么等待、结果在哪里”。
3. 编辑与 Diff 以正文块为中心，大纲与行文逻辑只能展示或被间接生成，不能作为用户可编辑、可审查、可确认的变更对象。

本轮不再把页面理解为“向 DSH 发一个静默命令的遥控器”，而是把 DSH 对话和工作台理解为同一项目协作会话的两个视图：

```text
用户在页面发起请求
→ Core 创建可追踪协作事件
→ DSH 对话立即显示请求卡片与执行过程
→ DSH 提交统一变更集 / 审查结果
→ 页面与对话同时可见、可讨论、可确认
→ Core 原子应用用户接受的变更
```

## 2. 重构目标

### 2.1 用户体验目标

- 页面点击任何 AI 功能后，DSH 对话中有明确、可读的同一条协作请求；
- DSH 领取、检索、失败、候选完成和等待确认都能在页面和对话中同步显示；
- 页面不再使用“功能键只发送意图给 DSH”这类不可见、不可验证的行为；
- 用户可编辑大纲、行文逻辑、正文与审查意见；
- 一次再生成以完整变更集展示：**大纲 Diff + 行文逻辑 Diff + 正文 Diff + 审查意见/证据**；
- 用户可逐项接受、拒绝或编辑后接受，未选择的内容不被覆盖。

### 2.2 技术目标

- `workspaceId + activeProjectId + collaborationSessionId` 成为页面与 DSH 的统一协作上下文；
- Core 继续作为唯一数据写入口；
- AI 执行不再依赖“模型恰好在下一轮对话中想起轮询任务”；
- 所有跨页面/DSH动作以可持久化、可审计的事件和结果记录；
- 现有正文块、版本、审计和 AgentTask 数据可平滑迁移。

## 3. 目标架构

```text
┌──────────── 页面 ────────────┐          ┌──────────── DSH 对话 ─────────────┐
│ 编辑器 / Diff / 请求卡片      │          │ 协作请求卡片 / 工具过程 / 回复      │
└───────────────┬─────────────┘          └──────────────┬────────────────────┘
                │                                         │
                └──── Collaboration Event Stream ─────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Workbench Core                                                             │
│ collaboration_sessions / collaboration_events / AgentTask / ChangeSet      │
│ project / outline / logic / manuscript / review / evidence / audit         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 统一协作事件 `CollaborationEvent`

新增持久化事件，不直接把页面动作等同为 AgentTask：

```text
CollaborationEvent
- id
- collaborationSessionId
- workspaceId
- projectId
- origin: page | dsh | system
- kind: user_request | agent_claimed | progress | tool_call | result | error | confirmation
- requestType
- visibleSummary
- payloadRef
- taskId
- createdAt
```

页面的“审查”“检索文献”“再生成”等动作先创建 `user_request` 事件和关联 AgentTask。DSH 侧通过协作桥接订阅/拉取事件后，应在对话 UI 中渲染同一请求卡片，并写入 `agent_claimed`、`progress`、`tool_call`、`result` 等事件。

### 3.2 DSH 可见协作桥接

需要新增 DSH 侧的协作桥接，而不是只在 Persona 中写“轮询任务”。桥接职责：

1. 在当前稳定助手键对应的 workspace 中读取待展示事件；
2. 将页面请求渲染为对话卡片：来源、项目、请求、状态、开始时间；
3. 用户或 DSH 执行器领取任务后，持续写入可见进度与工具摘要；
4. 结果生成后，在对话中展示候选摘要和“请在页面确认 / 在此确认”的动作；
5. 页面轮询或 SSE 接收同一事件流。

**关键决策：** Core 不具备模型推理能力，不能承诺自行领取任务。必须明确提供一种执行模式：

- 模式 A：DSH 对话内用户确认“开始处理”，由本轮模型领取；
- 模式 B：部署常驻 DSH Agent Executor，自动领取允许自动执行的任务；
- 模式 C：未配置执行器时明确显示“等待 DSH 执行器”，并给出一键转到/复制给 DSH 的请求，而不是伪装成正在执行。

首期实现模式 A + C；模式 B 作为后续部署能力。

### 3.3 统一变更集 `ChangeSet`

替代仅有 `regeneration_candidate.proposedBlocks` 的模型：

```text
ChangeSet
- id / projectId / taskId / baseRevision
- status: draft | awaiting_confirmation | applied | rejected | stale
- outlineChanges[]
- logicChanges[]
- manuscriptChanges[]
- reviewChanges[]
- evidenceRefs[]
- rationale
- createdBy / createdAt
```

每项变更必须带有：`entityId`、`before`、`after`、`reason`、`evidenceRefs`、`selected`。Core 以 `baseRevision` 校验变更是否过期，并只应用用户选中的条目。

## 4. 功能设计

### F1：协作会话与可见状态

#### 页面

- 顶部展示当前“协作会话”：项目名、DSH 状态、执行器状态、最后事件；
- 所有请求按钮点击后立即生成“请求卡片”，而不是只写一行状态文字；
- 卡片显示：`已发送给 DSH → 已领取 → 正在检索 → 候选就绪 → 等待确认 → 已完成/失败`；
- 支持展开查看工具摘要、耗时、错误和结果链接；
- 使用 SSE 优先、短轮询兜底同步状态。

#### DSH 对话

- 页面请求在对话中显示为系统协作卡片，而非要求用户猜测是否送达；
- DSH 回复中必须引用请求编号和项目名；
- 执行步骤显示简短可读摘要，例如“检索材料：8 个命中”“生成 3 项大纲修改”；
- 对话与页面都能打开同一个 ChangeSet。

### F2：可编辑大纲与行文逻辑

#### 大纲编辑器

- 增加章节树：新建、重命名、移动层级、调整顺序、删除；
- 每次编辑先在本地草稿中保存，不立即写 Core；
- “保存大纲草稿”创建变更集或直接受确认的确定性更新；
- Framework 校验失败时定位到具体章节和规则。

#### 行文逻辑编辑器

每个正文块/章节允许编辑以下字段：

```text
写作目标 / 读者问题 / 核心论点 / 前文承接 / 后文过渡
证据要求 / 禁止主张 / 风格约束 / 关联正文块
```

- 行文逻辑从只读卡片升级为表单或结构化面板；
- 用户编辑保存后更新 `logicBlocks`，产生 revision 和审计；
- 再生成任务读取用户编辑后的逻辑，而非覆盖它；
- DSH 在生成前必须展示将采用的逻辑约束摘要。

### F3：四维 Diff 与审查工作台

新增统一“变更审查”页面，固定四个区域：

| 区域 | 展示内容 | 用户动作 |
| --- | --- | --- |
| 大纲 Diff | 章节新增、删除、移动、标题/目标修改 | 逐项接受、拒绝、编辑 |
| 行文逻辑 Diff | 论点、过渡、证据要求、风格约束变化 | 逐项接受、拒绝、编辑 |
| 正文 Diff | 逐块原文/候选/证据/理由 | 逐项接受、拒绝、编辑 |
| 审查意见 | 已接受、待处理、拒绝的建议及其来源 | 选择纳入下一次生成 |

变更集顶部显示：基准版本、任务来源、执行器、RAG 证据、模型/配置（如可获得）、生成时间与过期状态。

### F4：文献检索与检索可视化

替换单一 `prompt('请输入文献检索词')`：

- 提供中文关键词、英文关键词、年份范围、数据源、每源数量输入；
- 首期要求用户确认/补充英文关键词，不伪造翻译；后续可接入受确认的翻译服务；
- 并行请求 OpenAlex 与 Crossref，按数据源和关键词展示进度、错误与命中数；
- 用卡片展示题名、作者、年份、来源、DOI、被引数、开放获取状态、去重关系；
- 支持排序、筛选、批量勾选加入书目；
- 搜索结果不自动写入项目，加入书目仍需确认。

### F5：功能键运行反馈统一化

所有可能超过 300ms 的按钮必须采用同一交互契约：

```text
点击 → 按钮禁用并显示处理中
→ 创建 requestId / eventId
→ 页面显示步骤、进度和可取消入口
→ 成功显示结果摘要和下一步
→ 失败显示原因、重试和诊断信息
```

覆盖材料导入、RAG 检索、文献检索、索引重建、模板解析、导出、审查、再生成和项目恢复。

## 5. 数据模型与 API 计划

### 5.1 SQLite 表

```text
collaboration_sessions
collaboration_events
change_sets
change_set_items
change_set_evidence_refs
```

保留并关联现有：`agent_tasks`、`agent_traces`、`review_suggestions`、`manuscript_blocks`、`audit_events`。

### 5.2 Core API

```text
POST /api/collaboration-events
GET  /api/collaboration-events?sessionId=...&after=...
GET  /api/collaboration-events/stream              # SSE
POST /api/agent-tasks/:id/claim
POST /api/agent-tasks/:id/progress
POST /api/change-sets
GET  /api/change-sets/:id
POST /api/change-sets/:id/apply
POST /api/change-sets/:id/reject
POST /api/logic-blocks/:id
POST /api/outline/draft
```

### 5.3 工具契约

新增或调整：

```text
wb_list_collaboration_events
wb_acknowledge_collaboration_request
wb_publish_collaboration_progress
wb_create_change_set
wb_submit_change_set
wb_apply_change_set
wb_update_logic_block
wb_update_outline_draft
```

旧 `wb_submit_regeneration_candidate` 保持兼容，但内部转换为 ChangeSet。

## 6. 实施阶段

### Phase A：现状止损与可见性（优先）

1. 页面 AI 队列增加状态说明、进度条、任务时间、执行器信息和错误详情；
2. 不再把 `queued` 描述为“正在处理”；明确显示是否有 DSH 执行器；
3. 增加页面请求卡片和 DSH 侧请求编号/摘要；
4. 将文献检索替换为中英文表单和可视化结果卡片；
5. 移除每 3 秒调用全量 `load()` 的页面刷新；材料验收清单只在导入、解析、索引或用户手动刷新时更新，并显示“上次更新”与真实处理状态；
6. 给所有长操作增加统一 loading / success / failure 反馈。

**验收：** 用户不查看日志也能判断任一按钮是否已发送、正在执行、等待执行、成功或失败；静态浏览项目时，材料清单不会因后台轮询而闪烁或重绘。

### Phase B：协作事件桥接

1. 建立 `CollaborationEvent` 表、API 与审计；
2. 页面创建请求事件并订阅 SSE；
3. DSH 侧实现请求卡片与领取/进度回写；
4. 定义模式 A（用户触发 DSH 处理）的明确流程；
5. 断线、刷新、DSH 重启后恢复事件时间线。

**验收：** 在页面点击审查后，DSH 对话可见同一请求；在 DSH 领取后，页面 2 秒内显示领取与进度。

### Phase C：大纲与逻辑可编辑化

1. 大纲树编辑器与 Framework 校验；
2. 逻辑块编辑器、保存、revision 与审计；
3. 正文块与逻辑块的关联维护；
4. DSH 生成上下文读取并展示用户最终编辑的逻辑。

**验收：** 用户修改任一章节目标/过渡后，再生成候选能体现该约束；没有显式确认不得覆盖用户逻辑。

### Phase D：统一 ChangeSet 与四维 Diff

1. ChangeSet/Item 表、旧候选迁移适配；
2. 大纲、逻辑、正文、审查意见的可视化 Diff；
3. 逐项选择、编辑后接受、部分应用；
4. 原子写入、版本、审计和 stale 检查。

**验收：** 用户只接受一项逻辑修改和两段正文修改时，Core 只写入这三项；每项可回溯任务、证据和确认。

### Phase E：常驻执行器（可选部署）

1. 定义 DSH Agent Executor 进程、认证和单实例；
2. 明确哪些任务允许自动领取，哪些必须用户在对话中确认；
3. 健康检查、心跳、超时、重试与 `stale` 回收；
4. 页面显示执行器在线状态。

**验收：** 配置执行器后，允许自动执行的任务在规定时间内被领取；未配置时不产生“假运行”状态。

## 7. 验收矩阵

| 场景 | 必须可见的结果 |
| --- | --- |
| 页面点击“审查” | 页面和 DSH 同时出现同一请求编号与项目名 |
| 无执行器 | 明示等待 DSH，不显示虚假的进度 |
| DSH 领取 | 页面显示执行器、步骤、进度和工具摘要 |
| 双语文献检索 | 中英文关键词、数据源、去重和错误均可见 |
| 修改行文逻辑 | 保存后可审计，后续生成读取该逻辑 |
| 再生成 | 同时展示大纲、逻辑、正文、审查意见 Diff |
| 部分确认 | 仅选中的 ChangeSet 项写入，其他保持不变 |
| 刷新/重启 | 页面与 DSH 能恢复同一协作会话及事件时间线 |

## 8. 风险与边界

- 没有常驻 LLM/DSH 执行器时，Core 不能自行执行 AI 任务；必须把这一限制公开展示；
- 自动翻译中文检索词会影响检索质量和数据边界，首期应要求用户确认英文关键词；
- ChangeSet 改造会影响现有候选和模板重构流程，需保留兼容适配；
- SSE 必须有短轮询回退，避免本地浏览器或代理环境下静默失效；
- 不把页面状态作为事实来源，所有状态均由 Core 事件与 SQLite 数据恢复。

## 9. 推荐实施顺序

```text
Phase A 可见性与双语检索
→ Phase B 页面—DSH 协作事件桥接
→ Phase C 大纲/逻辑编辑
→ Phase D ChangeSet 与四维 Diff
→ Phase E 可选常驻执行器
```

先解决“用户看不到发生了什么”，再解决“AI 如何自动执行”，最后建设跨结构层的安全变更确认。这样不会在不可见、不可解释的任务队列之上继续叠加功能。
