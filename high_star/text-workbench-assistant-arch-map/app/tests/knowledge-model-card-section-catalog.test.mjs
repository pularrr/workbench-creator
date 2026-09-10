import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => vite.close());

const catalogModule = await vite.ssrLoadModule("/core/knowledge/card-section-catalog.ts");
const { CARD_SECTION_CATALOG, assessCardCoverage, getCardSectionDefinition } = catalogModule;

test("catalog is complete, unique and carries classification evidence", () => {
  assert.equal(CARD_SECTION_CATALOG.length, 13);
  assert.equal(new Set(CARD_SECTION_CATALOG.map((section) => section.type)).size, 13);
  assert.equal(new Set(CARD_SECTION_CATALOG.map((section) => section.order)).size, 13);
  for (const section of CARD_SECTION_CATALOG) {
    assert.ok(section.definition.length > 0, `${section.type} needs a definition`);
    assert.ok(section.decisionSignals.length > 0, `${section.type} needs decision signals`);
    assert.ok(section.positiveExamples.length > 0, `${section.type} needs positive examples`);
    assert.ok(section.negativeExamples.length > 0, `${section.type} needs negative examples`);
    assert.ok(["theory", "application", "other"].includes(section.collection));
    assert.ok(["core", "conditional", "optional"].includes(section.coverage));
  }
});

test("procedure and code belong to application knowledge", () => {
  assert.equal(getCardSectionDefinition("procedure").collection, "application");
  assert.equal(getCardSectionDefinition("code").collection, "application");
});

test("coverage uses node applicability and activated conditions", () => {
  const node = { nodeType: "algorithm" };
  const empty = assessCardCoverage(node);
  assert.ok(empty.total >= 6);
  assert.ok(empty.total < 13);
  assert.ok(empty.expectedTypes.includes("procedure"));
  assert.ok(empty.expectedTypes.includes("comparison"));
  assert.ok(!empty.expectedTypes.includes("assumptions"));
  assert.ok(!empty.expectedTypes.includes("code"));

  const withFormula = assessCardCoverage(node, {
    blocks: [{ type: "definition", title: "定义" }],
    formulaIds: ["formula-1"],
    evidenceIds: [],
  });
  assert.ok(withFormula.expectedTypes.includes("assumptions"));
  assert.equal(withFormula.present, 1);
  assert.ok(withFormula.missingTypes.includes("assumptions"));
  assert.ok(withFormula.missing.includes("成立假设"));
});

test("consumers do not keep independent section maps", async () => {
  const deepSearch = await readFile(new URL("../features/agent/model/offlineDeepSearch.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../features/knowledge-graph/components/KnowledgeCardPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(deepSearch, /recommendedBlocks/);
  assert.match(deepSearch, /assessCardCoverage/);
  assert.doesNotMatch(panel, /categoryByType/);
  assert.match(panel, /getCardSectionDefinition/);
});
