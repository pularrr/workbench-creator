import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { buildSourceDecodeBranchPatch } = await vite.ssrLoadModule("/server/codegraph/source-decode-branch.ts");
const { applyOperations } = await vite.ssrLoadModule("/core/agent/graph-operations.ts");
const { datasetToAgentGraph, agentGraphToDataset } = await vite.ssrLoadModule("/core/knowledge/portable-bundle.ts");
const { expandedKnowledgeDataset } = await vite.ssrLoadModule("/data/knowledge/initial-dataset.ts");

test.after(async () => vite.close());

test("source decode adds only a dedicated root child branch and preserves original graph records", () => {
  const before = structuredClone(expandedKnowledgeDataset);
  const repository = { id: "repo-1", rootPath: "C:/workspace/demo", displayName: "demo", allowedToSendContext: true, excludePatterns: [], state: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", revision: "abc1234" };
  const patch = buildSourceDecodeBranchPatch(before, repository, [{ path: "src/worker.ts", language: "typescript", nodeCount: 3, size: 123 }]);
  const result = agentGraphToDataset(applyOperations({ ...datasetToAgentGraph(before), revision: before.revision }, patch.operations, before.revision + 1));
  assert.equal(result.nodes.find((node) => node.id === "source-decode-repo-1")?.primaryParentId, before.nodes.find((node) => node.primaryParentId === null)?.id);
  assert.ok(result.nodes.some((node) => node.tags.includes("source-decode") && node.canonicalName === "worker.ts"));
  assert.deepEqual(result.nodes.filter((node) => !node.tags.includes("source-decode")), before.nodes);
});
