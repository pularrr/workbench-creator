/**
 * TaskProfile 契约 —— 主题配置的核心数据结构
 *
 * P3-2 将把当前 FMCW 的硬编码（域定义、节点类型、边类型、栏目、审查规则、提示词、根节点）
 * 抽取为第一个 TaskProfile（profiles/fmcw-radar.ts）。
 * 后续其他主题（激光雷达、CodeGraph 等）只需定义自己的 TaskProfile，
 * 复用同一套应用架构、Agent Loop、审查框架和 UI 组件。
 */

/** 视觉分支 —— 决定图谱画布上的颜色分组和布局 */
export type VisualBranchDef = string;

/** 语义域定义 */
export interface DomainDef {
  id: string;
  name: string;
  description: string;
  visualBranch: VisualBranchDef;
  order: number;
}

/** 节点类型定义 —— 每种类型硬编码规定"只放一个什么"和"禁止什么" */
export interface NodeTypeDef {
  type: string;
  label: string;
  singular: string;        // "只放一个什么"，如 "一个概念"、"一个解决方案"
  forbidden: string[];     // 禁止混入的内容，如 ["多个并列概念", "方法", "算法"]
  note: string;            // 详细说明
  isGranularSensitive: boolean;  // 是否受节点粒度审查（concept/method/algorithm/problem/model 为 true）
}

/** 边类型定义 */
export interface EdgeTypeDef {
  type: string;
  label: string;
  direction: "directed" | "symmetric";  // directed: 有方向; symmetric: 对称（如 SIMILAR_TO）
  description: string;
}

/** 知识卡栏目定义 */
export interface CardSectionDef {
  type: string;
  label: string;
  definition: string;
  coverage: "core" | "conditional" | "optional";
  appliesTo: string[] | "all";  // 适用的节点类型，"all" 表示所有
  order: number;
}

/** 审查规则配置 —— 主题相关的校验从 Profile 读取，通用规则保持共享 */
export interface ValidationConfig {
  domainCount: number;           // 域数量（FMCW=11）
  visualBranchCount: number;     // 视觉分支数量（FMCW=5）
  rootNodeRequired: boolean;     // 是否必须有唯一根节点
  maxPrimaryChildren?: number;  // 单个父节点建议的直接子节点上限，默认 8
  extraRules?: string[];         // 主题特定的额外审查规则描述
}

/** 导航树的组织策略。知识主题可使用 category；代码图等任务可声明自身的中间层类型。 */
export interface HierarchyConfig {
  enabled: boolean;
  intermediateNodeTypes: string[];
  planningThreshold?: number; // 达到此数量时提示先设计归组，默认 6
  maxDepth?: number;          // 兼容旧 Profile：局部观察/展开半径，不能解释为从总根累计的树深上限
  minMembersPerIntermediate?: number; // 可选；不设置时单叶类别合法
}

/** 提示词配置 —— 通用基础提示词 + 主题追加指令 */
export interface PromptConfig {
  react: string;                 // ReAct 深度检索提示词（含节点粒度约束）
  review: string;                // Review 语义审查提示词
  finalResponse: string;         // finalResponse 输出指令
  ingest: Record<string, string>; // 资料接入提示词（conversation/summary/paper/document）
  topicAppendix?: string;        // 主题特定的追加指令（追加到所有提示词末尾）
}

/** 初始化策略 —— MVP vs 完整开发的参数 */
export interface InitializationConfig {
  rootNode: {
    id: string;
    name: string;
    shortFact: string;
  };
  mvp: {
    nodeCount: [number, number];     // MVP 节点数范围 [15, 30]
    reactRounds: [number, number];   // MVP ReAct 轮次 [2, 3]
    sectionsFilled: string[];         // MVP 只填的栏目 ["definition"]
    domainCount: [number, number];    // MVP 域数量 [3, 5]
    durationMinutes: [number, number]; // MVP 时间 [2, 5]
  };
  full: {
    nodeCount: [number, number];      // 完整开发节点数 [80, 150]
    visitTopicCount?: [number, number]; // 完整开发预计扩展的非叶父主题数；默认 [80, 300]，叶子不计
    maxModelCalls?: number;           // 全局模型调用保险丝；默认 4096，不是期望消耗量
    reactRounds: [number, number];    // 完整开发 ReAct 轮次 [6, 24]
    rootBudgetMinutes: [number, number]; // 根节点预算 [25, 35]
    durationMinutes: [number, number];  // 完整开发时间 [25, 40]
  };
}

/** TaskProfile 完整契约 */
export interface TaskProfile {
  id: string;                     // Profile 唯一标识，如 "fmcw-radar"
  name: string;                   // 显示名称，如 "FMCW 毫米波雷达知识网络"
  description: string;            // Profile 描述
  version: string;                // 版本号，如 "1.0.0"
  schemaVersion: string;          // 契约 schema 版本，如 "task-profile/1"

  // 核心配置
  domains: DomainDef[];
  visualBranches: VisualBranchDef[];
  nodeTypes: NodeTypeDef[];
  edgeTypes: EdgeTypeDef[];
  cardSections: CardSectionDef[];

  // 审查与提示词
  validation: ValidationConfig;
  hierarchy?: HierarchyConfig;
  prompts: PromptConfig;

  // 初始化策略
  initialization: InitializationConfig;

  // 元数据
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
}

/**
 * 基础节点类型 —— 所有 Profile 共享的默认类型
 * P3-2 抽取时，FMCW 的 11 种类型作为基础，其他 Profile 可扩展
 */
export const BASE_NODE_TYPES: NodeTypeDef[] = [
  { type: "domain", label: "知识域", singular: "一个知识域", forbidden: [], note: "分类节点，用于组织子节点，不承载具体知识内容", isGranularSensitive: false },
  { type: "category", label: "知识类别", singular: "一个可命名的知识类别", forbidden: ["具体知识细节", "多个分类维度"], note: "中间导航节点；按一个稳定维度归组子节点，不承载具体知识结论", isGranularSensitive: false },
  { type: "problem", label: "问题/现象", singular: "一个问题或现象", forbidden: ["解决方法", "算法", "子问题", "多个并列问题"], note: "只描述问题/现象本身（定义、原因、影响）；解决方法必须是独立的 method/algorithm 节点，通过 MITIGATES 等关系关联；子问题必须拆分为独立 problem 子节点", isGranularSensitive: true },
  { type: "concept", label: "概念", singular: "一个概念", forbidden: ["多个并列概念", "方法", "算法"], note: "只定义一个概念及其边界；多个并列概念必须拆分为独立 concept 子节点，共享共性父节点", isGranularSensitive: true },
  { type: "method", label: "方法", singular: "一个方法或解决方案", forbidden: ["多个并列方法", "问题描述", "概念定义"], note: "只描述一个方法的流程和实现；多个方法必须拆分为独立 method 子节点", isGranularSensitive: true },
  { type: "algorithm", label: "算法", singular: "一个算法", forbidden: ["多个并列算法", "问题描述"], note: "只描述一个算法的步骤、复杂度和实现；多个算法必须拆分", isGranularSensitive: true },
  { type: "model", label: "模型", singular: "一个模型", forbidden: ["多个并列模型", "问题描述"], note: "只描述一个模型的假设、公式和适用范围", isGranularSensitive: true },
  { type: "component", label: "组件", singular: "一个组件或硬件模块", forbidden: ["多个并列组件"], note: "只描述一个组件的功能、接口和特性", isGranularSensitive: false },
  { type: "artifact", label: "制品", singular: "一个制品、工具或数据集", forbidden: ["多个并列制品"], note: "只描述一个制品的用途、来源和使用方式", isGranularSensitive: false },
  { type: "parameter", label: "参数", singular: "一个参数", forbidden: ["多个并列参数"], note: "只描述一个参数的定义、取值范围和影响", isGranularSensitive: false },
  { type: "metric", label: "指标", singular: "一个指标", forbidden: ["多个并列指标"], note: "只描述一个指标的定义、计算方式和意义", isGranularSensitive: false },
  { type: "application", label: "应用", singular: "一个应用场景", forbidden: ["多个并列场景"], note: "只描述一个应用场景的需求、约束和方案", isGranularSensitive: false },
];

/**
 * 基础边类型 —— 所有 Profile 共享的默认类型
 */
export const BASE_EDGE_TYPES: EdgeTypeDef[] = [
  { type: "SIMILAR_TO", label: "相似于", direction: "symmetric", description: "两个节点在概念或功能上相似" },
  { type: "ALTERNATIVE_TO", label: "替代于", direction: "symmetric", description: "一个节点可以替代另一个节点" },
  { type: "PREREQUISITE_OF", label: "是...的前置", direction: "directed", description: "source 是理解 target 的前置知识" },
  { type: "PART_OF", label: "是...的一部分", direction: "directed", description: "source 是 target 的组成部分" },
  { type: "INPUT_TO", label: "输入到", direction: "directed", description: "source 是 target 的输入" },
  { type: "OUTPUT_OF", label: "是...的输出", direction: "directed", description: "source 是 target 的输出" },
  { type: "USES_MODEL", label: "使用模型", direction: "directed", description: "source 使用 target 模型" },
  { type: "IMPLEMENTS", label: "实现", direction: "directed", description: "source 实现了 target 方法/算法" },
  { type: "DERIVED_FROM", label: "派生自", direction: "directed", description: "source 派生自 target" },
  { type: "AFFECTS", label: "影响", direction: "directed", description: "source 影响 target" },
  { type: "MITIGATES", label: "缓解", direction: "directed", description: "source 方法/算法缓解了 target 问题/现象" },
  { type: "EVALUATED_BY", label: "由...评估", direction: "directed", description: "source 由 target 指标/方法评估" },
];
