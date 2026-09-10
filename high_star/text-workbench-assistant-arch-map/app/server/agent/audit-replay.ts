import type { AgentGraphData, AgentGraphSnapshot, AuditEvent } from "../../core/agent/contracts";
import { applyOperations } from "../../core/agent/graph-operations";

export function replayAudit(
  initial: AgentGraphData,
  events: readonly AuditEvent[],
  initialRevision = 0,
): AgentGraphSnapshot {
  let current: AgentGraphSnapshot = structuredClone({ ...initial, revision: initialRevision });
  const history = new Map<number, AgentGraphSnapshot>([[initialRevision, structuredClone(current)]]);
  let expectedSequence = 1;

  for (const event of events) {
    if (event.sequence !== expectedSequence) {
      throw new Error(`Audit sequence gap at ${expectedSequence}.`);
    }
    expectedSequence += 1;
    if (event.type === "revision.applied") {
      if (!event.patch) throw new Error("Applied revision audit event is missing its patch.");
      if (event.patch.baseRevision !== current.revision || event.revision !== current.revision + 1) {
        throw new Error("Applied revision audit event is inconsistent.");
      }
      current = applyOperations(current, event.patch.operations, event.revision);
      history.set(current.revision, structuredClone(current));
    }
    if (event.type === "revision.rollback") {
      const targetRevision = event.rollbackTargetRevision;
      if (targetRevision === undefined) throw new Error("Rollback audit event has no target revision.");
      const target = history.get(targetRevision);
      if (!target || event.revision !== current.revision + 1) {
        throw new Error("Rollback audit event is inconsistent.");
      }
      current = { ...structuredClone(target), revision: event.revision };
      history.set(current.revision, structuredClone(current));
    }
  }
  return current;
}
