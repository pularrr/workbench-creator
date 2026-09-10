import type {
  AgentGraphData,
  AppliedWorkflow,
  AuditEvent,
  AuditEventType,
  BuildAgent,
  CommitResult,
  ConversationContext,
  DevelopmentAgent,
  KnowledgeAgent,
  Rejection,
  Revision,
  RevisionRequest,
  ReviewAgent,
  RollbackResult,
  UserConfirmation,
  WorkflowCandidate,
} from "../../core/agent/contracts";
import { InMemoryRevisionStore } from "./revision-store";

type InternalCandidate = WorkflowCandidate & {
  context: ConversationContext;
  internalStatus: "review-failed" | "awaiting-confirmation" | "revision-requested" | "rejected" | "applied";
  commit?: CommitResult;
};

export class OfflineAgentWorkflow {
  private readonly store: InMemoryRevisionStore;
  private readonly candidates = new Map<string, InternalCandidate>();
  private readonly patchToProposal = new Map<string, string>();
  private readonly events: AuditEvent[] = [];

  constructor(
    initial: AgentGraphData,
    private readonly knowledgeAgent: KnowledgeAgent,
    private readonly reviewAgent: ReviewAgent,
    private readonly buildAgent: BuildAgent,
    private readonly developmentAgent: DevelopmentAgent,
  ) {
    this.store = new InMemoryRevisionStore(initial);
  }

  snapshot() { return this.store.snapshot(); }
  revisionHistory() { return this.store.revisionHistory(); }
  rollbackTargets() { return this.store.rollbackTargets(); }
  auditLog(): readonly AuditEvent[] { return structuredClone(this.events); }

  submit(context: ConversationContext): WorkflowCandidate {
    this.audit("conversation.received", "development-agent", { currentNodeId: context.currentNodeId });
    const proposal = this.knowledgeAgent.propose(context, this.store.snapshot());
    return this.processProposal(context, proposal);
  }

  revise(patchId: string, request: RevisionRequest): WorkflowCandidate {
    const previous = this.requireByPatch(patchId);
    if (previous.internalStatus !== "awaiting-confirmation") {
      throw new Error(`Patch ${patchId} is not awaiting a decision.`);
    }
    previous.internalStatus = "revision-requested";
    this.audit("decision.revision-requested", request.requestedBy, { note: request.note }, previous.proposal.id, patchId);
    const proposal = this.knowledgeAgent.revise(previous.proposal, request, this.store.snapshot());
    return this.processProposal(proposal.context, proposal);
  }

  reject(patchId: string, rejection: Rejection): void {
    const candidate = this.requireByPatch(patchId);
    if (candidate.internalStatus !== "awaiting-confirmation") {
      throw new Error(`Patch ${patchId} is not awaiting a decision.`);
    }
    candidate.internalStatus = "rejected";
    this.audit("decision.rejected", rejection.rejectedBy, { note: rejection.note }, candidate.proposal.id, patchId);
  }

  confirm(patchId: string, confirmation: UserConfirmation): AppliedWorkflow {
    const candidate = this.requireByPatch(patchId);
    if (candidate.internalStatus === "applied" && candidate.commit && candidate.patch && candidate.preview) {
      this.audit(
        "revision.idempotent",
        confirmation.confirmedBy,
        { originalRevision: candidate.commit.revision },
        candidate.proposal.id,
        patchId,
      );
      return {
        proposal: candidate.proposal,
        review: candidate.review,
        patch: candidate.patch,
        preview: candidate.preview,
        status: "applied",
        commit: { ...candidate.commit, idempotent: true },
      };
    }
    if (candidate.internalStatus !== "awaiting-confirmation" || !candidate.patch || !candidate.preview) {
      throw new Error(`Patch ${patchId} cannot be confirmed.`);
    }
    const receipt = this.store.authorize("apply", patchId, confirmation);
    this.audit("decision.confirmed", confirmation.confirmedBy, undefined, candidate.proposal.id, patchId);
    try {
      const commit = this.store.apply(candidate.patch, receipt);
      candidate.internalStatus = "applied";
      candidate.commit = commit;
      this.audit("revision.applied", "revision-store", undefined, candidate.proposal.id, patchId, commit.revision, candidate.patch);
      return {
        proposal: candidate.proposal,
        review: candidate.review,
        patch: candidate.patch,
        preview: candidate.preview,
        status: "applied",
        commit,
      };
    } catch (error) {
      this.audit("revision.apply-failed", "revision-store", {
        error: error instanceof Error ? error.message : String(error),
      }, candidate.proposal.id, patchId);
      throw error;
    }
  }

  rollback(targetRevision: Revision, confirmation: UserConfirmation): RollbackResult {
    const receipt = this.store.authorize("rollback", String(targetRevision), confirmation);
    this.audit("decision.confirmed", confirmation.confirmedBy, { action: "rollback", targetRevision });
    const result = this.store.rollback(targetRevision, receipt);
    this.audit("revision.rollback", "revision-store", undefined, undefined, `rollback:${targetRevision}`, result.revision, undefined, targetRevision);
    return result;
  }

  private processProposal(context: ConversationContext, proposal: ReturnType<KnowledgeAgent["propose"]>): WorkflowCandidate {
    this.audit("knowledge.proposed", "knowledge-agent", {
      operationCount: proposal.candidateOperations.length,
      evidenceCount: proposal.evidence.length,
    }, proposal.id);
    const snapshot = this.store.snapshot();
    const review = this.reviewAgent.review(proposal, snapshot);
    this.audit("review.completed", "review-agent", {
      accepted: review.accepted,
      findingCodes: review.findings.map((finding) => finding.code),
    }, proposal.id);
    if (!review.accepted) {
      const failed: InternalCandidate = { proposal, review, status: "review-failed", internalStatus: "review-failed", context };
      this.candidates.set(proposal.id, failed);
      return failed;
    }
    const patch = this.buildAgent.build(proposal, review, snapshot);
    this.audit("build.dry-run", "build-agent", { projectionDiff: patch.projectionDiff }, proposal.id, patch.id);
    const preview = this.developmentAgent.prepare(context, patch, snapshot);
    this.audit("development.previewed", "development-agent", { mode: preview.mode }, proposal.id, patch.id);
    const pending: InternalCandidate = {
      proposal,
      review,
      patch,
      preview,
      status: "awaiting-confirmation",
      internalStatus: "awaiting-confirmation",
      context,
    };
    this.candidates.set(proposal.id, pending);
    this.patchToProposal.set(patch.id, proposal.id);
    return pending;
  }

  private requireByPatch(patchId: string): InternalCandidate {
    const proposalId = this.patchToProposal.get(patchId);
    const candidate = proposalId ? this.candidates.get(proposalId) : undefined;
    if (!candidate) throw new Error(`Unknown patch ${patchId}.`);
    return candidate;
  }

  private audit(
    type: AuditEventType,
    actor: string,
    details?: Readonly<Record<string, unknown>>,
    proposalId?: string,
    patchId?: string,
    revision = this.store.snapshot().revision,
    patch?: AuditEvent["patch"],
    rollbackTargetRevision?: Revision,
  ): void {
    this.events.push({
      sequence: this.events.length + 1,
      at: new Date().toISOString(),
      type,
      actor,
      revision,
      ...(proposalId ? { proposalId } : {}),
      ...(patchId ? { patchId } : {}),
      ...(details ? { details } : {}),
      ...(patch ? { patch: structuredClone(patch) } : {}),
      ...(rollbackTargetRevision !== undefined ? { rollbackTargetRevision } : {}),
    });
  }
}
