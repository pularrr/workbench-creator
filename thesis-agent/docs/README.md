# dsh-thesis-agent 开发路线图与阶段文档

> 版本基线：v1.2.0（P1–P3 已合入；v1.1 新增 Embedding 对话引导配置 + 自动弹出侧边面板；v1.2 新增删除项目/模板系统/公式渲染修复/大纲图表信息/状态栏排版修复）
> 最近更新：2026-09-04
> 文档定位：P1–P3 三阶段开发的总索引、里程碑与验收标准。

## 阶段总览

| 阶段 | 版本 | 主题 | 核心交付 | 状态 |
|---|---|---|---|---|
| P0 | v0.4.x | 数据链路修复 | 工具桥无损序列化、output schema 兼容数组、回归测试 | ✅ 已完成 |
| P1 | v0.5–v0.6 | 检索增强与模板包 | rerank 层、学校模板包导入、DeepDoc/TSR/OCR、client UI 校验 | ✅ 已完成 |
| P2 | v0.7–v0.8 | 持久化与智能体可视化 | SQLite 存储、AgentRun 工作台可视化、参考结构提取、图表描述 | ✅ 已完成 |
| P3 | v1.0+ | 深度集成与可插拔架构 | 图表交叉引用、模板 Profile、RAGFlow Adapter、侧边面板 | ✅ 已完成 |
| v1.1 | v1.1.x | 对话引导配置 + 自动弹面板 | Embedding 预设一键配置、项目加载后自动打开工作台 | ✅ 已完成 |
| v1.2 | v1.2.0 | 工作台可用性 + 导出质量 + 模板系统 | 删除项目、模板上传/编辑、公式渲染修复、大纲图表信息、状态栏排版修复 | ✅ 已完成 |
| v2.0 | 计划中 | 可插拔工作台架构 | 三层插件化（框架/逻辑/凭证）、LLM 自主生成新任务工作台 | 📋 计划已写入，暂不开发 |

## 阶段文档索引

- [P1 · v0.5–v0.6 检索增强与模板包](./P1-v0.5-v0.6-检索增强与模板包.md)
- [P2 · v0.7–v0.8 持久化与智能体可视化](./P2-v0.7-v0.8-持久化与智能体可视化.md)
- [P3 · v1.0+ 深度集成与可插拔架构](./P3-v1.0-深度集成与可插拔架构.md)

## v1.1 增量：Embedding 对话引导配置（2026-09-04）

**动机**：设置 tab 裸奔 endpoint/model/apiKey 三字段对非技术用户是门槛；对话侧原 `thesis_set_embedding_config` 需 Agent 自行拼 config。目标：用户只说一句自然语言，Agent 一步完成配置。

**实现**：
- 新增 `src/embedding-presets.js`：6 个内置预设（deepseek/openai/qwen 通义/zhipu 智谱/siliconflow 硅基/ollama 本地），含 endpoint/model/dimensions/requiresKey，支持中文别名（"通义"→qwen、"本地"→ollama 等）。
- `domain-store.js` 新增 `setEmbeddingPreset`：解析预设 → 合并覆盖 → 可选连接测试（`test:false` 跳过）→ 保存配置 + Key（仅内存）→ 可选重建索引（`rebuild:false` 跳过）。`expectedRevision` 可选（缺省宽松，提供则强校验）。
- `index.js` 注册两个新工具：
  - `thesis_list_embedding_presets`：列出全部预设（供 Agent 动态感知）。
  - `thesis_set_embedding_preset`：一键对话配置，description 引导自然语言用法。
- `getEmbeddingStatus.credentialReady` 考虑 `requiresKey`（Ollama 免 Key 不再误报需凭据）。

**验证**：`npm test` 149 pass / 0 fail / 3 skip（新增 `test/embedding-presets.test.js` 8 项 + `test/embedding-preset-bridge.test.js` 5 项）；`node scripts/verify-p1-bridge.mjs` 7/7（含两个新工具 lossless + schema 双通过）。

**使用示例**（对话侧 Agent 自动执行）：
```
用户: 用硅基流动的 bge-m3，Key 是 sk-xxx
Agent: thesis_list_embedding_presets → thesis_set_embedding_preset{provider:'siliconflow', apiKey:'sk-xxx'}
```

**生效方式**：需重装插件 + 重启 DSH 进程使新工具注册与 3199 设置面板生效：
`dsh plugin --profile web remove dsh-thesis-agent && dsh plugin --profile web add . && npm run setup`

## v1.1.1 增量：加载项目后自动弹出工作台侧边面板（2026-09-04）

**动机**：用户加载项目文件后需手动开 3199/点按钮，不符合"全自然语言交互"。目标：用户说"加载这个文件夹"→ 工具建项目 → 侧边面板**自动滑出**。

**实现**：
- 后端 `domain-store.js` 新增 `followRecentProject(sessionId)`：会话未绑定时自动绑定到最近更新的项目；已绑定则不干预。注册新工具 `thesis_follow_recent_project`。
- `workbench-server.js` 新增 `POST /api/follow` 端点。
- `index.js`：`thesis_create_project` / `thesis_bind_project` / `thesis_import_source_text` / `thesis_import_source_file` / `thesis_get_workbench` 返回值注入 `workbenchUrl`（`withWorkbenchUrl` 包装器，异步安全，数组如 scan 结果不注入）。
- `client.js`：`apply()` 提前挂载隐藏面板；面板启动 3s 轮询 `/api/follow`，检测到项目首次出现时自动 `open()` 并记录 `localStorage.thesisAutoOpenedProject` 防重复；实现 `addToolResult` 钩子供未来宿主回调复用。

**能力边界**：自动弹**独立浏览器窗口**不可靠（宿主限制 + 弹窗拦截），因此采用"自动弹出侧边面板"；完整版仍由用户点「↗ 完整」。

**验证**：`npm test` 154 pass / 0 fail / 3 skip（新增 `test/workbench-follow.test.js` 5 项）；`node scripts/verify-p1-bridge.mjs` 8/8。

**生效方式**：同上重装插件命令。

## v1.1.2 增量：自然语言打开工作台 + 修复"等待连接"（2026-09-04）

**问题**：①3199 页面加载后停在"等待连接"（实际 API 正常，但未自动选择项目）；②DSH 里弹不出面板、无提示；③没有自然语言打开入口。

**修复**：
- `workbench-server.js`：页面 `projects()` 加载后，若无 active 项目则**自动选择第一个项目**并 bind/load；无项目时显示"暂无项目，请点击「新建」"。
- `index.js`：新增 `thesis_open_workbench` 工具——返回 `workbenchUrl` + `serverRunning` + 当前项目 + 三种打开方式（头部按钮/浏览器直开/对话继续）+ 故障排查 hint。用户说"打开工作台/怎么打开论文界面"即触发。
- `index.js`：`thesis_create_project` / `thesis_import_source_text` / `thesis_import_source_file` 的 description 追加"成功后调用 thesis_open_workbench 告知用户"，让 Agent 主动提示。

**验证**：`npm test` 156 pass / 0 fail / 3 skip；`verify-p1-bridge.mjs` 9/9。

**生效方式**：需**完全退出 DSH（含后台 node 进程）再重新打开**——`dsh plugin remove/add` 只更新注册，不热重载已运行进程。重启后在对话里说"打开工作台"即可验证。

## v1.1.3 增量：双区 4:3 可拖拽 + 重新生成按钮 + 联动 DSH 队列（2026-09-04）

**需求**：①工作台双区默认 4:3 且可拖拽调整左右宽度；②加"重新生成"按钮；③基于修改保存的文本块联动 DSH 重新生成。

**实现**：
- `workbench-server.js`：布局从 grid 改为 flex，左区默认 `flex:0 0 57%`（4:3），右区 `flex:1`；中间加 5px 可拖拽 `.resizer`（hover/active 变蓝，拖拽范围 30%-75%）；顶部加蓝色渐变「🔄 重新生成」按钮。
- `workbench-server.js`：新增 `POST /api/request-regeneration` 路由，提交当前正文内容 + 选中块 ID + 指令到队列。
- `domain-store.js`：新增 `requestRegeneration` / `listRegenerationRequests` / `resolveRegeneration` 三个方法；project 加 `regenerationRequests` 数组（{id, blockId, content, instruction, createdAt, status}）；`getWorkbench` 返回 pending 请求。
- `index.js`：新增 3 个工具——`thesis_request_regeneration`（工作台内部调用）、`thesis_list_regeneration_requests`（LLM 读取待处理请求，用户说"继续/重新生成"时触发）、`thesis_resolve_regeneration`（标记完成/取消）。

**联动流程**：用户在工作台修改正文 → 点「🔄 重新生成」→ 请求写入队列 → 回到 DSH 对话说"继续"→ LLM 调用 `thesis_list_regeneration_requests` 读取修改内容 → 基于修改重新生成 → 调用 `thesis_set_manuscript_blocks` 保存 → 调用 `thesis_resolve_regeneration` 标记完成 → 工作台刷新可见。

**验证**：`npm test` 160 pass / 0 fail / 3 skip；`verify-p1-bridge.mjs` 11/11。

**生效方式**：完全退出 DSH 再重新打开。

## v1.1.4 增量：修复 AgentRun 状态机事件名缺失（2026-09-04）

**问题**：论文生成状态机一直卡在"已取消"终态。根因是 `thesis_advance_agent_run` 工具描述只说"validated event"，但**没有列出合法事件名**，LLM 凭直觉试了 `plan/retrieve/draft/generate/execute` 等，全部不在状态机白名单里，连续被拒后只能 cancel。

**状态机合法事件表**（`src/agent-run.js` EVENTS）：
| 当前状态 | 合法事件 → 目标状态 |
|---|---|
| created | start → planning |
| planning | plan_ready → awaiting_plan_confirmation |
| awaiting_plan_confirmation | plan_confirmed → retrieving \| plan_rejected → cancelled |
| retrieving | retrieval_completed → evaluating_evidence \| fail → failed |
| evaluating_evidence | evidence_sufficient → drafting \| evidence_insufficient → retrieving |
| drafting | draft_completed → validating \| fail → failed |
| validating | validation_passed → reviewing \| validation_failed → drafting |
| reviewing | review_completed → awaiting_user_decision \| fail → failed |
| awaiting_user_decision | user_accepted → applying \| user_requested_revision → drafting \| user_rejected → cancelled |
| applying | apply_completed → completed \| fail → failed |

**修复**：
- `agent-run.js`：导出 `getValidEvents(state)` 和 `STATE_EVENT_TABLE` 常量；`advanceAgentRun` 报错时在错误信息里列出当前状态的合法事件。
- `domain-store.js`：`createAgentRun` / `getAgentRun` / `advanceAgentRun` 返回值新增 `validEvents` 字段，LLM 运行时可直接查到当前状态该用什么事件。
- `index.js`：`thesis_advance_agent_run` 工具描述写入完整的状态×事件对照表；`thesis_create_agent_run` 描述提示创建后用 `start` 事件推进。

**验证**：`npm test` 164 pass / 0 fail / 3 skip（新增 `test/agent-run.test.js` 4 项：合法事件查询、完整 happy-path 推进、非法事件报错信息、常量导出）。

**生效方式**：完全退出 DSH 再重新打开。重启后新建 AgentRun，LLM 会从工具描述和返回值里看到合法事件名，不再瞎猜。

## v1.1.5 增量：AgentRun 状态机可选跳过阶段（2026-09-04）

**需求**：简化 planning、awaiting_plan_confirmation、applying，使其成为可选的跳过状态。

**实现**：
- `agent-run.js`：新增 `AUTO_SKIP_EVENTS` 映射表和 `MODE_PRESETS` 预设；`createAgentRun` 接受 `mode`（full/standard/fast）和 `skipStages` 参数；`advanceAgentRun` 推进后自动跳过配置状态，跳过步骤记录为 `event: 'skipped'`，审计轨迹完整。
- `index.js`：`thesis_create_agent_run` 工具描述和参数新增 `mode` / `skipStages`。

**三种预设模式**：
| 模式 | 跳过状态 | 适用场景 |
|---|---|---|
| `full` | 无 | 完整治理流程 |
| `standard`（默认） | planning, awaiting_plan_confirmation | 计划已在项目层确认 |
| `fast` | planning, awaiting_plan_confirmation, applying | 快速草稿 |

**standard 模式效果**：`created → start → planning(跳过) → awaiting_plan_confirmation(跳过) → retrieving`。LLM 只需一次 `advance(start)` 直接进入检索。

**设计原则**：跳过不破坏审计轨迹（skipped 步骤）、不破坏乐观锁（revision+=1）、回退路径不受影响、自定义 skipStages 过滤非法状态名。

**验证**：`npm test` 167 pass / 0 fail / 3 skip。

## v1.2.0 增量：工作台可用性 + 导出质量 + 模板系统（2026-09-04）

**需求**（5 项）：
0. 工作台支持删除当前项目，删除后 DSH 提示用户更换/重新绑定
1. 自然语言交互上传项目/范文模板，工作台支持显示预设模板或解析范文模板后得到的模板（文本模板与格式模板），用户可二次编辑和保存
2. 修复 PDF/Word 公式渲染问题 + LaTeX 引用标题问题
3. 修复工作台状态栏超长导出路径挤压按钮的排版问题
4. 大纲中补充预计需要的表和图等多模态信息

### 问题 0：删除项目 + DSH 提示

**实现**：
- `domain-store.js`：新增 `deleteProject(projectId)`，删除项目 + 清理所有绑定到该项目的 sessionBindings + 持久化。
- `workbench-server.js`：新增 `DELETE /api/projects/:id` 路由；顶部加红色「删除」按钮，点击后 confirm 确认，删除后清空所有面板 + 提示"项目已删除，请选择或新建项目"。
- `index.js`：新增 `thesis_delete_project` 工具，描述明确要求删除后告知用户更换/重新绑定。
- `domain-store.js`：`#projectForSession` 错误信息改进，项目已删除或未绑定时列出可用项目 + 提示用 `thesis_list_projects` / `thesis_bind_project` / `thesis_create_project`。

### 问题 1：模板系统（文本模板 + 格式模板）

**实现**：
- `domain-store.js`：project 新增 `customTemplates: []` 字段；新增 `listCustomTemplates` / `getCustomTemplate` / `saveCustomTemplate`（创建或更新，revision 自增）/ `deleteCustomTemplate` 四个方法。模板结构：`{id, name, description, type('text'|'format'), content, revision, createdAt, updatedAt}`。
- `workbench-server.js`：新增 `GET/POST/DELETE /api/templates` 路由；右侧 tabs 新增「模板」tab，显示内置模板包（只读预览）+ 用户自定义模板（可编辑名称/说明/内容，保存/删除）；支持新建文本模板和格式模板。
- `index.js`：新增 5 个工具——`thesis_list_templates` / `thesis_save_template`（描述引导 DSH 解析范文后保存）/ `thesis_get_template` / `thesis_delete_template`。
- **DSH 侧工作流**：用户说"上传范文模板"→ DSH 解析范文结构 → 调用 `thesis_save_template` 保存 → 工作台「模板」tab 显示 → 用户二次编辑保存 → DSH 基于修改后模板推进后续工作。

### 问题 2：公式渲染 + 引用标题修复

**根因**：
- `latex-exporter.js` 的 `escapeLatex` 把 `$`、`_`、`^` 全部转义（`$`→`\$`、`_`→`\_`、`^`→`\textasciicircum{}`），公式完全失效。
- 没有行内公式保护机制，`$...$` 公式被当作普通文本转义。
- 章节标题手动加"第2章"前缀，与 LaTeX `\section` 自动编号冲突。
- 导言区缺少 `amsmath` / `amssymb` 包。
- `docx-exporter.js` 直接把 Markdown 行作为纯文本 TextRun，公式里的 `$` 直接显示，上标/下标不渲染。

**LaTeX 修复**（`src/latex-exporter.js` 重写）：
- 新增 `MATH_SYMBOLS` 映射表（60+ Unicode 数学符号 → LaTeX 命令，覆盖希腊字母、运算符、关系符、集合符、箭头等）。
- 新增 `convertMathSymbols(formula)`：处理 `√(...)`→`\sqrt{}`、`x*`→`x^{*}`、`x_y`→`x_{y}`、Unicode 符号替换。
- 新增 `protectMath(text)` / `restoreMath(text, placeholders)`：先提取 `$$...$$` 和 `$...$` 公式用占位符替换，`escapeLatex` 只处理普通文本，最后把公式还原（公式内部不转义，只做符号转换）。
- 新增 `autoWrapMath(text)`：最佳努力自动包裹未用 `$...$` 包裹的公式短语（含 ≥2 个数学符号且含 `=` 的短语）。
- 新增 `cleanHeading(text)`：去掉章节标题里的"第X章/节"前缀，让 LaTeX 自动编号。
- 导言区加 `\usepackage{amsmath}` + `\usepackage{amssymb}` + `\usepackage{booktabs}`。

**Word 修复**（`src/docx-exporter.js` 重写）：
- 新增 `LATEX_TO_UNICODE` 反向映射表（LaTeX 命令 → Unicode 符号）。
- 新增 `latexToUnicode(text)`：把公式里的 LaTeX 命令转换回 Unicode 符号。
- 新增 `formulaToRuns(formula, font, size)`：把公式字符串解析为 TextRun 段，支持 `^{...}` 上标、`_{...}` 下标、`^x`/`_x` 单字符上下标，公式部分用 Cambria Math 字体。
- 新增 `lineToRuns(line, font, size)`：把含 `$...$` 公式的行拆分为普通文本段 + 公式段，公式段调用 `formulaToRuns`。
- `markdownParagraphs` 从直接 `new TextRun({text: line})` 改为 `lineToRuns(line)` 多段渲染。

### 问题 3：状态栏排版修复

**实现**：`workbench-server.js` 的 `.status` CSS 加 `max-width:38%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:1; min-width:0`，超长导出路径自动截断为省略号，不再挤压右侧 DOCX/LaTeX/PDF 按钮。

### 问题 4：大纲图表多模态信息

**实现**：
- `domain-store.js`：outline 节点新增 `expectedFigures`（预计图数量）、`expectedTables`（预计表数量）、`expectedMedia`（其他多模态需求描述，如公式/代码块/流程图）三个字段，`setPlan` 时从输入读取。
- `workbench-server.js`：大纲卡片新增"预计图"、"预计表"数字输入框 + "其他多模态需求"文本框；`savePlan` 时读取这些字段提交。
- LLM 生成大纲时可自动预估每个章节需要的图表数量，写入 `expectedFigures` / `expectedTables`。

### v2.0 开发计划（已写入，暂不开发）

新增 `docs/v2-可插拔工作台架构.md`，描述：
- 将论文工作台架构抽象为可插拔文本处理工作台框架
- 三层插件化：文本生成框架（大纲/结构）+ 文本生成逻辑（写作逻辑）+ 文本内容凭证（引用/证据）
- LLM 自主根据用户描述的任务类型（专利/法律合同/技术报告等）选择/生成对应插件
- 保留双区 4:3 可拖拽布局、高交互编辑/保存、重新生成等工作台特性
- 用户通过自然语言"基于论文工作台架构，生成一个专利撰写工作台"即可生成本地新插件 + 安装指导
- 7 个里程碑，预计 10-16 天

### 验证

- `npm run check`：通过
- `npm test`：165 pass / 0 fail / 3 skip
- `node scripts/verify-page-js.cjs`：页面 JS 语法验证通过
- 公式修复需在当前项目 c3fac470 重新导出 LaTeX/PDF/DOCX 后人工验证公式渲染效果

### 生效方式

完全退出 DSH（含后台 node 进程）再重启：
```powershell
Get-NetTCPConnection -LocalPort 3199 | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
dsh web
```

## 通用工程约束（所有阶段共用）

1. **工具桥无损**：所有新增/修改的工具返回值必须通过 `toLosslessJson`（`src/lossless.js`），禁止 `undefined`/`NaN`/`±Infinity`/`-0` 出现在返回对象中。回归测试见 `test/lossless.test.js`。
2. **乐观并发**：写操作必须带 `expectedRevision`，冲突时抛明确错误，不静默覆盖。
3. **持久化兼容**：state.json 的 `schemaVersion` 只增不减；新增字段必须有默认值；迁移逻辑放在 `domain-store.js` 的 `#migrate`。
4. **测试门槛**：每个阶段合入前 `npm test` 全绿（XeLaTeX 环境依赖可 skip），`npm run check` 语法通过。
5. **文档同步**：每个阶段的接口变更、配置项、工具增删必须同步更新本目录对应阶段文档的"接口清单"小节。

## 版本发布流程

```text
阶段开发 → 单元/回归测试 → 阶段文档定稿 → 版本号 bump (package.json)
→ dsh plugin --profile web remove/add . → npm run setup → dsh web 实机回归
→ 打 tag / 发版
```
