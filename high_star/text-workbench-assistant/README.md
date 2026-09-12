# 文本生成工作台助手

面向论文、专利和自定义技术报告等长文本任务的 DSH 协作预设。它将自然语言协作、领域工作台、材料检索、书目引用、版本审查和受控写入连成一条闭环：

```text
自然语言目标 → 选择内置任务台或审阅 Plugin Spec → 创建并绑定项目
→ 导入授权材料 → 分块 / 检索 / 证据关联 → 候选正文
→ 用户确认 → 审查、版本比较与导出
```

本仓库是**自然语言预设层**，规定助手怎样确认、编排和恢复任务。项目、状态机、RAG、Web 操作台和领域插件运行在同级的 [`../workbench-core`](../workbench-core) DSH 插件中。

## 本版更新

相对旧版 README，本版按当前实现重新整理，新增或修订了：

- 新建项目后可通过一次自然语言流程确认并**递归批量导入资料目录**；默认上限 100 个、最大 500 个文件，逐个返回导入/跳过/失败清单；
- Office/PDF、文本/代码、HTML/EPUB 与图片 OCR 的材料接入；文件会复制到项目受控目录，并保留原路径、哈希和解析状态；
- 离线 Hash 降级、可配置 OpenAI-compatible Embedding Profile、关键词 + 稠密向量 + RRF 混合检索；
- OpenAlex/Crossref 在线书目检索、确认入库、可选 HTTPS 全文导入和正文书目关联；
- 模板导入、重构差异预览、Framework 校验和确认应用；
- Windows 下生成插件的 Core 依赖桥接、`dsh.cmd` 调用和 Cordis `apply()` 兼容修复；
- 明确区分 Core 内置的论文/专利，与可生成、单独安装和重建的技术报告等领域插件。

## 30 秒理解架构

```text
用户 / DSH 对话
        │ 自然语言、确认、恢复
        ▼
文本生成工作台助手（本仓库）
  Persona + Skill + design/write/review 编排
        │ wb_* 工具
        ▼
dsh-workbench-core
  Runtime：项目 / 状态机 / 存储 / RAG / 审计 / Web API
        ├───────────────┬────────────────┬────────────────┐
        ▼               ▼                ▼
领域插件          材料与检索服务        本地工作台页面
Framework/Logic/  解析/OCR/Embedding/   项目/材料/正文/
Evidence/Material RRF/书目/模板          证据/版本/审查
```

| 类型 | 当前内容 | 升级方式 | 可单独卸载 |
| --- | --- | --- | --- |
| Core 内置领域能力 | `thesis`、`patent` | 更新 `workbench-core` | 否，随 Core 加载 |
| 独立生成领域插件 | `thesis-pro`、`tech-report`、合同等 | 重新生成并安装 | 是 |
| 自然语言预设 | 本仓库的“文本生成工作台助手” | 执行预设安装器 | 是 |

生成插件默认保存于：

```text
~/.dsh/workbench-plugins/<taskType>-workbench/
```

它们不会写入 Core 或本仓库源码；生成目录确认和安装确认必须分开进行。

## 安装与启动

### 前置条件

- Node.js `22.19.0` 或更高版本；
- 已安装 DSH，使用 Web Profile；
- 本仓库与 `workbench-core` 位于同一父目录。

```text
high_star/
├─ workbench-core/
└─ text-workbench-assistant/
```

Windows 建议使用 `npm.cmd`。

### 首次安装

先安装 Core：

```powershell
cd D:\雷达毕设相关\high_star\workbench-core
npm.cmd ci
dsh plugin --profile web add .
```

再安装预设：

```powershell
cd D:\雷达毕设相关\high_star\text-workbench-assistant
npm.cmd run setup
```

启动或重启 DSH Web：

```powershell
dsh web
```

选择“文本生成工作台助手”。DSH Web 通常使用 `3080`；通过“打开工作台”启动的项目操作台默认使用独立的本地 `3200` 端口。

### 更新、卸载与恢复

项目状态通常保存于：

```text
~/.dsh/storages/workbench-core/workbench.db
```

更新或卸载前先备份该文件。重装 Core 或预设不会主动清空项目数据。

| 场景 | 操作 |
| --- | --- |
| 仅更新预设 | 本仓库执行 `npm.cmd run setup`，然后重启 DSH |
| 更新 Core | Core 目录执行 `npm.cmd ci`，再执行 `dsh plugin --profile web add .` |
| 卸载 Core | `dsh plugin --profile web remove dsh-workbench-core` |
| 卸载生成插件 | `dsh plugin --profile web remove dsh-<taskType>-workbench`，再确认删除其生成目录 |
| 卸载本预设 | 退出 DSH 后删除 `~/.dsh/.agent-presets/text-workbench-assistant-v0/` |
| 恢复项目 | 新对话中确认恢复，或从归档项目恢复 |

> 不要删除 `workbench.db` 或项目材料目录，除非已经备份且确认要永久清空全部项目。旧版 `state.json` 会在首次启动时一次性导入 SQLite，之后不再作为运行时主存储。

## 第一次使用：创建项目并批量导入资料

例如，使用资料目录：

```text
C:\Users\kuroko131\Desktop\微波水分测量\参考文献
```

在 DSH 输入：

```text
创建一个论文项目，题目为“基于微波与 FMCW 雷达的物料水分测量研究”。
材料目录使用 C:\Users\kuroko131\Desktop\微波水分测量\参考文献，
递归导入子目录，最多导入 100 个文件。
请先复述导入范围，待我确认后创建项目、绑定当前对话并批量导入。
```

受控流程如下：

1. 助手复述精确目录、递归范围和数量上限；
2. 用户确认后创建并绑定项目，进入 `write`；
3. 逐个复制、解析支持的文件；
4. 返回 `imported / skipped / failed` 清单；
5. 对可提取文本建立当前 Embedding Profile 的索引；
6. 再检索、关联证据、生成大纲或正文。

ZIP 和未知二进制文件会以 `unsupported_file_type` 跳过；损坏、过大或 OCR 失败的单个文件不会中断其余导入。

### 材料格式与限制

| 类别 | 常见格式 | 当前处理 |
| --- | --- | --- |
| Office / 文档 | PDF、DOCX、PPTX、XLSX、ODT、ODP、ODS、RTF、HTML、EPUB | OfficeParser 提取 Markdown；文本层为空时可尝试 OCR |
| 图片 | PNG、JPG/JPEG、GIF、BMP、TIFF、WebP | 本地 OCR，默认 `chi_sim+eng`，记录完成/空结果/失败状态 |
| 文本与代码 | TXT、MD、CSV、TSV、JSON、XML、常见代码文件 | 直接读取；代码保留原文，可额外请求 DSH 生成可追溯语义说明 |

单个文档默认上限 50 MB；直接文本读取上限 2 MB。图片 OCR 是文本提取，不代表已经实现多模态图像向量检索。

## RAG 与 Embedding

```text
授权材料 → 解析 / OCR → 带来源的文本分块
→ Embedding 索引 + 关键词索引 → 稠密/关键词两路召回
→ RRF 融合 → 片段、来源、定位 → 证据绑定或候选生成
```

默认是本地 192 维 Hash 向量：零密钥、零网络、零模型费用，但语义能力有限。管理员可预置语义 Embedding Profile；用户只能选择 Profile，项目和页面均不保存 API Key。

内置中文语义 Profile：`dashscope-text-embedding-v4`，使用 `text-embedding-v4`、1024 维、OpenAI-compatible 协议。管理员配置：

```powershell
[Environment]::SetEnvironmentVariable('DASHSCOPE_API_KEY', '你的新密钥', 'User')
[Environment]::SetEnvironmentVariable('DASHSCOPE_COMPATIBLE_BASE_URL', 'https://<你的地址>/compatible-mode/v1', 'User')
```

完全退出并重启 DSH 后，用户可说：

```text
列出可用 embedding 模型，并说明材料数据边界。
为当前项目选择百炼中文语义检索模型 text-embedding-v4。我确认已授权材料文本可发送至该服务。
我确认按此配置重建材料索引。
```

Profile 变更会将旧索引标为 `stale`，需要单独确认重建；远程模型不可用时会显示降级或失败状态，而不应伪称语义检索成功。

## 在线文献扩充与引用

在线书目通过自然语言触发，当前支持 OpenAlex 和 Crossref：

```text
检索 2020 年至今与“FMCW 雷达 微波 水分测量”相关的文献，
使用 OpenAlex 和 Crossref，各返回最多 10 条；先只展示候选，不写入项目。
```

选择候选后：

```text
将第 1、3、5 条候选加入当前项目书目库。我确认只保存书目元数据，不下载全文。
```

可选全文流程：

```text
展示第 1 条的 HTTPS 全文链接和文件信息；我确认下载并导入该全文作为项目材料。
```

- 搜索结果不会自动写入项目；书目入库、全文下载和本地全文导入均需确认；
- 书目绑定可关联正文块，但**不替代原文证据绑定**；
- 仅导入的全文或用户明确授权的本地材料进入 RAG；
- HTTPS 下载限制为 50 MB；用户需自行确认来源、许可和使用权，系统不会绕过付费墙或访问控制。

## 模板导入与受控重构

模板与事实材料隔离，不进入 RAG 证据库。支持 Markdown、TXT、HTML、DOCX：

```text
导入 C:\路径\论文模板.docx 作为当前项目模板；只用作结构和写作风格参考，不作为事实证据。
基于该模板生成当前项目大纲的重构差异预览，但不要应用。
```

用户确认后才应用。Runtime 会校验领域 Framework；例如专利模板不能删除技术领域、背景技术、发明内容、具体实施方式和权利要求书等必需章节。预览过期或结构非法时会拒绝写入。

## 工作流、版本与可靠性

### 两类状态机

`design → write → review` 是会话治理阶段：

- `design`：分析需求、生成/验证/安装领域插件、选择或创建项目；
- `write`：材料、检索、书目、模板、大纲、正文、快照和导出；
- `review`：查看证据、版本和审查建议，不直接改写正文。

每个领域任务还有独立运行状态机。Framework 用声明式 `stateTable` 定义“状态 + 事件 → 下一状态”；Core 返回合法事件与 `recommendedNextEvent`，支持跳步、预算上限、检查点与取消。

### 保护机制

- 显式确认：阶段转换、目录导入、插件生成/安装、书目、全文、模板、归档与恢复；
- revision 乐观锁：旧写入不能静默覆盖新版本；
- 幂等键与步骤预算：重试不重复推进，异常循环有上限；
- 快照、块级 diff 与恢复；
- SQLite WAL 事务、版本检查与可恢复备份；
- 最多 10 个活跃项目，创建第 11 个前需确认归档最早项目；
- Embedding 密钥仅由环境变量提供，项目 JSON 和页面不保存密钥。

## 自定义技术报告等任务台

```text
为“微波水分测量技术报告”设计工作台。
需要项目概述、技术原理、实验方案、结果分析、风险与局限、结论与建议；
支持文献引用和 Markdown 导出。请先生成 Plugin Spec，不要生成或安装插件。
```

确认规格后，助手依次请求确认输出目录、生成并验证插件包、确认安装，再创建相应项目。

| 契约 | 职责 |
| --- | --- |
| Framework | 文本结构、领域字段 Schema、大纲校验、状态表、UI 标签 |
| Logic | 分块写作目标、衔接、风格维度、重写建议 |
| Evidence | 引文格式、参考文献、证据充分性评价 |
| Material | 支持类型、归一化、材料角色与分析建议 |

Windows 安装时，生成器会为目标 DSH Profile 建立 Core 依赖桥接；不要手动复制 `dsh-workbench-core` 到生成插件目录。

## 工作台页面

说“打开工作台”即可打开当前绑定项目；没有绑定项目时打开首页。页面与 DSH 对话共享同一 Runtime 和持久化数据，可查看项目、材料、正文、证据、版本和运行记录。

页面可发起“让 DSH 重写选中文本”或审查请求；它只向当前 DSH 会话回传结构化意图，不保存模型密钥，也不直接调用模型。

## 面向开发者

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| 自然语言预设 | `agent.cordis.yml`、`skills/text-workbench/` | 确认协议、阶段编排、恢复、目录导入提示 |
| Runtime | `../workbench-core/src/core/runtime.js` | 项目、材料、索引、书目、模板、版本、运行状态 |
| 文档服务 | `../workbench-core/src/services/document-service.js` | Office/PDF 解析与 OCR 调度 |
| 检索服务 | `../workbench-core/src/services/retrieval-service.js` | 分块、Embedding Provider、关键词/稠密召回与 RRF |
| 书目服务 | `../workbench-core/src/services/literature-service.js` | OpenAlex/Crossref、规范化与去重 |
| 插件生成器 | `../workbench-core/src/generator.js` | Plugin Spec、隔离生成、验证、安装与 Core 桥接 |
| 操作台 | `../workbench-core/src/core/workbench-server.js` | localhost API、页面与 DSH 回传 |

技术栈：Node.js、JavaScript ESM、DSH、Cordis Patch、YAML Persona/Skill、JSON Schema、可配置状态机、SQLite（WAL、事务、实体表）、OfficeParser、可选 Tesseract OCR、OpenAI-compatible Embedding、Hash fallback、RRF、OpenAlex/Crossref、原生 HTTP 页面与 `node:test`。

### 本地验证

```powershell
cd D:\雷达毕设相关\high_star\text-workbench-assistant
npm.cmd run check

cd ..\workbench-core
npm.cmd run check
npm.cmd test
```

当前测试覆盖项目生命周期、领域状态机、材料和批量目录导入、检索、Embedding Profile、书目、模板重构、版本恢复、插件生成和工具暴露。

## 当前边界

- 当前目标是多格式资料的**文本解析与向量化**，不是完整的多模态图像向量检索；
- 代码文件可按文本导入并生成语义说明，当前没有基于 AST 的代码理解；
- OCR 质量依赖图片清晰度、语言包和本机资源；失败会被记录，不会伪装为可用文本；
- 在线书目是候选元数据，不等同于学术事实、法律结论或完整全文；
- 最终论文、专利与技术结论仍须由用户或领域专家复核。
