export type AgentRunKind = "chat" | "deep_search" | "ingest" | "card_edit";

export type AgentRunStatus =
  | "created"
  | "answering"
  | "knowledge_researching"
  | "semantic_reviewing"
  | "gate_failed"
  | "revision_requested"
  | "building"
  | "awaiting_user_confirmation"
  | "committing"
  | "applied"
  | "rejected"
  | "failed"
  | "cancelled";

export interface AgentRunStep {
  sequence: number;
  at: string;
  from: AgentRunStatus | null;
  to: AgentRunStatus;
  actor: string;
  summary: string;
  detailsHash?: string;
}

export interface PersistentAgentRun {
  id: string;
  sessionId: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  baseRevision: number;
  currentNodeId?: string;
  querySummary: string;
  createdAt: string;
  updatedAt: string;
  steps: readonly AgentRunStep[];
  proposalId?: string;
  patchId?: string;
  confirmationExpiresAt?: number;
  failureCode?: string;
}

const transitions: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  created: ["answering", "knowledge_researching", "failed", "cancelled"],
  answering: ["applied", "knowledge_researching", "failed", "cancelled"],
  knowledge_researching: ["semantic_reviewing", "applied", "failed", "cancelled"],
  semantic_reviewing: ["revision_requested", "gate_failed", "building", "failed", "cancelled"],
  gate_failed: ["revision_requested", "rejected"],
  revision_requested: ["knowledge_researching", "rejected", "cancelled"],
  building: ["awaiting_user_confirmation", "failed"],
  awaiting_user_confirmation: ["committing", "revision_requested", "rejected", "cancelled"],
  committing: ["applied", "failed"],
  applied: [],
  rejected: [],
  failed: [],
  cancelled: [],
};

export function createAgentRun(input: {
  id: string;
  sessionId: string;
  kind: AgentRunKind;
  baseRevision: number;
  querySummary: string;
  currentNodeId?: string;
  at: string;
}): PersistentAgentRun {
  return {
    id: input.id,
    sessionId: input.sessionId,
    kind: input.kind,
    status: "created",
    baseRevision: input.baseRevision,
    querySummary: input.querySummary.slice(0, 120),
    ...(input.currentNodeId ? { currentNodeId: input.currentNodeId } : {}),
    createdAt: input.at,
    updatedAt: input.at,
    steps: [{ sequence: 1, at: input.at, from: null, to: "created", actor: "development-agent", summary: "创建 Agent run" }],
  };
}

export function transitionAgentRun(
  run: PersistentAgentRun,
  to: AgentRunStatus,
  input: { actor: string; summary: string; at: string; detailsHash?: string; changes?: Partial<PersistentAgentRun> },
): PersistentAgentRun {
  if (!transitions[run.status].includes(to)) throw new Error(`Invalid Agent run transition: ${run.status} -> ${to}.`);
  const next = {
    ...structuredClone(run),
    ...(input.changes ?? {}),
    status: to,
    updatedAt: input.at,
    steps: [...run.steps, {
      sequence: run.steps.length + 1,
      at: input.at,
      from: run.status,
      to,
      actor: input.actor,
      summary: input.summary.slice(0, 120),
      ...(input.detailsHash ? { detailsHash: input.detailsHash } : {}),
    }],
  };
  return next;
}

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return transitions[status].length === 0;
}
