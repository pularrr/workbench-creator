import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => vite.close());

const { expandedKnowledgeDataset } = await vite.ssrLoadModule("/data/knowledge/deep-slices.ts");
const tools = await vite.ssrLoadModule("/server/agent/knowledge-tools.ts");

test("Knowledge Agent tools expose bounded, level-aware observations", () => {
  const coverage = tools.executeKnowledgeTool(expandedKnowledgeDataset, "assess_coverage", { nodeId: "chirp" });
  assert.match(coverage.summary, /覆盖/);
  const traversal = tools.executeKnowledgeTool(expandedKnowledgeDataset, "traverse_graph", { nodeId: "chirp", maxDepth: 2, maxNodes: 18 });
  assert.match(traversal.summary, /同层优先 DFS/);
  assert.ok(traversal.output.visits.length <= 18);
  assert.equal(new Set(traversal.output.visits.map((item) => item.nodeId)).size, traversal.output.visits.length);
});

test("history remains inaccessible without explicit ids", () => {
  assert.throws(() => tools.executeKnowledgeTool(expandedKnowledgeDataset, "get_history", { nodeId: "fmcw", historyIds: [] }), /explicitly provided/);
});
