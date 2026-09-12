import { deterministicId } from "../agent/graph-operations";
import type { KnowledgeCollectionKind } from "../knowledge/schema";
import type {
  ContentSegment,
  ExtractedKnowledgeClaim,
  KnowledgeMatchCandidate,
  SourceArtifact,
  SourceKind,
  StagedKnowledgeImport,
} from "./contracts";

const applicationWords = /工程|应用|部署|实时|硬件|复杂度|误差|失效|验证|场景|implementation|application/i;
const otherWords = /研究|探索|最新|论文|实验性|趋势|热点|research|future/i;

function classify(text: string): KnowledgeCollectionKind {
  if (otherWords.test(text)) return "other";
  if (applicationWords.test(text)) return "application";
  return "theory";
}

function short(text: string, length = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

export function stageTextImport(input: {
  kind: Extract<SourceKind, "conversation" | "summary" | "paper" | "document">;
  title: string;
  text: string;
  suppliedBy: string;
  currentNodeId?: string;
  suppliedAt?: string;
}): StagedKnowledgeImport {
  const normalized = input.text.replace(/\r\n/g, "\n").trim();
  if (!normalized) throw new Error("Source text is required.");
  const checksum = deterministicId("content", normalized);
  const artifact: SourceArtifact = {
    id: deterministicId("artifact", { kind: input.kind, title: input.title, checksum }),
    title: input.title,
    kind: input.kind,
    modality: input.kind === "document" ? "document" : "text",
    mimeType: input.kind === "paper" || input.kind === "document" ? "text/plain" : "text/markdown",
    checksum,
    suppliedAt: input.suppliedAt ?? new Date().toISOString(),
    suppliedBy: input.suppliedBy,
  };
  const paragraphs = normalized.split(/\n\s*\n|(?<=[。！？.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const segments: ContentSegment[] = paragraphs.map((text, order) => ({
    id: `${artifact.id}:segment:${order + 1}`,
    artifactId: artifact.id,
    order,
    text,
    locator: `paragraph:${order + 1}`,
  }));
  const claims: ExtractedKnowledgeClaim[] = segments.slice(0, 24).map((segment) => ({
    id: deterministicId("claim", { artifactId: artifact.id, text: segment.text }),
    artifactId: artifact.id,
    segmentIds: [segment.id],
    statement: segment.text,
    shortSummary: short(segment.text),
    suggestedCollection: classify(segment.text),
    ...(input.currentNodeId ? { nodeHint: input.currentNodeId } : {}),
    confidence: input.kind === "summary" ? 0.72 : 0.58,
  }));
  const matches: KnowledgeMatchCandidate[] = claims.map((claim) => ({
    claimId: claim.id,
    ...(input.currentNodeId ? { matchedNodeId: input.currentNodeId } : {}),
    score: input.currentNodeId ? 0.7 : 0,
    rationale: input.currentNodeId
      ? "输入带有当前节点上下文；仍需知识检索 Agent 核对实体与关系。"
      : "输入未绑定节点，需要知识检索 Agent 检索实体后决定。",
    decision: input.currentNodeId ? "append-card" : "needs-review",
  }));
  return { artifact, segments, claims, matches, status: "awaiting-agent-review" };
}

export function createExternalMediaArtifact(input: {
  kind: Extract<SourceKind, "image" | "audio" | "video" | "document">;
  title: string;
  mimeType: string;
  storageRef: string;
  checksum: string;
  suppliedBy: string;
  suppliedAt?: string;
}): SourceArtifact {
  if (!input.storageRef.trim() || !input.checksum.trim()) throw new Error("Media requires a storage reference and checksum.");
  return {
    id: deterministicId("artifact", { kind: input.kind, storageRef: input.storageRef, checksum: input.checksum }),
    title: input.title,
    kind: input.kind,
    modality: input.kind,
    mimeType: input.mimeType,
    storageRef: input.storageRef,
    checksum: input.checksum,
    suppliedAt: input.suppliedAt ?? new Date().toISOString(),
    suppliedBy: input.suppliedBy,
  };
}
