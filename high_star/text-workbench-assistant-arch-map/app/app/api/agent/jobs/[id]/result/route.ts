import { NextResponse } from "next/server";
import { readAgentJobText } from "../../../../../../server/agent/background-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = new URL(request.url).searchParams; const sessionId = params.get("sessionId");
    if (!sessionId) return NextResponse.json({ error: "缺少会话标识" }, { status: 400 });
    const cursor = Number(params.get("cursor") ?? 0); const limit = Number(params.get("limit") ?? 32768);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit)) throw new Error("结果游标无效");
    return NextResponse.json(await readAgentJobText((await context.params).id, sessionId, cursor, limit), { headers: { "cache-control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "结果读取失败" }, { status: 400 }); }
}
