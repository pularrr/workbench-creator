# 多格式资料与代码仓 RAG 优化开发计划

> **实施状态图例**：✅ 已完成并有自动化测试；🟡 已完成基础版，仍有明确缺口；⏳ 未开始或仅有计划，不能作为当前功能验收通过项。

## 当前实施状态与必须完成项

### 已完成

| 能力 | 状态 | 当前交付 |
| --- | --- | --- |
| Hash 默认降级 | ✅ | 无模型、无 Key 或模型调用失败时，本地 hash 检索仍可用 |
| OpenAI-compatible embedding | ✅ | 批量、超时、429/5xx 重试、维度校验；已用 `text-embedding-v4` 1024 维完成真实连通与检索验证 |
| 管理员 profile + 用户确认选择 | ✅ | `offline-hash` 与 `dashscope-text-embedding-v4`；`wb_list_embedding_profiles`、`wb_configure_retrieval`、`wb_reindex_materials` 均受确认保护 |
| 中文结构化文本切块 | ✅ | 标题边界、行号、标题路径、内容 SHA-256 |
| 混合检索 | ✅ | 关键词 Top-N + dense Top-N + RRF，返回各路排名和 fallback 状态 |
| 索引基础元数据 | ✅ | provider、模型、维度、配置指纹、索引状态、块数、重建入口 |
| 图片 OCR 基础链路 | ✅ | `tesseract.js` 中文+英文图片 OCR；OCR 文本进入既有 RAG；失败状态可见 |

### 已完成基础版，仍需补强

| 能力 | 状态 | 已有内容 | **必须补强** |
| --- | --- | --- | --- |
| 多格式解析 | 🟡 | TXT/Markdown/HTML、PDF、DOCX、PPTX、XLSX 等文本提取 | PDF 页码、PPT 对象、表格单元格等精确 locator；扫描 PDF 的页级 OCR 质量与资源限制 |
| 索引版本化 | 🟡 | `ready/stale/fallback`、配置指纹与重建 | 双索引原子切换、旧索引持续服务、迁移审计、增量重建 |
| OCR | 🟡 | 图片 OCR、无文本层 Office/PDF 的 OCR 尝试 | 页数/像素/总时长预算、离线语言包部署检查、置信度与 OCR 区域定位 |
| 检索可解释性 | 🟡 | keyword/dense rank、RRF 分数、fallback 原因 | 持久化 RetrievalTrace、质量仪表盘、阈值策略与人工标注评测集 |

### **未完成：后续开发的优先级**

1. **P0 专利类型创建修复**：`patentType` 尚未影响自动大纲；先修复创建参数、`outlineProfile` 和实用新型字数缩放。
2. **L0–L3 在线文献扩充**：当前没有 `wb_search_literature`、书目去重、用户确认、全文选择/下载、引用书目写入功能。
3. **T0–T4 UI 模板功能**：当前没有 UI 模板导入、模板预览、勾选重构、LLM diff 与确认应用功能。
4. **代码语义双文本 RAG**：当前代码文件只能按普通文本导入；`CodeSemanticInterpreter` 与“原代码 + LLM 语义说明”尚未实现。
5. **本地/私有模型、BGE-M3、E5**：当前只有 hash 与 OpenAI-compatible provider；Ollama 原生、E5 前缀策略、BGE-M3 sparse 能力尚未实现。
6. **可选 rerank 与本地向量索引**：当前没有 RerankProvider、HNSW 或 SQLite-vec。
7. **多模态图像向量**：当前只做 OCR；尚未对图表、流程图、架构图建立视觉向量索引。
8. **内置 tech-report 插件**：当前内置任务类型为 thesis 与 patent；技术报告插件需要生成/安装或单独开发。

## 1. 目标与边界

本计划为 `dsh-workbench-core` 建立面向写作、审查和证据绑定的多格式资料 RAG 能力。目标是让论文、专利、合同、技术报告等项目能够从用户明确授权的资料中，稳定检索到**可定位、可解释、可绑定**的证据片段。

支持范围以文件内容为中心：

- 纯文本与结构化文本：`txt`、`md`、`csv`、`tsv`、`json`、`xml`、`html`；
- Office 与电子文档：`pdf`、`docx`、`pptx`、`xlsx`、`odt`、`odp`、`ods`、`rtf`、`epub`；
- 图片：`png`、`jpg/jpeg`、`webp`、`gif`、`bmp`、`tiff`，通过 OCR 提取其中的文字；
- 代码仓：用户明确选择仓库根目录后，按允许的文本文件清单读取 `js`、`ts`、`py` 等源文件；保留原始代码文本，同时由 LLM 生成**语义说明文本**，两种文本共同建立可追溯索引。语义说明用于回答“这个模块做什么、输入输出是什么、与哪些文件协作”，原始代码用于精确术语、符号和行号证据。

明确不做：

- 未经用户授权的目录扫描、代码仓克隆或文件读取；
- AST、编译器级符号索引、静态调用图和依赖图；本计划的代码理解来自受约束的 LLM 语义翻译，而不是把猜测当作程序事实；
- 自动把检索内容直接写入正文；
- 在项目状态、日志、快照或导出物中保存模型密钥。

## 2. 当前基础与问题

当前 Core 已有最小材料检索链路：

```text
用户选择文件或明确授权的代码仓根目录
  → 文本提取（代码同时进入语义翻译队列）
  → 固定字符分块（1200 字符，120 重叠）
  → 192 维 hash embedding
  → 关键词 + hash 向量余弦加权
  → Top-K 片段
  → 绑定到正文块作为证据
```

它具备离线、零成本和可追溯优点，但存在以下限制：

| 环节 | 当前状态 | 优化方向 |
| --- | --- | --- |
| 文件解析 | Office/PDF 可提取文本；默认图片仅记录元数据；代码无语义说明 | 统一解析结果，接入 OCR、保留页码/标题/表格/代码行号；代码生成受约束语义说明 |
| 分块 | 按行累积的字符切块 | 中文标题/段落/token 优先，支持预览和版本化 |
| 向量 | 固定哈希向量，不具备真正语义理解 | 可注入 OpenAI、本地 BGE-M3/E5、私有模型；默认 hash 回退 |
| 检索 | 单次全量扫描，固定 0.45/0.55 加权 | 关键词与 dense 双路召回、RRF、阈值、可选 rerank |
| 索引 | 数据保存在项目 JSON | 小资料保持零依赖；规模上升后可选本地向量索引 |
| 可解释性 | 仅返回 `relevance` | 返回来源、定位、关键词/dense/fusion/rerank 分数与降级状态 |

## 3. 最终使用体验

```text
导入授权资料或用户选定的代码仓
  → 解析为有来源定位的 DocumentSegment；代码保留 raw segment
  → 为代码块生成可审计的 SemanticSegment，并关联 raw segment
  → 预览与确认分块
  → 依据选定 Embedding Profile 建立版本化索引
  → 检索：关键词 Top-N + dense Top-N
  → RRF 融合，必要时 rerank
  → 返回证据片段、位置、评分与降级状态
  → 用户/Agent 绑定证据后再参与写作或审查
```

用户可在工作台中：

1. 选择文件并确认导入；
2. 查看解析状态、页数、OCR 状态、代码语义翻译状态与分块预览；
3. 选择已配置的检索 profile，例如“离线基础”“OpenAI 经济型”“本地中文模型”；
4. 确认后发起可恢复的索引构建；
5. 检索时查看每条证据来自哪个文件、页码/标题/行号、各类评分和是否发生 fallback；
6. 将一条证据绑定到正文块，或在审查阶段查看证据完整性。

## 4. 设计原则

### 4.1 默认可离线、可降级

`HashEmbeddingProvider` 始终内置。没有模型、密钥、网络或本地推理服务时，系统仍执行关键词 + hash 检索，并明确显示“离线基础检索”；不能把它表述为语义模型检索。

### 4.2 模型、分块与索引相互独立

改变 embedding 模型、维数、归一化方式、chunker 或分块参数，都会产生新索引版本。旧索引保留可查询，直到新索引构建成功、抽样校验通过并被激活。禁止混合不同模型生成的向量。

### 4.3 文件内容始终可回溯

每个片段必须保存材料 ID、内容哈希与 locator。locator 根据文件能力记录页码、幻灯片页、工作表/单元格范围、标题路径、段落序号或行区间；没有真实定位信息时显式为空，禁止伪造。

代码的语义说明不是原文证据的替代品。每条说明必须记录所依据的原始块 ID、原文哈希、生成模型、提示词版本和生成时间；展示或绑定代码证据时必须能一键回到原始文件和行区间。LLM 无法确认的关系必须标注“推测/待验证”，不得伪造成调用关系事实。

### 4.4 人在回路

导入、修改检索 profile、开始重建索引、恢复旧索引和绑定正文证据均属于受控操作。RAG 只提供候选证据，不直接替用户或模型修改正文。

## 5. 核心契约

### 5.1 Embedding Provider

```ts
interface EmbeddingProvider {
  id: string
  model: string
  dimensions: number
  normalized: boolean
  embedDocuments(texts: readonly string[]): Promise<number[][]>
  embedQuery(query: string): Promise<number[]>
}
```

Provider 类型：

| Provider | 适用情形 | 默认状态 |
| --- | --- | --- |
| `hash` | 离线、零成本、没有模型配置 | 始终可用的默认回退 |
| `openai` | 可访问云 API，希望低运维与按量计费 | 可选；优先支持 `text-embedding-3-small` |
| `openai-compatible` | 企业网关或兼容 Embeddings API 的服务 | 可选 |
| `ollama` | 本地推理、材料不出网 | 可选 |
| `private-http` | 已部署且协议固定的私有模型服务 | 可选 |

BGE-M3、multilingual-E5 等是模型 profile，不应成为 Runtime 中的硬编码业务分支。E5 profile 统一处理 `passage: ` 与 `query: ` 前缀；BGE-M3 profile 明确声明只用 dense，还是未来可提供 dense + sparse 能力。

当前实现通过 DSH 插件配置显式启用语义 embedding；默认仍是 `hash`，不会仅因检测到环境变量而外发材料。密钥只保存在环境变量中：

```yaml
retrieval:
  embedding:
    type: openai-compatible
    endpoint: https://your-workspace.example/compatible-mode/v1
    model: text-embedding-v4
    dimensions: 1024
    apiKeyEnv: DASHSCOPE_API_KEY
    timeoutMs: 30000
    maxRetries: 2
```

除 `offline-hash` 外，系统还内置 `dashscope-text-embedding-v4` profile。管理员只需设置 `DASHSCOPE_API_KEY`；若使用百炼业务空间专属域名，可额外设置非敏感的 `DASHSCOPE_COMPATIBLE_BASE_URL`，无需让用户接触 endpoint 或密钥。用户通过自然语言请求后，由 DSH 调用 profile 列表、展示数据边界并要求确认。

导入或重建时，服务以批次请求向量；网络、鉴权、限流、服务端错误或响应维度异常均会让该批回退到本地 hash，并把原因写入不含密钥的块元数据。只有用户确认执行 `wb_reindex_materials` 后才会将既有材料重新发送给已配置 provider。

### 5.2 Chunker

```ts
interface Chunker {
  id: string
  version: string
  chunk(segments: readonly DocumentSegment[], options: ChunkOptions): SourceChunk[]
}
```

- `fixed-text-v1`：保留当前字符分块，作为历史项目兼容和降级路径；
- `structured-text-v1`：先按标题、空段、中文句末边界切分，再按 token 上限拆分；标题不会和其首段分离；
- 不同文件类型仅影响 `DocumentSegment` 的 locator 与结构信息，不改变“所有内容最终统一为可检索文本片段”的原则。

### 5.3 Code Semantic Interpreter

```ts
interface CodeSemanticInterpreter {
  id: string
  model: string
  promptVersion: string
  describe(input: {
    languageHint?: string
    path: string
    rawChunks: readonly SourceChunk[]
  }): Promise<SemanticSegment[]>
}
```

`SemanticSegment` 是可检索的中文/自然语言说明，而非对代码的改写或覆盖。首期按文件或逻辑块生成：职责摘要、主要输入/输出、关键数据结构、可见副作用、配置项、显式导入/导出名称，以及“仅据当前片段无法确认”的事项。输入必须带路径和相邻块上下文；输出必须是受 JSON Schema 约束的结构，再渲染成语义文本。原代码永不由 LLM 改写后覆盖。

### 5.4 检索与索引

```ts
interface RetrievalIndex {
  build(chunks: readonly SourceChunk[], version: IndexVersion): Promise<void>
  query(vector: readonly number[], limit: number, version: string): Promise<DenseHit[]>
  validate(version: string): Promise<IndexValidation>
  activate(version: string): Promise<void>
}
```

首期用 `JsonScanIndex` 全量扫描，保持本地零服务依赖；源块数超过配置阈值后，才可选启用 HNSW 或 SQLite-vec。无论底层索引如何，最终都要返回原始材料定位和可解释分数。

## 6. 数据模型与配置

项目中新增：

```json
{
  "retrievalConfig": {
    "chunkerId": "structured-text-v1",
    "chunkerVersion": "1",
    "embeddingProfileId": "offline-hash",
    "fusion": {
      "method": "rrf",
      "rrfK": 60,
      "keywordTopN": 30,
      "denseTopN": 30
    },
    "rerank": {
      "enabled": false,
      "candidateLimit": 30,
      "timeoutMs": 3000
    },
    "codeSemantics": {
      "enabled": true,
      "profileId": "code-semantic-llm",
      "promptVersion": "code-summary-v1",
      "maxFilesPerRun": 100,
      "maxCharsPerFile": 24000
    }
  },
  "retrievalIndex": {
    "activeVersion": "idx-...",
    "state": "ready | building | stale | failed | fallback",
    "configFingerprint": "sha256:...",
    "sourceRevision": 12,
    "chunkCount": 86,
    "updatedAt": "..."
  }
}
```

Embedding profile 由宿主级配置管理，项目只保存 profile ID 与不含密钥的配置指纹。`credentialRef` 只可引用环境变量或受控密钥存储，不能由材料、对话文本或网页表单直接提供。

每个块至少保存：

```json
{
  "materialId": "material-uuid",
  "content": "可检索文本",
  "contentSha256": "sha256:...",
  "locator": {
    "page": 4,
    "slide": null,
    "sheet": null,
    "headingPath": ["第三章", "3.2 方法"],
    "startLine": 18,
    "endLine": 42
  },
  "chunkerId": "structured-text-v1",
  "indexVersion": "idx-...",
  "embeddingMeta": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "normalized": true
  }
}
```

代码块额外保存原文与语义说明之间的关联，而不是把二者混成同一段内容：

```json
{
  "kind": "raw-code | code-semantic",
  "path": "src/services/retrieval-service.js",
  "language": "javascript",
  "rawChunkIds": ["code-raw-001", "code-raw-002"],
  "semanticText": "该模块负责……；无法仅依据当前文件确认……",
  "semanticMeta": {
    "interpreter": "openai-compatible",
    "model": "...",
    "promptVersion": "code-summary-v1",
    "sourceContentSha256": ["sha256:..."],
    "generatedAt": "...",
    "status": "ready | stale | failed | skipped"
  }
}
```

原始代码变更、解释器模型或提示词版本变更后，关联语义说明立即标记为 `stale`；在重新生成前，检索可以继续使用原始代码和其他资料，但不能把过期说明标为当前解释。

## 7. 分格式解析策略

| 类型 | 首期解析策略 | 必须保留的定位 | 后续增强 |
| --- | --- | --- | --- |
| `txt/md/html/json/xml` | UTF-8 文本读取 | 行区间、Markdown 标题路径 | 编码识别、JSON 字段路径 |
| 用户选定代码仓中的 `js/ts/py/...` | 路径过滤后读取为 raw code chunk；LLM 将 raw chunk 与有限上下文翻译为 `code-semantic` 文本 | 仓内相对路径、行区间、原始块哈希、语义生成版本 | 目录级摘要、变更增量解释；仍不依赖 AST |
| `pdf` | 文本层提取；无文本层时进入 OCR | 页码、段落顺序 | 版面区块、表格、图片说明 |
| `docx/odt/rtf` | Office 解析为结构化文本/Markdown | 标题、段落序号 | 页码与批注映射（解析器可提供时） |
| `pptx/odp` | 提取幻灯片文本与备注 | 幻灯片页码、对象顺序 | 图片 OCR、演讲者备注优先级 |
| `xlsx/ods/csv/tsv` | 按工作表、表头与行组生成文本块 | 工作表、单元格范围、表头 | 行列语义、公式解释 |
| 图片 | OCR 提取中文与英文文字 | 图片文件名、OCR 区域/页码 | 版面与图片描述模型 |

OCR 首期需支持中文和英文；OCR 失败不能静默生成空证据，应返回“未提取到文本/需要更清晰文件”的状态。大文件、扫描 PDF、图片 OCR 都必须受页数、像素、总字数、执行时间与重试次数上限约束。

当前 Core 已接入本地 `tesseract.js` OCR：图片导入默认以 `chi_sim+eng` 识别；PDF/Office 文档先提取原有文本层，只有文本层为空时才触发 OCR。识别文字与 `ocr_completed` 状态会进入既有分块和检索链路；空结果、超时、语言包不可用或识别失败会保留 `ocr_empty` / `ocr_failed` 状态，绝不生成伪造文本。首次使用且未提供本地 `langPath` 时，Tesseract 可能下载语言数据；需要完全离线时，应在插件配置中设置已部署语言包目录。

## 8. 检索策略

### 8.1 双路召回

```text
Query
  ├─ KeywordRetriever → raw text / raw code keyword Top-N
  └─ DenseRetriever   → document text / code semantic text Top-N
                   ↓
              RRF 融合
                   ↓
         可选 Rerank Top 20--50
                   ↓
    证据、定位、各路得分、fallback 状态
```

- `KeywordRetriever`：中文 token、术语、数字、缩写和精确名称命中；尤其适合专利号、参数、公式变量和合同条款编号；
- `DenseRetriever`：解决同义表达、跨语言术语和自然语言问法；仅查询与 active index 配置相同的向量；
- 对代码仓问题，先检索语义说明以理解“职责、流程、影响范围”，再展开其关联的 raw code chunk；若查询含文件名、函数名、配置键、报错文本或行号，关键词通道必须保留原始代码候选。最终答案引用代码时以 raw code 的路径和行区间为准，语义说明只作为解释层；
- `RRF`：默认 `score += 1 / (60 + rank)`，避免不同模型分数尺度不一致；
- `Rerank`：默认关闭。仅在融合后的有限候选集合上执行，超时或失败直接回退 RRF；
- `fallback`：dense 不可用、索引未完成或配置不匹配时，继续关键词 + hash，并将状态告知用户与 Agent。

### 8.2 任务类型参数

- 论文：更高 dense Top-N，重视概念性问法与跨语种文献；
- 专利：保留更高关键词候选，优先精确技术术语、权利要求编号和现有技术标识；
- 合同：提高条款号、当事方、金额、日期和定义术语的关键词权重；
- 技术报告：平衡参数、图表、实验结论与叙述性资料。

任务类型只能覆盖 Top-N、阈值和候选数，不可绕过材料授权、项目绑定、阶段权限和证据绑定。

## 9. 低成本中文方案

### 9.1 推荐默认决策

| 环境 | 推荐 profile | 成本与限制 |
| --- | --- | --- |
| 无网络、演示、小资料 | `offline-hash` | 零成本；不是语义检索 |
| 有云 API、希望最低运维 | `openai-small` → `text-embedding-3-small` | 按量付费；用真实中文评测验证效果 |
| 隐私优先、可运行本地模型 | `ollama-e5` 或私有 E5 服务 | 无 API 单价；需要本地内存/算力 |
| 较大中文资料集、有 GPU | `local-bge-m3` 或私有 BGE-M3 服务 | 更高资源需求；可作为 dense+sparse 升级候选 |

`text-embedding-3-large`、更大本地模型或 reranker 不是默认选项。只有当中文离线基准显示召回/证据质量提升足以覆盖成本与延迟时才启用。

### 9.2 成本控制

- 用内容 SHA-256 去重：未改变的块不再编码；
- 批量提交 embedding 请求；
- 限制单文件大小、OCR 页数、token 数、每项目索引配额；
- 检索 query 向量短期缓存，材料变更只重建受影响索引版本；
- 重建以可恢复 run 执行，使用 checkpoint 与 idempotency key，避免中断后重复计费；
- rerank 默认关闭，且严格限制候选数和超时；
- 在 UI 显示 profile、索引规模、上次构建耗时、fallback 原因和可能成本。

## 10. 分阶段实施计划

### Phase 0：建立回归基线 ✅

**改动**：为现有 hash、固定分块、关键词与混合分数补齐单元测试，制作包含中文论文、专利、合同、扫描 PDF、PPT 与表格的脱敏测试夹具。

**验收**：记录现有 Recall@5/10、MRR、P95 延迟、索引耗时和内存占用；后续每一阶段均与此基线比较。

### Phase 1：Provider 抽象，保持默认行为不变 ✅

**改动**：新增 `src/retrieval/contracts.js`、`providers/hash.js`、`service.js`；将现有 `localEmbedding()` 包装为 `HashEmbeddingProvider`，把 Runtime 的导入与查询接入 `RetrievalService`。

**验收**：无模型配置时输出、排序和旧项目行为与当前版本一致；结果中可见 `provider=hash`；没有网络请求。

### Phase 2：索引版本与安全迁移 🟡

**改动**：升级存储 schema；给项目和块添加 `retrievalConfig`、`retrievalIndex`、embedding metadata、config fingerprint；增加旧 JSON 迁移、索引状态机和审计。

**验收**：旧项目无需重建即可使用 hash；新索引失败时旧索引持续可查询；更换模型、维度或 chunker 时不会混检；迁移不阻塞项目打开。

### Phase 3：OpenAI-compatible 语义 embedding ✅

**改动**：新增 `providers/openai.js`，使用 Node `fetch` 调用 Embeddings API；支持批量、输入上限、超时、429/5xx 有界重试、响应维度校验和 hash fallback。

**验收**：mock server 覆盖批量排序、401、429、超时、错误响应、维度错配与密钥脱敏；没有 `credentialRef` 时绝不发网络请求。

### Phase 4：本地与私有模型 ⏳

**改动**：新增 Ollama 和 strict-schema private HTTP provider；将 BGE-M3、E5 定义为 profile；E5 注入 `passage:` / `query:` 前缀。

**验收**：本地 provider 无法启动时不自动外发资料；私有协议必须通过 Schema 校验；相同 profile 的文档与查询维度一致。

### Phase 5：中文结构化分块与多格式定位 🟡

**改动**：新增 `DocumentSegment` 和 `StructuredTextChunker`；解析器输出页码、标题、幻灯片、工作表、表头、段落与 OCR 状态；工作台增加分块预览。

**验收**：中文编号标题、跨段长句、中英混排、PPT、表格、扫描 PDF 和图片 OCR 均有可回溯 locator；切块不丢文本、不制造不存在的页码。

### Phase 6：代码仓的 LLM 语义翻译与双文本存储 ⏳

**改动**：新增 `CodeSemanticInterpreter`、JSON Schema、`code-summary-v1` 提示词和受确认的代码仓导入任务；按忽略规则、文件数、单文件大小和总字符数限制读取代码。先持久化 raw code chunk，再异步生成关联的 `code-semantic` chunk；按内容哈希实现增量重译，并提供失败、跳过和过期状态。

**验收**：每条代码语义说明都能回溯到原始路径、行区间和哈希；原始代码永不被覆盖；模型输出不符合 schema、超时或成本超限时，代码仍可作为文本检索；修改一个文件只使其对应说明失效。使用人工标注的仓内问答检查“模块职责/配置含义/数据流”解释是否忠实原文，并记录无依据断言率。

### Phase 7：双路召回与 RRF ✅

**改动**：新增 `KeywordRetriever`、`DenseRetriever`、`fusion.js` 与脱敏 `RetrievalTrace`；从固定加权迁移到双路 Top-N + RRF。

**验收**：精确术语、同义表达、中英缩写三类查询均覆盖；dense 不可用时显式降级；结果可以解释各路排名和分数。

### Phase 8：可选 rerank 与本地索引 ⏳

**改动**：新增 `RerankProvider` 与可选 `LocalVectorIndex`；小资料继续 JSON scan，大资料按阈值后台构建 HNSW/SQLite-vec。

**验收**：rerank 默认关闭且失败不阻断结果；索引构建/切换期间旧索引在线；ANN 召回与 JSON 精确扫描基线在设定容差内。

## 11. 工具与工作台改造

新增受工作阶段保护的工具：

```text
wb_list_embedding_profiles
wb_get_retrieval_status
wb_configure_retrieval        # 只选管理员预置 profile；write 阶段，需 userConfirmed
wb_preview_chunks
wb_preview_code_semantics    # 显示解释与原始代码的关联、过期状态
wb_reindex_materials          # 创建可恢复 run
wb_get_retrieval_trace        # 脱敏信息
```

阶段限制：

| 阶段 | 可做 | 不可做 |
| --- | --- | --- |
| `design` | 查看可用任务台能力 | 导入材料、配置模型、构建索引 |
| `write` | 导入文件/确认代码仓、预览分块与代码说明、选择 profile、重建、检索与证据绑定 | 读取未授权文件、绕过确认 |
| `review` | 查看证据、检索结果和 trace | 改 profile、重建索引、修改正文 |

## 12. RAGFlow 的可吸收思想

本计划借鉴本地 RAGFlow 项目的工程思想，但不复制其多引擎与多服务部署：

| 借鉴点 | 本项目落地方式 |
| --- | --- |
| 文档/查询分开编码、批处理、token 截断 | `EmbeddingProvider.embedDocuments()` / `embedQuery()`；统一批处理、限额、重试和维度校验 |
| token、标题和模板化分块，保留定位 | `StructuredTextChunker` 与 `DocumentSegment`；优先实现写作资料常见格式 |
| 全文与向量双路召回 | Keyword Top-N + Dense Top-N，不依赖单一路径 |
| 候选窗口、阈值和可选 rerank | RRF 后的有限候选才 rerank，默认关闭 |
| 检索可观测性与基准评测 | RetrievalTrace、中文问题—证据集、质量/成本/延迟报告 |
| 可扩展索引后端 | 从 JSON scan 到可选 HNSW/SQLite-vec，不直接引入 Elasticsearch/Infinity 集群 |

对于代码仓，本计划不引入 RAGFlow 式的 AST/解析器驱动代码知识图谱；采用更轻量的“原始代码 + 受约束 LLM 语义说明”双文本策略。它保留 RAGFlow 的批处理、分块、可观测与检索融合思想，同时避免为当前工作台引入语言解析器矩阵和复杂的多服务依赖。

## 13. 评测与发布门禁

### 13.1 测试集

建立脱敏中文评测集，覆盖：

- 论文中的理论、方法、实验结论和引用问题；
- 专利中的技术术语、权利要求编号与现有技术；
- 合同中的条款、金额、日期和定义；
- PDF 文本层、扫描 PDF、PPT、DOCX、表格和图片 OCR；
- `.js`、`.ts`、`.py` 小型代码仓：模块职责、配置含义、数据流、文件定位和精确符号查询；每个语义问答均标注可支持它的 raw code 行区间。

每个查询标注至少一个支持它的证据片段和 locator。

### 13.2 指标

- 检索：Recall@5、Recall@10、MRR、nDCG@10；
- 证据：定位正确率、证据支持率、错误绑定率、无证据回答率；
- 文件解析：提取成功率、OCR 空结果率、locator 完整率；
- 代码语义：原文可回溯率、说明过期识别率、无依据断言率、语义检索召回率与 raw code 定位正确率；
- 工程：索引时长、P50/P95 延迟、千次查询成本、索引体积、失败率；
- 安全：密钥不落盘、模型失败可见、不同索引版本不混检。

### 13.3 合并门禁

每一次替换模型、修改 chunker 或调整融合参数，必须提交：

1. 固定评测集上的 baseline 对比；
2. 质量、延迟、成本的变化说明；
3. fallback、迁移和回退测试；
4. 无真实密钥的 provider mock 测试；
5. 对隐私、文件授权和日志脱敏的检查结果。

## 14. 推荐提交顺序

1. `test(retrieval): establish multilingual document retrieval baseline`
2. `refactor(retrieval): introduce provider and chunker contracts with hash fallback`
3. `feat(retrieval): version project indexes and migrate legacy hash chunks`
4. `feat(retrieval): add OpenAI-compatible embedding provider`
5. `feat(retrieval): add Ollama and private embedding providers`
6. `feat(parser): normalize multi-format segments and OCR status`
7. `feat(retrieval): add Chinese structured chunking and preview`
8. `feat(code-rag): preserve raw code and generate schema-validated semantic segments`
9. `feat(retrieval): add keyword+dense RRF retrieval and trace`
10. `feat(retrieval): add optional reranking and local vector index`
11. `test(retrieval): enforce Chinese multi-format and code-semantic quality gates`

每一步都应独立可测试、可回退。只有上一阶段的质量、成本、延迟和可靠性门禁通过后，才进入下一阶段。

## 15. 在线文献扩充开发计划

### 15.1 范围与边界

在线文献扩充的目标是补足用户项目已有资料中缺失的**可核验书目信息与候选来源**，供论文背景、相关工作、专利背景技术和技术报告背景章节使用；它不是自动下载全文、自动写入正文或自动伪造引用的功能。

- 首期开放元数据源：`OpenAlex`（作品检索、主题/年份/开放获取等筛选）与 `Crossref`（DOI 与书目信息核验）；
- 专利源：实现独立 `PatentSearchProvider`，仅在用户或组织已配置合法 API 凭证、数据范围与配额后启用；不能抓取受限制网站或绕过访问控制；
- 中文商业数据库、学校图书馆和机构订阅资源均采用“官方 API / 导出文件 / 用户导入”适配器；未授权时不自动爬取；
- 默认只保存必要元数据、检索时间、来源 URL/ID 和用户确认状态；摘要、全文、PDF 必须分别遵守来源许可和用户导入确认；
- 检索结果只是候选。只有用户确认“加入项目”后才能进入 `literature`；只有有可回溯原文、摘要或导入材料支撑的内容才能绑定到正文。

### 15.2 用户体验与工具流

```text
用户：为“微波水分测量研究背景”补充近五年英文文献
  → DSH 将自然语言转换为可预览的关键词、年份、语种、文献类型和数据源
  → wb_search_literature 返回候选及来源、DOI、年份、作者、置信/去重信息
  → 用户勾选并确认
  → wb_add_literature 写入项目书目库（不写正文）
  → 用户明确选择“仅保存书目”/“下载开放全文”/“从本机导入全文”
  → 仅在后两者确认且来源许可允许时，全文进入材料 RAG
  → wb_bind_literature / wb_bind_evidence 关联到背景段落
  → Evidence plugin 按项目类型生成引用格式并在 review 阶段检查缺失引用
```

新增工具应遵循阶段限制：

| 工具 | 阶段 | 作用 |
| --- | --- | --- |
| `wb_search_literature` | `write` | 只读查询开放或已授权数据源，返回候选，不写项目 |
| `wb_preview_literature` | `write` / `review` | 查看候选、重复项、来源和字段完整性 |
| `wb_add_literature` | `write`，需 `userConfirmed` | 将用户选定候选加入项目书目库 |
| `wb_choose_fulltext_action` | `write`，需 `userConfirmed` | 为每条已确认书目选择 `metadata_only`、`download_open_access` 或 `import_local_file` |
| `wb_import_literature_fulltext` | `write`，需用户选择文件与确认 | 将有授权的本地全文送入材料 RAG |
| `wb_bind_literature` | `write` | 把已核验书目关联到正文块，不能替代原文证据 |
| `wb_get_literature_trace` | `review` | 查看查询、来源、去重、确认和引用追踪信息 |

### 15.3 核心接口与数据模型

```ts
interface LiteratureSearchProvider {
  id: string
  search(input: {
    query: string
    yearFrom?: number
    yearTo?: number
    language?: string
    workTypes?: string[]
    limit: number
  }): Promise<LiteratureCandidate[]>
  resolveByDoi?(doi: string): Promise<LiteratureCandidate | null>
}

interface LiteratureCandidate {
  provider: string
  providerId: string
  title: string
  authors: Array<{ family?: string; given?: string }>
  year?: number
  doi?: string
  venue?: string
  volume?: string
  issue?: string
  pages?: string
  url?: string
  abstract?: string
  citationCount?: number
  openAccessUrl?: string
  retrievedAt: string
  license?: string
}
```

项目持久化字段：

```json
{
  "literature": [{
    "id": "lit-uuid",
    "status": "candidate | confirmed | imported | rejected | duplicate",
    "canonicalKey": "doi:10.xxxx/... | title-sha256:...",
    "record": { "title": "...", "doi": "...", "year": 2025 },
    "provenance": { "provider": "openalex", "providerId": "W...", "retrievedAt": "..." },
    "confirmation": { "confirmedAt": "...", "confirmedBy": "user" },
    "fulltextAction": "metadata_only | download_open_access | import_local_file",
    "fulltextDownload": { "status": "not_requested | pending | downloaded | failed", "url": null, "license": null },
    "fulltextMaterialId": null
  }]
}
```

严禁将 API Key、用户检索会话中的隐私内容或未经许可的全文写入该结构。

### 15.4 查询、合并与去重

1. 从用户任务、当前章节标题、项目领域字段和已导入材料中生成候选词；向用户展示并允许删改，禁止静默扩大查询意图。
2. 对每个 provider 限制查询长度、候选数、分页深度、超时与重试；记录 provider、请求参数摘要、版本和时间。
3. 首先按规范化 DOI 去重；无 DOI 时使用标准化标题 + 首作者 + 年份的保守匹配。模糊相似项标为“待人工合并”，绝不自动删除。
4. 候选排序只把文本相关性、年份、来源完整性、开放获取状态和被引量作为辅助信号；被引量不得等同于真实性或适用性。
5. 对 DOI 结果用第二来源交叉核验标题、作者和年份；字段冲突时展示冲突，不自动选择一方。

### 15.5 与本地 RAG、三类工作台的关系

| 工作台 | 在线扩充的目标 | 本地 RAG 的作用 | 引用规则 |
| --- | --- | --- | --- |
| `thesis` | 背景、相关工作、方法对比 | 检索用户已导入全文、笔记和实验资料 | GB/T 7714；观点必须有原文或可核验摘要支撑 |
| `patent` | 现有技术、对比文件、公开时间线 | 检索已导入专利全文和技术资料 | 优先公开号、公开日、权利要求/段落定位；候选不是法律结论 |
| `tech-report` | 技术背景、方案比较、标准和实验依据 | 检索方案资料、测试记录、图表 OCR | IEEE 或组织指定格式；外部元数据不能替代测试证据 |

在线书目元数据默认**不进入**向量索引；只有用户导入许可全文、或确认将可使用摘要作为有限证据后才生成 `SourceChunk`。这能防止“只找到题目就生成技术结论”的错误。

全文选择规则：

1. `metadata_only` 为默认值：仅保留标题、作者、年份、DOI、来源与查询追踪，不能作为技术事实证据；
2. `download_open_access` 只在候选提供明确开放获取 URL 和许可信息时展示；DSH 必须先说明文件大小、来源、许可和将要保存的位置，用户确认后才下载；
3. `import_local_file` 由用户选择已经合法取得的本地 PDF/DOCX 等文件，复用现有材料导入、OCR 和 RAG 链路；
4. 无开放许可、无 URL、下载失败或许可不清时，自动回到 `metadata_only`，不得尝试绕过付费墙、验证码或站点访问控制；
5. 用户可删除已下载全文而保留书目记录；删除全文后相关 `SourceChunk` 与向量索引必须可恢复地失效并重建。

### 15.6 分阶段落地顺序

#### Phase L0：书目模型与本地引用闭环 ⏳

- 定义 `LiteratureCandidate`、`LiteratureRecord`、状态机和审计事件；
- 暴露已确认书目的列表、预览、关联正文块和按 Evidence plugin 格式化的参考文献；
- 验收：不联网也可从用户导入的 RIS/BibTeX/CSV 建立、去重和绑定书目。

#### Phase P0：专利类型创建修复 ⏳

- 修复 `WorkbenchRuntime.createProject()`：将 `input.domainFields?.patentType` 或显式 `input.patentType` 传给 `patentFramework.generateOutline()`，不能只传通用 `taskType` 与 `targetWords`；
- 在 `wb_create_project` schema 中提供 `patentType: invention | utility_model`，创建时与 `domainFields.patentType` 一致化并持久化；发生冲突时拒绝创建而不是猜测；
- 生成大纲后保存 `outlineProfile`（专利类型、生成器版本、字数缩放规则）；用户之后切换专利类型时，不静默改写已编辑大纲，必须预览差异并确认后生成新版本；
- 验收：创建 `invention` 与 `utility_model` 项目，章节相同但实用新型目标字数按专利 Framework 规则缩放；重启后类型与 outlineProfile 不丢失；旧项目迁移保持原大纲不变。

#### Phase L1：开放元数据检索 ⏳

- 实现 `OpenAlexProvider` 与 `CrossrefProvider`，按 provider 独立限流、超时、缓存和失败降级；
- 首期只查询元数据，不下载全文；
- 验收：mock API 覆盖分页、429、超时、字段缺失、DOI 冲突和重复结果；网络不可用时返回可解释错误，不影响本地 RAG。

#### Phase L2：用户确认、去重与引用生成 ⏳

- 实现候选预览、DOI 优先去重、人工合并和 `wb_add_literature` 确认门禁；
- 将 thesis / patent / tech-report 的引用格式委托给各自 Evidence plugin；
- 验收：未确认候选不进入项目；同一 DOI 只保留一个 canonical record；每个引用可追溯 provider 与检索时间。

#### Phase L3：全文与本地 RAG 衔接 ⏳

- 支持用户为每条书目明确选择 `metadata_only`、开放获取下载或本地 PDF/DOCX 导入；复用现有解析、OCR、embedding、RRF 与证据绑定；
- 下载任务采用可恢复 run，保存内容 SHA-256、许可、来源 URL、时间和文件大小；下载前后均检查大小、MIME 类型、重定向次数和允许域名；
- 验收：书目候选、用户全文选择、全文材料、chunk 和正文证据五者可双向追溯；未确认时零下载；全文导入或下载失败不影响书目条目。

#### Phase L4：专利与机构适配器 ⏳

- 在获得正式凭证与数据许可后实现专利 provider；为机构订阅、中文数据库、RIS/BibTeX 导出提供插件接口；
- 验收：数据源许可、限流、字段完整性与法律状态提示均可审计；未授权 provider 不显示为可用。

### 15.7 质量、安全与发布门禁

- 每个查询至少记录数据源、参数摘要、时间、候选 ID 与用户确认动作；
- 不以模型生成的题名、作者或 DOI 作为书目事实；缺字段必须显示“待核验”；
- 不自动将在线候选写入正文，也不把摘要不足以支撑的结论标成证据；
- 以真实的微波水分测量问题集评测 Precision@10、DOI 去重准确率、元数据完整率、错误引用率、查询延迟和失败率；
- 发布前必须完成 Crossref/OpenAlex mock 测试、离线降级测试、隐私/许可检查，以及人工抽样核验 20 条候选书目。

## 16. UI 模板导入与大纲/正文受控重构开发计划

### 16.1 目标与用户体验

用户可直接在工作台 UI 的“模板”区域导入自己的写作模板，并在生成或重构大纲、正文时自主勾选是否使用。模板是结构、格式、章节约束和示例表达的参考，不是自动覆盖项目内容的指令。

```text
用户在 UI 导入模板文件
  → 系统解析并生成模板预览、可复用规则与风险提示
  → 用户选择“用于大纲”/“用于正文”/“仅保存”
  → 用户勾选一个或多个模板与目标章节/正文块
  → LLM 生成重构建议、完整预览和差异
  → 用户确认后才创建新大纲版本或新正文修订
  → 可比较、恢复或丢弃该版本
```

UI 应提供：

| 区域 | 用户操作 | 必须显示的信息 |
| --- | --- | --- |
| 模板库 | 导入、重命名、标签、归档、删除 | 名称、来源、格式、适用范围、解析状态、更新时间 |
| 模板预览 | 查看结构、标题层级、示例片段、格式规则 | 原文定位、提取警告、不可解析部分 |
| 大纲设置 | 勾选模板、选择“参考结构”或“严格对齐”、选择目标章节 | 冲突规则、将受影响的章节、预估变更 |
| 正文设置 | 勾选模板、选择目标块与重构意图 | 保留事实/引用/术语的约束、模板示例是否仅作风格参考 |
| 结果比较 | 接受、拒绝、逐块接受、恢复旧版 | 大纲/正文 diff、证据与引用保留情况、生成 run 信息 |

### 16.2 模板范围、格式与安全边界

- 首期支持：Markdown、TXT、DOCX、HTML；复用已有文档解析能力，但模板与 RAG 材料分开存储；
- 后续支持：PPTX、XLSX、组织模板包与自定义 schema；
- 模板默认不参与资料检索和证据引用，除非用户明确复制其中的事实并补充独立来源；
- 导入模板必须是用户明确选择的单个文件；不扫描模板目录，不执行模板内脚本、宏、链接或嵌入对象；
- 模板中的指令、示例结论、引用和个人信息均视为不可信内容。LLM 只能把它们当作格式/结构参考，不能把它们当作项目事实；
- API Key、外部链接凭证、二进制附件和超出大小上限的模板不得进入项目状态或提示词。

### 16.3 数据模型与接口

```ts
interface TemplateRecord {
  id: string
  name: string
  type: 'outline' | 'body' | 'both' | 'format'
  sourceFormat: 'md' | 'txt' | 'docx' | 'html'
  sourceSha256: string
  extractedText: string
  outlineSkeleton: TemplateOutlineNode[]
  styleRules: TemplateStyleRule[]
  exampleFragments: TemplateFragment[]
  status: 'ready' | 'warning' | 'failed' | 'archived'
  createdAt: string
  updatedAt: string
}

interface TemplateSelection {
  templateIds: string[]
  mode: 'outline-restructure' | 'body-restructure'
  targetOutlineNodeIds?: string[]
  targetBlockIds?: string[]
  strictness: 'reference' | 'structure-first'
  preserve: {
    facts: true
    evidenceBindings: true
    citations: true
    terminology: true
  }
}
```

新增受控工具：

| 工具 | 阶段 | 作用 |
| --- | --- | --- |
| `wb_import_template_file` | `write` | 导入用户选择的模板文件并解析 |
| `wb_list_templates` / `wb_get_template` | `write` / `review` | 展示模板库与预览 |
| `wb_preview_template_restructure` | `write` | 仅生成大纲/正文重构草案与 diff，不修改项目 |
| `wb_apply_template_restructure` | `write`，需 `userConfirmed` | 将已预览的草案作为新版本写入项目 |
| `wb_compare_snapshot` / `wb_restore_snapshot` | `write` / `review` | 比较或恢复模板重构前后的版本 |

### 16.4 大纲重构流程

1. 用户在 UI 勾选一个或多个 `outline` / `both` 模板，并选择目标为全局大纲或指定章节；
2. 系统从模板提取标题树、章节顺序、目标篇幅、表图建议和硬性结构规则；
3. 系统将当前项目大纲、项目类型 Framework 约束与用户意图一起交给 LLM；
4. LLM 输出严格 JSON Schema：新大纲、每一项变更原因、保留/新增/移动/删除节点、与 Framework 规则的冲突；
5. Runtime 校验必需章节。例如 `patent` 必须保留“技术领域、背景技术、发明内容、附图说明、具体实施方式、权利要求书”；
6. UI 显示树状 diff，用户可逐项接受、拒绝或编辑；
7. 只有确认后调用 `wb_apply_template_restructure`，保存新 outline revision 与 snapshot；旧大纲永不原地覆盖。

### 16.5 正文重构流程

1. 用户选择一个或多个正文块、模板及重构意图，例如“按论文模板统一研究背景结构”；
2. Runtime 收集目标块、关联证据、引用、术语表与模板中的结构/风格规则；
3. LLM 只能输出候选 Markdown 与逐句/逐块变更说明，且必须保留或显式标出无法保留的证据绑定与引文；
4. 运行 Evidence plugin 检查：论文长段落引用、专利背景技术现有技术、技术报告参数/测试证据不得因重构丢失；
5. UI 并列展示原文、候选文本、引用/证据变化和风险提示；
6. 用户可接受整个块、仅接受部分差异或拒绝；接受后写入新 revision 并创建快照。

### 16.6 分阶段实施顺序

#### Phase T0：模板存储与 UI 模板库 ⏳

- 扩展项目存储，新增 `TemplateRecord`、文件哈希、状态与审计事件；
- UI 增加“导入模板”按钮、文件选择器、模板列表、预览和归档；
- 验收：导入 Markdown/DOCX 后可预览，重复内容按哈希提示，不会导入密钥或执行宏。

#### Phase T1：模板解析与规则提取 ⏳

- 复用文档解析服务，提取标题树、段落、样式和示例片段；
- 为不可解析格式、空模板、超限文件、疑似指令注入模板提供可见状态；
- 验收：标题层级、表格/示例警告和原文 locator 可追溯；模板内容不会自动加入 RAG。

#### Phase T2：大纲重构预览与确认应用 ⏳

- 实现 `wb_preview_template_restructure` 的 JSON Schema、Framework 校验、树状 diff 与 snapshot；
- 验收：`thesis`、`patent` 和已安装的 `tech-report` 模板均不能删除各自 Framework 必需章节；未确认时项目大纲不变。

#### Phase T3：正文重构预览与证据保护 ⏳

- 支持按正文块选择模板、生成候选、逐块 diff、证据/引用迁移与 Evidence plugin 审查；
- 验收：模板重构后原有证据绑定、引文、术语和版本均可追溯；若无法迁移，UI 必须阻止静默应用并要求用户处理。

#### Phase T4：模板组合、评测与发布门禁 ⏳

- 支持多个模板的优先级、冲突检测和组织级只读模板；
- 建立“结构符合度、引用保留率、证据绑定保留率、人工接受率、回退率、P95 生成延迟”评测集；
- 验收：模板冲突有解释且可选择；所有应用操作可恢复；无确认、无 diff 或校验失败时禁止覆盖大纲/正文。
