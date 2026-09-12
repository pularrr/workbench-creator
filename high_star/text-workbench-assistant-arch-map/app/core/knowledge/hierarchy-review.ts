import type { KnowledgeNode, NodeType } from "./schema";
import { isKnowledgeEntityType, isTopologyLeaf } from "./topology";

export interface HierarchyReviewPolicy { enabled: boolean; intermediateNodeTypes: string[]; planningThreshold: number; maxPrimaryChildren: number; minMembersPerIntermediate?: number; }
export interface HierarchyFinding { code: string; message: string; entityId: string; }

export function hierarchyReviewPolicy(profile?: { hierarchy?: { enabled: boolean; intermediateNodeTypes: string[]; planningThreshold?: number; minMembersPerIntermediate?: number }; validation: { maxPrimaryChildren?: number } }): HierarchyReviewPolicy {
  return { enabled: profile?.hierarchy?.enabled ?? true, intermediateNodeTypes: profile?.hierarchy?.intermediateNodeTypes ?? ["category"], planningThreshold: profile?.hierarchy?.planningThreshold ?? 6, maxPrimaryChildren: profile?.validation.maxPrimaryChildren ?? 8, minMembersPerIntermediate: profile?.hierarchy?.minMembersPerIntermediate };
}

export function reviewPrimaryHierarchy(nodes: readonly Pick<KnowledgeNode, "id" | "canonicalName" | "nodeType" | "primaryParentId">[], policy: HierarchyReviewPolicy): HierarchyFinding[] {
  if (!policy.enabled) return [];
  const byParent = new Map<string, typeof nodes>();
  for (const node of nodes) if (node.primaryParentId) byParent.set(node.primaryParentId, [...(byParent.get(node.primaryParentId) ?? []), node]);
  const index = new Map(nodes.map((node) => [node.id, node])); const findings: HierarchyFinding[] = [];
  for (const [parentId, children] of byParent) {
    const parent = index.get(parentId); if (!parent) continue;
    if (children.length > policy.maxPrimaryChildren) findings.push({ code: "TOO_MANY_PRIMARY_CHILDREN", entityId: parentId, message: `父节点“${parent.canonicalName}”有 ${children.length} 个直接子节点，建议不超过 ${policy.maxPrimaryChildren} 个。` });
    const leafConcepts = children.filter((child) => child.nodeType === "concept" && isTopologyLeaf(child.id, nodes)).length;
    if (children.length && leafConcepts / children.length >= 0.75) findings.push({ code: "FLAT_CONCEPT_CLUSTER", entityId: parentId, message: `父节点“${parent.canonicalName}”的直接子节点主要是拓扑叶子 concept（${leafConcepts}/${children.length}），层级可能过平。` });
  }
  for (const node of nodes) if (policy.intermediateNodeTypes.includes(node.nodeType)) {
    const members = byParent.get(node.id) ?? [];
    if (!members.length) findings.push({ code: "EMPTY_INTERMEDIATE_CATEGORY", entityId: node.id, message: `中间节点“${node.canonicalName}”没有子节点。` });
    if (policy.minMembersPerIntermediate && members.length < policy.minMembersPerIntermediate) findings.push({ code: "SPARSE_INTERMEDIATE_CATEGORY", entityId: node.id, message: `中间节点“${node.canonicalName}”只有 ${members.length} 个子节点。` });
  }
  return findings;
}

export function semanticEntityCount(nodes: readonly Pick<KnowledgeNode, "nodeType">[]): number {
  return nodes.filter((node) => isKnowledgeEntityType(node.nodeType as NodeType)).length;
}
