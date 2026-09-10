import { createClient, type RedisClientType } from "redis";

export interface AgentQueue {
  enqueue(jobId: string): Promise<void>;
  dequeue(signal?: AbortSignal): Promise<string | undefined>;
  cancel(jobId: string): Promise<void>;
  isCancelled(jobId: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Redis-backed queue. PostgreSQL remains the source of truth for job state. */
export class RedisAgentQueue implements AgentQueue {
  private readonly client: RedisClientType;
  private connected = false;
  constructor(private readonly queueKey = process.env.AGENT_QUEUE_KEY ?? "queue:agent") {
    this.client = createClient({ url: process.env.REDIS_URL });
    this.client.on("error", (error) => console.error("Redis queue error", error));
  }
  private async connect() { if (!this.connected) { await this.client.connect(); this.connected = true; } }
  async enqueue(jobId: string) { await this.connect(); await this.client.lPush(this.queueKey, jobId); }
  async dequeue(signal?: AbortSignal) {
    await this.connect();
    if (signal?.aborted) return undefined;
    const result = await this.client.brPop(this.queueKey, 5);
    return result?.element;
  }
  async cancel(jobId: string) { await this.connect(); await this.client.set(`job:${jobId}:cancel`, "1", { EX: 86400 }); }
  async isCancelled(jobId: string) { await this.connect(); return (await this.client.exists(`job:${jobId}:cancel`)) === 1; }
  async close() { if (this.connected) await this.client.quit(); this.connected = false; }
}

const holder = globalThis as typeof globalThis & { __agentQueue?: AgentQueue };
export function agentQueue(): AgentQueue {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required for distributed Agent jobs.");
  return holder.__agentQueue ??= new RedisAgentQueue();
}
