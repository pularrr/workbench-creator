---
name: controlled-regeneration
description: 将用户修改和已接受的审查建议合并为最小范围修订批次。
whenToUse: 当用户要求重新生成局部内容，或准备执行已接受审查建议时使用。
user-invocable: true
disable-model-invocation: false
---

# 受控局部修改

1. 读取工作台状态，只收集状态为 `accepted_for_revision` 的审查建议。
2. 用户直接提出的修改作为 `userChanges` 传给 `thesis_create_revision_batch`。
3. 用户编辑但尚未接受的审查建议不得进入修订批次。
4. 若出现冲突，调用 `thesis_resolve_revision_batch` 保存用户确定的最终指令；无冲突或解决后仍调用 `thesis_confirm_revision_batch` 等待确认。
5. 确认后生成最小范围候选 Patch，并调用 `thesis_submit_patch_proposal`。创建批次和提交 Patch 都不等于修改正文。
6. 只有用户查看差异并明确接受后，才调用 `thesis_decide_patch_proposal`；拒绝时保留原正文。
