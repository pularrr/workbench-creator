import { NextResponse } from "next/server";
import { stageTextImport } from "../../../../core/ingestion/offline-intake";
import { onlineAgentService } from "../../../../server/agent/online-agent-service";
import { matchClaimsToGraph } from "../../../../server/agent/claim-matcher";
import { createConfiguredLlmProvider } from "../../../../server/llm/provider-factory";
import { runtimeLlmConfigStore } from "../../../../server/runtime/app-runtime";

export const runtime = "nodejs";

const INGEST_PROMPTS: Record<string, string> = {
  conversation: `你正在整理一段与其他 LLM 的对话记录。请：
1. 提取对话中的核心观点、结论和达成一致的知识点；
2. 识别对话中提到的方法、算法、参数和工程取舍；
3. 区分"已确认的事实"和"讨论中的推测"，只把可验证的事实作为知识候选；
4. 先用图谱检索判断这些知识点是否已存在：已存在→续写该节点的对应栏目；确认是新增知识→才创建新节点；
5. 对话中的口语化表达请转为规范的学术表述。
6. 新增节点必须挂到图谱中最相关的已有节点下（方法归方法分支、参数归参数分支），不要都挂到根节点；名称要具体到能自解释，不要用空泛的"XX研究"类命名。
7. 【节点粒度硬约束】一个节点只放一个东西，由 nodeType 决定：concept=一个概念，method/algorithm=一个解决方案，problem=一个问题或现象，model=一个模型。禁止把多个并列概念/方法/问题放在一个节点中（如"CV、CA、CTRV、CTRA"必须拆分为4个子节点，共享"运动模型"父节点）。problem 节点只描述问题/现象本身，禁止混入解决方法或子问题；解决方法必须是独立 method/algorithm 节点。节点名称不超过15字，禁止包含"、""/"和"等并列连词；shortFact 不超过50字，详细内容放知识卡栏目。

对话内容如下：
`,
  summary: `你正在整理一份知识摘要。请：
1. 提取摘要中的关键知识点、方法、结论和数据；
2. 判断每个知识点与当前图谱的关系（已存在/补充/冲突/新增）；
3. 对已存在的节点，判断应续写哪个栏目；对确认是新增的知识，再判断应创建什么类型的节点；
4. 只保留可验证、有实质内容的知识点，过滤空泛描述。
5. 新增节点父级必须来自图谱真实节点（优先方法/参数/现象的对应分支），不要都挂根节点；节点名要能自解释。
6. 【节点粒度硬约束】一个节点只放一个东西，由 nodeType 决定：concept=一个概念，method/algorithm=一个解决方案，problem=一个问题或现象。禁止多个并列概念/方法/问题放一个节点（如"KF/EKF/UKF"必须拆分为3个子节点，共享"卡尔曼滤波族"父节点）。problem 节点只描述问题/现象，禁止混入解决方法；解决方法必须是独立节点。节点名称不超过15字，禁止并列连词；shortFact 不超过50字。

摘要内容如下：
`,
  paper: `你正在整理一篇最新文献方案或技术方案。请：
1. 提取方案的关键设计：核心方法、创新点、算法流程、关键参数和假设；
2. 识别方案与现有图谱中方法的关系（替代/补充/扩展/冲突）；
3. 对方法类知识，若图谱已有相似方法节点，优先作为补充栏目或相近节点挂载，不要重复建点；确属新方法才创建 method/algorithm 节点，父级必须指向图谱中最相关的已有节点（如"波形与中频形成"下的方法分支），并给出父节点ID；
4. 提取方案中的实验结论、性能指标和适用场景作为卡片内容；
5. 明确标注方案中的不确定性和未验证部分。
6. 新节点命名要具体（如"基于Mamba的雷达目标检测"），不要用空泛的"新技术""研究方案"等。
7. 【节点粒度硬约束】一个节点只放一个东西：concept=一个概念，method/algorithm=一个解决方案，problem=一个问题或现象。禁止多个并列方法放一个节点（如"IAA/OMP/RELAX"必须拆分为3个子节点，共享"超分辨谱估计"父节点）。problem 节点只描述问题，禁止混入解决方法。节点名称不超过15字，禁止并列连词；shortFact 不超过50字。

文献方案内容如下：
`,
  document: `你正在整理一份技术文档。请：
1. 提取文档中的关键知识点、定义、方法和结论；
2. 先用图谱检索判断知识点是否已存在：已存在→续写该节点对应栏目；确认是新增→才创建新节点；
3. 只保留可验证、有实质内容的知识点。
4. 新增节点父级必须来自图谱真实节点，不要都挂根节点；名称具体可自解释。
5. 【节点粒度硬约束】一个节点只放一个东西：concept=一个概念，method/algorithm=一个解决方案，problem=一个问题或现象。禁止多个并列概念放一个节点。problem 节点只描述问题/现象，禁止混入解决方法。节点名称不超过15字，禁止并列连词；shortFact 不超过50字。

文档内容如下：
`,
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; nodeId?: string; title?: string; text?: string; kind?: "conversation" | "summary" | "paper" | "document" };
    if (!body.sessionId?.trim() || !body.nodeId?.trim() || !body.text?.trim()) throw new Error("sessionId, nodeId and source text are required.");
    const kind = body.kind ?? "document";
    const staged = stageTextImport({ kind, title: body.title?.trim() || "用户提供资料", text: body.text, suppliedBy: "local-user", currentNodeId: body.nodeId });

    // P3-3: real graph matching before deep search. When a provider is
    // configured, run the LLM + graph-retrieval matcher so the candidate is
    // grounded in actual graph content instead of the hard-coded heuristic.
    let matches = staged.matches;
    if (runtimeLlmConfigStore().status().configured) {
      try {
        const provider = createConfiguredLlmProvider({ environment: runtimeLlmConfigStore().environment() });
        matches = await matchClaimsToGraph(provider, await (await import("../../../../server/runtime/app-runtime")).activeKnowledgeRepository().then(repository => repository.snapshot()), staged, body.nodeId);
      } catch {
        // Fail-open: keep the staged heuristic matches.
      }
    }

    const stagedWithMatches: typeof staged = { ...staged, matches };
    const { ACTIVE_PROFILE } = await import("../../../../profiles/active");
    const promptTemplate = ACTIVE_PROFILE.prompts.ingest[kind] || INGEST_PROMPTS[kind] || INGEST_PROMPTS.document;
    const result = await onlineAgentService().deepSearch({
      sessionId: body.sessionId,
      nodeId: body.nodeId,
      query: `${promptTemplate}${body.text.slice(0, 20_000)}`,
      staged: stagedWithMatches,
    });
    return NextResponse.json({ ...result, stagedArtifactId: staged.artifact.id, stagedClaimCount: staged.claims.length, ingestKind: kind, matchDecisions: matches.map((m) => ({ claimId: m.claimId, decision: m.decision, matchedNodeId: m.matchedNodeId ?? null, score: m.score })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Knowledge ingestion failed." }, { status: 400 });
  }
}
