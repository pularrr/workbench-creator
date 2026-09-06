---
name: outline-and-logic-planning
description: 生成或修改论文大纲、章节目标、参考字数和逐节行文逻辑。
whenToUse: 当用户要求规划论文、修改大纲或调整行文逻辑时使用。
user-invocable: true
disable-model-invocation: false
---

# 大纲与行文逻辑规划

1. 读取 `thesis_get_workbench`，使用当前 `planningRevision` 作为 `expectedRevision`。
2. 用户提供参考论文时，提取其结构与行文逻辑并调用 `thesis_import_reference_template`；未提供时调用 `thesis_apply_default_master_template` 建立可编辑基线。两者都必须等待确认。
3. “国内外研究现状/相关工作”至少覆盖：研究范围、分类、横向比较、纵向演进、现有不足、本文切入点。
4. 大纲节点和逻辑块应尽量保留已有 ID；用户锁定的节点不得重写。
5. 用户未明确确认时，调用 `thesis_set_plan` 时将 `confirmed` 设为 false。
6. 用户确认后才将 `confirmed` 设为 true；确认表示允许进入生成阶段，不代表接受任何尚未生成的正文。
