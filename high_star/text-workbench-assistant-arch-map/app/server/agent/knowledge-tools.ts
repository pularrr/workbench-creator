import { assessCardCoverage } from "../../core/knowledge/card-section-catalog";
import { getLocalGraph } from "../../core/knowledge/traversal";
import type { KnowledgeDataset } from "../../core/knowledge/schema";
import type { JsonObject, JsonValue, LlmFunctionTool } from "../../core/llm/contracts";

export interface KnowledgeToolObservation {
  round: number;
  tool: string;
  input: JsonObject;
  summary: string;
  output: JsonValue;
}

const objectSchema = (properties: JsonObject, required: string[] = []): JsonObject => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const KNOWLEDGE_TOOL_DEFINITIONS: readonly LlmFunctionTool[] = [
  {
    name: "get_node",
    description: "读取一个知识节点的身份、主树层级和直接上下游。",
    parameters: objectSchema({ nodeId: { type: "string" } }, ["nodeId"]),
  },
  {
    name: "get_card",
    description: "读取一个节点当前知识卡的栏目和内容，不读取历史。",
    parameters: objectSchema({ nodeId: { type: "string" } }, ["nodeId"]),
  },
  {
    name: "assess_coverage",
    description: "检查节点应有栏目、已覆盖栏目和知识缺口。",
    parameters: objectSchema({ nodeId: { type: "string" } }, ["nodeId"]),
  },
  {
    name: "traverse_graph",
    description: "按同层优先 DFS 读取相似、替代、兄弟、子级和依赖邻域。",
    parameters: objectSchema({
      nodeId: { type: "string" },
      maxDepth: { type: "integer", minimum: 1, maximum: 3 },
      maxNodes: { type: "integer", minimum: 2, maximum: 24 },
    }, ["nodeId"]),
  },
  {
    name: "search_graph",
    description: "按名称、别名、短事实和卡片正文搜索现有图谱，避免重复建点。",
    parameters: objectSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 12 } }, ["query"]),
  },
  {
    name: "get_history",
    description: "仅在用户明确给出 historyIds 时读取对应历史摘要。",
    parameters: objectSchema({ nodeId: { type: "string" }, historyIds: { type: "array", items: { type: "string" }, maxItems: 15 } }, ["nodeId", "historyIds"]),
  },
];

const stringArg = (args: JsonObject, name: string): string => {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
};

const integerArg = (args: JsonObject, name: string, fallback: number, min: number, max: number): number => {
  const value = args[name];
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export function executeKnowledgeTool(
  dataset: KnowledgeDataset,
  name: string,
  args: JsonObject,
): { summary: string; output: JsonValue } {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const nodeId = name === "search_graph" ? undefined : stringArg(args, "nodeId");
  const node = nodeId ? nodeById.get(nodeId) : undefined;
  if (nodeId && !node) throw new Error(`Unknown node: ${nodeId}`);

  if (name === "get_node") {
    const children = dataset.nodes.filter((item) => item.primaryParentId === nodeId).slice(0, 20);
    const parent = node!.primaryParentId ? nodeById.get(node!.primaryParentId) : undefined;
    return {
      summary: `读取“${node!.canonicalName}”及 ${children.length} 个直接子节点。`,
      output: {
        node: node! as unknown as JsonValue,
        parent: (parent ?? null) as unknown as JsonValue,
        children: children as unknown as JsonValue,
      },
    };
  }

  if (name === "get_card") {
    const card = dataset.cards.find((item) => item.nodeId === nodeId) ?? null;
    const formulas = dataset.formulas.filter((item) => item.nodeId === nodeId);
    return {
      summary: `读取“${node!.canonicalName}”知识卡，共 ${card?.blocks.length ?? 0} 个栏目。`,
      output: { card: card as unknown as JsonValue, formulas: formulas as unknown as JsonValue },
    };
  }

  if (name === "assess_coverage") {
    const card = dataset.cards.find((item) => item.nodeId === nodeId);
    const coverage = assessCardCoverage(node!, card);
    return {
      summary: `“${node!.canonicalName}”覆盖 ${coverage.present}/${coverage.total} 个必要栏目，缺少 ${coverage.missing.join("、") || "无"}。`,
      output: coverage as unknown as JsonValue,
    };
  }

  if (name === "traverse_graph") {
    const maxDepth = integerArg(args, "maxDepth", 2, 1, 3);
    const maxNodes = integerArg(args, "maxNodes", 16, 2, 24);
    const traversal = getLocalGraph(dataset, nodeId!, { maxDepth, maxNodes, includeImplicitSiblings: true });
    const visits = traversal.visits.map((visit) => ({
      ...visit,
      title: nodeById.get(visit.nodeId)?.canonicalName ?? visit.nodeId,
      shortFact: nodeById.get(visit.nodeId)?.shortFact ?? "",
    }));
    return {
      summary: `围绕“${node!.canonicalName}”完成深度 ${maxDepth} 的同层优先 DFS，观察 ${visits.length} 个节点。`,
      output: { visits } as unknown as JsonValue,
    };
  }

  if (name === "search_graph") {
    const query = stringArg(args, "query").toLocaleLowerCase();
    const limit = integerArg(args, "limit", 8, 1, 12);
    const cardText = new Map(dataset.cards.map((card) => [card.nodeId, JSON.stringify(card.blocks)]));
    const terms = query.split(/[\s,，;；]+/).filter((term) => term.length >= 2);
    const matches = dataset.nodes.map((item) => {
      const name = `${item.canonicalName} ${item.aliases.join(" ")}`.toLocaleLowerCase();
      const text = `${name} ${item.shortFact} ${cardText.get(item.id) ?? ""}`.toLocaleLowerCase();
      return { item, score: (name.includes(query) ? 10 : 0) + terms.reduce((score, term) => score + (name.includes(term) ? 4 : text.includes(term) ? 1 : 0), 0) };
    }).filter((entry) => entry.score > 0).sort((a,b) => b.score-a.score).slice(0,limit).map((entry) => entry.item);
    return { summary: `图内搜索“${query}”命中 ${matches.length} 个节点。`, output: matches as unknown as JsonValue };
  }

  if (name === "get_history") {
    const rawIds = args.historyIds;
    const ids = new Set(Array.isArray(rawIds) ? rawIds.filter((value): value is string => typeof value === "string") : []);
    if (!ids.size) throw new Error("historyIds must be explicitly provided.");
    const entries = (dataset.history ?? []).filter((entry) => entry.nodeId === nodeId && ids.has(entry.id)).slice(0, 15);
    return { summary: `按用户指定 ID 读取 ${entries.length} 条历史。`, output: entries as unknown as JsonValue };
  }

  throw new Error(`Unknown knowledge tool: ${name}`);
}
