import type {
  AgentCardRecord,
  AgentEdgeRecord,
  AgentGraphSnapshot,
  AgentNodeRecord,
  EntityDiff,
  GraphOperation,
  ProjectionDiff,
} from "./contracts";

const clone = <T>(value: T): T => structuredClone(value);

export function applyOperations(
  snapshot: AgentGraphSnapshot,
  operations: readonly GraphOperation[],
  nextRevision = snapshot.revision,
): AgentGraphSnapshot {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, clone(node)]));
  const edges = new Map(snapshot.edges.map((edge) => [edge.id, clone(edge)]));
  const cards = new Map(snapshot.cards.map((card) => [card.nodeId, clone(card)]));
  const formulas = new Map((snapshot.formulas ?? []).map((formula) => [formula.id, clone(formula)]));
  const evidence = new Map((snapshot.evidence ?? []).map((item) => [item.id, clone(item)]));
  const assets = new Map((snapshot.assets ?? []).map((asset) => [asset.id, clone(asset)]));
  const sources = new Map((snapshot.sources ?? []).map((source) => [source.id, clone(source)]));
  const claims = new Map((snapshot.claims ?? []).map((claim) => [claim.id, clone(claim)]));
  const history = new Map((snapshot.history ?? []).map((entry) => [entry.id, clone(entry)]));

  for (const operation of operations) {
    switch (operation.kind) {
      case "upsert-node": nodes.set(operation.node.id, clone(operation.node)); break;
      case "remove-node": nodes.delete(operation.nodeId); break;
      case "upsert-edge": edges.set(operation.edge.id, clone(operation.edge)); break;
      case "remove-edge": edges.delete(operation.edgeId); break;
      case "upsert-card": cards.set(operation.card.nodeId, clone(operation.card)); break;
      case "remove-card": cards.delete(operation.nodeId); break;
      case "upsert-formula": formulas.set(operation.formula.id, clone(operation.formula)); break;
      case "remove-formula": formulas.delete(operation.formulaId); break;
      case "upsert-evidence": evidence.set(operation.evidence.id, clone(operation.evidence)); break;
      case "remove-evidence": evidence.delete(operation.evidenceId); break;
      case "upsert-asset": assets.set(operation.asset.id, clone(operation.asset)); break;
      case "remove-asset": assets.delete(operation.assetId); break;
      case "upsert-source": sources.set(operation.source.id, clone(operation.source)); break;
      case "upsert-claim": claims.set(operation.claim.id, clone(operation.claim)); break;
      case "append-history": history.set(operation.entry.id, clone(operation.entry)); break;
    }
  }

  return {
    ...clone(snapshot),
    revision: nextRevision,
    nodes: [...nodes.values()] as AgentNodeRecord[],
    edges: [...edges.values()] as AgentEdgeRecord[],
    cards: [...cards.values()] as AgentCardRecord[],
    formulas: [...formulas.values()],
    evidence: [...evidence.values()],
    assets: [...assets.values()],
    sources: [...sources.values()],
    claims: [...claims.values()],
    history: [...history.values()],
  };
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export function deterministicId(prefix: string, value: unknown): string {
  const input = stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function diffRecords<T>(
  before: readonly T[],
  after: readonly T[],
  idOf: (record: T) => string,
): EntityDiff {
  const left = new Map(before.map((record) => [idOf(record), stableJson(record)]));
  const right = new Map(after.map((record) => [idOf(record), stableJson(record)]));
  return {
    added: [...right.keys()].filter((id) => !left.has(id)).sort(),
    updated: [...right.keys()].filter((id) => left.has(id) && left.get(id) !== right.get(id)).sort(),
    removed: [...left.keys()].filter((id) => !right.has(id)).sort(),
  };
}

export function createProjectionDiff(
  before: AgentGraphSnapshot,
  after: AgentGraphSnapshot,
  currentNodeId?: string,
): ProjectionDiff {
  const nodes = diffRecords(before.nodes, after.nodes, (node) => node.id);
  const edges = diffRecords(before.edges, after.edges, (edge) => edge.id);
  const cards = diffRecords(before.cards, after.cards, (card) => card.nodeId);
  const formulas = diffRecords(before.formulas ?? [], after.formulas ?? [], (formula) => formula.id);
  const evidence = diffRecords(before.evidence ?? [], after.evidence ?? [], (item) => item.id);
  const assets = diffRecords(before.assets ?? [], after.assets ?? [], (asset) => asset.id);
  const sources = diffRecords(before.sources ?? [], after.sources ?? [], (source) => source.id);
  const claims = diffRecords(before.claims ?? [], after.claims ?? [], (claim) => claim.id);
  const history = diffRecords(before.history ?? [], after.history ?? [], (entry) => entry.id);
  const changedNodes = [...nodes.added, ...nodes.updated];
  const edgeMap = new Map(after.edges.map((edge) => [edge.id, edge]));
  const endpoints = [...edges.added, ...edges.updated]
    .flatMap((id) => {
      const edge = edgeMap.get(id);
      return edge ? [edge.sourceId, edge.targetId] : [];
    });
  const visibleNodeIds = [...new Set([
    ...(currentNodeId ? [currentNodeId] : []),
    ...changedNodes,
    ...endpoints,
  ])].slice(0, 12);
  return { nodes, edges, cards, formulas, evidence, assets, sources, claims, history, visibleNodeIds };
}
