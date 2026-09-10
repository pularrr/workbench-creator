import { resolveNodeRole, type EdgeType, type KnowledgeDataset, type KnowledgeEdge } from "./schema";
import { hierarchyReviewPolicy, reviewPrimaryHierarchy } from "./hierarchy-review";
import type { TaskProfile } from "../../plugin/contracts/task-profile";
import { ACTIVE_PROFILE } from "../../profiles/active";

/**
 * 验证配置选项
 *
 * P3-2 Step4：支持从 Profile 读取主题相关的验证配置（域数量、视觉分支数量）。
 * 未提供 Profile 时使用 FMCW 默认值（11 域、5 分支），保持向后兼容。
 */
export interface ValidationOptions {
  profile?: TaskProfile;
  /** 域数量覆盖（优先于 profile.validation.domainCount） */
  domainCount?: number;
  /** 视觉分支数量覆盖 */
  visualBranchCount?: number;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  issues: ValidationIssue[];
}

const symmetric = new Set<EdgeType>(["SIMILAR_TO", "ALTERNATIVE_TO"]);

function edgeKey(edge: KnowledgeEdge): string {
  if (!symmetric.has(edge.type)) return `${edge.type}:${edge.sourceId}:${edge.targetId}`;
  const [left, right] = [edge.sourceId, edge.targetId].sort();
  return `${edge.type}:${left}:${right}`;
}

export function validateKnowledgeDataset(dataset: KnowledgeDataset, options?: ValidationOptions): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue["severity"], code: string, message: string, entityId?: string) =>
    issues.push({ severity, code, message, entityId });

  // P3-2 Step4：从 Profile 或 options 读取主题相关的验证配置
  // 未提供时使用 FMCW 默认值（11 域、5 分支），保持向后兼容
  const expectedDomainCount = options?.domainCount ?? options?.profile?.validation.domainCount ?? ACTIVE_PROFILE.validation.domainCount;
  const expectedVisualBranchCount = options?.visualBranchCount ?? options?.profile?.validation.visualBranchCount ?? ACTIVE_PROFILE.validation.visualBranchCount;
  const maxPrimaryChildren = options?.profile?.validation.maxPrimaryChildren ?? 8;
  const hierarchy = options?.profile?.hierarchy;

  const domainIds = new Set<string>();
  for (const domain of dataset.domains) {
    if (domainIds.has(domain.id)) add("error", "DUPLICATE_DOMAIN", `重复领域 ${domain.id}`, domain.id);
    domainIds.add(domain.id);
  }
  if (domainIds.size !== expectedDomainCount) add("error", "DOMAIN_COUNT", `应有 ${expectedDomainCount} 个语义领域，当前为 ${domainIds.size} 个。`);
  const visualBranches = new Set(dataset.domains.map((domain) => domain.visualBranch));
  if (visualBranches.size !== expectedVisualBranchCount) add("error", "VISUAL_BRANCH_COUNT", `应映射到 ${expectedVisualBranchCount} 个视觉分支，当前为 ${visualBranches.size} 个。`);

  const nodeById = new Map<string, (typeof dataset.nodes)[number]>();
  const legacyIds = new Set<string>();
  for (const node of dataset.nodes) {
    if (nodeById.has(node.id)) add("error", "DUPLICATE_NODE", `重复节点 ${node.id}`, node.id);
    nodeById.set(node.id, node);
    if (!domainIds.has(node.domainId)) add("error", "UNKNOWN_DOMAIN", `未知领域 ${node.domainId}`, node.id);
    if (!node.canonicalName.trim() || !node.shortFact.trim()) add("error", "EMPTY_NODE_COPY", "节点名称和短事实不能为空。", node.id);
    if (node.primaryParentId === node.id) add("error", "SELF_PARENT", "节点不能以自身为父节点。", node.id);
    if (node.legacyId) {
      if (legacyIds.has(node.legacyId)) add("error", "DUPLICATE_LEGACY_ID", `重复 legacyId ${node.legacyId}`, node.id);
      legacyIds.add(node.legacyId);
    }
    // Navigation and summary nodes intentionally contain multiple entities.
    // Granularity rules therefore apply only to explicit/inferred entity roles.
    const granularTypes = ["concept", "method", "algorithm", "problem", "model"];
    if (resolveNodeRole(node) === "entity" && granularTypes.includes(node.nodeType)) {
      // 规则1：名称中包含并列连词，可能把多个概念放在一起
      const parallelConjunctions = /[、\/和与及]/;
      if (parallelConjunctions.test(node.canonicalName)) {
        add("warning", "MULTI_CONCEPT_NODE",
          `节点"${node.canonicalName}"名称包含并列连词，可能把多个${node.nodeType === "problem" ? "问题/现象" : "概念/方法"}放在一个节点中。应拆分为独立子节点，共享共性父节点。`,
          node.id);
      }
      // 规则2：节点名称过长
      if (node.canonicalName.length > 20) {
        add("warning", "NODE_NAME_TOO_LONG",
          `节点"${node.canonicalName}"名称长度 ${node.canonicalName.length} 字，建议不超过 15 字。名称应简短具体，详细描述放 shortFact 或知识卡栏目。`,
          node.id);
      }
      // 规则3：shortFact 过长
      if (node.shortFact.length > 80) {
        add("warning", "SHORTFACT_TOO_LONG",
          `节点"${node.canonicalName}"的 shortFact 长度 ${node.shortFact.length} 字，建议不超过 50 字。shortFact 应是一句话定义，详细原理、推导、比较放知识卡栏目。`,
          node.id);
      }
    }
    // 规则4：problem 节点不应混入解决方法（检测 shortFact 中包含方法/算法/解决/采用等词）
    if (resolveNodeRole(node) === "entity" && node.nodeType === "problem") {
      const solutionKeywords = /(方法|算法|解决|采用|使用|通过.*实现|基于.*估计)/;
      if (solutionKeywords.test(node.shortFact)) {
        add("warning", "PROBLEM_NODE_HAS_SOLUTION",
          `problem 节点"${node.canonicalName}"的 shortFact 可能混入了解决方法。problem 节点只应描述问题/现象本身（定义、原因、影响）；解决方法必须是独立的 method/algorithm 节点，通过 MITIGATES 等关系关联。`,
          node.id);
      }
    }
  }
  const childrenByParent = new Map<string, (typeof dataset.nodes)[number][]>();
  for (const node of dataset.nodes) {
    if (!node.primaryParentId) continue;
    childrenByParent.set(node.primaryParentId, [...(childrenByParent.get(node.primaryParentId) ?? []), node]);
  }
  const hierarchyFindings = reviewPrimaryHierarchy(dataset.nodes, hierarchyReviewPolicy(options?.profile ?? { validation: { maxPrimaryChildren }, hierarchy: undefined }));
  for (const finding of hierarchyFindings) add("warning", finding.code, finding.message, finding.entityId);
  if (hierarchy?.enabled) {
    const intermediateTypes = new Set(hierarchy.intermediateNodeTypes);
    for (const node of dataset.nodes) {
      if (!intermediateTypes.has(node.nodeType)) continue;
      const members = childrenByParent.get(node.id) ?? [];
      if (!members.length) add("warning", "EMPTY_INTERMEDIATE_CATEGORY", `中间节点“${node.canonicalName}”没有子节点，应补充成员或移除。`, node.id);
      if (hierarchy.minMembersPerIntermediate && members.length < hierarchy.minMembersPerIntermediate) {
        add("warning", "SPARSE_INTERMEDIATE_CATEGORY", `中间节点“${node.canonicalName}”只有 ${members.length} 个子节点，低于 Profile 的建议值 ${hierarchy.minMembersPerIntermediate}。请确认其边界是否足够独立。`, node.id);
      }
    }
  }
  const roots = dataset.nodes.filter((node) => node.primaryParentId === null);
  if (roots.length !== 1) add("error", "ROOT_COUNT", `必须有且只有一个根节点，当前为 ${roots.length}。`);
  for (const node of dataset.nodes) {
    if (!node.primaryParentId) {
      if (node.level !== 0) add("error", "ROOT_LEVEL", "根节点 level 必须为 0。", node.id);
      continue;
    }
    const parent = nodeById.get(node.primaryParentId);
    if (!parent) add("error", "MISSING_PARENT", `父节点 ${node.primaryParentId} 不存在。`, node.id);
    else if (node.level !== parent.level + 1) add("error", "LEVEL_GAP", `level 应为父节点 level+1。`, node.id);
  }

  const parentState = new Map<string, 0 | 1 | 2>();
  const visitParent = (nodeId: string) => {
    const state = parentState.get(nodeId) ?? 0;
    if (state === 1) { add("error", "PLACEMENT_CYCLE", "主分类树存在环。", nodeId); return; }
    if (state === 2) return;
    parentState.set(nodeId, 1);
    const parentId = nodeById.get(nodeId)?.primaryParentId;
    if (parentId && nodeById.has(parentId)) visitParent(parentId);
    parentState.set(nodeId, 2);
  };
  for (const node of dataset.nodes) visitParent(node.id);

  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  for (const edge of dataset.edges) {
    if (edgeIds.has(edge.id)) add("error", "DUPLICATE_EDGE_ID", `重复边 ${edge.id}`, edge.id);
    edgeIds.add(edge.id);
    if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) add("error", "MISSING_EDGE_ENDPOINT", "关系端点不存在。", edge.id);
    if (edge.sourceId === edge.targetId) add("error", "SELF_EDGE", "关系不能指向自身。", edge.id);
    if (!edge.rationale.trim()) add("error", "EMPTY_RATIONALE", "关系必须解释建立理由。", edge.id);
    if (!(edge.weight > 0 && edge.weight <= 1)) add("error", "EDGE_WEIGHT", "关系权重必须在 (0,1]。", edge.id);
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) add("error", "DUPLICATE_EDGE", "重复语义关系。", edge.id);
    edgeKeys.add(key);
    if (symmetric.has(edge.type)) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (source && target && (source.nodeType !== target.nodeType || source.level !== target.level)) {
        add("warning", "INCOMPARABLE_PEERS", "相似/替代关系两端不是同类型同层实体，请复核。", edge.id);
      }
    }
  }

  const prerequisiteTargets = new Map<string, string[]>();
  for (const edge of dataset.edges) {
    if (edge.type !== "PREREQUISITE_OF") continue;
    prerequisiteTargets.set(edge.sourceId, [...(prerequisiteTargets.get(edge.sourceId) ?? []), edge.targetId]);
  }
  const dependencyState = new Map<string, 0 | 1 | 2>();
  const visitDependency = (nodeId: string) => {
    const state = dependencyState.get(nodeId) ?? 0;
    if (state === 1) { add("error", "PREREQUISITE_CYCLE", "前置知识关系存在环。", nodeId); return; }
    if (state === 2) return;
    dependencyState.set(nodeId, 1);
    for (const target of prerequisiteTargets.get(nodeId) ?? []) visitDependency(target);
    dependencyState.set(nodeId, 2);
  };
  for (const node of dataset.nodes) visitDependency(node.id);

  const formulaById = new Map<string, (typeof dataset.formulas)[number]>();
  for (const formula of dataset.formulas) {
    if (formulaById.has(formula.id)) add("error", "DUPLICATE_FORMULA", `重复公式 ${formula.id}`, formula.id);
    formulaById.set(formula.id, formula);
    if (!nodeById.has(formula.nodeId)) add("error", "MISSING_FORMULA_NODE", "公式所属节点不存在。", formula.id);
    if (!formula.latex.trim() || !formula.sourceText.trim()) add("error", "EMPTY_FORMULA", "公式缺少 LaTeX 或原始显示文本。", formula.id);
    if (!formula.symbols.length) add("error", "MISSING_SYMBOLS", "公式必须定义符号。", formula.id);
    for (const symbol of formula.symbols) {
      if (!symbol.symbol.trim() || !symbol.latex.trim() || !symbol.definition.trim()) add("error", "INCOMPLETE_SYMBOL", "公式符号定义不完整。", formula.id);
    }
  }
  const cardNodes = new Set<string>();
  for (const card of dataset.cards) {
    if (cardNodes.has(card.nodeId)) add("error", "DUPLICATE_CARD", "每个节点只能有一张当前卡片。", card.nodeId);
    cardNodes.add(card.nodeId);
    if (!nodeById.has(card.nodeId)) add("error", "MISSING_CARD_NODE", "卡片节点不存在。", card.nodeId);
    if (!card.headline.trim() || !card.blocks.length) add("error", "EMPTY_CARD", "卡片必须包含摘要和内容块。", card.nodeId);
    for (const formulaId of [...card.formulaIds, ...card.blocks.flatMap((block) => block.formulaIds ?? [])]) {
      if (!formulaById.has(formulaId)) add("error", "MISSING_CARD_FORMULA", `卡片引用未知公式 ${formulaId}`, card.nodeId);
    }
  }
  for (const node of dataset.nodes) {
    if (!cardNodes.has(node.id)) add("warning", "MISSING_NODE_CARD", "节点尚无知识卡片。", node.id);
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { valid: errors.length === 0, errors, warnings, issues };
}
