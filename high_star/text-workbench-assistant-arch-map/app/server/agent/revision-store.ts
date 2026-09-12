import type {
  AgentGraphData,
  AgentGraphSnapshot,
  CommitResult,
  ConfirmationReceipt,
  GraphPatch,
  Revision,
  RollbackResult,
  UserConfirmation,
} from "../../core/agent/contracts";
import { applyOperations } from "../../core/agent/graph-operations";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryRevisionStore {
  private current: AgentGraphSnapshot;
  private readonly history = new Map<Revision, AgentGraphSnapshot>();
  private readonly receipts = new Set<string>();
  private readonly committedPatches = new Map<string, CommitResult>();
  private confirmationSequence = 0;

  constructor(initial: AgentGraphData, initialRevision = 0) {
    this.current = clone({ ...initial, revision: initialRevision });
    this.history.set(initialRevision, clone(this.current));
  }

  snapshot(): AgentGraphSnapshot {
    return clone(this.current);
  }

  revisionHistory(): readonly Revision[] {
    return [...this.history.keys()].sort((left, right) => left - right);
  }

  rollbackTargets(limit = 2): readonly Revision[] {
    return this.revisionHistory().filter((revision) => revision < this.current.revision).slice(-limit).reverse();
  }

  authorize(
    action: ConfirmationReceipt["action"],
    subject: string,
    confirmation: UserConfirmation,
  ): ConfirmationReceipt {
    if (confirmation.confirmed !== true || !confirmation.confirmedBy.trim()) {
      throw new Error("Explicit user confirmation is required.");
    }
    this.confirmationSequence += 1;
    const receipt: ConfirmationReceipt = {
      action,
      subject,
      confirmedBy: confirmation.confirmedBy,
      confirmedAt: confirmation.confirmedAt ?? new Date().toISOString(),
      nonce: `offline-confirmation-${this.confirmationSequence}`,
    };
    this.receipts.add(this.receiptKey(receipt));
    return receipt;
  }

  apply(patch: GraphPatch, receipt: ConfirmationReceipt): CommitResult {
    const committed = this.committedPatches.get(patch.id);
    if (committed) return { ...committed, idempotent: true };
    this.consume(receipt, "apply", patch.id);
    if (patch.baseRevision !== this.current.revision) {
      throw new Error(`Stale patch: base ${patch.baseRevision}, current ${this.current.revision}.`);
    }
    const previousRevision = this.current.revision;
    const revision = previousRevision + 1;
    this.current = applyOperations(this.current, patch.operations, revision);
    this.history.set(revision, clone(this.current));
    this.pruneSavedVersions();
    const result: CommitResult = {
      patchId: patch.id,
      previousRevision,
      revision,
      appliedAt: new Date().toISOString(),
      idempotent: false,
    };
    this.committedPatches.set(patch.id, result);
    return result;
  }

  rollback(targetRevision: Revision, receipt: ConfirmationReceipt): RollbackResult {
    this.consume(receipt, "rollback", String(targetRevision));
    if (!this.rollbackTargets().includes(targetRevision)) {
      throw new Error(`Revision ${targetRevision} is outside the two available historical versions.`);
    }
    const target = this.history.get(targetRevision);
    if (!target) throw new Error(`Revision ${targetRevision} does not exist.`);
    const previousRevision = this.current.revision;
    const revision = previousRevision + 1;
    this.current = { ...clone(target), revision };
    this.history.set(revision, clone(this.current));
    this.pruneSavedVersions();
    return {
      restoredFromRevision: targetRevision,
      previousRevision,
      revision,
      appliedAt: new Date().toISOString(),
    };
  }

  private pruneSavedVersions(): void {
    const revisions = [...this.history.keys()].sort((left, right) => left - right);
    for (const revision of revisions.slice(0, -3)) this.history.delete(revision);
  }

  private receiptKey(receipt: ConfirmationReceipt): string {
    return `${receipt.nonce}:${receipt.action}:${receipt.subject}`;
  }

  private consume(
    receipt: ConfirmationReceipt,
    action: ConfirmationReceipt["action"],
    subject: string,
  ): void {
    const key = this.receiptKey(receipt);
    if (receipt.action !== action || receipt.subject !== subject || !this.receipts.delete(key)) {
      throw new Error("A valid, unused user confirmation is required before graph mutation.");
    }
  }
}
