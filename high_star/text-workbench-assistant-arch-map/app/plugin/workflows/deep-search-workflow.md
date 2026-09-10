# 应用层：节点研究与问答

此流程在已生成应用中执行，不创建 Profile 或脚手架。输入：sessionId、真实 nodeId、query。读取 [ReAct 提示词](../prompts/react-prompt-template.md)。先 GET /api/knowledge 获取节点，GET /api/llm/config 查看公开配置状态；不要输出 Key。

聊天 POST /api/agent/chat，返回 SSE（meta/delta/done/error）。示例请求体：
```json
{"sessionId":"local-session","nodeId":"lidar","query":"飞行时间测距有哪些误差来源？"}
```

深搜使用后台入口（适合长任务）：
```js
const started = await fetch("http://localhost:3000/api/agent/jobs", {
  method: "POST", headers: {"Content-Type":"application/json"},
  body: JSON.stringify({sessionId:"local-session",nodeId:"lidar",kind:"deep-search",query:"完善测距误差与验证方法"})
}).then(r => r.json());
console.log(started.job.id);
const state = await fetch("http://localhost:3000/api/agent/jobs?sessionId=local-session").then(r => r.json());
console.log(state.jobs);
```

也有同步 POST /api/agent/deep-search，参数为 sessionId/nodeId/query。后台任务优先，轮询应间隔数秒而非高频。停止任务使用 DELETE /api/agent/jobs，body={id,sessionId}。

实际链路：公开路由 → OnlineAgentService → 已激活 Profile + configured provider → collectAdaptiveResearch → 研究批次 → 合并/审查 → 待确认候选。应用已有确认机制负责正式写入，不将候选生成描述为已经改图。

验证：任务 state 完成、未把离线覆盖检查当在线检索；候选引用正确；确认后 /api/knowledge revision 增长；未确认时不应写入。错误或格式审查失败需显示诊断。服务重启会标记未完成任务失败并保留批次，不声称自动续跑。
