import type { KnowledgeNode, NodeType } from "./schema";

/** A semantic leaf is a concrete knowledge-entity type, regardless of children. */
export function isKnowledgeEntityType(nodeType: NodeType): boolean {
  return nodeType !== "domain" && nodeType !== "category";
}

export function isKnowledgeEntityNode(node: Pick<KnowledgeNode, "nodeType">): boolean {
  return isKnowledgeEntityType(node.nodeType);
}

/** A topology leaf is a node with no primary-tree child, regardless of node type. */
export function isTopologyLeaf(nodeId: string, nodes: readonly Pick<KnowledgeNode, "id" | "primaryParentId">[]): boolean {
  return !nodes.some((node) => node.primaryParentId === nodeId);
}

export function primaryChildCount(nodeId: string, nodes: readonly Pick<KnowledgeNode, "primaryParentId">[]): number {
  return nodes.filter((node) => node.primaryParentId === nodeId).length;
}
