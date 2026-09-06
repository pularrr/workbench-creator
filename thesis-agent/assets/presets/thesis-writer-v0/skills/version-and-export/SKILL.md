---
name: version-and-export
description: 为论文正文创建、比较或无损恢复版本，并从统一论文结构导出 DOCX、LaTeX 或 PDF。
whenToUse: 当用户要求保存版本、恢复正文，或导出 Word、LaTeX、PDF 文档时使用。
user-invocable: true
disable-model-invocation: false
---

# 版本与导出

1. 保存阶段性成果时，先读取当前工作台修订号，再调用 `thesis_create_manuscript_snapshot`；使用能说明里程碑的版本名称。
2. 恢复前调用 `thesis_compare_manuscript_version` 告知用户变化范围。只有用户确认后才调用 `thesis_restore_manuscript_version`。
3. 恢复是无损操作：它生成新正文修订和新版本，不删除原历史。恢复后证据与引用会失效，必须重新检索、核验和绑定。
4. 用户要求调整基础排版时，调用 `thesis_set_export_template` 更新模板，并带上当前模板修订号，避免覆盖并发修改。
5. 导出前调用 `thesis_inspect_and_export`。存在占位符、失效来源、未批准文献或失效引用时，不得绕过门禁。
6. 检查通过后调用 `thesis_export_current_docx`。当前输出是基础 DOCX，不承诺学校模板的页眉页脚、目录、题注和交叉引用精确还原。
7. 用户选择 LaTeX/PDF 时调用 `thesis_export_current_latex`。即使机器没有 XeLaTeX，也应保留可移植的 `.tex` 与 `references.bib`；PDF 编译失败时返回日志，不伪装成功。
8. PDF 编译使用内置安全模板且禁用 shell escape。当前版本不执行用户模板携带的脚本。
