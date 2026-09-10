/**
 * 插件契约统一导出
 *
 * 4 个核心契约：
 * 1. TaskProfile —— 主题配置契约（域、节点类型、边类型、栏目、审查规则、提示词、根节点）
 * 2. ResearchCandidate —— 知识候选契约（新节点、卡片块、关系、证据）
 * 3. MvpOutput —— MVP 输出契约（Profile 摘要 + 最小知识网络骨架 + 示例卡片）
 * 4. PluginState —— 插件状态契约（当前阶段、Profile、检查点、用户确认记录）
 */

export * from "./task-profile";
export * from "./research-candidate";
export * from "./mvp-output";
export * from "./plugin-state";
