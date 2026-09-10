/**
 * MvpOutput 契约 —— MVP 先行机制的输出数据结构
 *
 * 插件生成新应用时，不直接做完整的根节点深度检索，而是先输出 MVP：
 * - 15-30 个节点（完整开发 80-150 个）
 * - 只填 definition 栏目（完整开发 5+ 栏目）
 * - 2-3 轮 ReAct（完整开发 6-24 轮）
 * - 简化版 3-5 个域（完整开发 8-15 个域）
 * 用户确认 MVP 后，才进入完整开发阶段。
 */

/** MVP 节点 —— 简化版节点，只包含核心信息 */
export interface MvpNode {
  id: string;
  canonicalName: string;
  shortFact: string;            // 一句话定义（MVP 只填 definition）
  nodeType: string;
  parentId: string | null;
  domainId: string;
  level: number;
}

/** MVP 关系 —— 简化版关系 */
export interface MvpEdge {
  sourceId: string;
  targetId: string;
  type: string;
  rationale: string;
}

/** MVP 示例卡片 —— 2-3 个完整卡片，展示知识粒度和质量 */
export interface MvpSampleCard {
  nodeId: string;
  nodeName: string;
  headline: string;
  blocks: Array<{
    type: string;
    title: string;
    text: string;
  }>;
}

/** Profile 设计摘要 —— 展示给用户的 Profile 设计概览 */
export interface ProfileSummary {
  id: string;
  name: string;
  description: string;
  rootNode: {
    id: string;
    name: string;
    shortFact: string;
  };
  domains: Array<{
    id: string;
    name: string;
    visualBranch: string;
    nodeCount: number;  // 该域下的 MVP 节点数
  }>;
  visualBranches: string[];
  nodeTypes: string[];
  cardSections: string[];
}

/** 调整方向 —— 用户不满意时给出的具体调整建议 */
export interface AdjustmentDirection {
  type: "domain" | "nodeType" | "cardSection" | "rootNode" | "granularity" | "scope";
  title: string;               // 调整方向标题
  specificAction: string;      // 具体操作
  reason: string;              // 为什么这样调整
  expectedEffect: string;      // 预期效果
}

/** MvpOutput 完整契约 */
export interface MvpOutput {
  // 阶段标识
  phase: "mvp";
  profileId: string;

  // Profile 设计摘要
  profileSummary: ProfileSummary;

  // MVP 知识网络骨架
  mvpGraph: {
    nodes: MvpNode[];           // 15-30 个节点
    edges: MvpEdge[];           // 关系
    stats: {
      totalNodes: number;
      totalEdges: number;
      byDomain: Record<string, number>;  // 按域统计节点数
      byNodeType: Record<string, number>; // 按类型统计节点数
      maxDepth: number;         // 最大深度
    };
  };

  // 示例卡片（2-3 个完整卡片，展示知识粒度和质量）
  sampleCards: MvpSampleCard[];

  // 生成信息
  generation: {
    reactRounds: number;        // 实际 ReAct 轮次（2-3）
    durationSeconds: number;    // 生成耗时
    modelUsed: string;          // 使用的模型
    converged: boolean;         // 是否收敛
  };

  // 下一步
  nextSteps: {
    fullDevelopmentEstimate: {
      nodeCount: [number, number];   // 预计节点数 [80, 150]
      durationMinutes: [number, number];  // 待用户验收的预计时间，默认 [25, 35]
      visitTopicCount: [number, number];  // 待用户验收的非叶父主题数，默认 [80, 300]，叶子不计
      maxModelCalls: number;              // 待用户验收的调用保险丝，默认 4096
      reactRounds: [number, number];      // 预计 ReAct 轮次 [6, 24]
    };
    suggestedAdjustments?: AdjustmentDirection[];  // 建议的调整方向（3-5 个）
  };
}

/**
 * MVP 确认结果 —— 用户对 MVP 的确认或调整
 */
export interface MvpConfirmation {
  confirmed: boolean;
  profileId: string;
  approvedBudget?: {
    durationMinutes: [number, number];
    visitTopicCount: [number, number];
    maxModelCalls: number;
  };

  // 如果确认，锁定的设计
  lockedDesign?: {
    domains: string[];           // 锁定的域 ID 列表
    nodeTypes: string[];         // 锁定的节点类型
    cardSections: string[];      // 锁定的栏目
    rootNodeId: string;          // 锁定的根节点
    lockedAt: string;
  };

  // 如果不确认，用户选择的调整方向
  adjustments?: {
    selectedDirections: string[];  // 用户选择的调整方向标题
    customFeedback?: string;       // 用户自定义反馈
  };

  // 调整后的 Profile（如果用户选择了调整）
  adjustedProfileId?: string;
}
