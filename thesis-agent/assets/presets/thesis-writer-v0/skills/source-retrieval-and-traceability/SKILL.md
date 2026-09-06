---
name: source-retrieval-and-traceability
description: 导入用户批准的论文材料，执行项目隔离的混合检索，并在后台绑定正文与来源。
whenToUse: 当用户导入文本材料、查找项目事实、生成带来源内容或检查证据是否失效时使用。
user-invocable: true
disable-model-invocation: false
---

# 材料检索与来源回溯

1. 只把用户明确批准的文本或 Markdown 传给 `thesis_import_source_text`；不主动扫描目录，也不把密钥、证书或环境变量内容传入工具。
2. 写作前用 `thesis_search_sources` 查询当前章节需要的事实。结果包含原文、文件名、行范围及融合相关度；不得跨项目拼接材料。
3. 实验数值、结论和外部事实必须来自检索结果或明确标为待确认，不得根据常识补造。
4. 正文被用户接受后，用 `thesis_bind_block_sources` 在后台绑定实际使用的 Chunk。不要向用户呈现大型证据篮；需要解释时只展示当前光标段落对应来源。
5. 导出前调用 `thesis_inspect_and_export`。若来源已变化或存在占位符，先处理阻断问题。
