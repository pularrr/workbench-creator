import { getLocalGraph } from "../../../core/knowledge/traversal";
import { assessCardCoverage } from "../../../core/knowledge/card-section-catalog";
import type { TraversalReason } from "../../../core/knowledge/schema";
import { expandedKnowledgeDataset } from "../../../data/knowledge/initial-dataset";

const reasonLabels: Record<TraversalReason, string> = {
  anchor: "当前节点",
  similar: "相似方法",
  alternative: "替代方案",
  sibling: "同层知识",
  child: "子问题",
  prerequisite: "前置知识",
  dependent: "依赖此项",
  dependency: "依赖知识",
  input: "输入知识",
  downstream: "下游用途",
  output: "输出结果",
  producer: "产生来源",
};

export type DeepSearchCandidate = { nodeId: string; title: string; reason: string; summary: string };

export type DeepSearchReport = {
  nodeId: string;
  title: string;
  coverage: { present: number; total: number; missing: string[] };
  candidates: DeepSearchCandidate[];
  recommendations: string[];
  proposalSummary: string;
};

export type AgentUiMessage =
  | { id: string; kind: "answer"; label: "当前知识回答"; text: string }
  | { id: string; kind: "conversation_summary"; label: "对话知识摘要"; text: string }
  | { id: string; kind: "knowledge_candidate"; label: "待审查内容"; text: string; report: DeepSearchReport };

export function runOfflineDeepSearch(nodeId: string): DeepSearchReport {
  const node = expandedKnowledgeDataset.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Unknown knowledge node: ${nodeId}`);
  const card = expandedKnowledgeDataset.cards.find((item) => item.nodeId === nodeId);
  const coverage = assessCardCoverage(node, card);
  const missing = coverage.missing;
  const local = getLocalGraph(expandedKnowledgeDataset, nodeId, {
    maxDepth: 2,
    maxNodes: 16,
    includeImplicitSiblings: true,
  });
  const nodeById = new Map(expandedKnowledgeDataset.nodes.map((item) => [item.id, item]));
  const candidates = local.visits.slice(1).map((visit) => ({
    nodeId: visit.nodeId,
    title: nodeById.get(visit.nodeId)?.canonicalName ?? visit.nodeId,
    reason: reasonLabels[visit.reason],
    summary: expandedKnowledgeDataset.cards.find((item) => item.nodeId === visit.nodeId)?.headline
      ?? nodeById.get(visit.nodeId)?.shortFact
      ?? "",
  }));
  const directEdges = expandedKnowledgeDataset.edges.filter(
    (edge) => edge.sourceId === nodeId || edge.targetId === nodeId,
  );
  const explicitPeers = directEdges.filter(
    (edge) => edge.type === "SIMILAR_TO" || edge.type === "ALTERNATIVE_TO",
  );
  const children = expandedKnowledgeDataset.nodes.filter((item) => item.primaryParentId === nodeId);
  const recommendations = [
    ...(explicitPeers.length === 0 ? ["检索同一问题下的相似方法与替代方案，并补充可比较条件。"] : []),
    ...(children.length === 0 ? ["检索教材式子章节、工程子问题和常用解决方案。"] : []),
    ...(missing.length ? [`优先补齐卡片维度：${missing.slice(0, 5).join("、")}。`] : []),
    "核对新增关系的层级、方向、依据与输入输出语义，再交由 Review Agent 审查。",
  ];

  return {
    nodeId,
    title: node.canonicalName,
    coverage: { present: coverage.present, total: coverage.total, missing },
    candidates,
    recommendations,
    proposalSummary: `围绕“${node.canonicalName}”形成 ${candidates.length} 个邻域参考和 ${missing.length} 个卡片缺口；结果仅作为待审查构建候选。`,
  };
}

export function answerFromCurrentKnowledge(nodeId: string, query: string): string {
  const node = expandedKnowledgeDataset.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Unknown knowledge node: ${nodeId}`);
  const card = expandedKnowledgeDataset.cards.find((item) => item.nodeId === nodeId);
  const normalized = query.trim().toLocaleLowerCase();
  const words = normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]/g) ?? [];
  const tokens = [...new Set(words.filter((token) => token.length > 1 || /[\u3400-\u9fff]/.test(token)))];
  const blocks = card?.blocks ?? [];
  const ranked = blocks
    .map((block, index) => {
      const haystack = `${block.title} ${block.text ?? ""} ${(block.items ?? []).join(" ")}`.toLocaleLowerCase();
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { block, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const relevant = ranked.filter((item) => item.score > 0);
  const selected = (relevant.length ? relevant : ranked).slice(0, 3).map((item) => item.block);
  const detail = selected
    .flatMap((block) => [block.text, ...(block.items ?? [])])
    .filter(Boolean)
    .slice(0, 4)
    .join("；");
  const sources = selected.map((block) => block.title).join("、");
  return `${card?.headline ?? node.shortFact}${detail ? ` ${detail}` : ""}【当前卡片来源：${sources}】`;
}

export function summarizeCurrentConversation(
  nodeId: string,
  query: string,
  messages: readonly AgentUiMessage[],
): string {
  const node = expandedKnowledgeDataset.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Unknown knowledge node: ${nodeId}`);
  const latestAnswer = [...messages].reverse().find((message) => message.kind === "answer");
  const latestCandidate = [...messages].reverse().find((message) => message.kind === "knowledge_candidate");
  const topic = query.trim() ? `用户围绕“${query.trim().slice(0, 48)}”进行了提问` : "当前尚无用户问题";
  const answerNote = latestAnswer ? `已从“${node.canonicalName}”现有卡片提取相关回答` : "尚未形成普通回答";
  const candidateNote = latestCandidate
    ? `并识别 ${latestCandidate.report.coverage.missing.length} 个卡片缺口、${latestCandidate.report.candidates.length} 个邻域参考`
    : "尚未生成图谱构建候选";
  return `${topic}；${answerNote}，${candidateNote}。该短摘要可交由知识检索 Agent 继续判断是否更新节点、关系或卡片。`;
}
