import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LlmProvider } from "../../core/llm/contracts";
import type { KnowledgeDataset } from "../../core/knowledge/schema";
import type { TaskProfile } from "../../plugin/contracts/task-profile";
import { applyOperations } from "../../core/agent/graph-operations";
import { datasetToAgentGraph } from "../../core/knowledge/portable-bundle";
import { validateKnowledgeDataset } from "../../core/knowledge/validation";
import { validateProfile } from "../profile/validate-profile";
import { collectAdaptiveResearch, type ResearchStats } from "./adaptive-research";
import { issueMvpToken, verifyMvpToken } from "./mvp-confirmation";
import { operationsFromResearch } from "./research-build";
import { networkToDataset, datasetToNetwork, type KnowledgeNetwork } from "./network-dataset";
import { applyApprovedBudget, parseApprovedResearchBudget, type ApprovedResearchBudget } from "../../core/agent/research-budget-policy";
import type { TopicQueueState } from "../../core/agent/topic-queue";
export type { KnowledgeNetwork } from "./network-dataset";
export type GenerationMode = "mvp" | "full";
export interface GenerationResult {
  network: KnowledgeNetwork; mode: GenerationMode; iterations: number;
  totalNodes: number; totalCardBlocks: number; totalRelations: number;
  distributedCalls: number; warnings: string[]; converged: boolean;
  stats: ResearchStats; researchRunId: string; mvpAcceptanceToken?: string;
}

export class KnowledgeGenerator {
  constructor(private provider: LlmProvider, private topic: string, private profile: TaskProfile,
    private mode: GenerationMode = "mvp") {
    validateProfile(profile);
    if (mode !== "mvp" && mode !== "full") throw new Error("mode 必须为 mvp 或 full");
  }

  initializeNetwork(): KnowledgeNetwork {
    const root = this.profile.initialization.rootNode;
    const nodes: KnowledgeNetwork["nodes"] = [{ id: root.id, canonicalName: root.name,
      shortFact: root.shortFact, nodeType: "domain", parentId: "", order: 0 }];
    for (const [i, d] of this.profile.domains.entries()) nodes.push({ id: d.id, canonicalName: d.name,
      shortFact: d.description, nodeType: "domain", parentId: root.id, domainId: d.id, order: i + 1 });
    return { nodes, cardBlocks: nodes.map(n => ({ nodeId: n.id, type: "definition", title: "基础定义与理论说明", text: n.shortFact })),
      relations: this.profile.edgeTypes.some(e => e.type === "PART_OF") ? this.profile.domains.map(d => ({ sourceId: d.id, targetId: root.id,
        type: "PART_OF", rationale: `${d.name} 是 ${root.name} 的一个语义域` })) : [] };
  }

  async generate(options: { initialNetwork?: KnowledgeNetwork; confirmedMvp?: boolean; mvpAcceptanceToken?: string; approvedBudget?: ApprovedResearchBudget; queueState?: TopicQueueState; extraDurationMinutes?: number; resumeRunId?: string; signal?: AbortSignal;
    onProgress?: (message: string) => void } = {}): Promise<GenerationResult> {
    if (this.mode === "full" && (!options.initialNetwork || options.confirmedMvp !== true || !options.mvpAcceptanceToken || !verifyMvpToken(options.mvpAcceptanceToken, this.profile.id, options.initialNetwork) || !options.approvedBudget)) {
      throw new Error("完整开发需要用户确认过的 initialNetwork、预算和有效的 mvpAcceptanceToken；请先完成 MVP 与预算验收");
    }
    const profile = this.mode === "full" ? applyApprovedBudget(this.profile, parseApprovedResearchBudget(options.approvedBudget)) : this.profile;
    const warnings: string[] = [];
    const report = (message: string) => { warnings.push(message); options.onProgress?.(message); };
    const dataset = networkToDataset(options.initialNetwork ?? this.initializeNetwork(), profile);
    const mvp = this.mode === "mvp";
    const rounds = Math.max(2, Math.min(3, profile.initialization.mvp.reactRounds[1]));
    const stats: ResearchStats = { rounds: 0, calls: 0, distributedCalls: 0, visitedTopics: 0, stopReason: "" };
    const runId = options.resumeRunId ?? `gen-${crypto.randomUUID()}`;
    const doc = await collectAdaptiveResearch({ provider: this.provider, dataset,
      nodeId: this.profile.initialization.rootNode.id, query: `生成${this.topic}知识网络。${mvp ? "MVP 仅生成骨架和 definition，不展开深度研究。15–30节点为参考目标。" : "继续已确认的 MVP；80–150节点为参考目标，不是上限。完善适用栏目和证据，不改变域划分。"}`,
      runId, root: true, observations: [], profile,
      signal: options.signal, onProgress: report, onStats: s => Object.assign(stats, s), queueState: options.queueState, extraDurationMinutes: options.extraDurationMinutes, resumeRunId: options.resumeRunId,
      maxExternalSearches: mvp ? 2 : undefined, allowDistributed: !mvp,
      budgetOverride: mvp ? { minRounds: 2, initialRounds: rounds, maxNodeRounds: rounds,
        maxCalls: 12, maxNodes: 1, minDurationMs: 0, maxDurationMs: 5 * 60_000 }
        : { maxDurationMs: Math.min(35, this.profile.initialization.full.rootBudgetMinutes[1]) * 60_000 },
    });
    const prepared = operationsFromResearch(doc, dataset, profile.initialization.rootNode.id);
    const graph = applyOperations({ ...datasetToAgentGraph(dataset), revision: 1 }, prepared.operations);
    const merged = { ...graph, domains: dataset.domains, formulas: graph.formulas ?? [] } as KnowledgeDataset;
    if (mvp) for (const card of merged.cards) card.blocks = card.blocks.filter(b => b.type === "definition");
    const network = datasetToNetwork(merged);
    const mvpAcceptanceToken = mvp ? issueMvpToken(this.profile.id, network) : undefined;
    const validated = networkToDataset(network, profile);
    const validation = validateKnowledgeDataset(validated, { profile });
    warnings.push(...validation.warnings.map(w => `${w.code}: ${w.message}`));
    if (doc.gaps.length) warnings.push(`剩余缺口: ${doc.gaps.join("；")}`);
    return { network, mode: this.mode, iterations: stats.rounds, totalNodes: network.nodes.length,
      totalCardBlocks: network.cardBlocks.length, totalRelations: network.relations.length,
      distributedCalls: stats.distributedCalls, warnings, converged: doc.converged, stats, researchRunId: runId, mvpAcceptanceToken };
  }

  writeNetworkToFile(network: KnowledgeNetwork, outputPath?: string): string {
    const filePath = outputPath || join(process.cwd(), "data", "runtime", `generated-${this.mode}-${Date.now()}.json`);
    networkToDataset(network, this.profile);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(network, null, 2), { encoding: "utf8", flag: "wx" });
    return filePath;
  }
}
export default KnowledgeGenerator;
