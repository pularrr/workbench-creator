import { deterministicId } from "../agent/graph-operations";
import type { AgentGraphData } from "../agent/contracts";
import type { KnowledgeDataset } from "./schema";
import { validateKnowledgeDataset } from "./validation";

export const KNOWLEDGE_BUNDLE_SCHEMA = "knowmap-knowledge-bundle/1" as const;

export interface PortableKnowledgeBundle {
  schemaVersion: typeof KNOWLEDGE_BUNDLE_SCHEMA;
  exportedAt: string;
  sourceSystem: "knowmap";
  dataset: KnowledgeDataset;
  checksum: string;
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function datasetChecksum(dataset: KnowledgeDataset): string {
  return deterministicId("dataset", jsonClone(dataset));
}

export function createPortableKnowledgeBundle(
  dataset: KnowledgeDataset,
  exportedAt = new Date().toISOString(),
): PortableKnowledgeBundle {
  const report = validateKnowledgeDataset(dataset);
  if (!report.valid) throw new Error(`Invalid knowledge dataset: ${report.issues.map((issue) => issue.code).join(", ")}`);
  const cloned = jsonClone(dataset);
  return {
    schemaVersion: KNOWLEDGE_BUNDLE_SCHEMA,
    exportedAt,
    sourceSystem: "knowmap",
    dataset: cloned,
    checksum: datasetChecksum(cloned),
  };
}

export function serializeKnowledgeBundle(bundle: PortableKnowledgeBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseKnowledgeBundle(value: string): PortableKnowledgeBundle {
  const parsed = JSON.parse(value) as PortableKnowledgeBundle;
  if (parsed.schemaVersion !== KNOWLEDGE_BUNDLE_SCHEMA) throw new Error("Unsupported knowledge bundle schema.");
  const report = validateKnowledgeDataset(parsed.dataset);
  if (!report.valid) throw new Error("Knowledge bundle contains an invalid graph.");
  if (parsed.checksum !== datasetChecksum(parsed.dataset)) throw new Error("Knowledge bundle checksum mismatch.");
  return structuredClone(parsed);
}

export function datasetToAgentGraph(dataset: KnowledgeDataset): AgentGraphData {
  return {
    nodes: structuredClone(dataset.nodes),
    edges: structuredClone(dataset.edges),
    cards: structuredClone(dataset.cards),
    domains: structuredClone(dataset.domains),
    formulas: structuredClone(dataset.formulas),
    history: structuredClone(dataset.history ?? []),
    evidence: structuredClone(dataset.evidence ?? []),
    assets: structuredClone(dataset.assets ?? []),
    sources: structuredClone(dataset.sources ?? []),
    claims: structuredClone(dataset.claims ?? []),
  };
}

export function agentGraphToDataset(graph: AgentGraphData & { revision: number }): KnowledgeDataset {
  const dataset = {
    revision: graph.revision,
    domains: structuredClone(graph.domains ?? []),
    nodes: structuredClone(graph.nodes),
    cards: structuredClone(graph.cards),
    formulas: structuredClone(graph.formulas ?? []),
    edges: structuredClone(graph.edges),
    history: structuredClone(graph.history ?? []),
    evidence: structuredClone(graph.evidence ?? []),
    assets: structuredClone(graph.assets ?? []),
    sources: structuredClone(graph.sources ?? []),
    claims: structuredClone(graph.claims ?? []),
  } as KnowledgeDataset;
  const report = validateKnowledgeDataset(dataset);
  if (!report.valid) throw new Error(`Projected graph is invalid: ${report.errors.map((issue) => issue.code).join(", ")}`);
  return dataset;
}
