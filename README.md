# Workbench Creator · AI 工作台构建与运行框架

Workbench Creator 是一个面向 DSH 的可插拔 AI 工作台框架。项目分为两层：插件助手负责构建领域工作台，工作台运行层负责在已构建项目中完成受控工作。

本仓库包含根目录的通用 `workbench-core`，以及作为论文领域参考实现的 `thesis-agent/` 子项目。

当前版本：`workbench-core 0.1.0`；论文参考子项目版本：`thesis-agent 1.2.0`。

## 技术栈总览

| 层次 | 技术与实现 | 主要职责 |
| --- | --- | --- |
| 宿主平台 | DSH `0.1.1-rc.2` peer dependency、Cordis plugin patch | 插件加载、工具注册、AI 预设组合和 Web 注入 |
| 运行环境 | Node.js 22+、原生 ESM、npm | 服务端运行、插件加载、文件处理和脚本执行 |
| 核心 Runtime | JavaScript、`WorkbenchRuntime` | 项目生命周期、插件解析、状态机、材料、版本和导出调度 |
| 插件契约 | Framework / Logic / Evidence / Material / Exporter | 领域结构、写作逻辑、证据规则、材料适配和文件格式 |
| 状态机 | 自定义显式 State × Event 表 | 规划、检索、生成、校验、审查、应用和终止状态控制 |
| 持久化 | JSON 文件存储、`node:fs/promises`、UUID | 项目、会话绑定、正文、材料、运行记录、模板和快照 |
| 文档解析 | `officeparser`、`pdfjs-dist`、自定义文本解析 | TXT、Markdown、CSV、JSON、PDF、DOCX、PPTX、XLSX、ODF、RTF、EPUB 等材料导入 |
| 本地检索 | 分块、192 维 hash embedding、关键词与向量混合检索 | 材料搜索、来源片段定位和证据绑定 |
| Web 工作台 | Node `http` 服务、原生 HTML/CSS/JavaScript | 双区编辑器、项目选择、大纲、逻辑、材料、版本和导出 UI |
| DSH 侧边栏 | `client.js`、Conversation UI 注入 | 在 DSH 对话旁打开和跟随当前工作台项目 |
| 导出 | 核心 Markdown/Text；插件可扩展 DOCX/LaTeX/PDF | 统一导出接口和按任务类型选择导出器 |
| 测试 | Node.js built-in `node:test`、端到端 Runtime 测试 | 插件注册、状态机、项目生命周期、工具桥接和导出契约验证 |

根项目不使用 React、TypeScript 或数据库服务；工作台 UI 是随 Node 服务返回的原生页面，数据默认保存在本地 JSON 文件。`thesis-agent` 是独立的论文专用实现，额外提供 DOCX 生成、LaTeX/PDF 编译、模板包、SQLite 适配和更完整的论文 Agent 工具集。

## 核心工程架构

```text
DSH Host / Cordis
       │
       ├── AI Presets
       │     ├── Designer：设计 Plugin Spec
       │     ├── Writer：受控写作
       │     └── Reviewer：只读审查
       │
       └── workbench-core Plugin
             ├── DSH Tool Bridge：wb_*
             ├── WorkbenchRuntime
             │     ├── Project + Session Binding
             │     ├── State Machine
             │     ├── Storage
             │     ├── Materials + Retrieval
             │     ├── Snapshots + Versions
             │     └── Exporter Registry
             ├── Plugin Registry
             │     ├── Framework
             │     ├── Logic
             │     ├── Evidence
             │     ├── Material
             │     └── Exporter
             └── HTTP Workbench UI :3200
```

### 核心模块职责

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 插件入口 | `src/index.js` | DSH `apply()`、工具注册、预设策略和工作台服务启动 |
| 工具适配 | `src/expose-tools.js` | 将同一组 Runtime 能力转换为 DSH、OpenAI、Claude、LangChain 和 JSON 格式 |
| Runtime | `src/core/runtime.js` | 编排存储、插件、状态机、材料、快照和导出器 |
| 插件注册 | `src/core/plugin-loader.js` | 注册/解析领域插件、外部 bundle 和 Exporter |
| Plugin Spec | `src/core/plugin-spec.js` | 校验 JSON 规格并编译成四层领域插件 |
| 持久化 | `src/core/storage.js` | 本地 JSON 状态、项目绑定、运行记录和快照 |
| 状态机 | `src/core/state-machine.js` | 显式事件转换、推荐事件、跳过阶段、revision 冲突检测 |
| 材料服务 | `src/core/material-parser.js`、`src/services/document-service.js` | 单文件导入、类型识别和 Office/PDF 文本提取 |
| 检索服务 | `src/services/retrieval-service.js` | 文本分块、本地 embedding 和混合搜索 |
| 导出服务 | `src/services/export-service.js` | 核心导出器及 Exporter 注册契约 |
| Web 服务 | `src/core/workbench-server.js` | HTTP API 和双栏工作台页面 |
| 侧边栏 | `client.js` | DSH Web 侧边栏注入和项目自动跟随 |

## 插件契约与扩展方式

一个领域工作台由多个独立能力组成：

```text
Framework  → 章节、大纲、领域字段、状态机和 UI 标签
Logic      → 每个章节的写作目标、承接关系和重写建议
Evidence   → 引用格式、证据评估、来源绑定和参考文献
Material   → 材料类型、归类、摘要和领域使用建议
Exporter   → markdown / text / docx / latex / pdf 等文件格式
```

Exporter 是按 `taskType + format` 解析的插件能力。核心提供通用 Markdown 和纯文本；论文或专利插件可以注册自己的 DOCX、LaTeX 或 PDF 实现。工作台先通过 `wb_list_export_formats` 获取能力，再调用 `wb_export_document`，因此 UI 和 AI 预设都不需要硬编码具体格式。

外部插件通过 `plugin.manifest.json` 声明身份和能力，通过 `src/index.js` 的 `apply()` 调用核心公共 API 注册。插件应依赖同一份 `dsh-workbench-core`，避免出现两个独立的插件注册表。

## 数据流与受控 AI 工作流

```text
用户需求
   ↓
Designer Preset → Plugin Spec → 静态校验 → 隔离插件包
                                      ↓ 安装
项目 / 大纲 / 材料 / 当前正文
   ↓
Writer Preset → wb_* 工具 → Runtime → 领域插件
                                      ↓
                              候选内容 / 修改建议
                                      ↓
                         结构校验 + 证据检查 + 用户确认
                                      ↓
                          新版本、快照、导出文件
```

AI 预设不能绕过工具权限直接写入文件或状态。Runtime 负责确定性操作，模型负责自然语言理解、候选内容和语义建议；Reviewer 默认只读或只提交审查建议。

## 存储、材料和检索

根项目默认使用 `~/.dsh/storages/workbench-core/state.json`，保存项目和会话绑定。项目记录包含大纲、逻辑块、正文块、材料、来源片段、来源绑定、模板、运行记录、重生成请求和快照。

材料导入必须是用户明确选择的单个文件。`document-service` 负责检查路径、文件大小和扩展名，再使用 `officeparser` 转换 Office/PDF 等内容；图片材料保留元数据，OCR 由可选领域能力负责。检索服务先进行文本分块，再结合本地 hash embedding 和关键词匹配返回来源片段，正文通过显式 binding 保留可追溯关系。

## 导出设计

核心导出器位于 `src/services/export-service.js`，默认返回 Markdown 或纯文本。领域导出器可以返回 UTF-8 `content`、Base64 `data` 或明确的 `outputPath`，并提供 `filename` 与 `mimeType`。

论文子项目已经包含可迁移的实现：

- `thesis-agent/src/docx-exporter.js`：使用 `docx` 生成带标题、段落、缩进、公式和参考文献的 DOCX；
- `thesis-agent/src/latex-exporter.js`：生成 `ctexart`、数学公式和参考文献，并可调用 XeLaTeX 生成 PDF；
- PDF 编译依赖本机 TeX Live 或 MiKTeX 的 XeLaTeX，未安装时仍可导出 `.tex`。

## 与 `thesis-agent` 的关系

`workbench-core` 是可插拔通用框架，内置 `thesis` 和 `patent` 领域插件；`thesis-agent` 是论文专用的完整旧架构/参考实现。两者共享 DSH 插件生态和部分依赖，但不是同一个运行时项目：

| 对比项 | workbench-core | thesis-agent |
| --- | --- | --- |
| 定位 | 通用多领域工作台框架 | 论文专用工作台 |
| AI 预设 | Designer / Writer / Reviewer | Thesis Writer / Thesis Review |
| 领域扩展 | Plugin Spec 和 bundle 生成 | 论文固定工具与模板体系 |
| 存储 | 通用 JSON Storage | JSON，并提供 SQLite 适配 |
| 导出 | Markdown / Text + Exporter 扩展点 | DOCX、LaTeX、可选 PDF |
| UI | 通用双区工作台 | 论文专用工作台与模板设置 |
| 状态机 | 按 Framework 配置 | 论文 AgentRun 专用流程 |

## 安全与工程边界

- 不自动登录网站、不自动提交外部表单、不绕过验证码。
- 模型输出必须经过 schema、状态机、证据和用户确认边界。
- Reviewer 的工具白名单与 Writer 分离，避免审查 Agent 越权改正文。
- API Key 不写入 Plugin Spec、模板、生成包或提交记录。
- 生成插件写入隔离目录，不覆盖核心项目。
- 本地状态和导出文件由用户自行管理，重要文档应保留快照或备份。

## 安装与启动

环境要求：Node.js 22 或更高版本。

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd test
npm.cmd run check
dsh plugin --profile web add .
```

重启 DSH 后打开 `http://127.0.0.1:3200`。`npm.cmd run setup` 会把三个 Workbench AI 预设安装到 DSH 的 `.agent-presets` 目录。

## 工作台使用说明

在 DSH 对话中可以直接提出：

```text
创建一个发明专利项目，名称为“一种基于毫米波雷达的物料水分检测装置及方法”
```

典型流程：

1. `wb_create_project` 创建并绑定项目；
2. `wb_get_workbench` 查看项目、领域插件和大纲；
3. 确认或修改大纲；
4. 导入技术交底书、论文、专利和实验材料；
5. 检索材料并绑定正文证据；
6. 使用受控运行工具推进生成和审查；
7. 使用快照、差异和恢复管理版本；
8. 先调用 `wb_list_export_formats`，再调用 `wb_export_document` 导出。

## 插件化导出

导出器是正式的插件能力。核心内置 `markdown` 和 `text`，领域插件可以注册 `docx`、`latex` 或 `pdf`：

```js
import { registerExporter } from 'dsh-workbench-core/core'

registerExporter({
  id: 'thesis-docx-exporter',
  name: '论文 DOCX',
  taskType: 'thesis',
  format: 'docx',
  async export(project) {
    return {
      format: 'docx',
      filename: `${project.name}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: 'base64-encoded-file-content',
    }
  },
})
```

工作台会自动发现当前项目的导出器并生成 UI 按钮。PDF 导出器可以直接生成 PDF，也可以先生成 LaTeX，再调用 XeLaTeX 编译 PDF。

## 论文子项目：`thesis-agent/`

`thesis-agent/` 是论文领域的完整参考实现，不是 AI 预设。它包含论文项目、大纲、模板、多 Agent 工具权限隔离、证据感知写作、受控状态机以及：

- `src/docx-exporter.js`：DOCX 导出；
- `src/latex-exporter.js`：LaTeX 导出和可选 PDF 编译；
- 论文专用工作台 UI、工具和测试。

运行子项目：

```powershell
Set-Location .\thesis-agent
npm.cmd ci
npm.cmd test
npm.cmd run check
dsh plugin --profile web add .
```

PDF 编译需要本机安装 XeLaTeX；未安装时仍可导出 `.tex` 文件。

## 生成新的领域插件

插件助手的构建流程为：

```text
wb_analyze_task_description
wb_create_plugin_spec_draft
wb_validate_plugin_spec
wb_generate_plugin_bundle
wb_verify_generated_plugin_bundle
```

生成目录为 `generated-plugins/<taskType>-workbench/`，不会覆盖核心项目。安装生成包：

```powershell
Set-Location .\generated-plugins\<taskType>-workbench
npm.cmd install
dsh plugin --profile web add .
```

如果新任务需要专门的 AI 行为，应另外创建 Agent Preset；如果需要专门的文件格式，应在领域插件中注册 Exporter。

## 目录结构

```text
src/                         通用 Runtime 和内置 thesis/patent 插件
src/core/                    存储、状态机、插件注册和工作台服务
src/services/                文档、检索、版本和导出服务
assets/presets/              Designer、Writer、Reviewer AI 预设
scripts/                     预设安装和项目脚本
test/                        核心、插件、工具和端到端测试
generated-plugins/           生成插件输出目录（不提交）
thesis-agent/                论文专用完整子项目
```

## 安全边界

- Reviewer 默认不能修改正文；AI 只能使用被授予的工具。
- 模型输出必须经过结构校验、证据审查和用户确认。
- API Key 不应写入 Plugin Spec、模板或提交记录。
- 生成插件必须写入隔离目录。
- 导出器应返回可下载内容或明确的本地输出路径，并报告编译错误。

## 测试

```powershell
npm.cmd test
npm.cmd run check
```

论文子项目拥有独立测试和检查命令，进入 `thesis-agent/` 后执行同样的命令即可。
