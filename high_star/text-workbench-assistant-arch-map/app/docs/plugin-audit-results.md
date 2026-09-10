# KnowMap 插件审查与实现结果

日期：2026-09-05。工作顺序：先完成 [开发前审查与计划](plugin-audit-plan.md)，再修改代码，最后做回归和非 FMCW 产物验证。

## 结论

原项目只能部分满足任务：应用层基础完整，插件层文档与执行逻辑不一致，不能可靠交付任意主题应用。本次补齐了可执行构建入口、跨宿主发现描述、数据转换与注入、Profile 激活、MVP 边界及操作型文档；本地构建链路已验证。不能因此宣称所有 LLM、所有自定义类型或真实35分钟研究均已通过验收。

## 基准核对

用户图片指定 b45dd0c，已解析为 b45dd0c0655fa2c0bbe3099c3770d20d267b8422。该提交说明包含节点类型合并和粒度规则加固，作为 P3 起点。未切换或回退当前工作区。

- 当前 data/runtime/knowledge-state.json：131节点、131卡片、11域。
- data/runtime/knowledge-state.json.bak-p0：119节点、119卡片、11域；不是当前131节点数据的完整等价备份。
- 两份运行时数据未用于脚手架复制，也未被本次注入操作覆盖。
- 开发前对比基准：主要页面、既有 Agent 服务、provider、功能组件未发生 P3 修改；变更集中在 Profile、模板、文档和生成器。原模板仍存在缺失导入、字段错误和主题残留，因此“已有模板”不等于完成插件化。

## 两层逐项评价

| 能力 | 修复前 | 本次结果 / 证据 |
| --- | --- | --- |
| 七步构建流程 | SKILL 指示重写应用，和模板复制冲突 | SKILL 统一为设计→MVP→确认→full→审查→脚手架→注入与验收，六份工作流给出可运行命令 |
| Profile 五阶段设计 | 字段提示与契约不一致，如 title/category、reactPrompt | 改为 label/coverage、react/review/finalResponse/ingest；统一 schema 与引用校验，不强制域/类型数量 |
| MVP | 每节点6轮、可遍历30主题，文档与联网策略矛盾 | 根主题2–3轮，最多2次浅搜索，禁用拆分调用，只留 definition；模拟提供商测试验证 |
| 完整研究 | 每次从零初始化，不能延续确认的 MVP | full 强制接收已有 network 与 confirmedMvp；实际从原网络继续 |
| 预算 | 35分钟与40分钟文案冲突；访问节点预算易被误解 | 共享研究时间最多35分钟，保留调用/访问主题预算；节点数量为参考目标 |
| 数据合并 | 同批重复漏检、临时引用容易失效 | 复用 operationsFromResearch 和图操作，批量解析名称、ID、层级、卡片和证据 |
| 卡片与状态格式 | contentText/active 字段错误、每栏目一张卡、裸 JSON 注入 | networkToDataset 聚合为每节点一卡、正确 text/status/level/domain；RuntimeKnowledgeRepository 初始化封装及 checksum 并回读 |
| 统一粒度审查 | 生成器重复写另一套规则，只返回建议 | 复用 validateKnowledgeDataset；结构错误阻断，warning 交宿主语义审查并重验 |
| 脚手架 | 缺失 Profile 仍生成空应用，根 ID 猜测、依赖遗漏 | 缺失输入提前失败；JSON Profile 激活，真实根 ID，共享引擎/API/依赖覆盖；拒绝覆盖已有产物 |
| 模板 UI | 根类型推导过窄，FMCW 标签/按钮残留；聊天区被内容高度挤出 | state 显式 string；非 FMCW 使用通用标签并隐藏基准入口；模板网格行限制可用高度 |
| Profile 运行时 | 默认 FMCW，深搜未传 Profile | active.ts 是应用统一入口，加载器/校验/回答/深搜/审查/资料提示接入 |
| 上下文 | 直接截断序列化 JSON；深搜回答截到8000字并压平 Markdown | 共享研究使用 boundedContext 和最近6批上下文；保留用户可见回答的换行与全文，批次回答不只保留最后5批 |
| 子调用 | 功能存在但统计为0；只新增节点却无 gap 时不真正拆分 | 返回真实调用统计，无 gap 时按新节点主题拆组，继承 Profile 提示词 |
| 收敛 | 队列空就认为收敛 | 还检查预算、连续失败、最近批次缺口与 converged |
| API Key | 设计/生成 route 只看环境，忽略已保存配置 | 使用 RuntimeLlmConfigStore；不将凭据复制入产物 |
| 长生成请求 | 5分钟 HTTP route 跑35分钟 full | full 使用本地命令；HTTP route 明确拒绝 full，避免假装部署支持 |
| 跨 LLM 发现 | 无可调用发现函数 | discoverKnowmap() 提供名称、描述、inputSchema 和执行入口；runKnowmap() 负责本地执行 |
| 运行时问答/深搜/资料 | 已有完整基础与确认门禁 | 保留既有入口，文档区分 SSE 问答、后台任务、文本和文件资料接入 |
| 自动恢复 | 类型/批次落盘被描述成完整恢复能力 | 文档纠正：保留批次，但尚无遍历队列自动恢复；从审查网络重新启动是新研究 |

## 新入口

```sh
node scripts/knowmap.mjs discover
node scripts/knowmap.mjs profile-example --output work/profile.json
node scripts/knowmap.mjs validate-profile --input work/profile.json --output work/validated-profile.json
```

后续按 plugin/SKILL.md 操作。发现函数需宿主注册，不能保证任何聊天窗口自动扫描并执行本地插件。当前 plugin.json 是本项目描述格式，不是已发布、已安装的所有平台原生插件包。

## 验证记录

- 基准项目 npm test：54项通过（UI 5、model 21、workflow 9、deep-search 3、provider 8、tools 2、reliability 6）。
- UI 显示接入 Profile 后，再次执行 UI 5项回归通过。
- npm run type-check：通过。
- npm run test:plugin：发现契约、非 FMCW 模拟研究/去重/层级/卡片/证据/确认边界/持久化通过。
- skill-creator 的 quick_validate.py：通过。校验依赖安装到忽略的 work/skill-validator，未改项目依赖。
- 生成的激光雷达验证应用：类型检查、通用 Profile 与状态往返测试、生产构建通过。
- 构建输出包含聊天、确认、深搜、生成、后台任务、知识读写、资料接入、LLM 配置与 Profile 设计路由。
- 实际 inject 回读8节点、8卡、7域、根 lidar；Profile ID 为 lidar-tech-route，验证了两者不相等时的处理。
- Edge 无头浏览器：主题标题正确、无 FMCW 分组标签、基准扩充按钮隐藏；字号修改后刷新保留；离线问答有响应；未捕获页面异常。最后验证聊天区在视口内、展开按钮可实际点击、离线回复可见。桌面与手机截图保存在 work/plugin-check。
- 本地生成与构建复用了工作区已安装依赖，未在干净机器重新安装验证；嵌套产物出现 Next 多 lockfile 根目录推断警告，未阻断构建。
- 对早期失败测试目录的批量清理被自动审批以 blocked by policy 拒绝；这些目录保留在忽略的 work/plugin-check，不影响源码或基准数据。

## 尚不能宣称完成的要求

1. 未调用真实付费提供商完成 Profile→MVP→用户确认→35分钟 full 的完整研究。示例应用只是8节点骨架，不是80–150节点的实证研究成果。
2. 当前 Responses provider 不等于任意 API 协议兼容；未逐一验证 Codex、豆包等宿主的原生安装/发现行为。发现描述需宿主工具适配。
3. 支持任意主题的域 ID；当前节点类型、关系、栏目和配色仍受已有引擎词汇表约束。新增类型/栏目需扩展代码，不是修改 JSON 即可。
4. 自动遍历断点恢复、多机分布式执行、完全自举打包未实现。当前子调用是单进程研究拆分。
5. 粒度 warning 与事实审查依赖宿主判断，不能宣称自动语义纠错已经完成。同步资料接口仍存在长度截取，长资料需分章或后台入口。
6. 浏览器确认了核心交互；真实在线回答、文件 OCR/多模态质量、完整知识网络密度下的移动布局仍需专项验收。手机初始详情面板可能遮挡图谱，未将其标为全面响应式验收通过。

## 产物

- 实际执行说明：plugin/SKILL.md。
- 跨宿主发现函数：plugin/discovery.mjs。
- 构建命令：scripts/knowmap.mjs、scripts/create-app.mjs。
- 验证应用：work/plugin-check/lidar-verified（位于忽略目录，不应当作为完整知识交付）。
- 本次改动保留在工作区，未提交、未部署。
