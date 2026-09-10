import type { StagedKnowledgeImport } from "../ingestion/contracts";
import type { ConversationContext, WorkflowCandidate } from "./contracts";

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "asset_ref"; assetId: string; mimeType: string };

export interface GeneralLlmRequest {
  systemContext: string;
  conversation: readonly LlmContentPart[];
  currentNodeContext?: string;
}

export interface GeneralLlmResponse {
  text: string;
  extractedKnowledge?: StagedKnowledgeImport;
}

/** Provider-neutral model port. It intentionally exposes no repository or mutation method. */
export interface GeneralLlmProvider {
  respond(request: GeneralLlmRequest): Promise<GeneralLlmResponse>;
}

export type ApplicationIntent = "answer" | "summarize-for-graph" | "propose-graph-update";

export interface LlmApplicationRequest {
  intent: ApplicationIntent;
  modelRequest: GeneralLlmRequest;
  graphContext: ConversationContext;
}

/** The application orchestrator may route a model result into built-in agents; the model never writes directly. */
export interface AgentOrchestrator {
  handle(request: LlmApplicationRequest): Promise<GeneralLlmResponse | WorkflowCandidate>;
}

export const capabilityPolicy = {
  "general-llm": ["answer", "extract-claims"],
  "ingestion-agent": ["normalize-source", "extract-claims", "stage-candidate"],
  "knowledge-agent": ["read-graph", "search-graph", "propose-change"],
  "review-agent": ["read-graph", "review-change"],
  "build-agent": ["build-patch", "dry-run"],
  "development-agent": ["orchestrate", "request-confirmation", "commit-confirmed", "rollback-confirmed"],
} as const;

export type ApplicationActor = keyof typeof capabilityPolicy;
export type ApplicationCapability = (typeof capabilityPolicy)[ApplicationActor][number];

export function actorCan(actor: ApplicationActor, capability: string): boolean {
  return (capabilityPolicy[actor] as readonly string[]).includes(capability);
}
