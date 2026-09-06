---
name: embedding-setup
description: 显式配置和验证项目级 Embedding 服务，并在模型切换后安全重建向量索引。
whenToUse: 当用户配置、测试或切换 Embedding 模型，或知识库显示索引失效时使用。
user-invocable: true
disable-model-invocation: false
---

# Embedding 设置

1. 用 `thesis_get_embedding_status` 读取当前配置、凭据就绪状态与索引状态。
2. 保存前先调用 `thesis_test_embedding_connection`。API Key 只传给工具，不在回复、Prompt、日志摘要或项目数据中复述。
3. 用 `thesis_set_embedding_config` 保存项目配置。切换模型后旧向量索引会变为 stale，不能混合不同向量空间检索。
4. 获得用户确认后调用 `thesis_rebuild_embeddings`。重建只影响当前项目的 Chunk 向量，不修改源文件、正文或版本。
5. `local-hash` 免费且无需密钥，但只适合演示；正式语义检索应使用用户验证过的 OpenAI-compatible Embedding 服务。
