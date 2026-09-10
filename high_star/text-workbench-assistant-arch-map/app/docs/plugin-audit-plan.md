# 两层工作流审查与开发计划

审查日期：2026-09-05。用户后续图片指定基准 b45dd0c0655fa2c0bbe3099c3770d20d267b8422，已在本地验证。图片为版本说明，不是界面截图。当前运行时数据131节点/131卡/11域；.bak-p0 实际119节点/119卡/11域，不能替代当前完整数据。

## 开发前结论

当前项目具备应用层基础，但尚不能按所述七步稳定交付任意主题应用。不能用目录存在或文档中的“已完成”替代功能验收。

| 要求 | 现状与证据 | 优先级 |
| --- | --- | --- |
| 插件七步流程 | plugin/SKILL.md 要求重新实现核心应用，和 templates/app 脚手架路径冲突 | P0 |
| Profile 设计 | ProfileDesigner 已复用 provider；设计器需要 Key，宿主 LLM 直接编写 JSON 才无需额外 Key | P1 |
| MVP 2–3 轮 | knowledge-generator.ts 实际为每节点最多6轮、30次调用、30个访问主题，仍会深入检索 | P0 |
| 完整生成复用 | 已调用 collectAdaptiveResearch，但每次重新初始化，未接续确认过的 MVP | P0 |
| 统一审查与数据注入 | 生成器重复实现 warning 规则；转换用 contentText、active、每栏目一卡等错误字段；裸 network 不能作为带 checksum 的 runtime 状态 | P0 |
| 脚手架 | 缺失 Profile 时生成空模板；root ID 使用 profile ID 推断；Profile 未激活 | P0 |
| 应用模板 | initial-dataset 字段错误、空域，包脚本引用未携带测试；没有独立产物验收 | P0 |
| 运行时 Profile | online-agent-service 未传 Profile；默认回答仍是 FMCW；类型、栏目、布局有固定集合 | P1 |
| 深度研究 | 逐节点轮次重置、自适应预算、批次、子调用存在；子调用是同进程拆分，非多机分布式 | P1 |
| 上下文与收敛 | JSON 整串 slice 可能截断结构；queue 为空不等于知识缺口收敛；节点访问预算不等于输出节点上限 | P1 |
| 恢复 | 有研究批次落盘，无完整 PluginState 恢复执行入口；不得宣称自动断点续跑 | P1 |
| 模型兼容 | 当前 provider 使用 Responses 协议，不能把任意 Key/baseUrl 视作兼容；宿主发现和运行时协议是两件事 | P1 |
| 交互 | 已有聊天、深搜、资料接入、Markdown/KaTeX、字号；需真实浏览器和真实提供商进一步验收 | P1 |

## 执行计划（先规划后开发）

1. 新增统一 network→dataset 转换，校验父级、类型、域、卡片、关系，复用现有粒度规则；拒绝结构损坏。
2. 增加本地插件命令，支持发现、Profile 设计、MVP/full、校验和注入；full 明确接收已确认 MVP；生成数据与运行时状态分离。
3. 修正 MVP 预算与共享研究上下文；实际统计子调用；限制研究时间到35分钟。
4. 修正脚手架：有效 Profile 输入、真实根 ID、激活 Profile、保留基准 UI、无凭据打包、正确 seed 和运行时初始化。
5. 重写 SKILL 与六个工作流：逐步给出工具、输入、输出、命令、验证、失败处理；补 Profile/MVP/full/review 提示词。
6. 验证入口、无模型数据转换与状态往返、非 FMCW 脚手架、类型检查、已有回归测试。区分本地通过和真实模型/视觉尚未验证。

## 后续改进：可靠后台任务与长回答（P3-7）

实施状态：2026-09-05 已完成长驻 Node 第一阶段，包括存储接口、任务/正文分离、列表分页、结果分段、checksum、会话隔离、明确中断状态及 deep-search 202 后台入口。外部队列、独立 Worker、lease/heartbeat 和自动断点恢复属于第二阶段，需选定 Serverless 部署提供商后接入；详见 `docs/dev-reports/p3-7-long-job-reliability.md`。

当前 `POST /api/agent/jobs` 虽然先返回 `202`，但任务仍由同一个 Node 进程中的异步函数执行，状态写入本机 `data/runtime/jobs`。这能避免浏览器切页、刷新或断开连接直接取消任务，但不等于独立后台任务系统。

在 Serverless 环境中，请求结束后实例可能冻结或销毁；后续轮询也可能命中另一实例。本机内存、`globalThis`、本机文件和未 `await` 的异步任务都不能作为可靠状态。因此当前实现只支持长驻 Node 服务，部署到 Serverless 前必须完成以下改造：

1. 抽象 `JobRepository`、`JobQueue`、`ResultStore`，本地开发可继续使用文件实现，生产使用共享数据库、消息队列和对象存储。
2. HTTP 创建接口只负责校验、持久化任务和入队；独立 Worker 领取任务。用 lease、heartbeat、幂等键、重试次数和状态机避免重复执行及永久卡在 running。
3. 保存研究检查点、已访问节点、模型调用数和当前批次。Worker 重启后从检查点恢复；无法恢复时明确标记 interrupted/failed，不伪称完成。
4. 将事件流和最终产物分开：`GET /jobs/:id` 仅返回小型元数据；`GET /jobs/:id/events?cursor=` 分页读取进度；`GET /jobs/:id/result?cursor=` 分段读取回答；大产物存对象存储并返回受控下载引用。
5. SSE 仅发送增量事件和最终结果引用，支持事件 ID、断线续传与心跳；不在 `done` 事件中再次复制整篇回答。轮询作为降级路径。
6. 为列表增加 cursor 分页和字段投影，禁止一次返回最近 100 个任务的全部回答与候选，避免网关响应上限、内存峰值和重复传输造成截断。
7. 用户可见回答按原始换行保存全文；存储层按 UTF-8 安全边界分块，读取后做顺序和 checksum 校验。不得用字符串 `slice` 作为交付层截断策略。
8. 每次模型调用仍受 provider 输出上限约束。若模型因长度未完成，保存已闭合的结构化项目，记录 incomplete 原因并继续下一批；不能把 HTTP 分块误解为模型可以无限输出。
9. 按用户/会话隔离任务与结果，校验工作区和输出路径；配置与密钥不进入任务参数、日志或结果正文。

共享研究上下文采用 `boundedContext` 做结构感知的压缩，只把最近 6 批的评估、缺口、节点名和卡片标题送入下一轮，以控制提示词长度；完整批次始终保存在检查点，最终回答拼接全部批次，不只保留最后 5 批。这里的“最近 6 批”仅是下一轮模型的工作记忆窗口，不是数据保留窗口，也不是用户可见答案上限。

验收标准：浏览器刷新不丢任务；HTTP 实例退出后 Worker 可恢复；同一任务最多产生一个已确认结果；10 MB 多段回答可完整校验下载；任务列表响应大小不随历史回答正文增长；SSE 断线后从 cursor 继续且不重发全文；本地长驻模式和 Serverless+Worker 模式通过同一状态机契约测试。

## 后续改进：LLM 发现与 DSH 插件适配（P3-8）

插件发现分为两个层面：

- 提示/技能发现：宿主索引插件或 Skill 的名称和说明，命中用户任务后再加载详细指令。
- 可执行工具发现：宿主把工具的 `name`、`description` 和参数 schema 放入当轮模型可见的工具清单；模型选择调用后，由宿主校验参数并执行实现。

`plugin/discovery.mjs` 目前只提供宿主中立描述，`scripts/knowmap.mjs` 提供执行入口。文件存在本身不会让 LLM 自动发现它；每个宿主仍需一个注册适配器。DSH 版作为独立 `plugins/dsh-plugin` 子包维护，避免把 DSH 依赖耦合进生成出的知识图谱应用。

DSH 适配计划：

1. 记录并固定已验证的 `deepseek-ai/deepseek-harness` commit、`@deepseek-ai/dsh`、`@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-tools` 版本；DSH 处于 developer preview，升级必须经过兼容矩阵测试。
2. 导出标准 Cordis 插件 `apply(ctx)`，声明 `inject = ["tools"]`；用 `ctx.tools.register(defineTool(...))` 注册模型工具，并由 Cordis effect 生命周期负责卸载清理。
3. 不暴露一个可执行任意命令的万能工具。按阶段注册 `knowmap_discover`、`knowmap_design_profile`、`knowmap_validate_profile`、`knowmap_generate_mvp`、`knowmap_generate_full`、`knowmap_validate_network`、`knowmap_create_app`、`knowmap_inject`，参数映射到现有 `runKnowmap()` 与脚手架入口。
4. 长任务新增 `knowmap_job_start`、`knowmap_job_status`、`knowmap_job_result`、`knowmap_job_cancel`，接入 P3-7 的共享队列和结果分段接口；模型工具调用只返回 jobId、状态和结果引用，不占住一次工具调用 35 分钟。
5. 配置只允许声明工作区根目录、产物根目录、超时和并发度。所有路径解析后必须位于允许根目录内；输出默认新建且不覆盖；API Key 由 DSH/宿主 secret 配置提供。
6. 将 KnowMap 的 Skill/工作流说明作为 DSH 可按需加载的提示资源；固定工具 schema 保持简短稳定，减少每轮 token 成本。可选进度面板放到后续版本，不作为首版验收条件。
7. 提供本地 `cordis.yml` patch 开发方式和独立 profile 的 bundle 安装方式；安装、卸载和升级均不得修改用户知识数据。
8. 契约测试使用假的 `tools` registry 验证注册、schema、执行映射和 dispose；集成测试在固定 DSH checkout 中验证模型能看见工具、发起 MVP 任务、轮询到完成并取得完整结果。

首版 DSH 适配器的完成条件：启动时能注册工具，工具 schema 可由 DSH 列出；模型能从自然语言任务选择正确工具；所有路径越界和覆盖请求被拒绝；长任务不依赖 HTTP 请求存活；卸载后工具消失且任务数据仍可恢复。完成 P3-7 前，可以先交付仅支持本地长驻进程的 DSH 技术预览版，但必须明确标注不支持 Serverless 可靠执行。

## 边界

域数和节点目标不是硬限制；现有 UI 的类型枚举和配色不能只靠 Profile JSON 自动扩展，新增未支持类型需同步引擎。35分钟是研究阶段上限，不是 npm install/build 的总交付 SLA。不把粒度 warning 自动改写为已经语义修复；审查需结合实际问题逐项修复并重新校验。
