# Workbench Creator · AI 原生工作台插件构建框架

Workbench Core 是面向 DSH（DeepSeek Harness）的结构化文本工作台执行与治理插件。它提供项目、材料、证据、写作、审查、版本、审计、导出和领域插件生成能力；自然语言协作入口由同级独立项目 `../text-workbench-assistant/` 提供。

当前内置论文和专利两类领域能力，支持将同一套项目、材料、证据、写作、审查、版本和导出机制复用于论文、专利、合同、技术报告等任务。根目录仅保留抽象后的通用 Workbench Core；领域工作台应作为与本包并列的独立插件包保存。

> 重要定位：项目是“两层结构”——插件构建层负责创建任务工作台；工作台运行层负责在已创建的项目内规划、生成、审查和导出内容。

## 30 秒理解两层结构

~~~text
任务描述
   ↓
插件构建层：AI 预设 + Plugin Spec + 确定性校验 + 插件生成
   ↓
领域工作台：项目、材料、证据、逻辑块、状态机和导出器
   ↓
工作台运行层：规划 + 受控生成 + 审查 + 版本 + 多格式导出
~~~

### 第一层：插件结构与构建层

插件构建层位于核心 Runtime 和领域插件之上。独立的“文本生成工作台助手”在 `design` 阶段分析任务并生成 Plugin Spec；Runtime 负责校验规格、生成隔离插件包、验证插件能力和注册导出器。构建阶段不会直接修改已有项目，也不会把模型密钥写入生成产物。

这一层的产物是一个独立的任务插件，包括 Framework、Logic、Evidence、Material 和可选 Exporter 能力。AI 预设是使用这些能力的行为配置，不等同于领域插件本身。

### 第二层：插件构建出的工作台运行层

独立工作台加载领域插件，通过统一 Runtime 提供项目创建、会话绑定、材料导入、证据检索、逻辑块写作、审查、快照恢复和导出。模型只能返回回答或候选变更；结构校验、状态转移、版本写入和审计由确定性代码负责。

## 核心理念：AI 原生，但由工作台约束 AI

- **项目是任务的中心**：AI 围绕当前项目、逻辑块、材料、证据和版本工作，而不是只进行无状态聊天。
- **认知与治理分离**：模型负责理解、规划、生成和建议；Runtime 负责权限、状态、校验、版本和写入。
- **所有写入都可审查**：生成内容先成为候选 Patch，经过差异预览和用户确认后才进入新 revision。
- **能力与行为分离**：领域插件声明系统能做什么，AI 预设声明 Agent 如何使用这些能力。
- **导出是插件能力**：工作台发现当前领域支持的格式，不把 DOCX、PDF 等格式写死在通用 UI 中。

## 快速开始：先运行内置工作台

### 环境要求

- Node.js **22.19.0 或更高版本**；
- Windows 建议使用 `npm.cmd`；
- Core 使用 Node 内置 SQLite（无需独立数据库服务）；
- 基础 Markdown/Text 导出无需外部服务；
- DOCX 使用 `docx`，PDF 通常通过领域 Exporter 和 XeLaTeX 生成。

### 安装、验证与启动

~~~powershell
npm.cmd ci
npm.cmd test
npm.cmd run check
~~~

安装到 DSH（只安装构建能力，不启动 UI 或后台 HTTP 服务）：

~~~powershell
dsh plugin --profile web add .
~~~

随后在 DSH 中明确提出构建和打开请求，例如：

~~~text
为“雷达水分检测”项目构建专利工作台；先给我审阅 Plugin Spec。
确认后，请先询问我是否生成到默认插件目录；生成后再询问我是否立即安装。
安装完成后，将该工作台绑定到“雷达水分检测”项目并打开。
~~~

自然语言协作需要单独安装同级 Agent 项目：

~~~powershell
cd ..\text-workbench-assistant
npm.cmd run setup
~~~

`wb_open_workbench` 的 `projectId` 可选：省略时打开项目首页，用户可在页面创建、选择或绑定项目；传入时先把当前会话绑定到指定项目。

### 工作台反向发起 DSH 对话

由 `wb_open_workbench` 返回的链接从 DSH 中打开后，页面可把用户操作提交回**同一个 DSH 会话**：

- 在正文中选中一段文字，点击“让 DSH 重写选中文本”，输入重写要求；
- 在“审查”页点击“请 DSH 审查当前文本”。

页面只向 DSH 会话提交结构化提示，不持有模型密钥，也不直接调用模型。Writer 应通过 `wb_set_manuscript` 保存完成的改写；Review Agent 应通过 `wb_add_review_suggestion` 保存每条建议，页面会自动刷新并显示结果。该桥只接受 `localhost` / `127.0.0.1` 工作台页面的请求，且要求会话 ID 完全匹配。请勿复制 URL 到独立浏览器窗口后再使用此能力，因为那样页面没有 DSH 的打开者窗口可回传消息。

### 工作台内使用方法

1. 创建或选择任务项目并确认当前会话绑定；
2. 查看领域插件生成的大纲、字段和逻辑块；
3. 导入用户明确选择的材料，进行文本提取、分块和检索；
4. 在确认范围内生成内容，查看证据和候选修改；
5. 由 Reviewer 审查，用户确认后写入新版本；
6. 使用快照、diff 和恢复检查历史变化；
7. 调用 `wb_list_export_formats` 查看格式，再调用 `wb_export_document` 导出。

## 利用 LLM 构建你的第一个任务工作台

你不需要先手动编写完整插件。进入独立的“文本生成工作台助手”，在 `design` 阶段说明需求：

~~~text
帮我构建一个关于“xxx”的任务工作台。
请先理解插件契约，设计 Plugin Spec 并生成 MVP 供我确认；
确认后再生成完整插件包，完成校验、安装、测试和导出能力验证。
所有产物放在隔离目录，不要覆盖核心项目或读取未授权密钥。
~~~

LLM 执行时应经历“分析任务 → 设计 Spec → 生成 MVP → 用户确认 → 生成插件 → 校验 → 安装 → 验收”流程。MVP 未确认前不应继续生成完整领域配置。

## 技术介绍

### 技术栈

| 技术领域 | 采用方案 | 作用 |
| --- | --- | --- |
| 宿主平台 | DSH `@deepseek-ai/dsh@0.1.1-rc.2`、Cordis Patch | 插件加载、工具注册和 Web 注入 |
| 运行时 | Node.js `^22.19.0 || >=24.0.0`、原生 ESM | 项目生命周期和能力编排 |
| 数据与存储 | SQLite（WAL）、UUID、Node 内置 `node:sqlite` | 项目、会话、材料、运行记录、快照与审计 |
| 工具契约 | JSON Schema、Plugin Spec、revision 检查 | 参数校验、插件校验和并发保护 |
| 材料服务 | `officeparser@7.8.0`、`pdfjs-dist@6.2.108` | 文档解析和文本提取 |
| 检索服务 | 分块、192 维 hash embedding、关键词/向量混合检索 | 材料召回和证据绑定 |
| 导出服务 | Markdown/Text 核心 Exporter、领域 Exporter Registry | 多格式能力发现和调用 |
| Web 工作台 | Node `http`、原生 HTML/CSS/JavaScript | 通用工作台，默认 `:3200` |
| 测试 | Node `node:test`、Runtime E2E | 核心、插件、工具桥和导出契约 |

### 系统分层

~~~text
DSH Host / Cordis
          ↓
独立 Agent 项目：text-workbench-assistant（design / write / review）
          ↓
wb_* Tool Bridge
          ↓
Workbench Runtime：项目、会话、状态机、存储、版本
          ↓
Domain Plugins：Framework / Logic / Evidence / Material / Exporter
          ↓
HTTP Workbench UI + 任务项目数据
~~~

- `src/core/` 保存通用 Runtime、状态机、存储、插件规格和注册中心；
- `src/plugins/` 保存论文和专利等领域能力；
- `../text-workbench-assistant/` 保存唯一 Agent 预设、Persona 和 Skill；
- `src/services/` 保存材料解析、检索、版本和导出服务；
- 论文等领域工作台作为与本目录并列的独立 DSH 插件包保存，不纳入本包目录。

### AI Agent 与受控写入

典型运行路径如下：

~~~text
项目 / 逻辑块 / 材料 / 证据 / 当前版本
                  ↓
             Context Builder
                  ↓
             LLM 或本地 Agent
                  ↓
             回答 / 候选 Patch
                  ↓
          Schema + 领域规则校验
                  ↓
             Review → diff 预览
                  ↓
               用户确认
                  ↓
            新 revision + 审计
~~~

统一助手显式维护 `design`、`write`、`review` 阶段。Workbench Core 在工具执行边界校验当前会话阶段；`review` 阶段没有正文写入和恢复权限，写操作继续受状态机、版本和审批边界约束。

### 插件构建机制

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
~/.dsh/workbench-plugins/<taskType>-workbench
~~~

生成器输出隔离插件包，默认写到 `~/.dsh/workbench-plugins/<taskType>-workbench`，不修改核心源码或在项目中创建子目录。Framework、Logic、Evidence、Material 和 Exporter 通过 `taskType` 注册与解析；AI 预设通过 `wb_*` 工具调用 Runtime，而不是直接调用文件或数据库写入。

### 导出服务

核心 Runtime 内置 Markdown 和纯文本导出。领域插件可以注册 DOCX、LaTeX、PDF 等能力：

~~~js
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

工作台先调用 `wb_list_export_formats` 读取当前项目的可用格式，再调用 `wb_export_document`。因此不同 Workbench 可以复用同一套导出调用协议，同时使用各自的模板和文件生成实现。

## 当前能力

| 层 | 能力 | 状态 |
| --- | --- | --- |
| Runtime | 项目、会话、状态机、SQLite-only 存储、版本和审计 | ✅ 可用 |
| 插件 | Framework、Logic、Evidence、Material 注册与按任务解析 | ✅ 可用 |
| 阶段治理 | design、write、review 会话阶段与工具执行边界 | ✅ 可用 |
| 材料与检索 | 多格式解析、分块、Embedding 和混合检索 | ✅ 可用 |
| 插件构建 | Spec 草案、校验、生成和生成包验证 | ✅ 可用 |
| 导出 | Markdown/Text 核心能力，其他格式插件化扩展 | ✅ 可用 |
| 领域 | Thesis、Patent 内置；其他任务按插件接入 | 🔧 扩展中 |

## 使用插件构建新的任务工作台

### 1. 查看插件能力

~~~powershell
node -e "import('./src/generator.js').then(m => console.log(m))"
~~~

统一助手通过 `../text-workbench-assistant/` 中的 Skill 理解 `src/core/plugin-spec.js` 契约。

### 2. 设计并校验 Plugin Spec

Spec 描述任务类型、名称、Framework、Logic、Evidence、Material、Exporter 和工作流规则。生成后必须经过确定性校验，不能把“模型生成成功”当成“插件可安装”。

### 3. 生成并验证插件包

~~~text
分析任务 → 生成 MVP → 用户确认 → 生成完整 Spec
→ 校验 → 生成隔离插件 → 验证 manifest、入口和能力注册
~~~

### 4. 在独立工作台中验收

验收重点是：项目是否能创建和绑定、领域字段是否生效、材料是否能导入、生成是否受用户确认约束、Reviewer 是否保持只读、快照和恢复是否有效，以及 `wb_list_export_formats` 与 `wb_export_document` 是否返回正确的导出结果。

## 安全边界与数据说明

- 构建层不读取或测试项目中已有的 Provider Key；
- API Key 不进入 Plugin Spec、模板、生成插件或提交记录；
- LLM 输出只能成为回答或候选 Patch，不能直接调用仓库写入方法；
- Schema、领域规则、状态机和用户确认不能被语义模型绕过；
- 生成插件必须写入隔离目录，避免覆盖核心项目和其他任务；
- 材料导入只处理用户明确选择的文件；
- 不自动登录、不自动提交外部表单、不绕过验证码；
- 导出失败时返回明确的格式、依赖和编译日志。

## 项目目录

~~~text
src/index.js                 wb_* 工具入口和 DSH 适配
src/expose-tools.js          多平台工具桥
src/core/                    Runtime、状态机、存储、规格和插件注册
src/plugins/thesis/          论文 Framework / Logic / Evidence / Material
src/plugins/patent/          专利 Framework / Logic / Evidence / Material
src/services/                材料、检索、版本和导出服务
src/generator.js             Plugin Spec 编译和插件包生成
src/work-stage.js            统一助手阶段和工具授权规则
tests/                       核心、E2E、插件和导出契约测试
../thesis-agent/             独立论文写作工作台（示例位置）
../text-workbench-assistant/ 唯一 DSH Agent 预设项目
~~~

## 常用命令

~~~powershell
npm.cmd ci
npm.cmd test
npm.cmd run check
~~~

## 相关文档

- [拆分、同步与持久化开发计划](docs/DEVELOPMENT_PLAN.md)
- 第一版论文工作台：与本包并列的 `../thesis-agent/`
- [插件规格实现](src/core/plugin-spec.js)
- [插件生成器](src/generator.js)

## 许可证

本项目采用 MIT 许可证。第三方依赖、DSH 平台和可选外部服务遵循各自的许可证及使用条款。
