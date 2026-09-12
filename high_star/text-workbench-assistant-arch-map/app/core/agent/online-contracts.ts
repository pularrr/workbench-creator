import type { GraphOperation, ProjectionDiff, ReviewFinding } from "./contracts";
import type { CodeCitation } from "../codegraph/schema";

export interface AgentObservationView {
  round: number;
  tool: string;
  summary: string;
}

export interface PendingChangeView {
  runId: string;
  proposalId: string;
  patchId: string;
  summary: string;
  rationale: string;
  operations: readonly GraphOperation[];
  projectionDiff: ProjectionDiff;
  findings: readonly ReviewFinding[];
  confirmationToken: string;
  confirmationExpiresAt: number;
}

export interface AgentInteractionResult {
  runId: string;
  mode: "online" | "offline";
  provider?: string;
  model?: string;
  text: string;
  observations: readonly AgentObservationView[];
  candidate?: PendingChangeView;
  warning?: string;
  /** Present only when the user explicitly enabled source interpretation. */
  codeCitations?: readonly CodeCitation[];
  codeLimitations?: readonly string[];
  /** Durable rolling state for the next turn; not rendered as an answer. */
  conversationSummary?: string;
}

export interface ConfirmChangeResult {
  applied: true;
  revision: number;
  patchId: string;
  idempotent: boolean;
}
