import type { RuntimeKnowledgeState } from "./runtime-repository";
import { getPostgresDb } from "../../db/postgres";
import { sql } from "drizzle-orm";

/**
 * Database-backed runtime envelope used during the JSON-to-relational cutover.
 * It provides durable CAS semantics before all RuntimeKnowledgeRepository methods
 * are normalized into individual PostgreSQL writes.
 */
export class PostgresRuntimeStateStore {
  private readonly db = getPostgresDb();

  async load(): Promise<RuntimeKnowledgeState | undefined> {
    const result = await this.db.execute(sql`select state from runtime_states where id = 'default'`);
    const row = result.rows[0] as { state?: RuntimeKnowledgeState } | undefined;
    return row?.state;
  }

  async insert(state: RuntimeKnowledgeState): Promise<void> {
    const checksum = JSON.stringify(state);
    await this.db.execute(sql`insert into runtime_states (id, content_revision, state, checksum) values ('default', ${state.contentRevision}, ${state}, ${checksum}) on conflict (id) do nothing`);
  }

  async save(state: RuntimeKnowledgeState, expectedRevision: number): Promise<void> {
    const checksum = JSON.stringify(state);
    await this.db.transaction(async (tx) => {
      const current = await tx.execute(sql`select content_revision from runtime_states where id = 'default' for update`);
      const currentRevision = Number((current.rows[0] as { content_revision?: number } | undefined)?.content_revision ?? -1);
      if (currentRevision !== expectedRevision) {
        throw new Error(`Stale runtime state: expected ${expectedRevision}, current ${currentRevision}.`);
      }
      await tx.execute(sql`update runtime_states set content_revision = ${state.contentRevision}, state = ${state}, checksum = ${checksum}, updated_at = now() where id = 'default'`);
    });
  }
}
