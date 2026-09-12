import { z } from "zod";
import type { LlmProvider, LlmMessage, LlmResponseResult } from "../../core/llm/contracts";
import { completeArrayObjects, fitResearchMessages, nextResearchBudget } from "./research-budget";

const block = z.object({
  nodeId: z.string().optional(), type: z.string().default("research_topic"),
  title: z.string().default("知识补充"), text: z.string().default(""),
  items: z.array(z.string()).optional(), code: z.string().optional(),
  language: z.enum(["python", "matlab", "typescript", "text"]).optional(),
});
const node = z.object({
  id: z.string().optional(), canonicalName: z.string().min(1),
  shortFact: z.string().min(1), nodeType: z.string().default("concept"),
  nodeRole: z.enum(["domain", "category", "entity"]).optional(),
  parentId: z.string().optional(), relationshipType: z.string().optional(),
  relationshipRationale: z.string().optional(), blocks: z.array(block).default([]),
});
export const researchSchema = z.object({
  answer: z.string().default(""), coverageAssessment: z.string().default(""),
  converged: z.boolean().default(false), gaps: z.array(z.string()).default([]),
  categoryPlan: z.array(z.object({
    parentId: z.string(),
    categories: z.array(z.string()),
    reparentHints: z.array(z.object({ leafName: z.string(), toCategory: z.string() })).optional(),
  })).optional(),
  proposal: z.object({
    summary: z.string().default("知识扩充"), rationale: z.string().default(""),
    cardBlocks: z.array(block).max(100).default([]), newNodes: z.array(node).max(100).default([]),
    evidence: z.array(z.object({ title: z.string(), url: z.string().optional(), note: z.string().optional() })).max(100).default([]),
    relations: z.array(z.object({ sourceId: z.string(), targetId: z.string(), type: z.string(), rationale: z.string() })).max(100).default([]),
  }).default({}),
});
export type ResearchDocument = z.infer<typeof researchSchema>;
export type ProposedNode = ResearchDocument["proposal"]["newNodes"][number];

/** Accept envelopes and fenced JSON, but never invent missing/truncated claims. */
export function parseObject(text: string): unknown {
  const candidates = [text.trim(), ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (m) => m[1])];
  // Balanced scanning respects braces inside JSON strings.
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < text.length; end++) {
      const c = text[end];
      if (escaped) { escaped = false; continue; }
      if (c === "\\" && quoted) { escaped = true; continue; }
      if (c === '"') { quoted = !quoted; continue; }
      if (!quoted) { if (c === "{") depth++; if (c === "}") depth--; }
      if (!depth) { candidates.push(text.slice(start, end + 1)); break; }
    }
    if (candidates.length > 12) break;
  }
  for (const raw of candidates) {
    try { return JSON.parse(raw); } catch { /* Ask the model to repair rather than silently corrupting LaTeX. */ }
  }
  return undefined;
}

export function normalizeResearch(value: unknown): ResearchDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("输出必须为 JSON 对象");
  let obj = value as Record<string, unknown>;
  for (const key of ["result", "data", "research"]) {
    if (!obj.proposal && obj[key] && typeof obj[key] === "object") obj = obj[key] as Record<string, unknown>;
  }
  if (!("proposal" in obj) && ("newNodes" in obj || "cardBlocks" in obj || "operations" in obj || "new_nodes" in obj)) obj = { proposal: obj };
  if (!("proposal" in obj) && !("answer" in obj)) throw new Error("缺少 answer/proposal 字段");
  const p = obj.proposal;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const proposal = p as Record<string, unknown>;
    const mapped: Record<string, unknown> = {
      ...proposal,
      newNodes: proposal.newNodes ?? proposal.new_nodes ?? proposal.nodes ?? [],
      cardBlocks: proposal.cardBlocks ?? proposal.card_blocks ?? proposal.blocks ?? [],
    };
    if (Array.isArray(proposal.operations)) {
      const operations = proposal.operations as Array<Record<string, unknown>>;
      if (operations.some((op) => !["upsert-node","upsert-card","upsert-edge","upsert-evidence"].includes(String(op.kind)))) throw new Error("提案包含未支持的变更类型，需改为节点/卡片/关系/证据");
      mapped.newNodes = operations.filter((op) => op.kind === "upsert-node").map((op) => op.node);
      mapped.cardBlocks = operations.filter((op) => op.kind === "upsert-card").flatMap((op) => {
        const card = op.card as {nodeId?:string;blocks?:Array<Record<string,unknown>>};
        return (card.blocks ?? []).map((b) => ({...b,nodeId:card.nodeId}));
      });
      mapped.relations = operations.filter((op) => op.kind === "upsert-edge").map((op) => op.edge);
      mapped.evidence = operations.filter((op) => op.kind === "upsert-evidence").map((op) => op.evidence);
    }
    const mapBlock = (item: unknown) => {
      if (!item || typeof item !== "object") return item;
      const b = item as Record<string,unknown>;
      return {...b,nodeId:b.nodeId ?? b.node_id,type:b.type ?? b.category,text:b.text ?? b.content ?? ""};
    };
    if (Array.isArray(mapped.newNodes)) mapped.newNodes = mapped.newNodes.map((item: unknown) => {
      if (!item || typeof item !== "object") return item;
      const n = item as Record<string,unknown>;
      return {...n,canonicalName:n.canonicalName ?? n.canonical_name ?? n.name,shortFact:n.shortFact ?? n.short_fact ?? n.description ?? n.definition,
        parentId:n.parentId ?? n.primaryParentId ?? n.parent_id,nodeType:n.nodeType ?? n.node_type,nodeRole:n.nodeRole ?? n.node_role,
        blocks:Array.isArray(n.blocks) ? n.blocks.map(mapBlock) : n.blocks ?? []};
    });
    if (Array.isArray(mapped.cardBlocks)) mapped.cardBlocks = mapped.cardBlocks.map(mapBlock);
    obj = { ...obj, proposal: mapped };
  } else if (p === null) obj = { ...obj, proposal: {} };
  // Optional nulls are common across OpenAI-compatible providers.
  const optional = new Set(["nodeId","id","parentId","nodeType","nodeRole","relationshipType","relationshipRationale","language","items","code","url","note"]);
  const cleaned = JSON.parse(JSON.stringify(obj, (key, item) => item === null && optional.has(key) ? undefined : item));
  return researchSchema.parse(cleaned);
}

export const RESEARCH_CONTRACT = `返回 JSON 对象：
{"answer":"研究小结","coverageAssessment":"已覆盖与缺口","converged":false,"gaps":["仍需探索的问题"],"proposal":{"summary":"摘要","rationale":"理由","newNodes":[{"id":"稳定英文或拼音ID","canonicalName":"具体名称","shortFact":"一句话概述","nodeRole":"domain|category|entity","nodeType":"concept|method|algorithm|model|problem|parameter|metric|application|component|artifact|category","parentId":"已有或本批新父节点ID","blocks":[{"type":"definition","title":"基础定义与理论说明","text":"与节点类型相符的完整知识"}]}],"cardBlocks":[{"nodeId":"节点ID","type":"principle","title":"原理、机制与推导","text":"完整知识"}],"relations":[{"sourceId":"节点ID","targetId":"节点ID","type":"PREREQUISITE_OF","rationale":"方向和理由"}],"evidence":[{"title":"真实来源或模型领域知识","url":"仅在已核实时填写","note":"来源支持什么；未经外部检索明确标注模型知识待核验"}]}}。
domain 是领域导航，category 是分类概括，entity 才是单一具体知识对象。definition 是基础定义与理论说明；按类型写定义、概念、方法基本思想、模型对象/变量、问题表现或组件职责。完整机制放 principle，条件放 assumptions，比较放 comparison，步骤放 procedure。按本次批次上限生成完整条目；没有足够新增知识时允许少量或零个节点。模型的 converged 只是建议，未完成主题必须留在 gaps。纯 JSON，不含思维过程；字符串内的换行及 LaTeX 反斜杠必须按 JSON 转义。不要假装查阅过未获得的网页。`;

export type ResearchRequestPurpose = "research" | "ingest" | "summary" | "repair";

export async function requestResearch(provider: LlmProvider, instructions: string, messages: LlmMessage[], options: {
  tokens?: number; signal?: AbortSignal; onCall?: () => void; onDiagnostic?: (message: string) => void;
  purpose?: ResearchRequestPurpose;
} = {}): Promise<{ document: ResearchDocument; response: LlmResponseResult }> {
  let repair = "";
  let failure = "";
  const outputLimit = provider.limits?.maxOutputTokens ?? 16384;
  let outputBudget = Math.min(options.tokens ?? 8192, outputLimit);
  let zeroTextTruncation = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    options.onCall?.();
    const summaryLike = options.purpose === "summary" || options.purpose === "ingest";
    const constrained = zeroTextTruncation || attempt > 0;
    const maxNodes = constrained ? 1 : summaryLike ? 2 : 6;
    const maxBlocks = constrained ? 2 : summaryLike ? 4 : 8;
    const textLimit = constrained ? 320 : summaryLike ? 480 : 600;
    const batchInstructions = instructions + "\n" + RESEARCH_CONTRACT
      + `\n本批最多 ${maxNodes} 个新节点、${maxBlocks} 个独立卡片补充。优先完整输出，更多知识留在 gaps 中由下一轮继续；不要为凑数量建节点。每项正文控制在${textLimit}字以内。`
      + (summaryLike ? "资料总结只提取与当前节点直接相关、可形成图谱变更的内容；先输出少量完整 JSON，再处理其余资料。" : "");
    const response = await provider.createResponse({
      instructions: batchInstructions,
      messages: fitResearchMessages(messages,batchInstructions,repair,provider.limits?.maxInputChars ?? 120000),
      maxOutputTokens: outputBudget,
      signal: options.signal,
    });
    try {
      if (response.status === "incomplete") {
        const partial = {
          newNodes: completeArrayObjects(response.text,"newNodes"),
          cardBlocks: completeArrayObjects(response.text,"cardBlocks"),
          evidence: completeArrayObjects(response.text,"evidence"),
          relations: completeArrayObjects(response.text,"relations"),
        };
        if (partial.newNodes.length || partial.cardBlocks.length) {
          const document = normalizeResearch({answer:"该批输出达到上限，已保留完整知识条目，未完成内容留待后续批次。",converged:false,gaps:["继续补齐上一批截断部分，并核验来源和父节点引用"],proposal:partial});
          options.onDiagnostic?.("输出达到上限，已保留 " + partial.newNodes.length + " 个完整节点、" + partial.cardBlocks.length + " 个完整卡片条目，继续下一批。");
          return {document,response};
        }
        zeroTextTruncation ||= response.text.trim().length === 0;
        outputBudget = nextResearchBudget(outputBudget,outputLimit,true);
        if (zeroTextTruncation) {
          throw new Error("模型推理预算耗尽，尚未产生可解析 JSON：" + response.incompleteReason + "；输出token " + (response.usage?.outputTokens ?? "未知") + "；推理token " + (response.usage?.reasoningTokens ?? "未知") + "；下一次将缩小为1个节点和2张卡片，预算 " + outputBudget);
        }
        throw new Error("输出被截断：" + response.incompleteReason + "；已生成文本 " + response.text.length + " 字符；输出token " + (response.usage?.outputTokens ?? "未知") + "；推理token " + (response.usage?.reasoningTokens ?? "未知") + "；下次预算 " + outputBudget);
      }
      const value = response.toolCalls.find((call) => call.arguments)?.arguments ?? parseObject(response.text);
      return { document: normalizeResearch(value), response };
    } catch (error) {
      failure = error instanceof Error ? error.message : "JSON 无法解析";
      options.onDiagnostic?.("结构校验未通过，正在修复返回格式（" + (attempt + 1) + "/3）：" + failure.slice(0, 160));
      repair = zeroTextTruncation
        ? "上次调用的推理预算已耗尽，未返回任何可用 JSON。不要复述资料，不要展开长推理；只选择当前节点最重要的一项可验证补充，输出严格符合契约的最小 JSON，最多1个节点和2张卡片。其余内容写入 gaps。"
        : "上次输出未通过格式校验：" + failure.slice(0, 1500) + "\n修复 JSON 转义与字段类型。只输出本次能完整容纳的1–2个节点，剩余主题写入gaps待后续批次继续，禁止声称研究全部完成。禁止新增无依据的事实。待修复输出：\n" + response.text.slice(0, 16000);
    }
  }
  throw new Error("模型返回格式经三次校验仍未通过：" + failure.slice(0, 600) + "。已保留此前完成的研究批次。");
}
