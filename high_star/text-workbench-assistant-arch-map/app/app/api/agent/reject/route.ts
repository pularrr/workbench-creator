import { NextResponse } from "next/server";
import { onlineAgentService } from "../../../../server/agent/online-agent-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; patchId?: string };
    if (!body.sessionId?.trim() || !body.patchId?.trim()) throw new Error("sessionId and patchId are required.");
    await onlineAgentService().reject({ sessionId: body.sessionId, patchId: body.patchId });
    return NextResponse.json({ rejected: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rejection failed." }, { status: 400 });
  }
}
