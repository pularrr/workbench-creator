# Profile 设计提示词

仅由宿主 LLM 读取并直接产出 JSON，不调用项目 ProfileDesigner 或项目内 Provider。变量由宿主替换：{{topic}}、{{scope}}、{{references}}。

你在为“{{topic}}”设计知识图谱应用的 TaskProfile。范围：{{scope}}。参考材料：{{references}}。输出符合 plugin/contracts/task-profile.ts 的完整 JSON，不输出应用代码。

按域划分、类型选择、栏目与提示词、根及初始化策略、引用一致性五步设计。数量按主题需要，不能为满足3–8域、11类型或13栏目凑项目。13栏目只是当前渲染器支持的候选词表：逐项判断其对当前任务是否有意义，选择必要子集并重新设置 appliesTo、coverage 和 order；definition 必选，其他栏目不能机械套用。当前引擎只支持现有基础类型和栏目；配色 ID 从 foundation/signal/data/system/ai 选择，语义域 ID 自定义。根 ID 不与域 ID 重复。

prompts.react/review/finalResponse 非空，ingest 对资料类型给出具体指令；不残留 FMCW 专属术语。validation 计数等于实际配置，并设置 maxPrimaryChildren（通常为8）。nodeTypes 保留 category 作为中间导航类型。MVP 推荐15–30节点、2–3轮；full 推荐80–150节点，研究不超过35分钟。包含 id/name/description/version/schemaVersion/createdAt/updatedAt。

生成后执行 validate-profile，以真实错误修复，不能只宣称 JSON 符合类型。来源不足的知识暂不写成事实。
