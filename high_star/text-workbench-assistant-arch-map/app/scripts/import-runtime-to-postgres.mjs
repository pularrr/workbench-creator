import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const filePath = process.argv[2] ?? "data/runtime/knowledge-state.json";
const raw = JSON.parse(await readFile(filePath, "utf8"));
if (raw.schemaVersion !== "fmcw-runtime/1" || !raw.state?.dataset) throw new Error("不是有效的 fmcw-runtime/1 文件");
const { state } = raw;
const { dataset } = state;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
if (!process.env.DATABASE_URL) throw new Error("请先设置 DATABASE_URL");
await client.connect();
try {
  await client.query("begin");
  await client.query(`insert into runtime_states (id, content_revision, state, checksum) values ('default', $1, $2, $3)
    on conflict (id) do update set content_revision = excluded.content_revision, state = excluded.state, checksum = excluded.checksum, updated_at = now()`, [state.contentRevision, JSON.stringify(state), raw.checksum]);
  await client.query(`insert into knowledge_revisions (revision, parent_revision, actor, summary, checksum)
    values ($1, null, 'migration', '从 JSON runtime 导入', $2)
    on conflict (revision) do nothing`, [state.contentRevision, raw.checksum]);
  for (const domain of dataset.domains) await client.query(`insert into knowledge_domains (id, name, description, visual_branch, sort_order) values ($1,$2,$3,$4,$5) on conflict do nothing`, [domain.id, domain.name, domain.description, domain.visualBranch, domain.order]);
  for (const node of dataset.nodes) await client.query(`insert into knowledge_nodes (id, canonical_name, short_fact, aliases, node_type, domain_id, visual_branch, primary_parent_id, level, sort_order, tags, status, legacy_id, legacy_snapshot, current_revision) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (id) do nothing`, [node.id, node.canonicalName, node.shortFact, JSON.stringify(node.aliases), node.nodeType, node.domainId, node.visualBranch, node.primaryParentId, node.level, node.order, JSON.stringify(node.tags), node.status, node.legacyId ?? null, node.legacySnapshot ? JSON.stringify(node.legacySnapshot) : null, state.contentRevision]);
  for (const card of dataset.cards) await client.query(`insert into knowledge_cards (node_id, headline, blocks, formula_ids, evidence_ids, revision) values ($1,$2,$3,$4,$5,$6) on conflict (node_id) do nothing`, [card.nodeId, card.headline, JSON.stringify(card.blocks), JSON.stringify(card.formulaIds), JSON.stringify(card.evidenceIds), card.revision]);
  for (const edge of dataset.edges) await client.query(`insert into knowledge_edges (id, source_id, target_id, edge_type, rationale, weight, status, evidence_ids, legacy_label, current_revision) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`, [edge.id, edge.sourceId, edge.targetId, edge.type, edge.rationale, edge.weight, edge.status, JSON.stringify(edge.evidenceIds), edge.legacyLabel ?? null, state.contentRevision]);
  await client.query("commit");
  console.log(JSON.stringify({ ok: true, revision: state.contentRevision, nodes: dataset.nodes.length, cards: dataset.cards.length, edges: dataset.edges.length }));
} catch (error) { await client.query("rollback"); throw error; } finally { await client.end(); }
