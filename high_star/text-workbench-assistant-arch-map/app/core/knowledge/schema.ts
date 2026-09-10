export type VisualBranch = "foundation" | "signal" | "data" | "system" | "ai";

export type SemanticDomainId =
  | "physical-performance"
  | "waveform-if"
  | "nonideal-calibration"
  | "spectral-rva"
  | "detection-measurement"
  | "clustering-object"
  | "estimation"
  | "association-tracking"
  | "scene-events"
  | "system-hardware"
  | "ai-learning";

export type NodeType =
  | "domain"
  | "category"
  | "problem"
  | "concept"
  | "method"
  | "algorithm"
  | "model"
  | "component"
  | "artifact"
  | "parameter"
  | "metric"
  | "application";

/**
 * A node's role in the learning graph.  This is deliberately separate from
 * nodeType: role governs navigation and granularity rules; type describes the
 * kind of thing an entity represents.
 */
export type NodeRole = "domain" | "category" | "entity";

export function nodeRoleForType(nodeType: NodeType): NodeRole {
  if (nodeType === "domain") return "domain";
  if (nodeType === "category") return "category";
  return "entity";
}

/** Reads old persisted graphs safely while all newly built nodes carry a role. */
export function resolveNodeRole(node: Pick<KnowledgeNode, "nodeType" | "nodeRole">): NodeRole {
  return node.nodeRole ?? nodeRoleForType(node.nodeType);
}

/**
 * 节点类型语义：硬编码约束每种节点"只放一个什么"。
 * 这是节点粒度的核心规则，由类型决定而非提示词灵活解释。
 * - concept: 只放一个概念（定义+边界）
 * - method/algorithm: 只放一个解决方案/方法（流程+实现）
 * - model: 只放一个模型（假设+公式+适用范围）
 * - problem: 只放一个问题或现象（描述+原因+影响），不混入解决方法
 * - component: 只放一个组件/硬件模块
 * - artifact: 只放一个制品/工具/数据集
 * - parameter: 只放一个参数
 * - metric: 只放一个指标
 * - application: 只放一个应用场景
 * - domain: 分类节点，不适用"只放一个"约束
 */
export const NODE_TYPE_SEMANTICS: Record<NodeType, { singular: string; forbidden: string[]; note: string }> = {
  domain: { singular: "一个知识域", forbidden: [], note: "分类节点，用于组织子节点，不承载具体知识内容" },
  category: { singular: "一个可命名的知识类别", forbidden: ["具体知识细节", "多个分类维度"], note: "中间导航节点，用于把同一父节点下的知识按一个稳定维度归组；不代替具体概念、方法或组件" },
  problem: { singular: "一个问题或现象", forbidden: ["解决方法", "算法", "子问题", "多个并列问题"], note: "只描述问题/现象本身（定义、原因、影响）；解决方法必须是独立的 method/algorithm 节点，通过 MITIGATES 等关系关联；子问题必须拆分为独立 problem 子节点" },
  concept: { singular: "一个概念", forbidden: ["多个并列概念", "方法", "算法"], note: "只定义一个概念及其边界；多个并列概念必须拆分为独立 concept 子节点，共享共性父节点" },
  method: { singular: "一个方法或解决方案", forbidden: ["多个并列方法", "问题描述", "概念定义"], note: "只描述一个方法的流程和实现；多个方法必须拆分为独立 method 子节点" },
  algorithm: { singular: "一个算法", forbidden: ["多个并列算法", "问题描述"], note: "只描述一个算法的步骤、复杂度和实现；多个算法必须拆分" },
  model: { singular: "一个模型", forbidden: ["多个并列模型", "问题描述"], note: "只描述一个模型的假设、公式和适用范围" },
  component: { singular: "一个组件或硬件模块", forbidden: ["多个并列组件"], note: "只描述一个组件的功能、接口和特性" },
  artifact: { singular: "一个制品、工具或数据集", forbidden: ["多个并列制品"], note: "只描述一个制品的用途、来源和使用方式" },
  parameter: { singular: "一个参数", forbidden: ["多个并列参数"], note: "只描述一个参数的定义、取值范围和影响" },
  metric: { singular: "一个指标", forbidden: ["多个并列指标"], note: "只描述一个指标的定义、计算方式和意义" },
  application: { singular: "一个应用场景", forbidden: ["多个并列场景"], note: "只描述一个应用场景的需求、约束和方案" },
};

/** Navigation types are semantic containers; this is not a topology decision. */
export const NAVIGATION_NODE_TYPES = new Set<NodeType>(["domain", "category"]);
/** Backward-compatible aliases. Prefer isKnowledgeEntityType/isTopologyLeaf. */
export const NON_LEAF_TYPES = NAVIGATION_NODE_TYPES;
export function isKnowledgeEntityType(nodeType: NodeType): boolean { return !NAVIGATION_NODE_TYPES.has(nodeType); }
export function isLeafType(nodeType: NodeType): boolean { return isKnowledgeEntityType(nodeType); }
export function isLeafNode(node: { nodeType: NodeType }): boolean { return isKnowledgeEntityType(node.nodeType); }

export type KnowledgeStatus = "draft" | "reviewed" | "published";

export type EdgeType =
  | "SIMILAR_TO"
  | "ALTERNATIVE_TO"
  | "PREREQUISITE_OF"
  | "PART_OF"
  | "INPUT_TO"
  | "OUTPUT_OF"
  | "USES_MODEL"
  | "IMPLEMENTS"
  | "DERIVED_FROM"
  | "AFFECTS"
  | "MITIGATES"
  | "EVALUATED_BY";

export interface SemanticDomain {
  id: SemanticDomainId;
  name: string;
  description: string;
  visualBranch: VisualBranch;
  order: number;
}

export interface KnowledgeNode {
  id: string;
  canonicalName: string;
  shortFact: string;
  aliases: string[];
  /** Optional only for backwards-compatible reads of older persisted graphs. */
  nodeRole?: NodeRole;
  nodeType: NodeType;
  domainId: SemanticDomainId;
  visualBranch: VisualBranch;
  primaryParentId: string | null;
  level: number;
  order: number;
  tags: string[];
  status: KnowledgeStatus;
  /** Present only for migrated nodes whose public URL/id must remain stable. */
  legacyId?: string;
  /** Immutable migration metadata; never used as the canonical card model. */
  legacySnapshot?: LegacyKnowledgeNode;
}

export type CardBlockType =
  | "definition"
  | "principle"
  | "assumptions"
  | "inputs_outputs"
  | "procedure"
  | "engineering_tradeoff"
  | "failure_mode"
  | "validation"
  | "comparison"
  | "application"
  | "research_topic"
  | "code"
  | "misconception";

export interface CardBlock {
  type: CardBlockType;
  title: string;
  text?: string;
  items?: string[];
  formulaIds?: string[];
  language?: "python" | "matlab" | "typescript" | "text";
  code?: string;
}

export interface KnowledgeCard {
  nodeId: string;
  headline: string;
  blocks: CardBlock[];
  formulaIds: string[];
  evidenceIds: string[];
  revision: number;
}

export type KnowledgeCollectionKind = "theory" | "application" | "other";

export type KnowledgeHistoryKind =
  | "initialized"
  | "question_summary"
  | "candidate_generated"
  | "knowledge_imported"
  | "revision_applied"
  | "rollback";

export interface KnowledgeHistoryEntry {
  id: string;
  nodeId: string;
  kind: KnowledgeHistoryKind;
  summary: string;
  occurredAt: string;
  revision?: number;
  sourceArtifactId?: string;
}

export type KnowledgeAssetModality = "text" | "image" | "audio" | "video" | "document";

export interface KnowledgeAsset {
  id: string;
  modality: KnowledgeAssetModality;
  mimeType: string;
  storageRef: string;
  checksum: string;
  title?: string;
}

export interface KnowledgeEvidence {
  id: string;
  title: string;
  sourceType: "conversation" | "summary" | "paper" | "document" | "image" | "audio" | "video" | "manual";
  locator?: string;
  excerpt?: string;
  assetId?: string;
}

export type KnowledgeSourceKind = "conversation" | "summary" | "paper" | "document" | "image" | "audio" | "video";

export interface KnowledgeSourceArtifact {
  id: string;
  title: string;
  kind: KnowledgeSourceKind;
  modality: KnowledgeAssetModality;
  mimeType: string;
  checksum: string;
  storageRef?: string;
  suppliedAt: string;
  suppliedBy: string;
}

export interface KnowledgeClaim {
  id: string;
  artifactId: string;
  segmentIds: readonly string[];
  statement: string;
  shortSummary: string;
  suggestedCollection: KnowledgeCollectionKind;
  nodeHint?: string;
  confidence: number;
}

export interface FormulaSymbol {
  symbol: string;
  latex: string;
  definition: string;
  unit?: string;
  constraints?: string;
}

export interface KnowledgeFormula {
  id: string;
  nodeId: string;
  name: string;
  latex: string;
  /** Exact display copy from the legacy node, retained for lossless adaptation. */
  sourceText: string;
  meaning: string;
  symbols: FormulaSymbol[];
  assumptions: string[];
  evidenceIds: string[];
}

export interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  rationale: string;
  weight: number;
  status: KnowledgeStatus;
  evidenceIds: string[];
  legacyLabel?: string;
}

export interface KnowledgeDataset {
  revision: number;
  domains: SemanticDomain[];
  nodes: KnowledgeNode[];
  cards: KnowledgeCard[];
  formulas: KnowledgeFormula[];
  edges: KnowledgeEdge[];
  /** Human-facing audit summaries. Retrieval excludes these unless explicitly requested. */
  history?: KnowledgeHistoryEntry[];
  evidence?: KnowledgeEvidence[];
  assets?: KnowledgeAsset[];
  sources?: KnowledgeSourceArtifact[];
  claims?: KnowledgeClaim[];
}

export interface LegacyKnowledgeNode {
  id: string;
  title: string;
  subtitle: string;
  branch: VisualBranch;
  parent?: string;
  summary: string;
  details?: string[];
  formula?: string;
  impact?: string;
  verification?: string;
  pitfall?: string;
}

export interface LegacyCrossLink {
  from: string;
  to: string;
  label: string;
}

export interface LegacyFormulaMeta {
  latex: string;
  symbols: Array<{ symbol: string; latex: string; explanation: string; unit?: string }>;
}

export interface DatasetPatch {
  id: string;
  baseRevision: number;
  addNodes: KnowledgeNode[];
  addCards: KnowledgeCard[];
  addFormulas: KnowledgeFormula[];
  addEdges: KnowledgeEdge[];
  updateNodes: Array<{ nodeId: string; changes: Partial<KnowledgeNode> }>;
  updateCards: Array<{ nodeId: string; card: KnowledgeCard }>;
}

export type TraversalReason =
  | "anchor"
  | "similar"
  | "alternative"
  | "sibling"
  | "child"
  | "prerequisite"
  | "dependent"
  | "dependency"
  | "input"
  | "downstream"
  | "output"
  | "producer";

export interface TraversalVisit {
  nodeId: string;
  depth: number;
  reason: TraversalReason;
}

export interface LocalGraphOptions {
  maxDepth?: number;
  maxNodes?: number;
  includeImplicitSiblings?: boolean;
}

export interface LocalGraphResult {
  anchorId: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  visits: TraversalVisit[];
  truncated: boolean;
}

export interface VisibleGraphProjection {
  anchor: KnowledgeNode;
  previous: KnowledgeNode[];
  next: KnowledgeNode[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  visits: TraversalVisit[];
  truncated: boolean;
}
