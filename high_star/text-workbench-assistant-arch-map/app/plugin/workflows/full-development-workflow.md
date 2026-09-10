# Step 3：接续确认的 MVP 完整研究

输入：隔离任务目录中的 mvp.json 与用户对该版本的明确确认。输出：同一隔离目录中的 full.json。读取 [完整开发提示词](../prompts/full-development-prompt.md)。

只有在用户明确验收 MVP 及预算后，宿主 LLM 才能接续 MVP 编写完整 `{phase:"full",topic,profile,network,generatedBy:"host-llm",confirmedMvp:true,mvpConfirmation:{confirmed:true,approvedBudget:{durationMinutes,visitTopicCount,maxModelCalls},...}}`。缺少任一预算项或明确验收时，必须停留在 MVP 展示阶段。禁止调用 `knowmap.mjs full`、项目 KnowledgeGenerator、DeepSeek 配置或任何项目内 Provider。只调用确定性校验：
```sh
node scripts/knowmap.mjs validate --input <隔离任务目录>/full.json --output <隔离任务目录>/full-validation.json
```

full 必须继承已确认 Profile 和 MVP，不重新初始化知识树。宿主逐节点执行 [统一逐节点分析循环](../references/node-analysis-loop.md)：先做不受栏目缺口限制的基线分析并归档理论/应用/其他知识，再规划必要骨架，最后围绕具体缺口饱满深挖并去重。宿主可分批编写节点、卡片和关系；每批同时按 [先总后分的层级构造法](../references/hierarchy-construction.md) 与 [知识卡语义与内容判定](../references/knowledge-card-semantics.md) 审查并保存，最后统一合并校验。

维护明确的待扩展节点队列。每个节点出队时作为新的局部根，重新获得完整轮次、局部观察、静默计数和局部新增节点预算；新增孩子继续入队。全局时间、调用和访问主题预算不是树深或单节点上限。不得按从总根累计的 `maxDepth` 截断；主要域通常应有不少于6层的代表路径。

`confirmedMvp` 是硬门槛，不是模型推断值；必须来自用户对当前 MVP 与预算的明确确认。执行使用已批准预算：时间或非叶父主题数任一达到即保存检查点并停止；默认上限300，确认没有下级节点的拓扑叶子不计数。调用数使用批准的宽松保险丝，默认4096。用户修改域、根节点、范围或预算时，原确认失效，必须重新生成并重新验收 MVP。

80–150是知识节点建议目标，不是截断上限。卡片栏目数量由任务语义决定，不要求每节点5项或填满13项；空泛栏目应省略。未覆盖内容作为 gaps 交付审查。

失败：保留隔离目录中的已完成批次，修复后写新文件并重跑 validate。不得向 KnowMap 项目的 data/runtime/research 写构建检查点。
