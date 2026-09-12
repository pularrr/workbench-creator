# 文本生成工作台拆分、同步与持久化开发计划

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
