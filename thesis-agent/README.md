# DSH Thesis-Agent

**证据驱动的论文写作智能体工作台（LLM Agent 应用工程范本）**

> 一句话定位：一个把 **「AI 只能提案 → 系统必须审批 → 证据必须追踪 → 修改必须版本化」** 落到真实工程架构里的多 Agent 应用，面向毕业论文写作场景，从架构层面治理大模型最核心的两个问题——**幻觉**与**不可控**。

| 版本 | Node 要求 | 测试 | 工具数量 | 许可证 |
|---|---|---|---|---|
| v1.2.0 | `^22.19.0 \|\| >=24.0.0` | 165 pass / 0 fail / 3 skip（共 168 项） | 65 个 `thesis_*` 工具 | MIT |

---

## 目录

1. [为什么做这个项目](#1-为什么做这个项目)
2. [项目亮点（先看这里）](#2-项目亮点先看这里)
3. [系统架构总览](#3-系统架构总览)
4. [技术栈](#4-技术栈)
5. [目录结构与模块地图](#5-目录结构与模块地图)
6. [快速开始](#6-快速开始)
7. [能做什么：功能全景与怎么做](#7-能做什么功能全景与怎么做)
8. [关键设计细节（面试深挖区）](#8-关键设计细节面试深挖区)
9. [测试与质量保障](#9-测试与质量保障)
10. [已知限制](#10-已知限制)
11. [路线图](#11-路线图)
12. [求职者：如何讲好这个项目](#12-求职者如何讲好这个项目)

---

## 1. 为什么做这个项目

通用 LLM 写作应用存在三个被反复诟病的硬伤：

1. **幻觉**：模型随意编造文献、捏造数据、虚构引用来源，学术场景不可接受；
2. **不可控**：AI 一键"生成全文"，覆盖用户已写内容、不按用户确认的规划走；
3. **不可追溯**：生成结果说不清"为什么这么写、依据是什么、改了哪一版"。

本项目不做"聊天生成整篇论文"的 Demo，而是把它当作一个 **生产级 Agent 系统** 来设计：用**领域状态机**约束流程、用**证据检索闭环**约束内容、用**双 Agent 权限隔离**约束权力、用**版本事务与乐观并发**约束数据。它完整覆盖了一条 Agent 应用的真实工程链路：**多 Agent 编排 → 工具注册与治理 → RAG 检索 → 受控生成 → 人机协作审批 → 多格式导出**。

适用岗位画像：AI 应用开发 / LLM Agent 应用 / RAG 工程 / 智能写作产品。

---

## 2. 项目亮点（先看这里）

| # | 亮点 | 工程价值 |
|---|---|---|
| 1 | **证据约束生成**：无检索证据禁止落笔，缺失处写入 `[待补充证据]` 占位，禁止捏造数字与文献 | 从**架构层面**治理 LLM 幻觉，而非提示词补救 |
| 2 | **双 Agent 权限隔离**：写作 Agent 与审查 Agent 使用**独立工具白名单**，审查 Agent 无任何写入工具 | 多 Agent 最小权限治理的真实落地，可扩展到任意"写审分离"场景 |
| 3 | **受控 AgentRun 状态机**：11 个状态、显式事件转移表、预算上限、完整审计轨迹、暂停/恢复/取消 | 把"Agent 失控"变成可观测、可干预、可审计的状态机问题 |
| 4 | **可插拔 RAG 全链路**：Embedding 6 厂商预设、Rerank 3 提供商自动降级、RAGFlow Adapter、JSON/SQLite 双存储 | 每个外部依赖都是抽象接口，切换成本 ≈ 0，体现适配器与依赖倒置设计 |
| 5 | **乐观并发 + 无损序列化桥**：所有写操作带 `expectedRevision` 冲突检测；工具返回值经 Lossless-JSON 守卫清洗 | 多智能体并发写同一项目的可靠性保障，工程严谨性的硬体现 |
| 6 | **块级版本事务**：正文按段落块存储，命名快照 / 块级 diff / 无损恢复，用户锁定块永不覆盖 | 数据一致性与可回滚设计，接近数据库事务思维 |
| 7 | **对话 ↔ 工作台双向闭环**：Web 工作台（:3199）与 DSH 对话通过"重新生成请求队列"联动 | 完整产品体验：自然语言驱动 + 可视化精细编辑 |
| 8 | **导出保真**：DOCX 公式上标/下标渲染、LaTeX 数学符号映射、GB/T 7714 / APA 引用、XeLaTeX 编译 PDF | 垂直领域深度：不满足于"能导出"，追求排版正确 |
| 9 | **165 项自动化测试 + 工具桥回归验证**，`npm audit` 0 漏洞 | 可维护性可量化，工程习惯直接可查 |

---

## 3. 系统架构总览

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 736" width="100%" role="img" aria-label="Thesis-Agent 分层架构图" font-family="-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="960" height="736" fill="#F4F3EE"/>
  <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#9BBBF4"/></marker></defs>
  <text x="40" y="30" font-size="18" font-weight="700" fill="#1A1B1C">Thesis-Agent · 分层架构</text>
  <text x="40" y="50" font-size="12" fill="#6B7280">AI 只能提案 · 系统必须审批 · 证据必须追踪 · 修改必须版本化</text>

  <!-- ① 交互层 -->
  <rect x="40" y="66" width="880" height="26" rx="6" fill="#E9EEFB"/>
  <text x="52" y="84" font-size="13" font-weight="700" fill="#3E5CB8">① 交互层（对话 ⇄ 工作台双向联动）</text>
  <rect x="40" y="100" width="420" height="56" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
  <text x="56" y="122" font-size="13" font-weight="600" fill="#1A1B1C">DSH 对话界面</text>
  <text x="56" y="140" font-size="11" fill="#4B5563">自然语言：建项目 / 导材料 / 生成 / 审批 / 导出</text>
  <rect x="500" y="100" width="420" height="56" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
  <text x="516" y="122" font-size="13" font-weight="600" fill="#1A1B1C">论文写作工作台 Web UI（127.0.0.1:3199）</text>
  <text x="516" y="140" font-size="11" fill="#4B5563">双区 4:3 可拖拽 · 大纲/行文逻辑/来源/版本/任务/模板/设置</text>
  <text x="470" y="116" text-anchor="middle" font-size="16" fill="#3E5CB8" font-weight="700">⇄</text>

  <!-- ② Agent 编排层 -->
  <rect x="40" y="170" width="880" height="26" rx="6" fill="#E9EEFB"/>
  <text x="52" y="188" font-size="13" font-weight="700" fill="#3E5CB8">② Agent 编排层（多 Agent + 工具治理）</text>
  <rect x="40" y="204" width="420" height="58" rx="8" fill="#FFFFFF" stroke="#9BBBF4" stroke-width="1.5"/>
  <text x="56" y="226" font-size="13" font-weight="600" fill="#1A1B1C">写作 Agent · thesis-writer-v0</text>
  <text x="56" y="244" font-size="11" fill="#4B5563">9 个领域 Skills：项目接入/规划/检索溯源/文献引用/</text>
  <text x="56" y="257" font-size="11" fill="#4B5563">受控生成/受控重写/版本导出/Embedding 配置</text>
  <rect x="500" y="204" width="420" height="58" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
  <text x="516" y="226" font-size="13" font-weight="600" fill="#1A1B1C">审查 Agent · thesis-review-v0</text>
  <text x="516" y="244" font-size="11" fill="#4B5563">只读白名单（4 个工具），无任何写入能力</text>
  <text x="516" y="257" font-size="11" fill="#4B5563">只提交结构化建议，永不直接改正文</text>
  <text x="470" y="222" text-anchor="middle" font-size="9.5" fill="#6B7280">审查</text>
  <text x="470" y="234" text-anchor="middle" font-size="9.5" fill="#6B7280">建议</text>
  <path d="M462 230 H500" stroke="#9BBBF4" stroke-width="1.5" marker-end="url(#arr)"/>
  <rect x="40" y="270" width="880" height="34" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
  <text x="56" y="285" font-size="12" font-weight="600" fill="#1A1B1C">工具桥 · 65 个 thesis_* 工具</text>
  <text x="56" y="298" font-size="10.5" fill="#4B5563">JSON Schema 强校验 · Lossless-JSON 序列化守卫 · expectedRevision 乐观并发 · 工具级并发安全标记 · writer/review 白名单分流</text>

  <!-- ③ 领域引擎层 -->
  <rect x="40" y="316" width="880" height="26" rx="6" fill="#E9EEFB"/>
  <text x="52" y="334" font-size="13" font-weight="700" fill="#3E5CB8">③ 领域引擎层（论文写作核心业务逻辑）</text>
  <g font-size="11" fill="#4B5563">
    <rect x="40" y="350" width="280" height="92" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="56" y="370" font-size="13" font-weight="600" fill="#1A1B1C">规划与模板</text>
    <text x="56" y="388">· 大纲 + 行文逻辑双层规划</text>
    <text x="56" y="403">· 硕士/本科/会议模板包 + 自定义模板</text>
    <text x="56" y="418">· 规划确认后乐观锁保护</text>
    <text x="56" y="433">· 章节级预计图表数多模态规划</text>
    <rect x="340" y="350" width="280" height="92" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="356" y="370" font-size="13" font-weight="600" fill="#1A1B1C">证据检索 RAG</text>
    <text x="356" y="388">· 多格式解析（PDF/DOCX/PPTX/XLSX…）</text>
    <text x="356" y="403">· 结构分块 → Embedding（本地/远程）</text>
    <text x="356" y="418">· 混合检索 0.45×词频 + 0.55×向量</text>
    <text x="356" y="433">· 可选 Rerank · 预算化证据包 · 来源绑定</text>
    <rect x="640" y="350" width="280" height="92" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="656" y="370" font-size="13" font-weight="600" fill="#1A1B1C">受控生成</text>
    <text x="656" y="388">· 范围候选 → 用户确认才落笔</text>
    <text x="656" y="403">· 无证据写 [待补充证据]，禁止捏造</text>
    <text x="656" y="418">· 用户锁定块永不覆盖</text>
    <text x="656" y="433">· 最小范围修改，只影响关联章节</text>
    <rect x="40" y="454" width="280" height="92" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="56" y="474" font-size="13" font-weight="600" fill="#1A1B1C">审查与修订</text>
    <text x="56" y="492">· 建议池：编辑 / 接受 / 拒绝</text>
    <text x="56" y="507">· 已接受建议 + 用户修改 → 修订批次</text>
    <text x="56" y="522">· 冲突解决 → 批次确认 → Patch 二次审批</text>
    <text x="56" y="537">· 每次审批都是独立用户决策点</text>
    <rect x="340" y="454" width="280" height="92" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="356" y="474" font-size="13" font-weight="600" fill="#1A1B1C">版本与质量</text>
    <text x="356" y="492">· 块级版本事务：命名快照 / diff / 无损恢复</text>
    <text x="356" y="507">· 源变更自动失效旧绑定与引用</text>
    <text x="356" y="522">· 确定性质量检查：数字来源 / 重复段落 /</text>
    <text x="356" y="537">· 章节覆盖 / 术语一致性</text>
    <rect x="640" y="454" width="280" height="92" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="656" y="474" font-size="13" font-weight="600" fill="#1A1B1C">导出</text>
    <text x="656" y="492">· DOCX：公式上下标渲染 / 章节自动编号</text>
    <text x="656" y="507">· LaTeX→PDF：数学符号映射 / XeLaTeX 编译</text>
    <text x="656" y="522">· 引用格式 GB/T 7714 / APA</text>
    <text x="656" y="537">· 图表/公式交叉引用与孤儿引用检查</text>
  </g>

  <!-- ④ 运行治理 -->
  <rect x="40" y="558" width="880" height="26" rx="6" fill="#E9EEFB"/>
  <text x="52" y="576" font-size="13" font-weight="700" fill="#3E5CB8">④ 运行治理 · ⑤ 基础设施（全部可插拔）</text>
  <rect x="40" y="592" width="880" height="34" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
  <text x="56" y="607" font-size="12" font-weight="600" fill="#1A1B1C">AgentRun 状态机（受控 ReAct）</text>
  <text x="56" y="620" font-size="10.5" fill="#4B5563">created → planning → 等待计划确认 → retrieving → 证据评估 → drafting → validating → reviewing → 等待用户决策 → applying · 预算/审计/暂停·恢复</text>

  <g font-size="11" fill="#4B5563">
    <rect x="40" y="636" width="215" height="66" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="54" y="654" font-size="12" font-weight="600" fill="#1A1B1C">存储</text>
    <text x="54" y="670">JSON（默认）/ SQLite WAL</text>
    <text x="54" y="685">schemaVersion 只增不减 + 迁移</text>
    <rect x="267" y="636" width="215" height="66" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="281" y="654" font-size="12" font-weight="600" fill="#1A1B1C">Embedding</text>
    <text x="281" y="670">local-hash 192 维（零依赖）</text>
    <text x="281" y="685">OpenAI-compatible · 6 家预设</text>
    <rect x="494" y="636" width="215" height="66" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="508" y="654" font-size="12" font-weight="600" fill="#1A1B1C">Rerank</text>
    <text x="508" y="670">本地 BM25 / Cohere / Voyage</text>
    <text x="508" y="685">外部失败自动降级本地，检索不中断</text>
    <rect x="721" y="636" width="199" height="66" rx="8" fill="#FFFFFF" stroke="#E4E3DD"/>
    <text x="735" y="654" font-size="12" font-weight="600" fill="#1A1B1C">解析 / OCR / 适配</text>
    <text x="735" y="670">officeparser + pdfjs-dist</text>
    <text x="735" y="685">Tesseract/PaddleOCR · RAGFlow</text>
  </g>

  <text x="40" y="722" font-size="11" fill="#6B7280">图例：方框 = 模块/组件；横带 = 架构层级；⇄ = 双向联动；箭头 = 数据流 / 依赖</text>
</svg>

> 上图为系统架构的确定性示意（自绘 SVG，非官方文档截图）。完整实现细节见 [docs/README.md](./docs/README.md)（P0–P3 开发路线图）与 [docs/IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md)（实现状态）。

整体是一个 **DSH（DeepSeek Harness）插件 Bundle**：`src/` 提供领域引擎与工具注册，`assets/presets/` 提供 Agent 行为资产，二者通过工具桥对接。数据默认持久化在 `~/.dsh/storages/thesis-agent/state.json`（可切 SQLite）。

---

## 4. 技术栈

| 层级 | 技术 | 用途 |
|---|---|---|
| 运行时 | Node.js `^22.19.0 \|\| >=24.0.0`，ESM | 全项目运行环境 |
| Agent 框架 | DeepSeek Harness（`@deepseek-ai/dsh@0.1.1-rc.2`，Bundle 机制） | Agent 预设、工具注册、Skill 文件系统、会话绑定 |
| 工具治理 | 自研工具桥（JSON Schema + Lossless-JSON + 乐观锁） | 65 个 `thesis_*` 工具的统一注册/校验/清洗 |
| 文档解析 | `officeparser@7.8.0`（内置 pdfjs-dist 6.2.108） | PDF / DOCX / PPTX / XLSX / ODF / RTF / HTML / EPUB 解析 |
| OCR | Tesseract（本地 CLI）/ PaddleOCR（HTTP 服务） | 扫描件 / 图片文字提取 |
| Embedding | 自研 local-hash（192 维，零依赖）+ OpenAI-compatible HTTP | 向量化与索引；支持 DeepSeek / OpenAI / 通义 / 智谱 / SiliconFlow / Ollama 预设 |
| 检索 | 自研混合检索（关键词 0.45 + 向量余弦 0.55）+ Rerank | 证据召回与重排 |
| Rerank | 自研 BM25+Bigram 本地实现 / Cohere / Voyage | 重排层，外部失败自动降级 |
| 存储 | 自研存储抽象：JSON 文件（默认）/ SQLite（better-sqlite3，WAL，可选） | 项目状态持久化与迁移 |
| 前端 | 原生 HTML/CSS/JS（零框架）内嵌 `node:http` 服务 | 双区写作工作台（:3199） |
| 导出 | `docx@9.7.1`（Word）、自研 LaTeX 渲染器（XeLaTeX 编译） | DOCX / LaTeX / PDF 导出 |
| 测试 | Node 内置 `node --test` + 自研桥接回归脚本 | 165 项自动化测试 |

设计取向：**核心能力自研、外部依赖走抽象接口**。检索、Rerank、Embedding、存储、OCR 全部有 Provider 抽象层，可插拔、可降级、可替换——这正是 AI 应用工程里"不被单一厂商锁死"的关键设计。

---

## 5. 目录结构与模块地图

```
thesis-agent/
├─ src/                        # 核心引擎（无框架依赖的领域逻辑）
│   ├─ index.js                # 插件入口：65 个工具注册、writer/review 白名单策略
│   ├─ domain-store.js         # 领域状态聚合：项目/规划/正文/版本/建议（约 7.6 万字符，核心）
│   ├─ agent-run.js            # AgentRun 状态机：事件表/预算/暂停恢复/模式预设
│   ├─ source-index.js         # 分块、内容哈希、local-hash Embedding、混合检索
│   ├─ reranker.js             # Rerank 抽象：本地 BM25+Bigram / Cohere / Voyage
│   ├─ embedding-provider.js   # Embedding 抽象：local-hash / OpenAI-compatible
│   ├─ embedding-presets.js    # 6 个厂商预设（deepseek/openai/qwen/zhipu/siliconflow/ollama）
│   ├─ document-parser.js      # 目录预扫描 + 多格式文档解析 + 表格结构提取
│   ├─ ocr-provider.js         # OCR 抽象：none / tesseract / paddleocr
│   ├─ manuscript-model.js     # 正文块模型（块 ID、行文逻辑绑定）
│   ├─ citation-engine.js      # 图表/公式自动编号、交叉引用、孤儿引用检测
│   ├─ template-pack.js        # 模板包系统（内置 + 导入 + schema 校验）
│   ├─ template-profile.js     # 导出模板 Profile（字体/行距/缩进）
│   ├─ storage-backend.js      # 存储抽象接口
│   ├─ storage-json.js         # JSON 文件存储
│   ├─ storage-sqlite.js       # SQLite 存储（WAL，可选依赖，自动降级）
│   ├─ lossless.js             # Lossless-JSON 序列化守卫（工具桥边界）
│   ├─ reference-extractor.js  # 参考文献抽取与去重
│   ├─ figure-describer.js     # 图表描述辅助
│   ├─ ragflow-adapter.js      # RAGFlow 兼容检索适配器（local / ragflow 双后端）
│   ├─ docx-exporter.js        # DOCX 导出（公式上下标渲染、章节编号）
│   ├─ latex-exporter.js       # LaTeX/PDF 导出（数学符号映射、XeLaTeX 编译）
│   └─ workbench-server.js     # 双区工作台 HTTP 服务（页面 + REST API）
├─ assets/presets/             # Agent 行为资产
│   ├─ thesis-writer-v0/       # 写作 Agent：persona + 9 个领域 Skills + 写白名单
│   └─ thesis-review-v0/       # 审查 Agent：persona + 审查 Skill + 只读白名单
├─ client.js                   # DSH 客户端侧边面板（自动跟随项目、打开工作台）
├─ scripts/                    # 资产安装 / UI 校验 / 桥接回归脚本
├─ test/                       # 20 个测试文件（165 项通过）
├─ docs/                       # P1/P2/P3 开发文档、模板包 Schema、实现状态
├─ deploy/ragflow/             # 可选 RAGFlow docker-compose
└─ package.json
```

> 设计要点：**`src/` 完全不依赖 DSH 运行时**，纯领域逻辑 + Node 标准库，因此可独立测试、可移植、可复用到其他宿主（这正是 `test/` 能直接 `node --test` 跑通的原因）。

---

## 6. 快速开始

### 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- DeepSeek Harness（DSH）`@deepseek-ai/dsh@0.1.1-rc.2`
- （可选）TeX Live / MiKTeX 中的 XeLaTeX，用于 PDF 编译

### 安装与启动

```powershell
# 在项目根目录执行
dsh plugin --profile web add .     # 注册插件
npm run setup                       # 安装 Preset 资产
dsh web                             # 启动 DSH（含工作台）
```

启动后访问：

- **论文写作工作台（推荐）**：http://127.0.0.1:3199
- DSH 对话界面：按 Harness 实际启动端口访问（会话头部会出现「论文工作台」按钮）

### 第一次验证（5 分钟跑通）

在 DSH 对话中发送：

```
创建一篇目标 30000 字的硕士论文项目，题目为"面向论文写作的混合检索方法研究"。
我暂时没有参考论文，请先生成默认大纲与行文逻辑，不要生成正文。
```

系统生成大纲后，发送：

```
生成系统设计章节。
```

插件会**先提交生成范围候选**，等你确认后才写入正文。此时打开 http://127.0.0.1:3199 可以看到双区工作台：左侧正文、右侧大纲/行文逻辑/引用/版本。

### 导入参考论文（开启证据约束）

```
请扫描目录 D:\我的论文资料 并将论文导入为参考材料。
```

系统解析 PDF/DOCX 等文件 → 分块 → 建向量索引。之后生成的内容必须"有据可依"，缺失处会标记 `[待补充证据]`。

### 配置真实 Embedding（正式使用推荐）

对话中直接说一句即可（内置 6 厂商预设）：

```
用 SiliconFlow 的 bge-m3 向量模型，Key 是 sk-xxx
```

或在工作台「设置」tab 手动配置 OpenAI-compatible 服务 → 测试连接 → 保存 → 重建索引。**API Key 只保存在进程内存，不落盘**（也可用 `apiKeyEnv` 指向环境变量）。

### 配置 XeLaTeX（PDF 导出可选）

```powershell
$env:THESIS_XELATEX_PATH = "D:\texlive\texlive\2023\bin\windows\xelatex.exe"
dsh web
```

### 开发期重装（改代码后）

```powershell
dsh plugin --profile web remove dsh-thesis-agent
dsh plugin --profile web add .
npm run setup
```

---

## 7. 能做什么：功能全景与怎么做

整个系统围绕一条**受控写作流水线**组织：`建项目 → 定规划 → 导材料 → 生成 → 审查 → 修订 → 版本 → 导出`，每个环节都有对应工具与 UI。

### 7.1 项目与规划

| 能力 | 怎么做 |
|---|---|
| 创建/绑定/删除论文项目 | 对话说"创建论文项目"，或工作台「新建」；会话与项目自动绑定 |
| 应用模板 | 内置硕士/本科/会议模板包，或上传范文由 Agent 解析后保存为自定义文本/格式模板 |
| 双层规划 | 大纲（结构）+ 行文逻辑（每段写作目的与承接）；确认后锁定，AI 不得绕过 |

对应工具：`thesis_create_project` / `thesis_set_plan` / `thesis_apply_default_master_template` / `thesis_import_reference_template` / `thesis_save_template` 等。

### 7.2 材料接入与证据检索

| 能力 | 怎么做 |
|---|---|
| 多格式导入 | `thesis_scan_directory`（先扫描后确认，不擅自读内容）→ `thesis_import_source_file` / `thesis_import_source_text` |
| 证据检索 | `thesis_search_sources`（关键词+向量混合，可带 rerank） |
| 证据包 | `thesis_build_evidence_package`：在显式字符预算内去重、按项目隔离地组装证据 |
| 来源绑定 | `thesis_bind_block_sources`：正文块 ↔ 来源行区间，源变更自动失效 |

### 7.3 受控生成

生成不是一步到位：`thesis_prepare_generation`（范围候选）→ `thesis_confirm_generation`（用户确认）→ `thesis_submit_generated_scope`（候选稿，不改正文）→ `thesis_decide_generated_scope`（接受/拒绝，接受才生成版本）。无证据时写入 `[待补充证据]`，禁止编造数字与引用。

### 7.4 审查与修订

独立审查 Agent 只读提交建议 → 建议池中逐条编辑/接受/拒绝 → 已接受建议与用户修改合并为修订批次 → 冲突解决 → 批次确认 → **Patch 二次审批**后才写入正文。

### 7.5 版本与质量

命名快照、块级 diff、无损恢复；确定性质量检查（无来源数字、重复段落、章节覆盖、相关工作比较、术语一致性）；导出前阻塞门禁检查（过期来源、占位符、逻辑绑定）。

### 7.6 导出

DOCX（宋体 12pt / 首行缩进 / 1.5 倍行距 / 公式渲染）与 LaTeX（数学符号映射 / amsmath / ctexart）双导出，引用支持 GB/T 7714 与 APA；安装了 XeLaTeX 时可一键编译 PDF。

### 7.7 端到端示例（一条完整对话）

```
用户：创建 3 万字的硕士论文项目《面向论文写作的混合检索方法研究》
Agent：thesis_create_project → thesis_apply_default_master_template → 展示大纲待确认
用户：大纲没问题，先扫描 D:\refs 里的参考资料
Agent：thesis_scan_directory → thesis_import_source_file（逐份导入建索引）
用户：生成"系统设计"章节
Agent：thesis_prepare_generation → 提交范围候选
用户：确认
Agent：thesis_search_sources → thesis_build_evidence_package → thesis_submit_generated_scope → 等待决定
用户：接受，让审查 Agent 看看
Agent：审查 Agent 提交建议（只读）→ 用户逐条接受/拒绝 → thesis_create_revision_batch
用户：确认修订批次，导出 Word 和 PDF
Agent：thesis_export_current_docx / thesis_export_current_latex（compilePdf=true）
```

工作台侧：用户在左侧正文改一段 → 点「🔄 重新生成」→ 请求进入队列 → 回到对话说"继续" → Agent 读取 `thesis_list_regeneration_requests` 基于修改内容重写 → 保存并解决请求 → 工作台自动刷新。

---

## 8. 关键设计细节（面试深挖区）

### 8.1 证据约束生成（对抗幻觉的架构手段）

生成正文前必须经过 `检索 → 证据评估`；正文生成**严格约束在证据包范围内**，数字与文献引用必须有来源绑定；无证据处写 `[待补充证据]` 而不是自由发挥。检索打分：`relevance = keywordScore × 0.45 + vectorScore × 0.55`（`src/source-index.js`）。

### 8.2 双 Agent 最小权限隔离

`index.js` 中 `writer-policy` 与 `review-policy` 两个模式对工具做白名单分流：审查 Agent **只允许** `thesis_project_status` / `thesis_get_workbench` / `thesis_submit_review_suggestions` / `thesis_run_quality_checks` 四个只读或"仅提交建议"的工具，`apply_patch` 类写入工具对审查 Agent 不可见。这是多 Agent 系统权限治理的最小可复现范例。

### 8.3 受控 AgentRun 状态机

`src/agent-run.js` 用**显式状态×事件表**（非自由 ReAct）约束执行：

```
created → planning → awaiting_plan_confirmation → retrieving → evaluating_evidence
       → drafting → validating → reviewing → awaiting_user_decision → applying → 终态
```

- 预算：`maxSteps` / `maxRetrievalAttempts` / `maxRevisionAttempts`，超限强制进入 `budget_exceeded` / `needs_user_material`；
- 证据不足自动暂停等待用户补材料；支持暂停/恢复/取消（需 revision 匹配）；
- **`recommendedNextEvent` 机制**：每次返回推荐的下一个合法事件名，从工具描述与返回值层面消除 LLM"猜事件名"导致的失控（曾真实发生并修复，见 docs/README.md v1.1.4）；
- `full/standard/fast` 模式预设支持跳过冗余阶段，跳过以 `skipped` 事件保留在审计轨迹中。

### 8.4 乐观并发与无损序列化桥

- 所有写操作要求 `expectedRevision`，冲突抛明确错误，不静默覆盖（`domain-store.js`）；
- 工具返回值统一过 `toLosslessJson`（`src/lossless.js`）：剔除 `undefined/NaN/±Infinity/-0/循环引用/非普通对象`，保证 DSH 工具桥无损往返——这是一个容易踩坑但极少有人系统解决的边界问题。

### 8.5 可插拔基础设施

| 抽象 | 实现 | 切换方式 |
|---|---|---|
| 存储 | JsonStorageBackend / SqliteStorageBackend | `THESIS_STORAGE=sqlite` 或 `storageType`，缺依赖自动降级 JSON |
| Embedding | local-hash（零依赖）/ OpenAI-compatible | 对话一条指令或工作台设置，`thesis_set_embedding_preset` |
| Rerank | local BM25+Bigram / Cohere / Voyage | `rerank.provider`，外部失败自动 fallback 本地 |
| OCR | none / tesseract / paddleocr | `ocrProvider`，扫描件自动触发 |
| 检索后端 | 本地 / RAGFlow HTTP | `createRagflowAdapter` 双后端 |

### 8.6 安全设计

- Embedding API Key 仅存进程内存，不落盘；支持 `apiKeyEnv` 指向环境变量；
- 目录扫描必须显式 `approved: true` 后才读内容；扫描前只返回文件元数据；
- Embedding endpoint 校验协议与内嵌凭证，拒绝非 HTTP(S) URL；
- LaTeX 编译使用 `-no-shell-escape`，pdfjs-dist 依赖覆盖到无漏洞版本（`npm audit` 0 漏洞）。

---

## 9. 测试与质量保障

```powershell
npm test        # 165 pass / 0 fail / 3 skip（3 项 skip 为 XeLaTeX 环境依赖）
npm run check   # 全部核心模块语法检查
npm run verify  # 客户端 UI 校验
npm audit       # 0 漏洞
```

测试覆盖：状态机全路径与非法事件、混合检索与 Rerank（含外部降级）、Embedding 预设桥接、文档解析/OCR、模板包 schema、引用引擎、导出器（含真实 XeLaTeX 中文 PDF 编译）、工作台 API 与对话↔工作台联动、Lossless-JSON 边界、乐观并发冲突。另有两个桥接回归脚本（`scripts/verify-p1-bridge.mjs`、`scripts/verify-page-js.cjs`）专门验证工具注册与页面 JS 语法。

项目级工程约束（写入 `docs/README.md`，每个阶段强制验收）：工具桥无损、乐观并发、schemaVersion 只增不减、测试门槛全绿、文档同步。

---

## 10. 已知限制

- **解析层轻量化**：使用 officeparser + pdfjs-dist，未接入 RAGFlow DeepDoc 的版面布局模型与表格结构识别；扫描版 PDF 需配置 OCR；
- **本地检索精度上限**：local-hash Embedding 面向演示与离线场景；语义检索建议配置真实 Embedding + Rerank；
- **API Key 内存暂存**：DSH 重启后需重新填写（可用 `apiKeyEnv` 规避）；
- **PDF 编译依赖 XeLaTeX**：未安装 TeX 的系统仅导出 `.tex`；
- **审查 Agent 尚未由宿主自动调度**：目前审查由对话流程驱动，非自动异步触发。

这些限制同时是路线图的输入，见下节。

---

## 11. 路线图

- **近期**：审查 Agent 自动调度串联 GenerationTask；用户 LaTeX 模板 ZIP 与占位符映射；图片/表格结构化抽取与单元格级来源定位；
- **中期**：生产向量库适配（Qdrant 等）与增量索引进度；多会话并发写入；
- **长期（v2.0）**：将工作台抽象为**可插拔文本处理工作台框架**（大纲/写作逻辑/内容凭证三层插件化），支持 LLM 自主生成"专利撰写工作台""技术报告工作台"等新类型（方案已写入 [docs/v2-可插拔工作台架构.md](./docs/v2-可插拔工作台架构.md)）。

---

## 12. 求职者：如何讲好这个项目

**一页话术（30 秒版）**：
> "我做了一个面向论文写作的多 Agent 应用。它解决的行业痛点是 LLM 生成的幻觉与不可控——我的方案是把'AI 只能提案、系统必须审批、证据必须追踪、修改必须版本化'落到工程架构里：双 Agent 工具白名单隔离、受控状态机、证据约束生成、乐观并发和版本事务，配套一个双区 Web 工作台，165 个自动化测试全绿。它完整走通了 RAG + Agent + 人机协作的全链路。"

**面试官可能追问的问题（建议准备）**：

| 问题 | 你的答案要点 |
|---|---|
| 如何防止 LLM 幻觉？ | 不是靠提示词，而是架构：证据检索闭环 + 无证据禁落笔 + 来源绑定 + 质量检查门禁 |
| 多 Agent 如何防止越权？ | 工具白名单策略隔离：审查 Agent 只有 4 个只读工具，写入工具对它在工具注册层就不可见 |
| Agent 失控怎么办？ | 显式状态机 + 事件白名单 + 预算上限 + 推荐事件机制（消除猜事件）+ 完整审计轨迹 + 暂停恢复 |
| 为什么自己写 embedding/rerank 而不直接用库？ | 展示抽象能力：local 实现保证零依赖可运行与离线演示，外部 Provider 走统一接口、失败自动降级 |
| 数据一致性怎么保证？ | 乐观锁（expectedRevision）、块级版本事务、无损序列化桥、schemaVersion 迁移 |
| 工程完成度？ | 165 测试、双回归脚本、npm audit 0 漏洞、P0–P3 分阶段文档与验收标准 |

**加分点**：`docs/` 下保留了 P0→P3 的分阶段开发文档（含每个阶段的验收标准与测试数），展示的是"会规划、会留痕、会收尾"的工程习惯，这在简历项目里非常稀缺。

---

## 许可证

MIT（见 `package.json`）。内置模板、DSH 集成与派生代码分别受其上游许可证约束。
