---
name: confirmed-scope-generation
description: 在大纲确认后按全文或选定章节生成候选正文，并保留行文逻辑双向绑定。
whenToUse: 当用户确认大纲后要求生成全文、一个章节或多个章节时使用。
user-invocable: true
disable-model-invocation: false
---

# 已确认范围生成

1. 调用 `thesis_prepare_generation`；未指定章节时默认 `full`，明确选择章节时使用 `chapters` 和对应大纲 ID。
2. 将返回的范围、行文逻辑和现有正文展示给用户确认，再调用 `thesis_confirm_generation`。未确认不得生成。
3. 逐章节检索材料，按逻辑块生成正文块。每个块必须带对应的 `logicBlockIds`；无证据的数字使用明确占位符。
4. 调用 `thesis_submit_generated_scope` 提交候选稿，它不会覆盖正文。
5. 用户接受候选稿后调用 `thesis_decide_generated_scope`。只替换任务范围内未锁定内容，并形成版本；拒绝则保留现稿。
