import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProjectModules } from "../scripts/lib/project-modules.mjs";

test("generated application loads its Profile and round-trips its own graph", async () => {
  await withProjectModules(async load => {
    const { ACTIVE_PROFILE } = await load("/profiles/active.ts");
    const { expandedKnowledgeDataset: dataset } = await load("/data/knowledge/initial-dataset.ts");
    const { validateKnowledgeDataset } = await load("/core/knowledge/validation.ts");
    const { createPortableKnowledgeBundle, serializeKnowledgeBundle, parseKnowledgeBundle } = await load("/core/knowledge/portable-bundle.ts");
    const { RuntimeKnowledgeRepository } = await load("/server/runtime/runtime-repository.ts");
    assert.equal(dataset.nodes.find(n => n.primaryParentId === null).id, ACTIVE_PROFILE.initialization.rootNode.id);
    assert.equal(validateKnowledgeDataset(dataset).valid, true);
    assert.deepEqual(parseKnowledgeBundle(serializeKnowledgeBundle(createPortableKnowledgeBundle(dataset))).dataset, dataset);
    const temp = mkdtempSync(join(tmpdir(), "knowmap-runtime-"));
    try {
      const path = join(temp, "state.json");
      new RuntimeKnowledgeRepository(path, dataset);
      assert.deepEqual(new RuntimeKnowledgeRepository(path, dataset).snapshot(), dataset);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
