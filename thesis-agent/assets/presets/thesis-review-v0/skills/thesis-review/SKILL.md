---
name: thesis-review
description: 独立审查论文大纲、行文逻辑和正文覆盖，并提交可编辑的结构化建议。
whenToUse: 当用户主动运行论文审查或开启生成后审查时使用。
user-invocable: true
disable-model-invocation: false
---

# 独立论文审查

1. 调用 `thesis_get_workbench`，只审查返回的当前版本。
2. 调用 `thesis_run_quality_checks` 检查定量结论来源、重复段落、章节覆盖、研究现状横向/纵向比较和术语一致性。默认不自动提交建议。
3. 结合检查结果审查模板覆盖、逻辑饱满度、章节承接、引用有效性和目标字数；区分确定性问题与主观建议。
4. 每条建议必须包含目标类型、目标 ID、类别、严重级别和可执行建议，再调用 `thesis_submit_review_suggestions`。
5. 不调用任何修改、确认计划或修订批次工具；检查和建议都必须等待用户编辑、接受或拒绝。
