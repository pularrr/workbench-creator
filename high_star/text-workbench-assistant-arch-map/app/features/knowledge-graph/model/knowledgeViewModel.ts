import { projectVisibleGraph } from "../../../core/knowledge/traversal";
import type { CardBlock, EdgeType, KnowledgeDataset } from "../../../core/knowledge/schema";
import { expandedKnowledgeDataset } from "../../../data/knowledge/initial-dataset";

import { ACTIVE_PROFILE } from "../../../profiles/active";
export type FormulaSymbol = { symbol: string; latex: string; explanation: string; unit?: string };
export type FormulaMeta = { latex: string; symbols: FormulaSymbol[] };
export type KnowledgeNode = { id: string; title: string; subtitle: string; branch: string; parent?: string; summary: string; details?: string[]; formula?: string; impact?: string; verification?: string; pitfall?: string };
const defaultBranch = { color: "#23b5a5", label: "知识域" };
export const branchMeta: Record<string, { color: string; label: string }> = Object.fromEntries(ACTIVE_PROFILE.visualBranches.map((branch, index) => [branch, { color: ["#23b5a5", "#5b8def", "#8b75ff", "#d3962c", "#e46c9a"][index % 5], label: String(branch) }])) as Record<string, { color: string; label: string }>;

export type KnowledgeCardSection = {
  type: CardBlock["type"];
  title: string;
  text?: string;
  items?: string[];
  language?: CardBlock["language"];
  code?: string;
};

export type KnowledgeCardView = {
  headline: string;
  sections: KnowledgeCardSection[];
};

export function toLegacyKnowledgeNodes(dataset: KnowledgeDataset): KnowledgeNode[] {
  const cards = new Map(dataset.cards.map((card) => [card.nodeId, card]));
  const formulasByNode = new Map<string, KnowledgeDataset["formulas"]>();
  for (const formula of dataset.formulas) formulasByNode.set(formula.nodeId, [...(formulasByNode.get(formula.nodeId) ?? []), formula]);
  return dataset.nodes.slice().sort((left, right) => left.order - right.order).map((node) => {
    const card = cards.get(node.id);
    const blocks = card?.blocks ?? [];
    const formulas = formulasByNode.get(node.id) ?? [];
    const first = (type: CardBlock["type"]) => blocks.find((block) => block.type === type);
    return {
      id: node.id,
      title: node.canonicalName,
      subtitle: node.shortFact,
      branch: node.visualBranch,
      ...(node.primaryParentId ? { parent: node.primaryParentId } : {}),
      summary: card?.headline ?? node.legacySnapshot?.summary ?? node.shortFact,
      ...(first("principle")?.items ? { details: first("principle")!.items } : {}),
      ...(formulas[0] ? { formula: formulas[0].sourceText } : {}),
      ...(first("engineering_tradeoff")?.text ? { impact: first("engineering_tradeoff")!.text } : {}),
      ...(first("validation")?.text ? { verification: first("validation")!.text } : {}),
      ...(first("failure_mode")?.text ? { pitfall: first("failure_mode")!.text } : {}),
    };
  });
}

const cardByNode = new Map(expandedKnowledgeDataset.cards.map((card) => [card.nodeId, card]));
const formulasByNode = new Map<string, typeof expandedKnowledgeDataset.formulas>();

for (const formula of expandedKnowledgeDataset.formulas) {
  formulasByNode.set(formula.nodeId, [...(formulasByNode.get(formula.nodeId) ?? []), formula]);
}

export const knowledgeNodes: KnowledgeNode[] = toLegacyKnowledgeNodes(expandedKnowledgeDataset);

export const formulaMeta: Record<string, FormulaMeta> = Object.fromEntries(
  expandedKnowledgeDataset.formulas.map((formula) => [
    formula.nodeId,
    {
      latex: formula.latex,
      symbols: formula.symbols.map((symbol) => ({
        symbol: symbol.symbol,
        latex: symbol.latex,
        explanation: symbol.definition,
        ...(symbol.unit ? { unit: symbol.unit } : {}),
      })),
    },
  ]),
);

export function getKnowledgeCard(nodeId: string): KnowledgeCardView | undefined {
  const card = cardByNode.get(nodeId);
  if (!card) return undefined;
  return {
    headline: card.headline,
    sections: card.blocks.map((block) => ({
      type: block.type,
      title: block.title,
      ...(block.text ? { text: block.text } : {}),
      ...(block.items?.length ? { items: [...block.items] } : {}),
      ...(block.language ? { language: block.language } : {}),
      ...(block.code ? { code: block.code } : {}),
    })),
  };
}

export function getKnowledgeCardFromDataset(dataset: KnowledgeDataset, nodeId: string): KnowledgeCardView | undefined {
  const card = dataset.cards.find((item) => item.nodeId === nodeId);
  if (!card) return undefined;
  return {
    headline: card.headline,
    sections: card.blocks.map((block) => ({
      type: block.type,
      title: block.title,
      ...(block.text ? { text: block.text } : {}),
      ...(block.items?.length ? { items: [...block.items] } : {}),
      ...(block.language ? { language: block.language } : {}),
      ...(block.code ? { code: block.code } : {}),
    })),
  };
}

export type VisibleRelation = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  label: string;
};

export function getVisibleProjection(anchorId: string, maxNodes = 8) {
  return projectVisibleGraph(expandedKnowledgeDataset, anchorId, {
    maxDepth: 1,
    maxNodes,
    includeImplicitSiblings: true,
  });
}

export function getVisibleRelations(anchorId: string, maxNodes = 8): VisibleRelation[] {
  return getVisibleProjection(anchorId, maxNodes).edges.map((edge) => ({
    id: edge.id,
    from: edge.sourceId,
    to: edge.targetId,
    type: edge.type,
    label: edge.rationale,
  }));
}

export function getVisibleRelationsFromDataset(dataset: KnowledgeDataset, anchorId: string, maxNodes = 8): VisibleRelation[] {
  return projectVisibleGraph(dataset, anchorId, { maxDepth: 1, maxNodes, includeImplicitSiblings: true }).edges.map((edge) => ({
    id: edge.id,
    from: edge.sourceId,
    to: edge.targetId,
    type: edge.type,
    label: edge.rationale,
  }));
}

export const graphRevision = expandedKnowledgeDataset.revision;
export const semanticDomainCount = expandedKnowledgeDataset.domains.length;
