import type { KnowledgeDataset, KnowledgeNode } from "../../core/knowledge/schema";
import { ACTIVE_PROFILE } from "../../profiles/active";

export function createInitialDataset(): KnowledgeDataset {
  const p = ACTIVE_PROFILE, root = p.initialization.rootNode, first = p.domains[0];
  const nodes: KnowledgeNode[] = [{ id: root.id, canonicalName: root.name, shortFact: root.shortFact,
    aliases: [], nodeType: "domain", domainId: first.id as KnowledgeNode["domainId"],
    visualBranch: first.visualBranch as KnowledgeNode["visualBranch"], primaryParentId: null,
    level: 0, order: 0, tags: [], status: "draft" },
    ...p.domains.map((d, i): KnowledgeNode => ({ id: d.id, canonicalName: d.name, shortFact: d.description,
      aliases: [], nodeType: "domain", domainId: d.id as KnowledgeNode["domainId"],
      visualBranch: d.visualBranch as KnowledgeNode["visualBranch"], primaryParentId: root.id,
      level: 1, order: i + 1, tags: [], status: "draft" }))];
  return { revision: 1, domains: p.domains as KnowledgeDataset["domains"], nodes,
    cards: nodes.map(n => ({ nodeId: n.id, headline: n.shortFact,
      blocks: [{ type: "definition", title: "定义与边界", text: n.shortFact }],
      formulaIds: [], evidenceIds: [], revision: 1 })), formulas: [], edges: [] };
}
export const expandedKnowledgeDataset = createInitialDataset();
