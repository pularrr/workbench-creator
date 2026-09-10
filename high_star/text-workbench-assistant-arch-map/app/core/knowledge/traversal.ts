import type {
  EdgeType,
  KnowledgeDataset,
  KnowledgeEdge,
  KnowledgeNode,
  LocalGraphOptions,
  LocalGraphResult,
  TraversalReason,
  VisibleGraphProjection,
} from "./schema";

const edgePriority: Record<EdgeType, number> = {
  SIMILAR_TO: 0,
  ALTERNATIVE_TO: 1,
  PREREQUISITE_OF: 4,
  USES_MODEL: 4,
  DERIVED_FROM: 4,
  INPUT_TO: 5,
  OUTPUT_OF: 5,
  PART_OF: 6,
  IMPLEMENTS: 6,
  AFFECTS: 7,
  MITIGATES: 7,
  EVALUATED_BY: 7,
};

const byPlacement = (a: KnowledgeNode, b: KnowledgeNode) =>
  a.order - b.order || a.canonicalName.localeCompare(b.canonicalName, "zh-CN") || a.id.localeCompare(b.id);

interface Candidate {
  node: KnowledgeNode;
  reason: TraversalReason;
  priority: number;
}

function otherEndpoint(edge: KnowledgeEdge, nodeId: string): string | undefined {
  if (edge.sourceId === nodeId) return edge.targetId;
  if (edge.targetId === nodeId) return edge.sourceId;
  return undefined;
}

export function getLocalGraph(
  dataset: KnowledgeDataset,
  anchorId: string,
  options: LocalGraphOptions = {},
): LocalGraphResult {
  const maxDepth = Math.max(0, options.maxDepth ?? 2);
  const maxNodes = Math.max(1, options.maxNodes ?? 12);
  const includeImplicitSiblings = options.includeImplicitSiblings ?? true;
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const anchor = nodeById.get(anchorId);
  if (!anchor) throw new Error(`Unknown knowledge node: ${anchorId}`);

  const edgesByNode = new Map<string, KnowledgeEdge[]>();
  for (const edge of dataset.edges) {
    for (const nodeId of [edge.sourceId, edge.targetId]) {
      const edges = edgesByNode.get(nodeId) ?? [];
      edges.push(edge);
      edgesByNode.set(nodeId, edges);
    }
  }
  const childrenByParent = new Map<string, KnowledgeNode[]>();
  for (const node of dataset.nodes) {
    if (!node.primaryParentId) continue;
    const children = childrenByParent.get(node.primaryParentId) ?? [];
    children.push(node);
    childrenByParent.set(node.primaryParentId, children);
  }

  const candidatesFor = (current: KnowledgeNode): Candidate[] => {
    const candidates: Candidate[] = [];
    const adjacent = edgesByNode.get(current.id) ?? [];
    for (const edge of adjacent) {
      const endpoint = nodeById.get(otherEndpoint(edge, current.id) ?? "");
      if (!endpoint) continue;
      if (edge.type === "SIMILAR_TO") candidates.push({ node: endpoint, reason: "similar", priority: 0 });
      if (edge.type === "ALTERNATIVE_TO") candidates.push({ node: endpoint, reason: "alternative", priority: 1 });
    }
    if (includeImplicitSiblings && current.primaryParentId) {
      for (const sibling of childrenByParent.get(current.primaryParentId) ?? []) {
        if (sibling.id !== current.id && sibling.nodeType === current.nodeType && sibling.level === current.level) {
          candidates.push({ node: sibling, reason: "sibling", priority: 2 });
        }
      }
    }
    for (const child of childrenByParent.get(current.id) ?? []) {
      candidates.push({ node: child, reason: "child", priority: 3 });
    }
    for (const edge of adjacent) {
      const endpoint = nodeById.get(otherEndpoint(edge, current.id) ?? "");
      if (!endpoint) continue;
      if (edge.type === "PREREQUISITE_OF") {
        candidates.push({
          node: endpoint,
          reason: edge.targetId === current.id ? "prerequisite" : "dependent",
          priority: 4,
        });
      }
      if (edge.type === "USES_MODEL" || edge.type === "DERIVED_FROM") {
        candidates.push({ node: endpoint, reason: "dependency", priority: 4 });
      }
      if (edge.type === "INPUT_TO") {
        candidates.push({
          node: endpoint,
          reason: edge.targetId === current.id ? "input" : "downstream",
          priority: 5,
        });
      }
      if (edge.type === "OUTPUT_OF") {
        candidates.push({
          node: endpoint,
          reason: edge.targetId === current.id ? "output" : "producer",
          priority: 5,
        });
      }
    }
    const bestById = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const existing = bestById.get(candidate.node.id);
      if (!existing || candidate.priority < existing.priority) bestById.set(candidate.node.id, candidate);
    }
    return [...bestById.values()].sort((a, b) => a.priority - b.priority || byPlacement(a.node, b.node));
  };

  const visits: LocalGraphResult["visits"] = [{ nodeId: anchor.id, depth: 0, reason: "anchor" }];
  const visited = new Set([anchor.id]);
  let truncated = false;

  const expand = (current: KnowledgeNode, depth: number, path: ReadonlySet<string>) => {
    if (depth >= maxDepth || truncated) return;
    const admitted: Candidate[] = [];
    for (const candidate of candidatesFor(current)) {
      if (path.has(candidate.node.id) || visited.has(candidate.node.id)) continue;
      if (visited.size >= maxNodes) {
        truncated = true;
        break;
      }
      visited.add(candidate.node.id);
      visits.push({ nodeId: candidate.node.id, depth: depth + 1, reason: candidate.reason });
      admitted.push(candidate);
    }
    for (const candidate of admitted) {
      if (truncated) break;
      const nextPath = new Set(path);
      nextPath.add(candidate.node.id);
      expand(candidate.node, depth + 1, nextPath);
    }
  };

  expand(anchor, 0, new Set([anchor.id]));
  const nodes = visits.map((visit) => nodeById.get(visit.nodeId)!).filter(Boolean);
  const selected = new Set(nodes.map((node) => node.id));
  const edges = dataset.edges
    .filter((edge) => selected.has(edge.sourceId) && selected.has(edge.targetId))
    .sort((a, b) => edgePriority[a.type] - edgePriority[b.type] || a.sourceId.localeCompare(b.sourceId) || a.targetId.localeCompare(b.targetId) || a.id.localeCompare(b.id));
  return { anchorId, nodes, edges, visits, truncated };
}

/** Three-column projection compatible with the current previous/focus/next canvas. */
export function projectVisibleGraph(
  dataset: KnowledgeDataset,
  anchorId: string,
  options: LocalGraphOptions = {},
): VisibleGraphProjection {
  const local = getLocalGraph(dataset, anchorId, options);
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const anchor = nodeById.get(anchorId)!;
  const parent = anchor.primaryParentId ? nodeById.get(anchor.primaryParentId) : undefined;
  const previous = parent ? [parent] : [];
  const next = local.visits.slice(1).map((visit) => nodeById.get(visit.nodeId)!).filter(Boolean);
  const ordered = [...previous, anchor, ...next];
  const seen = new Set<string>();
  const nodes = ordered.filter((node) => !seen.has(node.id) && Boolean(seen.add(node.id)));
  const selected = new Set(nodes.map((node) => node.id));
  const edges = dataset.edges.filter((edge) => selected.has(edge.sourceId) && selected.has(edge.targetId));
  return { anchor, previous, next, nodes, edges, visits: local.visits, truncated: local.truncated };
}
