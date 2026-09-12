import type { GraphPatch, KnowledgeProposal, ReviewReport } from "../../core/agent/contracts";
import type { PersistentAgentRun } from "../../core/agent/run-state";
import { applyOperations, deterministicId } from "../../core/agent/graph-operations";
import { agentGraphToDataset, datasetChecksum, datasetToAgentGraph } from "../../core/knowledge/portable-bundle";
import type { KnowledgeDataset } from "../../core/knowledge/schema";
import { isVerifiedConfirmationProof, type VerifiedConfirmationProof } from "../security/confirmation-token";
import type { PersistentPendingChange, RuntimeAuditEvent, RuntimeKnowledgeState, KnowledgeSavepoint } from "./runtime-repository";
import { PostgresRuntimeStateStore } from "./postgres-runtime-state-store";

const clone = <T>(value: T): T => structuredClone(value);
const short = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 96);

function initialState(seed: KnowledgeDataset): RuntimeKnowledgeState {
  const dataset = clone(seed); const at = new Date().toISOString();
  return { contentRevision: dataset.revision, dataset, savepoints: [{ id: `savepoint-${dataset.revision}-initial`, contentRevision: dataset.revision, label: "离线基线", savedAt: at, savedBy: "system", checksum: datasetChecksum(dataset), dataset: clone(dataset) }], audit: [{ id: "audit-1-runtime-initialized", sequence: 1, at, actor: "system", kind: "runtime.initialized", contentRevision: dataset.revision, summary: "初始化运行时知识图谱" }], committedPatchIds: [], usedConfirmationNonces: [], runs: [], pendingChanges: [] };
}

/** PostgreSQL implementation using the runtime envelope during the relational cutover. */
export class PostgresRuntimeKnowledgeRepository {
  private readonly store = new PostgresRuntimeStateStore();
  constructor(private readonly seed: KnowledgeDataset) {}
  private async read() { const state = await this.store.load(); if (!state) { const created = initialState(this.seed); await this.store.insert(created); return created; } return state; }
  async snapshot() { return clone((await this.read()).dataset); }
  async state() { return clone(await this.read()); }
  async rollbackTargets() { const state = await this.read(); return clone(state.savepoints.slice(0, -1).slice(-2).reverse()); }
  async getRun(runId: string) { const run = (await this.read()).runs.find(item => item.id === runId); return run ? clone(run) : undefined; }
  async putRun(run: PersistentAgentRun) { const state = await this.read(); const index = state.runs.findIndex(item => item.id === run.id); if (index >= 0) state.runs[index] = clone(run); else state.runs.push(clone(run)); this.audit(state, "agent.run", "development-agent", `${run.kind}:${run.status}`, run); await this.store.save(state, state.contentRevision); return clone(run); }
  async getPendingChange(patchId: string, sessionId: string) { const item = (await this.read()).pendingChanges.find(candidate => candidate.patchId === patchId && candidate.sessionId === sessionId); return item ? clone(item) : undefined; }
  async putPendingChange(candidate: PersistentPendingChange) { const state = await this.read(); state.pendingChanges = state.pendingChanges.filter(item => item.patchId !== candidate.patchId); state.pendingChanges.push(clone(candidate)); this.audit(state, "agent.run", "development-agent", `pending:${candidate.patchId}`, candidate); await this.store.save(state, state.contentRevision); return clone(candidate); }
  async removePendingChange(patchId: string) { const state = await this.read(); state.pendingChanges = state.pendingChanges.filter(item => item.patchId !== patchId); await this.store.save(state, state.contentRevision); }
  async applyConfirmedPatch(patch: GraphPatch, proof: VerifiedConfirmationProof, actor: string) {
    const state = await this.read();
    if (state.committedPatchIds.includes(patch.id)) return { dataset: clone(state.dataset), idempotent: true };
    if (!isVerifiedConfirmationProof(proof)) throw new Error("A verified server confirmation is required.");
    if (state.usedConfirmationNonces.includes(proof.nonce)) throw new Error("Confirmation token was already consumed.");
    if (proof.patchId !== patch.id || proof.baseRevision !== patch.baseRevision || proof.patchHash !== deterministicId("patch", patch)) throw new Error("Confirmation proof does not match this patch.");
    if (patch.baseRevision !== state.contentRevision) throw new Error(`Stale patch: base ${patch.baseRevision}, current ${state.contentRevision}.`);
    const projected = applyOperations({ ...datasetToAgentGraph(state.dataset), revision: state.contentRevision }, patch.operations, state.contentRevision + 1);
    state.dataset = agentGraphToDataset(projected); state.contentRevision = projected.revision; state.committedPatchIds.push(patch.id); state.usedConfirmationNonces.push(proof.nonce); this.audit(state, "patch.applied", actor, patch.summary, patch);
    await this.store.save(state, patch.baseRevision); return { dataset: clone(state.dataset), idempotent: false };
  }
  async createSavepoint(label: string, savedBy: string) { if (!savedBy.trim()) throw new Error("A user identity is required to save a version."); const state = await this.read(); const savedAt = new Date().toISOString(); const savepoint: KnowledgeSavepoint = { id: deterministicId("savepoint", { revision: state.contentRevision, label, savedAt, savedBy }), contentRevision: state.contentRevision, label: short(label || `版本 ${state.contentRevision}`), savedAt, savedBy, checksum: datasetChecksum(state.dataset), dataset: clone(state.dataset) }; state.savepoints = [...state.savepoints, savepoint].slice(-3); this.audit(state, "savepoint.created", savedBy, `保存版本：${savepoint.label}`, savepoint); await this.store.save(state, state.contentRevision); return clone(savepoint); }
  async rollback(savepointId: string, actor: string) { const state = await this.read(); const target = state.savepoints.slice(0, -1).slice(-2).find(item => item.id === savepointId); if (!target) throw new Error("Only the two historical savepoints can be restored."); const nextRevision = state.contentRevision + 1; state.dataset = clone(target.dataset); state.dataset.revision = nextRevision; state.contentRevision = nextRevision; this.audit(state, "savepoint.rollback", actor, `回滚到：${target.label}`, { savepointId }); state.savepoints = [...state.savepoints, { id: deterministicId("savepoint", { revision: nextRevision, target: target.id }), contentRevision: nextRevision, label: `回滚：${target.label}`, savedAt: new Date().toISOString(), savedBy: actor, checksum: datasetChecksum(state.dataset), dataset: clone(state.dataset) }].slice(-3); await this.store.save(state, nextRevision - 1); return clone(state.dataset); }
  private audit(state: RuntimeKnowledgeState, kind: RuntimeAuditEvent["kind"], actor: string, summary: string, details?: unknown) { state.audit.push({ id: `audit-${state.audit.length + 1}-${kind}`, sequence: state.audit.length + 1, at: new Date().toISOString(), actor, kind, contentRevision: state.contentRevision, summary: short(summary), ...(details === undefined ? {} : { detailsHash: deterministicId("details", details) }) }); }
}
