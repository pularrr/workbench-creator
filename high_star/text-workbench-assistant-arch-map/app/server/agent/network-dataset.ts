import { z } from "zod";
import { nodeRoleForType, type KnowledgeDataset, type KnowledgeNode, type CardBlock, type KnowledgeEvidence } from "../../core/knowledge/schema";
import type { TaskProfile } from "../../plugin/contracts/task-profile";
import { validateKnowledgeDataset } from "../../core/knowledge/validation";

const text = z.string().trim().min(1);
export const networkSchema = z.object({
  nodes: z.array(z.object({ id: text, canonicalName: text, shortFact: text, nodeType: text, nodeRole: z.enum(["domain", "category", "entity"]).optional(),
    parentId: z.string(), domainId: z.string().optional(), order: z.number().optional() })).min(1),
  cardBlocks: z.array(z.object({ nodeId: text, type: text, title: text, text: z.string(),
    items: z.array(z.string()).optional(), code: z.string().optional(), evidenceIds: z.array(z.string()).optional(),
    language: z.enum(["python","matlab","typescript","text"]).optional() })),
  relations: z.array(z.object({ sourceId: text, targetId: text, type: text, rationale: text, evidenceIds: z.array(z.string()).optional() })),
  evidence: z.array(z.object({ id: text, title: text, sourceType: z.enum(["conversation","summary","paper","document","image","audio","video","manual"]), locator: z.string().optional(), excerpt: z.string().optional() })).optional(),
});
export type KnowledgeNetwork = z.infer<typeof networkSchema>;

export function networkToDataset(value: unknown, profile: TaskProfile): KnowledgeDataset {
  const network = networkSchema.parse(value);
  const raw = new Map(network.nodes.map(n => [n.id, n]));
  if (raw.size !== network.nodes.length) throw new Error("重复节点 ID");
  if (network.nodes.filter(n => !n.parentId).length !== 1 || raw.get(profile.initialization.rootNode.id)?.parentId !== "") throw new Error("根节点必须唯一且与 Profile 一致");
  const nodes = new Map<string, KnowledgeNode>();
  const visiting = new Set<string>();
  const materialize = (id: string): KnowledgeNode => {
    if (nodes.has(id)) return nodes.get(id)!;
    if (visiting.has(id)) throw new Error(`父级环: ${id}`);
    const n = raw.get(id);
    if (!n) throw new Error(`未知父级: ${id}`);
    visiting.add(id);
    const parent = n.parentId ? materialize(n.parentId) : undefined;
    const domain = profile.domains.find(d => d.id === (n.domainId || parent?.domainId || profile.domains[0].id));
    if (!domain) throw new Error(`未知域: ${n.domainId}`);
    if (!profile.nodeTypes.some(t => t.type === n.nodeType)) throw new Error(`未知节点类型: ${n.nodeType}`);
    const nodeType = n.nodeType as KnowledgeNode["nodeType"];
    const node: KnowledgeNode = { id, canonicalName: n.canonicalName, shortFact: n.shortFact,
      nodeRole: n.nodeRole ?? nodeRoleForType(nodeType), nodeType, primaryParentId: n.parentId || null,
      domainId: domain.id as KnowledgeNode["domainId"], visualBranch: domain.visualBranch as KnowledgeNode["visualBranch"],
      level: parent ? parent.level + 1 : 0, order: n.order ?? nodes.size, aliases: [], tags: [], status: "draft" };
    nodes.set(id, node); visiting.delete(id); return node;
  };
  network.nodes.forEach(n => materialize(n.id));
  const cards = new Map<string, KnowledgeDataset["cards"][number]>();
  for (const b of network.cardBlocks) {
    if (!nodes.has(b.nodeId)) throw new Error(`卡片引用未知节点: ${b.nodeId}`);
    if (!profile.cardSections.some(s => s.type === b.type)) throw new Error(`未知栏目: ${b.type}`);
    const card = cards.get(b.nodeId) ?? { nodeId: b.nodeId, headline: nodes.get(b.nodeId)!.shortFact, blocks: [], formulaIds: [], evidenceIds: [], revision: 1 };
    const { nodeId: _, evidenceIds, ...block } = b;
    card.evidenceIds = [...new Set([...card.evidenceIds, ...(evidenceIds ?? [])])];
    card.blocks.push({ ...block, type: b.type as CardBlock["type"] }); cards.set(b.nodeId, card);
  }
  const dataset: KnowledgeDataset = { revision: 1, domains: profile.domains as KnowledgeDataset["domains"],
    nodes: [...nodes.values()], cards: [...cards.values()], formulas: [], evidence: network.evidence as KnowledgeEvidence[] | undefined,
    edges: network.relations.map((r, i) => {
      if (!profile.edgeTypes.some(e => e.type === r.type)) throw new Error(`未知边类型: ${r.type}`);
      return { ...r, id: `edge-${i}`, type: r.type as KnowledgeDataset["edges"][number]["type"], weight: 1, status: "draft", evidenceIds: r.evidenceIds ?? [] };
    }) };
  const report = validateKnowledgeDataset(dataset, { profile });
  if (!report.valid) throw new Error(report.errors.map(e => `${e.code}: ${e.message}`).join("\n"));
  return dataset;
}

export function datasetToNetwork(dataset: KnowledgeDataset): KnowledgeNetwork {
  return { nodes: dataset.nodes.map(n => ({ id: n.id, canonicalName: n.canonicalName, shortFact: n.shortFact,
    nodeType: n.nodeType, nodeRole: n.nodeRole ?? nodeRoleForType(n.nodeType), parentId: n.primaryParentId || "", domainId: n.domainId, order: n.order })),
    cardBlocks: dataset.cards.flatMap(c => c.blocks.map(b => ({ ...b, nodeId: c.nodeId, text: b.text || "", evidenceIds: c.evidenceIds }))),
    relations: dataset.edges.map(e => ({ sourceId: e.sourceId, targetId: e.targetId, type: e.type, rationale: e.rationale, evidenceIds: e.evidenceIds })), evidence: dataset.evidence };
}
