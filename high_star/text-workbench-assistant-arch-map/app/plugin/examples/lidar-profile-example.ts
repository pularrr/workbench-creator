/**
 * 激光雷达技术路线 Profile（示例）
 *
 * 由 KnowMap Plugin 生成，作为 P3-6 验证的参考。
 * 主题：激光雷达技术路线
 * 版本：0.1.0
 */

import type { TaskProfile } from "../contracts/task-profile";

export const LIDAR_TECH_ROUTE_PROFILE: TaskProfile = {
  id: "lidar-tech-route",
  name: "激光雷达技术路线",
  version: "0.1.0",
  description: "激光雷达技术路线知识网络，覆盖原理、光源、接收、信号处理、点云算法、系统集成与应用全链路。",
  schemaVersion: "task-profile/1",
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  author: "knowmap-plugin",
  tags: ["激光雷达", "技术路线", "自动驾驶", "3D感知"],

  // 7 个语义域
  domains: [
    {
      id: "lidar-principle",
      name: "原理与物理基础",
      description: "激光雷达的工作原理、物理基础和测距方式",
      visualBranch: "foundation",
      order: 10,
    },
    {
      id: "laser-source",
      name: "光源与发射系统",
      description: "激光器、发射光学、扫描方式和光束控制",
      visualBranch: "system",
      order: 20,
    },
    {
      id: "receiver-detector",
      name: "接收与探测系统",
      description: "探测器、接收光学、信号放大和噪声处理",
      visualBranch: "system",
      order: 30,
    },
    {
      id: "signal-processing",
      name: "信号处理与点云生成",
      description: "回波信号处理、点云生成、时间同步和标定",
      visualBranch: "signal",
      order: 40,
    },
    {
      id: "point-cloud-algorithm",
      name: "点云处理与算法",
      description: "点云滤波、分割、检测、跟踪和配准算法",
      visualBranch: "data",
      order: 50,
    },
    {
      id: "system-integration",
      name: "系统集成与标定",
      description: "多传感器融合、外参标定、时间同步和系统设计",
      visualBranch: "system",
      order: 60,
    },
    {
      id: "application-scenario",
      name: "应用场景与评价",
      description: "自动驾驶、机器人、测绘等应用场景和性能评价",
      visualBranch: "ai",
      order: 70,
    },
  ],

  // 5 个视觉分支
  visualBranches: ["foundation", "system", "signal", "data", "ai"],

  // 11 种基础节点类型（复用）
  nodeTypes: [
    { type: "domain", label: "领域", singular: "一个知识领域", forbidden: ["多个领域混合"], note: "根节点和一级域节点", isGranularSensitive: false },
    { type: "category", label: "知识类别", singular: "一个可命名的知识类别", forbidden: ["具体知识细节"], note: "中间导航节点，按稳定维度归组", isGranularSensitive: false },
    { type: "problem", label: "问题", singular: "一个问题或现象", forbidden: ["解决方法", "子问题", "多个问题并列"], note: "只描述问题/现象本身，解决方法必须是独立节点", isGranularSensitive: true },
    { type: "concept", label: "概念", singular: "一个概念", forbidden: ["多个并列概念", "方法", "算法"], note: "基础概念和定义", isGranularSensitive: true },
    { type: "method", label: "方法", singular: "一个解决方案", forbidden: ["多个方法并列", "问题", "概念"], note: "通用方法和技术路线", isGranularSensitive: true },
    { type: "algorithm", label: "算法", singular: "一个算法", forbidden: ["多个算法并列", "方法", "概念"], note: "具体算法实现", isGranularSensitive: true },
    { type: "model", label: "模型", singular: "一个模型", forbidden: ["多个模型并列", "算法", "方法"], note: "数学模型和物理模型", isGranularSensitive: true },
    { type: "component", label: "组件", singular: "一个组件", forbidden: ["多个组件并列", "系统"], note: "硬件和软件组件", isGranularSensitive: true },
    { type: "artifact", label: "制品", singular: "一个制品", forbidden: ["多个制品并列"], note: "数据、代码、文档等制品", isGranularSensitive: true },
    { type: "parameter", label: "参数", singular: "一个参数", forbidden: ["多个参数并列"], note: "系统参数和算法参数", isGranularSensitive: true },
    { type: "metric", label: "指标", singular: "一个指标", forbidden: ["多个指标并列"], note: "性能指标和评价指标", isGranularSensitive: true },
    { type: "application", label: "应用", singular: "一个应用场景", forbidden: ["多个应用并列"], note: "具体应用场景", isGranularSensitive: true },
  ],

  // 12 种基础边类型（复用）
  edgeTypes: [
    { type: "SIMILAR_TO", label: "相似于", direction: "symmetric", description: "两个节点概念相似" },
    { type: "ALTERNATIVE_TO", label: "替代方案", direction: "symmetric", description: "两个节点互为替代方案" },
    { type: "PREREQUISITE_OF", label: "是...的前提", direction: "directed", description: "源节点是目标节点的前提知识" },
    { type: "PART_OF", label: "是...的一部分", direction: "directed", description: "源节点是目标节点的组成部分" },
    { type: "INPUT_TO", label: "输入到", direction: "directed", description: "源节点是目标节点的输入" },
    { type: "OUTPUT_OF", label: "是...的输出", direction: "directed", description: "源节点是目标节点的输出" },
    { type: "USES_MODEL", label: "使用模型", direction: "directed", description: "源节点使用目标节点的模型" },
    { type: "IMPLEMENTS", label: "实现", direction: "directed", description: "源节点实现了目标节点的方法/算法" },
    { type: "DERIVED_FROM", label: "推导自", direction: "directed", description: "源节点推导自目标节点" },
    { type: "AFFECTS", label: "影响", direction: "directed", description: "源节点影响目标节点的性能/行为" },
    { type: "MITIGATES", label: "缓解", direction: "directed", description: "源节点缓解目标节点的问题/风险" },
    { type: "EVALUATED_BY", label: "由...评价", direction: "directed", description: "源节点由目标节点的指标/方法评价" },
  ],

  // 13 个基础栏目（复用）
  cardSections: [
    { type: "definition", label: "定义与边界", definition: "说明对象是什么、不是什么，以及适用范围和与近邻概念的边界。", coverage: "core", appliesTo: "all", order: 10 },
    { type: "principle", label: "原理与推导", definition: "解释机制为何成立、关键因果链、数学依据或推导主线。", coverage: "core", appliesTo: ["problem", "concept", "method", "algorithm", "model", "component", "parameter", "metric"], order: 20 },
    { type: "assumptions", label: "成立假设", definition: "列出结论、模型或公式成立所依赖且可被检查的前提。", coverage: "conditional", appliesTo: ["concept", "method", "algorithm", "model", "parameter", "metric"], order: 30 },
    { type: "comparison", label: "同类方案比较", definition: "在同一问题与相同评价维度下比较可替代或相似方案。", coverage: "conditional", appliesTo: ["method", "algorithm", "model", "metric"], order: 40 },
    { type: "inputs_outputs", label: "输入与输出", definition: "明确方法、算法、组件或数据产物所消费与产生的数据、单位、形状和语义。", coverage: "conditional", appliesTo: ["method", "algorithm", "model", "component", "artifact", "application"], order: 50 },
    { type: "procedure", label: "实现步骤", definition: "给出可执行、可复现且有先后关系的工程或算法步骤。", coverage: "core", appliesTo: ["method", "algorithm", "component", "application"], order: 60 },
    { type: "engineering_tradeoff", label: "工程取舍", definition: "说明资源、精度、鲁棒性、时延、复杂度之间不可同时最优的选择。", coverage: "core", appliesTo: ["method", "algorithm", "model", "component", "parameter", "application"], order: 70 },
    { type: "failure_mode", label: "失效模式", definition: "描述何种条件下会失败、可观察症状、成因和影响。", coverage: "conditional", appliesTo: ["method", "algorithm", "model", "component", "application"], order: 80 },
    { type: "validation", label: "验证方法", definition: "给出可判定正确性的实验、指标、基线、数据与通过标准。", coverage: "core", appliesTo: ["method", "algorithm", "model", "component", "metric", "application"], order: 90 },
    { type: "application", label: "典型应用", definition: "说明知识在具体任务、场景或系统链路中的实际用途。", coverage: "optional", appliesTo: "all", order: 100 },
    { type: "research_topic", label: "研究热点", definition: "记录仍在演进的开放问题、新方法方向或尚未形成工程共识的议题。", coverage: "optional", appliesTo: ["problem", "concept", "method", "algorithm", "model", "application"], order: 110 },
    { type: "code", label: "最小实现", definition: "提供能表达核心运算的短代码、伪代码或关键 API 调用。", coverage: "optional", appliesTo: ["method", "algorithm", "model", "component", "application"], order: 120 },
    { type: "misconception", label: "常见误区", definition: "指出常见但错误或缺少前提的说法，并给出纠正后的表述。", coverage: "optional", appliesTo: "all", order: 130 },
  ],

  // 验证配置
  validation: {
    domainCount: 7,
    visualBranchCount: 5,
    rootNodeRequired: true,
    maxPrimaryChildren: 8,
  },
  hierarchy: { enabled: true, intermediateNodeTypes: ["category"], planningThreshold: 6, maxDepth: 6 },

  // 提示词
  prompts: {
    react: "你是采用 ReAct 的知识检索 Agent，用于生成激光雷达技术路线知识网络。Observe 当前节点及前轮发现；判断缺口；Act 深入一个尚未解决的问题，输出一批实质知识；再观察覆盖度。优先比较同层解决方案，再深入子问题和依赖。定义、原理、假设、正反例、工程取舍、验证、实现、应用与研究均需考察。每批累积后统一合并，不要逐条调用图内查重工具。新增节点可引用本批或此前批次新节点ID作为父级。说明无法证实的主张。只有连续多轮没有实质新增时才标记收敛。\n\n【节点粒度硬约束】1. 一个节点只放一个东西，由 nodeType 决定。2. 禁止多个并列概念/方法/问题放一个节点。3. problem 节点只描述问题/现象，禁止混入解决方法。4. 节点名称≤15字，禁止并列连词。5. shortFact≤50字。",
    review: "审查激光雷达知识的粒度、来源、适用条件与关系方向；未经核验的结论明确标记。",
    finalResponse: "围绕用户的问题直接回答，使用 Markdown 和 LaTeX，说明激光雷达方案的适用条件和证据。",
    ingest: {},
    topicAppendix: "本知识网络聚焦激光雷达技术路线领域，覆盖原理、光源、接收、信号处理、点云算法、系统集成与应用全链路。",
  },

  // 初始化策略
  initialization: {
    rootNode: {
      id: "lidar",
      name: "激光雷达技术路线",
      shortFact: "激光雷达（LiDAR）技术路线知识网络，覆盖从物理原理到应用落地的全链路技术。",
    },
    mvp: {
      nodeCount: [15, 30],
      reactRounds: [2, 3],
      sectionsFilled: ["definition"],
      domainCount: [3, 7],
      durationMinutes: [2, 5],
    },
    full: {
      nodeCount: [80, 150],
      reactRounds: [6, 24],
      rootBudgetMinutes: [25, 35],
      durationMinutes: [25, 40],
    },
  },
};

export default LIDAR_TECH_ROUTE_PROFILE;
