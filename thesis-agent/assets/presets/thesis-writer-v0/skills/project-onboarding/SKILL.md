---
name: project-onboarding
description: 创建或打开论文项目，检查题目、学位类型、目标字数和规划状态。
whenToUse: 当用户开始一个新论文项目、切换项目或询问下一步时使用。
user-invocable: true
disable-model-invocation: false
---

# 项目接入

1. 先调用 `thesis_project_status`。只有当前会话未绑定项目时才调用 `thesis_create_project`。
2. 不替用户编造学校要求、论文题目或目标字数；缺失时明确列为待确认项。
3. 创建项目后说明当前处于规划阶段，不直接生成全文。
4. 下一步收集项目材料和模板来源。仅对用户明确批准的文本调用 `thesis_import_source_text`，不得自行扫描目录或读取未批准文件。
