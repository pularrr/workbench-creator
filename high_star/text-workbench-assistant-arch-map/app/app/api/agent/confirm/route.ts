import { NextResponse } from "next/server";
import { onlineAgentService } from "../../../../server/agent/online-agent-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; patchId?: string; confirmationToken?: string };
    if (!body.sessionId?.trim() || !body.patchId?.trim() || !body.confirmationToken?.trim()) throw new Error("A complete confirmation is required.");
    return NextResponse.json(await onlineAgentService().confirm({ sessionId: body.sessionId, patchId: body.patchId, confirmationToken: body.confirmationToken }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Confirmation failed." }, { status: 400 });
  }
}
