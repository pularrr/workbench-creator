---
name: knowmap-plugin
description: 从主题创建可交互的知识图谱 AI 应用：由宿主 LLM 设计 Profile、生成 MVP 并确认、编写完整网络、校验后复制应用模板并注入数据。用于新建主题知识网络；已有图谱内的提问和资料接入使用应用运行时。
metadata:
  compatibility: 需要本地文件和命令工具、Node.js >=22.13.0；构建由当前宿主 LLM 完成。
---

# KnowMap：构建应用的插件

工作目录为包含 package.json、scripts/、templates/app/ 的完整项目根目录。宿主 LLM 执行本文件；应用内部 Agent 执行另一套运行时工作流。不要要求模型重写已有 UI 或研究引擎。

## 入口与发现

先执行 `node scripts/knowmap.mjs discover` 获取机器可读能力描述。宿主可以导入 `discoverKnowmap()`（plugin/discovery.mjs），注册其 name、description、inputSchema，并把工具执行映射到 `runKnowmap({ action, input, output })`（scripts/knowmap.mjs）。宿主需要自行适配工具协议、解析绝对文件路径并执行本地命令。此函数不会自动安装插件或使未接入工具的聊天模型获得执行能力。

第一次运行先 `npm install`。在 KnowMap 项目根目录之外创建一个全新的任务目录，所有 Profile、MVP、完整网络、校验报告和最终应用都写入该目录；不得在项目的 work、outputs、data、plugin 或其他子目录生成任务产物。命令写新文件，输出已存在时失败，避免覆盖检查点。

构建阶段只使用当前宿主 LLM 的能力直接编写结构化 JSON，严禁调用本项目已配置的 DeepSeek 或其他付费 Provider，也不得读取或测试其 Key、baseUrl、model。`knowmap.mjs` 已对 design/mvp/full 设置硬拒绝。API Key 仅在独立应用构建、测试和交付完成后，由用户自行在新应用设置页接入。

## 两层工作流

| 层 | 执行者与产物 | 入口 |
| --- | --- | --- |
| 插件构建层 | 宿主 LLM → Profile + network → 独立 Next.js 应用 | scripts/knowmap.mjs、scripts/create-app.mjs |
| 应用运行层 | Node.js Agent → 回答、研究候选与确认后的图谱更新 | /api/agent/chat、/api/agent/jobs、/api/knowledge/ingest |

两层共用数据契约和 validateKnowledgeDataset；只有应用运行层使用 provider 与 collectAdaptiveResearch。构建层由宿主直接编写 Profile 和网络，不调用 ProfileDesigner，不读取项目 Key。发现入口与运行时 API 协议兼容性相互独立。

## 七步构建流程

确认主题和输出目录，有信息时直接使用，不重复追问。所有示例在项目根执行。详细请求 JSON 和失败处理见下列工作流。

| 步骤 | 调用 / 输入 | 输出 | 验证 |
| --- | --- | --- | --- |
| 1 Profile | [设计工作流](workflows/profile-design-workflow.md)，宿主直接编写 JSON | 隔离任务目录/profile.json | validate-profile：字段、引用和当前引擎支持范围 |
| 2 MVP | [MVP 工作流](workflows/mvp-generation-workflow.md)，宿主直接编写 | 隔离任务目录/mvp.json | validate；展示域树、节点和2–3张卡，请用户确认方向 |
| 3 完整开发 | [完整工作流](workflows/full-development-workflow.md)，宿主接续确认过的 MVP | 隔离任务目录/full.json | validate；报告未解决缺口 |
| 4 合并审查 | [审查工作流](workflows/validation-workflow.md)，validate + 宿主语义审查 | 隔离任务目录/reviewed.json、校验报告 | 修复结构错误；逐项审查 warning；重跑校验 |
| 5 脚手架 | create-app.mjs --profile-file <隔离目录>/profile.json --name my-map --output <隔离目录>/app | 应用代码、激活的 Profile、空运行时目录 | 输出在项目外；Profile ID、真实 root ID、依赖完整 |
| 6 注入 | knowmap.mjs inject --input <隔离目录>/reviewed.json --output <隔离目录>/app | data/runtime/knowledge-state.json | 使用 RuntimeKnowledgeRepository 生成封装和 checksum，并回读比较 |
| 7 交付 | 产物目录 npm install、npm run type-check、npm test、npm run build、npm run dev | 可启动应用、验收记录 | 图谱、聊天、卡片、LaTeX、字号、资料入口；区分离线检查和真实提供商验收 |

生成 MVP 或完整网络前必须完整读取 [统一逐节点分析循环](references/node-analysis-loop.md)、[先总后分的层级构造法](references/hierarchy-construction.md) 和 [知识卡语义与内容判定](references/knowledge-card-semantics.md)。完整开发对每个节点先做无缺口导向的基线分析并归档理论/应用/其他知识，再规划必要结构，最后围绕开放缺口饱满深挖并去重；该顺序与应用内 `collectAdaptiveResearch` 相同。Profile 启用 hierarchy 时使用导航中间层完成宽度与深度审查；CodeGraph 等任务使用 Profile 声明的仓库导航层级，禁止把“一个节点一个概念”解释为把所有细概念直接平铺在域下。

MVP 未确认时必须停在展示阶段。展示 MVP 时必须同时给出预算提案。用户验收后，宿主必须先用 `sync-budget` 将批准预算写回 Profile，再用 `plan` 生成共享主题队列；不能只把预算放在确认 JSON 中而继续运行。

## 质量与预算

- 域数、节点数、类型数、栏目数是建议，不按固定数量凑内容。MVP 建议15–30节点，完整建议80–150节点；不设输出节点数硬上限。
- 当前引擎支持基础12种节点类型（含中间导航用 category）、12种边类型、13种栏目；它们是可选分类词表，不是通用的13项填写清单。宿主必须根据任务重新选择 cardSections 子集、适用节点类型和覆盖级别，通常只要求 definition，其他栏目只在语义适合时使用。架构图、代码图等任务不得机械套用研究热点、公式假设或典型应用。新类型或新栏目不能只靠 JSON 获得 UI 和工具支持，需要先扩展引擎。配色使用 foundation/signal/data/system/ai，语义域 ID 可自定义。
- MVP 在根主题上执行2–3轮，最多2次浅搜索，禁用拆分子调用；运行时上限为5分钟、1个访问主题、12次模型调用，只保留 definition。完整模式把每个访问节点当作新的局部根并逐节点重置局部预算。完整开发的访问主题预算只统计实际拥有下级节点的非叶父主题；经研究确认没有孩子的拓扑叶子可继续补卡但不计数。整次任务只共享用户验收过的时间、调用保险丝和非叶父主题预算。
- 不设置从总根累计的最大树深度。完整网络以语义链完整为准，通常应形成至少 6 层的代表性路径；复杂主题可更深。Profile 的旧 `hierarchy.maxDepth` 只能解释为一次局部扩展的观察半径，不得据此阻止第 N 层节点继续作为父节点扩展。
- 完整开发不能只写节点摘要。理论知识与应用知识按知识卡语义规范选择最低覆盖；适用的原理、公式、输入输出、流程、工程取舍、失效和验证不得因“栏目可选”而被保守省略。
- 35分钟约束研究阶段；安装、构建、人工审查额外计时。不把预算耗尽称为收敛，不把模拟输出称为真实检索。
- 多概念、名称>20字、摘要>80字、problem 混入方法、父节点直接子节点超过 Profile 上限（默认8）和平铺叶子概念由共享校验产生 warning。拆分应同步修复父级、卡片和边；不要机械截断名字、编号分组或凭字符串命中删除知识。
- KnowledgeNetwork 是 nodes/cardBlocks/relations（可带 evidence）；KnowledgeDataset 是 nodes/cards/edges/domains/formulas；runtime 文件还有 state、schemaVersion、checksum。不可将裸 network 直接改名成 knowledge-state.json。

## 应用运行时

只在已有应用中研究节点时读[深搜工作流](workflows/deep-search-workflow.md)；导入资料时读[资料工作流](workflows/knowledge-ingest-workflow.md)。运行时研究结果经过应用现有审查/确认机制写入，不使用构建层 inject 覆盖已有状态。

## 故障与恢复

模型格式错误由共享 provider/research 输出模块有限重试、修复和截断恢复。结构转换失败时保留结果文件，修复 JSON 后重新 validate。研究批次存于 data/runtime/research；当前不承诺自动从这些批次恢复遍历队列。完整模式可以从一个已审查的网络重新发起研究，此操作是新一轮研究。

生成产物包含本插件说明和命令，但不递归包含 templates/app。若要再次创建应用，调用原始完整插件项目中的脚手架。不要宣称单个生成应用能够无限自举。

参考基准提交 b45dd0c。开发审查与验证记录见 ../docs/plugin-audit-plan.md 和 ../docs/plugin-audit-results.md。
