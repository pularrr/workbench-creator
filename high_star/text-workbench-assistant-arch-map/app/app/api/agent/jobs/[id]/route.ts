import { NextResponse } from "next/server";
import { getAgentJob } from "../../../../../server/agent/background-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "缺少会话标识" }, { status: 400 });
  const job = await getAgentJob((await context.params).id, sessionId);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const { text: _text, result, ...metadata } = job;
  return NextResponse.json({ job: { ...metadata, result: result ? (({ text: _resultText, ...rest }) => rest)(result) : undefined, hasResult: Boolean(result) } }, { headers: { "cache-control": "no-store" } });
}
