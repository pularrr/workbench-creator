import type { GraphOperation } from "../../core/agent/contracts";
import { deterministicId } from "../../core/agent/graph-operations";
import type { CardBlock, KnowledgeCard, KnowledgeDataset, KnowledgeEdge, KnowledgeEvidence, KnowledgeNode, NodeType } from "../../core/knowledge/schema";
import { CARD_SECTION_CATALOG } from "../../core/knowledge/card-section-catalog";
import { isTopologyLeaf } from "../../core/knowledge/topology";
import { nodeRoleForType } from "../../core/knowledge/schema";
import type { StagedKnowledgeImport } from "../../core/ingestion/contracts";
import type { ResearchDocument } from "./research-output";

const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
const nodeTypes = new Set(["domain","category","problem","concept","method","algorithm","model","component","artifact","parameter","metric","application"]);
const edgeTypes = new Set(["SIMILAR_TO","ALTERNATIVE_TO","PREREQUISITE_OF","PART_OF","INPUT_TO","OUTPUT_OF","USES_MODEL","IMPLEMENTS","DERIVED_FROM","AFFECTS","MITIGATES","EVALUATED_BY"]);

export function operationsFromResearch(document: ResearchDocument, dataset: KnowledgeDataset, currentNodeId: string, staged?: StagedKnowledgeImport) {
  const p = document.proposal;
  const nodes = new Map(dataset.nodes.map((n) => [n.id, n]));
  const refs = new Map<string,string>();
  for (const node of dataset.nodes) for (const value of [node.id, node.canonicalName, ...node.aliases]) refs.set(normalize(value), node.id);
  const evidence = [...new Map(p.evidence.map((item): [string,KnowledgeEvidence] => {
    const id = deterministicId("evidence", item);
    return [id, { id, title: item.title, sourceType: "document", ...(item.url ? { locator: item.url } : {}), excerpt: item.note || "模型生成知识，待核验" }];
  })).values()];
  const evidenceIds = evidence.map((item) => item.id);
  const operations: GraphOperation[] = evidence.map((item) => ({ kind:"upsert-evidence", evidence:item }));
  if (staged) {
    operations.push({ kind:"upsert-source", source:staged.artifact });
    for (const claim of staged.claims) operations.push({ kind:"upsert-claim", claim });
  }
  const cards = new Map<string,KnowledgeCard>();
  function addBlock(nodeId: string, raw: { type: string; title: string; text: string; items?: string[]; code?: string; language?: CardBlock["language"] }) {
    const node = nodes.get(nodeId);
    if (!node) throw new Error("知识卡片引用未知节点：" + nodeId);
    const card = cards.get(nodeId) ?? structuredClone(dataset.cards.find((c) => c.nodeId === nodeId) ?? { nodeId, headline: node.shortFact, blocks: [], formulaIds: [], evidenceIds: [], revision: dataset.revision });
    const type = CARD_SECTION_CATALOG.find((c) => c.type === raw.type)?.type ?? "research_topic";
    const block: CardBlock = { ...raw, type };
    const existing = card.blocks.find((b) => b.type === type && b.title === block.title);
    if (!existing) card.blocks.push(block);
    else {
      if (block.text && !existing.text?.includes(block.text)) existing.text = [existing.text,block.text].filter(Boolean).join("\n\n");
      if (block.items) existing.items = [...new Set([...(existing.items ?? []),...block.items])];
      if (block.code && existing.code !== block.code) {
        if (existing.code) card.blocks.push({ ...block, title:block.title + " · 补充实现" });
        else { existing.code = block.code; existing.language = block.language; }
      }
    }
    card.revision = dataset.revision + 1;
    card.evidenceIds = [...new Set([...card.evidenceIds,...evidenceIds])];
    cards.set(nodeId,card);
  }
  // Resolve all temporary IDs in one batch before assigning hierarchy.
  const additions = new Map<string,typeof p.newNodes[number]>();
  for (const proposed of p.newNodes) {
    const id = refs.get(normalize(proposed.canonicalName)) ?? deterministicId("knowledge", normalize(proposed.canonicalName));
    refs.set(normalize(proposed.canonicalName),id);
    if (proposed.id) refs.set(normalize(proposed.id),id);
    if (!nodes.has(id) && !additions.has(id)) additions.set(id,proposed);
  }
  const resolve = (value: string) => refs.get(normalize(value)) ?? (nodes.has(value) ? value : undefined);
  const plannedCategoryIds: string[] = [];
  for (const plan of document.categoryPlan ?? []) {
    const parentId = resolve(plan.parentId);
    if (!parentId) throw new Error("分类计划引用未知父节点：" + plan.parentId);
    for (const categoryName of plan.categories) {
      const existing = resolve(categoryName);
      if (existing) { plannedCategoryIds.push(existing); continue; }
      const id = deterministicId("knowledge", normalize(categoryName));
      refs.set(normalize(categoryName), id);
      additions.set(id, { canonicalName: categoryName, shortFact: `用于归组“${nodes.get(parentId)?.canonicalName ?? parentId}”下的相关知识。`, nodeRole: "category", nodeType: "category", parentId, blocks: [] });
      plannedCategoryIds.push(id);
    }
  }
  let order = Math.max(...dataset.nodes.map((node) => node.order),0) + 1;
  while (additions.size) {
    let progress = false;
    for (const [id, proposed] of additions) {
      const parentId = proposed.parentId ? resolve(proposed.parentId) : currentNodeId;
      const parent = parentId ? nodes.get(parentId) : undefined;
      if (!parent) continue;
      const nodeType = nodeTypes.has(proposed.nodeType) ? proposed.nodeType as NodeType : "concept";
      const node: KnowledgeNode = { id, canonicalName:proposed.canonicalName, shortFact:proposed.shortFact, aliases:[], nodeRole: proposed.nodeRole ?? nodeRoleForType(nodeType), nodeType,
        primaryParentId:parent.id, domainId:parent.domainId, visualBranch:parent.visualBranch, level:parent.level+1, order:order++, tags:["agent-generated"], status:"reviewed" };
      nodes.set(id,node); operations.push({ kind:"upsert-node",node });
      additions.delete(id); progress = true;
    }
    if (!progress) throw new Error("候选父子关系无法解析（未知父节点或循环）：" + [...additions.values()].map((n) => n.canonicalName + " → " + n.parentId).join("；").slice(0,1000));
  }
  for (const plan of document.categoryPlan ?? []) {
    for (const hint of plan.reparentHints ?? []) {
      const leafId = resolve(hint.leafName), categoryId = resolve(hint.toCategory);
      const leaf = leafId ? nodes.get(leafId) : undefined;
      const category = categoryId ? nodes.get(categoryId) : undefined;
      if (!leaf || !category || category.nodeType !== "category") throw new Error(`分类重挂载无法解析：${hint.leafName} → ${hint.toCategory}`);
      if (!isTopologyLeaf(leaf.id, dataset.nodes)) throw new Error(`分类重挂载只能移动拓扑叶子节点：${leaf.canonicalName}`);
      const updated = { ...leaf, primaryParentId: category.id, domainId: category.domainId, visualBranch: category.visualBranch, level: category.level + 1 };
      nodes.set(updated.id, updated); operations.push({ kind:"upsert-node", node:updated });
    }
  }
  for (const proposed of p.newNodes) {
    const id = resolve(proposed.canonicalName)!;
    addBlock(id,{ type:"definition",title:"定义与边界",text:proposed.shortFact });
    for (const block of proposed.blocks) addBlock(id,block);
  }
  for (const categoryId of plannedCategoryIds) {
    const category = nodes.get(categoryId);
    if (category) addBlock(categoryId, { type:"definition", title:"分类边界", text:category.shortFact });
  }
  for (const block of p.cardBlocks) {
    const id = block.nodeId ? resolve(block.nodeId) : currentNodeId;
    if (!id) throw new Error("卡片目标节点无法解析：" + block.nodeId);
    addBlock(id,block);
  }
  for (const card of cards.values()) operations.push({kind:"upsert-card",card});
  const edges = new Set(dataset.edges.map((e) => e.type+":"+e.sourceId+":"+e.targetId));
  for (const relation of p.relations) {
    const sourceId = resolve(relation.sourceId), targetId = resolve(relation.targetId);
    if (!sourceId || !targetId || !edgeTypes.has(relation.type)) throw new Error("无效关系端点或类型：" + JSON.stringify(relation));
    const key = relation.type+":"+sourceId+":"+targetId;
    const reverse = relation.type+":"+targetId+":"+sourceId;
    if (edges.has(key) || (["SIMILAR_TO","ALTERNATIVE_TO"].includes(relation.type) && edges.has(reverse))) continue;
    const edge: KnowledgeEdge = { id:deterministicId("edge",key),sourceId,targetId,type:relation.type as KnowledgeEdge["type"], rationale:relation.rationale,weight:0.8,evidenceIds,status:"reviewed" };
    operations.push({kind:"upsert-edge",edge}); edges.add(key);
  }
  if (cards.size || operations.some((o) => o.kind === "upsert-node")) operations.push({ kind:"append-history",entry:{
    id:deterministicId("history",{currentNodeId,summary:p.summary,at:Date.now()}),nodeId:currentNodeId,kind:"knowledge_imported",
    summary:p.summary.slice(0,90),occurredAt:new Date().toISOString(),revision:dataset.revision+1,
  }});
  return { summary:p.summary,rationale:p.rationale || document.coverageAssessment,evidence,operations };
}
