import type {
  AgentGraphSnapshot,
  BuildAgent,
  ConversationContext,
  DevelopmentAgent,
  DevelopmentPreview,
  EvidenceRecord,
  GraphOperation,
  GraphPatch,
  KnowledgeAgent,
  KnowledgeProposal,
  RevisionRequest,
  ReviewAgent,
  ReviewFinding,
  ReviewReport,
} from "./contracts";
import { applyOperations, createProjectionDiff, deterministicId } from "./graph-operations";

const allowedEdgeTypes = new Set([
  "SIMILAR_TO", "ALTERNATIVE_TO", "PREREQUISITE_OF", "PART_OF", "INPUT_TO",
  "OUTPUT_OF", "USES_MODEL", "IMPLEMENTS", "DERIVED_FROM", "AFFECTS",
  "MITIGATES", "EVALUATED_BY",
]);

export type OfflineProposalFactory = (
  context: ConversationContext,
  snapshot: AgentGraphSnapshot,
  previous?: KnowledgeProposal,
) => {
  summary: string;
  rationale: string;
  evidence: readonly EvidenceRecord[];
  operations: readonly GraphOperation[];
};

export class OfflineKnowledgeAgent implements KnowledgeAgent {
  private sequence = 0;

  constructor(private readonly factory: OfflineProposalFactory) {}

  propose(context: ConversationContext, snapshot: AgentGraphSnapshot): KnowledgeProposal {
    return this.create(context, snapshot);
  }

  revise(
    previous: KnowledgeProposal,
    request: RevisionRequest,
    snapshot: AgentGraphSnapshot,
  ): KnowledgeProposal {
    const context = {
      ...previous.context,
      conversationSummary: `${previous.context.conversationSummary}\nRevision requested: ${request.note}`,
    };
    return this.create(context, snapshot, previous);
  }

  private create(
    context: ConversationContext,
    snapshot: AgentGraphSnapshot,
    previous?: KnowledgeProposal,
  ): KnowledgeProposal {
    const candidate = this.factory(context, snapshot, previous);
    this.sequence += 1;
    return {
      id: `offline-proposal-${snapshot.revision}-${this.sequence}`,
      baseRevision: snapshot.revision,
      context: structuredClone(context),
      summary: candidate.summary,
      rationale: candidate.rationale,
      evidence: structuredClone(candidate.evidence),
      candidateOperations: structuredClone(candidate.operations),
      createdAt: new Date().toISOString(),
      createdBy: "knowledge-agent",
      ...(previous ? { supersedesProposalId: previous.id } : {}),
    };
  }
}

const parentOf = (node: { parentId?: string | null; primaryParentId?: string | null }) =>
  node.primaryParentId ?? node.parentId ?? undefined;

export class OfflineReviewAgent implements ReviewAgent {
  review(proposal: KnowledgeProposal, snapshot: AgentGraphSnapshot): ReviewReport {
    const findings: ReviewFinding[] = [];
    if (proposal.baseRevision !== snapshot.revision) {
      findings.push({ code: "STALE_BASE", severity: "error", message: "Proposal base revision is stale." });
    }
    if (!proposal.context.conversationSummary.trim()) {
      findings.push({ code: "SUMMARY_REQUIRED", severity: "error", message: "Conversation summary is required." });
    }
    if (proposal.candidateOperations.length === 0) {
      findings.push({ code: "EMPTY_PROPOSAL", severity: "error", message: "Proposal has no candidate operations." });
    }
    if (proposal.candidateOperations.some((operation) => operation.kind.startsWith("upsert-")) && proposal.evidence.length === 0) {
      findings.push({ code: "EVIDENCE_REQUIRED", severity: "error", message: "Knowledge changes require at least one evidence record." });
    }
    const evidenceIds = new Set<string>();
    for (const evidence of proposal.evidence) {
      if (evidenceIds.has(evidence.id)) {
        findings.push({ code: "DUPLICATE_EVIDENCE", severity: "error", message: `Evidence ${evidence.id} is duplicated.` });
      }
      evidenceIds.add(evidence.id);
    }

    const operationTargets = new Set<string>();
    proposal.candidateOperations.forEach((operation, operationIndex) => {
      const target = this.targetOf(operation);
      if (operationTargets.has(target)) {
        findings.push({
          code: "DUPLICATE_OPERATION_TARGET",
          severity: "error",
          message: `Multiple operations target ${target}.`,
          operationIndex,
        });
      }
      operationTargets.add(target);
      if (operation.kind === "upsert-edge" && !operation.edge.rationale?.trim()) {
        findings.push({
          code: "EDGE_RATIONALE_REQUIRED",
          severity: "error",
          message: `Edge ${operation.edge.id} needs a rationale.`,
          operationIndex,
        });
      }
      if (operation.kind === "upsert-edge" && !allowedEdgeTypes.has(operation.edge.type)) {
        findings.push({
          code: "INVALID_EDGE_TYPE",
          severity: "error",
          message: `Edge ${operation.edge.id} has unsupported type ${operation.edge.type}.`,
          operationIndex,
        });
      }
    });

    const projected = applyOperations(snapshot, proposal.candidateOperations);
    const nodes = new Map(projected.nodes.map((node) => [node.id, node]));
    for (const edge of projected.edges) {
      if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) {
        findings.push({ code: "DANGLING_EDGE", severity: "error", message: `Edge ${edge.id} has a missing endpoint.` });
      }
      if (edge.sourceId === edge.targetId) {
        findings.push({ code: "SELF_EDGE", severity: "error", message: `Edge ${edge.id} is a self-edge.` });
      }
    }
    for (const card of projected.cards) {
      if (!nodes.has(card.nodeId)) {
        findings.push({ code: "ORPHAN_CARD", severity: "error", message: `Card ${card.nodeId} has no node.` });
      }
    }
    const formulaIds = new Set((projected.formulas ?? []).map((formula) => formula.id));
    const evidenceIdsInGraph = new Set((projected.evidence ?? []).map((item) => item.id));
    const assetIds = new Set((projected.assets ?? []).map((asset) => asset.id));
    const sourceIds = new Set((projected.sources ?? []).map((source) => source.id));
    for (const formula of projected.formulas ?? []) {
      if (!nodes.has(formula.nodeId)) findings.push({ code: "ORPHAN_FORMULA", severity: "error", message: `Formula ${formula.id} has no node.` });
      if (!formula.latex.trim() || !formula.symbols.length) findings.push({ code: "INCOMPLETE_FORMULA", severity: "error", message: `Formula ${formula.id} needs LaTeX and symbols.` });
    }
    for (const card of projected.cards) {
      for (const formulaId of card.formulaIds ?? []) {
        if (!formulaIds.has(formulaId)) findings.push({ code: "UNKNOWN_CARD_FORMULA", severity: "error", message: `Card ${card.nodeId} references ${formulaId}.` });
      }
      for (const evidenceId of card.evidenceIds ?? []) {
        if (!evidenceIdsInGraph.has(evidenceId)) findings.push({ code: "UNKNOWN_CARD_EVIDENCE", severity: "error", message: `Card ${card.nodeId} references ${evidenceId}.` });
      }
    }
    for (const item of projected.evidence ?? []) {
      if (item.assetId && !assetIds.has(item.assetId)) findings.push({ code: "UNKNOWN_EVIDENCE_ASSET", severity: "error", message: `Evidence ${item.id} references ${item.assetId}.` });
    }
    for (const claim of projected.claims ?? []) {
      if (!sourceIds.has(claim.artifactId)) findings.push({ code: "UNKNOWN_CLAIM_SOURCE", severity: "error", message: `Claim ${claim.id} references ${claim.artifactId}.` });
    }
    for (const node of projected.nodes) {
      const parentId = parentOf(node);
      if (parentId && !nodes.has(parentId)) {
        findings.push({ code: "MISSING_PARENT", severity: "error", message: `Node ${node.id} has missing parent ${parentId}.` });
      }
      const visited = new Set<string>();
      let cursor = node;
      while (cursor) {
        if (visited.has(cursor.id)) {
          findings.push({ code: "HIERARCHY_CYCLE", severity: "error", message: `Hierarchy cycle starts at ${node.id}.` });
          break;
        }
        visited.add(cursor.id);
        const cursorParent = parentOf(cursor);
        if (!cursorParent) break;
        const next = nodes.get(cursorParent);
        if (!next) break;
        cursor = next;
      }
    }
    if (proposal.context.currentNodeId && !nodes.has(proposal.context.currentNodeId)) {
      findings.push({
        code: "CURRENT_NODE_MISSING",
        severity: "error",
        message: `Current node ${proposal.context.currentNodeId} does not exist in the projected graph.`,
      });
    }

    return {
      proposalId: proposal.id,
      baseRevision: proposal.baseRevision,
      accepted: !findings.some((finding) => finding.severity === "error"),
      findings,
      reviewedAt: new Date().toISOString(),
      reviewedBy: "review-agent",
    };
  }

  private targetOf(operation: GraphOperation): string {
    switch (operation.kind) {
      case "upsert-node": return `node:${operation.node.id}`;
      case "remove-node": return `node:${operation.nodeId}`;
      case "upsert-edge": return `edge:${operation.edge.id}`;
      case "remove-edge": return `edge:${operation.edgeId}`;
      case "upsert-card": return `card:${operation.card.nodeId}`;
      case "remove-card": return `card:${operation.nodeId}`;
      case "upsert-formula": return `formula:${operation.formula.id}`;
      case "remove-formula": return `formula:${operation.formulaId}`;
      case "upsert-evidence": return `evidence:${operation.evidence.id}`;
      case "remove-evidence": return `evidence:${operation.evidenceId}`;
      case "upsert-asset": return `asset:${operation.asset.id}`;
      case "remove-asset": return `asset:${operation.assetId}`;
      case "upsert-source": return `source:${operation.source.id}`;
      case "upsert-claim": return `claim:${operation.claim.id}`;
      case "append-history": return `history:${operation.entry.id}`;
    }
  }
}

export class OfflineBuildAgent implements BuildAgent {
  build(
    proposal: KnowledgeProposal,
    review: ReviewReport,
    snapshot: AgentGraphSnapshot,
  ): GraphPatch {
    if (!review.accepted || review.proposalId !== proposal.id) {
      throw new Error("Build requires an accepted review for the same proposal.");
    }
    if (proposal.baseRevision !== snapshot.revision) {
      throw new Error("Build requires the proposal base revision to match the snapshot.");
    }
    const projected = applyOperations(snapshot, proposal.candidateOperations);
    const identity = {
      proposalId: proposal.id,
      baseRevision: proposal.baseRevision,
      operations: proposal.candidateOperations,
      evidence: proposal.evidence,
    };
    return {
      id: deterministicId("graph-patch", identity),
      proposalId: proposal.id,
      baseRevision: proposal.baseRevision,
      summary: proposal.summary,
      rationale: proposal.rationale,
      evidence: structuredClone(proposal.evidence),
      operations: structuredClone(proposal.candidateOperations),
      projectionDiff: createProjectionDiff(snapshot, projected, proposal.context.currentNodeId),
      builtBy: "build-agent",
    };
  }
}

export class OfflineDevelopmentAgent implements DevelopmentAgent {
  prepare(
    context: ConversationContext,
    patch: GraphPatch,
    _snapshot: AgentGraphSnapshot,
  ): DevelopmentPreview {
    return {
      patchId: patch.id,
      ...(context.currentNodeId ? { currentNodeId: context.currentNodeId } : {}),
      mode: "offline",
      status: "awaiting-confirmation",
      projectionDiff: structuredClone(patch.projectionDiff),
      preparedAt: new Date().toISOString(),
    };
  }
}
