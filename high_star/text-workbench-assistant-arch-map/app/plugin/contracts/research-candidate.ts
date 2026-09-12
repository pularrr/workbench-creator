/**
 * ResearchCandidate 契约 —— 知识候选的核心数据结构
 *
 * Agent 生成的新知识（新节点、卡片块、关系、证据）先作为候选，
 * 经过语义审查和结构校验后，由用户确认才写入图谱。
 * 这个契约与当前 research-output.ts 的 ResearchDocument 对齐，
 * 但作为插件层面的独立契约，不依赖具体实现。
 */

/** 候选节点 —— Agent 提议创建的新节点 */
export interface ProposedNode {
  id?: string;               // 稳定 ID，可选；未提供时由 Build 阶段生成
  canonicalName: string;      // 节点名称（简短具体，≤20字，一个节点一个概念）
  shortFact: string;          // 一句话定义（≤80字，详细内容放卡片栏目）
  nodeType: string;           // 节点类型（必须是 Profile.nodeTypes 中定义的类型）
  parentId: string;           // 父节点 ID（已有节点或本批新节点）
  domainId?: string;          // 域 ID（可选，由父节点推断）
  aliases?: string[];         // 别名（可选）
  tags?: string[];            // 标签（可选）
}

/** 候选卡片块 —— Agent 提议添加到知识卡的内容块 */
export interface ProposedCardBlock {
  nodeId: string;             // 所属节点 ID（已有节点或本批新节点）
  type: string;               // 栏目类型（必须是 Profile.cardSections 中定义的类型）
  title: string;              // 栏目标题
  text: string;               // 栏目内容（完整知识，非摘要）
}

/** 候选关系 —— Agent 提议创建的跨节点语义关系 */
export interface ProposedRelation {
  sourceId: string;           // 源节点 ID
  targetId: string;           // 目标节点 ID
  type: string;               // 关系类型（必须是 Profile.edgeTypes 中定义的类型）
  rationale: string;          // 建立关系的理由（必须解释方向和原因）
}

/** 证据 —— 支持候选知识的来源 */
export interface Evidence {
  title: string;               // 来源标题
  url?: string;                // 来源 URL（仅在已核实时填写）
  note: string;                // 来源支持什么；未经外部检索明确标注"模型知识待核验"
  verified: boolean;           // 是否已通过外部检索核实
}

/** 覆盖度评估 —— Agent 对当前节点知识覆盖度的判断 */
export interface CoverageAssessment {
  present: string[];           // 已覆盖的栏目
  missing: string[];           // 缺少的栏目
  assessment: string;          // 总体评估文字
}

/** 研究缺口 —— Agent 识别的尚未解决的知识缺口 */
export interface ResearchGap {
  description: string;         // 缺口描述
  priority: "high" | "medium" | "low";  // 优先级
  relatedNodeId?: string;      // 相关节点 ID
}

/** ResearchCandidate 完整契约 —— 一批研究成果的候选 */
export interface ResearchCandidate {
  // 元信息
  summary: string;             // 本批研究摘要
  rationale: string;           // 生成这批候选的理由

  // 覆盖度与缺口
  coverageAssessment?: CoverageAssessment;  // 覆盖度评估
  gaps?: ResearchGap[];        // 仍需探索的缺口
  converged: boolean;          // 是否收敛（连续多轮没有实质新增时为 true）

  // 候选内容
  proposal: {
    newNodes: ProposedNode[];       // 新节点候选
    cardBlocks: ProposedCardBlock[]; // 新卡片块候选
    relations: ProposedRelation[];   // 新关系候选
    evidence: Evidence[];            // 证据
  };

  // 元数据
  batchIndex?: number;          // 批次索引（批量合并时用）
  sourceTopicId?: string;       // 来源主题节点 ID
  createdAt?: string;
}

/**
 * 候选验证结果 —— 审查阶段对候选的验证结果
 */
export interface CandidateValidationResult {
  valid: boolean;
  errors: CandidateIssue[];    // 错误（必须修复）
  warnings: CandidateIssue[];  // 警告（建议修复）
  stats: {
    newNodes: number;
    cardBlocks: number;
    relations: number;
    evidence: number;
    multiConceptNodes: number;   // 多概念节点数（节点粒度审查）
    problemNodesWithSolution: number;  // problem 节点混入解决方法数
  };
}

export interface CandidateIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;            // 相关节点/关系/卡片块 ID
  suggestion?: string;          // 修复建议
}

/**
 * 批量合并结果 —— 多批候选合并后的结果
 */
export interface BatchMergeResult {
  mergedNodes: ProposedNode[];
  mergedCardBlocks: ProposedCardBlock[];
  mergedRelations: ProposedRelation[];
  mergedEvidence: Evidence[];
  duplicatesRemoved: {
    nodes: number;
    relations: number;
  };
  totalBatches: number;
}
