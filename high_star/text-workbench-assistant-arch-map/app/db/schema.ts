import { bigint, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** PostgreSQL is the durable source of truth. Large payloads use object storage. */
export const knowledgeRevisions = pgTable("knowledge_revisions", {
  revision: bigint("revision", { mode: "number" }).primaryKey(),
  parentRevision: bigint("parent_revision", { mode: "number" }),
  actor: text("actor").notNull(), summary: text("summary").notNull(),
  checksum: text("checksum").notNull(), snapshotObjectKey: text("snapshot_object_key"),
  restoredFromRevision: bigint("restored_from_revision", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Transitional envelope for runtime fields that are not yet normalized. */
export const runtimeStates = pgTable("runtime_states", {
  id: text("id").primaryKey(),
  contentRevision: bigint("content_revision", { mode: "number" }).notNull(),
  state: jsonb("state").notNull(),
  checksum: text("checksum").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeDomains = pgTable("knowledge_domains", {
  id: text("id").primaryKey(), name: text("name").notNull(), description: text("description").notNull(),
  visualBranch: text("visual_branch").notNull(), sortOrder: integer("sort_order").notNull(),
});

export const knowledgeNodes = pgTable("knowledge_nodes", {
  id: text("id").primaryKey(), canonicalName: text("canonical_name").notNull(), shortFact: text("short_fact").notNull(),
  aliases: jsonb("aliases").$type<string[]>().default([]).notNull(), nodeType: text("node_type").notNull(), domainId: text("domain_id").notNull(),
  visualBranch: text("visual_branch").notNull(), primaryParentId: text("primary_parent_id"), level: integer("level").notNull(), sortOrder: integer("sort_order").notNull(),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(), status: text("status").notNull(), legacyId: text("legacy_id"), legacySnapshot: jsonb("legacy_snapshot"),
  currentRevision: bigint("current_revision", { mode: "number" }).notNull(),
});

export const knowledgeCards = pgTable("knowledge_cards", {
  nodeId: text("node_id").primaryKey(), headline: text("headline").notNull(), blocks: jsonb("blocks").notNull(),
  formulaIds: jsonb("formula_ids").$type<string[]>().default([]).notNull(), evidenceIds: jsonb("evidence_ids").$type<string[]>().default([]).notNull(), revision: bigint("revision", { mode: "number" }).notNull(),
});

export const knowledgeEdges = pgTable("knowledge_edges", {
  id: text("id").primaryKey(), sourceId: text("source_id").notNull(), targetId: text("target_id").notNull(), edgeType: text("edge_type").notNull(),
  rationale: text("rationale").notNull(), weight: numeric("weight").notNull(), status: text("status").notNull(), evidenceIds: jsonb("evidence_ids").$type<string[]>().default([]).notNull(), legacyLabel: text("legacy_label"), currentRevision: bigint("current_revision", { mode: "number" }).notNull(),
});

export const knowledgeFormulas = pgTable("knowledge_formulas", {
  id: text("id").primaryKey(), nodeId: text("node_id").notNull(), name: text("name").notNull(), latex: text("latex").notNull(), sourceText: text("source_text").notNull(), meaning: text("meaning").notNull(), symbols: jsonb("symbols").notNull(), assumptions: jsonb("assumptions").notNull(), evidenceIds: jsonb("evidence_ids").$type<string[]>().default([]).notNull(),
});

export const knowledgeSavepoints = pgTable("knowledge_savepoints", {
  id: text("id").primaryKey(), contentRevision: bigint("content_revision", { mode: "number" }).notNull(), label: text("label").notNull(), savedAt: timestamp("saved_at", { withTimezone: true }).notNull(), savedBy: text("saved_by").notNull(), checksum: text("checksum").notNull(), snapshotObjectKey: text("snapshot_object_key"),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(), sequence: bigint("sequence", { mode: "number" }).notNull(), actor: text("actor").notNull(), kind: text("kind").notNull(), contentRevision: bigint("content_revision", { mode: "number" }).notNull(), summary: text("summary").notNull(), detailsHash: text("details_hash"), details: jsonb("details"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const appliedPatches = pgTable("applied_patches", {
  patchId: text("patch_id").primaryKey(), baseRevision: bigint("base_revision", { mode: "number" }).notNull(), appliedRevision: bigint("applied_revision", { mode: "number" }).notNull(), patchHash: text("patch_hash").notNull(), appliedBy: text("applied_by").notNull(), appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
});

export const confirmationNonces = pgTable("confirmation_nonces", {
  nonce: text("nonce").primaryKey(), patchId: text("patch_id").notNull(), sessionId: text("session_id").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const agentJobs = pgTable("agent_jobs", {
  id: uuid("id").primaryKey(), sessionId: text("session_id").notNull(), nodeId: text("node_id"), kind: text("kind").notNull(), query: text("query").notNull(), state: text("state").notNull(), progress: text("progress"), error: text("error"), resultObjectKey: text("result_object_key"), resultChecksum: text("result_checksum"), resultBytes: bigint("result_bytes", { mode: "number" }), revision: integer("revision").default(0).notNull(), retryCount: integer("retry_count").default(0).notNull(), workerId: text("worker_id"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), startedAt: timestamp("started_at", { withTimezone: true }), finishedAt: timestamp("finished_at", { withTimezone: true }), sourceText: text("source_text"), sourceKind: text("source_kind"),
});

export const agentJobResults = pgTable("agent_job_results", {
  jobId: uuid("job_id").primaryKey(), result: jsonb("result"), objectKey: text("object_key").notNull(),
  checksum: text("checksum").notNull(), bytes: bigint("bytes", { mode: "number" }).notNull(),
});

export const knowledgeAssets = pgTable("knowledge_assets", {
  id: text("id").primaryKey(), modality: text("modality").notNull(), mimeType: text("mime_type").notNull(), objectKey: text("object_key").notNull(), checksum: text("checksum").notNull(), byteSize: bigint("byte_size", { mode: "number" }).notNull(), title: text("title"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sourceArtifacts = pgTable("source_artifacts", {
  id: text("id").primaryKey(), title: text("title").notNull(), kind: text("kind").notNull(), modality: text("modality").notNull(), mimeType: text("mime_type").notNull(), checksum: text("checksum").notNull(), objectKey: text("object_key"), suppliedAt: timestamp("supplied_at", { withTimezone: true }).notNull(), suppliedBy: text("supplied_by").notNull(),
});

export const schema = { knowledgeRevisions, runtimeStates, knowledgeDomains, knowledgeNodes, knowledgeCards, knowledgeEdges, knowledgeFormulas, knowledgeSavepoints, auditEvents, appliedPatches, confirmationNonces, agentJobs, agentJobResults, knowledgeAssets, sourceArtifacts };
