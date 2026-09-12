# 开发记录

## 2026-09-12

## 2026-09-13：执行器可见性、事件流与 Google Scholar 数据源

### DSH 实时会话派发补充

- 状态：已完成并验证。
- 已使用 DSH `ctx.agents.get(sessionId)` 与 `agent.followup()` 接通页面到同一 live DSH 会话的反向派发。页面创建 `AgentTask` 后，DSH 对话能看到可追踪的请求消息，并自动开始下一轮处理。
- 每次派发均持久化为 `chat_injected`；无 live 会话、插件未加载或发送异常时持久化为 `chat_injection_unavailable`，附带用户可理解的原因。
- 新增端到端回归：验证注入器接收完整会话/项目/任务上下文，并记录成功派发事件。

- 状态：已完成并验证。
- Core 新增持久化 `agent_workers` 实体。DSH Worker 可注册、周期性心跳、正常停止；页面显示在线执行器、最后心跳和离线/过期原因。没有真实 Worker 时，队列只显示“等待领取”，不再伪称为运行中。
- 新增 SSE 端点 `GET /api/collaboration-events/stream`，支持按 `sessionId`、`projectId` 与 `after` 游标订阅或恢复协作事件。
- 文献检索新增年份范围和数据源选择；Google Scholar 通过配置 `SERPAPI_API_KEY` 的 SerpApi 合规适配器接入，不抓取 Scholar HTML，也不会绕过访问控制。
- 验收：`npm.cmd run check` 与 `npm.cmd test` 全部通过；新增 Worker 跨 SQLite 重启的端到端测试；Core 健康检查返回 `ready/sqlite`。

### F-001：页面 AI 请求改为持久化 AgentTask 队列

- 状态：已完成。
- 目标：移除工作台页面对 `window.opener.postMessage()` 的依赖，使页面独立打开时也能创建、查看和恢复 AI 任务。
- 变更：页面审查、材料/文献/检索配置请求及 Diff 再生成将写入 Core 的 `AgentTask`；DSH 通过 `wb_list_agent_tasks` 领取和更新任务。
- 验收：页面源码不再包含浏览器父窗口通信；Core 与预设测试全数通过；任务持久化重启测试通过。

### F-002：SQLite 审计事件表与查询接口

- 状态：已完成。
- 目标：让项目审计具备独立、可查询的持久化记录，而非只存在于状态快照。
- 变更：SQLite 新增 `audit_events` 表和项目/时间索引；状态快照写入与审计镜像写入同属一个事务；新增 `wb_list_audit_events` 与 `GET /api/audit-events`。
- 验收：新增 SQLite 端到端测试，确认事件可读取 `actor`、`action`、`projectId`、revision 范围与时间戳；专项测试通过。

### F-003：Core 单实例锁、健康复用与受控关闭

- 状态：已完成。
- 目标：避免多个 Runtime 同时写入同一项目存储，并让启动方可以复用健康服务。
- 变更：新增按存储路径锁定的 Core 服务锁及过期锁恢复；`wb_open_workbench` 先探测 `/health` 后复用既有服务；独立启动脚本同样复用健康服务，并在终止信号下关闭 HTTP 服务和 SQLite 连接。
- 验收：新增服务锁测试与健康就绪测试；专项测试通过。

### F-004：Core API 回归修复与稳定工作区绑定

- 状态：已完成。
- 变更：`WorkbenchRuntime` 补齐工作阶段公开转发，修复页面直连 RAG/检索配置测试；稳定助手键会同步到持久化 workspace，DSH 更换 session 或重启后仍可恢复同一当前项目；项目归档会清空受影响 workspace 的活动绑定。
- 验收：页面直连 API、稳定 workspace 重启恢复及 Core 静态检查通过。

### F-005：SQLite 关键实体投影

- 状态：已完成（兼容迁移层）。
- 变更：在保持 `workbench_state` 快照可恢复性的同时，SQLite 同一事务内维护工作区、项目、材料、分块、证据、正文块、版本、审查、候选、任务和轨迹实体表，并补充索引。
- 验收：端到端测试验证实体表创建、项目 revision 与正文块投影；完整 Core 测试通过。

### F-006：SQLite-only 主存储迁移

- 状态：已完成。
- 变更：`.db` 运行时不再创建或更新 `workbench_state.state_json`；启动时从 SQLite 的项目、工作区、绑定、上下文、归档和审计实体表恢复运行状态。发现旧数据库快照或同目录旧 `state.json` 时，仅在首次启动导入一次。
- 验收：覆盖旧 JSON 导入、SQLite 重启恢复、实体表查询与无快照表创建的端到端测试通过。

### F-007：归档项目管理与永久删除

- 状态：已完成。
- 变更：工作台新增“归档项目”管理对话框，支持恢复；永久删除仅允许处理归档项目，要求完整项目名称和二次确认。Core 删除项目数据、关联实体和受控材料目录，同时保留最小全局审计事件及删除计数。
- 验收：端到端测试验证活跃项目不可永久删除、名称错误被拒绝、成功删除后归档消失且审计保留。

### UX-R1：页面—DSH 协作交互重构

- 状态：进行中（Phase A 部分完成）。
- 范围：消除页面静默入队与 3 秒全量刷新；增加请求/执行可见性、中英文文献检索可视化、大纲和逻辑编辑，以及统一 ChangeSet 四维 Diff。
- 计划：见 `INTERACTION_COLLABORATION_REDESIGN_PLAN.md`；按 Phase A → D 实施，常驻执行器作为独立部署能力处理。

#### Phase A 已完成项

- 移除页面每 3 秒调用全量 `load()` 的行为；改为只轮询 AgentTask 状态，材料验收清单不再被后台轮询重绘；
- 材料验收清单增加上次读取说明和手动刷新入口；
- AI 任务卡片显示等待执行器的真实原因、进度条、创建时间和执行器字段，避免把 `queued` 误导为运行中；
- 文献检索 Core 支持中文和英文关键词的双路查询与合并去重；页面已加入中英文检索对话框和结果卡片基础实现；
- 行文逻辑块已新增页面编辑表单、Core 写入接口、revision 校验和审计事件。

#### 后续项

- Phase B：页面—DSH 协作事件桥接与对话可见请求卡片；
- Phase D：ChangeSet 与大纲/逻辑/正文/审查意见四维 Diff。

#### Phase B 开始

- Core 新增 `collaboration_events` SQLite 表及查询 API；页面创建 AgentTask 时同步记录 `user_request` 协作事件，事件包含会话、workspace、项目、任务编号和可见摘要。
- 新增 `GET /api/collaboration-events`，为页面—DSH 事件桥接和后续 SSE 提供统一数据源。
- 端到端测试验证页面任务创建后可读取对应协作事件。

#### Phase B 进展

- AgentTask 的领取、进度、完成和失败现在都会追加可见协作事件；
- DSH 新增 `wb_list_collaboration_events` 与 `wb_publish_collaboration_progress`，可读取/发布与页面请求对应的事件摘要；
- `work-stage` 已将协作事件工具纳入 write/review 阶段权限；
- Core 静态检查与 AgentTask 重启恢复专项测试通过。
- 再生成候选提交及用户接受/拒绝也会写入 `result` / `confirmation` 协作事件，事件时间线覆盖任务完整生命周期。
