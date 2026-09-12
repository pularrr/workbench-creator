# Step 4–7：审查、创建应用、注入、交付

输入：含 profile 和 network 的生成结果。读取 [知识审查提示词](../prompts/knowledge-review-prompt.md)。

## 1. 结构和语义审查

```sh
node scripts/knowmap.mjs validate --input work/full.json --output work/full-review.json
```

networkToDataset 先检查字段、根、父级、类型、域、栏目，再调用 validateKnowledgeDataset 检查结构和四条粒度规则。error 阻止通过；warning 必须逐项评估，不代表已经修复。模型产生的来源需要核验，禁止伪造论文信息。

用宿主文件工具将修复结果保存为 work/reviewed.json，保留 {topic,profile,network}。拆分多概念节点时修正所有引用；名称过长应重新命名而不是截断；problem 只留问题，方法另建节点并使用 MITIGATES。重跑：
```sh
node scripts/knowmap.mjs validate --input work/reviewed.json --output work/reviewed-validation.json
```
结构错误的命令返回非0。报告 valid:true 只表示结构合格，不能证明事实正确。

## 2. 创建并注入

确保 work/profile.json 与 reviewed.json 中的 profile 完全一致。若 Profile 在审查阶段改变，应返回 MVP 确认。
```sh
node scripts/create-app.mjs --profile-file work/profile.json --name my-map --output work/my-map
node scripts/knowmap.mjs inject --input work/reviewed.json --output work/my-map
```

脚手架复用模板 UI 和当前共享引擎，生成 profiles/active.json、active.ts 和 app/config.ts。输出目录已存在、Profile 缺失或不兼容时拒绝创建。

注入必须在首次启动应用前运行。inject 使用 RuntimeKnowledgeRepository 创建 state/checksum 封装并回读。已有 knowledge-state.json 或备份时拒绝覆盖；如需更新已运行应用，使用应用内研究提案和确认流程。

## 3. 在产物目录验收

```sh
npm install
npm run type-check
npm test
npm run build
npm run dev
```

逐项记录真实结果：页面显示所选主题；根和域符合 Profile；点击节点卡片有正文；图谱缩放/拖动；Markdown 表格和 LaTeX；字号修改与刷新保存；离线回答；配置提供商后的在线聊天、深搜和资料导入。检查 /api/knowledge 返回正确节点数。

原始项目回归另执行 npm test 和 npm run test:plugin。生成应用 npm test 使用通用 Profile/状态往返测试，不用固定 FMCW 节点名称作为其他主题的通过标准。

交付记录列出输出目录、启动方式、节点/卡片/域数量、已测项目、未核验事实、研究停止原因、真实模型与浏览器是否测试。不能把复制完成、结构校验通过或模拟提供商测试写成全部验收通过。
