# readme_2 · workbench-core（可插拔文本处理工作台框架）

> **一句话定位**：把论文工作台（`thesis-agent`）的核心架构抽象成一个**可插拔文本处理工作台框架**（v0.1.0）。通过三层插件系统（Framework / Logic / Evidence）+ 可选 Material 层，让同一套工作台运行时可快速迁移到论文、专利、法律合同、技术报告等多种结构化文本生成任务；并能让 LLM 一键生成全新任务类型的插件包。它是 thesis-agent 的 v2.0 演进——从「专用」走向「通用框架」。

---

## 1. 项目能做什么 & 为什么做这个项目

**能做什么**
- 提供一套**通用工作台运行时**：状态机、存储、双区工作台 UI（`:3199`）、模板、重新生成请求队列。
- 用**三层插件**定义不同任务类型的「写作规则」：
  - **Framework**：文本骨架、大纲结构、状态机（论文=摘要/绪论/方法/实验/结论；专利=技术领域/背景技术/权利要求书）；
  - **Logic**：每段写作目标、承接关系、风格（论文=学术严谨性；专利=清楚简要、充分公开）；
  - **Evidence**：引用格式、来源绑定、证据评估（论文=GB/T 7714；专利=现有技术引用）；
  - **Material（可选）**：多模态材料登记、类型约束与领域预处理（文献/实验图表 vs 技术交底书/附图/对比文件）。
- 让 LLM 基于一句自然语言（如「法律合同审查」）**自动生成**一个新任务类型的插件包并隔离安装。

**为什么做**
thesis-agent 把论文写作做得很深，但状态机、大纲、引用都是「论文写死」的：换一个领域（专利、合同、技术报告）就得改核心代码。本项目把其中可复用的架构抽象出来，回答一个更通用的工程问题——**如何用一个工作台内核，支撑 N 种结构化长文本生成场景，且新增场景无需改内核**。

---

## 2. 怎么使用这个项目

**安装（DSH 插件）**
```bash
cd D:\雷达毕设相关\high_star\workbench-core
npm install
dsh plugin --profile web add .   # 重启 DSH
```

**使用（对话驱动）**
```
用户: 打开工作台
DSH: wb_open_workbench → http://127.0.0.1:3199

用户: 创建一个论文项目，关于毫米波雷达水分检测
DSH: wb_create_project({ name: "毫米波雷达水分检测", taskType: "thesis" })

用户: 创建一个专利项目，关于一种新的检测装置
DSH: wb_create_project({ name: "新型检测装置", taskType: "patent" })
```

**生成新任务类型插件（框架亮点）**
```
用户: 基于论文工作台架构，帮我生成一个面向法律合同审查的工作台
DSH: wb_analyze_task_description({ description: "法律合同审查" }) → detectedType: "contract"
DSH: wb_generate_plugin_bundle({ taskType: "contract", name: "Contract Workbench" })
     → 生成 ./generated-plugins/contract-workbench/
```
生成器**只会**在 `generated-plugins/<taskType>-workbench/` 创建新包，不改动 `workbench-core` 源码；每个包含 `plugin-spec.json`（领域唯一配置来源）、`plugin.manifest.json`、读取 spec 的 `src/index.js`、`scripts/verify.mjs`（安装前静态校验）。生成后自动执行同等静态验证，也可 `wb_verify_generated_plugin_bundle` 复查；通过验证再按包内 README 安装。

---

## 3. 项目最终获得的效果

- **从专用到通用的跃迁**：thesis-agent（固定 13 状态、论文 5 章固定、GB/T 7714 固定、新任务需改核心）升级为 workbench-core（状态机可配置、大纲由 Framework 生成、引用由 Evidence 定义、新任务 LLM 一键生成插件包）。
- **内置双领域插件**：`thesis`（学位论文）+ `patent`（专利撰写，12 状态机含 `prior_art_search`/`evaluating_patentability`）。
- **可生成扩展**：`contract` / `tech-report` / `generic` 等任务类型可通过生成器产出隔离插件包，工作台右侧「规格」页提供 Spec Studio（新建草案、编辑 JSON、校验、生成隔离插件包）。
- **原始项目不受影响**：v2.0 是独立新项目，thesis-agent 保持独立运行。
- **量化完成度**：18 项核心测试 + 语法检查全绿。

---

## 4. 项目亮点（如何处理工程问题）

| # | 亮点 | 工程价值 / 解决的问题 |
|---|---|---|
| 1 | **三层 + 可选 Material 插件契约** | 把「领域规则」从内核剥离，内核只管运行时，规则由插件声明，新增场景零改核心 |
| 2 | **配置化状态机** | 状态机由 Framework 插件定义（论文 13 / 专利 12），而非硬编码；`recommendedNextEvent` 强制 LLM 按字段推进、不猜事件 |
| 3 | **UI 随 spec 自适应** | Framework 声明 `ui`（右侧面板/编辑器标签）与 `projectFieldSchema`，同一双区 UI 自动显示「论文大纲/文献」或「专利结构/凭证」等领域术语，无需复制 UI |
| 4 | **LLM 插件生成器 + 隔离验证** | `generator.js` 把自然语言需求转成合规插件包；生成包落在独立子目录 + 静态校验脚本，杜绝误改内核 |
| 5 | **Spec 驱动而非代码固化** | 安装包 JS 入口不写死领域规则，只读取 `plugin-spec.json` 由通用运行时编译为四层能力，改 JSON 即可改领域工作台 |
| 6 | **通用双区 4:3 可拖拽 UI** | 复用并泛化论文工作台前端，把「可视化精细编辑」能力沉淀为框架资产 |

---

## 5. 技术路线（AI + 前后端开发视角）

**AI 层（概率性内核）**
- **任务类型识别**：`wb_analyze_task_description` 用 LLM 从自然语言描述检测任务类型（thesis / patent / contract …）。
- **插件生成**：`generator.js` 把识别结果 + 规范转成 Framework/Logic/Evidence/Material 四层代码骨架与 `plugin-spec.json`，这是「LLM 辅助产出工程资产」而非「LLM 直接改运行系统」的受控范式。
- **写路径复用论文工作台治理**：生成的新插件复用同一套受控运行（状态机 + 用户确认 + 版本）。

**后端 / 运行时层（确定性外壳）**
- DSH 插件入口 `src/index.js` 注册 20+ 工具（`wb_*`）。
- `src/core/` 提供**通用运行时**：
  - `state-machine.js`：通用可配置状态机；
  - `storage.js`：通用 JSON 存储；
  - `plugin-loader.js`：三层插件契约 + 加载器 + 注册表；
  - `runtime.js`：整合状态机/存储/插件；
  - `workbench-server.js`：3199 HTTP 服务 + 双区 4:3 可拖拽 UI。
- `src/plugins/thesis` 与 `src/plugins/patent`：内置领域插件，各自 `framework.js` / `logic.js` / `evidence.js` / `material.js` 声明该领域的章节、字段、模板、状态机、材料类型与规则。

**前端层**
- 原生 HTML/CSS/JS（零框架）内嵌 `node:http` 服务；双区工作台通过 REST API 与运行时交互；右侧面板标签由 Framework 的 `ui` 声明动态渲染。
- Spec Studio 提供「规格」页：草案编辑、JSON 校验、生成隔离插件包，全部走注册表与静态验证。

**工程化**
- `npm test`（18 项核心测试）、`npm run check`（语法检查）；生成包有独立 `scripts/verify.mjs` 静态校验，安装前不执行插件业务代码。
- 设计取向：**内核稳定 + 领域外置**，用契约/配置/生成器把「不确定性」关在插件边界内，内核保持确定、可测、可移植——这是把单点应用升级为平台的关键工程决策。
