/**
 * CodeGraph data is intentionally independent from KnowledgeDataset.  Source
 * files and symbols are navigation facts, not domain-knowledge concepts.
 */
export type CodeNodeKind = "repository" | "directory" | "file" | "symbol";
export type CodeGraphIndexState = "idle" | "indexing" | "ready" | "failed" | "cancelled" | "stale";
export type CodeLinkRelation = "IMPLEMENTED_BY" | "CONFIGURED_BY" | "TESTED_BY" | "DEPENDS_ON";
export type CodeLinkSource = "codegraph-fact" | "manifest-fact" | "llm-candidate" | "user-confirmed";
export type CodeGraphRelationKind = "CALLS" | "CALLED_BY" | "AFFECTS";

export interface CodeGraphSymbol {
  id: string;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
  signature?: string;
  exported?: boolean;
  asynchronous?: boolean;
}

export interface CodeGraphRelation {
  kind: CodeGraphRelationKind;
  from: CodeGraphSymbol;
  to: CodeGraphSymbol;
  /** CodeGraph may resolve by name in languages with dynamic dispatch. */
  limitation?: string;
}

export interface CodeCitation {
  path: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  revision: string;
  contentHash: string;
  source: "codegraph-fact" | "manifest-fact";
}

export interface RepositoryConnection {
  id: string;
  rootPath: string;
  displayName: string;
  allowedToSendContext: boolean;
  excludePatterns: string[];
  revision?: string;
  state: CodeGraphIndexState;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface CodeGraphNode {
  id: string;
  repositoryId: string;
  kind: CodeNodeKind;
  label: string;
  path?: string;
  symbol?: string;
  parentId?: string;
  citation?: CodeCitation;
  updatedAt: string;
}

export interface CodeEntryLink {
  id: string;
  knowledgeNodeId: string;
  repositoryId: string;
  codeNodeId?: string;
  relation: CodeLinkRelation;
  citation: CodeCitation;
  library?: { packageName: string; version?: string; manifestPath: string };
  source: CodeLinkSource;
  rationale?: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodeIndexRun {
  id: string;
  repositoryId: string;
  state: CodeGraphIndexState;
  revision?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

/** A bounded, resumable projection of the external CodeGraph index. */
export interface CodeProjectionBatch {
  id: string;
  repositoryId: string;
  filePaths: string[];
  symbolIds: string[];
  state: "queued" | "applied" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  revision?: string;
  error?: string;
  facts?: { symbols: CodeGraphSymbol[]; relations: CodeGraphRelation[]; limitations: string[] };
}

export interface CodeGraphState {
  repositories: RepositoryConnection[];
  nodes: CodeGraphNode[];
  links: CodeEntryLink[];
  runs: CodeIndexRun[];
  batches: CodeProjectionBatch[];
}
