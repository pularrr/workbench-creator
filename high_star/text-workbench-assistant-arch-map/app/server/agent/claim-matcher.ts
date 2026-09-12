import type { LlmProvider } from "../../core/llm/contracts";
import type { KnowledgeDataset } from "../../core/knowledge/schema";
import type { KnowledgeMatchCandidate, StagedKnowledgeImport } from "../../core/ingestion/contracts";
import { executeKnowledgeTool } from "./knowledge-tools";

const MATCH_DECISIONS = ["append-card", "create-node", "create-relation", "needs-review"] as const;
type MatchDecision = (typeof MATCH_DECISIONS)[number];

type ClaimMatchResult = {
  claimId?: string;
  decision?: MatchDecision;
  matchedNodeId?: string | null;
  score?: number;
  rationale?: string;
  proposedRelationType?: string;
  proposedTargetNodeId?: string | null;
};

const SEARCH_TOOL = {
  name: "search_graph",
  description: "按名称、别名、短事实和卡片正文搜索现有图谱，避免重复建点。",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 12 } },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

/**
 * P3-3 matching enhancement: instead of the hard-coded "append-card when a
 * node hint exists" rule in stageTextImport, run a real LLM + graph-retrieval
 * pass over the staged claims.
 *
 * Flow:
 *  1. Ask the model to propose search queries for the claims.
 *  2. Run those searches against the real graph (read-only tools).
 *  3. Feed the retrieval results back and ask for a final per-claim decision
 *     (append-card / create-node / create-relation / needs-review), grounded
 *     in what the graph actually contains.
 *
 * On any failure we fail-open to the staged matches so ingestion is never
 * blocked by the enhancement itself.
 */
export async function matchClaimsToGraph(
  provider: LlmProvider,
  dataset: KnowledgeDataset,
  staged: StagedKnowledgeImport,
  currentNodeId: string,
): Promise<readonly KnowledgeMatchCandidate[]> {
  if (staged.claims.length === 0) return staged.matches;
  const currentName = dataset.nodes.find((n) => n.id === currentNodeId)?.canonicalName ?? currentNodeId;

  const claimsJson = staged.claims.slice(0, 10).map((claim, index) => ({
    index,
    id: claim.id,
    statement: claim.statement.slice(0, 500),
    nodeHint: claim.nodeHint ?? null,
  }));

  // Phase 1: decide what to search for.
  let searchQueries: string[] = [];
  try {
    const searchPlan = await provider.createResponse({
      instructions: `你是知识检索 Agent。面对一批外部资料声明，先规划如何在知识图谱中检索验证。图谱中的节点表达 FMCW 雷达领域概念（如"FMCW雷达"、"MIMO"、"距离分辨率"、"恒虚警检测"等）。\n只输出一个 JSON 数组，不要 Markdown：\n["检索词1","检索词2",...]\n最多 5 个检索词，覆盖声明中的核心实体。`,
      messages: [{ role: "user", content: `当前节点：${currentName}（id=${currentNodeId}）\n待检索声明：\n${JSON.stringify(claimsJson)}` }],
      tools: [],
      maxOutputTokens: 1_024,
    });
    const parsed = parseStringArray(searchPlan.text);
    if (parsed.length) searchQueries = parsed.slice(0, 5);
  } catch {
    searchQueries = [];
  }

  // Phase 2: run the searches against the actual graph.
  const retrievalResults: string[] = [];
  const seen = new Set<string>();
  for (const query of searchQueries) {
    if (seen.has(query) || !query.trim()) continue;
    seen.add(query);
    try {
      const result = executeKnowledgeTool(dataset, "search_graph", { query, limit: 8 });
      retrievalResults.push(`${query} → ${result.summary}\n${JSON.stringify(result.output).slice(0, 1200)}`);
    } catch {
      // Ignore failed individual queries.
    }
  }
  if (retrievalResults.length === 0) {
    // Fall back to a search anchored on the current node name.
    try {
      const result = executeKnowledgeTool(dataset, "search_graph", { query: currentName, limit: 8 });
      retrievalResults.push(`${currentName} → ${result.summary}\n${JSON.stringify(result.output).slice(0, 1200)}`);
    } catch {
      // Nothing retrieved; final decision must rely on the model's own judgment.
    }
  }

  // Phase 3: final grounded decision per claim.
  let finalText = "";
  try {
    const decision = await provider.createResponse({
      instructions: `你是知识检索 Agent。以下是待判定声明和已检索到的图谱内容。请基于检索结果判断每条声明如何在图谱中落地：
- append-card：图谱已有表达该知识的节点，声明是对它的补充，应续写其知识卡；
- create-node：图谱中没有表达该知识的节点，需要创建新节点；
- create-relation：声明表达两个已有节点之间的关系；
- needs-review：无法确定或证据不足。

严格只输出一个 JSON 对象（不要 Markdown）：
{"results":[{"claimId":"声明ID","decision":"append-card|create-node|create-relation|needs-review","matchedNodeId":"已有节点ID或null","score":0-1,"rationale":"一句话理由","proposedRelationType":"仅create-relation时填，如IMPLEMENTS|DEPENDS_ON|SIMILAR_TO","proposedTargetNodeId":"仅create-relation时填目标节点ID"}]}

matchedNodeId 必须来自下方图谱内容中的真实节点 id；图谱检索不到相关内容时 matchedNodeId 用 null 且 decision 用 needs-review。不要编造不存在的节点 ID。`,
      messages: [{
        role: "user",
        content: `当前节点：${currentName}（id=${currentNodeId}）\n\n【待判定声明】\n${JSON.stringify(claimsJson)}\n\n【图谱检索结果】\n${retrievalResults.join("\n\n")}\n\n请给出最终判定 JSON。`,
      }],
      tools: [],
      maxOutputTokens: 4_096,
    });
    finalText = decision.text;
  } catch {
    return staged.matches;
  }

  const parsed = parseResults(finalText);
  if (!parsed) return staged.matches;

  const candidates: KnowledgeMatchCandidate[] = parsed
    .map((item: ClaimMatchResult) => {
      const claim = staged.claims.find((c) => c.id === item.claimId);
      if (!claim) return null;
      const decision = MATCH_DECISIONS.includes(item.decision as MatchDecision)
        ? (item.decision as MatchDecision)
        : "needs-review";
      const matchedNodeId = typeof item.matchedNodeId === "string" && dataset.nodes.some((n) => n.id === item.matchedNodeId)
        ? item.matchedNodeId
        : (claim.nodeHint ?? undefined);
      return {
        claimId: claim.id,
        ...(matchedNodeId ? { matchedNodeId } : {}),
        score: typeof item.score === "number" && item.score >= 0 && item.score <= 1 ? item.score : 0.5,
        rationale: (item.rationale ?? "图谱匹配判定").slice(0, 200),
        decision,
        ...(decision === "create-relation" && typeof item.proposedRelationType === "string"
          ? { proposedRelationType: item.proposedRelationType.slice(0, 32) }
          : {}),
        ...(decision === "create-relation" && typeof item.proposedTargetNodeId === "string"
          ? { proposedTargetNodeId: item.proposedTargetNodeId }
          : {}),
      } as KnowledgeMatchCandidate;
    })
    .filter((item: KnowledgeMatchCandidate | null): item is KnowledgeMatchCandidate => item !== null);

  return candidates.length > 0 ? candidates : staged.matches;
}

function parseStringArray(text: string): string[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  if (!candidate || !candidate.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
  return [];
}

function parseResults(text: string): ClaimMatchResult[] | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate || !candidate.trim()) return undefined;
  try {
    const parsed = JSON.parse(candidate) as { results?: unknown[] };
    return Array.isArray(parsed.results) ? (parsed.results as ClaimMatchResult[]) : undefined;
  } catch {
    return undefined;
  }
}
