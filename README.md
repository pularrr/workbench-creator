# Workbench Creator · AI 工作台插件构建框架

Workbench Creator 是一个面向 DSH（DeepSeek Harness）的 AI 工作台框架。它从第一版论文写作智能体 `thesis-agent` 出发，将证据约束、人工审批、版本事务、多 Agent 权限隔离和多格式导出抽象为可复用的 `workbench-core` 运行时。

本仓库包含两个版本：

- `thesis-agent/`：第一版，论文领域的完整多 Agent 写作工作台；
- 根目录：第二版，支持论文、专利、合同和技术报告的通用工作台插件框架。

## 30 秒理解两层结构

~~~text
任务描述
    ↓
AI 预设：分析任务、设计 Plugin Spec、生成并校验插件
    ↓
领域插件：声明框架、逻辑、证据、材料和导出能力
    ↓
Workbench Runtime：项目、会话、状态机、材料、版本和权限
    ↓
Web 工作台：规划、写作、审查、快照、导出
~~~

### 第一层：插件与 AI 预设构建层

插件构建层负责生成工作台。AI 预设负责分析任务、生成 MVP 和完整插件规格；`workbench-core` 提供 `wb_*` 工具、规格校验、插件生成和安装验证；领域插件声明任务类型、逻辑规则、证据规则、材料类型和导出器。构建产物写入隔离目录，不覆盖核心源码。

~~~text
任务描述 → Plugin Spec 草案 → 用户确认 MVP
→ 完整插件规格 → 确定性校验 → 生成插件包 → 安装与验证
~~~

### 第二层：插件构建出的工作台运行层

工作台运行层负责项目创建、会话绑定、大纲、逻辑块、材料、证据、状态机、审查、快照、版本和导出。模型负责理解、生成和提出候选内容，不能绕过 Runtime 直接修改项目；用户确认是受控写入的最后一道门。

## 第一版项目：`thesis-agent`

### 项目介绍

`thesis-agent` 是一个证据驱动的论文写作智能体工作台，不是输入题目后直接生成整篇论文的 Demo。它把大模型写作中的三个问题落实到工程约束中：

1. **幻觉控制**：模型不能随意编造文献、数字和实验结论；
2. **过程可控**：AI 不能跳过规划、覆盖锁定内容或直接提交最终修改；
3. **结果可追溯**：正文必须追溯到材料、证据、版本和审批记录。

### 第一版核心能力

- 多 Agent 协作：Writer 负责规划、检索、生成和受控修改，Reviewer 使用独立只读工具；
- 证据约束生成：材料先解析、分块、索引，缺少证据时使用 `[待补充证据]` 占位；
- 受控 AgentRun：状态×事件表、预算上限、审计轨迹、暂停、恢复和取消；
- 块级正文模型：正文块拥有 ID、章节关系、逻辑绑定、锁定状态和 revision；
- 版本事务：命名快照、块级 diff、无损恢复、乐观并发和 Patch 二次审批；
- 材料处理：支持 PDF、DOCX、PPTX、XLSX、ODF、RTF、HTML、EPUB；
- 论文导出：DOCX、LaTeX 和可选 PDF，支持公式、章节、参考文献和模板；
- DSH 对话与 Web 工作台联动：自然语言操作与结构化编辑分工协作。

### 第一版技术栈

| 技术领域 | 采用方案 | 作用 |
| --- | --- | --- |
| 宿主平台 | DSH `@deepseek-ai/dsh@0.1.1-rc.2`、Cordis Bundle | Agent、工具、Skill 和插件加载 |
| 运行时 | Node.js `^22.19.0 || >=24.0.0`、原生 ESM | 服务端和论文领域引擎 |
| 工具治理 | JSON Schema、Lossless-JSON、`expectedRevision` | 参数、返回值、权限和并发控制 |
| 文档解析 | `officeparser@7.8.0`、`pdfjs-dist@6.2.108` | 多格式材料和正文提取 |
| OCR | Tesseract、本地或 PaddleOCR HTTP 服务 | 扫描件和图片文字识别 |
| 检索 | local-hash 192 维、关键词 0.45 + 向量余弦 0.55 | Embedding 与证据召回 |
| 重排 | 本地 BM25 + Bigram、Cohere、Voyage | 检索结果重排和降级 |
| 存储 | JSON 文件、可选 SQLite WAL | 项目、材料、正文、版本和运行状态 |
| Web UI | 原生 HTML/CSS/JavaScript、Node `http` | 论文工作台，默认 `:3199` |
| 导出 | `docx@9.7.1`、自研 LaTeX、XeLaTeX | DOCX、LaTeX 和 PDF |
| 测试 | Node `node:test`、桥接回归脚本 | 领域功能和 DSH 集成验证 |

### 第一版运行流程

~~~text
创建项目 → 应用模板 → 确认大纲与逻辑
→ 导入材料 → 分块与检索 → 提交生成范围
→ 用户确认 → 生成正文 → 绑定证据
→ Reviewer 提交建议 → 用户审批修订
→ 快照 / diff / 恢复 → DOCX 或 LaTeX/PDF 导出
~~~

~~~powershell
Set-Location .\thesis-agent
npm.cmd ci
npm.cmd run setup
npm.cmd test
npm.cmd run check
dsh plugin --profile web add .
~~~

## 第二版项目：`workbench-core`

### 第二版技术介绍

第一版的论文章节、引用格式、论文状态机和论文导出逻辑与领域实现绑定较深。第二版将稳定的治理能力提取到通用 Runtime，把领域差异放入插件，把 Agent 行为放入 AI 预设：

~~~text
Framework  → 大纲、章节、领域字段、状态机和 UI 标签
Logic      → 写作目标、承接关系、风格和重写建议
Evidence   → 引用格式、证据评估、来源绑定和参考文献
Material   → 材料类型、领域归类和材料分析
Exporter   → Markdown、Text、DOCX、LaTeX、PDF 等输出格式
~~~

新增专利、合同或技术报告工作台时，通常只需生成新的领域插件，不需要修改核心 Runtime。

### 第二版技术栈

| 层级 | 技术与实现 | 职责 |
| --- | --- | --- |
| 宿主 | DSH `0.1.1-rc.2`、Cordis Patch | 插件加载、工具注册、预设组合和 Web 注入 |
| Runtime | Node.js 22+、原生 ESM、JavaScript | 项目生命周期、插件解析和能力编排 |
| 持久化 | JSON、`node:fs/promises`、UUID | 项目、绑定、材料、运行记录、模板和快照 |
| 状态机 | 显式 State × Event 表、revision 冲突检测 | 规划、检索、生成、校验、审查和终止 |
| 注册中心 | Framework / Logic / Evidence / Material / Exporter Registry | 按 `taskType` 解析领域能力 |
| 规格系统 | Plugin Spec JSON、校验器、规格编译器 | 生成可审阅、可安装的任务插件 |
| 文档与检索 | `officeparser`、`pdfjs-dist`、192 维 hash、混合检索 | 材料导入、文本提取和证据绑定 |
| 导出服务 | Core Markdown/Text + Exporter 扩展点 | 统一发现和调用多格式导出器 |
| Web 工作台 | Node `http`、原生 HTML/CSS/JavaScript | 通用 UI，默认 `:3200` |
| 工具适配 | DSH、OpenAI、Claude、LangChain、JSON | 多平台调用桥接 |
| 测试 | Node `node:test`、Runtime E2E | 核心、插件、工具桥和导出契约 |

第二版根项目不依赖 React、TypeScript 或数据库服务。核心内置 Markdown 和纯文本导出；DOCX、LaTeX、PDF 等格式通过领域插件注册。

### 第二版架构与资产关系

~~~text
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
             │     ├── Storage / Retrieval / Versions
             │     └── Exporter Registry
             └── HTTP Workbench UI :3200
~~~

插件和 AI 预设是两种不同资产：

| 资产 | 负责什么 | 典型内容 |
| --- | --- | --- |
| 领域插件 | 系统具备什么能力 | manifest、Runtime 入口、领域 Registry、Exporter |
| AI 预设 | Agent 如何使用能力 | Designer/Writer/Reviewer 的提示词、Skill 和工具白名单 |

调用关系为：

~~~text
AI 预设 → wb_* 工具 → Workbench Runtime → 领域插件能力
~~~

`thesis`、`patent` 以及生成的 `*-workbench` 属于领域插件；Designer、Writer、Reviewer 属于 AI 预设。插件提供能力，预设决定 Agent 如何安全地使用能力。

### 第二版导出能力

导出器是正式的插件能力，不由 UI 或 AI 预设硬编码格式。Runtime 根据 `taskType + format` 查找导出器，工作台先发现当前项目可用格式，再调用统一接口：

~~~js
import { registerExporter } from 'dsh-workbench-core/core'

registerExporter({
  id: 'patent-docx-exporter',
  name: '专利 DOCX',
  taskType: 'patent',
  format: 'docx',
  async export(project, input) {
    return { format: 'docx', filename: project.name + '.docx', data: 'base64-data' }
  },
})
~~~

第一版的 `docx-exporter.js` 和 `latex-exporter.js` 可以迁移为论文领域 Exporter；专利插件可以注册申请文件模板和专利 DOCX/PDF 导出器。所有 Workbench 都可以通过 `wb_list_export_formats` 和 `wb_export_document` 调用多格式导出。

## 快速开始

### 环境要求

- Node.js 22 或更高版本；
- Windows 建议使用 `npm.cmd`；
- 基础功能无需数据库、API Key 或外部服务；
- PDF 编译需要 TeX Live 或 MiKTeX 的 XeLaTeX。

### 安装、验证与启动第二版

~~~powershell
npm.cmd ci
npm.cmd run setup
npm.cmd test
npm.cmd run check
dsh plugin --profile web add .
npm.cmd run workbench
~~~

重启 DSH 后打开 `http://127.0.0.1:3200`。典型流程是：创建项目 → 确认大纲 → 导入材料 → 检索证据 → 受控生成 → 审查修订 → 保存快照 → 发现并调用导出格式。

## 使用 AI 预设构建新的工作台

可以将项目目录交给能够读取本地文件并执行命令的宿主 LLM，要求它使用 Workbench Designer 预设或对应 Skill：

~~~text
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
~~~

MVP 未确认前不应继续生成完整领域网络。生成器负责确定性校验和隔离输出，AI 负责设计和语义内容，不负责绕过校验直接写入运行时。

## 当前能力

| 层 | 能力 | 状态 |
| --- | --- | --- |
| 核心 Runtime | 项目生命周期、会话绑定、状态机、JSON 存储、版本和审计 | ✅ 可用 |
| Agent 治理 | Designer/Writer/Reviewer 工具白名单和受控写入 | ✅ 可用 |
| 材料能力 | 多格式解析、分块、Embedding、混合检索和 Rerank 适配 | ✅ 可用 |
| 插件构建 | Plugin Spec 草案、校验、生成和生成包验证 | ✅ 可用 |
| 导出能力 | Markdown、Text 内置；DOCX、LaTeX、PDF 由领域插件扩展 | ✅ 扩展点可用 |
| Web 工作台 | 通用 UI、项目绑定、逻辑块、状态和导出入口 | ✅ 可用 |
| 论文领域 | `thesis-agent` 完整论文写作与 DOCX/LaTeX/PDF 导出 | ✅ 可用 |
| 专利等领域 | 通过独立领域插件接入 | 🔧 按插件实现 |

## 项目目录

~~~text
src/index.js                 wb_* 工具入口、权限策略和 DSH 适配
src/expose-tools.js          DSH、OpenAI、Claude、LangChain 等工具桥
src/core/runtime.js          Workbench Runtime、项目、状态机和导出编排
src/core/plugin-loader.js    领域插件和 Exporter Registry
src/core/workbench-server.js Web 工作台页面和 HTTP API
src/services/                材料、检索、版本和导出服务
src/generator.js             Plugin Spec 编译和插件包生成
generated-plugins/           生成插件的隔离输出目录
thesis-agent/                第一版论文写作工作台子项目
assets/presets/              Designer、Writer、Reviewer 等 AI 预设
tests/                       Runtime、插件、工具桥和导出契约测试
~~~

## 安全边界与常用命令

- AI 输出必须经过 Schema、领域规则、证据检查和用户确认；
- Reviewer 默认不能修改正文，Writer 与 Reviewer 使用不同工具白名单；
- 写操作使用 revision 或版本保护，支持快照、差异和恢复；
- API Key 不写入源码、Plugin Spec、模板或提交记录；
- 生成插件必须写入隔离目录，不能覆盖核心项目；
- 导出失败时应返回明确的格式、依赖和编译日志。

~~~powershell
npm.cmd run setup       # 检查运行时配置
npm.cmd test            # 运行全部测试
npm.cmd run check       # 运行检查
npm.cmd run workbench   # 启动 Workbench UI
~~~

## 相关文档

- [第一版论文工作台](thesis-agent/README.md)
- [导出能力说明](EXPORT_README.md)
- [插件生成器](src/generator.js)

## 许可证

根项目和 `thesis-agent` 均采用 MIT 许可证。第三方依赖、DSH 平台和可选外部服务遵循各自的许可证及使用条款。
