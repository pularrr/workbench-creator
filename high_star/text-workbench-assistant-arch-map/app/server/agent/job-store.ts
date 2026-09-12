import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentInteractionResult } from "../../core/agent/online-contracts";
import { PostgresJobStore } from "./postgres-job-store";

export type AgentJobState = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface StoredAgentJob {
  id: string; sessionId: string; nodeId: string;
  kind: "chat" | "deep-search" | "summary" | "ingest";
  query: string; state: AgentJobState; createdAt: string; updatedAt: string;
  progress?: string; error?: string; result?: Omit<AgentInteractionResult, "text">;
  textBytes: number; textChecksum: string; revision: number;
  sourceText?: string; sourceKind?: "conversation" | "summary" | "paper" | "document";
  /** Opt-in only: repository source used by a chat task. */
  codeRepositoryId?: string;
  retryCount: number; workerId?: string; startedAt?: string; finishedAt?: string;
}
export interface JobStore {
  save(job: StoredAgentJob, text: string): Promise<void>;
  load(id: string): Promise<{ job: StoredAgentJob; text: string } | undefined>;
  list(sessionId: string): Promise<StoredAgentJob[]>;
  readText(id: string, sessionId: string, cursor: number, limit: number): Promise<{ text: string; nextCursor: number | null; totalBytes: number; checksum: string }>;
}

/** Long-lived Node implementation. Serverless deployments must replace this with shared durable storage. */
export class FileJobStore implements JobStore {
  constructor(private readonly root = join(process.cwd(), "data", "runtime", "jobs")) {}
  private metadataPath(id: string) { return join(this.root, id + ".json"); }
  private textPath(id: string) { return join(this.root, id + ".txt"); }
  async save(job: StoredAgentJob, text: string) {
    mkdirSync(this.root, { recursive: true });
    const bytes = Buffer.from(text, "utf8");
    job.textBytes = bytes.length; job.textChecksum = createHash("sha256").update(bytes).digest("hex"); job.updatedAt = new Date().toISOString();
    writeFileSync(this.textPath(job.id) + ".tmp", bytes, { mode: 0o600 });
    renameSync(this.textPath(job.id) + ".tmp", this.textPath(job.id));
    writeFileSync(this.metadataPath(job.id) + ".tmp", JSON.stringify(job), { mode: 0o600 });
    renameSync(this.metadataPath(job.id) + ".tmp", this.metadataPath(job.id));
  }
  async load(id: string) {
    if (!/^[a-f0-9-]+$/.test(id) || !existsSync(this.metadataPath(id))) return undefined;
    const raw = JSON.parse(readFileSync(this.metadataPath(id), "utf8")) as StoredAgentJob & { text?: string; result?: AgentInteractionResult };
    const legacyText = raw.text ?? raw.result?.text ?? "";
    const text = existsSync(this.textPath(id)) ? readFileSync(this.textPath(id), "utf8") : legacyText;
    const { text: _legacy, ...metadata } = raw;
    const result = metadata.result ? (({ text: _resultText, ...rest }) => rest)(metadata.result as AgentInteractionResult) : undefined;
    return { job: { ...metadata, result, textBytes: Buffer.byteLength(text), textChecksum: metadata.textChecksum ?? createHash("sha256").update(text).digest("hex"), revision: metadata.revision ?? 1, retryCount: metadata.retryCount ?? 0 }, text };
  }
  async list(sessionId: string) {
    if (!existsSync(this.root)) return [];
    const values: Array<StoredAgentJob | undefined> = await Promise.all(readdirSync(this.root).filter((name) => /^[a-f0-9-]+\.json$/.test(name)).map(async (name): Promise<StoredAgentJob | undefined> => {
      try { const value = await this.load(name.slice(0, -5)); return value?.job.sessionId === sessionId ? value.job : undefined; }
      catch { return undefined; }
    }));
    return values.filter((value): value is StoredAgentJob => Boolean(value)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async readText(id: string, sessionId: string, cursor: number, limit: number) {
    const value = await this.load(id);
    if (!value || value.job.sessionId !== sessionId) throw new Error("任务不存在");
    const bytes = Buffer.from(value.text, "utf8");
    const start = Math.min(Math.max(0, cursor), bytes.length);
    let end = Math.min(start + Math.min(Math.max(limit, 1024), 64 * 1024), bytes.length);
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    return { text: bytes.subarray(start, end).toString("utf8"), nextCursor: end < bytes.length ? end : null, totalBytes: bytes.length, checksum: value.job.textChecksum };
  }
}

const holder = globalThis as typeof globalThis & { __agentJobStore?: JobStore };
export const agentJobStore = () => holder.__agentJobStore ??= new FileJobStore();

export function runtimeAgentJobStore(): JobStore {
  if (process.env.RUNTIME_STORE === "postgres" && process.env.JOB_STORE !== "file") {
    const runtime = globalThis as typeof globalThis & { __postgresAgentJobStore?: JobStore };
    return runtime.__postgresAgentJobStore ??= new PostgresJobStore();
  }
  return agentJobStore();
}
