# 实现状态

更新日期：2026-09-02

## 已完成

- 可通过 `dsh plugin --profile web add .` 安装的 Bundle。
- 独立开发 `DSH_HOME` 安装验证。
- `thesis-writer-v0` 与 `thesis-review-v0` Preset 资产。
- 写作与审查 Skill 隔离目录。
- 会话与论文项目绑定、项目隔离和 JSON 原子持久化。
- 内置硕士论文模板、大纲、章节目标、字数预算和饱满行文逻辑。
- 规划修订号和确认前状态。
- 稳定正文块 ID、正文到行文逻辑及行文逻辑到正文的双向查询。
- 正文修订号和绑定失效状态。
- 审查建议提交、用户编辑、接受和拒绝。
- 编辑后的建议必须再次接受或拒绝。
- 已接受建议与用户直接修改合并为 RevisionBatch。
- 写作与审查 Preset 的工具权限分离。
- RevisionBatch 冲突检测、解决、确认及状态机。
- 候选正文 Patch 接受/拒绝与版本事务。
- 参考论文结构导入，全文或选章生成前确认、候选稿接受。
- 文本/Markdown 内容哈希、结构分块、本地批量 Embedding 和混合检索。
- 隐式正文来源绑定、源变化失效传播、检查和 Markdown 导出门禁。
- 新增材料检索与确认范围生成 Skills。
- P1 本机双区工作台：项目选择/创建、Markdown 正文、大纲、当前行文逻辑、来源和审查建议。
- P1 光标段落到逻辑联动，大纲/逻辑保存和审查建议接受/拒绝。
- P2 明确批准后的目录预扫描，以及 TXT/Markdown/代码/PDF/DOCX/PPTX/XLSX/CSV/ODF/RTF/HTML/EPUB 解析。
- P3 本地与 OpenAI-compatible Embedding 提供商、批处理、检索过滤和预算化证据包。
- P4 文献候选去重、人工批准、元数据编辑、正文引用绑定及 GB/T 7714/APA 格式化。
- P5 无来源数字、重复段落、篇幅覆盖、相关工作比较和术语一致性检查。
- P6 命名快照、块级差异、无损版本恢复、基础模板参数和 DOCX 导出。
- P7 统一论文结构模型、带引用键的 LaTeX/参考文献工程以及安全 XeLaTeX PDF 编译。
- P8 轻量 AgentRun：合法事件转移、步骤、Observation、预算、暂停、恢复和取消。
- 项目级显式 Embedding 设置、连接测试、凭据非持久化、模型切换失效和全量重建。
- 工作台新增最近 5 个版本、差异查看、恢复确认、保存版本和 DOCX 导出入口。
- 手工正文修改会递增块修订号，并自动使旧来源绑定和引用失效。
- PDF.js 高危依赖已覆盖到修复版本，`npm audit` 为 0 漏洞。

## 已验证

- 28 个 Node 测试全部通过，包括真实 XeLaTeX 中文 PDF 编译。
- JavaScript 语法检查通过。
- npm Bundle 内容检查通过。
- 隔离 `DSH_HOME` 中插件安装成功。
- Bundle 自动加入 Web profile 配置。
- 两个 Preset 安装成功。
- DSH Web 在 `127.0.0.1:3180` 启动成功并返回 HTTP 200。

## 下一切片

1. 将 AgentRun 自动串联 GenerationTask、证据检索、质量检查与审查 Agent，而不仅是受控状态记录。
2. 用户 LaTeX 模板 ZIP、入口文件/占位符映射、编译预览和模板版本管理。
3. 图片 OCR、图表结构化抽取和表格单元格级来源定位。
4. 正式 Reranker、生产向量库适配器和增量 Embedding 重建进度。

## 暂未实现

- 自动调用独立审查 Agent 的 Host 控制器。
- 图片及复杂扫描件的高质量 OCR。
- RAGFlow 高保真解析器的独立适配端口（当前使用轻量解析与 OfficeParser）。
- 可视化 Project Map。
- 学校 DOCX/LaTeX 模板的页眉页脚、题注和交叉引用高保真还原。
- API Key 的 DSH Credentials 持久化适配；当前界面输入只在进程内存中保存。
