# 文本生成工作台协作

## 总则

1. 每次开始或恢复任务，先调用 `wb_get_work_stage`。
2. 使用稳定助手键 `web:text-workbench-assistant-v0` 调用 `wb_get_resume_state`；用户确认后才调用 `wb_resume_project`。
3. 阶段切换必须调用 `wb_set_work_stage`，传入 `userConfirmed: true`、稳定助手键和切换原因。
4. 只调用当前阶段允许的工具，不得通过其他入口绕过 Core 治理。
5. 未经用户授权不读取材料；没有来源支持时标记证据缺口。

## Design：构建领域任务台

1. 分析任务并创建、展示、校验 Plugin Spec。
2. 分别取得输出目录确认和插件安装确认。
3. 安装后等待用户指定要使用的任务台插件和项目。
4. 创建项目前调用 `wb_get_project_limit`；达到 10 个项目时展示最早项目，确认后才传 `confirmedEviction: true`。
5. 创建或选择项目时传稳定助手键完成绑定；经用户确认后进入 `write`。
6. 创建内置 `thesis` 项目前，确认学位类型（本科/硕士/博士）、学科方向、学校、研究形态、语言和引用规范；将学位类型传为 `degreeType`，其余字段传为 `domainFields`。创建内置 `patent` 项目前，确认发明/实用新型、申请人、发明人、技术领域；将专利类型传为 `patentType`，其余字段传为 `domainFields`。

## Write：人机协同生成

1. 读取绑定项目的完整工作台状态，只导入用户明确选择的材料。
2. 先检索和绑定证据，再规划大纲和正文，不得编造出处。
3. 重要写入前创建快照，携带预期 revision；长步骤保存 checkpoint 和稳定 `idempotencyKey`。
4. 检测到中断运行时向用户说明恢复点，经确认后恢复，禁止重复写入。
5. 发现页面创建的 AgentTask 时，先调用 `wb_claim_agent_task`，在执行中调用 `wb_update_agent_task_progress`。生成任务只可调用 `wb_submit_regeneration_candidate` 提交候选；完成或失败必须调用 `wb_complete_agent_task` 或 `wb_fail_agent_task`，不得通过浏览器消息或直接覆盖正文。

## 页面 AI 任务

1. 页面创建的 AI 请求是 Core 中持久化的 `AgentTask`，不是父窗口消息。
2. 优先调用 `wb_list_agent_tasks({ status: 'queued' })` 领取任务；DSH 重启后继续领取未完成任务。
3. `review_manuscript` 只保存 `ReviewSuggestion`；`regenerate_diff` 读取任务的 `requestId` 与再生请求，提交候选并等待用户确认；材料、文献和检索配置任务遵守其既有确认边界。

## Review：审查和交付

1. 用户要求审查后进入 `review`。
2. 检查结构、领域字段、证据、引用、术语和版本差异，不直接修改正文。
3. 用户要求修改时，确认后返回 `write`；用户确认定稿后再导出。

## 页面、持久化与归档

- 未指定项目时调用 `wb_open_workbench({})`；指定项目时先绑定再打开。
- 页面与对话使用同一 Core 存储和项目绑定。
- DSH 退出不会删除项目；新会话通过恢复工具重新绑定。
- 活跃项目上限为 10，第 11 个项目创建前必须说明最早项目将被归档。
- 用户要求删除时明确说明默认操作为可恢复归档，确认后才执行。
