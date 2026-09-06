---
name: governed-react-run
description: 用轻量 ReAct 状态机记录论文生成的计划、动作、观察、预算和人工确认。
whenToUse: 当用户要求启动、跟踪、暂停、恢复或取消一次受治理的论文生成任务时使用。
user-invocable: true
disable-model-invocation: false
---

# 受治理的 ReAct 运行

1. 用 `thesis_create_agent_run` 建立运行，明确范围、是否启用审查和预算；不要把模型隐藏思维写入步骤，只记录可审计摘要。
2. 用 `thesis_advance_agent_run` 提交事件，而不是指定目标状态。系统负责验证状态转移和修订号。
3. 每次检索或检查后记录结构化 observation。证据不足使用 `evidence_insufficient`，不得伪装为充分；达到重试预算后等待用户补充材料。
4. `awaiting_plan_confirmation` 和 `awaiting_user_decision` 必须由用户决定，Agent 不得代替确认。
5. 长任务暂停、继续或取消分别使用对应工具；恢复从原状态继续，不重新创建已经完成的材料和版本。
6. 写入候选正文前核对项目修订号。项目在运行中被用户修改时，停止应用并报告冲突。
