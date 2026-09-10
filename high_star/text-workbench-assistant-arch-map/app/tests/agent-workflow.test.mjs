import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

const core = await vite.ssrLoadModule("/core/agent/index.ts");
const server = await vite.ssrLoadModule("/server/agent/index.ts");
after(async () => vite.close());

const initial = {
  nodes: [
    { id: "fmcw", title: "FMCW" },
    { id: "association", title: "Association", primaryParentId: "fmcw" },
  ],
  edges: [],
  cards: [],
};

function createWorkflow(factory) {
  return new server.OfflineAgentWorkflow(
    initial,
    new core.OfflineKnowledgeAgent(factory),
    new core.OfflineReviewAgent(),
    new core.OfflineBuildAgent(),
    new core.OfflineDevelopmentAgent(),
  );
}

const validFactory = (context, _snapshot, previous) => {
  const suffix = previous ? "-revised" : "";
  return {
    summary: `Add GNN${suffix}`,
    rationale: "Separate an association algorithm from its gating metric.",
    evidence: [{ id: `evidence${suffix}`, title: "Tracking reference", source: "offline fixture" }],
    operations: [
      { kind: "upsert-node", node: { id: `gnn${suffix}`, title: "Global Nearest Neighbor", primaryParentId: "association" } },
      { kind: "upsert-card", card: { nodeId: `gnn${suffix}`, definition: context.conversationSummary } },
    ],
  };
};

test("proposal, review, dry-run and preview do not write before confirmation", () => {
  const workflow = createWorkflow(validFactory);
  const candidate = workflow.submit({ conversationSummary: "Add GNN", currentNodeId: "association" });
  assert.equal(candidate.status, "awaiting-confirmation");
  assert.equal(candidate.preview.currentNodeId, "association");
  assert.deepEqual(candidate.patch.projectionDiff.visibleNodeIds.slice(0, 2), ["association", "gnn"]);
  assert.equal(workflow.snapshot().revision, 0);
  assert.equal(workflow.snapshot().nodes.some((node) => node.id === "gnn"), false);
});

test("the revision store rejects an unconfirmed or forged write", () => {
  const workflow = createWorkflow(validFactory);
  const candidate = workflow.submit({ conversationSummary: "Add GNN" });
  const store = new server.InMemoryRevisionStore(initial);
  assert.throws(() => store.apply(candidate.patch, {
    action: "apply",
    subject: candidate.patch.id,
    confirmedBy: "forged",
    confirmedAt: new Date().toISOString(),
    nonce: "not-issued-by-store",
  }), /valid, unused user confirmation/);
  assert.equal(store.snapshot().revision, 0);
});

test("review failure blocks a dangling edge", () => {
  const workflow = createWorkflow(() => ({
    summary: "Invalid",
    rationale: "Fixture",
    evidence: [],
    operations: [{
      kind: "upsert-edge",
      edge: { id: "bad", sourceId: "association", targetId: "missing", type: "PREREQUISITE_OF", rationale: "Fixture" },
    }],
  }));
  const candidate = workflow.submit({ conversationSummary: "Invalid edge" });
  assert.equal(candidate.status, "review-failed");
  assert.equal(candidate.patch, undefined);
  assert.equal(workflow.snapshot().revision, 0);
});

test("confirmation creates a new revision and duplicate confirmation is idempotent", () => {
  const workflow = createWorkflow(validFactory);
  const candidate = workflow.submit({ conversationSummary: "Add GNN", currentNodeId: "association" });
  const applied = workflow.confirm(candidate.patch.id, { confirmed: true, confirmedBy: "reviewer" });
  assert.equal(applied.commit.revision, 1);
  assert.equal(applied.commit.idempotent, false);
  assert.equal(workflow.snapshot().nodes.some((node) => node.id === "gnn"), true);
  const duplicate = workflow.confirm(candidate.patch.id, { confirmed: true, confirmedBy: "reviewer" });
  assert.equal(duplicate.commit.revision, 1);
  assert.equal(duplicate.commit.idempotent, true);
  assert.deepEqual(workflow.revisionHistory(), [0, 1]);
});

test("a stale patch fails without adding a revision", () => {
  const workflow = createWorkflow(validFactory);
  const first = workflow.submit({ conversationSummary: "First" });
  const second = workflow.submit({ conversationSummary: "Second" });
  workflow.confirm(first.patch.id, { confirmed: true, confirmedBy: "reviewer" });
  assert.throws(
    () => workflow.confirm(second.patch.id, { confirmed: true, confirmedBy: "reviewer" }),
    /Stale patch/,
  );
  assert.equal(workflow.snapshot().revision, 1);
  assert.deepEqual(workflow.revisionHistory(), [0, 1]);
  assert.equal(workflow.auditLog().at(-1).type, "revision.apply-failed");
});

test("revise supersedes the pending proposal and reject never writes", () => {
  const workflow = createWorkflow(validFactory);
  const first = workflow.submit({ conversationSummary: "Needs correction" });
  const revised = workflow.revise(first.patch.id, { requestedBy: "reviewer", note: "Use a revised node." });
  assert.equal(revised.proposal.supersedesProposalId, first.proposal.id);
  assert.equal(revised.status, "awaiting-confirmation");
  workflow.reject(revised.patch.id, { rejectedBy: "reviewer", note: "Not now" });
  assert.equal(workflow.snapshot().revision, 0);
});

test("rollback appends a revision and the full audit can replay the final graph", () => {
  const workflow = createWorkflow(validFactory);
  const candidate = workflow.submit({ conversationSummary: "Add GNN" });
  workflow.confirm(candidate.patch.id, { confirmed: true, confirmedBy: "reviewer" });
  const rollback = workflow.rollback(0, { confirmed: true, confirmedBy: "reviewer" });
  assert.equal(rollback.revision, 2);
  assert.deepEqual(workflow.revisionHistory(), [0, 1, 2]);
  assert.equal(workflow.snapshot().nodes.some((node) => node.id === "gnn"), false);
  const replayed = server.replayAudit(initial, workflow.auditLog());
  assert.deepEqual(replayed, workflow.snapshot());
});

test("the workflow keeps one recent and two historical saved revisions", () => {
  const workflow = createWorkflow(validFactory);
  for (let index = 0; index < 4; index += 1) {
    const candidate = workflow.submit({ conversationSummary: `Save ${index}` });
    workflow.confirm(candidate.patch.id, { confirmed: true, confirmedBy: "reviewer" });
  }
  assert.deepEqual(workflow.revisionHistory(), [2, 3, 4]);
  assert.deepEqual(workflow.rollbackTargets(), [3, 2]);
  assert.throws(
    () => workflow.rollback(1, { confirmed: true, confirmedBy: "reviewer" }),
    /two available historical versions/,
  );
});

test("graph operations atomically include formulas, evidence, assets, sources, claims and history", () => {
  const snapshot = { ...initial, revision: 0 };
  const source = { id: "source-1", title: "Paper", kind: "paper", modality: "text", mimeType: "text/plain", checksum: "sha256:x", suppliedAt: "2026-09-03T00:00:00Z", suppliedBy: "user" };
  const projected = core.applyOperations(snapshot, [
    { kind: "upsert-asset", asset: { id: "asset-1", modality: "document", mimeType: "application/pdf", storageRef: "asset.pdf", checksum: "sha256:y" } },
    { kind: "upsert-evidence", evidence: { id: "evidence-1", title: "Paper", sourceType: "paper", assetId: "asset-1" } },
    { kind: "upsert-source", source },
    { kind: "upsert-claim", claim: { id: "claim-1", artifactId: "source-1", segmentIds: ["segment-1"], statement: "Claim", shortSummary: "Claim", suggestedCollection: "other", confidence: 0.8 } },
    { kind: "upsert-formula", formula: { id: "formula-1", nodeId: "fmcw", name: "Test", latex: "x", sourceText: "x", meaning: "x", symbols: [{ symbol: "x", latex: "x", definition: "test" }], assumptions: [], evidenceIds: ["evidence-1"] } },
    { kind: "append-history", entry: { id: "history-1", nodeId: "fmcw", kind: "knowledge_imported", summary: "Imported paper claim", occurredAt: "2026-09-03T00:00:00Z", sourceArtifactId: "source-1" } },
  ], 1);
  assert.equal(projected.formulas.length, 1);
  assert.equal(projected.evidence.length, 1);
  assert.equal(projected.assets.length, 1);
  assert.equal(projected.sources.length, 1);
  assert.equal(projected.claims.length, 1);
  assert.equal(projected.history.length, 1);
});
