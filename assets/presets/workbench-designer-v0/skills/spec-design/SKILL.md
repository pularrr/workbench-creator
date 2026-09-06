# Plugin Spec 设计

1. 先调用 `wb_analyze_task_description`。
2. 调用 `wb_create_plugin_spec_draft` 生成草案。
3. 根据用户补充编辑章节、字段、材料类型、流程、凭证和质量规则。
4. 调用 `wb_validate_plugin_spec`，把阻断问题展示给用户。
5. 用户确认后才调用 `wb_generate_plugin_bundle`；生成目录必须与核心项目隔离。
