import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { GraphPatch, KnowledgeProposal, ReviewReport } from "../../core/agent/contracts";
import type { PersistentAgentRun } from "../../core/agent/run-state";
import { applyOperations, deterministicId } from "../../core/agent/graph-operations";
import {
  agentGraphToDataset,
  datasetChecksum,
  datasetToAgentGraph,
} from "../../core/knowledge/portable-bundle";
import type { KnowledgeDataset } from "../../core/knowledge/schema";
import {
  isVerifiedConfirmationProof,
  type VerifiedConfirmationProof,
} from "../security/confirmation-token";

export type RuntimeAuditKind =
  | "runtime.initialized"
  | "patch.applied"
  | "patch.rejected"
  | "savepoint.created"
  | "savepoint.rollback"
  | "agent.run";

export interface RuntimeAuditEvent {
  id: string;
  sequence: number;
  at: string;
  actor: string;
  kind: RuntimeAuditKind;
  contentRevision: number;
  summary: string;
  detailsHash?: string;
}

export interface KnowledgeSavepoint {
  id: string;
  contentRevision: number;
  label: string;
  savedAt: string;
  savedBy: string;
  checksum: string;
  dataset: KnowledgeDataset;
}

export interface RuntimeKnowledgeState {
  contentRevision: number;
  dataset: KnowledgeDataset;
  savepoints: KnowledgeSavepoint[];
  audit: RuntimeAuditEvent[];
  committedPatchIds: string[];
  usedConfirmationNonces: string[];
  runs: PersistentAgentRun[];
  pendingChanges: PersistentPendingChange[];
}

export interface PersistentPendingChange {
  runId: string;
  patchId: string;
  sessionId: string;
  proposal: KnowledgeProposal;
  review: ReviewReport;
  patch: GraphPatch;
  confirmationToken: string;
  confirmationExpiresAt: number;
}

type RuntimeFile = {
  schemaVersion: "fmcw-runtime/1";
  state: RuntimeKnowledgeState;
  checksum: string;
};

const clone = <T>(value: T): T => structuredClone(value);
const short = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 96);

function stateChecksum(state: RuntimeKnowledgeState): string {
  return deterministicId("runtime", JSON.parse(JSON.stringify(state)));
}

function initialState(seed: KnowledgeDataset): RuntimeKnowledgeState {
  const at = new Date().toISOString();
  const dataset = clone(seed);
  const savepoint: KnowledgeSavepoint = {
    id: `savepoint-${dataset.revision}-initial`,
    contentRevision: dataset.revision,
    label: "离线基线",
    savedAt: at,
    savedBy: "system",
    checksum: datasetChecksum(dataset),
    dataset: clone(dataset),
  };
  return {
    contentRevision: dataset.revision,
    dataset,
    savepoints: [savepoint],
    audit: [{
      id: "audit-1-runtime-initialized",
      sequence: 1,
      at,
      actor: "system",
      kind: "runtime.initialized",
      contentRevision: dataset.revision,
      summary: "初始化运行时知识图谱",
    }],
    committedPatchIds: [],
    usedConfirmationNonces: [],
    runs: [],
    pendingChanges: [],
  };
}

export class RuntimeKnowledgeRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly seed: KnowledgeDataset) {
    if (!existsSync(filePath) && !existsSync(this.backupPath())) this.write(initialState(seed));
    this.read();
  }

  snapshot(): KnowledgeDataset {
    return clone(this.read().dataset);
  }

  state(): RuntimeKnowledgeState {
    return clone(this.read());
  }

  rollbackTargets(): readonly KnowledgeSavepoint[] {
    return clone(this.read().savepoints.slice(0, -1).slice(-2).reverse());
  }

  getRun(runId: string): PersistentAgentRun | undefined {
    const run = this.read().runs.find((item) => item.id === runId);
    return run ? clone(run) : undefined;
  }

  putRun(run: PersistentAgentRun): Promise<PersistentAgentRun> {
    return this.serial(async () => {
      const state = this.read();
      const index = state.runs.findIndex((item) => item.id === run.id);
      if (index >= 0) state.runs[index] = clone(run);
      else state.runs.push(clone(run));
      this.audit(state, "agent.run", "development-agent", `${run.kind}:${run.status}`, run);
      this.write(state);
      return clone(run);
    });
  }

  getPendingChange(patchId: string, sessionId: string): PersistentPendingChange | undefined {
    const item = this.read().pendingChanges.find((candidate) => candidate.patchId === patchId && candidate.sessionId === sessionId);
    return item ? clone(item) : undefined;
  }

  putPendingChange(candidate: PersistentPendingChange): Promise<PersistentPendingChange> {
    return this.serial(async () => {
      const state = this.read();
      state.pendingChanges = state.pendingChanges.filter((item) => item.patchId !== candidate.patchId);
      state.pendingChanges.push(clone(candidate));
      this.audit(state, "agent.run", "development-agent", `pending:${candidate.patchId}`, candidate);
      this.write(state);
      return clone(candidate);
    });
  }

  removePendingChange(patchId: string): Promise<void> {
    return this.serial(async () => {
      const state = this.read();
      state.pendingChanges = state.pendingChanges.filter((item) => item.patchId !== patchId);
      this.write(state);
    });
  }

  applyConfirmedPatch(
    patch: GraphPatch,
    proof: VerifiedConfirmationProof,
    actor: string,
  ): Promise<{ dataset: KnowledgeDataset; idempotent: boolean }> {
    return this.serial(async () => {
      const state = this.read();
      if (state.committedPatchIds.includes(patch.id)) return { dataset: clone(state.dataset), idempotent: true };
      if (!isVerifiedConfirmationProof(proof)) throw new Error("A verified server confirmation is required.");
      if (state.usedConfirmationNonces.includes(proof.nonce)) throw new Error("Confirmation token was already consumed.");
      if (proof.patchId !== patch.id || proof.baseRevision !== patch.baseRevision || proof.patchHash !== deterministicId("patch", patch)) {
        throw new Error("Confirmation proof does not match this patch.");
      }
      if (patch.baseRevision !== state.contentRevision) {
        throw new Error(`Stale patch: base ${patch.baseRevision}, current ${state.contentRevision}.`);
      }
      const projected = applyOperations(
        { ...datasetToAgentGraph(state.dataset), revision: state.contentRevision },
        patch.operations,
        state.contentRevision + 1,
      );
      state.dataset = agentGraphToDataset(projected);
      state.contentRevision = projected.revision;
      state.committedPatchIds.push(patch.id);
      state.usedConfirmationNonces.push(proof.nonce);
      this.audit(state, "patch.applied", actor, patch.summary, patch);
      this.write(state);
      return { dataset: clone(state.dataset), idempotent: false };
    });
  }

  createSavepoint(label: string, savedBy: string): Promise<KnowledgeSavepoint> {
    return this.serial(async () => {
      if (!savedBy.trim()) throw new Error("A user identity is required to save a version.");
      const state = this.read();
      const savedAt = new Date().toISOString();
      const savepoint: KnowledgeSavepoint = {
        id: deterministicId("savepoint", { revision: state.contentRevision, label, savedAt, savedBy }),
        contentRevision: state.contentRevision,
        label: short(label || `版本 ${state.contentRevision}`),
        savedAt,
        savedBy,
        checksum: datasetChecksum(state.dataset),
        dataset: clone(state.dataset),
      };
      state.savepoints = [...state.savepoints, savepoint].slice(-3);
      this.audit(state, "savepoint.created", savedBy, `保存版本：${savepoint.label}`, savepoint);
      this.write(state);
      return clone(savepoint);
    });
  }

  rollback(savepointId: string, actor: string): Promise<KnowledgeDataset> {
    return this.serial(async () => {
      const state = this.read();
      const target = state.savepoints.slice(0, -1).slice(-2).find((item) => item.id === savepointId);
      if (!target) throw new Error("Only the two historical savepoints can be restored.");
      const nextRevision = state.contentRevision + 1;
      state.dataset = clone(target.dataset);
      state.dataset.revision = nextRevision;
      state.contentRevision = nextRevision;
      this.audit(state, "savepoint.rollback", actor, `回滚到：${target.label}`, { savepointId });
      const savedAt = new Date().toISOString();
      state.savepoints = [...state.savepoints, {
        id: deterministicId("savepoint", { revision: nextRevision, target: target.id, savedAt }),
        contentRevision: nextRevision,
        label: `回滚：${target.label}`,
        savedAt,
        savedBy: actor,
        checksum: datasetChecksum(state.dataset),
        dataset: clone(state.dataset),
      }].slice(-3);
      this.write(state);
      return clone(state.dataset);
    });
  }

  private audit(state: RuntimeKnowledgeState, kind: RuntimeAuditKind, actor: string, summary: string, details?: unknown): void {
    const sequence = state.audit.length + 1;
    state.audit.push({
      id: `audit-${sequence}-${kind}`,
      sequence,
      at: new Date().toISOString(),
      actor,
      kind,
      contentRevision: state.contentRevision,
      summary: short(summary),
      ...(details === undefined ? {} : { detailsHash: deterministicId("details", details) }),
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private read(): RuntimeKnowledgeState {
    const primary = this.tryRead(this.filePath);
    if (primary) return primary;
    const backup = this.tryRead(this.backupPath());
    if (!backup) throw new Error("Runtime knowledge store is corrupt and no valid backup exists.");
    this.write(backup);
    return backup;
  }

  private tryRead(path: string): RuntimeKnowledgeState | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const file = JSON.parse(readFileSync(path, "utf8")) as RuntimeFile;
      if (file.schemaVersion !== "fmcw-runtime/1") return undefined;
      if (file.checksum !== stateChecksum(file.state)) return undefined;
      file.state.usedConfirmationNonces ??= [];
      file.state.runs ??= [];
      file.state.pendingChanges ??= [];
      if (file.state.dataset.revision !== file.state.contentRevision) return undefined;
      for (const savepoint of file.state.savepoints) {
        if (savepoint.checksum !== datasetChecksum(savepoint.dataset)) return undefined;
      }
      return file.state;
    } catch {
      return undefined;
    }
  }

  private write(state: RuntimeKnowledgeState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    const file: RuntimeFile = { schemaVersion: "fmcw-runtime/1", state, checksum: stateChecksum(state) };
    writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    if (existsSync(this.filePath)) copyFileSync(this.filePath, this.backupPath());
    if (existsSync(this.filePath)) {
      copyFileSync(temporary, this.filePath);
      unlinkSync(temporary);
    } else {
      renameSync(temporary, this.filePath);
    }
  }

  private backupPath(): string {
    return `${this.filePath}.bak`;
  }
}
