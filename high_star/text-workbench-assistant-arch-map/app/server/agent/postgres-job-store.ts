import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getPostgresDb } from "../../db/postgres";
import type { ObjectStorage } from "../storage/object-storage";
import { runtimeObjectStorage } from "../storage/object-storage";
import type { JobStore, StoredAgentJob } from "./job-store";

function sliceText(text: string, job: StoredAgentJob, cursor: number, limit: number) {
  const bytes = Buffer.from(text, "utf8"); const start = Math.min(Math.max(0, cursor), bytes.length);
  let end = Math.min(start + Math.min(Math.max(limit, 1024), 64 * 1024), bytes.length);
  while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(start, end).toString("utf8"), nextCursor: end < bytes.length ? end : null, totalBytes: bytes.length, checksum: job.textChecksum };
}

/** PostgreSQL metadata + S3-compatible result storage implementation. */
export class PostgresJobStore implements JobStore {
  private readonly db = getPostgresDb();
  constructor(private readonly objects: ObjectStorage = runtimeObjectStorage()) {}
  async save(job: StoredAgentJob, text: string) {
    const bytes = Buffer.from(text, "utf8"); const checksum = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `jobs/${job.id}/result.txt`; await this.objects.put(objectKey, bytes, "text/plain; charset=utf-8");
    await this.db.execute(sql`insert into agent_jobs (id, session_id, node_id, kind, query, state, progress, error, result_object_key, result_checksum, result_bytes, revision, retry_count, worker_id, created_at, updated_at, started_at, finished_at, source_text, source_kind)
      values (${job.id}::uuid, ${job.sessionId}, ${job.nodeId}, ${job.kind}, ${job.query}, ${job.state}, ${job.progress ?? null}, ${job.error ?? null}, ${objectKey}, ${checksum}, ${bytes.length}, ${job.revision}, ${job.retryCount}, ${job.workerId ?? null}, ${job.createdAt}, now(), ${job.startedAt ?? null}, ${job.finishedAt ?? null}, ${job.sourceText ?? null}, ${job.sourceKind ?? null})
      on conflict (id) do update set session_id=excluded.session_id, node_id=excluded.node_id, kind=excluded.kind, query=excluded.query, state=excluded.state, progress=excluded.progress, error=excluded.error, result_object_key=excluded.result_object_key, result_checksum=excluded.result_checksum, result_bytes=excluded.result_bytes, revision=excluded.revision, retry_count=excluded.retry_count, worker_id=excluded.worker_id, updated_at=now(), started_at=excluded.started_at, finished_at=excluded.finished_at, source_text=excluded.source_text, source_kind=excluded.source_kind`);
    if (job.result) await this.db.execute(sql`insert into agent_job_results (job_id, result, object_key, checksum, bytes) values (${job.id}::uuid, ${job.result}, ${objectKey}, ${checksum}, ${bytes.length}) on conflict (job_id) do update set result=excluded.result, object_key=excluded.object_key, checksum=excluded.checksum, bytes=excluded.bytes`);
  }
  async load(id: string) {
    if (!/^[a-f0-9-]+$/.test(id)) return undefined;
    const result = await this.db.execute(sql`select * from agent_jobs where id = ${id}::uuid`);
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const resultRow = await this.db.execute(sql`select result from agent_job_results where job_id = ${id}::uuid`);
    const text = row.result_object_key ? Buffer.from(await this.objects.get(String(row.result_object_key)) ?? new Uint8Array()).toString("utf8") : "";
    const job: StoredAgentJob = { id: String(row.id), sessionId: String(row.session_id), nodeId: String(row.node_id ?? ""), kind: row.kind as StoredAgentJob["kind"], query: String(row.query), state: row.state as StoredAgentJob["state"], progress: row.progress ? String(row.progress) : undefined, error: row.error ? String(row.error) : undefined, result: (resultRow.rows[0] as { result?: StoredAgentJob["result"] } | undefined)?.result, textBytes: Buffer.byteLength(text), textChecksum: String(row.result_checksum ?? createHash("sha256").update(text).digest("hex")), revision: Number(row.revision ?? 0), retryCount: Number(row.retry_count ?? 0), workerId: row.worker_id ? String(row.worker_id) : undefined, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : undefined, finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : undefined, sourceText: row.source_text ? String(row.source_text) : undefined, sourceKind: row.source_kind as StoredAgentJob["sourceKind"] };
    return { job, text };
  }
  async list(sessionId: string) { const result = await this.db.execute(sql`select id from agent_jobs where session_id = ${sessionId} order by created_at asc`); const jobs = await Promise.all(result.rows.map((row) => this.load(String((row as { id: string }).id)))); return jobs.flatMap((value) => value ? [value.job] : []); }
  async readText(id: string, sessionId: string, cursor: number, limit: number) { const value = await this.load(id); if (!value || value.job.sessionId !== sessionId) throw new Error("任务不存在"); return sliceText(value.text, value.job, cursor, limit); }
}
