# Workbench Creator · AI 工作台构建与运行框架

Workbench Creator 是一个面向 DSH 的可插拔 AI 工作台框架。项目分为两层：插件助手负责构建领域工作台，工作台运行层负责在已构建项目中完成受控工作。

本仓库包含根目录的通用 `workbench-core`，以及作为论文领域参考实现的 `thesis-agent/` 子项目。

## 两层关系

```text
用户提出领域需求
        ↓
第一层：插件助手 / Designer Preset
        ↓
设计、校验并生成领域插件包
        ↓
第二层：Workbench 工作台运行层
        ↓
创建项目 → 确认大纲 → 导入材料 → 生成 → 审查 → 版本 → 导出
```

### 第一层：插件助手与构建层

插件助手不是具体的写作工作台，而是工作台构建助手。它负责识别任务类型，设计 Plugin Spec，定义章节、状态机、材料类型、领域字段、证据规则和导出能力，并生成隔离的可安装插件包。

当前 AI 预设包括：

- `workbench-designer-v0`：需求分析、规格设计、校验和插件生成；
- `workbench-writer-v0`：按确认范围执行受控写作；
- `workbench-reviewer-v0`：只读审查、证据检查和修改建议。

AI 预设只规定 Agent 的行为和工具权限；项目数据、确定性校验、状态机、版本和导出由插件及 Runtime 负责。

生成的领域插件通常包含 `plugin.manifest.json`、`plugin-spec.json`、`src/index.js`、Framework、Logic、Evidence 和 Material 文件。插件是领域能力，不等同于 AI 预设。

### 第二层：工作台运行层

Runtime 根据 `taskType` 解析领域插件，并提供项目管理、大纲和写作逻辑、材料检索、证据绑定、受控状态机、快照版本、重新生成和多格式导出。模型只能提出内容或修改候选，结构校验、状态转换和版本写入由确定性代码执行。

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
