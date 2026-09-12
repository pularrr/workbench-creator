# 文本生成工作台拆分、同步与持久化开发计划

> ## 2026-09-12 架构重构增量进度
>
> 已完成：P0 正文分块 upsert、整篇覆盖二次确认、写入前自动保护快照；P1 本地 Core Service 启动入口与 `/health`；P2 SQLite/WAL 存储容器及旧 `state.json` 一次性迁移；P3 `workspaceId → activeProjectId` 持久化绑定与页面恢复。
>
> 进行中：P4 页面直连确定性操作；P5 持久化 `AgentTask` 队列与 DSH 领取机制；P6 候选 Diff/审查/轨迹闭环；P7 领域插件在新 Core 服务边界下的兼容验收。
>
> 已知边界：当前 SQLite 第一阶段保存受事务保护的状态文档，后续再按项目、材料、任务和审计事件拆分为规范化表；页面不再以 DSH `sessionId` 作为长期项目身份。

## 1. 文档目的

本文档汇总 Workbench Core 与文本生成工作台助手的拆分、阶段治理、项目绑定、长期运行和数据保留需求，作为后续开发、迁移、测试与验收的统一依据。

目标不是继续在 `workbench-core/assets/presets` 中维护多个 Agent 预设，而是形成职责清晰、物理隔离、可以独立安装和升级的 DSH 项目。

## 2. 最终项目结构

```text
D:\雷达毕设相关\high_star\
├─ workbench-core\                 # 独立 DSH Core 插件项目
├─ text-workbench-assistant\       # 独立 DSH Agent 预设项目
├─ thesis-agent\                   # 独立领域工作台或历史兼容项目
└─ 其他源码项目\

~/.dsh/workbench-plugins/
├─ legal-contract-workbench/
├─ radar-patent-workbench/
└─ tech-report-workbench/
```

三类产物的调用关系：

```text
文本生成工作台助手
  负责自然语言理解、用户确认和 design/write/review 编排
                    ↓ wb_* 工具
Workbench Core
  负责确定性执行、权限、项目、存储、版本、审计和 Web UI
                    ↓ 生成、验证、安装和加载
领域任务台插件
  负责论文、专利、合同、技术报告等具体领域规则
```

## 3. 职责边界

### 3.1 Workbench Core

Core 负责：

- 项目创建、列出、选择、绑定、归档和删除；
- 项目、大纲、正文、材料、证据、版本、快照和审计的持久化；
- Plugin Spec 创建、校验和编译；
- 领域任务台插件生成、验证和安装；
- 材料导入、解析、检索及证据绑定；
- 工作流状态机、可恢复运行和导出器；
- 按 `design`、`write`、`review` 阶段执行工具权限检查；
- 工作台 Web UI 及页面与对话的项目同步；
- 活跃项目数量上限和最早项目归档策略。

Core 不再包含：

- Designer、Writer、Reviewer 三个独立预设；
- 统一助手的 Persona 和 Skill；
- Agent 预设安装脚本；
- 生成领域插件的源码副本。

### 3.2 Text Workbench Assistant

`text-workbench-assistant` 是唯一面向用户的自然语言入口，负责：

- 合并原 Designer、Writer、Reviewer 的交互能力；
- 显式维护 `design`、`write`、`review` 三个阶段；
- 把自然语言中的项目选择转换成 `wb_list_projects`、`wb_create_project` 和 `wb_bind_project` 调用；
- 分别取得生成目录确认和插件安装确认；
- 在用户确认后切换阶段，不直接绕过 Core 权限；
- DSH 重启或会话变化后询问用户是否恢复上次项目；
- 未指定项目时打开首页，指定项目时先绑定再打开。

建议项目结构：

```text
text-workbench-assistant/
├─ package.json
├─ package-lock.json
├─ agent.cordis.yml
├─ preset.yml
├─ skills/
│  └─ text-workbench/
│     └─ SKILL.md
├─ scripts/
│  └─ install-assets.mjs
├─ test/
│  ├─ package.test.js
│  ├─ install.test.js
│  └─ workflow.test.js
├─ .gitignore
└─ README.md
```

助手依赖已安装的 `dsh-workbench-core`，但不得复制或内嵌 Core 源码。

### 3.3 领域任务台插件

论文、合同、专利和技术报告等领域插件是运行时生成产物，默认写入：

```text
~/.dsh/workbench-plugins/<taskType>-workbench/
```

它们不得写入 Core 或 Assistant 源码项目。每个领域插件应独立声明标识、版本、Plugin Spec 版本和 Core 兼容范围。

## 4. 自然语言项目绑定与同步模型

### 4.1 对话绑定

用户可以在 DSH 对话中自然表达：

```text
列出我的项目。
把当前对话绑定到“雷达水分检测专利”。
切换到“毕业论文”项目。
打开当前项目的工作台。
```

自然语言本身不直接修改状态。助手必须将意图转换成确定性工具调用：

```text
用户自然语言
  ↓
text-workbench-assistant
  ↓ wb_list_projects / wb_create_project / wb_bind_project
Workbench Runtime
  ↓
持久化 sessionId → projectId
```

项目名称唯一时可以按用户明确意图绑定；存在重名时必须展示项目 ID、任务类型和更新时间供用户选择；不存在时询问创建新项目还是重新选择。

后续所有写作、检索、证据、快照和导出工具都根据当前 DSH `sessionId` 取得绑定项目，不能从聊天文字猜测“当前项目”。

### 4.2 Web UI 同步

`wb_open_workbench` 支持两种模式：

- 不传 `projectId`：打开项目首页，不自动绑定第一个项目；
- 传入 `projectId`：验证项目、绑定当前会话，再打开项目页面。

对话和页面通过同一 Runtime、持久化存储和绑定上下文同步：

```text
DSH 对话绑定项目 ─┐
                  ├→ Core binding store → 当前项目
Web 页面选择项目 ─┘
```

页面创建或选择项目后必须调用服务端绑定接口。服务端绑定是唯一真实状态源，浏览器 `localStorage` 只能作为界面辅助，不能覆盖服务端状态。

建议增加：

```text
GET  /api/session?sessionId=...
POST /api/session/bind
POST /api/session/unbind
```

为了避免长期会话 ID 出现在 URL，正式版本应由 `wb_open_workbench` 生成短期页面令牌，由服务端映射到真实 `sessionId`。

## 5. 工作阶段和权限模型

### 5.1 阶段职责

| 阶段 | 职责 | 关键限制 |
| --- | --- | --- |
| `design` | 理解需求、设计与确认 Plugin Spec、生成和安装插件、选择或创建项目 | 不得写正文 |
| `write` | 导入材料、检索和绑定证据、编辑大纲与正文、快照和版本管理 | 不得生成或安装新插件 |
| `review` | 审查证据、结构、引用、术语和版本差异 | 默认只读，不得修改正文或恢复快照 |

### 5.2 转换条件

| 转换 | 条件 |
| --- | --- |
| `design → write` | 已选择领域插件、创建或选择并绑定项目、用户明确确认 |
| `write → review` | 项目已绑定，用户明确要求审查 |
| `review → write` | 用户确认返回修改阶段 |
| `write/review → design` | 用户明确要求设计新的领域任务台 |

`design` 阶段必须允许受控调用 `wb_create_project`，否则会形成“没有项目不能进入 write、未进入 write 又不能创建项目”的死锁。推荐创建工具支持 `bindAfterCreate: true`，在一次事务中完成创建与绑定。

阶段权限检查必须下沉到统一 Runtime 命令入口，使 DSH 工具、`exposeTools()` 和 Web API 不能通过不同入口绕过治理。

每次阶段转换应保存：

```json
{
  "from": "design",
  "to": "write",
  "projectId": "project-123",
  "reason": "用户确认开始写作",
  "userConfirmed": true,
  "timestamp": "2026-09-09T10:00:00.000Z"
}
```

## 6. 跨退出和重启的持久化

### 6.1 必须持久化的数据

- 项目元数据、`taskType`、插件 ID 和插件版本；
- 大纲、正文块、领域字段和 revision；
- 材料副本、索引和证据绑定；
- 快照、导出记录和审计；
- 工作阶段及阶段转换记录；
- 临时会话绑定和长期助手绑定；
- 运行状态、当前步骤和恢复检查点；
- `createdAt`、`updatedAt` 和 `lastOpenedAt`。

进程内 `Map` 只能作为缓存，不能作为阶段或绑定的最终状态源。

### 6.2 两层绑定

仅保存 `sessionId → projectId` 不足以跨 DSH 重启，因为新会话可能产生新的 ID。需要两层绑定：

```text
临时会话绑定：sessionId → projectId
长期助手绑定：profile + assistantId → lastProjectId
```

建议状态：

```json
{
  "bindings": {
    "sessions": {
      "session-123": "project-123"
    },
    "assistants": {
      "web:text-workbench-assistant-v0": "project-123"
    }
  }
}
```

恢复顺序：

1. 查询当前 `sessionId` 绑定；
2. 未找到时查询 profile 与 assistant 的长期绑定；
3. 验证项目存在、插件可用、阶段合法；
4. 向用户展示上次项目、阶段和未完成任务；
5. 用户确认后把新 `sessionId` 绑定到原项目；
6. 插件缺失时保留项目并进入只读或等待修复状态，禁止删除数据。

建议新增工具：

```text
wb_get_resume_state
wb_resume_project
wb_unbind_project
```

## 7. 长任务和中断恢复

“长期运行”定义为已完成进度不丢失、未完成步骤可以恢复或重试。退出 DSH 后，原模型调用或子进程不保证继续执行，除非另行部署常驻任务服务。

长任务状态：

```text
pending → running → checkpointed → completed
                    ↘ interrupted / failed / cancelled
```

材料导入、解析、分块、检索、候选生成、用户确认、正文写入、快照和导出等关键步骤完成后都要写入检查点。

Core 启动时应把没有有效心跳的遗留 `running` 任务标记为 `interrupted`，向用户说明中断位置，不得自动重复正文写入。恢复调用必须携带幂等键和预期 revision。

建议新增：

```text
wb_list_interrupted_runs
wb_resume_run
wb_cancel_run
```

## 8. 存储可靠性

### 8.1 短期 JSON 方案

如果继续使用 JSON：

1. 写入 `state.json.tmp`；
2. flush 并校验完整 JSON；
3. 原子替换 `state.json`；
4. 保留 `state.json.bak`；
5. 启动时主文件损坏则从备份恢复；
6. 所有副本均损坏时停止写入，禁止初始化空状态覆盖旧数据；
7. 所有写操作串行化，并使用 revision 防止丢失更新。

### 8.2 推荐 SQLite 方案

长期建议迁移到：

```text
~/.dsh/storages/workbench-core/workbench.db
```

要求开启事务、WAL、`busy_timeout` 和外键约束。项目创建与淘汰、正文写入与审计、阶段转换与绑定更新必须在同一事务中完成。

项目材料和大文件保存在受控目录：

```text
~/.dsh/storages/workbench-core/projects/<projectId>/
├─ materials/
├─ indexes/
├─ snapshots/
└─ exports/
```

导入材料应记录原始文件名、原路径、内部副本路径、MIME 类型、导入时间和 SHA-256。仅记录外部路径时必须提示原文件移动会导致材料失效。

## 9. 活跃项目上限和删除策略

### 9.1 上限规则

- 活跃项目最多 10 个；
- “最早项目”严格按 `createdAt` 升序确定；
- 打开、编辑和更新项目不得改变淘汰顺序；
- 创建第 10 个项目不触发淘汰；
- 创建第 11 个项目时只处理一个最早项目；
- 项目限制必须由 Core 强制执行，不能只写在 Persona 中。

### 9.2 推荐归档流程

```text
预检项目数量
  ↓
返回即将淘汰的最早项目
  ↓
用户确认继续创建
  ↓ 单一事务
归档最早项目 → 清理绑定和运行状态 → 创建并绑定新项目 → 写审计
```

自动淘汰建议进入 `archives/`，不立即物理销毁。归档不计入 10 个活跃项目上限，并可设置例如 30 天的恢复期。

建议新增：

```text
wb_get_project_limit
wb_prepare_create_project
wb_archive_project
wb_list_archived_projects
wb_restore_archived_project
```

### 9.3 用户主动删除

手动删除采用两阶段确认：

```text
wb_request_delete_project
  → 返回项目摘要和短期确认令牌
wb_confirm_delete_project
  → 校验 projectId、expectedRevision、令牌和 confirmedDelete
```

删除前创建最终快照或归档；删除后解除所有绑定、停止关联运行、将助手切换到安全阶段并写入审计。永久物理删除需要比普通归档更明确的二次确认。

## 10. 领域插件生成和安装安全

- 生成目录确认和插件安装确认必须是两次独立确认；
- 默认生成到 `~/.dsh/workbench-plugins`；
- 禁止输出到 Core、Assistant 或其他源码项目内部；
- `taskType` 使用严格安全字符规则；
- 解析真实路径和符号链接后再次检查边界；
- 先生成到临时目录，验证通过后原子移动；
- 禁止覆盖没有合法生成标记的目录；
- 安装前重新校验插件、Plugin Spec、兼容版本和文件摘要；
- DSH CLI 安装必须限制 profile、执行时间和输出大小；
- 生成和安装结果分别写入审计。

项目创建时锁定：

```json
{
  "taskType": "radar-patent",
  "pluginId": "radar-patent-workbench",
  "pluginVersion": "0.3.0",
  "specVersion": "1.1"
}
```

插件升级不得静默迁移旧项目；迁移前必须创建快照，失败后保留旧数据。

## 11. 文件迁移原则

- 新助手安装验证通过后，才能提交 Core 中旧 Designer、Writer、Reviewer 预设的删除；
- Core 的 setup 不再安装 Agent 预设；
- 不删除用户 `~/.dsh/.agent-presets` 中已经安装的旧预设；
- 迁移文档提供旧预设的手动卸载方法；
- `thesis-agent` 从 Core 删除前，必须确认并列项目已完整迁移源文件、测试和文档；
- 两个源码项目分别拥有 README、安装入口、锁文件、测试和版本；
- 领域插件始终保存到独立运行目录。

## 12. 分阶段开发计划

| 阶段 | 优先级 | 主要工作 | 完成标准 |
| --- | --- | --- | --- |
| 0. 保护现场 | P0 | 核对当前 diff、旧预设、`client.js` 和 `thesis-agent` 去向 | 所有删除均有迁移目标或删除理由 |
| 1. 项目拆分 | P0 | 整理 Core 和 Assistant 目录、安装入口和依赖 | 两个项目可分别打包和测试 |
| 2. 流程修复 | P0 | 修复 design 阶段创建项目死锁，完善转换条件 | 新用户可创建、绑定并进入 write |
| 3. 权限统一 | P0 | 权限检查下沉 Runtime，覆盖所有入口 | Web、DSH 和 exposeTools 权限一致 |
| 4. 持久化 | P0 | 保存阶段、会话绑定和长期助手绑定 | 重启后可发现上次项目和阶段 |
| 5. 任务恢复 | P0 | 检查点、心跳、中断检测和幂等恢复 | 异常退出不丢已完成进度 |
| 6. 存储加固 | P0 | 原子写、备份、锁、revision；规划 SQLite | 存储损坏和并发写入测试通过 |
| 7. 项目上限 | P0 | 10 项目限制、最早项目归档和事务创建 | 第 11 个项目只归档最早项目 |
| 8. 安全删除 | P0 | 删除令牌、revision 校验、归档恢复 | 未明确确认无法删除 |
| 9. 插件安全 | P0 | 路径、临时生成、安装验证和审计 | 不写源码项目，不安装非法包 |
| 10. UI 同步 | P0 | 首页/项目模式、服务端绑定、短期令牌 | 页面和对话操作同一项目 |
| 11. 联调文档 | P0 | 真实 DSH 安装、迁移指南和故障排查 | 完整端到端验收通过 |

## 13. 测试与验收

必须覆盖：

- Core 和 Assistant 分别安装、升级和测试；
- DSH 中只出现一个统一助手；
- 默认进入 `design`，且不能写正文；
- 可以在 `design` 阶段创建并绑定项目；
- 未绑定项目不能进入 `write`；
- `review` 不能修改正文或恢复快照；
- 生成目录未确认时拒绝生成；
- 插件安装未单独确认时拒绝执行；
- 不传项目打开首页且不自动绑定；
- 指定项目时对话和页面绑定一致；
- 重启 Runtime/DSH 后项目、正文、材料、证据、版本和阶段仍存在；
- 新 `sessionId` 可以在用户确认后恢复上次项目；
- 写入中异常退出不会破坏旧状态；
- 中断任务恢复不会重复写入；
- 第 10 个项目不淘汰，第 11 个只归档 `createdAt` 最早项目；
- 更新或打开项目不改变淘汰顺序；
- 自动归档后悬空绑定和运行状态被清理；
- 用户删除必须经过显式确认；
- 插件缺失或版本不兼容时项目不会被删除；
- 归档恢复后的数据与校验和一致。

## 14. 推荐提交顺序

1. `refactor(core): establish runtime-only package boundary`
2. `fix(core): allow governed project creation before write stage`
3. `feat(core): persist project bindings and work stages`
4. `feat(core): add resumable run checkpoints`
5. `feat(core): enforce ten-project limit with archival eviction`
6. `feat(core): add recoverable project deletion workflow`
7. `feat(core): secure generated plugin output and installation`
8. `feat(core): synchronize web and conversation project bindings`
9. `test(core): cover restart recovery and project eviction`
10. Assistant 仓库：`feat: add unified text workbench assistant`
11. `docs: add split-project installation and migration guide`
12. `chore: remove legacy presets and embedded thesis project`

旧资产删除应放在最后，且必须以新助手真实安装、Core 联调和迁移完整性检查全部通过为前提。

## 15. 最终验收定义

完成后必须同时满足：

1. Core、Assistant、领域插件是三个独立安装和升级单元；
2. 用户能在 DSH 中通过自然语言创建、选择、绑定和切换项目；
3. DSH 对话和工作台页面使用同一持久化项目绑定；
4. 退出或重启 DSH 不会丢失项目、阶段和已完成任务进度；
5. 中断任务能从确定性检查点安全恢复；
6. 活跃项目最多 10 个，创建第 11 个时按 `createdAt` 归档最早项目；
7. 除用户明确永久删除或执行已声明的归档清理策略外，不物理删除项目数据；
8. 所有关键写入、阶段转换、归档、删除、生成和安装操作均可审计。

## 16. RAG、Embedding 与中文低成本检索路线

### 16.1 当前基线与目标

当前 `retrieval-service.js` 的 `localEmbedding()` 是零依赖、192 维的特征哈希实现；`chunkText()` 和 `searchChunks()` 直接调用它。这一实现必须保留为**默认离线降级路径**：无模型、无密钥、无网络时仍能按关键词和哈希向量完成基础材料召回。

目标不是把某一模型写死进 Core，而是将编码模型变为可注入能力：未配置时使用 `hash`，配置后自动切换至 OpenAI、BGE-M3、E5、Ollama 或企业私有 HTTP 服务。模型密钥只放在宿主的安全配置或环境变量中，不写入项目 JSON、快照、导出物或审计明文。

### 16.2 Provider 契约与索引兼容性

新增 `EmbeddingProvider`：

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

Core 内置 `HashEmbeddingProvider`，并定义 OpenAI、OpenAI-compatible HTTP、Ollama/local 和自定义 private HTTP provider。Provider 注册表只暴露模型标识、维数、批量限制、状态和安全引用；不返回 API Key。

每个 source chunk 必须记录 `embeddingProvider`、`embeddingModel`、`embeddingDimensions`、`embeddingVersion`、`contentSha256` 与 `indexedAt`。查询只可匹配相同索引配置的向量；更换 provider、模型、维度、归一化策略或分块策略时，必须创建新索引版本并后台重建，禁止混用旧向量。

建议配置结构：

```json
{
  "retrieval": {
    "embedding": {
      "provider": "hash | openai | ollama | private-http",
      "model": "text-embedding-3-small",
      "credentialRef": "env:OPENAI_API_KEY",
      "baseUrl": "https://api.openai.com/v1",
      "batchSize": 64,
      "fallback": "hash"
    },
    "fusion": { "method": "rrf", "denseWeight": 0.65, "keywordWeight": 0.35 },
    "rerank": { "enabled": false, "topCandidates": 30 }
  }
}
```

### 16.3 中文优先、低成本的分阶段选择

1. **默认零成本**：保持 hash + 关键词路径，适合演示、离线和小语料；界面必须明确标注“基础检索”，不能宣称语义理解。
2. **最低接入成本的云端基线**：优先实现 OpenAI-compatible provider，首选 `text-embedding-3-small`。它按量计费、无需 GPU、批量调用即可覆盖中英文；`text-embedding-3-large` 只在离线评测确实带来显著召回提升时启用。
3. **中文私有化优先**：提供 Ollama 或 private HTTP adapter，推荐以中文验证集比较 BGE-M3 与 multilingual-E5。CPU 机器先选较小模型并限制并发；有 GPU 或语料较大时再启用 BGE-M3。不得仅按公开榜单决定模型。
4. **成本控制**：内容 SHA-256 去重、增量索引、批量编码、失败退避、按项目配额、索引队列和 hash fallback；查询向量短期缓存，材料修改后只重嵌入受影响块。

### 16.4 分块与混合检索改造

当前固定“1200 字符 + 120 字符重叠”的按行切块，不能反映中文 token 数、标题层级、表格和页码。新增可配置 `Chunker`：

- 默认使用中文友好的段落/标题优先切分，再按 token 上限拆分；保留文件、页码、标题层级、起止行、表格/图片上下文等 locator；
- 保留固定字符分块作为兼容降级方案；
- 先实现全文关键词召回 + dense 向量召回的双路 Top-N，再用 RRF 融合；融合参数可按任务类型配置；
- 首期不强制引入 Elasticsearch：小型项目继续 JSON 全量扫描；达到阈值后切换可选本地 HNSW/SQLite-vec 索引；
- 第二期对融合后的 Top 20--50 使用可选 reranker，默认关闭以控制延迟与成本；
- 所有结果返回 dense、keyword、fusion、rerank 分数以及定位信息，供用户审阅证据。

### 16.5 吸收 RAGFlow 的优势，但不复制其部署负担

本地 `demo/ragflow` 的实现可借鉴以下机制：

| RAGFlow 已实现的机制 | 当前 Core 差距 | 本项目的吸收方式 |
| --- | --- | --- |
| Embedding factory 的 `encode()` / `encode_queries()`、批处理和 token 截断 | `localEmbedding()` 被直接硬编码 | Provider 接口区分文档与查询编码，并统一批处理、重试、限额和输入上限 |
| 按 token、标题、文档类型和模板配置分块，并保留 PDF 坐标、表格/图片上下文 | 固定字符数、仅行号定位 | 实现段落/标题优先 chunker 与可回溯 locator，先覆盖 Markdown、PDF、DOCX 与纯文本 |
| 关键词与向量双路召回、阈值、可配置权重、候选窗口和可选 rerank | 固定 0.45/0.55 权重，无阈值或 rerank | 使用 RRF 作为默认融合，增加 per-task 参数和可关闭的 Top-N rerank |
| Elasticsearch/Infinity 等全文与向量后端、ANN 参数 | JSON 全量扫描 | 仅在项目规模触发阈值后提供可选索引后端；小型单机保持零服务依赖 |
| 召回得分、候选数量和检索阶段可观测 | 只返回单一 relevance | 写入 retrieval trace，用于调参、故障定位和离线评测 |

不应直接复制 RAGFlow 的多引擎、多租户、队列和完整企业服务栈；Workbench Core 的首要目标仍是本地、可安装、可审计的写作工作台。先建立清晰接口和评测，再按实际语料规模升级索引基础设施。

### 16.6 评测与验收

建立包含中文论文、专利、合同和技术报告问题的验证集。每个查询标注支持它的材料块；固定语料版本、chunker 版本、Top-K 和检索配置后，比较 hash、OpenAI、小型本地模型及 BGE-M3/E5。

- 召回：Recall@5、Recall@10、MRR、nDCG@10；
- 证据：证据块是否支持结论、错误绑定率、无证据回答率；
- 工程：索引时长、P50/P95 查询延迟、千次查询成本、索引体积和失败率；
- 回归：更换模型或分块策略后，必须同时报告质量、成本和延迟差异；
- 安全：密钥不入库；模型切换触发重建；失败时明确显示 fallback 状态；不同模型向量不得混检。

建议追加实施顺序：

1. `refactor(retrieval): introduce embedding provider contract with hash fallback`
2. `feat(retrieval): add OpenAI-compatible embedding provider and secure credential references`
3. `feat(retrieval): version chunk indexes and support incremental re-embedding`
4. `feat(retrieval): add Chinese-aware structured chunker and retrieval trace`
5. `feat(retrieval): add keyword+dense RRF fusion and configurable thresholds`
6. `feat(retrieval): add optional local vector index and reranking`
7. `test(retrieval): add Chinese retrieval benchmark and provider compatibility tests`

### 16.7 代码仓 RAG 的后续边界

代码仓导入不属于本阶段的普通材料切块。后续应单独实现 `CodeMaterialPlugin`：用户授权仓库根目录、遵循 `.gitignore` 和大小/文件数限制、按语言解析 AST、提取文件/模块/类/函数/导入/调用关系，再对符号摘要、源码块和依赖图进行三路检索。当前 `.js`、`.ts`、`.py` 仅按普通文本导入，不得误称为 AST 代码理解。

### 16.8 目标模块与责任划分

不要把 Provider、分块、索引、融合和重排继续堆入 `retrieval-service.js`。按以下边界新增目录，旧 `retrieval-service.js` 在迁移完成后只保留兼容导出或被拆除：

```text
src/retrieval/
├─ contracts.js          # EmbeddingProvider、Chunker、Index、Retriever 的输入输出契约
├─ config.js             # 默认配置、无密钥配置校验、配置指纹
├─ providers/
│  ├─ hash.js            # 始终可用的零成本 fallback
│  ├─ openai.js          # OpenAI Embeddings API；也供兼容服务复用公共协议
│  ├─ ollama.js          # 本地 Ollama embeddings API
│  └─ private-http.js    # 用户部署的固定协议服务，不执行任意 URL/脚本
├─ chunkers/
│  ├─ fixed-text.js      # 现有字符分块，作为回退和迁移基线
│  └─ structured-text.js # 标题/段落/token 优先的中文文本分块
├─ indexes/
│  ├─ json-scan.js       # 小项目全量扫描，零额外依赖
│  └─ local-vector.js    # 第二期可选 HNSW 或 SQLite-vec 实现
├─ keyword.js            # 统一 token、关键词和可解释的 lexical score
├─ fusion.js             # RRF、归一化加权融合与阈值
├─ rerank.js             # 可选 reranker 的候选窗口与超时/fallback
├─ service.js            # ingest、query、reindex 的单一门面
└─ telemetry.js          # RetrievalTrace、指标和脱敏错误记录
```

`WorkbenchRuntime` 只依赖 `RetrievalService`，不得知道具体模型或 HTTP 调用细节；`MaterialPlugin` 只产出标准化文本和结构定位信息；工作台 UI 只显示 provider 状态、索引版本、检索证据和可解释分数，不读取密钥。

### 16.9 数据模型、配置与迁移细节

#### 项目级检索配置

在 project 中增加独立的 `retrievalConfig` 与 `retrievalIndex`，不要把配置塞进 `metadata`：

```json
{
  "retrievalConfig": {
    "chunkerId": "structured-text-v1",
    "chunkerVersion": "1",
    "embeddingProfileId": "default-openai-small",
    "fusion": { "method": "rrf", "rrfK": 60, "keywordTopN": 30, "denseTopN": 30 },
    "rerank": { "enabled": false, "candidateLimit": 30, "timeoutMs": 3000 }
  },
  "retrievalIndex": {
    "activeVersion": "idx-20260910-a1b2",
    "state": "ready | building | stale | failed | fallback",
    "configFingerprint": "sha256:...",
    "sourceRevision": 12,
    "chunkCount": 86,
    "lastErrorCode": null,
    "updatedAt": "..."
  }
}
```

embedding profile 是宿主级命名配置，例如 `default-openai-small`、`local-bge-m3`、`offline-hash`；项目只保存 profile ID 和不可逆的配置指纹。实际 `credentialRef` 由 DSH/Core 宿主解析。项目导出、快照与 `wb_get_workbench` 返回值必须过滤 `baseUrl` 中的凭据、token 和任何 secret。

#### chunk 与 trace

源块替换为以下最低字段：

```json
{
  "id": "chunk-uuid",
  "materialId": "material-uuid",
  "content": "原文片段",
  "contentSha256": "sha256:...",
  "locator": { "page": 4, "headingPath": ["第三章", "3.2 方法"], "startLine": 18, "endLine": 42 },
  "chunkerId": "structured-text-v1",
  "chunkerVersion": "1",
  "indexVersion": "idx-...",
  "embedding": [0.0],
  "embeddingMeta": { "provider": "openai", "model": "text-embedding-3-small", "dimensions": 1536, "normalized": true }
}
```

返回的检索结果增加 `keywordScore`、`denseScore`、`fusionScore`、`rerankScore`、`rank`、`indexVersion` 和 `fallbackUsed`。`RetrievalTrace` 只保存查询哈希、计数、耗时、模型标识、索引版本和错误码；原始查询和材料文本默认不写入 trace，避免把敏感内容复制到审计日志。

#### 存储迁移

1. 将 `CURRENT_SCHEMA_VERSION` 升级，并在 `#migrate()` 为旧项目补齐默认 `retrievalConfig`、`retrievalIndex`；旧 `sourceChunks` 标记为 `legacy-hash-v1`。
2. 迁移后仍可用旧 hash 块查询，`state` 为 `fallback`；不在启动时同步调用外部 embedding 或阻塞打开项目。
3. 用户选择新 profile 或内容/分块策略变更后，创建新的 index version，旧索引保持只读，直到新索引完成并通过抽样校验。
4. 新索引失败时保留旧索引，并将 active 指针回退；只有用户明确清理时才删除旧索引。
5. 任何索引状态变化都写 audit；索引任务使用现有 run/checkpoint/idempotency/revision 机制，避免重复计费和重复写块。

### 16.10 Provider 的具体实现顺序

#### P1：Hash Provider 重构（无行为变化）

1. 将现有 `localEmbedding()` 迁到 `providers/hash.js`，保持 token 化、192 维和归一化输出完全一致。
2. 建立 `createRetrievalService(config)`，默认注入 `HashEmbeddingProvider` 和 `FixedTextChunker`。
3. 把 `runtime.importMaterialFile()`、`searchMaterials()` 改为调用 service；保持既有 `wb_search_materials` 返回字段兼容。
4. 为 hash 输出、旧数据读取、空查询、向量维度不匹配和 provider 未配置建立单测。

验收：不配置任何模型时，现有检索测试和旧项目读取结果不退化；所有检索结果明确标记 `embeddingProvider: hash`。

#### P2：OpenAI-compatible Provider（最低云端接入成本）

1. 使用 Node 内置 `fetch` 实现 `/embeddings` 调用，避免仅为一个 HTTP 调用引入 SDK；支持 OpenAI 与遵循同一请求/响应协议的私有网关。
2. `embedDocuments()` 按 provider 的 token/批量限制切批，保持输入与返回向量的序号映射；`embedQuery()` 使用同一模型与维度。
3. 调用前检查 `credentialRef` 已解析但不把值传入日志；对 `401/403` 设为不可重试，对 `429/5xx/网络错误` 采用有上限的指数退避。
4. 首期默认 profile 为可选的 `text-embedding-3-small`；没有凭据、网络异常或 provider 不可用时，只有在 `fallback: hash` 已启用时才降级，并把原因返回给 UI。
5. `text-embedding-3-large` 只作为另一 profile，不改变接口；所有模型维数以首次成功响应和 profile 声明共同校验，防止错配。

验收：模拟 HTTP server 覆盖顺序、批处理、超时、401、429、维度错误、hash fallback 和密钥脱敏；真实 API 集成测试只在显式环境变量存在时运行。

#### P3：本地与私有模型 Provider

1. 实现 Ollama provider，配置固定 `baseUrl` allowlist、模型名、超时与并发上限；禁止让材料内容驱动 URL 或 header。
2. `private-http` 采用版本化、严格 JSON Schema 的固定协议；若企业网关为 OpenAI-compatible，复用 P2 而非新增重复实现。
3. BGE-M3、E5 作为模型 profile，而不是硬编码为独立业务分支。E5 profile 在文档块前加 `passage: `、查询前加 `query: `；BGE-M3 profile 必须声明 dense-only 或 dense+sparse 能力。
4. local provider 应报告模型加载时间、单批耗时和内存/GPU 不可用状态；不允许静默切到远端服务。

验收：以 fake Ollama/private server 验证协议；相同 profile 的 query/document 向量维度一致；E5 前缀逻辑有确定性测试。

### 16.11 分块、检索融合与重排的具体落地

#### P4：结构化中文分块

1. Parser 输出统一 `DocumentSegment`：文本、页码、标题层级、行区间、表格/图片说明和原始顺序。
2. `StructuredTextChunker` 首先在 Markdown 标题、空段、中文句末标点处分割；超过 token 上限才向下细分，禁止切断标题与紧随其后的首段。
3. token 计数必须由 provider/profile 声明的 tokenizer 估算；无 tokenizer 时采用可复现的字符近似并在 metadata 标记 `tokenEstimate: true`。
4. PDF/DOCX 首期可先使用已有抽取文本和页/标题信息；表格和图片上下文只在 parser 实际提供 locator 时启用，不能伪造位置。
5. 工作台新增“分块预览”：显示标题路径、页码、文本、token 数和邻接块，允许用户在索引前发现错误分段。

验收：中文论文标题、编号小节、长段、表格说明、英文缩写与中英混排构成固定夹具；切块不丢字、不重复超出设定 overlap，locator 可回指原材料。

#### P5：双路召回与 RRF

1. `KeywordRetriever` 复用并改进现有中文 token 逻辑；先只做内存倒排或全量打分，不立即引入 Elasticsearch。
2. `DenseRetriever` 根据 active index version 取 query embedding，并限制在同一模型/维度/配置指纹的 chunks 内。
3. 两路各自取 Top-N，按 `1 / (rrfK + rank)` 计算 RRF；同一 chunk 的两路得分累加，保留各自 rank 与分数。
4. 当 dense provider fallback 或索引 stale 时，自动运行 keyword + hash 路径，trace 与 UI 显示降级，而不是伪造 dense 分数。
5. 支持任务类型覆盖默认值，例如专利提高关键词/精确术语召回，论文提高 dense 召回；覆盖项须经 Plugin Spec 校验。

验收：构造“术语精确命中但语义弱”“同义表达但无字面重合”“中英混合缩写”三类中文测试，证明 RRF 不会让单一路径完全压制另一条路径。

#### P6：可选 rerank 与本地向量索引

1. 先对融合后的 20--50 个候选调用 reranker；每次检索最多一次 rerank 请求，超时或错误时直接使用 fusion 排名。
2. reranker 初期只作为 `RerankProvider` 契约，不绑定具体厂商；默认关闭，并对每项目设置候选上限和超时，防止写作交互被阻塞。
3. 在 source chunk 数量低于配置阈值时继续使用 JSON scan；超过阈值后后台构建本地 HNSW 或 SQLite-vec 索引。Index 接口必须支持 `build`、`query`、`validate`、`activate`、`deleteVersion`。
4. 向量索引只是 dense 候选召回器，仍需 keyword、融合和证据定位；不能把向量数据库当作最终答案来源。

验收：reranker 不可用时 P95 延迟仍受超时上限约束；索引构建中和切换中可继续使用旧 active version；大语料基准验证 ANN 召回与 JSON scan 基线的差异在预设容差内。

### 16.12 工具、UI 与用户操作流程

新增或扩展以下受阶段守卫的工具：

```text
wb_list_embedding_profiles             # 不返回密钥
wb_get_retrieval_status                # provider、索引版本、state、fallback、统计
wb_configure_retrieval                 # write 阶段；配置变更需要 userConfirmed
wb_reindex_materials                   # write 阶段；创建可恢复 run
wb_get_retrieval_trace                 # 返回脱敏 trace
wb_preview_chunks                      # 索引前预览与人工核验
```

工作台操作流程：

1. 项目创建后默认显示“离线基础检索（hash）”；
2. 用户选择已配置的 profile，而非输入 API Key；页面展示隐私/成本提示和预计重建范围；
3. 用户确认后创建 reindex run，旧索引持续可查询；
4. 成功后显示新模型、分块数量、耗时和抽样结果；失败后保留旧索引并提示 fallback 原因；
5. 每次检索可展开查看来源、定位、关键词/dense/fusion/rerank 分数和是否降级；
6. 进入 `review` 时允许查看 trace 与证据，不允许改 profile 或启动重建。

### 16.13 测试矩阵、发布门禁与提交拆分

| 提交 | 主要文件 | 必须测试 | 发布门禁 |
| --- | --- | --- | --- |
| `refactor(retrieval): introduce provider contracts` | `src/retrieval/contracts.js`、`providers/hash.js`、Runtime 接线 | hash 回归、空输入、维度检查 | 无配置行为等价于旧版本 |
| `feat(retrieval): add versioned retrieval storage` | `storage.js`、migration、index metadata | 旧 JSON 迁移、旧索引回退、审计 | 不丢材料、旧项目可打开 |
| `feat(retrieval): add OpenAI-compatible embeddings` | `providers/openai.js`、配置解析 | mock API、批处理、429、超时、secret redaction | 无密钥不发网；失败可回退 |
| `feat(retrieval): add local/private providers` | Ollama/private provider | 协议、E5 前缀、禁止任意 URL | 本地失败不外发数据 |
| `feat(retrieval): add structured chunking` | chunker、parser metadata、UI preview | 中文夹具、locator、token 上限 | 旧 fixed chunker 可继续使用 |
| `feat(retrieval): add RRF hybrid retrieval` | keyword、dense、fusion、trace | Recall/MRR、小语料回归 | 分数可解释、降级可见 |
| `feat(retrieval): add optional rerank and local index` | rerank/index adapters | timeout、旧索引在线、ANN 召回 | 默认关闭、无外部服务可运行 |

发布前至少运行三类测试：

1. **纯单元测试**：不访问网络、没有模型和密钥时，hash fallback、配置校验、迁移、RRF、locator、索引版本与审计全部通过；
2. **provider 契约测试**：用本地 mock server 验证 OpenAI/Ollama/private HTTP 的响应、错误、批处理、重试和脱敏；
3. **中文离线基准**：固定问题—证据标注集产出 Recall@5/10、MRR、nDCG、成本和延迟报告。合并新模型或调整 chunker/fusion 参数时必须提交与 baseline 的对比，质量下降需明确批准。
