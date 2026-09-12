import { NextResponse } from "next/server";
import { cancelAgentJob, listAgentJobs, startAgentJob } from "../../../../server/agent/background-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "缺少会话标识" }, { status: 400 });
  const limit = Number(params.get("limit") ?? 20);
  return NextResponse.json(await listAgentJobs(sessionId, { cursor: params.get("cursor") ?? undefined, limit: Number.isFinite(limit) ? limit : 20 }), { headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.sessionId !== "string" || !body.sessionId.trim() || typeof body.nodeId !== "string" || !body.nodeId.trim() || typeof body.query !== "string") throw new Error("任务参数无效");
    if (!["chat", "deep-search", "summary", "ingest"].includes(body.kind)) throw new Error("任务类型无效");
    if (body.codeRepositoryId !== undefined && (typeof body.codeRepositoryId !== "string" || !body.codeRepositoryId.trim())) throw new Error("源码仓库参数无效");
    if (body.query.length > 80000 || (body.sourceText && (typeof body.sourceText !== "string" || body.sourceText.length > 100000))) throw new Error("请将资料拆分为较小的章节");
    return NextResponse.json({ job: await startAgentJob(body) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "启动失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || typeof body.sessionId !== "string") throw new Error("缺少任务标识");
    await cancelAgentJob(body.id,body.sessionId);
    return NextResponse.json({cancelled:true});
  } catch (error) { return NextResponse.json({error:String(error)},{status:400}); }
}
