import { NextResponse } from "next/server";
import { startAgentJob } from "../../../../server/agent/background-jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; nodeId?: string; query?: string };
    if (!body.sessionId?.trim() || !body.nodeId?.trim()) throw new Error("sessionId and nodeId are required.");
    const job = await startAgentJob({ sessionId: body.sessionId, nodeId: body.nodeId, kind: "deep-search", query: body.query?.trim() || "" });
    return NextResponse.json({ job, statusUrl: `/api/agent/jobs/${job.id}?sessionId=${encodeURIComponent(body.sessionId)}`, resultUrl: `/api/agent/jobs/${job.id}/result?sessionId=${encodeURIComponent(body.sessionId)}` }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Deep search failed." }, { status: 400 });
  }
}
