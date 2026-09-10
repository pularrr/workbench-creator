import { agentQueue } from "../queue/agent-queue";
import { runtimeAgentJobStore } from "./job-store";
import { startAgentJob } from "./background-jobs";

if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required.");
process.env.AGENT_QUEUE_MODE = "redis";
const queue = agentQueue();
console.log("Agent Redis worker started.");

while (true) {
  const id = await queue.dequeue();
  if (!id) continue;
  const stored = await runtimeAgentJobStore().load(id);
  if (!stored || (stored.job.state !== "queued" && stored.job.state !== "running")) continue;
  if (await queue.isCancelled(id)) continue;
  await startAgentJob({ id, sessionId: stored.job.sessionId, nodeId: stored.job.nodeId, kind: stored.job.kind, query: stored.job.query, sourceText: stored.job.sourceText, sourceKind: stored.job.sourceKind });
}
