import type {
  CardBlock,
  EdgeType,
  KnowledgeAsset,
  KnowledgeEvidence,
  KnowledgeFormula,
  KnowledgeHistoryEntry,
  SemanticDomain,
} from "../knowledge/schema";
import type { ExtractedKnowledgeClaim, SourceArtifact } from "../ingestion/contracts";

export type Revision = number;

export interface AgentNodeRecord {
  id: string;
  title?: string;
  canonicalName?: string;
  parentId?: string | null;
  primaryParentId?: string | null;
  shortFact?: string;
  aliases?: readonly string[];
  nodeType?: string;
  domainId?: string;
  visualBranch?: string;
  level?: number;
  order?: number;
  tags?: readonly string[];
  status?: string;
}

export interface AgentEdgeRecord {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  rationale?: string;
  evidenceIds?: readonly string[];
}

export interface AgentCardRecord {
  nodeId: string;
  headline?: string;
  blocks?: readonly CardBlock[];
  formulaIds?: readonly string[];
  evidenceIds?: readonly string[];
  revision?: number;
  /** Compatibility field accepted from early offline fixtures. */
  definition?: string;
}

export interface AgentGraphData {
  nodes: readonly AgentNodeRecord[];
  edges: readonly AgentEdgeRecord[];
  cards: readonly AgentCardRecord[];
  domains?: readonly SemanticDomain[];
  formulas?: readonly KnowledgeFormula[];
  history?: readonly KnowledgeHistoryEntry[];
  evidence?: readonly KnowledgeEvidence[];
  assets?: readonly KnowledgeAsset[];
  sources?: readonly SourceArtifact[];
  claims?: readonly ExtractedKnowledgeClaim[];
}

export interface AgentGraphSnapshot extends AgentGraphData {
  revision: Revision;
}

export interface ConversationContext {
  conversationSummary: string;
  currentNodeId?: string;
  query?: string;
  retrievedNodeIds?: readonly string[];
}

export interface EvidenceRecord {
  id: string;
  title: string;
  source: string;
  locator?: string;
  note?: string;
}

export type GraphOperation =
  | { readonly kind: "upsert-node"; readonly node: AgentNodeRecord }
  | { readonly kind: "remove-node"; readonly nodeId: string }
  | { readonly kind: "upsert-edge"; readonly edge: AgentEdgeRecord }
  | { readonly kind: "remove-edge"; readonly edgeId: string }
  | { readonly kind: "upsert-card"; readonly card: AgentCardRecord }
  | { readonly kind: "remove-card"; readonly nodeId: string }
  | { readonly kind: "upsert-formula"; readonly formula: KnowledgeFormula }
  | { readonly kind: "remove-formula"; readonly formulaId: string }
  | { readonly kind: "upsert-evidence"; readonly evidence: KnowledgeEvidence }
  | { readonly kind: "remove-evidence"; readonly evidenceId: string }
  | { readonly kind: "upsert-asset"; readonly asset: KnowledgeAsset }
  | { readonly kind: "remove-asset"; readonly assetId: string }
  | { readonly kind: "upsert-source"; readonly source: SourceArtifact }
  | { readonly kind: "upsert-claim"; readonly claim: ExtractedKnowledgeClaim }
  | { readonly kind: "append-history"; readonly entry: KnowledgeHistoryEntry };

export interface KnowledgeProposal {
  id: string;
  baseRevision: Revision;
  context: ConversationContext;
  summary: string;
  rationale: string;
  evidence: readonly EvidenceRecord[];
  candidateOperations: readonly GraphOperation[];
  createdAt: string;
  createdBy: "knowledge-agent";
  supersedesProposalId?: string;
}

export type ReviewSeverity = "error" | "warning";

export interface ReviewFinding {
  code: string;
  severity: ReviewSeverity;
  message: string;
  operationIndex?: number;
}

export interface ReviewReport {
  proposalId: string;
  baseRevision: Revision;
  accepted: boolean;
  findings: readonly ReviewFinding[];
  reviewedAt: string;
  reviewedBy: "review-agent";
}

export interface ProjectionDiff {
  nodes: EntityDiff;
  edges: EntityDiff;
  cards: EntityDiff;
  formulas: EntityDiff;
  evidence: EntityDiff;
  assets: EntityDiff;
  sources: EntityDiff;
  claims: EntityDiff;
  history: EntityDiff;
  /** Ordered, bounded candidates for a future SVG projection. */
  visibleNodeIds: readonly string[];
}

export interface EntityDiff {
  added: readonly string[];
  updated: readonly string[];
  removed: readonly string[];
}

export interface GraphPatch {
  id: string;
  proposalId: string;
  baseRevision: Revision;
  summary: string;
  rationale: string;
  evidence: readonly EvidenceRecord[];
  operations: readonly GraphOperation[];
  projectionDiff: ProjectionDiff;
  builtBy: "build-agent";
}

export interface DevelopmentPreview {
  patchId: string;
  currentNodeId?: string;
  mode: "offline" | "online";
  status: "awaiting-confirmation";
  projectionDiff: ProjectionDiff;
  preparedAt: string;
}

export interface UserConfirmation {
  confirmed: true;
  confirmedBy: string;
  confirmedAt?: string;
  note?: string;
}

export interface RevisionRequest {
  requestedBy: string;
  note: string;
  requestedAt?: string;
}

export interface Rejection {
  rejectedBy: string;
  note?: string;
  rejectedAt?: string;
}

export interface CommitResult {
  patchId: string;
  previousRevision: Revision;
  revision: Revision;
  appliedAt: string;
  idempotent: boolean;
}

export interface WorkflowCandidate {
  proposal: KnowledgeProposal;
  review: ReviewReport;
  patch?: GraphPatch;
  preview?: DevelopmentPreview;
  status: "review-failed" | "awaiting-confirmation";
}

export interface AppliedWorkflow {
  proposal: KnowledgeProposal;
  review: ReviewReport;
  patch: GraphPatch;
  preview: DevelopmentPreview;
  status: "applied";
  commit: CommitResult;
}

export interface RollbackResult {
  restoredFromRevision: Revision;
  previousRevision: Revision;
  revision: Revision;
  appliedAt: string;
}

export interface ConfirmationReceipt {
  action: "apply" | "rollback";
  subject: string;
  confirmedBy: string;
  confirmedAt: string;
  nonce: string;
}

export type AuditEventType =
  | "conversation.received"
  | "knowledge.proposed"
  | "review.completed"
  | "build.dry-run"
  | "development.previewed"
  | "decision.confirmed"
  | "decision.revision-requested"
  | "decision.rejected"
  | "revision.applied"
  | "revision.idempotent"
  | "revision.apply-failed"
  | "revision.rollback";

export interface AuditEvent {
  sequence: number;
  at: string;
  type: AuditEventType;
  actor: string;
  revision: Revision;
  proposalId?: string;
  patchId?: string;
  details?: Readonly<Record<string, unknown>>;
  /** Present only for mutation events so the graph can be replayed. */
  patch?: GraphPatch;
  rollbackTargetRevision?: Revision;
}

export interface KnowledgeAgent {
  propose(context: ConversationContext, snapshot: AgentGraphSnapshot): KnowledgeProposal;
  revise(
    previous: KnowledgeProposal,
    request: RevisionRequest,
    snapshot: AgentGraphSnapshot,
  ): KnowledgeProposal;
}

export interface ReviewAgent {
  review(proposal: KnowledgeProposal, snapshot: AgentGraphSnapshot): ReviewReport;
}

export interface BuildAgent {
  build(
    proposal: KnowledgeProposal,
    review: ReviewReport,
    snapshot: AgentGraphSnapshot,
  ): GraphPatch;
}

export interface DevelopmentAgent {
  prepare(
    context: ConversationContext,
    patch: GraphPatch,
    snapshot: AgentGraphSnapshot,
  ): DevelopmentPreview;
}
