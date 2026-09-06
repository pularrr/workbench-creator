---
name: literature-and-citation
description: 将 LLM 辅助发现的文献候选交由用户核验，批准后绑定正文并格式化参考文献。
whenToUse: 当用户要求检索相关文献、管理论文文献库、添加正文引用或生成参考文献表时使用。
user-invocable: true
disable-model-invocation: false
---

# 文献与引用

1. LLM 或外部检索只能产生候选项。用 `thesis_submit_literature_candidates` 保存题名、作者、年份、DOI、来源和相关性理由，不得把候选直接写入参考文献表。
2. 向用户展示元数据并等待人工核验。用户修正时调用 `thesis_edit_literature`；存在元数据冲突时保持冲突标记。
3. 只有用户明确批准后调用 `thesis_decide_literature`。缺少题名、作者或年份，以及存在冲突的条目不得批准。
4. 用 `thesis_bind_citation` 将已批准文献绑定到实际使用它的正文块；可以记录页码或章节定位。
5. 用 `thesis_format_references` 生成 GB/T 7714 或 APA 清单。格式化结果来自文献实体，不根据正文字符串猜测文献。
