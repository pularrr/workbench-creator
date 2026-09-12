import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UserConfirmation } from "../../core/agent/contracts";
import type { KnowledgeDataset, KnowledgeHistoryEntry } from "../../core/knowledge/schema";
import { validateKnowledgeDataset } from "../../core/knowledge/validation";

export interface KnowledgeRevisionRecord {
  revision: number;
  parentRevision: number | null;
  createdAt: string;
  actor: string;
  summary: string;
  dataset: KnowledgeDataset;
  restoredFromRevision?: number;
}

export interface KnowledgeRevisionRepository {
  list(): readonly KnowledgeRevisionRecord[];
  append(record: KnowledgeRevisionRecord): void;
}

type RevisionFile = {
  schemaVersion: "fmcw-revision-store/1";
  records: KnowledgeRevisionRecord[];
};

const clone = <T>(value: T): T => structuredClone(value);
const short = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 72);

export class JsonKnowledgeRevisionRepository implements KnowledgeRevisionRepository {
  constructor(private readonly filePath: string, initial?: KnowledgeDataset) {
    if (!existsSync(filePath)) {
      if (!initial) throw new Error("An initial dataset is required for a new revision repository.");
      const createdAt = new Date().toISOString();
      this.write({
        schemaVersion: "fmcw-revision-store/1",
        records: [{
          revision: initial.revision,
          parentRevision: null,
          createdAt,
          actor: "system",
          summary: "初始化知识图谱",
          dataset: clone(initial),
        }],
      });
    }
    this.read();
  }

  list(): readonly KnowledgeRevisionRecord[] {
    return clone(this.read().records);
  }

  append(record: KnowledgeRevisionRecord): void {
    const file = this.read();
    const latest = file.records.at(-1);
    if (latest && record.revision !== latest.revision + 1) throw new Error("Revision must increase by exactly one.");
    file.records.push(clone(record));
    file.records = file.records.slice(-3);
    this.write(file);
  }

  private read(): RevisionFile {
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as RevisionFile;
    if (parsed.schemaVersion !== "fmcw-revision-store/1" || !Array.isArray(parsed.records) || !parsed.records.length) {
      throw new Error("Invalid revision repository file.");
    }
    return parsed;
  }

  private write(file: RevisionFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    renameSync(temporary, this.filePath);
  }
}

export class VersionedKnowledgeStore {
  constructor(private readonly repository: KnowledgeRevisionRepository) {}

  snapshot(): KnowledgeDataset {
    return clone(this.records().at(-1)!.dataset);
  }

  history(): readonly KnowledgeRevisionRecord[] {
    return this.records();
  }

  rollbackTargets(): readonly KnowledgeRevisionRecord[] {
    return clone(this.records().slice(0, -1).slice(-2).reverse());
  }

  saveVersion(
    next: KnowledgeDataset,
    baseRevision: number,
    summary: string,
    confirmation: UserConfirmation,
  ): KnowledgeRevisionRecord {
    if (confirmation.confirmed !== true || !confirmation.confirmedBy.trim()) {
      throw new Error("Explicit user confirmation is required to save a version.");
    }
    const current = this.records().at(-1)!;
    if (baseRevision !== current.revision) throw new Error(`Stale revision: base ${baseRevision}, current ${current.revision}.`);
    const revision = current.revision + 1;
    const dataset = clone(next);
    dataset.revision = revision;
    const occurredAt = confirmation.confirmedAt ?? new Date().toISOString();
    const historyEntry: KnowledgeHistoryEntry = {
      id: `revision-${revision}`,
      nodeId: "__graph__",
      kind: "revision_applied",
      summary: short(summary),
      occurredAt,
      revision,
    };
    dataset.history = [historyEntry, ...(dataset.history ?? [])];
    this.ensureValid(dataset);
    const record: KnowledgeRevisionRecord = {
      revision,
      parentRevision: current.revision,
      createdAt: occurredAt,
      actor: confirmation.confirmedBy,
      summary: short(summary),
      dataset,
    };
    this.repository.append(record);
    return clone(record);
  }

  rollback(targetRevision: number, confirmation: UserConfirmation): KnowledgeRevisionRecord {
    if (confirmation.confirmed !== true || !confirmation.confirmedBy.trim()) throw new Error("Explicit user confirmation is required.");
    const target = this.rollbackTargets().find((record) => record.revision === targetRevision);
    if (!target) throw new Error(`Revision ${targetRevision} is outside the two available historical versions.`);
    const current = this.records().at(-1)!;
    const revision = current.revision + 1;
    const occurredAt = confirmation.confirmedAt ?? new Date().toISOString();
    const dataset = clone(target.dataset);
    dataset.revision = revision;
    dataset.history = [{
      id: `rollback-${revision}-from-${targetRevision}`,
      nodeId: "__graph__",
      kind: "rollback",
      summary: `回滚到版本 ${targetRevision}`,
      occurredAt,
      revision,
    }, ...(current.dataset.history ?? [])];
    this.ensureValid(dataset);
    const record: KnowledgeRevisionRecord = {
      revision,
      parentRevision: current.revision,
      createdAt: occurredAt,
      actor: confirmation.confirmedBy,
      summary: `回滚到版本 ${targetRevision}`,
      restoredFromRevision: targetRevision,
      dataset,
    };
    this.repository.append(record);
    return clone(record);
  }

  private records(): readonly KnowledgeRevisionRecord[] {
    const records = this.repository.list();
    if (!records.length) throw new Error("Revision repository is empty.");
    return records;
  }

  private ensureValid(dataset: KnowledgeDataset): void {
    const report = validateKnowledgeDataset(dataset);
    if (!report.valid) throw new Error(`Invalid graph revision: ${report.errors.map((issue) => issue.code).join(", ")}`);
  }
}
