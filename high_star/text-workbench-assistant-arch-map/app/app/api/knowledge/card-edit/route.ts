import { NextResponse } from "next/server";
import type { CardBlock } from "../../../../core/knowledge/schema";
import { onlineAgentService } from "../../../../server/agent/online-agent-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; nodeId?: string; headline?: string; blocks?: CardBlock[] };
    if (!body.sessionId?.trim() || !body.nodeId?.trim() || !body.headline?.trim() || !Array.isArray(body.blocks)) throw new Error("A complete card draft is required.");
    return NextResponse.json(await onlineAgentService().prepareCardEdit({ sessionId: body.sessionId, nodeId: body.nodeId, headline: body.headline, blocks: body.blocks }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Card edit could not be prepared." }, { status: 400 });
  }
}
