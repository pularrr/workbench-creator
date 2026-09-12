import type {
  KnowledgeClaim,
  KnowledgeSourceArtifact,
  KnowledgeSourceKind,
} from "../knowledge/schema";

export type SourceKind = KnowledgeSourceKind;
export type SourceArtifact = KnowledgeSourceArtifact;

export interface ContentSegment {
  id: string;
  artifactId: string;
  order: number;
  text: string;
  locator?: string;
}

export type ExtractedKnowledgeClaim = KnowledgeClaim;

export type MatchDecision = "append-card" | "create-node" | "create-relation" | "needs-review";

export interface KnowledgeMatchCandidate {
  claimId: string;
  matchedNodeId?: string;
  score: number;
  rationale: string;
  decision: MatchDecision;
}

export interface StagedKnowledgeImport {
  artifact: SourceArtifact;
  segments: readonly ContentSegment[];
  claims: readonly ExtractedKnowledgeClaim[];
  matches: readonly KnowledgeMatchCandidate[];
  status: "awaiting-agent-review";
}

export interface SourceContentAdapter {
  supports(kind: SourceKind, mimeType: string): boolean;
  extract(artifact: SourceArtifact): Promise<readonly ContentSegment[]>;
}

/** Built-in boundary for normalizing raw inputs. It can propose, but cannot mutate a graph repository. */
export interface IngestionAgent {
  stage(artifact: SourceArtifact, segments: readonly ContentSegment[]): Promise<StagedKnowledgeImport>;
}
