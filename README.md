# Workbench Creator

Workbench Creator 是一个面向 DSH（DeepSeek Harness）的 AI 工作台项目。它从第一版的 `thesis-agent` 论文写作智能体出发，将“证据驱动、人工审批、版本可追溯、多 Agent 权限隔离”等工程能力抽象为第二版的 `workbench-core` 通用工作台框架。

本仓库包含两个版本：

- `thesis-agent/`：第一版，论文专用的完整多 Agent 写作工作台；
- 根目录：第二版，支持论文、专利、合同、技术报告等任务类型的可插拔工作台框架。

两版共同遵循：**AI 只能提案，系统必须审批；证据必须追踪，修改必须版本化。**

## 第一版项目：DSH Thesis-Agent

### 项目介绍

`thesis-agent` 是一个证据驱动的论文写作智能体工作台，不是“输入题目后自动生成整篇论文”的 Demo。它把大模型写作中的三个核心问题落实到工程架构中：

1. **幻觉**：模型不能随意编造文献、数字和实验结论；
2. **不可控**：AI 不能跳过规划、覆盖用户锁定内容或直接提交最终修改；
3. **不可追溯**：正文必须能够追溯到材料、证据、版本和审批记录。

### 第一版核心能力

- 多 Agent 协作：写作 Agent 负责规划、检索、生成和受控修改；审查 Agent 使用独立只读工具；
- 证据约束生成：参考资料先解析、分块、索引，再进入生成上下文；无证据处使用 `[待补充证据]` 占位；
- 受控 AgentRun：显式状态×事件表、推荐事件、预算上限、审计轨迹、暂停、恢复和取消；
- 双 Agent 最小权限：Writer 和 Reviewer 使用不同工具白名单，Reviewer 不具备正文写入能力；
- 块级正文模型：每个正文块拥有 ID、章节关系、逻辑绑定、锁定状态和 revision；
- 版本事务：命名快照、块级 diff、无损恢复、乐观并发和 Patch 二次审批；
- 多格式文档处理：导入 PDF、DOCX、PPTX、XLSX、ODF、RTF、HTML、EPUB 等材料；
- 论文导出：DOCX、LaTeX 和可选 PDF，支持公式、章节、参考文献和格式模板；
- 对话与工作台联动：DSH 对话负责自然语言操作，Web 工作台负责结构化编辑和版本查看。

### 第一版技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 宿主平台 | DSH `@deepseek-ai/dsh@0.1.1-rc.2`、Cordis Bundle | Agent、工具、Skill 和插件加载 |
| 运行时 | Node.js `^22.19.0 \|\| >=24.0.0`、原生 ESM | 服务端与论文领域引擎 |
| 工具治理 | JSON Schema、Lossless-JSON、`expectedRevision` | 参数校验、返回值清洗、权限和并发控制 |
| 文档解析 | `officeparser@7.8.0`、`pdfjs-dist@6.2.108` | 多格式材料提取、表格和正文解析 |
| OCR | Tesseract、本地或 PaddleOCR HTTP 服务 | 扫描件和图片文字识别 |
| Embedding | local-hash 192 维、OpenAI-compatible HTTP | 本地或远程向量化 |
| Embedding 预设 | DeepSeek、OpenAI、通义、智谱、SiliconFlow、Ollama | 切换向量服务 |
| 检索 | 关键词 0.45 + 向量余弦 0.55 混合检索 | 证据召回和来源定位 |
| Rerank | 本地 BM25 + Bigram、Cohere、Voyage | 结果重排和外部服务降级 |
| 存储 | JSON 文件、可选 SQLite WAL | 项目、正文、材料、版本和运行状态 |
| Web UI | 原生 HTML/CSS/JavaScript、Node `http` | 双区论文写作工作台，默认 :3199 |
| 导出 | `docx@9.7.1`、自研 LaTeX、XeLaTeX | DOCX、LaTeX、PDF |
| 测试 | Node `node:test`、桥接回归脚本 | 领域功能和 DSH 集成验证 |

### 第一版目录重点

```text
thesis-agent/src/index.js             插件入口、65 个 thesis_* 工具和权限策略
thesis-agent/src/domain-store.js      论文项目、正文、建议、版本和导出聚合
thesis-agent/src/agent-run.js         受控 AgentRun 状态机
thesis-agent/src/source-index.js      分块、Embedding 和混合检索
thesis-agent/src/reranker.js          本地/远程 Rerank 适配
thesis-agent/src/document-parser.js   多格式文档和表格解析
thesis-agent/src/template-pack.js    论文模板包和 schema 校验
thesis-agent/src/citation-engine.js  图表/公式编号与交叉引用
thesis-agent/src/docx-exporter.js    DOCX 生成
thesis-agent/src/latex-exporter.js   LaTeX/PDF 生成
thesis-agent/src/workbench-server.js 论文工作台页面和 REST API
thesis-agent/assets/presets/          Thesis Writer / Thesis Review 预设
```

### 第一版运行流程

```text
创建项目 → 应用模板 → 确认大纲与逻辑
→ 导入材料 → 分块与检索 → 提交生成范围
→ 用户确认 → 生成正文 → 证据绑定
→ Reviewer 提交建议 → 用户审批修订
→ 快照 / diff / 恢复 → DOCX 或 LaTeX/PDF 导出
```

运行第一版：

```powershell
Set-Location .\thesis-agent
npm.cmd ci
npm.cmd run setup
npm.cmd test
npm.cmd run check
dsh plugin --profile web add .
```

PDF 编译需要 TeX Live 或 MiKTeX 的 XeLaTeX；未安装时仍可导出 `.tex`。第一版测试目标为 165 项通过，XeLaTeX 相关测试在环境缺失时跳过。

## 第二版项目：Workbench Core

### 第二版为什么出现

第一版验证了受控 AI 写作工作台的完整工程链路，但论文章节、论文状态机、引用格式和论文工具与核心运行时耦合较深。第二版保留第一版经过验证的治理原则，将领域规则拆成可替换插件：

```text
Framework  → 大纲、章节、领域字段、状态机和 UI 标签
Logic      → 写作目标、承接关系、风格和重写建议
Evidence   → 引用格式、证据评估、来源绑定和参考文献
Material   → 材料类型、领域归类和材料分析
Exporter   → Markdown、Text、DOCX、LaTeX、PDF 等输出格式
```

这样，新增专利、合同或技术报告工作台时，通常只需新增领域插件，不必修改核心 Runtime。

### 第二版技术栈

| 层级 | 技术与实现 | 职责 |
| --- | --- | --- |
| 宿主 | DSH `0.1.1-rc.2`、Cordis patch | 插件加载、工具注册、预设组合和 Web 注入 |
| Runtime | Node.js 22+、原生 ESM、JavaScript | 项目生命周期、插件解析和能力编排 |
| 持久化 | JSON、`node:fs/promises`、UUID | 项目、会话绑定、材料、运行记录、模板和快照 |
| 状态机 | 显式 State × Event 表、revision 冲突检测 | 规划、检索、生成、校验、审查和终止 |
| 插件注册 | Framework / Logic / Evidence / Material / Exporter Registry | 按 `taskType` 解析领域能力 |
| 规格系统 | Plugin Spec JSON、校验器、规格编译器 | 生成可审阅、可安装的任务插件 |
| 文档服务 | `officeparser`、`pdfjs-dist`、文本解析器 | 材料导入和文本提取 |
| 检索服务 | 分块、192 维 hash embedding、关键词/向量混合 | 通用材料检索和证据绑定 |
| 导出服务 | Core Markdown/Text + Exporter 扩展点 | 统一发现和调用多格式导出器 |
| Web 工作台 | Node `http`、原生 HTML/CSS/JavaScript | 通用双区可拖拽 UI，默认 :3200 |
| 工具适配 | DSH、OpenAI、Claude、LangChain、JSON | `src/expose-tools.js` 多平台调用 |
| 测试 | Node `node:test`、Runtime E2E | 核心、插件、工具桥和导出契约 |

第二版根项目不依赖 React、TypeScript 或数据库服务。核心内置 Markdown 和纯文本，领域插件可以注册 DOCX、LaTeX、PDF 等导出器。

### 第二版架构

```text
DSH Host / Cordis
       │
       ├── AI Presets
       │     ├── Designer：设计和校验 Plugin Spec
       │     ├── Writer：按确认范围受控写作
       │     └── Reviewer：只读审查和建议
       │
       └── workbench-core Plugin
             ├── wb_* Tool Bridge
             ├── WorkbenchRuntime
             │     ├── Project + Session Binding
             │     ├── State Machine
             │     ├── Storage
             │     ├── Materials + Retrieval
             │     ├── Snapshots + Versions
             │     └── Exporter Registry
             ├── Domain Plugin Registry
             └── HTTP Workbench UI :3200
```

### 第二版插件与预设的关系

插件和 AI 预设不是同一种资产：

| 资产 | 负责什么 | 典型文件 |
| --- | --- | --- |
| 领域插件 | 系统具备什么能力 | `package.json`、`plugin.manifest.json`、`src/index.js` |
| AI 预设 | Agent 如何使用能力 | `agent.cordis.yml`、`preset.yml`、`skills/` |

关系是：

```text
AI 预设 → wb_* 工具 → Workbench Runtime → 领域插件能力
```

`workbench-designer-v0`、`workbench-writer-v0` 和 `workbench-reviewer-v0` 是预设；`thesis`、`patent` 以及生成的 `contract-workbench` 是领域插件。

### 第二版使用

```powershell
Set-Location D:\雷达毕设相关\high_star\workbench-core
npm.cmd ci
npm.cmd run setup
npm.cmd test
npm.cmd run check
dsh plugin --profile web add .
```

重启 DSH 后打开 `http://127.0.0.1:3200`。在对话中可以说：

```text
创建一个发明专利项目，名称为“一种基于毫米波雷达的物料水分检测装置及方法”
```

工作台流程为：创建项目、确认大纲、导入材料、检索证据、受控生成、审查修订、保存快照，最后调用 `wb_list_export_formats` 和 `wb_export_document` 导出。

### 第二版构建新工作台

```text
wb_analyze_task_description
        ↓
wb_create_plugin_spec_draft
        ↓
wb_validate_plugin_spec
        ↓
wb_generate_plugin_bundle
        ↓
wb_verify_generated_plugin_bundle
        ↓
安装 generated-plugins/<taskType>-workbench
```

生成器输出隔离的插件包，不修改核心源码。若需要新的 AI 行为，创建独立 Agent Preset；若需要新的文件格式，在领域插件中注册 Exporter。

### 第二版导出能力

导出器是正式插件能力。核心 Runtime 根据 `taskType + format` 选择导出器：

```js
import { registerExporter } from 'dsh-workbench-core/core'

registerExporter({
  id: 'patent-docx-exporter',
  name: '专利 DOCX',
  taskType: 'patent',
  format: 'docx',
  async export(project, input) {
    return { format: 'docx', filename: `${project.name}.docx`, data: 'base64-data' }
  },
})
```

工作台和 AI 预设不需要硬编码格式，会先读取当前项目的导出能力。第一版的 `docx-exporter.js` 和 `latex-exporter.js` 可以迁移为第二版的论文领域 Exporter；专利插件也可以提供自己的申请文件模板。

## 两个版本的对照

| 维度 | 第一版 `thesis-agent` | 第二版 `workbench-core` |
| --- | --- | --- |
| 定位 | 论文专用完整 Agent 应用 | 通用多领域工作台框架 |
| 核心成果 | 证据约束、双 Agent、版本事务、论文导出 | 插件化 Runtime、Plugin Spec、Exporter Registry |
| 工具 | 约 65 个 `thesis_*` 工具 | `wb_*` 通用工具和多平台适配 |
| 状态机 | 论文 AgentRun 固定流程 | 每个 Framework 自己声明流程 |
| 存储 | JSON / SQLite 适配 | 通用 JSON Storage |
| 检索 | Embedding、Rerank、RAGFlow 适配完整 | 通用本地检索基础能力 |
| 导出 | DOCX、LaTeX、可选 PDF 已实现 | Markdown/Text 内置，其他格式插件化 |
| AI 预设 | Thesis Writer / Thesis Review | Designer / Writer / Reviewer |
| UI | 论文专用 :3199 | 通用工作台 :3200 |

第二版不是简单复制第一版，而是把第一版验证过的 Agent 工程原则提取成公共协议。`thesis-agent/` 继续作为论文领域完整实现和迁移参考。

## 安全边界

- AI 输出必须经过结构校验、证据检查和用户确认；
- Reviewer 默认不能修改正文，Writer 与 Reviewer 使用不同工具白名单；
- 写操作使用 revision 或版本保护，支持快照、差异和恢复；
- 材料导入只处理用户明确选择的文件；
- 不自动登录、不自动提交外部表单、不绕过验证码；
- API Key 不写入源码、Plugin Spec、模板或提交记录；
- PDF 导出依赖领域实现和 XeLaTeX 环境，失败时应返回编译日志。

## 测试

```powershell
# 第二版
npm.cmd test
npm.cmd run check

# 第一版
Set-Location .\thesis-agent
npm.cmd test
npm.cmd run check
```

## 许可证

根项目和 `thesis-agent` 均采用 MIT 许可证；第三方依赖、DSH 平台和可选外部服务遵循各自许可证及使用条款。
