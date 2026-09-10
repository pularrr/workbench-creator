import type { GraphOperation, ProjectionDiff, ReviewFinding } from "./contracts";

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
}

export interface ConfirmChangeResult {
  applied: true;
  revision: number;
  patchId: string;
  idempotent: boolean;
}
